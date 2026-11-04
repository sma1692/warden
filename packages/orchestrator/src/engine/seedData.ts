import path from 'node:path';
import type {
  AgentMemoryRecord,
  AgentRecord,
  BacklogItemRecord,
  ProjectContextRecord,
  SprintRecord,
} from './OrchestratorStore.js';
import {
  getDefaultProjectSlug,
  getInfraProjectSlug,
  getProjects,
  getTechProjects,
  loadPrivateData,
} from '../config/projectRegistry.js';

/**
 * Seed data for `OrchestratorStore.seedInitialState()`.
 *
 * A workspace may ship its own seed at `private-data/orchestrator/seed.json` (never published).
 * Placeholders inside that file are hydrated at startup:
 * - `"$NOW"` -> startup ISO timestamp
 * - `{{DATE}}` inside strings -> today's date (YYYY-MM-DD)
 * - `{ "$readMd": "context/x.md", "fallback": "..." }` -> contents of that markdown file (or fallback)
 *
 * Without it, a generic demo dataset is built from `projects.yaml` (or the demo project registry).
 */

export type SeedAgent = Omit<
  AgentRecord,
  | 'status'
  | 'health_status'
  | 'last_heartbeat_at'
  | 'active_subagent_count'
  | 'current_run_id'
  | 'clocked_in_at'
>;

export interface SeedData {
  agents: SeedAgent[];
  projectContexts: ProjectContextRecord[];
  memories: AgentMemoryRecord[];
  backlogItems: BacklogItemRecord[];
  sprint: Omit<SprintRecord, 'id' | 'date_ist'>;
  welcomeMessage: string;
}

export type ReadMdFn = (relPath: string, fallback: string) => string;

function hydrate(value: unknown, now: string, today: string, readMd: ReadMdFn): unknown {
  if (typeof value === 'string') {
    if (value === '$NOW') return now;
    return value.includes('{{DATE}}') ? value.split('{{DATE}}').join(today) : value;
  }
  if (Array.isArray(value)) return value.map((v) => hydrate(v, now, today, readMd));
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.$readMd === 'string') {
      return readMd(obj.$readMd, String(obj.fallback ?? ''));
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === '$comment') continue;
      out[k] = hydrate(v, now, today, readMd);
    }
    return out;
  }
  return value;
}

export function loadSeedData(now: string, today: string, readMd: ReadMdFn): {
  data: SeedData;
  source: 'private' | 'generic';
} {
  const raw = loadPrivateData<SeedData>('seed');
  if (raw && Array.isArray(raw.agents) && raw.agents.length > 0) {
    return { data: hydrate(raw, now, today, readMd) as SeedData, source: 'private' };
  }
  return { data: buildGenericSeed(now, today, readMd), source: 'generic' };
}

const ZERO_STATS = {
  max_run_duration_ms: 1800000,
  total_work_time_ms: 0,
  today_work_time_ms: 0,
  total_runs: 0,
  total_commits: 0,
  max_tokens_per_run: 1_000_000,
  today_tokens_used: 0,
  total_tokens_in: 0,
  total_tokens_cached: 0,
  total_tokens_thinking: 0,
  total_tokens_out: 0,
  total_cost_usd: 0,
};

function agent(
  a: Pick<
    SeedAgent,
    | 'id'
    | 'name'
    | 'roleTitle'
    | 'department'
    | 'hierarchy_level'
    | 'parent_agent_id'
    | 'project_scope'
    | 'init_prompt'
    | 'allowed_repos'
  > &
    Partial<Pick<SeedAgent, 'model_id' | 'permission_tier' | 'max_subagents'>>
): SeedAgent {
  const isExecOrLead = a.hierarchy_level <= 1;
  const deptLower = a.department.toLowerCase();
  return {
    slug: `@${a.id}`,
    model_provider: 'meta_muse',
    model_id: a.model_id || (isExecOrLead ? 'muse-spark-1.3' : 'muse-light'),
    permission_tier: a.permission_tier || 'standard_autonomous',
    max_subagents: a.max_subagents ?? 4,
    ...ZERO_STATS,
    ...a,
    // Canonical lowercase form matching the Postgres agents_department_check.
    department: deptLower === 'operations' ? 'ops' : deptLower,
  };
}

/**
 * Generic demo dataset: C-suite + department agents, one PM / Tech Lead / Backend / Frontend
 * agent per tech project from the registry, contexts per repo folder, and a few demo backlog items.
 */
