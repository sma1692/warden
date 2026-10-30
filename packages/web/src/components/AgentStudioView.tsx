import React, { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Copy,
  Cpu,
  Database,
  ExternalLink,
  FileCode,
  Flame,
  GitBranch,
  KeyRound,
  Megaphone,
  MessageSquare,
  Network,
  PlusCircle,
  Power,
  RotateCcw,
  Search,
  Shield,
  Sparkles,
  Terminal,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  PROVIDER_MODELS,
  type Agent,
  type AgentStepRouting,
  type DepartmentUnit,
  type ModelProvider,
  type PermissionTier,
  type ProjectContext,
  type ProviderCredential,
} from '../types/commando';
import {
  formatCompactTokens,
  formatModelBadge,
  formatUsd,
} from '../utils/formatters';
import {
  AGENT_PRESET_TEMPLATES,
  DEFAULT_PROVIDER_ENDPOINTS,
  INFRA_PROJECT,
  PROJECT_SCOPE_PLACEHOLDER,
} from '../data/workspaceProfile';
import { TokenBreakdownBar } from './TokenBreakdownBar';
import type { VerticalScope } from './ConsultationKnob';

export type AgentVertical = 'TECH' | 'SEO_AEO' | 'SOCIAL';

export interface EnrichedRosterAgent {
  agent: Agent;
  handle: string;
  vertical: AgentVertical;
  verticalLabel: 'Tech' | 'SEO/AEO' | 'Social Media';
  supervisorHandle: string;
  levelBadge: string;
  payloadTokens: number;
  turnCapLabel: string;
  contextReads: string[];
  forbiddenReads: string;
}

const CANONICAL_VERTICAL_ROSTER: {
  slug: string;
  name: string;
  role_title: string;
  vertical: AgentVertical;
  verticalLabel: 'Tech' | 'SEO/AEO' | 'Social Media';
  hierarchy_level: -1 | 0 | 1 | 2;
  levelBadge: string;
  supervisorHandle: string;
  model_provider: ModelProvider;
  model_id: string;
  status: Agent['status'];
  payloadTokens: number;
  turnCapLabel: string;
  contextReads: string[];
  forbiddenReads: string;
  active_task_title: string;
  active_git_branch: string;
  project_scope: string;
}[] = [
  // TECH VERTICAL (8 Agents)
  {
    slug: '@warden',
    name: 'Warden (Chief of Staff)',
    role_title: 'CEO Office Chief of Staff & Root Router',
    vertical: 'TECH',
    verticalLabel: 'Tech',
    hierarchy_level: -1,
    levelBadge: 'Root (L-1)',
    supervisorHandle: 'CEO (Founder)',
    model_provider: 'vertex',
    model_id: 'gemini-2.5-pro-argon-high',
    status: 'WORKING',
    payloadTokens: 920,
    turnCapLabel: '<= 1.5K tok/turn',
    contextReads: ['0 repo files (context/warden.md on-demand)'],
    forbiddenReads: 'topology-cache.json, worklist/*, source code',
    active_task_title: 'Orchestrating Tech, SEO/AEO & Social Media executive directives',
    active_git_branch: 'main',
    project_scope: 'ALL',
  },
  {
    slug: '@cto',
    name: 'CTO (Head of Tech)',
    role_title: 'Level 0 Chief Technology Officer',
    vertical: 'TECH',
    verticalLabel: 'Tech',
    hierarchy_level: 0,
    levelBadge: 'Level 0 (CXO)',
    supervisorHandle: '@warden',
    model_provider: 'vertex',
    model_id: 'gemini-2.5-pro',
    status: 'WORKING',
    payloadTokens: 1840,
    turnCapLabel: '<= 4.0K tok/turn',
    contextReads: ['context/cto.md', 'memory/cto.md'],
    forbiddenReads: 'topology-cache.json, raw worklist/*, source code',
    active_task_title: 'Co-designing pulse-core checkout sync & reviewing Phase 1.5 contracts',
    active_git_branch: 'feat/pulse-checkout-sync',
    project_scope: 'pulse-core, pulse-infra, pulse-support',
  },
  {
    slug: '@pm',
    name: 'Product Manager',
    role_title: 'Level 1 Cross-Project Backlog & Standup Lead',
    vertical: 'TECH',
    verticalLabel: 'Tech',
    hierarchy_level: 1,
    levelBadge: 'Level 1 (Lead)',
    supervisorHandle: '@cto',
    model_provider: 'vertex',
    model_id: 'gemini-2.0-flash',
    status: 'WORKING',
    payloadTokens: 1120,
    turnCapLabel: '<= 150w upward',
    contextReads: ['worklist/inbox.md', 'worklist/*/backlog.md', 'COLLATED_BACKLOG.md'],
    forbiddenReads: '.state/mirror/* source trees',
    active_task_title: 'Collating 12:00 PM IST standup & triaging [NEEDS_CEO] queue',
    active_git_branch: 'chore/standup-2026-10-26',
    project_scope: 'ALL',
  },
  {
    slug: '@tech_lead',
    name: 'Tech Lead',
    role_title: 'Level 1 Principal Architecture & Contract Lead',
    vertical: 'TECH',
    verticalLabel: 'Tech',
    hierarchy_level: 1,
    levelBadge: 'Level 1 (Lead)',
    supervisorHandle: '@cto',
    model_provider: 'vertex',
    model_id: 'gemini-2.5-pro',
    status: 'WAITING_FOR_CEO',
    payloadTokens: 1410,
    turnCapLabel: '<= 150w upward',
    contextReads: ['context/<proj>.md', 'memory/<proj>/tech_lead.md', 'contracts/*'],
    forbiddenReads: 'Unassigned project repos',
    active_task_title: 'Awaiting Phase 1.5 contract sign-off on pulse-core cart & Stripe webhook sync',
    active_git_branch: 'feat/pulse-contracts',
    project_scope: 'pulse-core,warden',
  },
  {
    slug: '@frontend_dev',
    name: 'Frontend Developer',
    role_title: 'Level 2 React / TypeScript / Storefront UI Engineer',
    vertical: 'TECH',
    verticalLabel: 'Tech',
    hierarchy_level: 2,
    levelBadge: 'Level 2 (Dev)',
    supervisorHandle: '@tech_lead',
    model_provider: 'meta_muse',
    model_id: 'muse-spark-1.3',
    status: 'WORKING',
    payloadTokens: 1290,
    turnCapLabel: '<= 200w upward',
    contextReads: ['context/warden/web.md', '.state/mirror/warden/packages/web'],
    forbiddenReads: 'Unassigned repos',
    active_task_title: 'Shipping NovaPulse Window Tabs & Responsive Dashboard Rehaul',
    active_git_branch: 'feat/dashboard-rehaul-v2',
    project_scope: 'warden,pulse-core',
  },
  {
    slug: '@backend_dev',
    name: 'Backend & Systems Developer',
    role_title: 'Level 2 Node / Postgres / High-Throughput API Engineer',
    vertical: 'TECH',
    verticalLabel: 'Tech',
    hierarchy_level: 2,
    levelBadge: 'Level 2 (Dev)',
    supervisorHandle: '@tech_lead',
    model_provider: 'meta_muse',
    model_id: 'muse-spark-1.3',
    status: 'WORKING',
    payloadTokens: 1180,
    turnCapLabel: '<= 200w upward',
    contextReads: ['context/pulse-core/pulse-api.md', '.state/mirror/pulse-api'],
    forbiddenReads: 'Unassigned repos',
    active_task_title: 'Optimizing sub-15ms Stripe webhook idempotency & checkout session state',
    active_git_branch: 'perf/webhook-sub15ms',
    project_scope: 'pulse-core,pulse-support',
  },
  {
    slug: '@infra_head',
    name: 'Infra & Cloud Head',
    role_title: 'Level 1 Multi-Cloud & Deployment Lead (pulse-infra)',
    vertical: 'TECH',
    verticalLabel: 'Tech',
    hierarchy_level: 1,
    levelBadge: 'Level 1 (Lead)',
    supervisorHandle: '@cto',
    model_provider: 'vertex',
    model_id: 'gemini-2.0-flash',
    status: 'IDLE',
    payloadTokens: 480,
    turnCapLabel: '<= 150w upward',
    contextReads: ['context/pulse-infra.md', 'memory/infra_head.md'],
    forbiddenReads: 'Application source trees',
    active_task_title: 'Monitoring Cloudflare Pages, GCS asset buckets & pm2 health',
    active_git_branch: 'main',
    project_scope: 'pulse-infra',
  },
  {
    slug: '@sec_lead',
    name: 'Security & VAPT Lead',
    role_title: 'Level 1 Out-of-Flow OWASP & Tenant Isolation Auditor',
    vertical: 'TECH',
    verticalLabel: 'Tech',
    hierarchy_level: 1,
    levelBadge: 'Level 1 (Lead)',
    supervisorHandle: '@cto',
    model_provider: 'anthropic',
    model_id: 'claude-sonnet-4-20250514',
    status: 'IDLE',
    payloadTokens: 410,
    turnCapLabel: '<= 150w upward',
    contextReads: ['context/sec.md', 'contracts/security-audit.md'],
    forbiddenReads: 'Production secrets',
    active_task_title: 'Auditing multi-tenant RBAC boundaries & Stripe webhook HMAC signatures',
    active_git_branch: 'sec/vapt-oct',
    project_scope: 'pulse-core,pulse-support',
  },

  // SEO/AEO VERTICAL (3 Agents)
  {
    slug: '@cbo',
    name: 'CBO (Chief Business Officer)',
    role_title: 'Level 0 Revenue, ARR Expansion & Organic Growth Head',
    vertical: 'SEO_AEO',
    verticalLabel: 'SEO/AEO',
    hierarchy_level: 0,
    levelBadge: 'Level 0 (CXO)',
    supervisorHandle: '@warden',
    model_provider: 'vertex',
    model_id: 'gemini-2.5-pro',
    status: 'WORKING',
    payloadTokens: 1150,
    turnCapLabel: '<= 4.0K tok/turn',
    contextReads: ['context/cbo.md', 'memory/cbo.md'],
    forbiddenReads: 'topology-cache.json, raw source trees',
    active_task_title: 'Ranking $1.8M ARR enterprise expansion EV & organic AEO funnel ROI',
    active_git_branch: 'main',
    project_scope: 'pulse-core,pulse-seo,pulse-social',
  },
  {
    slug: '@aeo_lead',
    name: 'SEO & AEO Lead',
    role_title: 'Level 1 Answer Engine & LLM Citation Strategist',
    vertical: 'SEO_AEO',
    verticalLabel: 'SEO/AEO',
    hierarchy_level: 1,
    levelBadge: 'Level 1 (Lead)',
    supervisorHandle: '@cbo',
    model_provider: 'openai',
    model_id: 'gpt-4.1',
    status: 'WAITING_FOR_CEO',
    payloadTokens: 890,
    turnCapLabel: '<= 150w upward',
    contextReads: ['context/aeo.md', 'memory/aeo_lead.md', 'contracts/aeo-schema.md'],
    forbiddenReads: 'Backend service repos',
    active_task_title: 'Awaiting CEO principle selection on Perplexity & ChatGPT citation graph',
    active_git_branch: 'feat/llms-txt-schema',
    project_scope: 'pulse-seo,pulse-core',
  },
  {
    slug: '@aeo_specialist',
    name: 'AEO & Schema Specialist',
    role_title: 'Level 2 Programmatic JSON-LD & Keyword Executor',
    vertical: 'SEO_AEO',
    verticalLabel: 'SEO/AEO',
    hierarchy_level: 2,
    levelBadge: 'Level 2 (Exec)',
    supervisorHandle: '@aeo_lead',
    model_provider: 'vertex',
    model_id: 'gemini-2.0-flash',
    status: 'WORKING',
    payloadTokens: 660,
    turnCapLabel: '<= 200w upward',
    contextReads: ['context/pulse-seo/seo.md', 'public/llms.txt', 'public/sitemap.xml'],
    forbiddenReads: 'Unassigned repos',
    active_task_title: 'Generating SoftwareApplication + FAQPage JSON-LD for NovaPulse landing pages',
    active_git_branch: 'feat/softwareapp-jsonld',
    project_scope: 'pulse-seo,pulse-core',
  },

  // SOCIAL MEDIA VERTICAL (2 Agents)
  {
    slug: '@social_lead',
    name: 'Social Media Growth Lead',
    role_title: 'Level 1 Multi-Channel Hook, Brand Voice & Viral Lead',
    vertical: 'SOCIAL',
    verticalLabel: 'Social Media',
    hierarchy_level: 1,
    levelBadge: 'Level 1 (Lead)',
    supervisorHandle: '@cbo',
    model_provider: 'meta_muse',
    model_id: 'muse-wonder-1.0',
    status: 'WAITING_FOR_CEO',
    payloadTokens: 1140,
    turnCapLabel: '<= 150w upward',
    contextReads: ['context/social.md', 'memory/social_lead.md', 'contracts/social-calendar.md'],
    forbiddenReads: 'Source code repos',
    active_task_title: 'Co-designing weekly X/LinkedIn founder voice & 15s product demo reel hooks',
    active_git_branch: 'content/w43-hooks',
    project_scope: 'pulse-social,pulse-core,novapulse',
  },
  {
    slug: '@social_creator',
    name: 'Social Content & Reel Creator',
    role_title: 'Level 2 Short-Form Video Script & Thread Producer',
    vertical: 'SOCIAL',
    verticalLabel: 'Social Media',
    hierarchy_level: 2,
    levelBadge: 'Level 2 (Exec)',
    supervisorHandle: '@social_lead',
    model_provider: 'meta_muse',
    model_id: 'muse-spark-1.3',
    status: 'WORKING',
    payloadTokens: 860,
    turnCapLabel: '<= 200w upward',
    contextReads: ['context/social/hooks.md', 'worklist/social/backlog.md'],
    forbiddenReads: 'Source code repos',
    active_task_title: 'Cutting 60FPS AI Checkout Flow & Zero-Click AEO demo clips for Reels/Shorts',
    active_git_branch: 'content/reels-batch-14',
    project_scope: 'pulse-social,pulse-seo',
  },
];

