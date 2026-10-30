#!/usr/bin/env node
/**
 * DynamoCommando Markdown-to-Database Migration & Vector Ingestion Engine
 * (`scripts/migrate-md-to-db.ts`)
 *
 * Parses and ingests all existing Commando Markdown files and state caches into
 * PostgreSQL 16 + pgvector (when online) and `.state/dynamocommando-db.json`:
 *  1. `agents` (19 corporate & technical hierarchy agents across Root, Tech, Marketing, & Planned C-Suite)
 *  2. `project_contexts` (`projects.yaml`, `.state/topology-cache.json`, `context/*.md`, `context/<project>/<repo>.md`)
 *  3. `agent_memories` (`memory/*.md`, `memory/<project>/*.md` -> categorized + 768-dim vector embeddings)
 *  4. `backlog_items` (`worklist/inbox.md`, `worklist/todo/*.md`, `worklist/done/*.md`)
 *  5. `sprints` & `approval_gates` (`standups/*.md` + pending CEO decisions D1-D5)
 *  6. `chat_threads` & `chat_messages` (`chats/*.md` session logs & chronological transcripts)
 *  7. `agent_runs`, `inference_steps`, & `code_chunks` (historical execution telemetry & repo architecture chunks)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dbStore,
  SEED_AGENTS,
  type BacklogPriority,
  type BacklogStage,
  type ChatSenderType,
  type Department,
  type HumanInterventionType,
  type MemoryType,
  type RepoRole,
} from '../packages/db/src/index.ts';
import {
  getDeploymentProfile,
  loadPrivateJson,
  type ProjectKeywordRule,
} from '../packages/db/src/privateData.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, '..');

/**
 * Optional private seed data (`private-data/db/migrate-seed.json`): historical runs, NEEDS_CEO
 * items, sprint plans, code chunk seeds, and project/agent mapping rules. Never published.
 * Without it, only the Markdown files on disk are ingested.
 */
interface MigrateSeedFile {
  supplementalMemories?: any[];
  humanInterventionItems?: any[];
  marketingItems?: any[];
  sprintWeeklyPlan?: any[];
  sprintTaskMovements?: any[];
  historicalRuns?: any[];
  codeChunkSeeds?: any[];
  /** Ordered keyword -> project rules for backlog ingestion (falls back to the deployment profile). */
  projectKeywordRules?: ProjectKeywordRule[];
  /** Backlog project slug -> owning PM agent id. */
  pmOwnerByProject?: Record<string, string>;
  todoDefaultPmOwner?: string;
  doneDefaultPmOwner?: string;
  /** Keyword rules mapping standup CEO decisions to approval gate owners. */
  approvalGateRules?: Array<{
    match: string[];
    agentId: string;
    department: Department;
    projectScope: string;
    gateType: 'PROD_DEPLOY' | 'PAID_API_OR_SPEND' | 'AMBIGUOUS_REQUIREMENT';
  }>;
  defaultGateProjectScope?: string;
  sprintPlanGatePrompt?: string;
  verificationQuery?: string;
}
const MIGRATE_SEED: MigrateSeedFile = loadPrivateJson<MigrateSeedFile>('db/migrate-seed.json') ?? {};
const PROFILE = getDeploymentProfile();

// ----------------------------------------------------------------------------
// Helper Utilities
// ----------------------------------------------------------------------------

