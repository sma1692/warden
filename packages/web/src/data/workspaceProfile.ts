// Workspace profile: the per-deployment project catalog, agent presets, and
// environment defaults used by the dashboard. Components derive their project
// lists, PM routing, and placeholder text from this file instead of hardcoding.
// Edit this file to describe your own projects; the values below are demo placeholders.
import type { DepartmentUnit, GateOption, ModelProvider } from '../types/commando';

export type ProjectKind = 'product' | 'infra' | 'marketing';

export interface ProjectCatalogEntry {
  slug: string;
  label: string;
  emoji: string;
  kind: ProjectKind;
  /** Owner agent for the project's backlog (PM, infra head, or marketing head). */
  pmSlug: string;
  /** Default executor agent for triaged INBOX items. */
  executorSlug: string;
  mdPath: string;
  lensLabel: string;
  description: string;
}

export const PROJECT_CATALOG: ProjectCatalogEntry[] = [
  {
    slug: 'demo-game',
    label: 'Demo Game',
    emoji: '🐉',
    kind: 'product',
    pmSlug: '@pm:demo-game',
    executorSlug: '@frontend_dev:demo-game',
    mdPath: 'worklist/demo-game/backlog.md',
    lensLabel: '🐉 Demo Game PM Backlog',
    description: 'Owned by @pm:demo-game — WebXR dungeon crawler, Quest 3 / web store GTM.',
  },
  {
    slug: 'arcade-hub',
    label: 'Arcade Hub',
    emoji: '🎮',
    kind: 'product',
    pmSlug: '@pm:arcade-hub',
    executorSlug: '@frontend_dev:arcade-hub',
    mdPath: 'worklist/arcade-hub/backlog.md',
    lensLabel: '🎮 Arcade Hub PM Backlog',
    description:
      'Owned by @pm:arcade-hub — 3D multiplayer platformer, viral ghost challenge & cosmetics.',
  },
  {
    slug: 'infra-ops',
    label: 'Infra (infra-ops)',
    emoji: '☁️',
    kind: 'infra',
    pmSlug: '@infra_head',
    executorSlug: '@infra_jr',
    mdPath: 'worklist/infra-ops/backlog.md',
    lensLabel: '☁️ Infra & Cloud Backlog',
    description:
      'Owned by @infra_head — AWS FinOps, cloud VM fleet, Cloudflare Pages & media assets.',
  },
  {
    slug: 'marketing',
    label: 'Marketing / AEO',
    emoji: '📈',
    kind: 'marketing',
    pmSlug: '@seo_aeo_head',
    executorSlug: '@seo_content_dev',
    mdPath: 'worklist/COLLATED_BACKLOG.md',
    lensLabel: '📈 Marketing / SEO & AEO',
    description:
      'Owned by @seo_aeo_head — Programmatic SEO pages & AI Engine Citation share-of-voice.',
  },
];

export const PRODUCT_PROJECTS = PROJECT_CATALOG.filter((p) => p.kind === 'product');
export const PRIMARY_PROJECT = PRODUCT_PROJECTS[0] ?? PROJECT_CATALOG[0];
export const INFRA_PROJECT = PROJECT_CATALOG.find((p) => p.kind === 'infra');

/** Project used when an approval gate spawns backlog items without a project scope. */
export const DEFAULT_GATE_PROJECT_SLUG = 'arcade-hub';

export const pmForProject = (slug: string): string =>
  PROJECT_CATALOG.find((p) => p.slug === slug)?.pmSlug ?? '@pm';

export const executorForProject = (slug: string): string =>
  PROJECT_CATALOG.find((p) => p.slug === slug)?.executorSlug ?? PRIMARY_PROJECT.executorSlug;

export const PROJECT_SCOPE_PLACEHOLDER = `${PRODUCT_PROJECTS.map((p) => p.slug).join(' / ')} / ALL`;

/** Example env key shown in the API_KEY intervention input. */
export const EXAMPLE_ENV_KEY = 'STORE_PUBLISH_API_KEY';

/** Example CEO weekly override note shown in the standup approval input. */
export const EXAMPLE_CEO_OVERRIDE_NOTE = "Move DG-05 ahead of DG-02; ship the web build before store submission";

/** Fallback thread id for the chat deep-link hint. */
export const EXAMPLE_THREAD_ID = 'thr_demo_game_loot';

/** Object-store prefix for chat media uploads. */
export const MEDIA_BUCKET_URI = 'media://demo-media-bucket';

/** Base URL for simulated preview deployments in offline/demo mode. */
export const PREVIEW_URL_EXAMPLE = 'https://preview.example.com';

export const DEFAULT_PROVIDER_ENDPOINTS: Record<ModelProvider, string> = {
  meta_muse: 'https://api.meta.ai/v1',
  ollama: 'http://localhost:11434/v1',
  huggingface: 'http://localhost:8000/v1',
};