export function buildGenericSeed(now: string, today: string, readMd: ReadMdFn): SeedData {
  const projects = getProjects();
  const techProjects = getTechProjects();
  const infraSlug = getInfraProjectSlug();
  const defaultSlug = getDefaultProjectSlug();
  const allRepos = projects.flatMap((p) => p.repos);
  const infraRepos = projects.filter((p) => p.slug === infraSlug).flatMap((p) => p.repos);
  const techSlugs = techProjects.map((p) => p.slug);

  const agents: SeedAgent[] = [
    agent({
      id: 'warden',
      name: 'Warden',
      roleTitle: 'CEO Office Chief of Staff & Root Router',
      department: 'Executive',
      hierarchy_level: -1,
      parent_agent_id: null,
      project_scope: null,
      init_prompt:
        'You are @warden (CEO Office Chief of Staff). Route executive tasks across @cto (Tech) and @cmo (Marketing/SEO/AEO), reply to the CEO in short, plain, conversational messages, and protect the CEO from low-level noise unless Direct Mode (@agent) is used.',
      allowed_repos: ['warden', ...allRepos],
      permission_tier: 'full_overdrive',
      max_subagents: 6,
    }),
    agent({
      id: 'cto',
      name: 'CTO (Head of Tech)',
      roleTitle: 'Level 0 Chief Technology Officer',
      department: 'Tech',
      hierarchy_level: 0,
      parent_agent_id: 'warden',
      project_scope: null,
      init_prompt: `You are @cto (Level 0 Chief Technology Officer). You chair the Daily Standup, own technical architecture across ${techSlugs.join(', ') || 'all projects'}, and direct @frontend_dev and @designer (plus dynamically spawned specialists when needed).`,
      allowed_repos: [...techSlugs, infraSlug, 'warden', ...allRepos],
      permission_tier: 'full_overdrive',
      max_subagents: 6,
    }),
    agent({
      id: 'cmo',
      name: 'CMO (Growth & Brand)',
      roleTitle: 'Level 0 Chief Marketing Officer',
      department: 'Marketing',
      hierarchy_level: 0,
      parent_agent_id: 'warden',
      project_scope: 'marketing',
      init_prompt:
        'You are @cmo (Level 0 Chief Marketing Officer). You own brand positioning, top-of-funnel organic growth, GTM launches, and direct @seo_aeo_head and @social_lead across all public landing pages and channels.',
      allowed_repos: allRepos,
      max_subagents: 4,
    }),
    agent({
      id: 'frontend_dev',
      name: 'Frontend & Game Dev',
      roleTitle: 'Level 2 UI, Gameplay & Full-Stack Engineer',
      department: 'Tech',
      hierarchy_level: 2,
      parent_agent_id: 'cto',
      project_scope: defaultSlug,
      init_prompt: `You are @frontend_dev (Level 2 UI, Gameplay & Full-Stack Engineer under @cto). You implement gameplay loops, HUD components, canvas/WebGL rendering, and full-stack features for ${defaultSlug}, and verify zero console errors.`,
      allowed_repos: allRepos,
      max_subagents: 4,
    }),
    agent({
      id: 'designer',
      name: 'Creative & Sprite Designer',
      roleTitle: 'Level 2 Game Art, Sprites & UI Assets Specialist',
      department: 'Tech',
      hierarchy_level: 2,
      parent_agent_id: 'cto',
      project_scope: defaultSlug,
      init_prompt: `You are @designer (Level 2 Game Art, Sprites & UI Assets Specialist under @cto). You craft SVG/Canvas sprites, visual effects, color palettes, arcade badges, and UI polish for ${defaultSlug}.`,
      allowed_repos: allRepos,
      max_subagents: 2,
    }),
    agent({
      id: 'seo_aeo_head',
      name: 'SEO & AEO Lead',
      roleTitle: 'Level 1 Search & AI Answer Engine Optimization Lead',
      department: 'Marketing',
      hierarchy_level: 1,
      parent_agent_id: 'cmo',
      project_scope: 'marketing',
      init_prompt:
        'You are @seo_aeo_head (Level 1 Search & AI Answer Engine Optimization Lead under @cmo). You drive organic search rankings, llms.txt, Schema.org JSON-LD, OpenGraph tags, and AI Answer Engine citations.',
      allowed_repos: allRepos,
      max_subagents: 3,
    }),
    agent({
      id: 'social_lead',
      name: 'Social & Growth Lead',
      roleTitle: 'Level 1 Short-Form Clips, Launch Threads & Distribution',
      department: 'Marketing',
      hierarchy_level: 1,
      parent_agent_id: 'cmo',
      project_scope: 'marketing',
      init_prompt:
        'You are @social_lead (Level 1 Social & Growth Lead under @cmo). You own launch threads, short-form gameplay clip hooks, community distribution, and viral growth experiments.',
      allowed_repos: allRepos,
      max_subagents: 3,
    }),
  ];

  // One context per repo folder
  const projectContexts: ProjectContextRecord[] = [];
  let port = 5180;
  for (const p of projects) {
    p.folders.forEach((folder, idx) => {
      const repo = p.repos[idx] || path.basename(folder);
      const role: ProjectContextRecord['role'] =
        p.department === 'infra'
          ? 'infra'
          : /(rest|api|server|backend)$/i.test(repo)
            ? 'backend'
            : 'frontend';
      projectContexts.push({
        id: `ctx_${p.slug.replace(/[^a-z0-9]/gi, '_')}_${repo.replace(/[^a-z0-9]/gi, '_')}`,
        project_slug: p.slug,
        repo_slug: repo,
        git_repo_url: '',
        local_path: folder,
        default_branch: 'main',
        role,
        docker_base_image: 'warden-workspace:latest',
        build_cmd: 'npm run build',
        test_cmd: 'npm test',
        dev_preview_port: port++,
        architecture_doc_md: readMd(
          `context/${p.slug}/${repo}.md`,
          readMd(`context/${p.slug}.md`, `# ${repo}\n${p.description || `Repository for ${p.slug}.`}`)
        ),
        updated_at: now,
      });
    });
  }

  const memories: AgentMemoryRecord[] = [
    {
      id: 'mem_1',
      agent_id: 'cto',
      project_scope: null,
      memory_type: 'PINNED_PREFERENCE',
      content:
        'CEO Rule: Zero markdown file sprawl. All chats, sprints, backlogs, and memories persist natively in PostgreSQL + pgvector.',
      source_run_id: null,
      is_pinned: true,
      created_at: now,
    },
    {
      id: 'mem_2',
      agent_id: `tech_lead:${defaultSlug}`,
      project_scope: defaultSlug,
      memory_type: 'REPO_GOTCHA',
      content:
        'Large 3D GLB/HDR assets must be uploaded to the asset bucket via @infra_head rather than committed to git.',
      source_run_id: null,
      is_pinned: true,
      created_at: now,
    },
    {
      id: 'mem_3',
      agent_id: 'infra_head',
      project_scope: infraSlug,
      memory_type: 'CEO_DECISION',
      content:
        'Prefer read-only discovery scans before any prune or delete action on cloud resources.',
      source_run_id: null,
      is_pinned: true,
      created_at: now,
    },
  ];

  const sprintId = `spr_${today.replace(/-/g, '_')}`;
  const backlogItems: BacklogItemRecord[] = [
    {
      id: 'bl_demo_hi_01_api_key',
      title: '[DEMO-HI-01] Provide STORE_PUBLISH_API_KEY for Automated Store Uploads',
      spec_md: `Automate build uploads for ${defaultSlug} by adding \`STORE_PUBLISH_API_KEY\`.`,
      stage: 'NEEDS_CEO',
      priority: 'P1',
      project_slug: defaultSlug,
      department: 'Product',
      pm_owner_id: `pm:${defaultSlug}`,
      assigned_agent_id: `pm:${defaultSlug}`,
      sprint_id: sprintId,
      target_week: '2026-W43',
      requires_human_intervention: true,
      intervention_type: 'API_KEY',
      intervention_prompt: 'Please provide `STORE_PUBLISH_API_KEY` so the store build can be automated.',
      required_env_keys: ['STORE_PUBLISH_API_KEY'],
      requested_by_agent_id: `pm:${defaultSlug}`,
      last_moved_at: now,
      last_movement_note: `Added by @pm:${defaultSlug} -> NEEDS_CEO (API_KEY required)`,
      created_at: now,
      completed_at: null,
    },
    {
      id: 'bl_demo_hud_frame_timing',
      title: `Optimize HUD frame timing in ${defaultSlug}`,
      spec_md:
        'Hold 72fps/90fps on standalone headsets by instancing HUD glyphs and verifying zero console errors in headless Playwright WebGL.',
      stage: 'TODO',
      priority: 'P0',
      project_slug: defaultSlug,
      department: 'Tech',
      pm_owner_id: `pm:${defaultSlug}`,
      assigned_agent_id: `frontend_dev:${defaultSlug}`,
      sprint_id: sprintId,
      target_week: '2026-W43',
      requires_human_intervention: false,
      intervention_type: 'NONE',
      last_moved_at: now,
      last_movement_note: `Committed to Week 2026-W43 by @pm:${defaultSlug}`,
      created_at: now,
      completed_at: null,
    },
    {
      id: 'bl_demo_health_endpoint',
      title: `Add /healthz endpoint with dependency checks in ${defaultSlug}`,
      spec_md: 'Implement GET /healthz returning DB and cache status with a contract test.',
      stage: 'TODO',
      priority: 'P1',
      project_slug: defaultSlug,
      department: 'Tech',
      pm_owner_id: `pm:${defaultSlug}`,
      assigned_agent_id: `backend_dev:${defaultSlug}`,
      sprint_id: sprintId,
      target_week: '2026-W43',
      requires_human_intervention: false,
      intervention_type: 'NONE',
      last_moved_at: now,
      last_movement_note: `Committed to Week 2026-W43 by @pm:${defaultSlug}`,
      created_at: now,
      completed_at: null,
    },
    {
      id: 'bl_demo_sandbox_pool',
      title: `Warm Docker sandbox pool health check in ${infraSlug}`,
      spec_md: 'Keep pre-warmed warden-workspace:latest containers ready and expose a preview proxy.',
      stage: 'TODO',
      priority: 'P1',
      project_slug: infraSlug,
      department: 'Infra',
      pm_owner_id: 'infra_head',
      assigned_agent_id: 'infra_jr',
      sprint_id: sprintId,
      target_week: '2026-W43',
      requires_human_intervention: false,
      intervention_type: 'NONE',
      last_moved_at: now,
      last_movement_note: 'Committed to Week 2026-W43 by @infra_head',
      created_at: now,
      completed_at: null,
    },
    {
      id: 'bl_demo_inbox_emotes',
      title: `Quick-gesture emotes in ${defaultSlug}`,
      spec_md: 'Raw CEO Idea: let players trigger spatial audio emotes with hand gestures.',
      stage: 'INBOX',
      priority: 'P2',
      project_slug: defaultSlug,
      department: 'Product',
      pm_owner_id: `pm:${defaultSlug}`,
      assigned_agent_id: `pm:${defaultSlug}`,
      sprint_id: null,
      target_week: '2026-W44',
      requires_human_intervention: false,
      intervention_type: 'NONE',
      created_at: now,
      completed_at: null,
    },
  ];

  const committed = backlogItems.filter((b) => b.stage === 'TODO');
  const sprint: SeedData['sprint'] = {
    week_label: '2026-W43',
    status: 'AWAITING_CEO_APPROVAL',
    mom_summary_md: [
      `# 🕛 Daily Standup & Weekly Plan — ${today} (Week 2026-W43)`,
      `**Chair**: \`@cto\` | **PMs**: \`@pm\`, \`@pm:${defaultSlug}\` | **Leads**: \`@tech_lead:${defaultSlug}\`, \`@infra_head\``,
      ``,
      `### 1. What is Decided for the Week (\`2026-W43\`)`,
      ...committed.map((b) => `- **[${b.priority} | ${b.project_slug}]** ${b.title}`),
      ``,
      `### 2. Moving Around Tasks`,
      `- \`[DEMO-HI-01]\`: Moved to \`NEEDS_CEO\` (API key required)`,
    ].join('\n'),
    weekly_plan_json: committed.map((b) => ({
      backlog_item_id: b.id,
      title: b.title,
      project_slug: b.project_slug,
      pm_owner_id: b.pm_owner_id || 'pm',
      assigned_agent_id: b.assigned_agent_id || 'pm',
      priority: b.priority,
      stage: b.stage,
      target_week: '2026-W43',
    })),
    task_movements_json: [
      {
        id: 'mv_init_1',
        backlog_item_id: 'bl_demo_hi_01_api_key',
        title: '[DEMO-HI-01] Provide STORE_PUBLISH_API_KEY',
        project_slug: defaultSlug,
        from_stage: 'INBOX',
        to_stage: 'NEEDS_CEO',
        from_priority: 'P1',
        to_priority: 'P1',
        moved_by_agent_id: `pm:${defaultSlug}`,
        reason: 'Blocked on external store API key from CEO',
        moved_at: now,
      },
    ],
    approved_at: null,
    ceo_notes: null,
    created_at: now,
  };

  return {
    agents,
    projectContexts,
    memories,
    backlogItems,
    sprint,
    welcomeMessage: `Welcome to **Warden Control Plane**. All ${agents.length} agents across **Tech (\`@cto\`)**, **Product (\`@pm\`)**, **Infra (\`@infra_head\`)**, **Marketing (\`@cmo\` → \`@seo_aeo_head\`)**, and **C-Suite (\`@cbo\`, \`@chro\`, \`@coo\`, \`@cfo\`)** are online and synced with disk (\`context/\`, \`memory/\`, \`worklist/\`) and PostgreSQL + \`pgvector\`.\n\nSend an instruction here for Executive Routing, or prefix with \`@agent\` (e.g. \`@cto\`, \`@tech_lead:${defaultSlug}\`, \`@infra_head\`) for Direct 1-on-1 Granular Mode.`,
  };
}
