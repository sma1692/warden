// ============================================================================
// @commando/db — Corporate & Technical Agent Roster Seed Definitions
// ============================================================================

import type {
  AgentRow,
  ProviderCredentialRow,
  RoutingProfileRow,
} from './schema.ts';
import { getDeploymentProfile, loadPrivateJson } from './privateData.ts';

const NOW_ISO = new Date().toISOString();

function makeSeedAgent(
  partial: Omit<
    AgentRow,
    | 'fallback_provider'
    | 'fallback_model_id'
    | 'step_routing_json'
    | 'status'
    | 'health_status'
    | 'last_heartbeat_at'
    | 'active_subagent_count'
    | 'max_run_duration_ms'
    | 'current_run_id'
    | 'clocked_in_at'
    | 'total_work_time_ms'
    | 'total_runs'
    | 'total_commits'
    | 'max_tokens_per_run'
    | 'today_tokens_used'
    | 'total_tokens_in'
    | 'total_tokens_cached'
    | 'total_tokens_thinking'
    | 'total_tokens_out'
    | 'total_cost_usd'
    | 'created_at'
    | 'updated_at'
  > &
    Partial<AgentRow>
): AgentRow {
  const isExecutor = partial.hierarchy_level >= 2;
  return {
    fallback_provider: isExecutor ? 'ollama' : 'vertex',
    fallback_model_id: isExecutor ? 'qwen2.5-coder:32b' : 'gemini-2.0-flash',
    step_routing_json: {
      planning: {
        provider: 'vertex',
        modelId: 'gemini-2.5-pro',
      },
      tool_loop: {
        provider: 'vertex',
        modelId: isExecutor ? 'gemini-2.0-flash' : 'gemini-2.5-pro',
      },
      compaction: {
        provider: 'ollama',
        modelId: 'qwen2.5-coder:32b',
      },
    },
    status: 'IDLE',
    health_status: 'HEALTHY',
    last_heartbeat_at: NOW_ISO,
    active_subagent_count: 0,
    max_run_duration_ms: 86_400_000,
    current_run_id: null,
    clocked_in_at: null,
    total_work_time_ms: 0,
    total_runs: 0,
    total_commits: 0,
    max_tokens_per_run: 1_000_000,
    today_tokens_used: 0,
    total_tokens_in: 0,
    total_tokens_cached: 0,
    total_tokens_thinking: 0,
    total_tokens_out: 0,
    total_cost_usd: 0,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
    ...partial,
  };
}

type SeedAgentPartial = Parameters<typeof makeSeedAgent>[0];

const ZERO_STATS = {
  total_work_time_ms: 0,
  total_runs: 0,
  total_commits: 0,
  today_tokens_used: 0,
  total_tokens_in: 0,
  total_tokens_cached: 0,
  total_tokens_thinking: 0,
  total_tokens_out: 0,
  total_cost_usd: 0,
};

const BASE = {
  model_provider: 'vertex',
  model_id: 'gemini-2.5-pro',
  permission_tier: 'standard_autonomous',
} as const;

/**
 * Generic, project-agnostic corporate hierarchy used when no private roster exists.
 * Project-scoped tech agents (`tech_lead|backend_dev|frontend_dev:<project>`) are generated
 * for each tech project in `projects.yaml`.
 */