interface AgentStudioViewProps {
  agents: Agent[];
  projectContexts: ProjectContext[];
  credentials: ProviderCredential[];
  activeVertical?: VerticalScope;
  onCreateAgent: (payload: {
    slug: string;
    name: string;
    role_title: string;
    department: DepartmentUnit;
    hierarchy_level: -1 | 0 | 1 | 2;
    parent_agent_id: string | null;
    project_scope: string | null;
    model_provider: ModelProvider;
    model_id: string;
    fallback_provider?: ModelProvider;
    fallback_model_id?: string;
    step_routing?: AgentStepRouting;
    init_prompt: string;
    allowed_repos: string[];
    permission_tier: PermissionTier;
    max_subagents: number;
    max_run_duration_ms: number;
    max_tokens_per_run: number;
  }) => Promise<void>;
  onAddCredential: (payload: {
    provider: ModelProvider;
    label: string;
    api_key_raw: string;
    endpoint_url: string;
    remaining_budget_usd: number;
    rpm_limit: number;
    priority_order: number;
  }) => Promise<void>;
  onRotateCredentialFailover: (credentialId: string) => Promise<void>;
  onInspectAgent: (agent: Agent, subTab?: 'runs' | 'trace' | 'config') => void;
  onChatDirectWithAgent?: (agent: Agent) => void;
  onKillOrRestartAgent?: (agentId: string, action: 'KILL' | 'RESTART') => void;
  onOpenAgentWindowTab?: (agent: Agent) => void;
}

const PRESET_TEMPLATES = AGENT_PRESET_TEMPLATES;
const DEFAULT_ENDPOINTS = DEFAULT_PROVIDER_ENDPOINTS;
const FIRST_TEMPLATE = PRESET_TEMPLATES[0];