/** Options proposed by the marketing watchdog when its queue empties (offline/demo mode). */
export const SEO_GROWTH_SPEC_OPTIONS: GateOption[] = [
  {
    id: 'opt_seo_1',
    label: '1. [P0] Interactive WebXR FPS Benchmark Matrix Page on demo-game.example.com',
    description: 'High-citation technical benchmark table targeted at Meta AI answers.',
    priority: 'P0',
  },
  {
    id: 'opt_seo_2',
    label: '2. [P1] Schema.org SoftwareApplication + VideoObject Structured Graph on arcade-hub',
    description: 'Boosts instant-play rich cards in mobile SERPs.',
    priority: 'P1',
  },
  {
    id: 'opt_seo_3',
    label: '3. [P1] Automated Weekly AI Citation Share-of-Voice Probe (50 Target Prompts)',
    description: 'Tracks Demo Game & Arcade Hub rank across Meta AI answers and Muse.',
    priority: 'P1',
  },
];

export interface AgentPresetTemplate {
  slug: string;
  name: string;
  role_title: string;
  department: DepartmentUnit;
  hierarchy_level: -1 | 0 | 1 | 2;
  parent_slug: string;
  /** Agent id preselected as parent in the create form (first template only). */
  parent_agent_id?: string;
  project_scope: string;
  model_provider: ModelProvider;
  model_id: string;
  fallback_provider: ModelProvider;
  fallback_model_id: string;
  allowed_repos: string[];
  init_prompt: string;
}

export const AGENT_PRESET_TEMPLATES: AgentPresetTemplate[] = [
  {
    slug: '@shader_artist:demo-game',
    name: 'Shader & VFX Artist (Demo Game)',
    role_title: 'Level 2 WebGL2 / GLSL & Particle VFX Engineer',
    department: 'TECH',
    hierarchy_level: 2,
    parent_slug: '@tech_lead:demo-game',
    parent_agent_id: 'agent_tech_lead_demo_game',
    project_scope: 'demo-game',
    model_provider: 'meta_muse',
    model_id: 'muse-spark-1.3',
    fallback_provider: 'meta_muse',
    fallback_model_id: 'muse-wonder-1.0',
    allowed_repos: ['demo-game-web'],
    init_prompt:
      'You are @shader_artist:demo-game reporting to @tech_lead:demo-game. Write zero-allocation custom GLSL shaders, KTX2 material pipelines, and 90Hz Quest 3 particle effects inside demo-game-web.',
  },
  {
    slug: '@growth_hacker:marketing',
    name: 'AEO & Multimodal Creative Synth',
    role_title: 'Level 2 Meta Muse Image/Voice & Citation Engineer',
    department: 'MARKETING',
    hierarchy_level: 2,
    parent_slug: '@seo_aeo_head',
    project_scope: 'marketing',
    model_provider: 'meta_muse',
    model_id: 'muse-wonder-1.0',
    fallback_provider: 'meta_muse',
    fallback_model_id: 'muse-wonder-1.0',
    allowed_repos: ['demo-game-landing', 'studio-landing'],
    init_prompt:
      'You are @growth_hacker:marketing reporting to @seo_aeo_head. Synthesize OpenGraph visuals via muse-image, audio narrations via muse-voice, and high-citation /llms.txt benchmarks.',
  },
  {
    slug: '@qa_lead',
    name: 'Autonomous QA & Chaos Lead',
    role_title: 'Level 1 Cross-Project Playwright & Load Test Lead',
    department: 'TECH',
    hierarchy_level: 1,
    parent_slug: '@cto',
    project_scope: 'ALL',
    model_provider: 'meta_muse',
    model_id: 'muse-wonder-1.0',
    fallback_provider: 'meta_muse',
    fallback_model_id: 'muse-wonder-1.0',
    allowed_repos: ['demo-game-web', 'demo-game-api', 'grid-duel', 'sky-runner'],
    init_prompt:
      'You are @qa_lead reporting to @cto. Run multi-client Colyseus stress tests and Headless Playwright WebGL regression suites across all active preview containers.',
  },
  {
    slug: '@cfo',
    name: 'CFO (FinOps & Unit Economics)',
    role_title: 'Level 0 Chief Financial Officer (Unit F)',
    department: 'PLANNED_CSUITE',
    hierarchy_level: 0,
    parent_slug: '@warden',
    project_scope: 'ALL',
    model_provider: 'meta_muse',
    model_id: 'muse-wonder-1.0',
    fallback_provider: 'meta_muse',
    fallback_model_id: 'muse-wonder-1.0',
    allowed_repos: ['infra-ops'],
    init_prompt:
      'You are @cfo reporting to @warden. Track cloud credit utilization, Meta Muse token pool burn, per-feature ROI, and multi-cloud cost guardrails.',
  },
];
