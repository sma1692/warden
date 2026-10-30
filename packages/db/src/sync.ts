/**
 * DynamoCommando Bi-Directional Markdown <-> Database Sync Engine (`packages/db/src/sync.ts`)
 *
 * Bridges the two co-existing operating modes of Commando:
 *  1. **Native IDE Mode (Antigravity / Claude Code)**: Reads & writes `context/**`, `memory/**`,
 *     `worklist/**`, `standups/**`, and `chats/**` directly on disk without needing Docker or PostgreSQL.
 *  2. **Production Web OS & Orchestrator Mode**: Reads & writes PostgreSQL 16 + pgvector (and
 *     `.state/dynamocommando-db.json` dual-mode snapshot).
 *
 * Exports:
 *  - `syncDiskToDb(options?)`: Ingests latest Markdown edits from disk into DB + 768-dim vector index.
 *  - `syncDbToDisk(options?)`: Flushes DB updates (`project_contexts`, `agent_memories`, `backlog_items`,
 *    `sprints`) back to their canonical Markdown files on disk non-destructively.
 *  - `syncBiDirectional(options?)`: Runs `syncDiskToDb` followed by `syncDbToDisk` so both surfaces
 *    converge deterministically.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  BacklogPriority,
  BacklogStage,
  ChatSenderType,
  ContractStatus,
  Department,
  HumanInterventionType,
  MemoryType,
  RepoRole,
} from './schema.ts';
import { SEED_AGENTS } from './seed-agents.ts';
import { dbStore } from './store.ts';
import { getDeploymentProfile } from './privateData.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..');

export interface SyncOptions {
  workspaceRoot?: string;
  writeNewBacklogFiles?: boolean;
  verbose?: boolean;
}

export interface DiskToDbSyncResult {
  direction: 'disk-to-db';
  projectContextsSynced: number;
  agentMemoriesSynced: number;
  backlogItemsSynced: number;
  sprintsSynced: number;
  chatThreadsSynced: number;
  chatMessagesSynced: number;
  contractsSynced: number;
  timestamp: string;
}

export interface DbToDiskSyncResult {
  direction: 'db-to-disk';
  contextFilesUpdated: number;
  memoryFilesUpdated: number;
  backlogFilesUpdated: number;
  standupFilesUpdated: number;
  contractFilesUpdated: number;
  timestamp: string;
}

export interface BiDirectionalSyncResult {
  direction: 'both';
  diskToDb: DiskToDbSyncResult;
  dbToDisk: DbToDiskSyncResult;
  timestamp: string;
}

// ----------------------------------------------------------------------------
// Internal File & Markdown Helpers
// ----------------------------------------------------------------------------

function readFileSafe(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function writeFileIfChanged(filePath: string, content: string): boolean {
  const existing = readFileSafe(filePath);
  if (existing !== null && existing === content) {
    return false;
  }
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, 'utf8');
  return true;
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

function mapMemoryFileToAgent(relPath: string): { agentId: string; projectScope: string } {
  const normalized = relPath.replace(/\\/g, '/');
  if (normalized === 'cto.md') return { agentId: 'cto', projectScope: 'GLOBAL' };
  if (normalized === 'cbo.md') return { agentId: 'cbo', projectScope: 'GLOBAL' };
  if (normalized === 'warden.md') return { agentId: 'warden', projectScope: 'GLOBAL' };
  if (normalized === 'pm.md') return { agentId: 'pm', projectScope: 'GLOBAL' };
  if (normalized === 'infra_head.md') return { agentId: 'infra_head', projectScope: getDeploymentProfile().infraProject };
  if (normalized === 'infra_jr.md') return { agentId: 'infra_jr', projectScope: getDeploymentProfile().infraProject };

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

function mapAgentToMemoryFile(agentId: string): string | null {
  if (agentId === 'cto') return 'memory/cto.md';
  if (agentId === 'cbo') return 'memory/cbo.md';
  if (agentId === 'warden') return 'memory/warden.md';
  if (agentId === 'pm') return 'memory/pm.md';
  if (agentId === 'infra_head') return 'memory/infra_head.md';
  if (agentId === 'infra_jr') return 'memory/infra_jr.md';

  if (agentId.includes(':')) {
    const [roleName, projectScope] = agentId.split(':');
    if (
      getDeploymentProfile().memoryScopedProjects.includes(projectScope) &&
      (roleName === 'tech_lead' || roleName === 'backend_dev' || roleName === 'frontend_dev')
    ) {
      return `memory/${projectScope}/${roleName}.md`;
    }
  }
  return null;
}

interface ParsedChatTurn {
  heading: string;
  senderType: ChatSenderType;
  senderAgentId: string | null;
  recipientAgentId: string | null;
  content: string;
  createdAt: string;
}

function parseChatTranscriptTurns(markdown: string, fallbackDateIso: string): ParsedChatTurn[] {
  const lines = markdown.split(/\r?\n/);
  const turns: Array<{ heading: string; bodyLines: string[] }> = [];
  let inCodeFence = false;
  let currentHeading: string | null = null;
  let currentBody: string[] = [];

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCodeFence = !inCodeFence;
    }
    if (!inCodeFence) {
      const h3Match = line.match(/^###\s+(.+)$/);
      if (h3Match) {
        if (currentHeading !== null && currentBody.join('\n').trim().length > 0) {
          turns.push({ heading: currentHeading, bodyLines: currentBody });
        }
        currentHeading = h3Match[1].trim();
        currentBody = [];
        continue;
      }
    }
    if (currentHeading !== null) {
      currentBody.push(line);
    }
  }
  if (currentHeading !== null && currentBody.join('\n').trim().length > 0) {
    turns.push({ heading: currentHeading, bodyLines: currentBody });
  }

  return turns.map((turn, idx) => {
    const tsMatch = turn.heading.match(/\[(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)\s*(?:IST)?\]/i);
    let createdAt = fallbackDateIso;
    if (tsMatch) {
      const datePart = tsMatch[1];
      const timePart = tsMatch[2].length === 5 ? `${tsMatch[2]}:00` : tsMatch[2];
      const parsed = new Date(`${datePart}T${timePart}+05:30`);
      if (!Number.isNaN(parsed.getTime())) {
        createdAt = parsed.toISOString();
      }
    } else {
      const baseMs = Date.parse(fallbackDateIso);
      if (!Number.isNaN(baseMs)) {
        createdAt = new Date(baseMs + idx * 1000).toISOString();
      }
    }

    const strippedHeading = turn.heading.replace(/^\[[^\]]+\]\s*/, '').trim();
    const arrowParts = strippedHeading.split(/\s*(?:->|→)\s*/);
    const leftRaw = (arrowParts[0] || '').replace(/`/g, '').trim();
    const rightRaw = (arrowParts[1] || '').replace(/`/g, '').trim();

    const isCeoSender = /\bceo\b/i.test(leftRaw) && !leftRaw.toLowerCase().startsWith('warden');
    const senderType: ChatSenderType = isCeoSender ? 'CEO' : 'AGENT';
    const senderAgentId = isCeoSender
      ? null
      : leftRaw.toLowerCase().includes('warden')
        ? 'warden'
        : normalizeOwnerAgentId(leftRaw);

    let recipientAgentId: string | null = null;
    if (rightRaw && !/\bceo\b/i.test(rightRaw)) {
      const firstRecipient = rightRaw.split(/[&,]/)[0].trim();
      recipientAgentId = firstRecipient.toLowerCase().includes('warden')
        ? 'warden'
        : normalizeOwnerAgentId(firstRecipient);
    }

    const bodyText = turn.bodyLines
      .join('\n')
      .replace(/\n---\s*$/, '')
      .trim();

    return {
      heading: turn.heading,
      senderType,
      senderAgentId,
      recipientAgentId,
      content: `### ${turn.heading}\n\n${bodyText}`,
      createdAt,
    };
  });
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