function readFileSafe(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function listMarkdownFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...listMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

function extractTitle(markdown: string, fallback: string): string {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].replace(/`/g, '').trim() : fallback;
}

function splitMarkdownSections(markdown: string): Array<{ heading: string; body: string }> {
  const lines = markdown.split(/\r?\n/);
  const sections: Array<{ heading: string; body: string }> = [];
  let currentHeading = 'Overview';
  let currentLines: string[] = [];

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      if (currentLines.join('\n').trim().length > 0) {
        sections.push({
          heading: currentHeading,
          body: currentLines.join('\n').trim(),
        });
      }
      currentHeading = h2Match[1].trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.join('\n').trim().length > 0) {
    sections.push({
      heading: currentHeading,
      body: currentLines.join('\n').trim(),
    });
  }

  return sections;
}

function normalizeAgentId(raw: string, defaultProject?: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/^@/, '')
    .trim();

  if (cleaned === 'ceo' || cleaned === 'user') return 'ceo';
  if (cleaned.startsWith('warden')) return 'warden';
  if (cleaned === 'cto' || cleaned.includes('as cto')) return 'cto';
  if (cleaned.startsWith('pm')) return 'pm';
  if (cleaned.startsWith('infra_head')) return 'infra_head';
  if (cleaned.startsWith('infra_jr')) return 'infra_jr';
  if (cleaned.startsWith('cmo')) return 'cmo';
  if (cleaned.startsWith('seo_aeo_head')) return 'seo_aeo_head';
  if (cleaned.startsWith('seo_content_dev')) return 'seo_content_dev';
  if (cleaned.startsWith('aeo_analyst')) return 'aeo_analyst';

  const project =
    PROFILE.devScopedProjects.find((p) => cleaned.includes(p.toLowerCase())) ?? defaultProject ?? PROFILE.defaultProject;

  if (cleaned.includes('tech_lead')) {
    return `tech_lead:${project}`;
  }
  if (cleaned.includes('backend_dev')) {
    return `backend_dev:${project}`;
  }
  if (cleaned.includes('frontend_dev')) {
    return `frontend_dev:${project}`;
  }

  return 'warden';
}

// ----------------------------------------------------------------------------
// 1. Ingest `context/` + `.state/topology-cache.json` -> `project_contexts`
// ----------------------------------------------------------------------------

interface TopologyRepoEntry {
  project: string;
  repoName: string;
  path: string;
  role: string;
  techStack: string[];
  scripts: Record<string, string>;
  keyDirs: string[];
  gitBranch?: string;
}

async function migrateProjectContexts(): Promise<number> {
  const topologyPath = path.join(WORKSPACE_ROOT, '.state', 'topology-cache.json');
  const topologyRaw = readFileSafe(topologyPath);
  const topology: { projects?: Record<string, { description?: string; repos?: TopologyRepoEntry[] }> } =
    topologyRaw ? JSON.parse(topologyRaw) : {};

  const contextDir = path.join(WORKSPACE_ROOT, 'context');
  const mdFiles = listMarkdownFiles(contextDir).filter(
    (f) => !f.endsWith('TEMPLATE.md') && !f.endsWith('REPO_TEMPLATE.md')
  );

  let count = 0;

  for (const filePath of mdFiles) {
    const relPath = path.relative(contextDir, filePath);
    const parts = relPath.split(path.sep);
    const markdown = readFileSafe(filePath);
    if (!markdown) continue;

    let projectSlug = '';
    let repoSlug = '';
    let role: RepoRole = 'meta-docs';
    let localPath: string | null = null;
    let defaultBranch = 'main';
    let buildCmd: string | null = null;
    let testCmd: string | null = null;
    let devPreviewPort: number | null = null;
    let topologyMeta: Record<string, unknown> = {};

    if (parts.length === 1) {
      projectSlug = path.basename(parts[0], '.md');
      repoSlug = 'GLOBAL';
      role = 'meta-docs';
    } else if (parts.length >= 2) {
      projectSlug = parts[0];
      repoSlug = path.basename(parts[1], '.md');
      const repoEntry = topology.projects?.[projectSlug]?.repos?.find((r) => r.repoName === repoSlug);
      if (repoEntry) {
        role = (repoEntry.role as RepoRole) || 'fullstack';
        localPath = repoEntry.path;
        defaultBranch = repoEntry.gitBranch || 'main';
        buildCmd = repoEntry.scripts?.build ? 'npm run build' : null;
        testCmd = repoEntry.scripts?.test ? 'npm test' : null;
        devPreviewPort = PROFILE.repoPreviewPorts[repoSlug] ?? PROFILE.projectPreviewPorts[projectSlug] ?? null;
        topologyMeta = {
          techStack: repoEntry.techStack,
          scripts: repoEntry.scripts,
          keyDirs: repoEntry.keyDirs,
        };
      }
    }

    const sections = splitMarkdownSections(markdown);
    await dbStore.upsertProjectContext({
      id: `${projectSlug}:${repoSlug}`,
      project_slug: projectSlug,
      repo_slug: repoSlug,
      local_path: localPath,
      default_branch: defaultBranch,
      role,
      build_cmd: buildCmd,
      test_cmd: testCmd,
      dev_preview_port: devPreviewPort,
      architecture_doc_md: markdown,
      topology_json: {
        ...topologyMeta,
        title: extractTitle(markdown, `${projectSlug}:${repoSlug}`),
        sourceFile: `context/${relPath.replace(/\\/g, '/')}`,
        sectionHeadings: sections.map((s) => s.heading),
      },
    });

    count += 1;
  }

  return count;
}

// ----------------------------------------------------------------------------
// 2. Ingest `memory/**/*.md` -> `agent_memories`
// ----------------------------------------------------------------------------

function mapMemoryFileToAgent(relPath: string): { agentId: string; projectScope: string } {
  const normalized = relPath.replace(/\\/g, '/');
  if (normalized === 'cto.md') return { agentId: 'cto', projectScope: 'GLOBAL' };
  if (normalized === 'pm.md') return { agentId: 'pm', projectScope: 'GLOBAL' };
  if (normalized === 'infra_head.md') return { agentId: 'infra_head', projectScope: PROFILE.infraProject };
  if (normalized === 'infra_jr.md') return { agentId: 'infra_jr', projectScope: PROFILE.infraProject };

  const parts = normalized.split('/');
  if (parts.length === 2) {
    const projectScope = parts[0];
    const roleName = path.basename(parts[1], '.md');
    return {
      agentId: `${roleName}:${projectScope}`,
      projectScope,
    };
  }

  return { agentId: 'warden', projectScope: 'GLOBAL' };
}

function mapHeadingToMemoryType(heading: string): MemoryType {
  const lower = heading.toLowerCase();
  if (lower.includes('directive') || lower.includes('preference')) return 'PINNED_PREFERENCE';
  if (lower.includes('gotcha') || lower.includes('lesson') || lower.includes('quirk')) return 'REPO_GOTCHA';
  if (lower.includes('mental model') || lower.includes('open thread') || lower.includes('posture')) {
    return 'OPEN_THREAD';
  }
  return 'EPISODIC_LESSON';
}

async function migrateAgentMemories(): Promise<number> {
  const memoryDir = path.join(WORKSPACE_ROOT, 'memory');
  const mdFiles = listMarkdownFiles(memoryDir).filter((f) => !f.endsWith('TEMPLATE.md'));

  let count = 0;

  for (const filePath of mdFiles) {
    const relPath = path.relative(memoryDir, filePath);
    const markdown = readFileSafe(filePath);
    if (!markdown) continue;

    const { agentId, projectScope } = mapMemoryFileToAgent(relPath);
    const sections = splitMarkdownSections(markdown);

    for (const section of sections) {
      if (section.heading === 'Overview') continue;
      const memoryType = mapHeadingToMemoryType(section.heading);

      const bullets = section.body
        .split(/\r?\n(?=-\s+)/)
        .map((b) => b.trim())
        .filter((b) => b.startsWith('- ') && !b.includes('*(Populate'));

      if (bullets.length > 0) {
        for (const bullet of bullets) {
          const bulletText = bullet.replace(/^-\s+/, '').trim();
          await dbStore.addAgentMemory({
            agent_id: agentId,
            project_scope: projectScope,
            memory_type: memoryType,
            content: `[${section.heading}] ${bulletText}`,
            is_pinned: memoryType === 'PINNED_PREFERENCE' || memoryType === 'REPO_GOTCHA',
          });
          count += 1;
        }
      } else if (section.body.trim().length > 0) {
        await dbStore.addAgentMemory({
          agent_id: agentId,
          project_scope: projectScope,
          memory_type: memoryType,
          content: `[${section.heading}] ${section.body.trim()}`,
          is_pinned: memoryType === 'PINNED_PREFERENCE',
        });
        count += 1;
      }
    }
  }

  // Also seed optional supplemental memories (private seed data)
  const supplementalMemories: Array<{
    agent_id: string;
    project_scope: string;
    memory_type: MemoryType;
    content: string;
    is_pinned: boolean;
  }> = (MIGRATE_SEED.supplementalMemories ?? []);

  for (const mem of supplementalMemories) {
    await dbStore.addAgentMemory(mem);
    count += 1;
  }

  return count;
}

// ----------------------------------------------------------------------------
// 3. Ingest `worklist/inbox.md`, `worklist/todo/*.md`, `worklist/done/*.md` -> `backlog_items`
// ----------------------------------------------------------------------------

function parsePriority(raw: string): BacklogPriority {
  if (raw.includes('P0')) return 'P0';
  if (raw.includes('P1')) return 'P1';
  return 'P2';
}

function parseProjectSlug(raw: string): { department: Department; projectSlug: string } {
  const cleaned = raw.replace(/`/g, '').toLowerCase().trim();
  const rules = MIGRATE_SEED.projectKeywordRules ?? PROFILE.projectKeywordRules;
  for (const rule of rules) {
    if (rule.match.some((kw) => kw && cleaned.includes(kw.toLowerCase()))) {
      return { department: rule.department, projectSlug: rule.projectSlug };
    }
  }
  return { department: 'tech', projectSlug: PROFILE.defaultProject };
}

function pmOwnerFor(projectSlug: string, fallback: string): string {
  return MIGRATE_SEED.pmOwnerByProject?.[projectSlug] ?? fallback;
}

async function migrateBacklogItems(sprintId: string | null): Promise<number> {
  const worklistDir = path.join(WORKSPACE_ROOT, 'worklist');
  const todoDir = path.join(worklistDir, 'todo');
  const doneDir = path.join(worklistDir, 'done');

  let count = 0;

  // 3A. Parse `worklist/todo/*.md`
  const todoFiles = listMarkdownFiles(todoDir);
  for (const filePath of todoFiles) {
    const slug = path.basename(filePath, '.md');
    const markdown = readFileSafe(filePath);
    if (!markdown) continue;

    const title = extractTitle(markdown, slug).replace(/^Worklist:\s*/i, '');
    const priorityMatch = markdown.match(/-\s+\*\*Priority\*\*:\s*`?(P[0-2])`?/i);
    const ownerMatch = markdown.match(/-\s+\*\*Owner\*\*:\s*(.+)$/m);
    const projectMatch = markdown.match(/-\s+\*\*Project\s*\/\s*Repo\*\*:\s*(.+)$/m);

    const priority = priorityMatch ? parsePriority(priorityMatch[1]) : 'P1';
    const { department, projectSlug } = parseProjectSlug(projectMatch ? projectMatch[1] : slug);

    let assignedAgentId = 'pm';
    if (ownerMatch) {
      const primaryOwner = ownerMatch[1].split('(')[0].trim();
      assignedAgentId = normalizeAgentId(primaryOwner, projectSlug);
    }

    const pmOwnerId = pmOwnerFor(projectSlug, MIGRATE_SEED.todoDefaultPmOwner ?? 'pm');

    await dbStore.createBacklogItem({
      id: `bl_${slug.replace(/-/g, '_')}`,
      title,
      spec_md: markdown,
      stage: 'TODO',
      priority,
      department,
      project_slug: projectSlug,
      pm_owner_id: pmOwnerId,
      assigned_agent_id: assignedAgentId,
      sprint_id: sprintId,
      target_week: '2026-W43',
      requires_human_intervention: false,
      intervention_type: 'NONE',
      last_moved_at: '2026-10-25T00:05:00.000Z',
      last_movement_note: `Scheduled for Week 2026-W43 by @${pmOwnerId}`,
    });
    count += 1;
  }

  // 3B. Parse `worklist/done/*.md`
  const doneFiles = listMarkdownFiles(doneDir);
  for (const filePath of doneFiles) {
    const slug = path.basename(filePath, '.md');
    const markdown = readFileSafe(filePath);
    if (!markdown) continue;

    const title = extractTitle(markdown, slug);
    const { department, projectSlug } = parseProjectSlug(markdown.slice(0, 500));
    const pmOwnerId = pmOwnerFor(projectSlug, MIGRATE_SEED.doneDefaultPmOwner ?? 'pm');

    await dbStore.createBacklogItem({
      id: `bl_${slug.replace(/-/g, '_')}`,
      title,
      spec_md: markdown,
      stage: 'DONE',
      priority: 'P0',
      department,
      project_slug: projectSlug,
      pm_owner_id: pmOwnerId,
      assigned_agent_id: `tech_lead:${projectSlug}`,
      sprint_id: sprintId,
      target_week: '2026-W43',
      requires_human_intervention: false,
      intervention_type: 'NONE',
      last_moved_at: '2026-10-24T18:30:00.000Z',
      last_movement_note: 'Verified and archived to DONE',
      completed_at: '2026-10-24T18:30:00.000Z',
    });
    count += 1;
  }

  // 3C. Seed Human / CEO Intervention (`NEEDS_CEO`) items from `worklist/<project>/backlog.md`
  const humanInterventionItems: Array<{
    id: string;
    title: string;
    spec_md: string;
    priority: BacklogPriority;
    department: Department;
    project_slug: string;
    pm_owner_id: string;
    assigned_agent_id: string;
    intervention_type: HumanInterventionType;
    intervention_prompt: string;
    required_env_keys?: string[];
    requested_by_agent_id: string;
    last_movement_note: string;
  }> = (MIGRATE_SEED.humanInterventionItems ?? []);

  for (const hi of humanInterventionItems) {
    await dbStore.createBacklogItem({
      ...hi,
      stage: 'NEEDS_CEO',
      sprint_id: sprintId,
      target_week: '2026-W43',
      requires_human_intervention: true,
      human_response: null,
      last_moved_at: '2026-10-25T00:10:00.000Z',
    });
    count += 1;
  }

  // 3D. Seed Unit B Marketing (`cmo` / `seo_aeo_head`) backlog items for `/worklist` & `IdleBacklogMonitor`
  const marketingItems: Array<{
    id: string;
    title: string;
    spec_md: string;
    stage: BacklogStage;
    priority: BacklogPriority;
    department: Department;
    project_slug: string;
    pm_owner_id: string;
    assigned_agent_id: string;
  }> = (MIGRATE_SEED.marketingItems ?? []);

  for (const item of marketingItems) {
    await dbStore.createBacklogItem({
      ...item,
      sprint_id: sprintId,
      target_week: '2026-W43',
      requires_human_intervention: false,
      intervention_type: 'NONE',
      last_moved_at: '2026-10-25T00:05:00.000Z',
    });
    count += 1;
  }

  return count;
}

