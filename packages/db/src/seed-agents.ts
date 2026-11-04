// ============================================================================
// @warden/db — Corporate & Technical Agent Roster Seed Definitions
// ============================================================================

import type {
  AgentRow,
  ProviderCredentialRow,
  RoutingProfileRow,
} from './schema.ts';
import { getDeploymentProfile, loadPrivateJson } from './privateData.ts';
import { normalizeDepartment } from './schema.ts';

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
    | 'needs_review'
    | 'created_at'
    | 'updated_at'
  > &
    Partial<AgentRow>
): AgentRow {
  const isExecutor = partial.hierarchy_level >= 2;
  return {
    fallback_provider: isExecutor ? 'ollama' : 'meta_muse',
    fallback_model_id: isExecutor ? 'llama-3.3-70b' : 'muse-light',
    step_routing_json: {
      planning: {
        provider: 'meta_muse',
        modelId: 'muse-spark-1.3',
      },
      tool_loop: {
        provider: 'meta_muse',
        modelId: isExecutor ? 'muse-light' : 'muse-spark-1.3',
      },
      compaction: {
        provider: 'ollama',
        modelId: 'muse-glimmer-30b',
      },
    },
    status: 'IDLE',
    health_status: 'HEALTHY',
    last_heartbeat_at: NOW_ISO,
    active_subagent_count: 0,
    max_run_duration_ms: 1_800_000,
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
    needs_review: false,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
    ...partial,
    department: normalizeDepartment(partial.department),
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
  model_provider: 'meta_muse',
  model_id: 'muse-spark-1.3',
  permission_tier: 'standard_autonomous',
} as const;

/**
 * Generic, project-agnostic corporate hierarchy used when no private roster exists.
 * Ships a streamlined 7-agent core roster (`warden`, `cto`, `cmo`, `frontend_dev`,
 * `designer`, `seo_aeo_head`, `social_lead`) that can dynamically spawn additional
 * subagents via `ensureAgentBySlug`.
 */
function buildGenericSeedAgents(): SeedAgentPartial[] {
  const profile = getDeploymentProfile();
  const defaultProject = profile.devScopedProjects[0] || 'GLOBAL';

  const roster: SeedAgentPartial[] = [
    // 1. LEVEL -1: EXECUTIVE ROOT
    {
      ...BASE,
      ...ZERO_STATS,
      id: 'warden',
      slug: '@warden',
      name: 'Warden',
      department: 'executive',
      hierarchy_level: -1,
      parent_agent_id: null,
      project_scope: 'GLOBAL',
      permission_tier: 'full_overdrive',
      max_subagents: 6,
      allowed_repos: ['*'],
      init_prompt: `You are WARDEN (@warden — Level -1 CEO Office Chief of Staff & Root Router), the root executive router and right hand to the Founder/CEO.

ROLE & RESPONSIBILITIES:
1. Executive Routing & Compression: Maintain minimal low-level code context yourself. Route technical/gameplay/UI directives to @cto and marketing/SEO/AEO/social initiatives to @cmo.
2. Direct-to-Agent (@agent) Bypass: When the CEO explicitly addresses @<agent>, route directly to that agent without intermediate compression.
3. Plain Replies: Summarize multi-agent work for the CEO in a short, conversational message: what changed, what is blocked, and any decision needed, with clear directions to the right screen.
4. Guardrails & Approvals: Create approval_gates whenever a Tier-2 production deployment, destructive cloud prune, or strategic pricing/GTM decision requires CEO sign-off.`,
    },

    // 2. LEVEL 0: CTO (Head of Tech)
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
      permission_tier: 'full_overdrive',
      max_subagents: 6,
      allowed_repos: ['*'],
      init_prompt: `You are CTO (@cto — Level 0 Chief Technology Officer), reporting to @warden.

DIRECT REPORTS:
- @frontend_dev (Level 2 UI, Gameplay & Full-Stack Engineer)
- @designer (Level 2 Game Art, Sprites & UI Assets Specialist)

CORE RESPONSIBILITIES:
1. Technical Architecture & Execution: Own architecture, performance budgets, and quality verification across the codebase.
2. Chair Daily Standups: Coordinate sprint priorities, resolve technical trade-offs, and synthesize the Daily Standup MoM.
3. Upward Compression: Deliver high-signal, low-word-count technical briefs to @warden.`,
    },

    // 3. LEVEL 0: CMO (Growth & Brand)
    {
      ...BASE,
      ...ZERO_STATS,
      id: 'cmo',
      slug: '@cmo',
      name: 'CMO (Growth & Brand)',
      department: 'marketing',
      hierarchy_level: 0,
      parent_agent_id: 'warden',
      project_scope: 'marketing',
      max_subagents: 4,
      allowed_repos: ['*'],
      init_prompt: `You are CMO (@cmo — Level 0 Chief Marketing Officer), reporting to @warden.

DIRECT REPORTS:
- @seo_aeo_head (Level 1 Search & AI Answer Engine Optimization Lead)
- @social_lead (Level 1 Short-Form Clips, Launch Threads & Distribution)

CORE RESPONSIBILITIES:
1. Organic Distribution & Growth Strategy: Own top-of-funnel growth, brand positioning, and organic acquisition.
2. Search & AI Answer Engine Dominance: Direct @seo_aeo_head to capture citations across search engines and AI answer engines, and @social_lead to drive community distribution.`,
    },

    // 4. LEVEL 2: FRONTEND & GAME DEV
    {
      ...BASE,
      ...ZERO_STATS,
      id: 'frontend_dev',
      slug: '@frontend_dev',
      name: 'Frontend & Game Dev',
      department: 'tech',
      hierarchy_level: 2,
      parent_agent_id: 'cto',
      project_scope: defaultProject,
      max_subagents: 4,
      allowed_repos: ['*'],
      init_prompt: `You are FRONTEND & GAME DEV (@frontend_dev — Level 2 UI, Gameplay & Full-Stack Engineer), reporting to @cto.

OPERATING RULES:
1. Implement gameplay loops, HUD components, canvas/WebGL rendering, and full-stack features.
2. Preserve 60fps frame budgets and avoid per-frame heap allocations in render loops.
3. Verify zero console or build errors before completing a run.`,
    },

    // 5. LEVEL 2: CREATIVE & SPRITE DESIGNER
    {
      ...BASE,
      ...ZERO_STATS,
      id: 'designer',
      slug: '@designer',
      name: 'Creative & Sprite Designer',
      department: 'tech',
      hierarchy_level: 2,
      parent_agent_id: 'cto',
      project_scope: defaultProject,
      max_subagents: 2,
      allowed_repos: ['*'],
      init_prompt: `You are CREATIVE & SPRITE DESIGNER (@designer — Level 2 Game Art, Sprites & UI Assets Specialist), reporting to @cto.

OPERATING RULES:
1. Craft crisp SVG/Canvas sprites, arcade badges, neon color palettes, and UI visual polish.
2. Ensure assets are lightweight, responsive, and cohesive with the game's visual identity.`,
    },

    // 6. LEVEL 1: SEO & AEO LEAD
    {
      ...BASE,
      ...ZERO_STATS,
      id: 'seo_aeo_head',
      slug: '@seo_aeo_head',
      name: 'SEO & AEO Lead',
      department: 'marketing',
      hierarchy_level: 1,
      parent_agent_id: 'cmo',
      project_scope: 'marketing',
      max_subagents: 3,
      allowed_repos: ['*'],
      init_prompt: `You are SEO & AEO LEAD (@seo_aeo_head — Level 1 Search & AI Answer Engine Optimization Lead), reporting to @cmo.

CORE RESPONSIBILITIES:
1. Technical SEO & AEO Architecture: Drive llms.txt, Schema.org JSON-LD, OpenGraph/Twitter cards, canonical tags, sitemap.xml, and AI crawler robots.txt policies.
2. Answer Engine Share-of-Voice: Benchmark AI citations and ship high-authority semantic landing metadata.`,
    },

    // 7. LEVEL 1: SOCIAL & GROWTH LEAD
    {
      ...BASE,
      ...ZERO_STATS,
      id: 'social_lead',
      slug: '@social_lead',
      name: 'Social & Growth Lead',
      department: 'marketing',
      hierarchy_level: 1,
      parent_agent_id: 'cmo',
      project_scope: 'marketing',
      max_subagents: 3,
      allowed_repos: ['*'],
      init_prompt: `You are SOCIAL & GROWTH LEAD (@social_lead — Level 1 Short-Form Clips, Launch Threads & Distribution), reporting to @cmo.

CORE RESPONSIBILITIES:
1. Distribution Strategy: Own launch threads, short-form gameplay clip hooks, and community distribution across X, LinkedIn, and short-form video.
2. Community & Measurement: Grow and engage the audience with high-signal shipping updates and track conversion.`,
    },
  ];

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
    id: 'cred_meta_muse_primary',
    provider: 'meta_muse',
    label: 'Meta Muse Hackathon Grant #1 (Primary)',
    api_key_encrypted: 'env:META_MUSE_API_KEY',
    base_url: 'https://api.meta.ai/v1',
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
    id: 'cred_meta_muse_backup',
    provider: 'meta_muse',
    label: 'Meta Muse Hackathon Grant #2 (Failover Pool)',
    api_key_encrypted: 'env:META_MUSE_BACKUP_API_KEY',
    base_url: 'https://api.meta.ai/v1',
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
    id: 'cred_ollama_local_gpu',
    provider: 'ollama',
    label: 'Local GPU Self-Hosted Ollama (llama-3.3-70b / muse-glimmer-30b)',
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
    id: 'cred_huggingface_vllm_local',
    provider: 'huggingface',
    label: 'Local vLLM / HuggingFace TGI Endpoint (Llama-3.3-70B)',
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
    id: 'cred_meta_muse_architect_pool',
    provider: 'meta_muse',
    label: 'Meta Muse Wonder Architect Pool (Tier 1)',
    api_key_encrypted: 'env:META_MUSE_API_KEY',
    base_url: 'https://api.meta.ai/v1',
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
    id: 'cred_local_chat_slot',
    provider: 'huggingface',
    label: 'Local Chat-Completions Endpoint Slot',
    api_key_encrypted: 'internal:local-no-key',
    base_url: 'http://localhost:11434/v1',
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
    id: 'LOCAL_ZERO_COST',
    name: 'Local Zero-Cost Mode (100% Local Llama + Glimmer)',
    description:
      'Routes all C-Suite & Level 1 leads to local Llama 3.3 70B, Level 2 coding loops to local Llama, and memory compaction to self-hosted Ollama Glimmer.',
    is_active: false,
    config_json: {
      default_level0_provider: 'ollama',
      default_level0_model: 'llama-3.3-70b',
      default_level1_provider: 'ollama',
      default_level1_model: 'llama-3.3-70b',
      default_level2_provider: 'ollama',
      default_level2_model: 'llama-3.3-70b',
      compaction_provider: 'ollama',
      compaction_model: 'muse-glimmer-30b',
    },
    updated_at: NOW_ISO,
  },
  {
    id: 'META_MUSE_HACKATHON',
    name: 'Meta Muse Hackathon Mode (Muse Spark 1.3 + Muse Light)',
    description:
      'Routes Level -1/0/1 planning & synthesis to Meta Muse Spark 1.3 and Level 2 coding/tool loops to Muse Light with automatic token rotation and local Glimmer failover.',
    is_active: true,
    config_json: {
      default_level0_provider: 'meta_muse',
      default_level0_model: 'muse-spark-1.3',
      default_level1_provider: 'meta_muse',
      default_level1_model: 'muse-spark-1.3',
      default_level2_provider: 'meta_muse',
      default_level2_model: 'muse-light',
      compaction_provider: 'ollama',
      compaction_model: 'muse-glimmer-30b',
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
      default_level0_provider: 'meta_muse',
      default_level0_model: 'muse-spark-1.3',
      default_level1_provider: 'meta_muse',
      default_level1_model: 'muse-spark-1.3',
      default_level2_provider: 'meta_muse',
      default_level2_model: 'muse-light',
      compaction_provider: 'ollama',
      compaction_model: 'muse-glimmer-30b',
    },
    updated_at: NOW_ISO,
  },
];