const getTierBadge = (modelId: string, modelProvider: string) => {
  const modelStr = modelId.toLowerCase();
  const title = `${modelProvider}:${modelId}`;
  if (modelStr.includes('pro') || modelStr.includes('opus') || modelStr.includes('wonder') || modelStr.includes('70b') || modelStr.includes('32b') || modelStr.includes('gpt-4')) {
    return <span title={title} className="cursor-help rounded bg-[var(--semantic-alert)]/15 border border-[var(--semantic-alert)]/40 text-[var(--semantic-alert)] px-2 py-0.5 text-[10px] font-bold">High</span>;
  }
  if (modelStr.includes('flash') || modelStr.includes('sonnet') || modelStr.includes('spark')) {
    return <span title={title} className="cursor-help rounded bg-[var(--semantic-warning)]/15 border border-[var(--semantic-warning)]/40 text-[var(--semantic-warning)] px-2 py-0.5 text-[10px] font-bold">Medium</span>;
  }
  return <span title={title} className="cursor-help rounded bg-[var(--semantic-success)]/15 border border-[var(--semantic-success)]/40 text-[var(--semantic-success)] px-2 py-0.5 text-[10px] font-bold">Low</span>;
};

export const AgentStudioView: React.FC<AgentStudioViewProps> = ({
  agents,
  projectContexts,
  credentials,
  activeVertical = 'ALL',
  onCreateAgent,
  onAddCredential,
  onRotateCredentialFailover,
  onInspectAgent,
  onChatDirectWithAgent,
  onKillOrRestartAgent,
  onOpenAgentWindowTab,
}) => {
  const [subView, setSubView] = useState<'roster' | 'studio'>('roster');
  const [localVertical, setLocalVertical] = useState<VerticalScope | null>(null);
  const [statusFilter, setStatusFilter] = useState<
    'ALL' | 'WORKING' | 'WAITING_FOR_CEO' | 'IDLE'
  >('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortCol, setSortCol] = useState<
    'agent' | 'level' | 'vertical' | 'status' | 'tokens'
  >('level');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const effectiveVertical: VerticalScope = localVertical ?? activeVertical;

  // Provisioner studio form state
  const [slug, setSlug] = useState(FIRST_TEMPLATE.slug);
  const [name, setName] = useState(FIRST_TEMPLATE.name.replace(/\s*\(.*\)$/, ''));
  const [roleTitle, setRoleTitle] = useState(FIRST_TEMPLATE.role_title);
  const [department, setDepartment] = useState<DepartmentUnit>(FIRST_TEMPLATE.department);
  const [hierarchyLevel, setHierarchyLevel] = useState<-1 | 0 | 1 | 2>(
    FIRST_TEMPLATE.hierarchy_level
  );
  const [parentAgentId, setParentAgentId] = useState<string>(
    FIRST_TEMPLATE.parent_agent_id ?? ''
  );
  const [projectScope, setProjectScope] = useState<string>(FIRST_TEMPLATE.project_scope);
  const [modelProvider, setModelProvider] = useState<ModelProvider>('meta_muse');
  const [modelId, setModelId] = useState('muse-spark-1.3');
  const [fallbackProvider, setFallbackProvider] = useState<ModelProvider>('vertex');
  const [fallbackModelId, setFallbackModelId] = useState('gemini-2.5-pro');
  const [planningModel, setPlanningModel] = useState('meta_muse:muse-wonder-1.0');
  const [toolLoopModel, setToolLoopModel] = useState('meta_muse:muse-spark-1.3');
  const [compactionModel, setCompactionModel] = useState('meta_muse:muse-glimmer-30b');
  const [permissionTier, setPermissionTier] = useState<PermissionTier>('full_overdrive');
  const [maxSubagents, setMaxSubagents] = useState(4);
  const [maxRunHours, setMaxRunHours] = useState(24);
  const [maxTokensPerRun, setMaxTokensPerRun] = useState(1_000_000);
  const [selectedRepos, setSelectedRepos] = useState<string[]>(
    FIRST_TEMPLATE.allowed_repos
  );
  const [initPrompt, setInitPrompt] = useState(PRESET_TEMPLATES[0].init_prompt);
  const [createdBanner, setCreatedBanner] = useState<string | null>(null);

  // Multi-Token Credit Pool form state
  const [showAddTokenForm, setShowAddTokenForm] = useState(false);
  const [credProvider, setCredProvider] = useState<ModelProvider>('meta_muse');
  const [credLabel, setCredLabel] = useState('Meta Muse Hackathon Token #3 (Burst Pool)');
  const [credApiKey, setCredApiKey] = useState('');
  const [credEndpoint, setCredEndpoint] = useState(DEFAULT_ENDPOINTS.meta_muse);
  const [credBudgetUsd, setCredBudgetUsd] = useState(500);
  const [credRpmLimit, setCredRpmLimit] = useState(240);
  const [credPriority, setCredPriority] = useState(1);

  // Build unified 13-agent multi-vertical roster + any custom provisioned agents
  const enrichedRoster: EnrichedRosterAgent[] = useMemo(() => {
    const canonicalList: EnrichedRosterAgent[] = CANONICAL_VERTICAL_ROSTER.map(
      (c, idx) => {
        const cleanHandle = c.slug.replace(/^@/, '');
        const matched = agents.find(
          (a) =>
            a.slug.replace(/^@/, '').toLowerCase() === cleanHandle.toLowerCase() ||
            (cleanHandle === 'tech_lead' && a.slug.includes('tech_lead')) ||
            (cleanHandle === 'pm' && a.slug.startsWith('@pm')) ||
            (cleanHandle === 'aeo_lead' && a.slug.includes('seo_aeo'))
        );

        const synthesizedAgent: Agent = matched
          ? {
              ...matched,
              slug: c.slug,
              name: c.name,
              role_title: c.role_title,
              hierarchy_level: c.hierarchy_level,
              status: c.status,
              active_task_title: c.active_task_title,
              active_git_branch: c.active_git_branch,
              project_scope: c.project_scope,
              today_tokens_used: c.payloadTokens,
            }
          : {
              id: `canonical_agent_${cleanHandle}_${idx}`,
              slug: c.slug,
              name: c.name,
              role_title: c.role_title,
              department:
                c.vertical === 'TECH'
                  ? 'TECH'
                  : c.vertical === 'SEO_AEO'
                    ? 'MARKETING'
                    : 'MARKETING',
              unit_label: `${c.verticalLabel} Vertical`,
              hierarchy_level: c.hierarchy_level,
              parent_agent_id: null,
              project_scope: c.project_scope,
              model_provider: c.model_provider,
              model_id: c.model_id,
              init_prompt: `You are ${c.slug} (${c.role_title}). Strictly enforce the Commando token firewall.`,
              allowed_repos: c.project_scope.split(','),
              permission_tier: 'full_overdrive',
              status: c.status,
              health_status: 'HEALTHY',
              last_heartbeat_at: new Date().toISOString(),
              max_subagents: 4,
              active_subagent_count: c.status === 'WORKING' ? 2 : 0,
              max_run_duration_ms: 86_400_000,
              current_run_id: `run_${cleanHandle}_01`,
              clocked_in_at: new Date(Date.now() - 1800_000).toISOString(),
              active_git_branch: c.active_git_branch,
              active_task_title: c.active_task_title,
              today_work_time_ms: 5_400_000,
              total_work_time_ms: 48_000_000,
              total_runs: 18,
              total_commits: 9,
              max_tokens_per_run: 100_000,
              today_tokens_used: c.payloadTokens,
              total_tokens_in: Math.round(c.payloadTokens * 0.45),
              total_tokens_cached: Math.round(c.payloadTokens * 0.25),
              total_tokens_thinking: Math.round(c.payloadTokens * 0.15),
              total_tokens_out: Math.round(c.payloadTokens * 0.15),
              total_cost_usd: Number((c.payloadTokens * 0.000002).toFixed(4)),
            };

        return {
          agent: synthesizedAgent,
          handle: c.slug.replace(/^@/, ''),
          vertical: c.vertical,
          verticalLabel: c.verticalLabel,
          supervisorHandle: c.supervisorHandle,
          levelBadge: c.levelBadge,
          payloadTokens: c.payloadTokens,
          turnCapLabel: c.turnCapLabel,
          contextReads: c.contextReads,
          forbiddenReads: c.forbiddenReads,
        };
      }
    );

    return canonicalList;
  }, [agents]);

  const filteredRoster = useMemo(() => {
    const filtered = enrichedRoster.filter((item) => {
      if (effectiveVertical !== 'ALL' && item.vertical !== effectiveVertical) {
        return false;
      }
      if (statusFilter !== 'ALL' && item.agent.status !== statusFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchHandle = item.agent.slug.toLowerCase().includes(q);
        const matchRole = item.agent.role_title.toLowerCase().includes(q);
        const matchTask = (item.agent.active_task_title || '').toLowerCase().includes(q);
        const matchReads = item.contextReads.some((r) => r.toLowerCase().includes(q));
        if (!matchHandle && !matchRole && !matchTask && !matchReads) return false;
      }
      return true;
    });

    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortCol === 'agent') {
        cmp = a.handle.localeCompare(b.handle);
      } else if (sortCol === 'level') {
        cmp = a.agent.hierarchy_level - b.agent.hierarchy_level;
      } else if (sortCol === 'vertical') {
        cmp = a.verticalLabel.localeCompare(b.verticalLabel);
      } else if (sortCol === 'status') {
        const order: Record<string, number> = {
          WORKING: 3,
          WAITING_FOR_CEO: 2,
          IDLE: 1,
        };
        cmp = (order[a.agent.status] || 0) - (order[b.agent.status] || 0);
      } else if (sortCol === 'tokens') {
        cmp = a.payloadTokens - b.payloadTokens;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [enrichedRoster, effectiveVertical, statusFilter, searchQuery, sortCol, sortDir]);

  const toggleSort = (col: typeof sortCol) => {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir(col === 'tokens' || col === 'status' ? 'desc' : 'asc');
    }
  };

  const getVerticalBadge = (v: AgentVertical, label: string) => {
    if (v === 'TECH') {
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-[var(--surface-accent-gold)]/15 border border-[var(--surface-accent-gold)]/30 px-2 py-0.5 text-[10px] font-mono font-semibold text-[var(--surface-accent-gold)]">
          <Cpu className="h-3 w-3 text-[var(--surface-accent-gold)]" />
          <span>{label}</span>
        </span>
      );
    }
    if (v === 'SEO_AEO') {
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-[var(--surface-accent)]/15 border border-[var(--surface-accent)]/30 px-2 py-0.5 text-[10px] font-mono font-semibold text-[var(--surface-accent)]">
          <Search className="h-3 w-3 text-[var(--surface-accent)]" />
          <span>{label}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-[var(--surface-elevated)] border border-[var(--surface-border-strong)] px-2 py-0.5 text-[10px] font-mono font-semibold text-[var(--surface-text)]">
        <Megaphone className="h-3 w-3 text-[var(--surface-text-secondary)]" />
        <span>{label}</span>
      </span>
    );
  };

  const renderStatusPill = (status: Agent['status']) => {
    if (status === 'WORKING') {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--semantic-success)]/15 border border-[var(--semantic-success)]/40 px-2.5 py-0.5 text-[10px] font-mono font-bold text-[var(--semantic-success)]">
          <span className="h-2 w-2 rounded-full bg-[var(--semantic-success)] animate-ping" />
          <span>WORKING</span>
        </span>
      );
    }
    if (status === 'WAITING_FOR_CEO') {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--semantic-warning)]/15 border border-[var(--semantic-warning)]/40 px-2.5 py-0.5 text-[10px] font-mono font-bold text-[var(--semantic-warning)]">
          <span className="h-2 w-2 rounded-full bg-[var(--semantic-warning)] animate-pulse" />
          <span>NEEDS_CEO</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-muted)] border border-[var(--surface-border)] px-2.5 py-0.5 text-[10px] font-mono text-[var(--surface-text-secondary)]">
        <span>⚪ IDLE</span>
      </span>
    );
  };

  const handleLoadTemplate = (tpl: (typeof PRESET_TEMPLATES)[number]) => {
    setSlug(tpl.slug);
    setName(tpl.name);
    setRoleTitle(tpl.role_title);
    setDepartment(tpl.department);
    setHierarchyLevel(tpl.hierarchy_level);
    const parent = agents.find((a) => a.slug === tpl.parent_slug);
    if (parent) setParentAgentId(parent.id);
    setProjectScope(tpl.project_scope);
    setModelProvider(tpl.model_provider);
    setModelId(tpl.model_id);
    setFallbackProvider(tpl.fallback_provider);
    setFallbackModelId(tpl.fallback_model_id);
    setPlanningModel(`${tpl.model_provider}:${tpl.model_id}`);
    setToolLoopModel(
      tpl.model_provider === 'meta_muse'
        ? 'meta_muse:muse-spark-1.3'
        : 'vertex:gemini-2.0-flash'
    );
    setCompactionModel(
      tpl.model_provider === 'meta_muse'
        ? 'meta_muse:muse-glimmer-30b'
        : 'ollama:qwen2.5-coder:32b'
    );
    setSelectedRepos(tpl.allowed_repos);
    setInitPrompt(tpl.init_prompt);
  };

  const handleCloneExisting = (agent: Agent) => {
    setSlug(`${agent.slug}_v2`);
    setName(`${agent.name} II`);
    setRoleTitle(agent.role_title);
    setDepartment(agent.department);
    setHierarchyLevel(agent.hierarchy_level);
    setParentAgentId(agent.parent_agent_id || 'agent_warden');
    setProjectScope(agent.project_scope || 'ALL');
    setModelProvider(agent.model_provider);
    setModelId(agent.model_id);
    setFallbackProvider(agent.fallback_provider || 'vertex');
    setFallbackModelId(agent.fallback_model_id || 'gemini-2.5-pro');
    setSelectedRepos(agent.allowed_repos);
    setInitPrompt(agent.init_prompt);
    setSubView('studio');
  };

  const toggleRepo = (repoSlug: string) => {
    setSelectedRepos((prev) =>
      prev.includes(repoSlug)
        ? prev.filter((r) => r !== repoSlug)
        : [...prev, repoSlug]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slug.trim() || !name.trim()) return;
    await onCreateAgent({
      slug: slug.trim(),
      name: name.trim(),
      role_title: roleTitle.trim(),
      department,
      hierarchy_level: hierarchyLevel,
      parent_agent_id: parentAgentId || null,
      project_scope: projectScope || 'ALL',
      model_provider: modelProvider,
      model_id: modelId,
      fallback_provider: fallbackProvider,
      fallback_model_id: fallbackModelId,
      step_routing: {
        planning_model: planningModel,
        tool_loop_model: toolLoopModel,
        compaction_model: compactionModel,
      },
      init_prompt: initPrompt,
      allowed_repos: selectedRepos,
      permission_tier: permissionTier,
      max_subagents: maxSubagents,
      max_run_duration_ms: maxRunHours * 3_600_000,
      max_tokens_per_run: maxTokensPerRun,
    });
    setCreatedBanner(
      `Provisioned ${slug} into PostgreSQL agents table & synced .claude/agents/ markdown!`
    );
    window.setTimeout(() => setCreatedBanner(null), 3500);
  };

  const handleAddCredentialSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!credLabel.trim()) return;
    await onAddCredential({
      provider: credProvider,
      label: credLabel.trim(),
      api_key_raw: credApiKey.trim() || `${credProvider}_live_${Date.now()}`,
      endpoint_url: credEndpoint.trim() || DEFAULT_ENDPOINTS[credProvider],
      remaining_budget_usd: Number(credBudgetUsd) || 100,
      rpm_limit: Number(credRpmLimit) || 200,
      priority_order: Number(credPriority) || 1,
    });
    setCredApiKey('');
    setShowAddTokenForm(false);
  };

  const totalNetTokens = useMemo(
    () => filteredRoster.reduce((acc, r) => acc + r.payloadTokens, 0),
    [filteredRoster]
  );

  return (
    <div className="space-y-4">
      {/* 1. Top Header, Vertical Filter & Sub-View Switcher */}
      <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-panel)] p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold-500/15 border border-gold-500/40 text-gold-300">
              <Users className="h-5 w-5 text-gold-400" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base sm:text-lg font-bold text-[var(--surface-text)]">
                  AI Workforce Roster &amp; Hierarchy Studio
                </h1>
                <span className="rounded-full bg-gold-500/20 border border-gold-500/40 px-2.5 py-0.5 text-[10px] font-mono font-bold text-gold-200">
                  {filteredRoster.length} Agents ({formatCompactTokens(totalNetTokens)} Net Payload)
                </span>
              </div>
              <p className="text-xs text-[var(--surface-text-secondary)] mt-0.5">
                All 3 Enterprise Verticals (<strong className="text-[var(--surface-accent-gold)]">Tech</strong>,{' '}
                <strong className="text-[var(--surface-accent)]">SEO/AEO</strong>,{' '}
                <strong className="text-[var(--surface-text)]">Social Media</strong>) with strict Bottom-Heavy Token Firewall enforcement.
              </p>
            </div>
          </div>

          {/* Sub-View Switcher: Workforce Roster Table vs Blueprint & Provisioner Studio */}
          <div className="flex items-center gap-1.5 rounded-xl bg-[var(--surface-card)] p-1 border border-[var(--surface-border)] self-start lg:self-center">
            <button
              type="button"
              onClick={() => setSubView('roster')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                subView === 'roster'
                  ? 'bg-gold-500/20 text-gold-200 border border-gold-500/40 shadow-sm'
                  : 'text-[var(--surface-text-secondary)] hover:text-[var(--surface-text)] border border-transparent'
              }`}
            >
              <Users className="h-3.5 w-3.5" />
              <span>Agents Table &amp; Cards ({filteredRoster.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setSubView('studio')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                subView === 'studio'
                  ? 'bg-[var(--surface-accent)]/15 text-[var(--surface-accent)] border border-[var(--surface-accent)]/40 shadow-sm'
                  : 'text-[var(--surface-text-secondary)] hover:text-[var(--surface-text)] border border-transparent'
              }`}
            >
              <UserPlus className="h-3.5 w-3.5" />
              <span>Blueprint &amp; Token Studio</span>
            </button>
          </div>
        </div>

        {/* Search, Vertical Filter Pills, and Status Filter */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-3 border-t border-[var(--surface-border)]">
          {/* Search Input */}
          <div className="relative flex-1 max-w-md">
            <Search className="h-4 w-4 text-[var(--surface-text-secondary)] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search @agent, role, context file, or current task..."
              className="w-full rounded-xl bg-[var(--surface-card)] border border-[var(--surface-border)] pl-9 pr-3 py-2 text-xs text-[var(--surface-text)] placeholder:text-[var(--surface-text-secondary)]/60 focus:outline-none focus:border-gold-500/60"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Vertical Filter Pills */}
            <div className="flex items-center gap-1 rounded-xl bg-[var(--surface-card)] p-1 border border-[var(--surface-border)] text-xs">
              {(
                [
                  { id: 'ALL' as const, label: 'All (13)' },
                  { id: 'TECH' as const, label: 'Tech (8)' },
                  { id: 'SEO_AEO' as const, label: 'SEO/AEO (3)' },
                  { id: 'SOCIAL' as const, label: 'Social (2)' },
                ] as const
              ).map((vf) => {
                const isSelected = effectiveVertical === vf.id;
                return (
                  <button
                    key={vf.id}
                    type="button"
                    onClick={() => setLocalVertical(vf.id)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
                      isSelected
                        ? 'bg-gold-500/20 text-gold-200 border border-gold-500/40 font-semibold'
                        : 'text-[var(--surface-text-secondary)] hover:text-[var(--surface-text)]'
                    }`}
                  >
                    {vf.label}
                  </button>
                );
              })}
            </div>

            {/* Status Filter Pills */}
            <div className="flex items-center gap-1 rounded-xl bg-[var(--surface-card)] p-1 border border-[var(--surface-border)] text-xs">
              {(
                [
                  { id: 'ALL' as const, label: 'All Status' },
                  { id: 'WORKING' as const, label: '🟢 Working' },
                  { id: 'WAITING_FOR_CEO' as const, label: '🟡 Needs CEO' },
                  { id: 'IDLE' as const, label: '⚪ Idle' },
                ] as const
              ).map((sf) => (
                <button
                  key={sf.id}
                  type="button"
                  onClick={() => setStatusFilter(sf.id)}
                  className={`rounded-lg px-2 py-1 text-[11px] font-medium transition cursor-pointer ${
                    statusFilter === sf.id
                      ? 'bg-[var(--surface-muted)] text-[var(--surface-text)] font-semibold border border-[var(--surface-border)]'
                      : 'text-[var(--surface-text-secondary)] hover:text-[var(--surface-text)]'
                  }`}
                >
                  {sf.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 2. PRIMARY VIEW: AGENTS ROSTER (PC TABULAR VIEW + MOBILE CARD VIEW) */}
      {subView === 'roster' && (
        <>
          {/* MOBILE CARD VIEW (`md:hidden`) */}
          <div className="md:hidden grid grid-cols-1 gap-3">
            {filteredRoster.map((row) => (
              <div
                key={row.agent.id}
                onClick={() => {
                  onOpenAgentWindowTab?.(row.agent);
                  onInspectAgent(row.agent, 'runs');
                }}
                className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-panel)] p-4 space-y-3 shadow-sm active:scale-[0.99] transition cursor-pointer"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-black text-gold-400">
                        {row.agent.slug}
                      </span>
                      <span className="rounded bg-[var(--surface-muted)] border border-[var(--surface-border)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--surface-text-secondary)]">
                        {row.levelBadge}
                      </span>
                      {getVerticalBadge(row.vertical, row.verticalLabel)}
                    </div>
                    <div className="text-xs font-semibold text-[var(--surface-text)] mt-1">
                      {row.agent.role_title}
                    </div>
                    <div className="text-[11px] font-mono text-[var(--surface-text-secondary)] mt-0.5">
                      Supervisor: <strong className="text-[var(--surface-text)]">{row.supervisorHandle}</strong> •{' '}
                      {getTierBadge(row.agent.model_id, row.agent.model_provider)}
                    </div>
                  </div>
                  {renderStatusPill(row.agent.status)}
                </div>

                {/* Current Task */}
                <div className="rounded-xl bg-[var(--surface-card)] border border-[var(--surface-border)] p-2.5 text-xs text-[var(--surface-text)]">
                  <div className="text-[10px] font-mono text-[var(--surface-text-secondary)] uppercase mb-0.5">
                    Current Task
                  </div>
                  <div className="font-medium leading-snug">
                    {row.agent.active_task_title}
                  </div>
                </div>

                {/* Token Burn & Context Firewall Reads */}
                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                  <div className="rounded-xl bg-[var(--surface-card)] border border-[var(--surface-border)] p-2">
                    <span className="text-[var(--surface-text-secondary)] block text-[10px]">Payload Burn</span>
                    <span className="text-[var(--surface-accent-gold)] font-bold text-sm">
                      {formatCompactTokens(row.payloadTokens)} tok
                    </span>
                    <span className="text-[var(--semantic-success)] block text-[10px]">
                      {row.turnCapLabel}
                    </span>
                  </div>
                  <div className="rounded-xl bg-[var(--surface-card)] border border-[var(--surface-border)] p-2">
                    <span className="text-[var(--surface-text-secondary)] block text-[10px]">Context Reads</span>
                    <span className="text-gold-400 text-[10px] line-clamp-2">
                      {row.contextReads.join(', ')}
                    </span>
                  </div>
                </div>

                <div
                  className="flex items-center justify-between gap-2 pt-2 border-t border-[var(--surface-border)]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => onInspectAgent(row.agent, 'config')}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-gold-500/15 border border-gold-500/40 py-1.5 text-xs font-semibold text-gold-200"
                  >
                    <Terminal className="h-3.5 w-3.5" />
                    <span>Inspect Brain &amp; Trace</span>
                  </button>
                  {onChatDirectWithAgent && (
                    <button
                      type="button"
                      onClick={() => onChatDirectWithAgent(row.agent)}
                      className="inline-flex items-center justify-center gap-1 rounded-xl bg-[var(--surface-muted)] border border-[var(--surface-border)] px-3 py-1.5 text-xs font-medium text-[var(--surface-text)]"
                    >
                      <MessageSquare className="h-3.5 w-3.5 text-gold-400" />
                      <span>Chat</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* PC HIGH-DENSITY TABULAR VIEW (`hidden md:block`) */}
          <div className="hidden md:block overflow-hidden rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-panel)] shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[var(--surface-border)] bg-[var(--surface-card)] text-[var(--surface-text-secondary)] font-mono text-[11px]">
                    <th
                      onClick={() => toggleSort('agent')}
                      className="py-3.5 px-4 cursor-pointer hover:text-gold-400 select-none"
                    >
                      <div className="flex items-center gap-1">
                        <span>Agent</span>
                        {sortCol === 'agent' ? (
                          sortDir === 'asc' ? (
                            <ArrowUp className="h-3 w-3 text-gold-400" />
                          ) : (
                            <ArrowDown className="h-3 w-3 text-gold-400" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-40" />
                        )}
                      </div>
                    </th>
                    <th
                      onClick={() => toggleSort('level')}
                      className="py-3.5 px-3 cursor-pointer hover:text-gold-400 select-none"
                    >
                      <div className="flex items-center gap-1">
                        <span>Level &amp; Supervisor</span>
                        {sortCol === 'level' ? (
                          sortDir === 'asc' ? (
                            <ArrowUp className="h-3 w-3 text-gold-400" />
                          ) : (
                            <ArrowDown className="h-3 w-3 text-gold-400" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-40" />
                        )}
                      </div>
                    </th>
                    <th
                      onClick={() => toggleSort('vertical')}
                      className="py-3.5 px-3 cursor-pointer hover:text-gold-400 select-none"
                    >
                      <div className="flex items-center gap-1">
                        <span>Vertical</span>
                        {sortCol === 'vertical' ? (
                          sortDir === 'asc' ? (
                            <ArrowUp className="h-3 w-3 text-gold-400" />
                          ) : (
                            <ArrowDown className="h-3 w-3 text-gold-400" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-40" />
                        )}
                      </div>
                    </th>
                    <th className="py-3.5 px-3">Model</th>
                    <th
                      onClick={() => toggleSort('status')}
                      className="py-3.5 px-3 cursor-pointer hover:text-gold-400 select-none"
                    >
                      <div className="flex items-center gap-1">
                        <span>Status</span>
                        {sortCol === 'status' ? (
                          sortDir === 'asc' ? (
                            <ArrowUp className="h-3 w-3 text-gold-400" />
                          ) : (
                            <ArrowDown className="h-3 w-3 text-gold-400" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-40" />
                        )}
                      </div>
                    </th>
                    <th className="py-3.5 px-3 cursor-pointer hover:text-gold-400 select-none" onClick={() => toggleSort('tokens')}>
                      <div className="flex items-center gap-1">
                        <span>Total Payload</span>
                        {sortCol === 'tokens' ? (
                          sortDir === 'asc' ? <ArrowUp className="h-3 w-3 text-gold-400" /> : <ArrowDown className="h-3 w-3 text-gold-400" />
                        ) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                      </div>
                    </th>
                    <th className="py-3.5 px-3">Input</th>
                    <th className="py-3.5 px-3">Output</th>
                    <th className="py-3.5 px-3">Thinking</th>
                    <th className="py-3.5 px-3">Tool IO</th>
                    <th className="py-3.5 px-3">Cache</th>
                    <th className="py-3.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--surface-border)]">
                  {filteredRoster.map((row) => (
                    <tr
                      key={row.agent.id}
                      onClick={() => {
                        onOpenAgentWindowTab?.(row.agent);
                        onInspectAgent(row.agent, 'runs');
                      }}
                      className="group hover:bg-[var(--surface-muted)]/50 transition cursor-pointer"
                    >
                      {/* Col 1: Agent */}
                      <td className="py-3 px-4">
                        <div className="font-mono text-xs font-bold text-gold-400 group-hover:underline">
                          {row.agent.slug}
                        </div>
                        <div className="text-[11px] font-medium text-[var(--surface-text)] mt-0.5">
                          {row.agent.role_title}
                        </div>
                      </td>

                      {/* Col 2: Level & Supervisor */}
                      <td className="py-3 px-3 font-mono">
                        <span className="rounded bg-[var(--surface-muted)] border border-[var(--surface-border)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--surface-text)]">
                          {row.levelBadge}
                        </span>
                        <div className="text-[10px] text-[var(--surface-text-secondary)] mt-1">
                          ↳ {row.supervisorHandle}
                        </div>
                      </td>

                      {/* Col 3: Vertical */}
                      <td className="py-3 px-3">
                        {getVerticalBadge(row.vertical, row.verticalLabel)}
                      </td>

                      {/* Col 4: Model */}
                      <td className="py-3 px-3 font-mono">
                        {getTierBadge(row.agent.model_id, row.agent.model_provider)}
                      </td>

                      {/* Col 5: Status */}
                      <td className="py-3 px-3">{renderStatusPill(row.agent.status)}</td>

                      {/* Col 6: Payload Tokens */}
                      <td className="py-3 px-3 font-mono">
                        <div className="flex items-center gap-1.5">
                          <Flame className="h-3 w-3 text-[var(--surface-accent-gold)]" />
                          <span className="font-bold text-[var(--surface-accent-gold)]">
                            {formatCompactTokens(row.payloadTokens)}
                          </span>
                          <span className="text-[10px] text-[var(--semantic-success)]">
                            ({row.turnCapLabel})
                          </span>
                        </div>
                        <div className="w-28 mt-1">
                          <TokenBreakdownBar
                            tokensIn={row.agent.total_tokens_in}
                            tokensCached={row.agent.total_tokens_cached}
                            tokensThinking={row.agent.total_tokens_thinking}
                            tokensOut={row.agent.total_tokens_out}
                            maxTokensQuota={row.agent.max_tokens_per_run}
                          />
                        </div>
                      </td>

                      {/* Col 7: Context Reads */}
                      <td className="py-3 px-3 max-w-[210px]">
                        <div className="flex flex-wrap gap-1">
                          {row.contextReads.map((cr) => (
                            <span
                              key={cr}
                              className="inline-flex items-center gap-1 rounded bg-[var(--surface-card)] border border-[var(--surface-border)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--surface-accent-gold)]"
                            >
                              <FileCode className="h-2.5 w-2.5 text-[var(--surface-accent-gold)]" />
                              {cr}
                            </span>
                          ))}
                        </div>
                        <div className="text-[9px] font-mono text-[var(--semantic-alert)]/80 mt-0.5 truncate">
                          🚫 {row.forbiddenReads}
                        </div>
                      </td>

                      {/* Col 8: Current Task */}
                      <td className="py-3 px-4 max-w-xs">
                        <div className="text-xs text-[var(--surface-text)] font-medium line-clamp-1">
                          {row.agent.active_task_title}
                        </div>
                        {row.agent.active_git_branch && (
                          <div className="inline-flex items-center gap-1 text-[10px] font-mono text-[var(--surface-text-secondary)] mt-0.5">
                            <GitBranch className="h-2.5 w-2.5 text-gold-400" />
                            <span>{row.agent.active_git_branch}</span>
                          </div>
                        )}
                      </td>

                      {/* Col 9: Actions */}
                      <td
                        className="py-3 px-4 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-1.5">
                          {onOpenAgentWindowTab && (
                            <button
                              type="button"
                              onClick={() => onOpenAgentWindowTab(row.agent)}
                              className="inline-flex items-center gap-1 rounded-lg bg-gold-500/15 hover:bg-gold-500/25 border border-gold-500/40 px-2 py-1 text-[11px] font-medium text-gold-200 transition cursor-pointer"
                              title="Open agent in a closable window tab"
                            >
                              <ExternalLink className="h-3 w-3 text-gold-400" />
                              <span>Tab</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onInspectAgent(row.agent, 'runs')}
                            className="inline-flex items-center gap-1 rounded-lg bg-[var(--surface-muted)] hover:bg-[var(--surface-border)] border border-[var(--surface-border)] px-2 py-1 text-[11px] font-medium text-[var(--surface-text)] transition cursor-pointer"
                            title="Open slide-over drawer"
                          >
                            <Terminal className="h-3 w-3 text-[var(--surface-text-secondary)]" />
                            <span>Drawer</span>
                          </button>
                          {onChatDirectWithAgent && (
                            <button
                              type="button"
                              onClick={() => onChatDirectWithAgent(row.agent)}
                              className="inline-flex items-center gap-1 rounded-lg bg-[var(--surface-accent)]/15 hover:bg-[var(--surface-accent)]/25 border border-[var(--surface-accent)]/40 px-2 py-1 text-[11px] font-medium text-[var(--surface-accent)] transition cursor-pointer"
                              title="Direct @agent chat"
                            >
                              <MessageSquare className="h-3 w-3 text-[var(--surface-accent)]" />
                            </button>
                          )}
                          {onKillOrRestartAgent && (
                            <button
                              type="button"
                              onClick={() =>
                                onKillOrRestartAgent(
                                  row.agent.id,
                                  row.agent.status === 'WORKING' ? 'KILL' : 'RESTART'
                                )
                              }
                              className="rounded-lg bg-[var(--surface-card)] hover:bg-[var(--surface-muted)] border border-[var(--surface-border)] p-1 text-[var(--surface-text-secondary)] hover:text-[var(--semantic-alert)] transition cursor-pointer"
                              title="Kill or restart sandbox"
                            >
                              {row.agent.status === 'WORKING' ? (
                                <Power className="h-3 w-3 text-[var(--semantic-alert)]" />
                              ) : (
                                <RotateCcw className="h-3 w-3" />
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* 3. SECONDARY SUB-VIEW: BLUEPRINT HIERARCHY & AGENT PROVISIONER STUDIO */}
      {subView === 'studio' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* LEFT 7 COLS: 4-TIER PYRAMID BLUEPRINT */}
            <div className="lg:col-span-7 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-panel)] p-4 sm:p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-[var(--surface-text)] flex items-center gap-2">
                    <Network className="h-5 w-5 text-gold-400" />
                    <span>Bottom-Heavy Token &amp; Decision Pyramid (`AGENTS.md`)</span>
                  </h2>
                  <p className="text-xs text-[var(--surface-text-secondary)] mt-0.5">
                    Click any agent card to inspect its config or clone its blueprint.
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-accent-gold)]/15 border border-[var(--surface-accent-gold)]/40 px-2.5 py-1 text-[10px] font-mono text-[var(--surface-accent-gold)]">
                  <Database className="h-3.5 w-3.5 text-[var(--surface-accent-gold)]" />
                  <span>pgvector 768-dim Pinned</span>
                </span>
              </div>

              {(
                [
                  {
                    lvl: -1,
                    title: 'Root Tier (Level -1): Chief of Staff (@warden)',
                    cap: 'Budget: <= 1.5K tok/turn | Reads: 0 repo files',
                  },
                  {
                    lvl: 0,
                    title: 'Level 0 (CXO Heads): @cto (Tech) & @cbo (SEO/AEO + Business)',
                    cap: 'Budget: <= 4.0K tok/turn | Max Upward Reply: <= 120 words',
                  },
                  {
                    lvl: 1,
                    title: 'Level 1 (Vertical & Project Leads): @pm, @tech_lead, @aeo_lead, @social_lead, @infra_head, @sec_lead',
                    cap: 'Owns contracts/* & worklist/* | Max Upward Reply: <= 150 words',
                  },
                  {
                    lvl: 2,
                    title: 'Level 2 (Sandboxed Executors): @frontend_dev, @backend_dev, @aeo_specialist, @social_creator',
                    cap: 'Operates in .state/mirror/<repo> | Max Upward Reply: <= 200 words',
                  },
                ] as const
              ).map((tier) => {
                const list = enrichedRoster.filter(
                  (r) => r.agent.hierarchy_level === tier.lvl
                );
                return (
                  <div
                    key={tier.lvl}
                    className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-card)] p-3.5 space-y-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-bold text-[var(--surface-text)] font-mono">
                        {tier.title}
                      </span>
                      <span className="rounded bg-[var(--surface-panel)] border border-[var(--surface-border)] px-2 py-0.5 text-[10px] font-mono text-gold-400">
                        {tier.cap}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
                      {list.map((row) => (
                        <div
                          key={row.agent.id}
                          onClick={() => onInspectAgent(row.agent, 'config')}
                          className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-panel)] hover:border-gold-500/50 p-3 transition cursor-pointer flex flex-col justify-between gap-2 shadow-xs"
                        >
                          <div>
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-mono text-xs font-bold text-gold-400">
                                {row.agent.slug}
                              </span>
                              {getVerticalBadge(row.vertical, row.verticalLabel)}
                            </div>
                            <div className="text-[11px] text-[var(--surface-text)] font-medium mt-1">
                              {row.agent.role_title}
                            </div>
                          </div>
                          <div className="flex items-center justify-between pt-1.5 border-t border-[var(--surface-border)] text-[10px] font-mono text-[var(--surface-text-secondary)]">
                            <span>↳ {row.supervisorHandle}</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCloneExisting(row.agent);
                              }}
                              className="inline-flex items-center gap-1 rounded bg-[var(--surface-muted)] hover:bg-[var(--surface-border)] px-1.5 py-0.5 text-[var(--surface-text)] cursor-pointer"
                            >
                              <Copy className="h-2.5 w-2.5" />
                              <span>Clone</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* RIGHT 5 COLS: PROVISION NEW AI EMPLOYEE FORM */}
            <div className="lg:col-span-5 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-panel)] p-4 sm:p-5 space-y-4 h-fit shadow-sm">
              <div>
                <h3 className="text-base font-bold text-[var(--surface-text)] flex items-center gap-2">
                  <UserPlus className="h-5 w-5 text-[var(--surface-accent-gold)]" />
                  <span>Provision New AI Employee</span>
                </h3>
                <p className="text-xs text-[var(--surface-text-secondary)] mt-0.5">
                  Bind any LLM provider, configure automatic failover, and jail repository access.
                </p>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {PRESET_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.slug}
                    type="button"
                    onClick={() => handleLoadTemplate(tpl)}
                    className="rounded-lg bg-[var(--surface-card)] hover:bg-[var(--surface-muted)] border border-[var(--surface-border)] px-2.5 py-1 text-xs font-mono text-gold-400 transition cursor-pointer"
                  >
                    <Sparkles className="h-3 w-3 inline mr-1 text-gold-400" />
                    {tpl.slug}
                  </button>
                ))}
              </div>

              {createdBanner && (
                <div className="rounded-xl border border-[var(--semantic-success)]/40 bg-[var(--semantic-success)]/15 p-3 text-xs font-mono text-[var(--semantic-success)]">
                  ✓ {createdBanner}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-3 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block font-mono text-[var(--surface-text-secondary)] mb-1">
                      Agent Handle (`slug`)
                    </label>
                    <input
                      type="text"
                      value={slug}
                      onChange={(e) => setSlug(e.target.value)}
                      className="w-full rounded-lg bg-[var(--surface-card)] border border-[var(--surface-border)] px-3 py-2 font-mono text-gold-400"
                    />
                  </div>
                  <div>
                    <label className="block font-mono text-[var(--surface-text-secondary)] mb-1">
                      Display Name
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full rounded-lg bg-[var(--surface-card)] border border-[var(--surface-border)] px-3 py-2 text-[var(--surface-text)]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-mono text-[var(--surface-text-secondary)] mb-1">Role Title</label>
                  <input
                    type="text"
                    value={roleTitle}
                    onChange={(e) => setRoleTitle(e.target.value)}
                    className="w-full rounded-lg bg-[var(--surface-card)] border border-[var(--surface-border)] px-3 py-2 text-[var(--surface-text)]"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block font-mono text-[var(--surface-text-secondary)] mb-1">Department</label>
                    <select
                      value={department}
                      onChange={(e) => setDepartment(e.target.value as DepartmentUnit)}
                      className="w-full rounded-lg bg-[var(--surface-card)] border border-[var(--surface-border)] px-2.5 py-2 font-mono text-[var(--surface-text)]"
                    >
                      <option value="TECH">TECH</option>
                      <option value="MARKETING">SEO/AEO &amp; SOCIAL</option>
                      <option value="INFRA">
                        INFRA{INFRA_PROJECT ? ` (${INFRA_PROJECT.slug})` : ''}
                      </option>
                      <option value="EXECUTIVE">EXECUTIVE</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-mono text-[var(--surface-text-secondary)] mb-1">Level</label>
                    <select
                      value={hierarchyLevel}
                      onChange={(e) =>
                        setHierarchyLevel(Number(e.target.value) as -1 | 0 | 1 | 2)
                      }
                      className="w-full rounded-lg bg-[var(--surface-card)] border border-[var(--surface-border)] px-2.5 py-2 font-mono text-[var(--surface-text)]"
                    >
                      <option value={0}>Level 0 (CXO)</option>
                      <option value={1}>Level 1 (Lead)</option>
                      <option value={2}>Level 2 (Exec)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-mono text-[var(--surface-text-secondary)] mb-1">Provider</label>
                    <select
                      value={modelProvider}
                      onChange={(e) => {
                        const nextProv = e.target.value as ModelProvider;
                        setModelProvider(nextProv);
                        setModelId(PROVIDER_MODELS[nextProv][0]);
                      }}
                      className="w-full rounded-lg bg-[var(--surface-card)] border border-[var(--surface-border)] px-2.5 py-2 font-mono text-[var(--surface-text)]"
                    >
                      <option value="vertex">vertex</option>
                      <option value="meta_muse">meta_muse</option>
                      <option value="anthropic">anthropic</option>
                      <option value="openai">openai</option>
                      <option value="ollama">ollama</option>
                      <option value="huggingface">huggingface</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block font-mono text-[var(--surface-text-secondary)] mb-1">
                    Allowed Sandbox Repositories (`allowed_repos`)
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {projectContexts.map((ctx) => {
                      const active = selectedRepos.includes(ctx.repo_slug);
                      return (
                        <button
                          key={ctx.id}
                          type="button"
                          onClick={() => toggleRepo(ctx.repo_slug)}
                          className={`rounded-lg border px-2 py-1 text-[10px] font-mono transition cursor-pointer ${
                            active
                              ? 'bg-[var(--surface-accent)]/15 border border-[var(--surface-accent)]/50 text-[var(--surface-accent)] font-semibold shadow-xs'
                              : 'bg-[var(--surface-card)] border-[var(--surface-border)] text-[var(--surface-text-secondary)]'
                          }`}
                        >
                          {ctx.project_slug}/{ctx.repo_slug}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block font-mono text-[var(--surface-text-secondary)] mb-1">
                    System Prompt (`init_prompt`)
                  </label>
                  <textarea
                    rows={3}
                    value={initPrompt}
                    onChange={(e) => setInitPrompt(e.target.value)}
                    placeholder={PROJECT_SCOPE_PLACEHOLDER}
                    className="w-full rounded-xl bg-[var(--surface-card)] border border-[var(--surface-border)] p-2.5 font-mono text-xs text-[var(--surface-text)]"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl btn-gold-cta px-4 py-2.5 text-xs font-bold transition cursor-pointer"
                >
                  <PlusCircle className="h-4 w-4" />
                  <span>Provision AI Employee into Roster</span>
                </button>
              </form>
            </div>
          </div>

          {/* Multi-Token Credit Pool */}
          <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-panel)] p-4 sm:p-5 space-y-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-[var(--surface-text)] flex items-center gap-2">
                  <KeyRound className="h-5 w-5 text-[var(--surface-accent)]" />
                  <span>Multi-Token Credit Pool &amp; Failover Router</span>
                </h3>
                <p className="text-xs text-[var(--surface-text-secondary)] mt-0.5">
                  Automatic &lt;50ms key rotation on HTTP 429 across all 6 model providers.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddTokenForm((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--surface-accent)]/15 border border-[var(--surface-accent)]/40 px-3 py-1.5 text-xs font-bold text-[var(--surface-accent)] cursor-pointer"
              >
                <PlusCircle className="h-4 w-4" />
                <span>+ Add API Token</span>
              </button>
            </div>

            {showAddTokenForm && (
              <form
                onSubmit={handleAddCredentialSubmit}
                className="rounded-xl border border-[var(--surface-accent)]/40 bg-[var(--surface-card)] p-3.5 grid grid-cols-1 sm:grid-cols-4 gap-2.5 text-xs"
              >
                <input
                  type="text"
                  value={credLabel}
                  onChange={(e) => setCredLabel(e.target.value)}
                  placeholder="Token Label"
                  className="rounded-lg bg-[var(--surface-panel)] border border-[var(--surface-border)] px-2.5 py-1.5 text-[var(--surface-text)] placeholder:text-[var(--surface-text-secondary)]/50"
                />
                <input
                  type="password"
                  value={credApiKey}
                  onChange={(e) => setCredApiKey(e.target.value)}
                  placeholder="API Key..."
                  className="rounded-lg bg-[var(--surface-panel)] border border-[var(--surface-border)] px-2.5 py-1.5 font-mono text-[var(--surface-text)] placeholder:text-[var(--surface-text-secondary)]/50"
                />
                <input
                  type="number"
                  value={credBudgetUsd}
                  onChange={(e) => setCredBudgetUsd(Number(e.target.value))}
                  placeholder="Budget USD"
                  className="rounded-lg bg-[var(--surface-panel)] border border-[var(--surface-border)] px-2.5 py-1.5 font-mono text-[var(--surface-accent-gold)] placeholder:text-[var(--surface-text-secondary)]/50"
                />
                <button
                  type="submit"
                  className="rounded-lg btn-gold-cta px-3 py-1.5 font-bold transition cursor-pointer"
                >
                  Save Key
                </button>
              </form>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
              {credentials.map((cred) => (
                <div
                  key={cred.id}
                  className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-card)] p-3 flex flex-col justify-between gap-2 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-gold-400">
                      {cred.provider} (#{cred.priority_order})
                    </span>
                    <span className="rounded bg-[var(--semantic-success)]/15 border border-[var(--semantic-success)]/40 px-1.5 py-0.2 text-[10px] font-mono text-[var(--semantic-success)]">
                      {cred.status}
                    </span>
                  </div>
                  <div className="text-[var(--surface-text)] font-medium">{cred.label}</div>
                  <div className="flex items-center justify-between pt-1.5 border-t border-[var(--surface-border)] font-mono text-[11px]">
                    <span className="text-[var(--surface-accent-gold)]">
                      {formatUsd(cred.remaining_budget_usd)} left
                    </span>
                    <button
                      type="button"
                      onClick={() => onRotateCredentialFailover(cred.id)}
                      className="text-[var(--surface-accent)] hover:underline cursor-pointer"
                    >
                      Test 429 Failover
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default AgentStudioView;