function buildGenericSeedAgents(): SeedAgentPartial[] {
  const profile = getDeploymentProfile();
  const infraProject = profile.infraProject;
  const projects = profile.devScopedProjects;
  const leads = projects.map((p) => `@tech_lead:${p}`).join(', ');

  const roster: SeedAgentPartial[] = [
    // LEVEL -1: EXECUTIVE ROOT
    {
      ...BASE,
      ...ZERO_STATS,
      id: 'warden',
      slug: '@warden',
      name: 'Warden (CEO Office Chief of Staff)',
      department: 'executive',
      hierarchy_level: -1,
      parent_agent_id: null,
      project_scope: 'GLOBAL',
      max_subagents: 6,
      allowed_repos: ['*'],
      init_prompt: `You are WARDEN (@warden — Level -1 CEO Office Chief of Staff), the root executive router and right hand to the Founder/CEO.

ROLE & RESPONSIBILITIES:
1. Executive Routing & Compression: Maintain minimal low-level code context yourself. Route technical/product/infra directives to @cto, marketing/SEO/AEO initiatives to @cmo, and business/ops/finance items to C-Suite peers (@cbo, @chro, @coo, @cfo).
2. Direct-to-Agent (@agent) Bypass: When the CEO explicitly addresses @<agent>, route directly to that agent without intermediate compression.
3. High-Density Synthesis: Compress multi-agent reports into ultra-dense, decision-ready executive briefs highlighting shipped work, active blockers, and binary CEO decisions required.
4. Guardrails & Approvals: Create approval_gates whenever a Tier-2 production deployment, destructive cloud prune, or strategic pricing/GTM decision requires CEO sign-off.`,
    },

    // UNIT A: TECH & INFRASTRUCTURE
    {
      ...BASE,
      ...ZERO_STATS,
      id: 'cto',
      slug: '@cto',
      name: 'CTO (Head of Tech)',
      department: 'tech',
      hierarchy_level: 0,
      parent_agent_id: 'warden',
      project_scope: 'GLOBAL',
      max_subagents: 4,
      allowed_repos: ['*'],
      init_prompt: `You are CTO (@cto — Level 0 Head of Tech), reporting to @warden.

DIRECT REPORTS (LEVEL 1):
- @pm (Product Manager — owns inbox triage, P0/P1/P2 backlog in backlog_items, funnels, and GTM acceptance criteria)
- Project Tech Leads (${leads || '@tech_lead:<project>'})
- @infra_head (Head of Infrastructure — owns cloud infrastructure and deployments)

CORE RESPONSIBILITIES:
1. Cross-Project Technical Architecture: Own global architectural standards, cross-repo code reuse (code_chunks RAG), and final technical trade-off calls.
2. Chair Daily Standups: Poll @pm, every project @tech_lead, and @infra_head; resolve cross-team handshakes; synthesize the Daily Standup MoM in the sprints table; and trigger STANDUP_SIGN_OFF approval_gates.
3. Contract-First Discipline: Enforce that @tech_lead locks API/state contracts before @backend_dev and @frontend_dev execute in parallel Docker sandboxes.
4. Upward Compression: Deliver high-signal, low-word-count technical briefs to @warden.`,
    },
    {
      ...BASE,
      ...ZERO_STATS,
      id: 'pm',
      slug: '@pm',
      name: 'Lead Product Manager (Collated Backlog, Funnels & GTM)',
      department: 'tech',
      hierarchy_level: 1,
      parent_agent_id: 'cto',
      project_scope: 'GLOBAL',
      max_subagents: 2,
      allowed_repos: ['*'],
      init_prompt: `You are PM (@pm — Level 1 Lead Product Manager & Cross-Project Backlog Coordinator), reporting to @cto with upward escalation access to @warden and the CEO.

CORE RESPONSIBILITIES:
1. Collated Backlog: Ensure every project maintains its prioritized P0/P1/P2 backlog and @cto has a live Collated Master Backlog (worklist/COLLATED_BACKLOG.md & /api/backlog/collated).
2. Human / CEO Intervention Tasks (stage='NEEDS_CEO'): Ensure any task blocked on a CEO question (QUESTION), missing API key / secret (API_KEY), manual console/store action (MANUAL_ACTION), or strategic approval (DECISION) is flagged at the top of the backlog.
3. Weekly Standup Plan & Task Movements: Synthesize what is decided for the week and log all task movements (INBOX -> TODO -> IN_PROGRESS -> DONE, or * -> NEEDS_CEO) during standups.`,
    },
  ];

  for (const project of projects) {
    roster.push(
      {
        ...BASE,
        ...ZERO_STATS,
        id: `tech_lead:${project}`,
        slug: `@tech_lead:${project}`,
        name: `Tech Lead — ${project}`,
        department: 'tech',
        hierarchy_level: 1,
        parent_agent_id: 'cto',
        project_scope: project,
        max_subagents: 4,
        allowed_repos: [],
        init_prompt: `You are TECH LEAD FOR ${project.toUpperCase()} (@tech_lead:${project} — Level 1), reporting to @cto and managing @backend_dev:${project} and @frontend_dev:${project}.

CORE RESPONSIBILITIES:
1. Architecture & Context Integrity: Keep project_contexts for ${project} synchronized with shipped code.
2. Contract Lock: Lock API and state contracts before @backend_dev:${project} and @frontend_dev:${project} modify code in parallel.
3. QA Verification: Require typecheck, build, and headless Playwright verification before marking tasks DONE.`,
      },
      {
        ...BASE,
        ...ZERO_STATS,
        id: `backend_dev:${project}`,
        slug: `@backend_dev:${project}`,
        name: `Backend Developer — ${project}`,
        department: 'tech',
        hierarchy_level: 2,
        parent_agent_id: `tech_lead:${project}`,
        project_scope: project,
        max_subagents: 4,
        allowed_repos: [],
        init_prompt: `You are BACKEND DEVELOPER FOR ${project.toUpperCase()} (@backend_dev:${project} — Level 2), reporting to @tech_lead:${project}.

OPERATING RULES:
1. Read project_contexts for ${project} and your pinned agent_memories before touching any code.
2. Strictly adhere to locked contracts.
3. Run tests inside your ephemeral Docker sandbox and verify zero regressions before reporting completion to @tech_lead:${project}.`,
      },
      {
        ...BASE,
        ...ZERO_STATS,
        id: `frontend_dev:${project}`,
        slug: `@frontend_dev:${project}`,
        name: `Frontend Developer — ${project}`,
        department: 'tech',
        hierarchy_level: 2,
        parent_agent_id: `tech_lead:${project}`,
        project_scope: project,
        max_subagents: 4,
        allowed_repos: [],
        init_prompt: `You are FRONTEND DEVELOPER FOR ${project.toUpperCase()} (@frontend_dev:${project} — Level 2), reporting to @tech_lead:${project}.

OPERATING RULES:
1. Read project_contexts for ${project} plus your pinned agent_memories first.
2. Preserve frame budgets and avoid per-frame heap allocations in render loops.
3. Run tsc --noEmit, build, and headless Playwright verification in your Docker sandbox before completing a run.`,
      }
    );
  }

  roster.push(
    {
      ...BASE,
      ...ZERO_STATS,
      id: 'infra_head',
      slug: '@infra_head',
      name: 'Head of Infrastructure & Cloud FinOps',
      department: 'infra',
      hierarchy_level: 1,
      parent_agent_id: 'cto',
      project_scope: infraProject,
      permission_tier: 'strict_gate',
      max_subagents: 2,
      allowed_repos: [],
      init_prompt: `You are HEAD OF INFRASTRUCTURE (@infra_head — Level 1), reporting to @cto, collaborating laterally with @pm and project tech leads, and directing @infra_jr.

CORE RESPONSIBILITIES:
1. Multi-Cloud & FinOps Governance: Oversee cloud discovery, backups, pruning, and static/server deployments.
2. Strict Safety Guardrails: Require --dry-run before any destructive prune or DNS mutation, never automate bucket deletion, and require DEPLOY_PERMISSION approval_gates for production rollouts.`,
    },
    {
      ...BASE,
      ...ZERO_STATS,
      id: 'infra_jr',
      slug: '@infra_jr',
      name: 'Infrastructure & DevOps Engineer',
      department: 'infra',
      hierarchy_level: 2,
      parent_agent_id: 'infra_head',
      project_scope: infraProject,
      permission_tier: 'strict_gate',
      max_subagents: 2,
      allowed_repos: [],
      init_prompt: `You are INFRASTRUCTURE & DEVOPS ENGINEER (@infra_jr — Level 2), reporting to @infra_head.

STRICT RULES:
1. Paginate all cloud API calls and reuse shared client factories.
2. Default to --dry-run for any destructive prune or asset sync operation.
3. Execute deployments under @infra_head supervision.`,
    },

    // UNIT B: MARKETING
    {
      ...BASE,
      ...ZERO_STATS,
      id: 'cmo',
      slug: '@cmo',
      name: 'CMO (Chief Marketing & Growth Officer)',
      department: 'marketing',
      hierarchy_level: 0,
      parent_agent_id: 'warden',
      project_scope: 'GLOBAL',
      max_subagents: 4,
      allowed_repos: [],
      init_prompt: `You are CMO (@cmo — Level 0 Chief Marketing Officer), reporting to @warden.

DIRECT REPORTS:
- @seo_aeo_head (Level 1 Head of SEO & Answer Engine Optimization) -> @seo_content_dev, @aeo_analyst

CORE RESPONSIBILITIES:
1. Organic Distribution & Growth Strategy: Own top-of-funnel growth, brand positioning, store listing conversion, and organic acquisition across all products.
2. Search & AI Answer Engine Dominance: Direct @seo_aeo_head to capture citations across search engines and AI answer engines.
3. Cross-Unit Alignment: Partner with @cto and @pm on funnel telemetry and store rollout milestones.`,
    },
    {
      ...BASE,
      ...ZERO_STATS,
      id: 'seo_aeo_head',
      slug: '@seo_aeo_head',
      name: 'Head of SEO & AEO (Search & AI Answer Engine Optimization)',
      department: 'marketing',
      hierarchy_level: 1,
      parent_agent_id: 'cmo',
      project_scope: 'GLOBAL',
      max_subagents: 3,
      allowed_repos: [],
      init_prompt: `You are HEAD OF SEO & AEO (@seo_aeo_head — Level 1), reporting to @cmo, collaborating laterally with @pm and @infra_head, and managing @seo_content_dev and @aeo_analyst.

CORE RESPONSIBILITIES:
1. Technical SEO & AEO Architecture: Drive llms.txt, llms-full.txt, Schema.org JSON-LD, OpenGraph/Twitter cards, canonical tags, sitemap.xml, and AI crawler robots.txt policies.
2. Answer Engine Share-of-Voice: Coordinate @aeo_analyst to benchmark AI citations and @seo_content_dev to ship high-authority semantic landing content.`,
    },
    {
      ...BASE,
      ...ZERO_STATS,
      id: 'seo_content_dev',
      slug: '@seo_content_dev',
      name: 'Technical SEO & AEO Content Developer',
      department: 'marketing',
      hierarchy_level: 2,
      parent_agent_id: 'seo_aeo_head',
      project_scope: 'GLOBAL',
      max_subagents: 2,
      allowed_repos: [],
      init_prompt: `You are TECHNICAL SEO & AEO CONTENT DEVELOPER (@seo_content_dev — Level 2), reporting to @seo_aeo_head.

CORE RESPONSIBILITIES:
1. Implement public/llms.txt, public/llms-full.txt, public/robots.txt, public/sitemap.xml, and structured Schema.org JSON-LD inside landing page repositories.
2. Build semantic HTML sections, FAQ schemas, and fast-loading metadata optimized for both traditional search crawlers and LLM answer synthesis.`,
    },
    {
      ...BASE,
      ...ZERO_STATS,
      id: 'aeo_analyst',
      slug: '@aeo_analyst',
      name: 'AEO & SERP Citation Intelligence Analyst',
      department: 'marketing',
      hierarchy_level: 2,
      parent_agent_id: 'seo_aeo_head',
      project_scope: 'GLOBAL',
      max_subagents: 2,
      allowed_repos: [],
      init_prompt: `You are AEO & SERP CITATION INTELLIGENCE ANALYST (@aeo_analyst — Level 2), reporting to @seo_aeo_head.

CORE RESPONSIBILITIES:
1. Audit target discovery queries across Search and AI Answer Engines.
2. Identify citation gaps, structured data opportunities, and entity graph improvements, and file actionable specs with @seo_aeo_head and @pm.`,
    },

    // UNIT C: BUSINESS & OPERATIONS
    {
      ...BASE,
      ...ZERO_STATS,
      id: 'cbo',
      slug: '@cbo',
      name: 'CBO (Chief Business, Revenue & Opportunity-Cost Officer)',
      department: 'sales',
      permission_tier: 'strict_gate',
      hierarchy_level: 0,
      parent_agent_id: 'warden',
      project_scope: 'GLOBAL',
      max_subagents: 2,
      allowed_repos: [],
      init_prompt: `You are CBO (@cbo — Level 0 Chief Business Officer), reporting to @warden and collaborating laterally with @cto. You evaluate every project and task across 4 pillars: (1) Guaranteed Cashflow Anchors, (2) Competition & Grant Prize EV, (3) Direct Ad/Store Revenue, and (4) Opportunity Cost per CEO Hour.`,
    },
    {
      ...BASE,
      ...ZERO_STATS,
      id: 'chro',
      slug: '@chro',
      name: 'CHRO (Chief Workforce & Agent Studio Officer)',
      department: 'hr',
      hierarchy_level: 0,
      parent_agent_id: 'warden',
      project_scope: 'GLOBAL',
      max_subagents: 2,
      allowed_repos: [],
      init_prompt: `You are CHRO (@chro — Level 0 Chief Workforce & Agent Studio Officer), reporting to @warden. You audit AI employee productivity, token efficiency (avg tokens per commit), prompt quality, and design new specialized agent personas in the Dynamic Agent Studio.`,
    },
    {
      ...BASE,
      ...ZERO_STATS,
      id: 'coo',
      slug: '@coo',
      name: 'COO (Chief Operating & Player Support Officer)',
      department: 'ops',
      hierarchy_level: 0,
      parent_agent_id: 'warden',
      project_scope: 'GLOBAL',
      max_subagents: 2,
      allowed_repos: [],
      init_prompt: `You are COO (@coo — Level 0 Chief Operating Officer), reporting to @warden. You oversee live operations, uptime SLAs, player support triage, and daily operational health across all live products.`,
    },
    {
      ...BASE,
      ...ZERO_STATS,
      id: 'cfo',
      slug: '@cfo',
      name: 'CFO (Chief Financial & Cloud FinOps Officer)',
      department: 'finance',
      permission_tier: 'strict_gate',
      hierarchy_level: 0,
      parent_agent_id: 'warden',
      project_scope: 'GLOBAL',
      max_subagents: 2,
      allowed_repos: [],
      init_prompt: `You are CFO (@cfo — Level 0 Chief Financial Officer), reporting to @warden. You track cloud credit burn, infrastructure cost minimization, AI token unit economics (cost_usd per agent/sprint/feature), and revenue yield across all products.`,
    }
  );

  return roster;
}

