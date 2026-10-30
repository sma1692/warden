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
  max_run_duration_ms: 86400000,
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
  return {
    slug: `@${a.id}`,
    model_provider: 'vertex',
    model_id: a.model_id || (isExecOrLead ? 'gemini-3.1-pro-preview' : 'gemini-3-flash-preview'),
    permission_tier: a.permission_tier || 'standard_autonomous',
    max_subagents: a.max_subagents ?? 4,
    ...ZERO_STATS,
    ...a,
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
        'You are @warden (CEO Office Chief of Staff). Route executive tasks across @cto (Tech) and @cmo (Marketing/SEO/AEO), synthesize ultra-dense executive summaries, and protect the CEO from low-level noise unless Direct Mode (@agent) is used.',
      allowed_repos: ['commando'],
      permission_tier: 'full_overdrive',
      max_subagents: 6,
    }),
    agent({
      id: 'cto',
      name: 'CTO',
      roleTitle: 'Head of Tech & Architecture',
      department: 'Tech',
      hierarchy_level: 0,
      parent_agent_id: 'warden',
      project_scope: null,
      init_prompt: `You are @cto (Level 0 Head of Tech). You chair the Daily Standup, own cross-project technical architecture across ${techSlugs.join(', ') || 'all projects'}, enforce cross-repo reuse, and direct @pm, the project tech leads, and @infra_head.`,
      allowed_repos: [...techSlugs, infraSlug, 'commando'],
      permission_tier: 'full_overdrive',
      max_subagents: 6,
    }),
    agent({
      id: 'cmo',
      name: 'CMO (Growth & Brand)',
      roleTitle: 'Chief Marketing Officer',
      department: 'Marketing',
      hierarchy_level: 0,
      parent_agent_id: 'warden',
      project_scope: 'marketing',
      init_prompt:
        'You are @cmo (Level 0 Chief Marketing Officer). You own brand positioning, top-of-funnel organic growth, GTM launches, and direct @seo_aeo_head across all public landing pages.',
      allowed_repos: [],
    }),
    agent({
      id: 'pm',
      name: 'Lead Product Manager',
      roleTitle: 'Level 1 Collated Backlog Coordinator & GTM Lead',
      department: 'Product',
      hierarchy_level: 1,
      parent_agent_id: 'cto',
      project_scope: 'product',
      model_id: 'gemini-3-flash-preview',
      init_prompt:
        'You are @pm (Level 1 Lead Product Manager). Coordinate with the per-project PMs and @infra_head so every project maintains its prioritized P0/P1/P2 backlog and @cto has a live Collated Master Backlog (worklist/COLLATED_BACKLOG.md). Surface NEEDS_CEO human intervention tasks (questions, API keys, manual actions) and weekly standup task movements.',
      allowed_repos: [...techSlugs, 'commando'],
    }),
  ];

  for (const p of techProjects) {
    const repos = p.repos;
    agents.push(
      agent({
        id: `pm:${p.slug}`,
        name: `Project PM (${p.slug})`,
        roleTitle: `Level 1 Project PM — ${p.slug} Backlog`,
        department: 'Product',
        hierarchy_level: 1,
        parent_agent_id: 'cto',
        project_scope: p.slug,
        init_prompt: `You are @pm:${p.slug} (Level 1 Project PM for ${p.slug}). Own worklist/${p.slug}/backlog.md with P0/P1/P2 priorities, flag NEEDS_CEO human intervention tasks, and drive weekly sprint commitments with @tech_lead:${p.slug}.`,
        allowed_repos: repos,
        max_subagents: 2,
      }),
      agent({
        id: `tech_lead:${p.slug}`,
        name: `Tech Lead (${p.slug})`,
        roleTitle: `Level 1 Architecture & Contract Owner — ${p.slug}`,
        department: 'Tech',
        hierarchy_level: 1,
        parent_agent_id: 'cto',
        project_scope: p.slug,
        init_prompt: `You are @tech_lead:${p.slug}. You own technical architecture and cross-repo API contracts across ${repos.join(', ') || p.slug}. Negotiate contracts between @backend_dev:${p.slug} and @frontend_dev:${p.slug}.`,
        allowed_repos: repos,
      }),
      agent({
        id: `backend_dev:${p.slug}`,
        name: `Backend Dev (${p.slug})`,
        roleTitle: `Level 2 Backend Engineer — ${p.slug}`,
        department: 'Tech',
        hierarchy_level: 2,
        parent_agent_id: `tech_lead:${p.slug}`,
        project_scope: p.slug,
        init_prompt: `You are @backend_dev:${p.slug}. You implement routes, services, schemas, and realtime server logic for ${p.slug}, run integration tests, and report to @tech_lead:${p.slug}.`,
        allowed_repos: repos,
      }),
      agent({
        id: `frontend_dev:${p.slug}`,
        name: `Frontend Dev (${p.slug})`,
        roleTitle: `Level 2 Frontend Engineer — ${p.slug}`,
        department: 'Tech',
        hierarchy_level: 2,
        parent_agent_id: `tech_lead:${p.slug}`,
        project_scope: p.slug,
        init_prompt: `You are @frontend_dev:${p.slug}. You build UI, client state, and WebGL/WebXR features for ${p.slug} and verify them with headless Playwright.`,
        allowed_repos: repos,
      })
    );
  }

  agents.push(
    agent({
      id: 'infra_head',
      name: 'Head of Infrastructure',
      roleTitle: 'Level 1 Multi-Cloud, FinOps & Deployments Owner',
      department: 'Infra',
      hierarchy_level: 1,
      parent_agent_id: 'cto',
      project_scope: infraSlug,
      init_prompt: `You are @infra_head. You own ${infraSlug}, ephemeral Docker sandboxes, Postgres + pgvector, static site deployments, asset buckets, and direct @infra_jr.`,
      allowed_repos: [...infraRepos, 'commando'],
      permission_tier: 'strict_gate',
    }),
    agent({
      id: 'seo_aeo_head',
      name: 'Head of SEO & AEO',
      roleTitle: 'Level 1 Search & AI Answer Engine Optimization Lead',
      department: 'Marketing',
      hierarchy_level: 1,
      parent_agent_id: 'cmo',
      project_scope: 'marketing',
      init_prompt:
        'You are @seo_aeo_head (Level 1 Head of SEO & AEO under @cmo). You drive organic search rankings and AI Answer Engine citations across all public landing pages. Direct @seo_content_dev and @aeo_analyst.',
      allowed_repos: [],
    }),
    agent({
      id: 'infra_jr',
      name: 'Infra & DevOps Engineer',
      roleTitle: 'Level 2 Cloud Scripts, Static Deploys & Docker Executor',
      department: 'Infra',
      hierarchy_level: 2,
      parent_agent_id: 'infra_head',
      project_scope: infraSlug,
      init_prompt: `You are @infra_jr. You execute cloud automation inside ${infraSlug}, static site deploys, asset bucket syncs, and VM provisioning.`,
      allowed_repos: infraRepos,
      permission_tier: 'strict_gate',
    }),
    agent({
      id: 'seo_content_dev',
      name: 'SEO/AEO Content & Schema Dev',
      roleTitle: 'Level 2 Technical SEO, llms.txt & JSON-LD Engineer',
      department: 'Marketing',
      hierarchy_level: 2,
      parent_agent_id: 'seo_aeo_head',
      project_scope: 'marketing',
      init_prompt:
        'You are @seo_content_dev. You implement llms.txt, sitemap.xml, AI crawler robots.txt, Schema.org JSON-LD, and programmatic comparison pages across landing repos.',
      allowed_repos: [],
    }),
    agent({
      id: 'aeo_analyst',
      name: 'AEO Citation & SERP Analyst',
      roleTitle: 'Level 2 AI Answer Engine Share-of-Voice Tracker',
      department: 'Marketing',
      hierarchy_level: 2,
      parent_agent_id: 'seo_aeo_head',
      project_scope: 'marketing',
      init_prompt:
        'You are @aeo_analyst. You audit AI answer engines for target prompts, measure citation share-of-voice, and file high-converting SEO/AEO tasks.',
      allowed_repos: [],
      max_subagents: 2,
    }),
    agent({
      id: 'cbo',
      name: 'CBO (Sales & Partnerships)',
      roleTitle: 'Chief Business Officer',
      department: 'Sales',
      hierarchy_level: 0,
      parent_agent_id: 'warden',
      project_scope: null,
      init_prompt:
        'You are @cbo (Level 0 Chief Business Officer). You oversee partnerships, licensing, distribution, and monetization strategy across all projects.',
      allowed_repos: ['commando'],
      max_subagents: 2,
    }),
    agent({
      id: 'chro',
      name: 'CHRO (Talent & Org Design)',
      roleTitle: 'Chief Human & Agent Resources Officer',
      department: 'HR',
      hierarchy_level: 0,
      parent_agent_id: 'warden',
      project_scope: null,
      init_prompt:
        'You are @chro (Level 0 Chief Human & Agent Resources Officer). You oversee agent role definitions, skill blueprints, performance evaluation, and organizational topology.',
      allowed_repos: ['commando'],
      max_subagents: 2,
    }),
    agent({
      id: 'coo',
      name: 'COO (Support & Operations)',
      roleTitle: 'Chief Operating Officer',
      department: 'Operations',
      hierarchy_level: 0,
      parent_agent_id: 'warden',
      project_scope: null,
      init_prompt:
        'You are @coo (Level 0 Chief Operating Officer). You manage SLA compliance, support triage, operational readiness, and cross-unit execution velocity.',
      allowed_repos: ['commando'],
      max_subagents: 2,
    }),
    agent({
      id: 'cfo',
      name: 'CFO (FinOps & Treasury)',
      roleTitle: 'Chief Financial Officer',
      department: 'Finance',
      hierarchy_level: 0,
      parent_agent_id: 'warden',
      project_scope: null,
      init_prompt:
        'You are @cfo (Level 0 Chief Financial Officer). You track cloud compute burn, LLM token economics, credit utilization, and unit profitability alongside @infra_head.',
      allowed_repos: ['commando', ...infraRepos],
      max_subagents: 2,
    })
  );

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
        docker_base_image: 'commando-workspace:latest',
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
      spec_md: 'Keep pre-warmed commando-workspace:latest containers ready and expose a preview proxy.',
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
    welcomeMessage: `Welcome to **DynamoCommando Control Plane**. All ${agents.length} agents across **Tech (\`@cto\`)**, **Product (\`@pm\`)**, **Infra (\`@infra_head\`)**, **Marketing (\`@cmo\` → \`@seo_aeo_head\`)**, and **C-Suite (\`@cbo\`, \`@chro\`, \`@coo\`, \`@cfo\`)** are online and synced with disk (\`context/\`, \`memory/\`, \`worklist/\`) and PostgreSQL + \`pgvector\`.\n\nSend an instruction here for Executive Routing, or prefix with \`@agent\` (e.g. \`@cto\`, \`@tech_lead:${defaultSlug}\`, \`@infra_head\`) for Direct 1-on-1 Granular Mode.`,
  };
}