function parsePriority(raw: string): BacklogPriority {
  if (raw.includes('P0')) return 'P0';
  if (raw.includes('P1')) return 'P1';
  return 'P2';
}

function parseProjectSlug(raw: string): { department: Department; projectSlug: string } {
  const cleaned = raw.replace(/`/g, '').toLowerCase().trim();
  const profile = getDeploymentProfile();
  for (const rule of profile.projectKeywordRules) {
    if (rule.match.some((kw) => kw && cleaned.includes(kw.toLowerCase()))) {
      return { department: rule.department, projectSlug: rule.projectSlug };
    }
  }
  return { department: 'tech', projectSlug: profile.defaultProject };
}

function normalizeOwnerAgentId(raw: string, defaultProject?: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/^@/, '')
    .trim();

  if (cleaned.startsWith('warden')) return 'warden';
  if (cleaned === 'cto' || cleaned.includes('as cto')) return 'cto';
  if (cleaned.startsWith('cbo')) return 'cbo';
  const profile = getDeploymentProfile();
  for (const proj of profile.pmScopedProjects) {
    if (cleaned.startsWith(`pm:${proj}`) || cleaned.startsWith(`pm ${proj}`)) return `pm:${proj}`;
  }
  if (cleaned.startsWith('pm')) {
    return defaultProject && profile.pmScopedProjects.includes(defaultProject) ? `pm:${defaultProject}` : 'pm';
  }
  if (cleaned.startsWith('infra_head')) return 'infra_head';
  if (cleaned.startsWith('infra_jr')) return 'infra_jr';
  if (cleaned.startsWith('cmo')) return 'cmo';
  if (cleaned.startsWith('seo_aeo_head')) return 'seo_aeo_head';
  if (cleaned.startsWith('seo_content_dev')) return 'seo_content_dev';
  if (cleaned.startsWith('aeo_analyst')) return 'aeo_analyst';

  const devProjects = profile.devScopedProjects;
  const project =
    devProjects.find((p) => cleaned.includes(p.toLowerCase())) ??
    (defaultProject && devProjects.includes(defaultProject)
      ? defaultProject
      : devProjects.includes(profile.defaultProject)
        ? profile.defaultProject
        : (devProjects[0] ?? profile.defaultProject));

  if (cleaned.includes('tech_lead')) {
    return `tech_lead:${project}`;
  }
  if (cleaned.includes('backend_dev')) {
    return `backend_dev:${project}`;
  }
  if (cleaned.includes('frontend_dev')) {
    return `frontend_dev:${project}`;
  }

  return 'pm';
}

// ----------------------------------------------------------------------------
// 1. Disk -> DB Sync (`syncDiskToDb`)
// ----------------------------------------------------------------------------

export async function syncDiskToDb(options: SyncOptions = {}): Promise<DiskToDbSyncResult> {
  const workspaceRoot = options.workspaceRoot || DEFAULT_WORKSPACE_ROOT;
  await dbStore.init();

  // Ensure all 19 seed agents exist in DB
  await dbStore.seedAgents(SEED_AGENTS);

  // 1A. Sync `context/**/*.md` + `.state/topology-cache.json` -> `project_contexts`
  const topologyPath = path.join(workspaceRoot, '.state', 'topology-cache.json');
  const topologyRaw = readFileSafe(topologyPath);
  const topology: {
    projects?: Record<
      string,
      {
        description?: string;
        repos?: Array<{
          project: string;
          repoName: string;
          path: string;
          role: string;
          techStack: string[];
          scripts: Record<string, string>;
          keyDirs: string[];
          gitBranch?: string;
        }>;
      }
    >;
  } = topologyRaw ? JSON.parse(topologyRaw) : {};

  const contextDir = path.join(workspaceRoot, 'context');
  const contextFiles = listMarkdownFiles(contextDir).filter(
    (f) => !f.endsWith('TEMPLATE.md') && !f.endsWith('REPO_TEMPLATE.md')
  );

  let projectContextsSynced = 0;
  for (const filePath of contextFiles) {
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
        const profile = getDeploymentProfile();
        devPreviewPort = profile.repoPreviewPorts[repoSlug] ?? profile.projectPreviewPorts[projectSlug] ?? null;
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
    projectContextsSynced += 1;
  }

  // 1B. Sync `memory/**/*.md` -> `agent_memories` (deduplicated)
  const memoryDir = path.join(workspaceRoot, 'memory');
  const memoryFiles = listMarkdownFiles(memoryDir).filter((f) => !f.endsWith('TEMPLATE.md'));
  let agentMemoriesSynced = 0;

  for (const filePath of memoryFiles) {
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
          agentMemoriesSynced += 1;
        }
      }
    }
  }

  // 1C. Sync `standups/*.md` -> `sprints`
  const standupsDir = path.join(workspaceRoot, 'standups');
  const standupFiles = listMarkdownFiles(standupsDir).filter((f) => !f.endsWith('TEMPLATE.md'));
  let sprintsSynced = 0;
  let latestSprintId: string | null = null;

  for (const filePath of standupFiles) {
    const fileName = path.basename(filePath, '.md');
    const dateMatch = fileName.match(/^(\d{4}-\d{2}-\d{2})/);
    const dateIst = dateMatch ? dateMatch[1] : '2026-10-24';
    const markdown = readFileSafe(filePath);
    if (!markdown) continue;

    const sprint = await dbStore.upsertSprint({
      id: `spr_${dateIst.replace(/-/g, '_')}`,
      date_ist: dateIst,
      status: markdown.includes('AWAITING_CEO_APPROVAL') ? 'AWAITING_CEO_APPROVAL' : 'EXECUTING',
      mom_summary_md: markdown,
    });
    latestSprintId = sprint.id;
    sprintsSynced += 1;
  }

  // 1D. Sync `worklist/todo/*.md` & `worklist/done/*.md` -> `backlog_items`
  const worklistDir = path.join(workspaceRoot, 'worklist');
  const todoFiles = listMarkdownFiles(path.join(worklistDir, 'todo'));
  const doneFiles = listMarkdownFiles(path.join(worklistDir, 'done'));
  let backlogItemsSynced = 0;

  for (const filePath of todoFiles) {
    const slug = path.basename(filePath, '.md');
    const markdown = readFileSafe(filePath);
    if (!markdown) continue;

    const id = `bl_${slug.replace(/-/g, '_')}`;
    const existing = await dbStore.getBacklogItem(id);
    const title = extractTitle(markdown, slug).replace(/^Worklist:\s*/i, '');
    const priorityMatch = markdown.match(/-\s+\*\*Priority\*\*:\s*`?(P[0-2])`?/i);
    const ownerMatch = markdown.match(/-\s+\*\*Owner\*\*:\s*(.+)$/m);
    const projectMatch = markdown.match(/-\s+\*\*Project\s*\/\s*Repo\*\*:\s*(.+)$/m);

    const priority = priorityMatch ? parsePriority(priorityMatch[1]) : existing?.priority || 'P1';
    const { department, projectSlug } = parseProjectSlug(projectMatch ? projectMatch[1] : slug);

    let assignedAgentId = existing?.assigned_agent_id || 'pm';
    if (ownerMatch) {
      const primaryOwner = ownerMatch[1].split('(')[0].trim();
      assignedAgentId = normalizeOwnerAgentId(primaryOwner, projectSlug);
    }

    await dbStore.createBacklogItem({
      id,
      title,
      spec_md: markdown,
      stage: existing && (existing.stage === 'IN_PROGRESS' || existing.stage === 'QA_REVIEW')
        ? existing.stage
        : 'TODO',
      priority,
      department,
      project_slug: projectSlug,
      assigned_agent_id: assignedAgentId,
      sprint_id: existing?.sprint_id ?? latestSprintId,
    });
    backlogItemsSynced += 1;
  }

  for (const filePath of doneFiles) {
    const slug = path.basename(filePath, '.md');
    const markdown = readFileSafe(filePath);
    if (!markdown) continue;

    const id = `bl_${slug.replace(/-/g, '_')}`;
    const existing = await dbStore.getBacklogItem(id);
    const title = extractTitle(markdown, slug);
    const { department, projectSlug } = parseProjectSlug(markdown.slice(0, 500));

    await dbStore.createBacklogItem({
      id,
      title,
      spec_md: markdown,
      stage: 'DONE',
      priority: existing?.priority || 'P0',
      department,
      project_slug: projectSlug,
      assigned_agent_id: existing?.assigned_agent_id || `tech_lead:${projectSlug}`,
      sprint_id: existing?.sprint_id ?? latestSprintId,
      completed_at: existing?.completed_at || '2026-10-24T18:30:00.000Z',
    });
    backlogItemsSynced += 1;
  }

  // 1D-bis. Sync `worklist/<project>/backlog.md` tables -> `backlog_items`
  const projectBacklogFiles = listMarkdownFiles(worklistDir).filter((f) =>
    path.basename(f) === 'backlog.md'
  );
  for (const filePath of projectBacklogFiles) {
    const projectDirName = path.basename(path.dirname(filePath));
    const markdown = readFileSafe(filePath);
    if (!markdown) continue;
    const { department, projectSlug } = parseProjectSlug(projectDirName);
    const sections = splitMarkdownSections(markdown);

    for (const section of sections) {
      const headingLower = section.heading.toLowerCase();
      const isNeedsCeo = headingLower.includes('needs ceo') || headingLower.includes('human intervention');
      const isWeekly = headingLower.includes('decided for this week');
      const isBacklog = headingLower.includes('prioritized project backlog');
      if (!isNeedsCeo && !isWeekly && !isBacklog) continue;

      const lines = section.body.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('|') || trimmed.includes(':---')) continue;
        const cols = trimmed
          .split('|')
          .map((c) => c.trim())
          .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
        if (cols.length < 5) continue;

        const rawTaskId = cols[0].replace(/`/g, '').trim();
        if (!rawTaskId || rawTaskId.toLowerCase() === 'task id' || rawTaskId.startsWith('*(')) continue;

        const id = `bl_${rawTaskId.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;
        const existing = await dbStore.getBacklogItem(id);
        const priority = parsePriority(cols[1]);

        let title = '';
        let specMd = '';
        let stage: BacklogStage = 'TODO';
        let ownerRaw = '';
        let interventionType: HumanInterventionType | null = null;
        let interventionPrompt: string | null = null;

        if (isNeedsCeo) {
          const intType = cols[2].replace(/`/g, '').trim().toUpperCase();
          interventionType =
            intType === 'API_KEY' || intType === 'MANUAL_ACTION' || intType === 'DECISION'
              ? intType
              : 'QUESTION';
          ownerRaw = cols[3];
          const summaryCell = cols[4];
          const boldMatch = summaryCell.match(/\*\*(.+?)\*\*:\s*(.+)$/);
          title = boldMatch ? `[NEEDS_CEO:${intType}] ${boldMatch[1]}` : `[NEEDS_CEO:${intType}] ${rawTaskId}`;
          specMd = `### ${rawTaskId} (${intType})\n\n${summaryCell}\n\n- **Unblocks**: ${cols[5] || 'N/A'}\n- **Status**: ${cols[6] || 'AWAITING_CEO'}`;
          interventionPrompt = summaryCell;
          stage = existing?.stage === 'DONE' ? 'DONE' : 'NEEDS_CEO';
        } else if (isWeekly) {
          const stageCell = cols[2].replace(/`/g, '').trim().toUpperCase();
          stage = stageCell === 'IN_PROGRESS' ? 'IN_PROGRESS' : stageCell === 'DONE' ? 'DONE' : 'TODO';
          const summaryCell = cols[4];
          ownerRaw = cols[5] || '';
          const boldMatch = summaryCell.match(/\*\*(.+?)\*\*:\s*(.+)$/);
          title = boldMatch ? `${rawTaskId}: ${boldMatch[1]}` : `${rawTaskId}: ${summaryCell.slice(0, 72)}`;
          specMd = `### ${rawTaskId} (${cols[3]})\n\n${summaryCell}`;
        } else {
          const summaryCell = cols[4];
          ownerRaw = cols[5] || '';
          const boldMatch = summaryCell.match(/\*\*(.+?)\*\*:\s*(.+)$/);
          title = boldMatch ? `${rawTaskId}: ${boldMatch[1]}` : `${rawTaskId}: ${summaryCell.slice(0, 72)}`;
          specMd = `### ${rawTaskId} (${cols[3]} — Target: ${cols[2]})\n\n${summaryCell}`;
          stage = existing?.stage || 'TODO';
        }

        const assignedAgentId = normalizeOwnerAgentId(ownerRaw.split('+')[0].trim(), projectSlug);
        await dbStore.createBacklogItem({
          id,
          title,
          spec_md: specMd,
          stage,
          priority,
          department,
          project_slug: projectSlug,
          assigned_agent_id: assignedAgentId,
          requires_human_intervention: isNeedsCeo,
          intervention_type: interventionType,
          intervention_prompt: interventionPrompt,
          sprint_id: isWeekly || isNeedsCeo ? (existing?.sprint_id ?? latestSprintId) : existing?.sprint_id ?? null,
        });
        backlogItemsSynced += 1;
      }
    }
  }

  // 1E. Sync `chats/*.md` -> `chat_threads` & `chat_messages`
  const chatsDir = path.join(workspaceRoot, 'chats');
  const chatFiles = listMarkdownFiles(chatsDir).filter((f) => !f.endsWith('TEMPLATE.md'));
  let chatThreadsSynced = 0;
  let chatMessagesSynced = 0;

  for (const filePath of chatFiles) {
    const fileName = path.basename(filePath, '.md');
    const markdown = readFileSafe(filePath);
    if (!markdown) continue;

    const threadId = `thr_${fileName.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    const existingThread = await dbStore.getChatThread(threadId);
    const dateMatch = fileName.match(/^(\d{4}-\d{2}-\d{2})/);
    const fallbackDateIso = dateMatch ? `${dateMatch[1]}T06:30:00.000Z` : new Date().toISOString();

    if (!existingThread) {
      const title = extractTitle(markdown, fileName);
      const defaultProject =
        getDeploymentProfile().chatThreadProjectRules.find((rule) =>
          rule.match.some((kw) => kw && fileName.includes(kw))
        )?.projectSlug ?? 'GLOBAL';
      await dbStore.createChatThread({
        id: threadId,
        title,
        mode: fileName.includes('standup') ? 'STANDUP_ROOM' : 'WARDEN_EXECUTIVE',
        target_agent_id: 'warden',
        project_scope: defaultProject,
        status: 'ACTIVE',
      });
    }
    chatThreadsSynced += 1;

    const turns = parseChatTranscriptTurns(markdown, fallbackDateIso);
    for (let idx = 0; idx < turns.length; idx += 1) {
      const turn = turns[idx];
      await dbStore.appendChatMessage({
        id: `${threadId}_msg_${String(idx + 1).padStart(3, '0')}`,
        thread_id: threadId,
        sender_type: turn.senderType,
        sender_agent_id: turn.senderAgentId,
        recipient_agent_id: turn.recipientAgentId,
        content: turn.content,
        created_at: turn.createdAt,
      });
      chatMessagesSynced += 1;
    }

    await dbStore.upsertChatSessionLog({
      id: `log_${fileName.replace(/[^a-zA-Z0-9_]/g, '_')}`,
      thread_id: threadId,
      file_path: `chats/${path.basename(filePath)}`,
      title: extractTitle(markdown, fileName),
      content_md: markdown,
      turn_count: turns.length,
    });
  }

  // 1F. Sync `contracts/*.md` -> `contracts`
  const contractsDir = path.join(workspaceRoot, 'contracts');
  const contractFiles = listMarkdownFiles(contractsDir).filter((f) => !f.endsWith('TEMPLATE.md'));
  let contractsSynced = 0;

  for (const filePath of contractFiles) {
    const fileName = path.basename(filePath, '.md');
    const markdown = readFileSafe(filePath);
    if (!markdown) continue;

    const { projectSlug } = parseProjectSlug(fileName);
    const featureSlug = fileName.startsWith(`${projectSlug}-`)
      ? fileName.slice(projectSlug.length + 1)
      : fileName;
    const statusMatch = markdown.match(/-\s+\*\*Status\*\*:\s*`?(DRAFT|LOCKED|IMPLEMENTED)`?/i);
    const status: ContractStatus = statusMatch
      ? (statusMatch[1].toUpperCase() as ContractStatus)
      : 'LOCKED';

    await dbStore.upsertContract({
      id: `ctr_${fileName.replace(/[^a-zA-Z0-9_]/g, '_')}`,
      project_slug: projectSlug,
      feature_slug: featureSlug,
      title: extractTitle(markdown, fileName),
      status,
      file_path: `contracts/${path.basename(filePath)}`,
      content_md: markdown,
    });
    contractsSynced += 1;
  }

  return {
    direction: 'disk-to-db',
    projectContextsSynced,
    agentMemoriesSynced,
    backlogItemsSynced,
    sprintsSynced,
    chatThreadsSynced,
    chatMessagesSynced,
    contractsSynced,
    timestamp: new Date().toISOString(),
  };
}

// ----------------------------------------------------------------------------
// 2. DB -> Disk Sync (`syncDbToDisk`)
// ----------------------------------------------------------------------------

export async function syncDbToDisk(options: SyncOptions = {}): Promise<DbToDiskSyncResult> {
  const workspaceRoot = options.workspaceRoot || DEFAULT_WORKSPACE_ROOT;
  await dbStore.init();

  let contextFilesUpdated = 0;
  let memoryFilesUpdated = 0;
  let backlogFilesUpdated = 0;
  let standupFilesUpdated = 0;
  let contractFilesUpdated = 0;

  // 2A. Flush `project_contexts` -> `context/*.md` & `context/<project>/<repo>.md`
  const contexts = await dbStore.listProjectContexts();
  for (const ctx of contexts) {
    if (!ctx.architecture_doc_md || ctx.architecture_doc_md.trim().length === 0) continue;

    const sourceFile =
      typeof ctx.topology_json?.sourceFile === 'string'
        ? ctx.topology_json.sourceFile
        : ctx.repo_slug === 'GLOBAL'
          ? `context/${ctx.project_slug}.md`
          : `context/${ctx.project_slug}/${ctx.repo_slug}.md`;

    const targetPath = path.join(workspaceRoot, sourceFile);
    if (writeFileIfChanged(targetPath, ctx.architecture_doc_md)) {
      contextFilesUpdated += 1;
    }
  }

  // 2B. Flush new `agent_memories` -> `memory/**/*.md` non-destructively
  const allMemories = await dbStore.listAgentMemories();
  const memoriesByAgent = new Map<string, typeof allMemories>();
  for (const mem of allMemories) {
    const list = memoriesByAgent.get(mem.agent_id) || [];
    list.push(mem);
    memoriesByAgent.set(mem.agent_id, list);
  }

  for (const [agentId, memories] of memoriesByAgent.entries()) {
    const relFile = mapAgentToMemoryFile(agentId);
    if (!relFile) continue;

    const filePath = path.join(workspaceRoot, relFile);
    const currentMd = readFileSafe(filePath);
    if (!currentMd) continue;

    let updatedMd = currentMd;
    for (const mem of memories) {
      const stripped = mem.content.replace(/^\[[^\]]+\]\s*/, '').trim();
      if (!stripped) continue;

      // Check if this memory bullet already exists in the Markdown file
      const probe = stripped.slice(0, Math.min(48, stripped.length));
      if (updatedMd.includes(probe)) {
        continue;
      }

      // Append under the matching section or at the end of the file
      const bulletLine = `- ${stripped}`;
      updatedMd = `${updatedMd.trimEnd()}\n${bulletLine}\n`;
    }

    if (writeFileIfChanged(filePath, updatedMd)) {
      memoryFilesUpdated += 1;
    }
  }

  // 2C. Flush `backlog_items` -> `worklist/todo/*.md` & `worklist/done/*.md`
  const backlogItems = await dbStore.listBacklogItems();
  const todoDir = path.join(workspaceRoot, 'worklist', 'todo');
  const doneDir = path.join(workspaceRoot, 'worklist', 'done');

  for (const item of backlogItems) {
    const slug = item.id.replace(/^bl_/, '').replace(/_/g, '-');
    const todoPath = path.join(todoDir, `${slug}.md`);
    const donePath = path.join(doneDir, `${slug}.md`);
    const todoExists = fs.existsSync(todoPath);
    const doneExists = fs.existsSync(donePath);

    if (item.stage === 'DONE') {
      if (todoExists && !doneExists) {
        const contentToWrite = item.spec_md?.trim() ? item.spec_md : readFileSafe(todoPath) || '';
        writeFileIfChanged(donePath, contentToWrite);
        fs.unlinkSync(todoPath);
        backlogFilesUpdated += 1;
      } else if (doneExists && item.spec_md?.trim()) {
        if (writeFileIfChanged(donePath, item.spec_md)) {
          backlogFilesUpdated += 1;
        }
      }
    } else if (item.stage === 'TODO' || item.stage === 'IN_PROGRESS' || item.stage === 'QA_REVIEW') {
      if (todoExists && item.spec_md?.trim()) {
        if (writeFileIfChanged(todoPath, item.spec_md)) {
          backlogFilesUpdated += 1;
        }
      } else if (!todoExists && options.writeNewBacklogFiles && item.spec_md?.trim()) {
        if (writeFileIfChanged(todoPath, item.spec_md)) {
          backlogFilesUpdated += 1;
        }
      }
    }
  }

  // 2D. Flush `sprints` -> `standups/<YYYY-MM-DD>-standup.md`
  const sprints = await dbStore.listSprints();
  for (const sprint of sprints) {
    if (!sprint.mom_summary_md || sprint.mom_summary_md.trim().length === 0) continue;
    const standupPath = path.join(workspaceRoot, 'standups', `${sprint.date_ist}-standup.md`);
    if (writeFileIfChanged(standupPath, sprint.mom_summary_md)) {
      standupFilesUpdated += 1;
    }
  }

  // 2E. Flush `contracts` -> `contracts/<project>-<feature-slug>.md`
  const contracts = await dbStore.listContracts();
  for (const contract of contracts) {
    if (!contract.content_md || contract.content_md.trim().length === 0) continue;
    const relPath =
      contract.file_path && contract.file_path.trim().length > 0
        ? contract.file_path
        : `contracts/${contract.project_slug}-${contract.feature_slug}.md`;
    const contractPath = path.join(workspaceRoot, relPath);
    if (writeFileIfChanged(contractPath, contract.content_md)) {
      contractFilesUpdated += 1;
    }
  }

  return {
    direction: 'db-to-disk',
    contextFilesUpdated,
    memoryFilesUpdated,
    backlogFilesUpdated,
    standupFilesUpdated,
    contractFilesUpdated,
    timestamp: new Date().toISOString(),
  };
}

// ----------------------------------------------------------------------------
// 3. Bi-Directional Sync (`syncBiDirectional`)
// ----------------------------------------------------------------------------

export async function syncBiDirectional(options: SyncOptions = {}): Promise<BiDirectionalSyncResult> {
  const diskToDb = await syncDiskToDb(options);
  const dbToDisk = await syncDbToDisk(options);
  return {
    direction: 'both',
    diskToDb,
    dbToDisk,
    timestamp: new Date().toISOString(),
  };
}