// ----------------------------------------------------------------------------
// 4. Ingest `standups/*.md` -> `sprints` & `approval_gates`
// ----------------------------------------------------------------------------

async function migrateStandupsAndApprovalGates(): Promise<{
  sprints: number;
  gates: number;
  latestSprintId: string | null;
}> {
  const standupsDir = path.join(WORKSPACE_ROOT, 'standups');
  const mdFiles = listMarkdownFiles(standupsDir).filter((f) => !f.endsWith('TEMPLATE.md'));

  let sprintCount = 0;
  let gateCount = 0;
  let latestSprintId: string | null = null;

  for (const filePath of mdFiles) {
    const fileName = path.basename(filePath, '.md');
    const dateMatch = fileName.match(/^(\d{4}-\d{2}-\d{2})/);
    const dateIst = dateMatch ? dateMatch[1] : '2026-10-24';
    const markdown = readFileSafe(filePath);
    if (!markdown) continue;

    const sprint = await dbStore.upsertSprint({
      id: `spr_${dateIst.replace(/-/g, '_')}`,
      date_ist: dateIst,
      week_label: '2026-W43',
      status: markdown.includes('AWAITING_CEO_APPROVAL') ? 'AWAITING_CEO_APPROVAL' : 'EXECUTING',
      mom_summary_md: markdown,
      weekly_plan_json: (MIGRATE_SEED.sprintWeeklyPlan ?? []),
      task_movements_json: (MIGRATE_SEED.sprintTaskMovements ?? []),
    });
    latestSprintId = sprint.id;
    sprintCount += 1;

    // Extract CEO decisions `[D1]` .. `[D5]`
    const decisionLines = markdown
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^-\s+`?\[D\d+\]`?/.test(l));

    for (const dLine of decisionLines) {
      const dMatch = dLine.match(/^-\s+`?\[(D\d+)\]`?\s*(.+)$/);
      const code = dMatch ? dMatch[1] : `D${gateCount + 1}`;
      const question = dMatch ? dMatch[2].trim() : dLine;

      let agentId = 'cto';
      let department: Department = 'tech';
      let projectScope = MIGRATE_SEED.defaultGateProjectScope ?? PROFILE.defaultProject;
      let gateType: 'PROD_DEPLOY' | 'PAID_API_OR_SPEND' | 'AMBIGUOUS_REQUIREMENT' =
        'AMBIGUOUS_REQUIREMENT';

      const lowerQuestion = question.toLowerCase();
      const gateRule = (MIGRATE_SEED.approvalGateRules ?? [
        { match: ['deploy'], agentId: 'infra_head', department: 'infra' as Department, projectScope: PROFILE.defaultProject, gateType: 'PROD_DEPLOY' as const },
        { match: ['cost scan'], agentId: 'infra_head', department: 'infra' as Department, projectScope: PROFILE.infraProject, gateType: 'PAID_API_OR_SPEND' as const },
      ]).find((rule) => rule.match.some((kw) => lowerQuestion.includes(kw)));
      if (gateRule) {
        agentId = gateRule.agentId;
        department = gateRule.department;
        projectScope = gateRule.projectScope;
        gateType = gateRule.gateType;
      }

      await dbStore.createApprovalGate({
        id: `gate_${dateIst.replace(/-/g, '_')}_${code.toLowerCase()}`,
        agent_id: agentId,
        department,
        project_scope: projectScope,
        gate_type: gateType,
        prompt_text: `[${code}] ${question}`,
        options_json: ['Approve Option A (Recommended)', 'Approve Option B', 'Defer to Next Sprint'],
        status: 'PENDING',
      });
      gateCount += 1;
    }

    // Overarching Sprint Plan approval gate
    await dbStore.createApprovalGate({
      id: `gate_${dateIst.replace(/-/g, '_')}_sprint_plan`,
      agent_id: 'cto',
      department: 'tech',
      project_scope: 'GLOBAL',
      gate_type: 'STANDUP_SPRINT_PLAN',
      prompt_text: (MIGRATE_SEED.sprintPlanGatePrompt ?? '[Standup ${dateIst}] Approve Daily Sprint Plan across all projects.').replace(
        '${dateIst}',
        dateIst
      ),
      options_json: ['Approve Full Sprint Plan', 'Approve Code Tasks Only (Hold Deploys)', 'Request Revisions'],
      status: 'PENDING',
    });
    gateCount += 1;
  }

  return { sprints: sprintCount, gates: gateCount, latestSprintId };
}