/**
 * Seed roster. Loaded verbatim from `private-data/db/seed-agents.json` (an array of
 * `makeSeedAgent` partials) when present; otherwise the generic hierarchy above.
 */
const PRIVATE_SEED_AGENTS = loadPrivateJson<SeedAgentPartial[]>('db/seed-agents.json');

export const SEED_AGENTS: AgentRow[] = (
  Array.isArray(PRIVATE_SEED_AGENTS) && PRIVATE_SEED_AGENTS.length > 0 ? PRIVATE_SEED_AGENTS : buildGenericSeedAgents()
).map((partial) => makeSeedAgent(partial));

// ============================================================================
// Seed Multi-Provider Credentials Pool (`provider_credentials`)
// ============================================================================

export const SEED_PROVIDER_CREDENTIALS: ProviderCredentialRow[] = [
  {
    id: 'cred_vertex_gcp_credits_primary',
    provider: 'vertex',
    label: 'GCP Startup / GenAI Credit Pool #1 (Unlimited 1-Year)',
    api_key_encrypted: 'adc:gcp-service-account-primary',
    base_url: 'https://us-central1-aiplatform.googleapis.com/v1',
    remaining_budget_usd: 250000,
    rpm_limit: 600,
    tpm_limit: 4000000,
    priority_order: 1,
    is_active: true,
    cooldown_until: null,
    total_requests: 342,
    total_failures: 0,
    last_error: null,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
  },
  {
    id: 'cred_vertex_gcp_credits_secondary',
    provider: 'vertex',
    label: 'GCP Startup / GenAI Credit Pool #2 (Failover Region europe-west4)',
    api_key_encrypted: 'adc:gcp-service-account-secondary',
    base_url: 'https://europe-west4-aiplatform.googleapis.com/v1',
    remaining_budget_usd: 100000,
    rpm_limit: 600,
    tpm_limit: 4000000,
    priority_order: 2,
    is_active: true,
    cooldown_until: null,
    total_requests: 28,
    total_failures: 0,
    last_error: null,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
  },
  {
    id: 'cred_meta_muse_hackathon_token_1',
    provider: 'meta_muse',
    label: 'Meta Muse Spark Hackathon Credit Token #1 (Primary)',
    api_key_encrypted: 'env:META_MUSE_API_KEY_1',
    base_url: 'https://api.meta.ai/v1',
    remaining_budget_usd: 2500,
    rpm_limit: 120,
    tpm_limit: 1000000,
    priority_order: 1,
    is_active: true,
    cooldown_until: null,
    total_requests: 64,
    total_failures: 0,
    last_error: null,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
  },
  {
    id: 'cred_meta_muse_hackathon_token_2',
    provider: 'meta_muse',
    label: 'Meta Muse Spark Hackathon Credit Token #2 (Auto-Failover)',
    api_key_encrypted: 'env:META_MUSE_API_KEY_2',
    base_url: 'https://api.meta.ai/v1',
    remaining_budget_usd: 2500,
    rpm_limit: 120,
    tpm_limit: 1000000,
    priority_order: 2,
    is_active: true,
    cooldown_until: null,
    total_requests: 12,
    total_failures: 0,
    last_error: null,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
  },
  {
    id: 'cred_ollama_gcp_l4_local',
    provider: 'ollama',
    label: 'GCP L4 GPU Self-Hosted Ollama (qwen2.5-coder:32b / deepseek-r1:32b)',
    api_key_encrypted: 'internal:ollama-vpc-no-key',
    base_url: 'http://localhost:11434/v1',
    remaining_budget_usd: 999999,
    rpm_limit: 1000,
    tpm_limit: 10000000,
    priority_order: 1,
    is_active: true,
    cooldown_until: null,
    total_requests: 189,
    total_failures: 0,
    last_error: null,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
  },
  {
    id: 'cred_huggingface_vllm_gcp',
    provider: 'huggingface',
    label: 'GCP G2 vLLM / HuggingFace TGI Endpoint (Llama-3.3-70B / Qwen-2.5)',
    api_key_encrypted: 'env:HF_VLLM_API_KEY',
    base_url: 'http://localhost:8000/v1',
    remaining_budget_usd: 999999,
    rpm_limit: 500,
    tpm_limit: 5000000,
    priority_order: 1,
    is_active: true,
    cooldown_until: null,
    total_requests: 41,
    total_failures: 0,
    last_error: null,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
  },
  {
    id: 'cred_anthropic_vertex_partner',
    provider: 'anthropic',
    label: 'Anthropic Claude 4.6 (via GCP Vertex AI Partner Quota)',
    api_key_encrypted: 'adc:gcp-vertex-anthropic',
    base_url: 'https://us-east5-aiplatform.googleapis.com/v1',
    remaining_budget_usd: 50000,
    rpm_limit: 120,
    tpm_limit: 800000,
    priority_order: 1,
    is_active: true,
    cooldown_until: null,
    total_requests: 52,
    total_failures: 0,
    last_error: null,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
  },
  {
    id: 'cred_openai_compatible_slot',
    provider: 'openai',
    label: 'OpenAI / Compatible Custom Endpoint Slot',
    api_key_encrypted: 'env:OPENAI_API_KEY',
    base_url: 'https://api.openai.com/v1',
    remaining_budget_usd: 1000,
    rpm_limit: 200,
    tpm_limit: 1000000,
    priority_order: 1,
    is_active: true,
    cooldown_until: null,
    total_requests: 0,
    total_failures: 0,
    last_error: null,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
  },
];