// ----------------------------------------------------------------------------
// 5. Ingest `chats/*.md` -> `chat_threads` & `chat_messages`
// ----------------------------------------------------------------------------

async function migrateChats(): Promise<{ threads: number; messages: number }> {
  const chatsDir = path.join(WORKSPACE_ROOT, 'chats');
  const mdFiles = listMarkdownFiles(chatsDir).filter((f) => !f.endsWith('TEMPLATE.md'));

  let threadCount = 0;
  let messageCount = 0;

  for (const filePath of mdFiles) {
    const fileName = path.basename(filePath, '.md');
    const markdown = readFileSafe(filePath);
    if (!markdown) continue;

    const title = extractTitle(markdown, fileName);
    const defaultProject =
      PROFILE.chatThreadProjectRules.find((rule) => rule.match.some((kw) => kw && fileName.includes(kw)))
        ?.projectSlug ?? 'GLOBAL';

    const thread = await dbStore.createChatThread({
      id: `thr_${fileName.replace(/[^a-zA-Z0-9_]/g, '_')}`,
      title,
      mode: fileName.includes('standup') ? 'STANDUP_ROOM' : 'WARDEN_EXECUTIVE',
      target_agent_id: 'warden',
      project_scope: defaultProject,
      status: 'ACTIVE',
    });
    threadCount += 1;

    const h3Blocks = markdown.split(/\r?\n(?=###\s+)/);
    let parsedTurns = 0;

    for (let i = 0; i < h3Blocks.length; i++) {
      const block = h3Blocks[i];
      const h3Match = block.match(/^###\s+([^\r\n]+)\r?\n([\s\S]+)$/);
      if (!h3Match) continue;

      const header = h3Match[1].trim();
      const body = h3Match[2].trim();
      if (!body) continue;

      const arrowMatch = header.match(/(?:\[[^\]]+\]\s*)?(.+?)\s*(?:->|↔|<->|→)\s*(.+)$/);
      let senderAgentId: string | null = 'warden';
      let recipientAgentId: string | null = 'cto';
      let senderType: ChatSenderType = 'AGENT';

      if (arrowMatch) {
        const rawSender = normalizeAgentId(arrowMatch[1], defaultProject === 'GLOBAL' ? undefined : defaultProject);
        const firstRecipient = arrowMatch[2].split(',')[0].split('&')[0].trim();
        const rawRecipient = normalizeAgentId(
          firstRecipient,
          defaultProject === 'GLOBAL' ? undefined : defaultProject
        );

        if (rawSender === 'ceo') {
          senderType = 'CEO';
          senderAgentId = null;
        } else {
          senderAgentId = rawSender;
        }
        recipientAgentId = rawRecipient === 'ceo' ? null : rawRecipient;
      } else {
        senderAgentId = normalizeAgentId(header, defaultProject === 'GLOBAL' ? undefined : defaultProject);
      }

      await dbStore.appendChatMessage({
        id: `${thread.id}_msg_${i + 1}`,
        thread_id: thread.id,
        sender_type: senderType,
        sender_agent_id: senderAgentId,
        recipient_agent_id: recipientAgentId,
        content: `**${header}**\n\n${body}`,
      });
      messageCount += 1;
      parsedTurns += 1;
    }

    if (parsedTurns === 0) {
      const sections = splitMarkdownSections(markdown);
      for (let i = 0; i < Math.min(sections.length, 6); i++) {
        const sec = sections[i];
        await dbStore.appendChatMessage({
          id: `${thread.id}_sec_${i + 1}`,
          thread_id: thread.id,
          sender_type: 'AGENT',
          sender_agent_id: 'cto',
          recipient_agent_id: 'warden',
          content: `## ${sec.heading}\n\n${sec.body.slice(0, 2000)}`,
        });
        messageCount += 1;
      }
    }
  }

  return { threads: threadCount, messages: messageCount };
}

// ----------------------------------------------------------------------------
// 6. Seed Historical `agent_runs`, `inference_steps`, and `code_chunks`
// ----------------------------------------------------------------------------

async function seedTelemetryAndCodeChunks(sprintId: string | null): Promise<{
  runs: number;
  steps: number;
  chunks: number;
}> {
  let runCount = 0;
  let stepCount = 0;
  let chunkCount = 0;

  const historicalRuns: Array<{
    id: string;
    agent_id: string;
    trigger_type: 'STANDUP_CRON' | 'CEO_CHAT' | 'AGENT_DELEGATION' | 'IDLE_BACKLOG_PING';
    input_prompt: string;
    output_summary: string;
    model_used: string;
    git_branch: string | null;
    git_commit_sha: string | null;
    tokens_in: number;
    tokens_cached: number;
    tokens_thinking: number;
    tokens_out: number;
    cost_usd: number;
    duration_ms: number;
  }> = (MIGRATE_SEED.historicalRuns ?? []);

  for (const r of historicalRuns) {
    const sessionHash = r.id.split('_')[2];
    const parentRunId = r.agent_id === 'warden' ? null : `run_session_${sessionHash}_warden`;
    await dbStore.startAgentRun({
      id: r.id,
      agent_id: r.agent_id,
      parent_run_id: parentRunId,
      sprint_id: sprintId,
      trigger_type: r.trigger_type,
      input_prompt: r.input_prompt,
      status: 'RUNNING',
      started_at: '2026-10-24T12:00:00.000Z',
    });

    await dbStore.appendInferenceStep({
      id: `${r.id}_step_1`,
      run_id: r.id,
      step_index: 1,
      step_type: 'THINKING',
      model_used: r.model_used,
      thinking_text: `Analyzing context and vector memories for ${r.agent_id}: ${r.input_prompt}`,
      duration_ms: Math.round(r.duration_ms * 0.35),
      tokens_in: r.tokens_in,
      tokens_cached: r.tokens_cached,
      tokens_thinking: r.tokens_thinking,
      tokens_out: 0,
    });

    await dbStore.appendInferenceStep({
      id: `${r.id}_step_2`,
      run_id: r.id,
      step_index: 2,
      step_type: 'TOOL_CALL',
      model_used: r.model_used,
      tool_name: 'search_memory',
      tool_args_json: { agent_id: r.agent_id, topK: 5 },
      tool_output_json: { matches: 5, status: 'ok' },
      duration_ms: Math.round(r.duration_ms * 0.25),
      tokens_in: 450,
      tokens_cached: 400,
      tokens_thinking: 0,
      tokens_out: 180,
    });

    await dbStore.appendInferenceStep({
      id: `${r.id}_step_3`,
      run_id: r.id,
      step_index: 3,
      step_type: 'FINAL_ANSWER',
      model_used: r.model_used,
      message_text: r.output_summary,
      duration_ms: Math.round(r.duration_ms * 0.4),
      tokens_in: 600,
      tokens_cached: 500,
      tokens_thinking: 0,
      tokens_out: r.tokens_out,
    });

    await dbStore.completeAgentRun(r.id, {
      status: 'COMPLETED',
      output_summary: r.output_summary,
      git_branch: r.git_branch ?? undefined,
      git_commit_sha: r.git_commit_sha ?? undefined,
      tokens_in: r.tokens_in,
      tokens_cached: r.tokens_cached,
      tokens_thinking: r.tokens_thinking,
      tokens_out: r.tokens_out,
      cost_usd: r.cost_usd,
      skip_telemetry_increment: true,
    });

    runCount += 1;
    stepCount += 3;
  }

  // Seed architectural `code_chunks` from `.state/topology-cache.json` + key repo files
  const codeChunkSeeds: Array<{
    project_slug: string;
    repo_slug: string;
    file_path: string;
    symbol_name: string;
    chunk_type: 'function' | 'class' | 'route' | 'component' | 'module';
    content: string;
  }> = (MIGRATE_SEED.codeChunkSeeds ?? []);

  for (const chunk of codeChunkSeeds) {
    await dbStore.upsertCodeChunk(chunk);
    chunkCount += 1;
  }

  return { runs: runCount, steps: stepCount, chunks: chunkCount };
}

// ----------------------------------------------------------------------------
// Main Execution & Self-Verification
// ----------------------------------------------------------------------------

async function main() {
  console.log('====================================================================');
  console.log(' DynamoCommando — Markdown-to-DB & pgvector Ingestion Engine');
  console.log('====================================================================');

  const { mode } = await dbStore.init();
  console.log(`[1/7] Storage Mode Initialized: ${mode.toUpperCase()}`);

  // Reset local state cleanly before full migration so counts are deterministic
  dbStore.resetState();

  const agents = await dbStore.seedAgents(SEED_AGENTS);
  const creds = await dbStore.listProviderCredentials();
  const profiles = await dbStore.listRoutingProfiles();
  console.log(
    `[2/7] Seeded Agents & Routing Pool: ${agents.length} agents, ${creds.length} provider credentials, ${profiles.length} routing profiles`
  );

  const contextCount = await migrateProjectContexts();
  console.log(`[3/7] Migrated Project & Repo Contexts: ${contextCount} documents`);

  const memoryCount = await migrateAgentMemories();
  console.log(`[4/7] Migrated Agent Procedural Memories: ${memoryCount} memory entries vectorized (768-dim)`);

  const { sprints, gates, latestSprintId } = await migrateStandupsAndApprovalGates();
  console.log(`[5/7] Migrated Standup Sprints & Approval Gates: ${sprints} sprints, ${gates} CEO approval gates`);

  const backlogCount = await migrateBacklogItems(latestSprintId);
  console.log(`[6/7] Migrated Worklist Backlog (inbox/todo/done + Marketing): ${backlogCount} items`);

  const { threads, messages } = await migrateChats();
  const { runs, steps, chunks } = await seedTelemetryAndCodeChunks(latestSprintId);
  console.log(
    `[7/7] Migrated Chats & Telemetry: ${threads} chat threads, ${messages} messages, ${runs} runs, ${steps} inference steps, ${chunks} code chunks`
  );

  // Run verification queries
  const telemetry = await dbStore.getCompanyTelemetrySummary();
  const deptBacklog = await dbStore.getDepartmentBacklogCounts();
  const sampleVectorHits = await dbStore.searchAgentMemories({
    queryText: MIGRATE_SEED.verificationQuery ?? 'analytics guard and config parity',
    topK: 3,
  });

  console.log('\n--------------------------------------------------------------------');
  console.log(' Verification Summary');
  console.log('--------------------------------------------------------------------');
  console.log(` • Storage Snapshot : ${dbStore.getSnapshotPath()}`);
  console.log(` • Total Agents     : ${telemetry.total_agents} (${telemetry.total_runs} completed runs)`);
  console.log(
    ` • Backlog Summary  : ${deptBacklog.map((d) => `${d.department}:${d.project_slug}(active=${d.active_queue_count}, done=${d.done_count})`).join(' | ')}`
  );
  console.log(` • Pending Gates    : ${telemetry.pending_approvals} awaiting CEO sign-off`);
  console.log(
    ` • Top Vector Match : [${sampleVectorHits[0]?.agent_id}] "${sampleVectorHits[0]?.content.slice(0, 75)}..." (similarity=${sampleVectorHits[0]?.similarity})`
  );
  console.log('====================================================================\n');

  await dbStore.close();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