// ============================================================================
// Seed Global Routing Profiles (`routing_profiles`)
// ============================================================================

export const SEED_ROUTING_PROFILES: RoutingProfileRow[] = [
  {
    id: 'GCP_ZERO_COST',
    name: 'GCP Zero-Cost Mode (100% GCP Credits + L4 GPU Ollama)',
    description:
      'Routes all C-Suite & Level 1 leads to Vertex AI Gemini 2.5 Pro, Level 2 coding loops to Gemini 2.5 Flash / Ollama Qwen-2.5-Coder-32B, and memory compaction to self-hosted Ollama.',
    is_active: true,
    config_json: {
      default_level0_provider: 'vertex',
      default_level0_model: 'gemini-2.5-pro',
      default_level1_provider: 'vertex',
      default_level1_model: 'gemini-2.5-pro',
      default_level2_provider: 'vertex',
      default_level2_model: 'gemini-2.0-flash',
      compaction_provider: 'ollama',
      compaction_model: 'qwen2.5-coder:32b',
    },
    updated_at: NOW_ISO,
  },
  {
    id: 'META_MUSE_HACKATHON',
    name: 'Meta Muse Hackathon Mode (Muse Spark + Llama-4 Maverick)',
    description:
      'Routes Level -1/0/1 planning & synthesis to Meta Muse Spark and Level 2 coding/tool loops to Llama-4-Maverick / Qwen-2.5-Coder with automatic token rotation and Vertex AI failover.',
    is_active: false,
    config_json: {
      default_level0_provider: 'meta_muse',
      default_level0_model: 'muse-spark-v1',
      default_level1_provider: 'meta_muse',
      default_level1_model: 'muse-spark-v1',
      default_level2_provider: 'meta_muse',
      default_level2_model: 'llama-4-maverick-17b-128e-instruct',
      compaction_provider: 'ollama',
      compaction_model: 'qwen2.5-coder:32b',
    },
    updated_at: NOW_ISO,
  },
  {
    id: 'CUSTOM_HYBRID',
    name: 'Custom Hybrid Per-Agent Matrix',
    description:
      'Respects each agent row custom model_provider, model_id, fallback_provider, and step_routing_json configured in the Dynamic Agent Studio.',
    is_active: false,
    config_json: {
      default_level0_provider: 'anthropic',
      default_level0_model: 'claude-opus-4-6',
      default_level1_provider: 'vertex',
      default_level1_model: 'gemini-2.5-pro',
      default_level2_provider: 'ollama',
      default_level2_model: 'qwen2.5-coder:32b',
      compaction_provider: 'ollama',
      compaction_model: 'qwen2.5-coder:32b',
    },
    updated_at: NOW_ISO,
  },
];
