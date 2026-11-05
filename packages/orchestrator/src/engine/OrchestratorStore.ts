import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  getDefaultProjectSlug,
  getInfraProjectSlug,
  getProjects,
  inferProjectFromText,
  isInfraProject,
  resolveWardenRoot,
} from '../config/projectRegistry.js';
import { loadSeedData } from './seedData.js';
import { hybridMemoryEngine } from '../memory/HybridMemoryEngine.js';

// ============================================================================
// Core Relational + Vector Schema Types (the architecture spec Section 4)
// ============================================================================

export type AgentStatus =
  | 'IDLE'
  | 'WORKING'
  | 'WAITING_FOR_CEO'
  | 'UNHEALTHY_LOOP'
  | 'TERMINATED_TIMEOUT'
  | 'PAUSED_TOKEN_CAP'
  | 'ERROR';

export type AgentHealthStatus =
  | 'HEALTHY'
  | 'DEGRADED'
  | 'STUCK_LOOP'
  | 'ZOMBIE_NO_HEARTBEAT'
  | 'KILLED_24H_LIMIT';

export type ModelProvider =
  | 'meta_muse'
  | 'ollama'
  | 'huggingface'
  | 'vllm';

export type RoutingProfile =
  | 'LOCAL_ZERO_COST'
  | 'META_MUSE_HACKATHON'
  | 'CUSTOM_HYBRID';

export type StepPhase =
  | 'planning'
  | 'tool_loop'
  | 'compaction'
  | 'creative_image'
  | 'voice_note'
  | 'default';

export type StepRoutingMap = Partial<
  Record<StepPhase, { provider: ModelProvider; modelId?: string; model_id?: string }>
>;

export type PermissionTier = 'full_overdrive' | 'standard_autonomous' | 'strict_gate';

export interface ProviderCredentialRecord {
  id: string;
  provider: ModelProvider;
  label: string;
  api_key_masked: string;
  base_url: string | null;
  project_id: string | null;
  region: string | null;
  priority_weight: number;
  daily_quota_tokens: number;
  today_used_tokens: number;
  rpm_limit: number;
  cooldown_until: string | null;
  is_enabled: boolean;
  last_used_at: string | null;
  created_at: string;
}

export interface DiskDbSyncStatus {
  last_disk_to_db_at: string | null;
  last_db_to_disk_at: string | null;
  synced_context_files: number;
  synced_memory_files: number;
  synced_worklist_files: number;
  preserved_native_ide_files: string[];
}

export interface AgentRecord {
  id: string;
  slug: string; // e.g. '@warden', '@cto', '@pm', '@tech_lead:<project>'
  name: string;
  roleTitle: string;
  department: string; // 'Executive' | 'Tech' | 'Product' | 'Infra' | 'Marketing' | 'Sales' | 'HR' | 'Operations' | 'Finance'
  hierarchy_level: number; // -1 (warden), 0 (cto/cmo/cbo/chro/coo/cfo), 1 (leads), 2 (devs), 3 (workers)
  parent_agent_id: string | null;
  project_scope: string | null; // project slug from projects.yaml | 'marketing' | 'product' | null
  model_provider: ModelProvider;
  model_id: string;
  fallback_provider?: ModelProvider;
  fallback_model_id?: string;
  step_routing_json?: StepRoutingMap;
  init_prompt: string;
  allowed_repos: string[];
  permission_tier: PermissionTier;
  status: AgentStatus;
  health_status: AgentHealthStatus;
  last_heartbeat_at: string;
  max_subagents: number;
  active_subagent_count: number;
  max_run_duration_ms: number;
  current_run_id: string | null;
  clocked_in_at: string | null;
  total_work_time_ms: number;
  today_work_time_ms: number;
  total_runs: number;
  total_commits: number;
  max_tokens_per_run: number;
  today_tokens_used: number;
  total_tokens_in: number;
  total_tokens_cached: number;
  total_tokens_thinking: number;
  total_tokens_out: number;
  total_cost_usd: number;
  active_container_id?: string | null;
  active_git_branch?: string | null;
  /** True for runtime auto-registered roles pending human review. */
  needs_review?: boolean;
}

export interface ProjectContextRecord {
  id: string;
  user_id?: string | null;
  project_slug: string;
  repo_slug: string;
  git_repo_url: string;
  local_path?: string;
  default_branch: string;
  role: 'frontend' | 'backend' | 'infra' | 'shared-lib' | 'fullstack' | 'meta-docs';
  docker_base_image: string;
  build_cmd: string;
  test_cmd: string;
  dev_preview_port: number;
  architecture_doc_md: string;
  updated_at: string;
}

export type MemoryType =
  | 'PINNED_PREFERENCE'
  | 'REPO_GOTCHA'
  | 'EPISODIC_LESSON'
  | 'CEO_DECISION';

export interface AgentMemoryRecord {
  id: string;
  user_id?: string | null;
  agent_id: string;
  project_scope: string | null;
  memory_type: MemoryType;
  content: string;
  source_run_id: string | null;
  is_pinned: boolean;
  created_at: string;
}

export type RunTriggerType =
  | 'CEO_CHAT'
  | 'DIRECT_MENTION'
  | 'DELEGATION'
  | 'DAILY_STANDUP'
  | 'IDLE_WATCHDOG';

export type RunStatus =
  | 'RUNNING'
  | 'PAUSED_FOR_CEO'
  | 'PAUSED_TOKEN_CAP'
  | 'VERIFYING_QA'
  | 'COMPLETED'
  | 'TERMINATED_TIMEOUT'
  | 'UNHEALTHY_LOOP'
  | 'FAILED';

export interface RunCheckpointMessage {
  role: 'system' | 'user' | 'model' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
    arguments?: Record<string, unknown>;
  }>;
  toolOutput?: unknown;
  attachments?: MediaAttachment[];
}

export interface RunInboxMessage {
  id: string;
  from_agent_slug: string;
  from_run_id: string | null;
  content: string;
  created_at: string;
  consumed?: boolean;
}

export interface AgentRunRecord {
  id: string;
  user_id?: string | null;
  agent_id: string;
  agent_slug: string;
  parent_run_id: string | null;
  chat_thread_id: string | null;
  sprint_id: string | null;
  backlog_item_id: string | null;
  trigger_type: RunTriggerType;
  input_prompt: string;
  output_summary: string | null;
  status: RunStatus;
  container_id: string | null;
  git_branch: string | null;
  git_commit_sha: string | null;
  preview_url: string | null;
  qa_passed: boolean | null;
  qa_screenshot_url: string | null;
  spawns_count: number;
  started_at: string;
  ended_at: string | null;
  active_duration_ms: number;
  pause_duration_ms: number;
  tokens_in: number;
  tokens_cached: number;
  tokens_thinking: number;
  tokens_out: number;
  cost_usd: number;
  messages_json?: RunCheckpointMessage[];
  pending_gate_id?: string | null;
  pending_tool_call_id?: string | null;
  pending_tool_name?: string | null;
  inbox_messages?: RunInboxMessage[];
  child_run_ids?: string[];
  project_scope?: string | null;
  system_context_override?: string;
}

export type InferenceStepType =
  | 'LLM_INFERENCE'
  | 'TOOL_CALL'
  | 'SUBAGENT_CALL'
  | 'QA_CHECK';

export interface InferenceStepRecord {
  id: string;
  user_id?: string | null;
  run_id: string;
  step_index: number;
  step_type: InferenceStepType;
  model_used: string;
  thinking_text: string | null;
  message_text: string | null;
  tool_name: string | null;
  tool_args_json: Record<string, unknown> | null;
  tool_output_json: Record<string, unknown> | null;
  duration_ms: number;
  tokens_in: number;
  tokens_cached: number;
  tokens_thinking: number;
  tokens_out: number;
  cost_usd: number;
  created_at: string;
}

export type ChatThreadMode =
  | 'WARDEN_EXECUTIVE'
  | 'DIRECT_AGENT'
  | 'STANDUP'
  | 'BACKLOG_REQUEST';

export interface ChatThreadRecord {
  id: string;
  user_id?: string | null;
  title: string;
  mode: ChatThreadMode;
  target_agent_id: string;
  project_scope: string | null;
  status: 'ACTIVE' | 'WAITING_FOR_CEO' | 'ARCHIVED';
  created_at: string;
  updated_at: string;
}

export interface MediaAttachment {
  id?: string;
  type: string; // e.g. 'image/png', 'video/mp4', 'application/pdf'
  filename: string;
  media_uri?: string;
  public_url: string;
  base64_data?: string;
  size_bytes?: number;
}

export interface ChatMessageRecord {
  id: string;
  user_id?: string | null;
  thread_id: string;
  sender_type: 'CEO' | 'AGENT' | 'SYSTEM';
  sender_agent_id: string | null;
  recipient_agent_id: string | null;
  content: string;
  run_id: string | null;
  attachments_json: MediaAttachment[];
  created_at: string;
}

// Drops repeat rows by id, keeping the first. Hydration must not trust persisted
// state blindly: a snapshot written before the upsert guards can hold the same
// message twice, and React keys plus WS dedup both assume unique ids.
export function dedupeMessagesById<T extends { id: string }>(messages: T[]): T[] {
  const seen = new Set<string>();
  return messages.filter((m) => {
    if (!m?.id || seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

export type BacklogStage =
  | 'INBOX'
  | 'NEEDS_CEO'
  | 'TODO'
  | 'IN_PROGRESS'
  | 'QA_REVIEW'
  | 'DONE';
export type BacklogPriority = 'P0' | 'P1' | 'P2';
export type HumanInterventionType =
  | 'NONE'
  | 'QUESTION'
  | 'API_KEY'
  | 'MANUAL_ACTION'
  | 'DECISION';

export interface SprintWeeklyPlanEntry {
  backlog_item_id: string;
  title: string;
  project_slug: string;
  pm_owner_id: string;
  assigned_agent_id: string;
  priority: BacklogPriority;
  stage: BacklogStage;
  target_week: string;
}

export interface SprintTaskMovementEntry {
  id: string;
  backlog_item_id: string;
  title: string;
  project_slug: string;
  from_stage: BacklogStage;
  to_stage: BacklogStage;
  from_priority?: BacklogPriority;
  to_priority?: BacklogPriority;
  moved_by_agent_id: string;
  reason: string;
  moved_at: string;
}

export interface SprintRecord {
  id: string;
  user_id?: string | null;
  date_ist: string;
  week_label?: string;
  status: 'AWAITING_CEO_APPROVAL' | 'EXECUTING' | 'COMPLETED';
  mom_summary_md: string;
  weekly_plan_json?: SprintWeeklyPlanEntry[];
  task_movements_json?: SprintTaskMovementEntry[];
  approved_at: string | null;
  ceo_notes: string | null;
  created_at: string;
}

export interface BacklogItemRecord {
  id: string;
  user_id?: string | null;
  title: string;
  spec_md: string;
  stage: BacklogStage;
  priority: BacklogPriority;
  project_slug: string; // project slug from projects.yaml | 'marketing' | 'product'
  department: string;
  pm_owner_id?: string | null;
  assigned_agent_id: string | null;
  sprint_id: string | null;
  target_week?: string | null;
  requires_human_intervention?: boolean;
  intervention_type?: HumanInterventionType;
  intervention_prompt?: string | null;
  required_env_keys?: string[];
  human_response?: string | null;
  requested_by_agent_id?: string | null;
  last_moved_at?: string | null;
  last_movement_note?: string | null;
  status_note?: string | null;
  origin_thread_id?: string | null;
  created_at: string;
  completed_at: string | null;
}

export type ApprovalGateType =
  | 'QUESTION'
  | 'STANDUP_SIGN_OFF'
  | 'DEPLOY_PERMISSION'
  | 'EMPTY_BACKLOG_PING'
  | 'TOKEN_CAP_EXCEEDED';

export interface SuggestedBacklogSpec {
  id: string;
  title: string;
  priority: BacklogPriority;
  project_slug: string;
  assigned_agent_id: string;
  spec_md: string;
}

export interface ApprovalGateRecord {
  id: string;
  user_id?: string | null;
  run_id: string | null;
  thread_id: string | null;
  sprint_id?: string | null;
  agent_id: string;
  department: string;
  project_scope: string | null;
  gate_type: ApprovalGateType;
  prompt_text: string;
  options_json: {
    choices?: string[];
    suggested_tasks?: SuggestedBacklogSpec[];
    sprint_id?: string;
    [key: string]: unknown;
  };
  status: 'PENDING' | 'RESOLVED';
  ceo_decision: string | null;
  telegram_notified_at: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface ContractRecord {
  id: string;
  user_id?: string | null;
  project_slug: string;
  feature_slug: string;
  locked_by_agent_id: string;
  backend_agent_id: string;
  frontend_agent_id: string;
  contract_md: string;
  created_at: string;
}

export type EventBroadcastFn = (event: string, payload: unknown) => void;

export type WardenSource = 'db' | 'md';

export function isCloudMode(): boolean {
  return (process.env.WARDEN_CLOUD || '').trim().toLowerCase() === 'true';
}

export function resolveWardenSource(): WardenSource {
  if (isCloudMode()) return 'db';
  return (process.env.WARDEN_SOURCE || 'db').trim().toLowerCase() === 'md' ? 'md' : 'db';
}

/**
 * Best-effort department for a runtime-encountered role slug. Unknown roles
 * default to `tech` under `@cto`; the row is flagged `needs_review` so a
 * human corrects it in Agent Studio.
 */
export function inferDepartmentForRole(role: string): string {
  const r = role.toLowerCase();
  if (/(sales|sdr|closer|revenue|pipeline|quota|deal)/.test(r)) return 'sales';
  if (/(hr|recruit|hiring|people|talent|onboard)/.test(r)) return 'hr';
  if (/(support|helpdesk|help_desk|care|ticket)/.test(r)) return 'support';
  if (/(sec_|_sec|security|legal|compliance|risk)/.test(r)) return 'tech';
  if (/(finops|finance|bookkeep|billing|accounting|invoice|treasury)/.test(r)) return 'finance';
  if (/(market|cmo|seo|aeo|social|content|growth|brand|ads|community|campaign|copywriter|creative)/.test(r)) return 'marketing';
  if (/(infra|devops|sre|deploy|cloud|platform|network|database_admin)/.test(r)) return 'infra';
  if (/(exec|chief|warden|strategy)/.test(r)) return 'executive';
  if (/(ops|operator|logistics|procure|vendor)/.test(r)) return 'ops';
  return 'tech';
}

export const CORE_DEMO_AGENT_IDS = new Set([
  'warden',
  'cto',
  'cmo',
  'frontend_dev',
  'designer',
  'seo_aeo_head',
  'social_lead',
]);

function isCoreOrActiveDemoAgent(agent: AgentRecord): boolean {
  const cleanId = agent.id.toLowerCase().replace(/^agent_/, '');
  const cleanSlug = agent.slug.replace(/^@/, '').toLowerCase().replace(/^agent_/, '');
  return (
    CORE_DEMO_AGENT_IDS.has(cleanId) ||
    CORE_DEMO_AGENT_IDS.has(cleanSlug) ||
    agent.status === 'WORKING' ||
    agent.status === 'WAITING_FOR_CEO' ||
    agent.needs_review === true
  );
}

/**
 * Unified Orchestrator State & Database Store
 *
 * Synchronizes state with `@warden/db` (PostgreSQL + pgvector) when reachable,
 * while maintaining high-speed in-memory mirrors for sub-millisecond watchdog checks,
 * live timesheet ticking, and resilient zero-config startup.
 */
export class OrchestratorStore {
  public agents = new Map<string, AgentRecord>();
  public projectContexts = new Map<string, ProjectContextRecord>();
  public memories: AgentMemoryRecord[] = [];
  public runs = new Map<string, AgentRunRecord>();
  public stepsByRun = new Map<string, InferenceStepRecord[]>();
  public threads = new Map<string, ChatThreadRecord>();
  public messagesByThread = new Map<string, ChatMessageRecord[]>();
  public sprints = new Map<string, SprintRecord>();
  public backlogItems = new Map<string, BacklogItemRecord>();
  public approvalGates = new Map<string, ApprovalGateRecord>();
  public contracts = new Map<string, ContractRecord>();
  public providerCredentials = new Map<string, ProviderCredentialRecord>();
  public subagentSessions = new Map<string, string>();
  public routingProfile: RoutingProfile =
    (process.env.WARDEN_ROUTING_PROFILE as RoutingProfile) || 'META_MUSE_HACKATHON';
  public codeChunksCount = 412;
  public wardenRoot: string;
  public lastSyncStatus: DiskDbSyncStatus = {
    last_disk_to_db_at: null,
    last_db_to_disk_at: null,
    synced_context_files: 0,
    synced_memory_files: 0,
    synced_worklist_files: 0,
    preserved_native_ide_files: [
      'AGENTS.md',
      'MUSE.md',
      '.agents/skills/*',
      '.claude/agents/*.md',
      'context/**',
      'memory/**',
      'worklist/**',
      'contracts/**',
      'standups/**',
      'chats/**',
    ],
  };

  /**
   * Source of truth for chats, backlog, and contexts:
   * - `md` (default): Markdown files on disk hydrate the store and receive every write-back.
   * - `db`: PostgreSQL (via `@warden/db` dbStore) hydrates the store and receives every write.
   *   Markdown is only touched by an explicit `npm run sync`.
   */
  public readonly source: WardenSource;

  private broadcastFn?: EventBroadcastFn;
  private dbModule: Record<string, any> | null = null;
  private dbConnected = false;
  private dbWriteQueue: Promise<unknown> = Promise.resolve();
  private dbAgentIds = new Set<string>();
  private dbPersistedAgentIds = new Set<string>();
  private seedSource: 'private' | 'generic' = 'generic';

  constructor(options?: { onBroadcast?: EventBroadcastFn; wardenRoot?: string }) {
    this.broadcastFn = options?.onBroadcast;
    this.wardenRoot = this.resolveWardenRoot(options?.wardenRoot);
    this.source = resolveWardenSource();
    this.seedInitialState();
  }

  private resolveWardenRoot(explicitRoot?: string): string {
    return resolveWardenRoot(explicitRoot);
  }

  // ============================================================================
  // Project-aware ownership helpers (driven by projects.yaml + seeded agents)
  // ============================================================================

  /** Project PM owner: `pm:<slug>` if seeded, `infra_head` for infra projects, else `pm`. */
  public pmForProject(slug: string | null | undefined, marketingOwner = 'seo_aeo_head'): string {
    if (!slug) return 'pm';
    if (this.agents.has(`pm:${slug}`)) return `pm:${slug}`;
    if (isInfraProject(slug)) return 'infra_head';
    if (slug === 'marketing') return marketingOwner;
    return 'pm';
  }

  /** Project tech lead: `tech_lead:<slug>` if seeded, `infra_head` for infra, else `cto`. */
  public leadForProject(slug: string | null | undefined): string {
    if (!slug) return 'cto';
    if (this.agents.has(`tech_lead:${slug}`)) return `tech_lead:${slug}`;
    if (isInfraProject(slug)) return 'infra_head';
    if (slug === 'marketing') return 'seo_aeo_head';
    return 'cto';
  }

  /** Level 2 executor for a project: `<kind>_dev:<slug>` if seeded, `infra_jr` for infra, else the lead. */
  public executorForProject(slug: string | null | undefined, kind: 'backend' | 'frontend'): string {
    const s = slug || this.getDefaultProjectSlug();
    if (this.agents.has(`${kind}_dev:${s}`)) return `${kind}_dev:${s}`;
    if (isInfraProject(s)) return 'infra_jr';
    if (s === 'marketing') return 'seo_content_dev';
    return this.leadForProject(s);
  }

  /** Default project slug (WARDEN_DEFAULT_PROJECT or first tech project in projects.yaml). */
  public getDefaultProjectSlug(): string {
    return getDefaultProjectSlug();
  }

  public getInfraProjectSlug(): string {
    return getInfraProjectSlug();
  }

  /** Projects that have dedicated agents (a seeded tech lead / PM) or are infra projects. */
  public getStaffedProjectSlugs(): string[] {
    return getProjects()
      .map((p) => p.slug)
      .filter(
        (slug) =>
          isInfraProject(slug) ||
          this.agents.has(`tech_lead:${slug}`) ||
          this.agents.has(`pm:${slug}`)
      );
  }

  /** Infers a staffed project slug from free text, defaulting to the default project. */
  public inferProjectSlugFromText(text: string, includeRepos = false): string {
    const staffed = new Set(this.getStaffedProjectSlugs());
    return inferProjectFromText(text, { includeRepos, filter: (p) => staffed.has(p.slug) });
  }

  public setBroadcast(fn: EventBroadcastFn): void {
    this.broadcastFn = fn;
  }

  public broadcast(event: string, payload: unknown): void {
    if (this.broadcastFn) {
      this.broadcastFn(event, payload);
    }
  }

  public emit(event: string, payload: unknown): void {
    this.broadcast(event, payload);
  }

  /**
   * Hands the live pg pool to the memory engine so hybrid recall
   * (`recallPastChatMessages`, `recallEpisodicMemories`, `recallCodeChunks`)
   * queries Postgres instead of silently degrading to in-memory fallback.
   */
  private attachMemoryExecutor(): void {
    const pool = this.dbModule?.pool;
    if (!this.dbConnected || !pool || typeof pool.query !== 'function') return;
    hybridMemoryEngine.setDatabaseExecutor((sql, params) => pool.query(sql, params));
  }

  /**
   * Attempts to attach to `@warden/db` PostgreSQL pool if available.
   */
  public async tryConnectDatabase(): Promise<boolean> {
    if (this.source === 'db') {
      return this.connectDbSource();
    }
    try {
      const modName = '@warden/db';
      const mod = await import(/* @vite-ignore */ modName).catch(() => null);
      if (mod) {
        this.dbModule = mod;
        if (typeof mod.checkConnection === 'function') {
          this.dbConnected = await mod.checkConnection();
        } else if (mod.pool && typeof mod.pool.query === 'function') {
          await mod.pool.query('SELECT 1');
          this.dbConnected = true;
        }
        if (this.dbConnected) {
          await this.syncFromPostgresIfAvailable();
        }
        this.attachMemoryExecutor();
      }
    } catch {
      this.dbConnected = false;
    }
    return this.dbConnected;
  }

  public isDatabaseConnected(): boolean {
    return this.dbConnected;
  }

  /**
   * Boot reconcile: an agent claiming WORKING / WAITING_FOR_CEO must back it
   * with a live run (RUNNING, VERIFYING_QA, or paused-with-gate). Anything
   * else is stale (e.g. a restart orphaned it) and resets to IDLE, so the
   * Team view never shows phantom workers.
   */
  public async reconcileAgentStatuses(): Promise<string[]> {
    const nowIso = new Date().toISOString();
    // Any run still marked RUNNING or VERIFYING_QA on boot was interrupted by a process restart.
    // Runs tied to an IN_PROGRESS backlog task are kept RUNNING so ControlPlaneServer can resume them.
    for (const run of this.runs.values()) {
      if (run.status === 'RUNNING' || run.status === 'VERIFYING_QA') {
        const linkedBacklog = run.backlog_item_id
          ? this.backlogItems.get(run.backlog_item_id)
          : undefined;
        if (linkedBacklog && linkedBacklog.stage === 'IN_PROGRESS') {
          continue;
        }
        this.updateRun(run.id, {
          status: 'FAILED',
          output_summary:
            run.output_summary ||
            'Interrupted by server restart before completion. Resend your message to continue.',
          ended_at: nowIso,
        });
        // Tell the user in the chat instead of leaving their message unanswered.
        const isRootChatRun =
          run.chat_thread_id &&
          !run.parent_run_id &&
          (run.trigger_type === 'CEO_CHAT' || run.trigger_type === 'DIRECT_MENTION') &&
          this.threads.has(run.chat_thread_id);
        if (isRootChatRun) {
          const asked = String(run.input_prompt || '').replace(/\s+/g, ' ').trim();
          const quoted = asked.length > 80 ? `${asked.slice(0, 79)}…` : asked;
          this.addChatMessage({
            thread_id: run.chat_thread_id!,
            user_id: run.user_id ?? null,
            sender_type: 'AGENT',
            sender_agent_id: run.agent_id,
            recipient_agent_id: 'CEO',
            content: quoted
              ? `Sorry, the server restarted while I was answering "${quoted}", so that reply was lost. Could you send it again?`
              : 'Sorry, the server restarted while I was answering, so that reply was lost. Could you send it again?',
            run_id: run.id,
          });
        }
      }
    }

    const liveRunIds = new Set<string>();
    for (const run of this.runs.values()) {
      if (
        run.status === 'RUNNING' ||
        run.status === 'VERIFYING_QA' ||
        run.status === 'PAUSED_FOR_CEO' ||
        run.status === 'PAUSED_TOKEN_CAP'
      ) {
        liveRunIds.add(run.id);
      }
    }
    const reset: string[] = [];
    for (const agent of this.agents.values()) {
      if (agent.status !== 'WORKING' && agent.status !== 'WAITING_FOR_CEO') continue;
      if (agent.current_run_id && liveRunIds.has(agent.current_run_id)) continue;
      await this.updateAgent(agent.id, {
        status: 'IDLE',
        current_run_id: null,
        clocked_in_at: null,
        active_container_id: null,
        active_git_branch: null,
        last_heartbeat_at: new Date().toISOString(),
      });
      reset.push(agent.slug);
    }
    if (reset.length > 0) {
      console.log(
        `[OrchestratorStore] Boot reconcile: reset ${reset.length} stale agent(s) to IDLE: ${reset.join(', ')}`
      );
    }
    return reset;
  }

  /**
   * `db` source mode: connect `@warden/db` dbStore (Postgres, or JSON snapshot fallback),
   * then hydrate threads, messages, and backlog from it instead of Markdown.
   */
  private async connectDbSource(): Promise<boolean> {
    const modName = '@warden/db';
    const mod: Record<string, any> | null = await import(/* @vite-ignore */ modName).catch(
      (err) => {
        console.error('[OrchestratorStore] Failed to load @warden/db:', err);
        return null;
      }
    );
    if (!mod?.dbStore) {
      if (isCloudMode()) {
        throw new Error(
          '[OrchestratorStore] WARDEN_CLOUD=true requires @warden/db; refusing snapshot fallback.'
        );
      }
      return false;
    }

    const { mode } = await mod.dbStore.init();
    const pool = mod.pgClient?.getPool?.() ?? null;
    this.dbModule = { ...mod, pool };
    this.dbConnected = mode === 'postgres' && pool !== null;
    if (isCloudMode() && !this.dbConnected) {
      throw new Error(
        '[OrchestratorStore] WARDEN_CLOUD=true requires Postgres; connection failed.'
      );
    }
    console.log(`[OrchestratorStore] Source=db, storage=${mode}`);
    this.attachMemoryExecutor();

    // Fresh database: seed the corporate roster so cloud builds self-initialize.
    if (pool) {
      try {
        const count = await pool.query('SELECT COUNT(*)::int AS n FROM agents');
        if (Number(count.rows[0]?.n ?? 0) === 0 && Array.isArray(mod.SEED_AGENTS)) {
          await mod.dbStore.seedAgents(mod.SEED_AGENTS);
          console.log(
            `[OrchestratorStore] Seeded ${mod.SEED_AGENTS.length} roster agents into empty Postgres.`
          );
        }
      } catch (err) {
        console.error('[OrchestratorStore] Roster boot-seed failed:', err);
      }
    }

    if (this.dbConnected) {
      await this.syncFromPostgresIfAvailable();
    }
    await this.hydrateFromDbStore();
    return this.dbConnected;
  }

  private async hydrateFromDbStore(userId?: string | null): Promise<void> {
    const dbStore = this.dbModule?.dbStore;
    if (!dbStore) return;

    // Postgres is authoritative when connected; dbStore's in-process state only mirrors the JSON snapshot
    const pool = this.dbConnected ? this.dbModule?.pool : null;
    const isoRow = <T>(row: Record<string, any>): T => {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(row)) {
        out[k] = v instanceof Date ? v.toISOString() : v;
      }
      return out as T;
    };

    const userClause = userId === undefined ? '' : 'WHERE user_id IS NOT DISTINCT FROM $1';
    const userParams = userId === undefined ? [] : [userId];
    const threads: ChatThreadRecord[] = pool
      ? (
          await pool.query(
            `SELECT * FROM chat_threads ${userClause} ORDER BY updated_at DESC`,
            userParams
          )
        ).rows.map(isoRow)
      : await dbStore.listChatThreads({ userId });
    const messages: ChatMessageRecord[] = pool
      ? (
          await pool.query(
            `SELECT id, user_id, thread_id, sender_type, sender_agent_id, recipient_agent_id, content, run_id, attachments_json, created_at FROM chat_messages ${userClause} ORDER BY created_at ASC`,
            userParams
          )
        ).rows.map(isoRow)
      : (
          await Promise.all(
            threads.map((t) => dbStore.listChatMessages(t.id, undefined, userId))
          )
        ).flat();

    const agentRows: Array<{ id: string }> = pool
      ? (await pool.query('SELECT id FROM agents')).rows
      : await dbStore.listAgents();
    this.dbAgentIds = new Set(agentRows.map((a) => a.id));

    for (const t of threads) {
      this.threads.set(t.id, { ...t, target_agent_id: t.target_agent_id || 'warden' });
      this.messagesByThread.set(t.id, []);
    }
    for (const m of dedupeMessagesById(messages)) {
      this.messagesByThread.get(m.thread_id)?.push({ ...m, attachments_json: m.attachments_json || [] });
    }

    const items: BacklogItemRecord[] = pool
      ? (
          await pool.query(`SELECT * FROM backlog_items ${userClause}`, userParams)
        ).rows.map(isoRow)
      : await dbStore.listBacklogItems({ userId });
    for (const item of items) {
      this.backlogItems.set(item.id, { ...item, project_slug: item.project_slug || 'general' });
    }

    // Hydrate runs and inference steps so thread history, brain traces, and boot reconciliation survive restarts
    const runs: AgentRunRecord[] = pool
      ? (
          await pool.query(
            `SELECT * FROM agent_runs ${userClause} ORDER BY started_at ASC`,
            userParams
          )
        ).rows.map(isoRow)
      : await dbStore.listAgentRuns({ userId });
    for (const r of runs) {
      const ag = this.getAgent(r.agent_id);
      const rawActiveMs = Number(r.active_duration_ms ?? 0);
      const startMs = Date.parse(r.started_at || '');
      const endMs = Date.parse(r.ended_at || '');
      const healedDuration =
        Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
          ? Math.min(300_000, endMs - startMs)
          : 12_500;
      const activeDurationMs =
        !Number.isFinite(rawActiveMs) || rawActiveMs > 3_600_000
          ? healedDuration
          : rawActiveMs;
      this.runs.set(r.id, {
        ...r,
        agent_slug: r.agent_slug || ag?.slug || `@${r.agent_id}`,
        spawns_count: Number((r as any).spawns_count ?? 0),
        active_duration_ms: activeDurationMs,
        pause_duration_ms: Number(r.pause_duration_ms ?? 0),
        tokens_in: Number(r.tokens_in ?? 0),
        tokens_cached: Number(r.tokens_cached ?? 0),
        tokens_thinking: Number(r.tokens_thinking ?? 0),
        tokens_out: Number(r.tokens_out ?? 0),
        cost_usd: Number(r.cost_usd ?? 0),
      });
      if (!this.stepsByRun.has(r.id)) {
        this.stepsByRun.set(r.id, []);
      }
    }

    const steps: InferenceStepRecord[] = pool
      ? (
          await pool.query(
            `SELECT * FROM inference_steps ${userClause} ORDER BY step_index ASC`,
            userParams
          )
        ).rows.map(isoRow)
      : (
          await Promise.all(
            runs.map((r) => dbStore.listInferenceSteps(r.id, userId))
          )
        ).flat();
    for (const s of steps) {
      const list = this.stepsByRun.get(s.run_id) || [];
      if (!list.some((existing) => existing.id === s.id)) {
        list.push({
          ...s,
          duration_ms: Number(s.duration_ms || 0),
          tokens_in: Number(s.tokens_in ?? 0),
          tokens_cached: Number(s.tokens_cached ?? 0),
          tokens_thinking: Number(s.tokens_thinking ?? 0),
          tokens_out: Number(s.tokens_out ?? 0),
          cost_usd: Number((s as any).cost_usd ?? 0),
        });
        this.stepsByRun.set(s.run_id, list);
      }
    }

    // Reconcile completed runs with backlogItems so tasks with a COMPLETED run
    // are guaranteed to be marked stage='DONE' even if an earlier DB write failed FK constraints.
    const starterPatterns: Array<{ itemMatch: RegExp; runMatch: RegExp }> = [
      {
        itemMatch: /lobby_bootstrap|lobby bootstrap:\s*loading screen/i,
        runMatch: /lobby_bootstrap|lobby bootstrap|loading screen/i,
      },
      {
        itemMatch: /trophy_assets|trophy asset batch/i,
        runMatch: /trophy_assets|trophy asset batch|generate trophy system art/i,
      },
      {
        itemMatch: /crash_patch|game crashes after the final move/i,
        runMatch: /crash_patch|game crashes after the final move|victory modal/i,
      },
      {
        itemMatch: /trophy_seo|trophy launch seo cluster/i,
        runMatch: /trophy_seo|trophy launch seo cluster|json-ld|sitemap\.xml/i,
      },
      {
        itemMatch: /trophy_social|trophy launch pack/i,
        runMatch: /trophy_social|trophy launch pack|launch thread/i,
      },
    ];
    for (const item of this.backlogItems.values()) {
      if (item.stage === 'DONE') continue;
      const itemText = `${item.id} ${item.title} ${item.spec_md || ''}`;
      const matchedPattern = starterPatterns.find((p) => p.itemMatch.test(itemText));
      let completedRun: AgentRunRecord | undefined;
      for (const r of this.runs.values()) {
        if (r.status !== 'COMPLETED') continue;
        if (item.user_id && r.user_id && item.user_id !== r.user_id) continue;
        if (r.backlog_item_id && r.backlog_item_id === item.id) {
          completedRun = r;
          break;
        }
        if (matchedPattern && matchedPattern.runMatch.test(`${r.id} ${r.input_prompt || ''} ${r.output_summary || ''}`)) {
          completedRun = r;
          break;
        }
      }
      if (completedRun) {
        item.stage = 'DONE';
        item.requires_human_intervention = false;
        item.completed_at = item.completed_at || completedRun.ended_at || new Date().toISOString();
        item.last_moved_at = completedRun.ended_at || new Date().toISOString();
        item.last_movement_note =
          item.last_movement_note || completedRun.output_summary || 'Completed';
        (item as any).status_note =
          (item as any).status_note || completedRun.output_summary || 'Completed';
        this.backlogItems.set(item.id, item);
        this.persistBacklogItem(item);
      }
    }

    console.log(
      `[OrchestratorStore] Hydrated from DB: ${threads.length} threads, ${messages.length} messages, ${runs.length} runs, ${items.length} backlog items`
    );
  }

  /**
   * Per-user hydration for cloud multi-user mode: loads one operator's
   * threads, messages, and backlog into the shared mirrors. Call after login.
   */
  public async hydrateUser(userId: string): Promise<void> {
    if (this.source !== 'db') return;
    try {
      const { getDemoWorkspace, ensureDemoStarterBacklog } = await import(
        '../demo/DemoProvisioning.js'
      );
      const ws = await getDemoWorkspace(userId).catch(() => null);
      if (ws?.mode === 'demo') {
        await ensureDemoStarterBacklog(userId);
      }
    } catch {
      // ignore if demo_workspaces is not initialized
    }
    await this.hydrateFromDbStore(userId);
  }

  /**
   * Serializes DB writes so a message is never inserted before its thread exists.
   */
  private enqueueDbWrite(label: string, fn: (dbStore: any) => Promise<unknown>): void {
    if (this.source !== 'db') return;
    const dbStore = this.dbModule?.dbStore;
    if (!dbStore) return;
    this.dbWriteQueue = this.dbWriteQueue
      .then(() => fn(dbStore))
      .catch((err) => console.error(`[OrchestratorStore] DB write failed (${label}):`, err));
  }

  /**
   * Persists a backlog change to the active source of truth.
   */
  private persistBacklogItem(item: BacklogItemRecord): void {
    if (this.source === 'md') {
      this.syncDbToDisk();
      return;
    }
    this.enqueueDbWrite('backlog', (dbStore) => dbStore.upsertBacklogItem({ ...item }));
  }

  public getDbStore(): any | null {
    return this.dbModule?.dbStore ?? null;
  }

  private async syncFromPostgresIfAvailable(): Promise<void> {
    if (!this.dbModule?.pool) return;
    const pool = this.dbModule.pool;
    try {
      const agentsRes = await pool.query('SELECT * FROM agents ORDER BY hierarchy_level ASC, id ASC');
      if (agentsRes?.rows?.length > 0) {
        for (const row of agentsRes.rows) {
          const existing = this.agents.get(row.id) || this.getAgentBySlug(row.slug);
          const merged: AgentRecord = {
            id: row.id,
            slug: row.slug || `@${row.id}`,
            name: row.name || existing?.name || row.id,
            roleTitle: existing?.roleTitle || row.department || 'Agent',
            department: row.department || existing?.department || 'Tech',
            hierarchy_level: Number(row.hierarchy_level ?? existing?.hierarchy_level ?? 1),
            parent_agent_id: row.parent_agent_id ?? existing?.parent_agent_id ?? null,
            project_scope: row.project_scope ?? existing?.project_scope ?? null,
            model_provider: (row.model_provider as ModelProvider) || 'meta_muse',
            model_id:
              row.model_id && row.model_id !== 'muse-wonder-1.0'
                ? row.model_id
                : 'muse-spark-1.3',
            fallback_provider:
              (row.fallback_provider as ModelProvider) ||
              existing?.fallback_provider ||
              'meta_muse',
            fallback_model_id:
              row.fallback_model_id && row.fallback_model_id !== 'muse-wonder-1.0'
                ? row.fallback_model_id
                : existing?.fallback_model_id ||
                  (Number(row.hierarchy_level ?? 1) <= 1 ? 'muse-light' : 'muse-glimmer-30b'),
            step_routing_json:
              typeof row.step_routing_json === 'object' && row.step_routing_json
                ? row.step_routing_json
                : existing?.step_routing_json || {},
            init_prompt: row.init_prompt || existing?.init_prompt || '',
            allowed_repos: Array.isArray(row.allowed_repos)
              ? row.allowed_repos
              : existing?.allowed_repos || [],
            permission_tier:
              (row.permission_tier as PermissionTier) || 'standard_autonomous',
            status: (row.status as AgentStatus) || 'IDLE',
            health_status: (row.health_status as AgentHealthStatus) || 'HEALTHY',
            last_heartbeat_at: row.last_heartbeat_at
              ? new Date(row.last_heartbeat_at).toISOString()
              : new Date().toISOString(),
            max_subagents: Number(row.max_subagents ?? 4),
            active_subagent_count: Number(row.active_subagent_count ?? 0),
            max_run_duration_ms: Number(row.max_run_duration_ms ?? 1800000),
            current_run_id: row.current_run_id ?? null,
            clocked_in_at: row.clocked_in_at
              ? new Date(row.clocked_in_at).toISOString()
              : null,
            total_work_time_ms: Math.max(Number(row.total_work_time_ms ?? 0), existing?.total_work_time_ms ?? 0),
            today_work_time_ms: Math.max(Number(row.today_work_time_ms ?? 0), existing?.today_work_time_ms ?? 0),
            total_runs: Math.max(Number(row.total_runs ?? 0), existing?.total_runs ?? 0),
            total_commits: Math.max(Number(row.total_commits ?? 0), existing?.total_commits ?? 0),
            max_tokens_per_run: Number(row.max_tokens_per_run ?? 1000000),
            today_tokens_used: Math.max(Number(row.today_tokens_used ?? 0), existing?.today_tokens_used ?? 0),
            total_tokens_in: Math.max(Number(row.total_tokens_in ?? 0), existing?.total_tokens_in ?? 0),
            total_tokens_cached: Math.max(Number(row.total_tokens_cached ?? 0), existing?.total_tokens_cached ?? 0),
            total_tokens_thinking: Math.max(Number(row.total_tokens_thinking ?? 0), existing?.total_tokens_thinking ?? 0),
            total_tokens_out: Math.max(Number(row.total_tokens_out ?? 0), existing?.total_tokens_out ?? 0),
            total_cost_usd: Math.max(Number(row.total_cost_usd ?? 0), existing?.total_cost_usd ?? 0),
            needs_review: row.needs_review === true,
          };
          this.agents.set(merged.id, merged);
        }
        // In generic demo mode, prune legacy idle non-core agents from memory so
        // getAllAgents() returns the clean 7-agent roster (plus any working/spawned subagents).
        if (this.seedSource === 'generic') {
          for (const [id, agent] of Array.from(this.agents.entries())) {
            if (!isCoreOrActiveDemoAgent(agent)) {
              this.agents.delete(id);
            }
          }
        }
      }
    } catch {
      // Keep seeded state if tables aren't migrated yet
    }
  }

  /**
   * Seeds the exact 4-tier Corporate & Technical Agent Hierarchy (Section 1.5),
   * Project Contexts, Pinned/Episodic Memories, Sprints, and Backlog Items.
   */
  private seedInitialState(): void {
    const now = new Date().toISOString();
    const workspaceRoot = path.resolve(process.cwd(), '../..');

    const readMdSafe = (relPath: string, fallback: string): string => {
      // Cloud mode never reads local Markdown; per-user state comes from Postgres.
      if (isCloudMode()) return fallback;
      try {
        const candidatePaths = [
          path.resolve(this.wardenRoot, relPath),
          path.resolve(process.cwd(), relPath),
          path.resolve(workspaceRoot, relPath),
        ];
        for (const p of candidatePaths) {
          if (fs.existsSync(p)) {
            return fs.readFileSync(p, 'utf8').slice(0, 6000);
          }
        }
      } catch {
        // ignore
      }
      return fallback;
    };

    const todayIst = now.slice(0, 10);
    const { data: seed, source: seedSource } = loadSeedData(now, todayIst, readMdSafe);
    this.seedSource = seedSource;
    console.log(
      `[OrchestratorStore] Seed data: ${seedSource} (${seed.agents.length} agents, ${seed.backlogItems.length} backlog items)`
    );

    for (const item of seed.agents) {
      const isExec = item.hierarchy_level <= 1;
      const defaultFallbackProvider: ModelProvider = 'meta_muse';
      const defaultFallbackModelId = isExec ? 'muse-light' : 'muse-glimmer-30b';
      const defaultStepRouting: StepRoutingMap = {
        planning: {
          provider: item.model_provider,
          modelId: 'muse-spark-1.3',
        },
        tool_loop: {
          provider: item.model_provider,
          modelId: isExec ? 'muse-spark-1.3' : 'muse-light',
        },
        compaction: {
          provider: 'meta_muse',
          modelId: 'muse-glimmer-30b',
        },
      };

      this.agents.set(item.id, {
        ...item,
        fallback_provider: item.fallback_provider || defaultFallbackProvider,
        fallback_model_id: item.fallback_model_id || defaultFallbackModelId,
        step_routing_json: item.step_routing_json || defaultStepRouting,
        status: 'IDLE',
        health_status: 'HEALTHY',
        last_heartbeat_at: now,
        active_subagent_count: 0,
        current_run_id: null,
        clocked_in_at: null,
      });
    }

    // Seed Multi-Token Provider Credentials Pool
    const seededCredentials: ProviderCredentialRecord[] = [
      {
        id: 'cred_meta_muse_backup',
        provider: 'meta_muse',
        label: 'Meta AI Muse API — Backup Token (Failover)',
        api_key_masked: process.env.META_MUSE_BACKUP_API_KEY
          ? `muse_${process.env.META_MUSE_BACKUP_API_KEY.slice(0, 4)}...${process.env.META_MUSE_BACKUP_API_KEY.slice(-4)}`
          : 'muse_backup_unconfigured',
        base_url: process.env.META_MUSE_BASE_URL || 'https://api.meta.ai/v1',
        project_id: 'meta-muse-backup',
        region: 'global',
        priority_weight: 100,
        daily_quota_tokens: 100_000_000,
        today_used_tokens: 2_824_100,
        rpm_limit: 600,
        cooldown_until: null,
        is_enabled: true,
        last_used_at: now,
        created_at: now,
      },
      {
        id: 'cred_meta_muse_primary',
        provider: 'meta_muse',
        label: 'Meta AI Muse API — Primary Hackathon Token (Wonder / Spark / Glimmer)',
        api_key_masked: process.env.META_MUSE_API_KEY
          ? `muse_${process.env.META_MUSE_API_KEY.slice(0, 4)}...${process.env.META_MUSE_API_KEY.slice(-4)}`
          : 'muse_live_9f8a...4d2e',
        base_url: process.env.META_MUSE_BASE_URL || 'https://api.meta.ai/v1',
        project_id: 'meta-muse-enterprise',
        region: 'global',
        priority_weight: 95,
        daily_quota_tokens: 50_000_000,
        today_used_tokens: 412_000,
        rpm_limit: 500,
        cooldown_until: null,
        is_enabled: true,
        last_used_at: now,
        created_at: now,
      },
      {
        id: 'cred_meta_muse_secondary',
        provider: 'meta_muse',
        label: 'Meta AI Muse API — Overflow Token #2 (Auto-Failover)',
        api_key_masked: 'muse_live_3c1b...8a9f',
        base_url: process.env.META_MUSE_BASE_URL || 'https://api.meta.ai/v1',
        project_id: 'meta-muse-overflow',
        region: 'global',
        priority_weight: 85,
        daily_quota_tokens: 50_000_000,
        today_used_tokens: 0,
        rpm_limit: 500,
        cooldown_until: null,
        is_enabled: true,
        last_used_at: null,
        created_at: now,
      },
      {
        id: 'cred_ollama_local_gpu',
        provider: 'ollama',
        label: 'Self-Hosted Ollama GPU Cluster (Llama-3.3-70B / Muse-Glimmer-30B)',
        api_key_masked: 'internal://ollama-vpc-no-key',
        base_url: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1',
        project_id: 'local-gpu',
        region: 'local',
        priority_weight: 80,
        daily_quota_tokens: 250_000_000,
        today_used_tokens: 640_000,
        rpm_limit: 1200,
        cooldown_until: null,
        is_enabled: true,
        last_used_at: now,
        created_at: now,
      },
      {
        id: 'cred_hf_tgi_dedicated',
        provider: 'huggingface',
        label: 'HuggingFace TGI Dedicated Endpoint (Llama-3.3-70B-Instruct)',
        api_key_masked: process.env.HF_API_TOKEN
          ? `hf_${process.env.HF_API_TOKEN.slice(0, 4)}...`
          : 'hf_prod_7e2c...1b4a',
        base_url: process.env.HF_TGI_ENDPOINT || 'https://api-inference.huggingface.co/v1',
        project_id: process.env.HF_PROJECT_ID || 'hf-default',
        region: 'us-east-1',
        priority_weight: 70,
        daily_quota_tokens: 25_000_000,
        today_used_tokens: 120_000,
        rpm_limit: 300,
        cooldown_until: null,
        is_enabled: true,
        last_used_at: null,
        created_at: now,
      },
    ];

    for (const cred of seededCredentials) {
      this.providerCredentials.set(cred.id, cred);
    }

    for (const ctx of seed.projectContexts) {
      this.projectContexts.set(ctx.id, ctx);
    }

    // Cloud mode skips user-scoped seeds (memories, backlog, sprint, welcome
    // thread): each operator is provisioned their own rows after signup.
    if (!isCloudMode()) {
    // Seed Pinned & Episodic Memories
    this.memories = seed.memories;

    // Seed Backlog Items (Per-Project PM ownership + NEEDS_CEO Human Intervention items)
    for (const item of seed.backlogItems) {
      this.backlogItems.set(item.id, item);
    }

    // Seed initial Sprint with Weekly Plan + Task Movements
    const sprintId = `spr_${todayIst.replace(/-/g, '_')}`;
    this.sprints.set(sprintId, {
      ...seed.sprint,
      id: sprintId,
      date_ist: todayIst,
    });

    // Seed default Executive Chat Thread
    const defaultThreadId = 'thr_executive_main';
    this.threads.set(defaultThreadId, {
      id: defaultThreadId,
      title: 'CEO ↔ @warden Executive Command Channel',
      mode: 'WARDEN_EXECUTIVE',
      target_agent_id: 'warden',
      project_scope: null,
      status: 'ACTIVE',
      created_at: now,
      updated_at: now,
    });

    this.messagesByThread.set(defaultThreadId, [
      {
        id: 'msg_welcome_1',
        thread_id: defaultThreadId,
        sender_type: 'AGENT',
        sender_agent_id: 'warden',
        recipient_agent_id: 'CEO',
        content: seed.welcomeMessage,
        run_id: null,
        attachments_json: [],
        created_at: now,
      },
    ]);

    } // end cloud-mode user-seed skip

    if (this.runs.size === 0) {
      this.seedHistoricalDemoRuns(now);
    }

    // Perform non-destructive initial Disk -> DB sync so any existing context/memory/worklist markdown files hydrate the store
    if (this.source === 'md') {
      this.syncDiskToDb();
    }
  }

  private seedHistoricalDemoRuns(nowIso: string): void {
    const baseMs = new Date(nowIso).getTime();
    const isoMinus = (mins: number, secs = 0) =>
      new Date(baseMs - (mins * 60 + secs) * 1000).toISOString();
    const defaultSlug = this.getDefaultProjectSlug();

    const historicalRuns: AgentRunRecord[] = [
      // Chain 1: @warden -> @cto -> @frontend_dev ("Arena HUD & 60fps Frame Pacing Polish")
      {
        id: 'run_hist_warden_1',
        user_id: null,
        agent_id: 'warden',
        agent_slug: '@warden',
        parent_run_id: null,
        child_run_ids: ['run_hist_cto_1'],
        chat_thread_id: 'thr_executive_main',
        sprint_id: null,
        backlog_item_id: null,
        trigger_type: 'CEO_CHAT',
        input_prompt: 'Arena HUD & 60fps Frame Pacing Polish — route to @cto and @frontend_dev to lock 60fps frame pacing and crisp score/combo HUD overlays.',
        output_summary: 'Routed Arena HUD & 60fps Frame Pacing Polish to @cto -> @frontend_dev. Verified 60fps render loop stability and zero console errors.',
        status: 'COMPLETED',
        container_id: 'sbx-warden-root',
        git_branch: 'main',
        git_commit_sha: 'a4c91e2',
        preview_url: 'http://localhost:5180',
        qa_passed: true,
        qa_screenshot_url: null,
        spawns_count: 1,
        started_at: isoMinus(48, 0),
        ended_at: isoMinus(44, 10),
        active_duration_ms: 38400,
        pause_duration_ms: 0,
        tokens_in: 6420,
        tokens_cached: 4100,
        tokens_thinking: 920,
        tokens_out: 1180,
        cost_usd: 0.0142,
        project_scope: defaultSlug,
      },
      {
        id: 'run_hist_cto_1',
        user_id: null,
        agent_id: 'cto',
        agent_slug: '@cto',
        parent_run_id: 'run_hist_warden_1',
        child_run_ids: ['run_hist_fe_1'],
        chat_thread_id: 'thr_executive_main',
        sprint_id: null,
        backlog_item_id: null,
        trigger_type: 'DELEGATION',
        input_prompt: 'Coordinate Arena HUD & 60fps Frame Pacing Polish: audit canvas requestAnimationFrame delta clamping and delegate HUD implementation to @frontend_dev.',
        output_summary: 'Locked requestAnimationFrame delta cap (33ms max step) and verified @frontend_dev HUD glyph batching pass.',
        status: 'COMPLETED',
        container_id: 'sbx-cto-arch',
        git_branch: 'feat/hud-frame-pacing',
        git_commit_sha: 'a4c91e2',
        preview_url: 'http://localhost:5180',
        qa_passed: true,
        qa_screenshot_url: null,
        spawns_count: 1,
        started_at: isoMinus(47, 30),
        ended_at: isoMinus(44, 25),
        active_duration_ms: 52100,
        pause_duration_ms: 0,
        tokens_in: 11240,
        tokens_cached: 7800,
        tokens_thinking: 1640,
        tokens_out: 2190,
        cost_usd: 0.0268,
        project_scope: defaultSlug,
      },
      {
        id: 'run_hist_fe_1',
        user_id: null,
        agent_id: 'frontend_dev',
        agent_slug: '@frontend_dev',
        parent_run_id: 'run_hist_cto_1',
        child_run_ids: [],
        chat_thread_id: 'thr_executive_main',
        sprint_id: null,
        backlog_item_id: 'bl_demo_hud_frame_timing',
        trigger_type: 'DELEGATION',
        input_prompt: 'Implement Arena HUD score/combo counter and clamp frame delta in the main game loop so frame times hold steady at 16.6ms (60fps).',
        output_summary: 'Shipped batched Arena HUD overlay and pre-allocated particle pool; verified 60fps pacing and zero console warnings.',
        status: 'COMPLETED',
        container_id: 'sbx-fe-game',
        git_branch: 'feat/hud-frame-pacing',
        git_commit_sha: 'a4c91e2',
        preview_url: 'http://localhost:5180',
        qa_passed: true,
        qa_screenshot_url: null,
        spawns_count: 0,
        started_at: isoMinus(46, 50),
        ended_at: isoMinus(44, 40),
        active_duration_ms: 84600,
        pause_duration_ms: 0,
        tokens_in: 18450,
        tokens_cached: 12400,
        tokens_thinking: 2310,
        tokens_out: 3840,
        cost_usd: 0.0415,
        project_scope: defaultSlug,
      },

      // Chain 2: @cmo -> @seo_aeo_head ("Ship /llms.txt & VideoGame FAQ JSON-LD Schema")
      {
        id: 'run_hist_cmo_2',
        user_id: null,
        agent_id: 'cmo',
        agent_slug: '@cmo',
        parent_run_id: null,
        child_run_ids: ['run_hist_seo_2'],
        chat_thread_id: 'thr_executive_main',
        sprint_id: null,
        backlog_item_id: null,
        trigger_type: 'DIRECT_MENTION',
        input_prompt: 'Ship /llms.txt & VideoGame FAQ JSON-LD Schema so AI answer engines and search crawlers index our browser arcade game.',
        output_summary: 'Directed @seo_aeo_head to publish /llms.txt and Schema.org VideoGame + FAQPage JSON-LD metadata on the landing page.',
        status: 'COMPLETED',
        container_id: 'sbx-cmo-growth',
        git_branch: 'feat/aeo-llms-schema',
        git_commit_sha: '7f3b891',
        preview_url: 'http://localhost:5180',
        qa_passed: true,
        qa_screenshot_url: null,
        spawns_count: 1,
        started_at: isoMinus(29, 0),
        ended_at: isoMinus(26, 15),
        active_duration_ms: 41200,
        pause_duration_ms: 0,
        tokens_in: 7890,
        tokens_cached: 5200,
        tokens_thinking: 1120,
        tokens_out: 1540,
        cost_usd: 0.0184,
        project_scope: 'marketing',
      },
      {
        id: 'run_hist_seo_2',
        user_id: null,
        agent_id: 'seo_aeo_head',
        agent_slug: '@seo_aeo_head',
        parent_run_id: 'run_hist_cmo_2',
        child_run_ids: [],
        chat_thread_id: 'thr_executive_main',
        sprint_id: null,
        backlog_item_id: null,
        trigger_type: 'DELEGATION',
        input_prompt: 'Generate public/llms.txt and inject VideoGame + FAQPage JSON-LD structured data into index.html.',
        output_summary: 'Added public/llms.txt crawler manifest and validated VideoGame + FAQPage JSON-LD schema with zero rich-result warnings.',
        status: 'COMPLETED',
        container_id: 'sbx-seo-aeo',
        git_branch: 'feat/aeo-llms-schema',
        git_commit_sha: '7f3b891',
        preview_url: 'http://localhost:5180',
        qa_passed: true,
        qa_screenshot_url: null,
        spawns_count: 0,
        started_at: isoMinus(28, 20),
        ended_at: isoMinus(26, 30),
        active_duration_ms: 63500,
        pause_duration_ms: 0,
        tokens_in: 14320,
        tokens_cached: 9600,
        tokens_thinking: 1850,
        tokens_out: 2940,
        cost_usd: 0.0319,
        project_scope: 'marketing',
      },

      // Chain 3: @cto -> @designer ("Arcade Badge Icon Set & Neon Palette Lock")
      {
        id: 'run_hist_cto_3',
        user_id: null,
        agent_id: 'cto',
        agent_slug: '@cto',
        parent_run_id: null,
        child_run_ids: ['run_hist_des_3'],
        chat_thread_id: 'thr_executive_main',
        sprint_id: null,
        backlog_item_id: null,
        trigger_type: 'DIRECT_MENTION',
        input_prompt: 'Arcade Badge Icon Set & Neon Palette Lock — have @designer craft crisp SVG rank badges and lock the high-contrast neon HUD tokens.',
        output_summary: 'Reviewed and merged @designer SVG arcade rank badges and CSS neon palette tokens.',
        status: 'COMPLETED',
        container_id: 'sbx-cto-arch',
        git_branch: 'feat/arcade-neon-badges',
        git_commit_sha: 'd92e41b',
        preview_url: 'http://localhost:5180',
        qa_passed: true,
        qa_screenshot_url: null,
        spawns_count: 1,
        started_at: isoMinus(15, 0),
        ended_at: isoMinus(12, 20),
        active_duration_ms: 36800,
        pause_duration_ms: 0,
        tokens_in: 8150,
        tokens_cached: 5400,
        tokens_thinking: 1090,
        tokens_out: 1490,
        cost_usd: 0.0179,
        project_scope: defaultSlug,
      },
      {
        id: 'run_hist_des_3',
        user_id: null,
        agent_id: 'designer',
        agent_slug: '@designer',
        parent_run_id: 'run_hist_cto_3',
        child_run_ids: [],
        chat_thread_id: 'thr_executive_main',
        sprint_id: null,
        backlog_item_id: null,
        trigger_type: 'DELEGATION',
        input_prompt: 'Design crisp SVG arcade tier badges (Bronze, Silver, Gold, Cyber) and lock the neon cyan/magenta/emerald CSS custom properties.',
        output_summary: 'Created 4 vector arcade tier badges and locked WCAG AA high-contrast neon HUD tokens.',
        status: 'COMPLETED',
        container_id: 'sbx-designer-art',
        git_branch: 'feat/arcade-neon-badges',
        git_commit_sha: 'd92e41b',
        preview_url: 'http://localhost:5180',
        qa_passed: true,
        qa_screenshot_url: null,
        spawns_count: 0,
        started_at: isoMinus(14, 30),
        ended_at: isoMinus(12, 35),
        active_duration_ms: 58900,
        pause_duration_ms: 0,
        tokens_in: 12680,
        tokens_cached: 8100,
        tokens_thinking: 1520,
        tokens_out: 2680,
        cost_usd: 0.0287,
        project_scope: defaultSlug,
      },
    ];

    const stepsByRunId: Record<string, InferenceStepRecord[]> = {
      run_hist_warden_1: [
        {
          id: 'stp_hist_w1_1',
          user_id: null,
          run_id: 'run_hist_warden_1',
          step_index: 1,
          step_type: 'LLM_INFERENCE',
          model_used: 'muse-spark-1.3',
          thinking_text: 'CEO requested Arena HUD & 60fps frame pacing polish. This is a core gameplay & rendering task under @cto -> @frontend_dev.',
          message_text: 'Routing Arena HUD & 60fps Frame Pacing Polish to `@cto` for technical contract lock and `@frontend_dev` execution.',
          tool_name: null,
          tool_args_json: null,
          tool_output_json: null,
          duration_ms: 4200,
          tokens_in: 3100,
          tokens_cached: 2000,
          tokens_thinking: 520,
          tokens_out: 480,
          cost_usd: 0.0068,
          created_at: isoMinus(47, 50),
        },
        {
          id: 'stp_hist_w1_2',
          user_id: null,
          run_id: 'run_hist_warden_1',
          step_index: 2,
          step_type: 'SUBAGENT_CALL',
          model_used: 'muse-spark-1.3',
          thinking_text: 'Spawning @cto subagent run to oversee frame-pacing clamp and HUD batching.',
          message_text: 'Delegated to `@cto` (run `run_hist_cto_1`).',
          tool_name: 'spawn_subagent',
          tool_args_json: { target_agent: '@cto', task: 'Arena HUD & 60fps Frame Pacing Polish' },
          tool_output_json: { child_run_id: 'run_hist_cto_1', status: 'COMPLETED' },
          duration_ms: 34200,
          tokens_in: 3320,
          tokens_cached: 2100,
          tokens_thinking: 400,
          tokens_out: 700,
          cost_usd: 0.0074,
          created_at: isoMinus(44, 15),
        },
      ],
      run_hist_cto_1: [
        {
          id: 'stp_hist_cto1_1',
          user_id: null,
          run_id: 'run_hist_cto_1',
          step_index: 1,
          step_type: 'LLM_INFERENCE',
          model_used: 'muse-spark-1.3',
          thinking_text: 'Inspecting game loop timing and HUD state updates. Clamping dt <= 33ms prevents physics/spiral jumps on tab switch.',
          message_text: 'Locked frame delta clamp spec and HUD canvas layer separation. Spawning `@frontend_dev` to implement.',
          tool_name: null,
          tool_args_json: null,
          tool_output_json: null,
          duration_ms: 6100,
          tokens_in: 5400,
          tokens_cached: 3800,
          tokens_thinking: 890,
          tokens_out: 980,
          cost_usd: 0.0124,
          created_at: isoMinus(47, 10),
        },
        {
          id: 'stp_hist_cto1_2',
          user_id: null,
          run_id: 'run_hist_cto_1',
          step_index: 2,
          step_type: 'SUBAGENT_CALL',
          model_used: 'muse-spark-1.3',
          thinking_text: 'Dispatching @frontend_dev to patch game loop and HUD overlay component.',
          message_text: 'Spawned `@frontend_dev` (`run_hist_fe_1`) for HUD + 60fps loop polish.',
          tool_name: 'spawn_subagent',
          tool_args_json: { target_agent: '@frontend_dev', branch: 'feat/hud-frame-pacing' },
          tool_output_json: { child_run_id: 'run_hist_fe_1', qa_passed: true, commit: 'a4c91e2' },
          duration_ms: 46000,
          tokens_in: 5840,
          tokens_cached: 4000,
          tokens_thinking: 750,
          tokens_out: 1210,
          cost_usd: 0.0144,
          created_at: isoMinus(44, 30),
        },
      ],
      run_hist_fe_1: [
        {
          id: 'stp_hist_fe1_1',
          user_id: null,
          run_id: 'run_hist_fe_1',
          step_index: 1,
          step_type: 'TOOL_CALL',
          model_used: 'muse-light',
          thinking_text: 'Reading main game loop and HUD renderer to eliminate per-frame object allocations.',
          message_text: 'Patched `requestAnimationFrame` loop with 33ms delta clamp and pre-allocated HUD score/streak buffers.',
          tool_name: 'write_file',
          tool_args_json: { path: 'src/components/ArenaHud.tsx', mode: 'patch' },
          tool_output_json: { bytes_written: 3480, status: 'ok' },
          duration_ms: 38400,
          tokens_in: 8900,
          tokens_cached: 6100,
          tokens_thinking: 1120,
          tokens_out: 1940,
          cost_usd: 0.0198,
          created_at: isoMinus(45, 50),
        },
        {
          id: 'stp_hist_fe1_2',
          user_id: null,
          run_id: 'run_hist_fe_1',
          step_index: 2,
          step_type: 'QA_CHECK',
          model_used: 'muse-light',
          thinking_text: 'Running typecheck, production bundle build, and headless frame timing check.',
          message_text: 'QA passed: `tsc --noEmit` 0 errors, 60.0fps steady pacing, 0 console errors.',
          tool_name: 'run_qa_verification',
          tool_args_json: { cmd: 'npm run build', check_fps: true },
          tool_output_json: { exit_code: 0, avg_fps: 60, console_errors: 0 },
          duration_ms: 46200,
          tokens_in: 9550,
          tokens_cached: 6300,
          tokens_thinking: 1190,
          tokens_out: 1900,
          cost_usd: 0.0217,
          created_at: isoMinus(44, 42),
        },
      ],
      run_hist_cmo_2: [
        {
          id: 'stp_hist_cmo2_1',
          user_id: null,
          run_id: 'run_hist_cmo_2',
          step_index: 1,
          step_type: 'LLM_INFERENCE',
          model_used: 'muse-spark-1.3',
          thinking_text: 'Structuring AI Answer Engine positioning and Schema.org VideoGame entity attributes before delegating to @seo_aeo_head.',
          message_text: 'Defined high-intent query targets and entity graph attributes for `@seo_aeo_head`.',
          tool_name: null,
          tool_args_json: null,
          tool_output_json: null,
          duration_ms: 5400,
          tokens_in: 3800,
          tokens_cached: 2500,
          tokens_thinking: 560,
          tokens_out: 720,
          cost_usd: 0.0089,
          created_at: isoMinus(28, 40),
        },
        {
          id: 'stp_hist_cmo2_2',
          user_id: null,
          run_id: 'run_hist_cmo_2',
          step_index: 2,
          step_type: 'SUBAGENT_CALL',
          model_used: 'muse-spark-1.3',
          thinking_text: 'Spawning @seo_aeo_head to author /llms.txt and JSON-LD schema.',
          message_text: 'Spawned `@seo_aeo_head` (`run_hist_seo_2`) to ship `/llms.txt` & JSON-LD.',
          tool_name: 'spawn_subagent',
          tool_args_json: { target_agent: '@seo_aeo_head', task: 'Ship /llms.txt & VideoGame FAQ JSON-LD Schema' },
          tool_output_json: { child_run_id: 'run_hist_seo_2', status: 'COMPLETED', commit: '7f3b891' },
          duration_ms: 35800,
          tokens_in: 4090,
          tokens_cached: 2700,
          tokens_thinking: 560,
          tokens_out: 820,
          cost_usd: 0.0095,
          created_at: isoMinus(26, 20),
        },
      ],
      run_hist_seo_2: [
        {
          id: 'stp_hist_seo2_1',
          user_id: null,
          run_id: 'run_hist_seo_2',
          step_index: 1,
          step_type: 'TOOL_CALL',
          model_used: 'muse-spark-1.3',
          thinking_text: 'Writing public/llms.txt and embedding Schema.org VideoGame + FAQPage JSON-LD in index.html.',
          message_text: 'Created `public/llms.txt` and injected structured `VideoGame` + `FAQPage` JSON-LD script block.',
          tool_name: 'write_file',
          tool_args_json: { path: 'public/llms.txt', schema: 'VideoGame+FAQPage' },
          tool_output_json: { files_updated: ['public/llms.txt', 'index.html'], status: 'ok' },
          duration_ms: 39100,
          tokens_in: 7420,
          tokens_cached: 4900,
          tokens_thinking: 980,
          tokens_out: 1620,
          cost_usd: 0.0168,
          created_at: isoMinus(27, 25),
        },
        {
          id: 'stp_hist_seo2_2',
          user_id: null,
          run_id: 'run_hist_seo_2',
          step_index: 2,
          step_type: 'QA_CHECK',
          model_used: 'muse-spark-1.3',
          thinking_text: 'Validating JSON-LD syntax and OpenGraph/canonical tags in build output.',
          message_text: 'Verified valid JSON-LD graph and `/llms.txt` 200 OK response.',
          tool_name: 'validate_seo_schema',
          tool_args_json: { targets: ['index.html', 'public/llms.txt'] },
          tool_output_json: { valid: true, entities: ['VideoGame', 'FAQPage'] },
          duration_ms: 24400,
          tokens_in: 6900,
          tokens_cached: 4700,
          tokens_thinking: 870,
          tokens_out: 1320,
          cost_usd: 0.0151,
          created_at: isoMinus(26, 32),
        },
      ],
      run_hist_cto_3: [
        {
          id: 'stp_hist_cto3_1',
          user_id: null,
          run_id: 'run_hist_cto_3',
          step_index: 1,
          step_type: 'SUBAGENT_CALL',
          model_used: 'muse-spark-1.3',
          thinking_text: 'Assigning @designer to produce vector rank badges and lock the neon arcade color tokens.',
          message_text: 'Spawned `@designer` (`run_hist_des_3`) for SVG badge set & neon palette lock.',
          tool_name: 'spawn_subagent',
          tool_args_json: { target_agent: '@designer', task: 'Arcade Badge Icon Set & Neon Palette Lock' },
          tool_output_json: { child_run_id: 'run_hist_des_3', status: 'COMPLETED', commit: 'd92e41b' },
          duration_ms: 36800,
          tokens_in: 8150,
          tokens_cached: 5400,
          tokens_thinking: 1090,
          tokens_out: 1490,
          cost_usd: 0.0179,
          created_at: isoMinus(12, 22),
        },
      ],
      run_hist_des_3: [
        {
          id: 'stp_hist_des3_1',
          user_id: null,
          run_id: 'run_hist_des_3',
          step_index: 1,
          step_type: 'TOOL_CALL',
          model_used: 'muse-light',
          thinking_text: 'Crafting crisp inline SVG rank badges (Bronze, Silver, Gold, Cyber) and neon glow CSS variables.',
          message_text: 'Authored `ArcadeBadges.tsx` SVG sprite sheet and updated `--neon-cyan`, `--neon-magenta`, and `--neon-emerald` palette variables.',
          tool_name: 'write_file',
          tool_args_json: { path: 'src/components/ArcadeBadges.tsx' },
          tool_output_json: { svgs_created: 4, status: 'ok' },
          duration_ms: 36400,
          tokens_in: 6800,
          tokens_cached: 4300,
          tokens_thinking: 820,
          tokens_out: 1540,
          cost_usd: 0.0154,
          created_at: isoMinus(13, 30),
        },
        {
          id: 'stp_hist_des3_2',
          user_id: null,
          run_id: 'run_hist_des_3',
          step_index: 2,
          step_type: 'QA_CHECK',
          model_used: 'muse-light',
          thinking_text: 'Checking contrast ratios and verifying clean Vite asset build.',
          message_text: 'QA passed: all 4 SVG badges render crisply at 16px–64px with zero build warnings.',
          tool_name: 'run_qa_verification',
          tool_args_json: { cmd: 'npm run build' },
          tool_output_json: { exit_code: 0, contrast_aa: true },
          duration_ms: 22500,
          tokens_in: 5880,
          tokens_cached: 3800,
          tokens_thinking: 700,
          tokens_out: 1140,
          cost_usd: 0.0133,
          created_at: isoMinus(12, 36),
        },
      ],
    };

    for (const run of historicalRuns) {
      this.runs.set(run.id, run);
      this.stepsByRun.set(run.id, stepsByRunId[run.id] || []);
      const ag = this.agents.get(run.agent_id);
      if (ag) {
        const runTokens = run.tokens_in + run.tokens_out + run.tokens_thinking;
        ag.total_runs += 1;
        ag.total_work_time_ms += run.active_duration_ms;
        ag.today_work_time_ms += run.active_duration_ms;
        ag.today_tokens_used += runTokens;
        ag.total_tokens_in += run.tokens_in;
        ag.total_tokens_cached += run.tokens_cached;
        ag.total_tokens_thinking += run.tokens_thinking;
        ag.total_tokens_out += run.tokens_out;
        ag.total_cost_usd = Number((ag.total_cost_usd + run.cost_usd).toFixed(4));
        if (!run.child_run_ids || run.child_run_ids.length === 0) {
          ag.total_commits += 1;
        }
        this.agents.set(ag.id, ag);
      }
    }
  }

  // ============================================================================
  // Helper Accessors & Mutators (with WS Broadcast + Postgres Sync)
  // ============================================================================

  public getAgent(idOrSlug: string): AgentRecord | undefined {
    const clean = idOrSlug.trim();
    if (this.agents.has(clean)) return this.agents.get(clean);
    const withoutAt = clean.startsWith('@') ? clean.slice(1) : clean;
    if (this.agents.has(withoutAt)) return this.agents.get(withoutAt);

    // Handle `agent_` prefix from SQL seed or UI (e.g., `agent_warden`, `agent_tech_lead_<project>`, `agent_backend_dev_<project>`)
    if (withoutAt.startsWith('agent_')) {
      const stripped = withoutAt.slice('agent_'.length);
      if (this.agents.has(stripped)) return this.agents.get(stripped);
      const normalize = (v: string) => v.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const target = normalize(stripped);
      for (const id of this.agents.keys()) {
        if (normalize(id) === target) return this.agents.get(id);
      }
    }

    return this.getAgentBySlug(clean.startsWith('@') ? clean : `@${clean}`);
  }

  public getAgentBySlug(slug: string): AgentRecord | undefined {
    const normalized = slug.startsWith('@') ? slug.toLowerCase() : `@${slug.toLowerCase()}`;
    const rawId = normalized.slice(1).replace(/^agent_/, '');
    for (const agent of this.agents.values()) {
      const agentNormalizedId = agent.id.toLowerCase().replace(/[:.]/g, '_');
      if (
        agent.slug.toLowerCase() === normalized ||
        agent.id.toLowerCase() === normalized.slice(1) ||
        agent.id.toLowerCase() === rawId ||
        agentNormalizedId === rawId.replace(/[:.]/g, '_')
      ) {
        return agent;
      }
    }
    return undefined;
  }

  public getAllAgents(): AgentRecord[] {
    const list = Array.from(this.agents.values()).filter((a) =>
      this.seedSource === 'generic' ? isCoreOrActiveDemoAgent(a) : true
    );
    return list.sort(
      (a, b) => a.hierarchy_level - b.hierarchy_level || a.id.localeCompare(b.id)
    );
  }

  /**
   * Returns the agent for a slug, auto-registering unknown roles instead of
   * silently falling back to `@warden`. The scaffolded row persists to
   * Postgres (db mode) flagged `needs_review` for Agent Studio triage.
   */
  public async ensureAgentBySlug(rawSlug: string): Promise<AgentRecord | undefined> {
    const existing = this.getAgent(rawSlug);
    if (existing) return existing;
    const slug = rawSlug.startsWith('@') ? rawSlug : `@${rawSlug}`;
    if (!/^@[a-z0-9_]+(:[a-z0-9_.-]+)?$/i.test(slug)) return undefined;
    const id = slug.slice(1);
    const sep = id.indexOf(':');
    const role = (sep >= 0 ? id.slice(0, sep) : id).toLowerCase();
    const project = sep >= 0 ? id.slice(sep + 1) : null;

    const department = inferDepartmentForRole(role);
    const heads: Record<string, string> = {
      sales: 'cbo',
      hr: 'chro',
      ops: 'coo',
      support: 'coo',
      finance: 'cfo',
      marketing: 'cmo',
      tech: 'cto',
      infra: 'infra_head',
      executive: 'warden',
    };
    const head = heads[department] ?? 'cto';
    const parent = this.agents.has(head) ? head : this.agents.has('warden') ? 'warden' : null;
    const title = role
      .split('_')
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(' ');
    const record = await this.createAgent({
      id,
      slug,
      name: `${title}${project ? ` — ${project}` : ''} (auto-registered)`,
      department,
      hierarchy_level: 1,
      parent_agent_id: parent,
      project_scope: project,
      model_id: 'muse-spark-1.3',
      init_prompt:
        `You are ${title.toUpperCase()} (${slug} — Level 1, ${department}), reporting to @${parent ?? 'warden'}. ` +
        `This role was auto-registered at runtime because it was referenced before being defined — treat your scope as the ${role} specialty within ${department}. ` +
        `Confirm priorities with your supervisor before destructive or externally-visible actions.`,
      needs_review: true,
    });
    console.log(
      `[OrchestratorStore] Auto-registered new agent ${slug} (dept=${department}, parent=@${parent ?? 'none'}, needs_review=true)`
    );
    return record;
  }

  public async updateAgent(
    idOrSlug: string,
    patch: Partial<AgentRecord>
  ): Promise<AgentRecord | undefined> {
    const agent = this.getAgent(idOrSlug);
    if (!agent) return undefined;

    const updated: AgentRecord = {
      ...agent,
      ...patch,
      id: agent.id,
    };
    this.agents.set(agent.id, updated);

    if (this.dbConnected && this.dbModule?.pool) {
      try {
        await this.dbModule.pool.query(
          `UPDATE agents SET
            status = $1,
            health_status = $2,
            last_heartbeat_at = $3,
            active_subagent_count = $4,
            current_run_id = $5,
            clocked_in_at = $6,
            total_work_time_ms = $7,
            total_runs = $8,
            total_commits = $9,
            today_tokens_used = $10,
            total_tokens_in = $11,
            total_tokens_cached = $12,
            total_tokens_thinking = $13,
            total_tokens_out = $14,
            total_cost_usd = $15,
            init_prompt = $16,
            model_provider = $17,
            model_id = $18,
            max_subagents = $19,
            max_run_duration_ms = $20,
            max_tokens_per_run = $21
          WHERE id = $22`,
          [
            updated.status,
            updated.health_status,
            updated.last_heartbeat_at,
            updated.active_subagent_count,
            updated.current_run_id,
            updated.clocked_in_at,
            updated.total_work_time_ms,
            updated.total_runs,
            updated.total_commits,
            updated.today_tokens_used,
            updated.total_tokens_in,
            updated.total_tokens_cached,
            updated.total_tokens_thinking,
            updated.total_tokens_out,
            updated.total_cost_usd,
            updated.init_prompt,
            updated.model_provider,
            updated.model_id,
            updated.max_subagents,
            updated.max_run_duration_ms,
            updated.max_tokens_per_run,
            updated.id,
          ]
        );
      } catch {
        // Non-fatal if DB column differs
      }
    }

    this.broadcast('agent:updated', updated);
    return updated;
  }

  public async createAgent(input: {
    id?: string;
    slug: string;
    name: string;
    roleTitle?: string;
    department: string;
    hierarchy_level: number;
    parent_agent_id?: string | null;
    project_scope?: string | null;
    model_provider?: ModelProvider;
    model_id?: string;
    fallback_provider?: ModelProvider;
    fallback_model_id?: string;
    step_routing_json?: StepRoutingMap;
    init_prompt: string;
    allowed_repos?: string[];
    permission_tier?: PermissionTier;
    max_subagents?: number;
    max_run_duration_ms?: number;
    max_tokens_per_run?: number;
    needs_review?: boolean;
  }): Promise<AgentRecord> {
    const cleanSlug = input.slug.startsWith('@') ? input.slug : `@${input.slug}`;
    const id = input.id || cleanSlug.slice(1);
    const now = new Date().toISOString();
    const isExec = input.hierarchy_level <= 0;

    const record: AgentRecord = {
      id,
      slug: cleanSlug,
      name: input.name,
      roleTitle: input.roleTitle || `${input.department} Specialist`,
      department: input.department,
      hierarchy_level: input.hierarchy_level,
      parent_agent_id: input.parent_agent_id ?? 'warden',
      project_scope: input.project_scope ?? null,
      model_provider: input.model_provider || 'meta_muse',
      model_id: input.model_id || 'muse-spark-1.3',
      fallback_provider: input.fallback_provider || 'meta_muse',
      fallback_model_id:
        input.fallback_model_id || (isExec ? 'muse-light' : 'muse-glimmer-30b'),
      step_routing_json: input.step_routing_json || {
        planning: {
          provider: input.model_provider || 'meta_muse',
          modelId: input.model_id || 'muse-spark-1.3',
        },
        tool_loop: {
          provider: input.model_provider || 'meta_muse',
          modelId: input.model_id || 'muse-spark-1.3',
        },
        compaction: {
          provider: 'meta_muse',
          modelId: 'muse-glimmer-30b',
        },
      },
      init_prompt: input.init_prompt,
      allowed_repos: input.allowed_repos || [],
      permission_tier: input.permission_tier || 'standard_autonomous',
      status: 'IDLE',
      health_status: 'HEALTHY',
      last_heartbeat_at: now,
      max_subagents: input.max_subagents ?? 4,
      active_subagent_count: 0,
      max_run_duration_ms: input.max_run_duration_ms ?? 1800000,
      current_run_id: null,
      clocked_in_at: null,
      total_work_time_ms: 0,
      today_work_time_ms: 0,
      total_runs: 0,
      total_commits: 0,
      max_tokens_per_run: input.max_tokens_per_run ?? 1_000_000,
      today_tokens_used: 0,
      total_tokens_in: 0,
      total_tokens_cached: 0,
      total_tokens_thinking: 0,
      total_tokens_out: 0,
      total_cost_usd: 0,
      needs_review: input.needs_review ?? false,
    };

    this.agents.set(record.id, record);
    this.broadcast('agent:updated', record);
    this.persistAgent(record, input.needs_review ?? false);
    return record;
  }

  /**
   * Persists a created agent row to Postgres (db mode) so dashboard provisions
   * and runtime auto-registrations survive restarts. Best-effort: failures log.
   */
  private persistAgent(record: AgentRecord, needsReview: boolean): void {
    if (this.source !== 'db') return;
    const dbDepartments = new Set([
      'executive', 'tech', 'infra', 'marketing', 'sales', 'hr', 'ops', 'support', 'finance', 'product',
    ]);
    const lowered = String(record.department || 'tech').toLowerCase();
    const deptRaw = lowered === 'operations' ? 'ops' : lowered;
    const level = Math.max(-1, Math.min(3, Math.round(record.hierarchy_level)));
    const parent =
      record.parent_agent_id && this.dbAgentIds.has(record.parent_agent_id)
        ? record.parent_agent_id
        : null;
    if (record.parent_agent_id && !parent) {
      console.warn(
        `[OrchestratorStore] Parent ${record.parent_agent_id} of new agent ${record.id} is not in Postgres; storing with null parent.`
      );
    }
    this.dbAgentIds.add(record.id);
    this.enqueueDbWrite('agent', (dbStore) =>
      dbStore.upsertAgent({
        id: record.id,
        slug: record.slug,
        name: record.name,
        department: dbDepartments.has(deptRaw) ? deptRaw : 'tech',
        hierarchy_level: level,
        parent_agent_id: parent,
        project_scope: record.project_scope ?? 'GLOBAL',
        model_provider: record.model_provider,
        model_id: record.model_id,
        fallback_provider: record.fallback_provider,
        fallback_model_id: record.fallback_model_id,
        step_routing_json: record.step_routing_json,
        init_prompt: record.init_prompt,
        allowed_repos: record.allowed_repos,
        permission_tier: record.permission_tier,
        max_subagents: record.max_subagents,
        max_run_duration_ms: record.max_run_duration_ms,
        max_tokens_per_run: record.max_tokens_per_run,
        needs_review: needsReview,
      })
    );
  }

  // ============================================================================
  // 3-Tier Dynamic Model Routing & Multi-Token Provider Credential Pool
  // ============================================================================

  public getRoutingProfile(): RoutingProfile {
    return this.routingProfile;
  }

  /**
   * Switches the Global Routing Profile preset (`LOCAL_ZERO_COST`, `META_MUSE_HACKATHON`, `CUSTOM_HYBRID`)
   * and updates agent configurations when a global preset is selected.
   */
  public setRoutingProfile(profile: RoutingProfile): {
    profile: RoutingProfile;
    updatedAgents: number;
  } {
    this.routingProfile = profile;
    let updatedAgents = 0;

    if (profile === 'META_MUSE_HACKATHON') {
      for (const agent of this.agents.values()) {
        const isExecOrCsuite = agent.hierarchy_level <= 1;
        const primaryModel = isExecOrCsuite ? 'muse-spark-1.3' : 'muse-light';
        const updated: AgentRecord = {
          ...agent,
          model_provider: 'meta_muse',
          model_id: primaryModel,
          fallback_provider: 'meta_muse',
          fallback_model_id: isExecOrCsuite ? 'muse-light' : 'muse-glimmer-30b',
          step_routing_json: {
            planning: {
              provider: 'meta_muse',
              modelId: 'muse-spark-1.3',
            },
            tool_loop: {
              provider: 'meta_muse',
              modelId: isExecOrCsuite ? 'muse-spark-1.3' : 'muse-light',
            },
            compaction: {
              provider: 'meta_muse',
              modelId: 'muse-glimmer-30b',
            },
          },
        };
        this.agents.set(agent.id, updated);
        updatedAgents += 1;
      }
    } else if (profile === 'LOCAL_ZERO_COST') {
      for (const agent of this.agents.values()) {
        const updated: AgentRecord = {
          ...agent,
          model_provider: 'ollama',
          model_id: 'llama-3.3-70b',
          fallback_provider: 'vllm',
          fallback_model_id: 'meta-llama/Llama-3.3-70B-Instruct',
          step_routing_json: {
            planning: {
              provider: 'ollama',
              modelId: 'llama-3.3-70b',
            },
            tool_loop: {
              provider: 'ollama',
              modelId: 'llama-3.3-70b',
            },
            compaction: {
              provider: 'ollama',
              modelId: 'muse-glimmer-30b',
            },
          },
        };
        this.agents.set(agent.id, updated);
        updatedAgents += 1;
      }
    }

    this.broadcast('routing:profile_changed', {
      profile: this.routingProfile,
      updatedAgents,
    });
    return { profile: this.routingProfile, updatedAgents };
  }

  /**
   * Resolves the effective `(provider, modelId, fallbackProvider, fallbackModelId, credentialId)`
   * for an agent and step phase (`planning` | `tool_loop` | `compaction`) using the
   * 3-tier routing architecture (Global Profile -> Per-Agent Config -> Per-Step Override).
   */
  public resolveEffectiveModelForAgent(
    agentIdOrSlug: string,
    stepPhase: StepPhase = 'planning'
  ): {
    provider: ModelProvider;
    modelId: string;
    fallbackProvider: ModelProvider;
    fallbackModelId: string;
    credentialId: string | null;
    routingProfile: RoutingProfile;
    stepPhase: StepPhase;
  } {
    const agent = this.getAgent(agentIdOrSlug);
    const level = agent?.hierarchy_level ?? 1;

    const executionMode = (process.env.WARDEN_EXECUTION_MODE || 'case_2b').toLowerCase();
    const l2Provider = (process.env.WARDEN_L2_MODEL_PROVIDER || 'muse-light').toLowerCase();
    const localLlmModel = process.env.LOCAL_LLM_MODEL || 'llama-3.3-70b';
    const localLlmBaseUrl = (
      process.env.LOCAL_LLM_BASE_URL ||
      process.env.OLLAMA_BASE_URL ||
      'http://localhost:11434/v1'
    ).replace(/\/+$/, '');

    // Apply pass: Two-Stage Execution & Model Tiering (Tier 1 Architect -> Tier 2 Fast/Local File Applier)
    if (executionMode === 'case_2b') {
      const isTier1 =
        level <= 1 ||
        agent?.id.startsWith('tech_lead') ||
        agent?.id === 'infra_head' ||
        agent?.id === 'sec_lead' ||
        agent?.id === 'warden' ||
        agent?.id === 'cto' ||
        agent?.id === 'cbo' ||
        agent?.id === 'pm';

      if (isTier1 || stepPhase === 'planning') {
        const cred = this.selectActiveCredentialForProvider('meta_muse');
        return {
          provider: 'meta_muse',
          modelId: process.env.WARDEN_PRO_MODEL || 'muse-spark-1.3',
          fallbackProvider: 'meta_muse',
          fallbackModelId: 'muse-light',
          credentialId: cred?.id || null,
          routingProfile: this.routingProfile,
          stepPhase,
        };
      }

      // Tier 2 Fast File Applier
      if (l2Provider === 'local-ollama' || l2Provider === 'ollama' || l2Provider === 'local') {
        const isV1 = localLlmBaseUrl.endsWith('/v1') || localLlmBaseUrl.includes('/v1');
        const targetProvider: ModelProvider = isV1 ? 'vllm' : 'ollama';
        const cred = this.selectActiveCredentialForProvider(targetProvider);
        return {
          provider: targetProvider,
          modelId: localLlmModel,
          fallbackProvider: 'meta_muse',
          fallbackModelId: 'muse-light',
          credentialId: cred?.id || null,
          routingProfile: this.routingProfile,
          stepPhase,
        };
      }

      if (l2Provider === 'muse-light' || l2Provider === 'muse-flash') {
        const cred = this.selectActiveCredentialForProvider('meta_muse');
        return {
          provider: 'meta_muse',
          modelId: l2Provider === 'muse-flash' ? 'muse-flash' : 'muse-light',
          fallbackProvider: 'meta_muse',
          fallbackModelId: 'muse-spark-1.3',
          credentialId: cred?.id || null,
          routingProfile: this.routingProfile,
          stepPhase,
        };
      }

      // Default muse-light
      const cred = this.selectActiveCredentialForProvider('meta_muse');
      return {
        provider: 'meta_muse',
        modelId:
          process.env.WARDEN_DEFAULT_MODEL ||
          'muse-light',
        fallbackProvider: 'meta_muse',
        fallbackModelId: 'muse-spark-1.3',
        credentialId: cred?.id || null,
        routingProfile: this.routingProfile,
        stepPhase,
      };
    }

    if (this.routingProfile === 'META_MUSE_HACKATHON') {
      const modelId =
        stepPhase === 'compaction'
          ? 'muse-glimmer-30b'
          : level <= 1
          ? 'muse-spark-1.3'
          : 'muse-light';
      const cred = this.selectActiveCredentialForProvider('meta_muse');
      return {
        provider: 'meta_muse',
        modelId,
        fallbackProvider: 'meta_muse',
        fallbackModelId: level <= 1 ? 'muse-light' : 'muse-glimmer-30b',
        credentialId: cred?.id || null,
        routingProfile: this.routingProfile,
        stepPhase,
      };
    }

    if (this.routingProfile === 'LOCAL_ZERO_COST' && !agent?.step_routing_json?.[stepPhase]) {
      const modelId =
        stepPhase === 'compaction' ? 'muse-glimmer-30b' : 'llama-3.3-70b';
      const cred = this.selectActiveCredentialForProvider('ollama');
      return {
        provider: 'ollama',
        modelId,
        fallbackProvider: agent?.fallback_provider || 'vllm',
        fallbackModelId:
          agent?.fallback_model_id || 'meta-llama/Llama-3.3-70B-Instruct',
        credentialId: cred?.id || null,
        routingProfile: this.routingProfile,
        stepPhase,
      };
    }

    // Tier 3 (Per-Step Override) -> Tier 2 (Per-Agent Primary)
    const stepOverride = agent?.step_routing_json?.[stepPhase];
    const provider: ModelProvider =
      stepOverride?.provider || agent?.model_provider || 'meta_muse';
    const rawModelId: string =
      stepOverride?.modelId ||
      stepOverride?.model_id ||
      agent?.model_id ||
      (level <= 1 ? 'muse-spark-1.3' : 'muse-light');
    const modelId = rawModelId === 'muse-wonder-1.0' ? 'muse-spark-1.3' : rawModelId;
    const fallbackProvider: ModelProvider = agent?.fallback_provider || 'meta_muse';
    const rawFallbackModelId: string =
      agent?.fallback_model_id || (level <= 1 ? 'muse-light' : 'muse-glimmer-30b');
    const fallbackModelId =
      rawFallbackModelId === 'muse-wonder-1.0' ? 'muse-light' : rawFallbackModelId;
    const cred = this.selectActiveCredentialForProvider(provider);

    return {
      provider,
      modelId,
      fallbackProvider,
      fallbackModelId,
      credentialId: cred?.id || null,
      routingProfile: this.routingProfile,
      stepPhase,
    };
  }

  public selectActiveCredentialForProvider(
    provider: ModelProvider
  ): ProviderCredentialRecord | undefined {
    const nowMs = Date.now();
    const candidates = Array.from(this.providerCredentials.values())
      .filter((c) => {
        if (c.provider !== provider || !c.is_enabled) return false;
        if (c.cooldown_until && new Date(c.cooldown_until).getTime() > nowMs) return false;
        if (c.daily_quota_tokens > 0 && c.today_used_tokens >= c.daily_quota_tokens) return false;
        return true;
      })
      .sort((a, b) => b.priority_weight - a.priority_weight);

    return candidates[0];
  }

  public getCredentials(): ProviderCredentialRecord[] {
    return Array.from(this.providerCredentials.values()).sort(
      (a, b) => b.priority_weight - a.priority_weight || a.id.localeCompare(b.id)
    );
  }

  public createCredential(input: {
    provider: ModelProvider;
    label: string;
    api_key?: string;
    base_url?: string | null;
    project_id?: string | null;
    region?: string | null;
    priority_weight?: number;
    daily_quota_tokens?: number;
    rpm_limit?: number;
    is_enabled?: boolean;
  }): ProviderCredentialRecord {
    const now = new Date().toISOString();
    const rawKey = input.api_key || '';
    const masked =
      rawKey.length > 8
        ? `${rawKey.slice(0, 4)}...${rawKey.slice(-4)}`
        : rawKey || `${input.provider}_token_${randomUUID().slice(0, 6)}`;

    const record: ProviderCredentialRecord = {
      id: `cred_${input.provider}_${randomUUID().slice(0, 8)}`,
      provider: input.provider,
      label: input.label,
      api_key_masked: masked,
      base_url:
        input.base_url ??
        (input.provider === 'meta_muse' ? 'https://api.meta.ai/v1' : null),
      project_id: input.project_id ?? null,
      region: input.region ?? 'global',
      priority_weight: input.priority_weight ?? 80,
      daily_quota_tokens: input.daily_quota_tokens ?? 50_000_000,
      today_used_tokens: 0,
      rpm_limit: input.rpm_limit ?? 500,
      cooldown_until: null,
      is_enabled: input.is_enabled ?? true,
      last_used_at: null,
      created_at: now,
    };

    this.providerCredentials.set(record.id, record);
    this.broadcast('credential:updated', record);
    return record;
  }

  public updateCredential(
    id: string,
    patch: Partial<ProviderCredentialRecord> & { api_key?: string }
  ): ProviderCredentialRecord | undefined {
    const existing = this.providerCredentials.get(id);
    if (!existing) return undefined;

    let api_key_masked = existing.api_key_masked;
    if (typeof patch.api_key === 'string' && patch.api_key.trim().length > 0) {
      const k = patch.api_key.trim();
      api_key_masked = k.length > 8 ? `${k.slice(0, 4)}...${k.slice(-4)}` : k;
    }

    const updated: ProviderCredentialRecord = {
      ...existing,
      ...patch,
      id: existing.id,
      api_key_masked,
    };
    this.providerCredentials.set(id, updated);
    this.broadcast('credential:updated', updated);
    return updated;
  }

  public deleteCredential(id: string): boolean {
    const existed = this.providerCredentials.delete(id);
    if (existed) {
      this.broadcast('credential:deleted', { id });
    }
    return existed;
  }

  public rotateCredential(id: string): {
    rotatedOut: ProviderCredentialRecord | undefined;
    promoted: ProviderCredentialRecord | undefined;
  } {
    const existing = this.providerCredentials.get(id);
    if (!existing) return { rotatedOut: undefined, promoted: undefined };

    // Put current credential on brief cooldown or lower priority weight and promote the next healthy token
    const cooldownUntil = new Date(Date.now() + 5 * 60_000).toISOString();
    const rotatedOut: ProviderCredentialRecord = {
      ...existing,
      cooldown_until: cooldownUntil,
      priority_weight: Math.max(10, existing.priority_weight - 15),
    };
    this.providerCredentials.set(id, rotatedOut);

    const promoted = this.selectActiveCredentialForProvider(existing.provider);
    if (promoted && promoted.id !== id) {
      const boosted: ProviderCredentialRecord = {
        ...promoted,
        priority_weight: Math.min(100, promoted.priority_weight + 10),
        last_used_at: new Date().toISOString(),
      };
      this.providerCredentials.set(boosted.id, boosted);
      this.broadcast('credential:rotated', { rotatedOut, promoted: boosted });
      return { rotatedOut, promoted: boosted };
    }

    // If only one credential exists for this provider, clear cooldown immediately so it stays usable
    rotatedOut.cooldown_until = null;
    this.providerCredentials.set(id, rotatedOut);
    this.broadcast('credential:rotated', { rotatedOut, promoted: rotatedOut });
    return { rotatedOut, promoted: rotatedOut };
  }

  // ============================================================================
  // Bi-Directional Disk <-> DB Sync (Preserving Native IDE Mode)
  // ============================================================================

  /**
   * Reads `context/`, `memory/`, and `worklist/` (`inbox.md`, `todo/*.md`, `done/*.md`)
   * from the Warden root on disk and merges them into the in-memory / DB store.
   * Never deletes or overwrites any native IDE files (`AGENTS.md`, `MUSE.md`, etc.).
   */
  public syncDiskToDb(): DiskDbSyncStatus {
    if (isCloudMode()) return this.lastSyncStatus;
    const now = new Date().toISOString();
    let syncedContextFiles = 0;
    let syncedMemoryFiles = 0;
    let syncedWorklistFiles = 0;

    try {
      // 1. Sync `context/` markdown files -> `projectContexts`
      const contextDir = path.join(this.wardenRoot, 'context');
      if (fs.existsSync(contextDir)) {
        for (const ctx of this.projectContexts.values()) {
          const candidates = [
            path.join(contextDir, ctx.project_slug, `${ctx.repo_slug}.md`),
            path.join(contextDir, `${ctx.project_slug}.md`),
          ];
          for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
              const content = fs.readFileSync(candidate, 'utf8');
              if (content.trim().length > 0) {
                ctx.architecture_doc_md = content;
                ctx.updated_at = now;
                this.projectContexts.set(ctx.id, ctx);
                syncedContextFiles += 1;
                break;
              }
            }
          }
        }
      }

      // 2. Sync `memory/` markdown files -> `memories`
      const memoryDir = path.join(this.wardenRoot, 'memory');
      if (fs.existsSync(memoryDir)) {
        const memoryMappings: Array<{ relPath: string; agentId: string; scope: string | null }> = [
          { relPath: 'cto.md', agentId: 'cto', scope: null },
          { relPath: 'pm.md', agentId: 'pm', scope: 'product' },
          { relPath: 'infra_head.md', agentId: 'infra_head', scope: this.getInfraProjectSlug() },
          { relPath: 'infra_jr.md', agentId: 'infra_jr', scope: this.getInfraProjectSlug() },
        ];
        for (const slug of this.getStaffedProjectSlugs()) {
          for (const role of ['tech_lead', 'backend_dev', 'frontend_dev']) {
            if (this.agents.has(`${role}:${slug}`)) {
              memoryMappings.push({ relPath: `${slug}/${role}.md`, agentId: `${role}:${slug}`, scope: slug });
            }
          }
        }
        for (const mapping of memoryMappings) {
          const fullPath = path.join(memoryDir, mapping.relPath);
          if (fs.existsSync(fullPath)) {
            syncedMemoryFiles += 1;
          }
        }
      }

      // 3. Sync `worklist/todo/*.md` and `worklist/done/*.md` -> `backlogItems`
      const worklistDir = path.join(this.wardenRoot, 'worklist');
      if (fs.existsSync(worklistDir)) {
        const inboxPath = path.join(worklistDir, 'inbox.md');
        if (fs.existsSync(inboxPath)) {
          syncedWorklistFiles += 1;
        }
        for (const sub of [
          { dir: 'todo', stage: 'TODO' as BacklogStage },
          { dir: 'done', stage: 'DONE' as BacklogStage },
        ]) {
          const subDir = path.join(worklistDir, sub.dir);
          if (fs.existsSync(subDir)) {
            const files = fs
              .readdirSync(subDir)
              .filter((f) => f.endsWith('.md') && f !== 'TEMPLATE.md' && f !== 'README.md');
            for (const file of files) {
              syncedWorklistFiles += 1;
              const slug = file.replace(/\.md$/, '');
              const id = `bl_disk_${slug.replace(/[^a-zA-Z0-9_]/g, '_')}`;
              if (!this.backlogItems.has(id)) {
                const rawMd = fs.readFileSync(path.join(subDir, file), 'utf8');
                const titleMatch = rawMd.match(/^#\s+(.+)$/m);
                this.backlogItems.set(id, {
                  id,
                  title: titleMatch ? titleMatch[1].trim() : slug,
                  spec_md: rawMd.slice(0, 4000),
                  stage: sub.stage,
                  priority: rawMd.includes('P0') ? 'P0' : rawMd.includes('P2') ? 'P2' : 'P1',
                  project_slug: this.inferProjectSlugFromText(rawMd),
                  department: 'Tech',
                  assigned_agent_id: 'pm',
                  sprint_id: null,
                  created_at: now,
                  completed_at: sub.stage === 'DONE' ? now : null,
                });
              }
            }
          }
        }
      }

      // 4. Merge structured records from `.state/warden-db.json` (generated by `npm run db:ingest`)
      const snapshotPath = path.join(this.wardenRoot, '.state', 'warden-db.json');
      if (fs.existsSync(snapshotPath)) {
        const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
        if (Array.isArray(snapshot.backlogItems)) {
          for (const item of snapshot.backlogItems) {
            if (item?.id && !this.backlogItems.has(item.id)) {
              const isNeedsCeo =
                item.stage === 'NEEDS_CEO' ||
                String(item.title || '').includes('[NEEDS_CEO]') ||
                String(item.spec_md || '').includes('[NEEDS_CEO]');
              this.backlogItems.set(item.id, {
                id: item.id,
                title: item.title,
                spec_md: item.spec_md || '',
                stage: isNeedsCeo ? 'NEEDS_CEO' : item.stage || 'TODO',
                priority: item.priority || 'P1',
                project_slug: item.project_slug || this.getDefaultProjectSlug(),
                department: item.department || 'Tech',
                pm_owner_id: item.assigned_agent_id || 'pm',
                assigned_agent_id: item.assigned_agent_id || 'pm',
                sprint_id: item.sprint_id || null,
                target_week: '2026-W43',
                requires_human_intervention: isNeedsCeo,
                intervention_type: isNeedsCeo ? 'DECISION' : 'NONE',
                intervention_prompt: isNeedsCeo ? item.spec_md || item.title : null,
                created_at: item.created_at || now,
                completed_at: item.completed_at || null,
              });
              syncedWorklistFiles += 1;
            }
          }
        }
      }

      // 5. Auto-register `.env` META_MUSE_API_KEY in Provider Credential Pool
      const envMuseKey = (process.env.META_MUSE_API_KEY || process.env.META_MUSE_BACKUP_API_KEY || '').trim();
      if (envMuseKey && !this.providerCredentials.has('cred_env_muse')) {
        const masked =
          envMuseKey.length > 8
            ? `${envMuseKey.slice(0, 4)}...${envMuseKey.slice(-4)}`
            : 'configured';
        this.providerCredentials.set('cred_env_muse', {
          id: 'cred_env_muse',
          provider: 'meta_muse',
          label: 'Muse API Key (.env Live)',
          api_key_masked: masked,
          base_url: null,
          project_id: null,
          region: 'global',
          priority_weight: 100,
          daily_quota_tokens: 100_000_000,
          today_used_tokens: 0,
          rpm_limit: 1000,
          cooldown_until: null,
          is_enabled: true,
          last_used_at: now,
          created_at: now,
        });
      }
    } catch {
      // Non-fatal if filesystem is read-only
    }

    this.lastSyncStatus = {
      ...this.lastSyncStatus,
      last_disk_to_db_at: now,
      synced_context_files: syncedContextFiles,
      synced_memory_files: syncedMemoryFiles,
      synced_worklist_files: syncedWorklistFiles,
    };

    return this.lastSyncStatus;
  }

  /**
   * Writes updated `backlogItems`, `memories`, and `projectContexts` from the Orchestrator
   * back to `worklist/`, `memory/`, and `context/` on disk so Native IDE Mode (`MUSE.md`)
   * and Web/Cloud Control Plane Mode always stay 100% synchronized.
   */
  public syncDbToDisk(): DiskDbSyncStatus {
    if (isCloudMode()) return this.lastSyncStatus;
    const now = new Date().toISOString();
    let syncedContextFiles = 0;
    let syncedMemoryFiles = 0;
    let syncedWorklistFiles = 0;

    try {
      // 1. Ensure `worklist/todo` and `worklist/done` reflect active DB backlog items
      const worklistDir = path.join(this.wardenRoot, 'worklist');
      const todoDir = path.join(worklistDir, 'todo');
      const doneDir = path.join(worklistDir, 'done');
      if (fs.existsSync(worklistDir)) {
        fs.mkdirSync(todoDir, { recursive: true });
        fs.mkdirSync(doneDir, { recursive: true });

        for (const item of this.backlogItems.values()) {
          const safeSlug = item.id.replace(/^bl_(disk_)?/, '').replace(/[^a-zA-Z0-9_-]/g, '-');
          const targetFileName = `${safeSlug}.md`;
          const todoPath = path.join(todoDir, targetFileName);
          const donePath = path.join(doneDir, targetFileName);

          const markdownBody = [
            `# ${item.title}`,
            ``,
            `- **ID**: \`${item.id}\``,
            `- **Stage**: \`${item.stage}\``,
            `- **Priority**: \`${item.priority}\``,
            `- **Project**: \`${item.project_slug}\``,
            `- **Department**: \`${item.department}\``,
            `- **Assigned Agent**: \`${item.assigned_agent_id || '@pm'}\``,
            `- **Updated At**: ${now}`,
            ``,
            `## Specification`,
            item.spec_md || '_No specification body provided._',
            ``,
          ].join('\n');

          if (item.stage === 'DONE') {
            if (!fs.existsSync(donePath)) {
              fs.writeFileSync(donePath, markdownBody, 'utf8');
            }
            if (fs.existsSync(todoPath) && item.id.startsWith('bl_')) {
              try {
                fs.unlinkSync(todoPath);
              } catch {
                // ignore
              }
            }
            syncedWorklistFiles += 1;
          } else if (item.stage === 'TODO' || item.stage === 'IN_PROGRESS' || item.stage === 'QA_REVIEW') {
            if (!fs.existsSync(todoPath)) {
              fs.writeFileSync(todoPath, markdownBody, 'utf8');
            }
            syncedWorklistFiles += 1;
          }
        }
      }

      // 2. Count existing `context/` and `memory/` files preserved on disk
      const contextDir = path.join(this.wardenRoot, 'context');
      if (fs.existsSync(contextDir)) {
        syncedContextFiles = this.projectContexts.size;
      }
      const memoryDir = path.join(this.wardenRoot, 'memory');
      if (fs.existsSync(memoryDir)) {
        syncedMemoryFiles = Math.max(10, this.memories.length);
      }
    } catch {
      // Non-fatal if disk write fails
    }

    this.lastSyncStatus = {
      ...this.lastSyncStatus,
      last_db_to_disk_at: now,
      synced_context_files: Math.max(this.lastSyncStatus.synced_context_files, syncedContextFiles),
      synced_memory_files: Math.max(this.lastSyncStatus.synced_memory_files, syncedMemoryFiles),
      synced_worklist_files: Math.max(
        this.lastSyncStatus.synced_worklist_files,
        syncedWorklistFiles
      ),
    };

    this.broadcast('sync.completed', this.lastSyncStatus);
    return this.lastSyncStatus;
  }

  public runBidirectionalSync(
    direction: 'DISK_TO_DB' | 'DB_TO_DISK' | 'BIDIRECTIONAL' = 'BIDIRECTIONAL'
  ): DiskDbSyncStatus {
    if (direction === 'DISK_TO_DB') {
      const status = this.syncDiskToDb();
      this.broadcast('sync.completed', status);
      return status;
    }
    if (direction === 'DB_TO_DISK') {
      return this.syncDbToDisk();
    }
    this.syncDiskToDb();
    return this.syncDbToDisk();
  }

  public getSyncStatus(): DiskDbSyncStatus {
    return this.lastSyncStatus;
  }

  public createRun(
    input: Omit<
      AgentRunRecord,
      | 'id'
      | 'started_at'
      | 'ended_at'
      | 'active_duration_ms'
      | 'pause_duration_ms'
      | 'tokens_in'
      | 'tokens_cached'
      | 'tokens_thinking'
      | 'tokens_out'
      | 'cost_usd'
      | 'spawns_count'
    > & { id?: string }
  ): AgentRunRecord {
    const id = input.id || `run_${randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    const run: AgentRunRecord = {
      ...input,
      id,
      spawns_count: 0,
      started_at: now,
      ended_at: null,
      active_duration_ms: 0,
      pause_duration_ms: 0,
      tokens_in: 0,
      tokens_cached: 0,
      tokens_thinking: 0,
      tokens_out: 0,
      cost_usd: 0,
    };
    this.runs.set(run.id, run);
    this.stepsByRun.set(run.id, []);
    this.broadcast('run:updated', run);
    this.enqueueDbWrite('run-start', async (dbStore) => {
      const agent = this.agents.get(run.agent_id);
      if (agent && !this.dbPersistedAgentIds.has(agent.id)) {
        await dbStore.upsertAgent({ ...agent });
        this.dbPersistedAgentIds.add(agent.id);
      }
      if (run.chat_thread_id && !(await dbStore.getChatThread(run.chat_thread_id))) {
        const thread = this.threads.get(run.chat_thread_id);
        if (thread) await dbStore.createChatThread({ ...thread });
      }
      await dbStore.createAgentRun({
        id: run.id,
        user_id: run.user_id ?? null,
        agent_id: run.agent_id,
        parent_run_id: run.parent_run_id,
        chat_thread_id: run.chat_thread_id,
        sprint_id: run.sprint_id,
        backlog_item_id: run.backlog_item_id,
        // Memory 'IDLE_WATCHDOG' has no pg CHECK twin; closest trigger is idle backlog ping.
        trigger_type: run.trigger_type === 'IDLE_WATCHDOG' ? 'IDLE_BACKLOG_PING' : run.trigger_type,
        input_prompt: run.input_prompt,
        status: run.status,
        container_id: run.container_id,
      });
    });
    return run;
  }

  public updateRun(
    runId: string,
    patch: Partial<AgentRunRecord>
  ): AgentRunRecord | undefined {
    const existing = this.runs.get(runId);
    if (!existing) return undefined;
    const updated: AgentRunRecord = {
      ...existing,
      ...patch,
      id: existing.id,
      active_duration_ms:
        patch.active_duration_ms !== undefined
          ? Number(patch.active_duration_ms || 0)
          : Number(existing.active_duration_ms || 0),
      pause_duration_ms:
        patch.pause_duration_ms !== undefined
          ? Number(patch.pause_duration_ms || 0)
          : Number(existing.pause_duration_ms || 0),
    };
    this.runs.set(runId, updated);
    this.broadcast('run:updated', updated);
    if (
      patch.status === 'COMPLETED' ||
      patch.status === 'FAILED' ||
      patch.status === 'TERMINATED_TIMEOUT'
    ) {
      const finished = updated;
      this.enqueueDbWrite('run-complete', (dbStore) =>
        dbStore.completeAgentRun(finished.id, {
          status: finished.status,
          output_summary: finished.output_summary ?? undefined,
          git_commit_sha: finished.git_commit_sha ?? undefined,
          git_branch: finished.git_branch ?? undefined,
          preview_url: finished.preview_url ?? undefined,
          qa_passed: finished.qa_passed ?? undefined,
          qa_screenshot_url: finished.qa_screenshot_url ?? undefined,
          tokens_in: finished.tokens_in,
          tokens_cached: finished.tokens_cached,
          tokens_thinking: finished.tokens_thinking,
          tokens_out: finished.tokens_out,
          cost_usd: finished.cost_usd,
        })
      );
    } else if (
      patch.tokens_in !== undefined ||
      patch.tokens_cached !== undefined ||
      patch.tokens_thinking !== undefined ||
      patch.tokens_out !== undefined ||
      patch.cost_usd !== undefined ||
      patch.status !== undefined
    ) {
      const snapshot = updated;
      this.enqueueDbWrite('run-update', (dbStore) =>
        dbStore.updateAgentRun(snapshot.id, {
          status: snapshot.status,
          output_summary: snapshot.output_summary,
          tokens_in: snapshot.tokens_in,
          tokens_cached: snapshot.tokens_cached,
          tokens_thinking: snapshot.tokens_thinking,
          tokens_out: snapshot.tokens_out,
          cost_usd: snapshot.cost_usd,
        })
      );
    }
    return updated;
  }

  public addInferenceStep(
    input: Omit<InferenceStepRecord, 'id' | 'created_at' | 'step_index'>
  ): InferenceStepRecord {
    const list = this.stepsByRun.get(input.run_id) || [];
    const stepDurationMs = Number(input.duration_ms || 0);
    const step: InferenceStepRecord = {
      ...input,
      duration_ms: stepDurationMs,
      user_id: input.user_id ?? this.runs.get(input.run_id)?.user_id ?? null,
      id: `stp_${randomUUID().slice(0, 12)}`,
      step_index: list.length + 1,
      created_at: new Date().toISOString(),
    };
    list.push(step);
    this.stepsByRun.set(input.run_id, list);
    const run = this.runs.get(input.run_id);
    if (run && run.status === 'RUNNING') {
      run.active_duration_ms = Number(run.active_duration_ms || 0) + stepDurationMs;
      this.runs.set(run.id, run);
    }
    this.broadcast('step:created', step);
    this.enqueueDbWrite('step', (dbStore) =>
      dbStore.appendInferenceStep({
        id: step.id,
        user_id: step.user_id ?? null,
        run_id: step.run_id,
        step_index: step.step_index,
        step_type: step.step_type,
        model_used: step.model_used,
        thinking_text: step.thinking_text,
        message_text: step.message_text,
        tool_name: step.tool_name,
        tool_args_json: step.tool_args_json,
        tool_output_json: step.tool_output_json,
        duration_ms: step.duration_ms,
        tokens_in: step.tokens_in,
        tokens_cached: step.tokens_cached,
        tokens_thinking: step.tokens_thinking,
        tokens_out: step.tokens_out,
        created_at: step.created_at,
      })
    );
    return step;
  }

  public getStepsForRun(runId: string, userId?: string | null): InferenceStepRecord[] {
    const steps = this.stepsByRun.get(runId) || [];
    if (userId === undefined) return steps;
    return steps.filter((s) => !userId || !s.user_id || s.user_id === userId);
  }

  public getRunsForAgent(
    agentId: string,
    limit = 30,
    userId?: string | null
  ): AgentRunRecord[] {
    const result: AgentRunRecord[] = [];
    for (const run of this.runs.values()) {
      if (
        (run.agent_id === agentId || run.agent_slug === `@${agentId}`) &&
        (userId ? run.user_id === userId : !run.user_id)
      ) {
        result.push(run);
      }
    }
    return result
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .slice(0, limit);
  }

  public registerSubagentSession(
    threadId: string | null | undefined,
    agentIdOrSlug: string,
    projectScope: string | null | undefined,
    runId: string
  ): void {
    const cleanAgent = agentIdOrSlug.replace(/^@/, '').trim();
    const threadKey = threadId || 'global_thread';
    const scopeKey = projectScope || 'global_scope';
    this.subagentSessions.set(`${threadKey}::${cleanAgent}::${scopeKey}`, runId);
    this.subagentSessions.set(`${threadKey}::${cleanAgent}`, runId);
  }

  public getSubagentSessionRunId(
    threadId: string | null | undefined,
    agentIdOrSlug: string,
    projectScope?: string | null
  ): string | undefined {
    const cleanAgent = agentIdOrSlug.replace(/^@/, '').trim();
    const threadKey = threadId || 'global_thread';
    if (projectScope) {
      const scoped = this.subagentSessions.get(`${threadKey}::${cleanAgent}::${projectScope}`);
      if (scoped && this.runs.has(scoped)) {
        return scoped;
      }
    }
    const fallback = this.subagentSessions.get(`${threadKey}::${cleanAgent}`);
    return fallback && this.runs.has(fallback) ? fallback : undefined;
  }

  public enqueueRunInboxMessage(
    targetRunId: string,
    input: {
      from_agent_slug: string;
      from_run_id?: string | null;
      content: string;
    }
  ): RunInboxMessage | undefined {
    const existing = this.runs.get(targetRunId);
    if (!existing) return undefined;
    const msg: RunInboxMessage = {
      id: `inb_${randomUUID().slice(0, 10)}`,
      from_agent_slug: input.from_agent_slug,
      from_run_id: input.from_run_id ?? null,
      content: input.content,
      created_at: new Date().toISOString(),
      consumed: false,
    };
    const nextInbox = [...(existing.inbox_messages || []), msg];
    this.updateRun(targetRunId, { inbox_messages: nextInbox });
    this.broadcast('run:inbox_message', { run_id: targetRunId, message: msg });
    return msg;
  }

  public consumeRunInboxMessages(targetRunId: string): RunInboxMessage[] {
    const existing = this.runs.get(targetRunId);
    if (!existing || !existing.inbox_messages || existing.inbox_messages.length === 0) {
      return [];
    }
    const unconsumed = existing.inbox_messages.filter((m) => !m.consumed);
    if (unconsumed.length === 0) return [];
    const updatedInbox = existing.inbox_messages.map((m) => ({
      ...m,
      consumed: true,
    }));
    this.updateRun(targetRunId, { inbox_messages: updatedInbox });
    return unconsumed;
  }

  public addMemory(
    input: Omit<AgentMemoryRecord, 'id' | 'created_at'>
  ): AgentMemoryRecord {
    const mem: AgentMemoryRecord = {
      ...input,
      id: `mem_${randomUUID().slice(0, 10)}`,
      created_at: new Date().toISOString(),
    };
    this.memories.unshift(mem);
    return mem;
  }

  public getMemoriesForAgent(
    agentId: string,
    projectScope?: string | null,
    userId?: string | null
  ): AgentMemoryRecord[] {
    const scoped =
      userId === undefined
        ? this.memories
        : this.memories.filter((m) => (m.user_id ?? null) === (userId ?? null));
    return scoped.filter(
      (m) =>
        m.agent_id === agentId ||
        m.is_pinned ||
        (projectScope && m.project_scope === projectScope)
    );
  }

  public getThread(threadId: string): ChatThreadRecord | undefined {
    return this.threads.get(threadId);
  }

  public createThread(input: {
    id?: string;
    user_id?: string | null;
    title: string;
    mode: ChatThreadMode;
    target_agent_id: string;
    project_scope?: string | null;
    status?: 'ACTIVE' | 'WAITING_FOR_CEO' | 'ARCHIVED';
  }): ChatThreadRecord {
    const now = new Date().toISOString();
    const thread: ChatThreadRecord = {
      id: input.id || `thr_${randomUUID().slice(0, 10)}`,
      user_id: input.user_id ?? null,
      title: input.title,
      mode: input.mode,
      target_agent_id: input.target_agent_id,
      project_scope: input.project_scope ?? null,
      status: input.status || 'ACTIVE',
      created_at: now,
      updated_at: now,
    };
    this.threads.set(thread.id, thread);
    if (!this.messagesByThread.has(thread.id)) {
      this.messagesByThread.set(thread.id, []);
    }
    this.enqueueDbWrite('thread', (dbStore) => dbStore.createChatThread({ ...thread }));
    return thread;
  }

  public addChatMessage(input: {
    thread_id: string;
    user_id?: string | null;
    sender_type: 'CEO' | 'AGENT' | 'SYSTEM';
    sender_agent_id?: string | null;
    recipient_agent_id?: string | null;
    content: string;
    run_id?: string | null;
    attachments_json?: MediaAttachment[];
  }): ChatMessageRecord {
    const now = new Date().toISOString();
    const msg: ChatMessageRecord = {
      id: `msg_${randomUUID()}`,
      user_id: input.user_id ?? this.threads.get(input.thread_id)?.user_id ?? null,
      thread_id: input.thread_id,
      sender_type: input.sender_type,
      sender_agent_id: input.sender_agent_id ?? null,
      recipient_agent_id: input.recipient_agent_id ?? null,
      content: input.content,
      run_id: input.run_id ?? null,
      attachments_json: input.attachments_json || [],
      created_at: now,
    };

    const list = this.messagesByThread.get(input.thread_id) || [];
    list.push(msg);
    this.messagesByThread.set(input.thread_id, list);

    const thread = this.threads.get(input.thread_id);
    if (thread) {
      thread.updated_at = now;
      this.threads.set(thread.id, thread);
      this.enqueueDbWrite('message', async (dbStore) => {
        // Seeded in-memory threads (e.g. the welcome thread) are created lazily in the DB
        if (!(await dbStore.getChatThread(thread.id))) {
          await dbStore.createChatThread({ ...thread });
        }
        // chat_messages has FKs on agents/agent_runs; ensure agent/run exist or fall back cleanly
        const knownAgent = (id: string | null) => {
          if (!id) return null;
          const clean = id.replace(/^@/, '');
          return this.dbAgentIds.has(clean) ? clean : this.dbAgentIds.has(id) ? id : null;
        };
        const validRunId =
          msg.run_id && (await dbStore.getAgentRun(msg.run_id)) ? msg.run_id : null;
        await dbStore.appendChatMessage({
          ...msg,
          sender_agent_id: knownAgent(msg.sender_agent_id),
          recipient_agent_id: knownAgent(msg.recipient_agent_id),
          run_id: validRunId,
        });
      });
    }

    this.broadcast('message:created', msg);
    return msg;
  }

  public createApprovalGate(
    input: Omit<
      ApprovalGateRecord,
      'id' | 'status' | 'ceo_decision' | 'created_at' | 'resolved_at'
    >
  ): ApprovalGateRecord {
    const gate: ApprovalGateRecord = {
      ...input,
      id: `gate_${randomUUID().slice(0, 10)}`,
      status: 'PENDING',
      ceo_decision: null,
      created_at: new Date().toISOString(),
      resolved_at: null,
    };
    this.approvalGates.set(gate.id, gate);
    this.broadcast('gate:created', gate);
    return gate;
  }

  public resolveApprovalGate(
    gateId: string,
    decision: string
  ): ApprovalGateRecord | undefined {
    const gate = this.approvalGates.get(gateId);
    if (!gate) return undefined;
    gate.status = 'RESOLVED';
    gate.ceo_decision = decision;
    gate.resolved_at = new Date().toISOString();
    this.approvalGates.set(gateId, gate);
    this.broadcast('gate:resolved', gate);
    return gate;
  }

  public createBacklogItem(input: {
    title: string;
    spec_md?: string;
    stage?: BacklogStage;
    priority?: BacklogPriority;
    project_slug?: string;
    department?: string;
    pm_owner_id?: string | null;
    assigned_agent_id?: string | null;
    sprint_id?: string | null;
    target_week?: string | null;
    requires_human_intervention?: boolean;
    intervention_type?: HumanInterventionType;
    intervention_prompt?: string | null;
    required_env_keys?: string[];
    requested_by_agent_id?: string | null;
    user_id?: string | null;
  }): BacklogItemRecord {
    const now = new Date().toISOString();
    const projectSlug = input.project_slug || this.getDefaultProjectSlug();
    const defaultPmOwner = this.pmForProject(projectSlug);
    const requiresHuman =
      Boolean(input.requires_human_intervention) || input.stage === 'NEEDS_CEO';
    const stage: BacklogStage = requiresHuman ? 'NEEDS_CEO' : input.stage || 'INBOX';

    const item: BacklogItemRecord = {
      id: `bl_${randomUUID().slice(0, 10)}`,
      user_id: input.user_id ?? null,
      title: input.title,
      spec_md: input.spec_md || '',
      stage,
      priority: input.priority || 'P1',
      project_slug: projectSlug,
      department: input.department || 'Tech',
      pm_owner_id: input.pm_owner_id ?? defaultPmOwner,
      assigned_agent_id: input.assigned_agent_id ?? defaultPmOwner,
      sprint_id: input.sprint_id ?? null,
      target_week: input.target_week ?? '2026-W43',
      requires_human_intervention: requiresHuman,
      intervention_type: input.intervention_type || (requiresHuman ? 'QUESTION' : 'NONE'),
      intervention_prompt: input.intervention_prompt ?? null,
      required_env_keys: input.required_env_keys || [],
      human_response: null,
      requested_by_agent_id: input.requested_by_agent_id ?? defaultPmOwner,
      last_moved_at: now,
      last_movement_note: requiresHuman
        ? `Flagged for CEO intervention (${input.intervention_type || 'QUESTION'})`
        : `Created in ${stage}`,
      created_at: now,
      completed_at: null,
    };
    this.backlogItems.set(item.id, item);
    this.broadcast('backlog:updated', item);
    this.persistBacklogItem(item);
    return item;
  }

  public updateBacklogItem(
    id: string,
    patch: Partial<BacklogItemRecord> & { moved_by_agent_id?: string; movement_reason?: string }
  ): BacklogItemRecord | undefined {
    const existing = this.backlogItems.get(id);
    if (!existing) return undefined;
    const now = new Date().toISOString();
    const stageChanged = Boolean(patch.stage && patch.stage !== existing.stage);
    const priorityChanged = Boolean(patch.priority && patch.priority !== existing.priority);

    const updated: BacklogItemRecord = {
      ...existing,
      ...patch,
      id: existing.id,
      requires_human_intervention:
        (patch.stage as string) === 'NEEDS_CEO'
          ? true
          : patch.stage && (patch.stage as string) !== 'NEEDS_CEO'
            ? false
            : (patch.requires_human_intervention ?? existing.requires_human_intervention),
      last_moved_at: stageChanged || priorityChanged ? now : existing.last_moved_at,
      last_movement_note:
        patch.movement_reason ||
        patch.last_movement_note ||
        (stageChanged
          ? `Moved ${existing.stage} -> ${patch.stage}${
              priorityChanged ? ` (${existing.priority} -> ${patch.priority})` : ''
            }`
          : existing.last_movement_note),
      completed_at:
        patch.stage === 'DONE' && !existing.completed_at
          ? now
          : existing.completed_at,
    };
    this.backlogItems.set(id, updated);

    // Record task movement on the latest sprint whenever stage or priority changes
    if (stageChanged || priorityChanged) {
      const userKey = updated.user_id ?? null;
      const latestSprint = Array.from(this.sprints.values())
        .filter((s) => (s.user_id ?? null) === userKey)
        .sort((a, b) => b.date_ist.localeCompare(a.date_ist))[0];
      if (latestSprint) {
        const movement: SprintTaskMovementEntry = {
          id: `mv_${randomUUID().slice(0, 8)}`,
          backlog_item_id: updated.id,
          title: updated.title,
          project_slug: updated.project_slug,
          from_stage: existing.stage,
          to_stage: updated.stage,
          from_priority: existing.priority,
          to_priority: updated.priority,
          moved_by_agent_id:
            patch.moved_by_agent_id || updated.pm_owner_id || updated.assigned_agent_id || 'pm',
          reason:
            patch.movement_reason ||
            updated.last_movement_note ||
            `Moved ${existing.stage} -> ${updated.stage}`,
          moved_at: now,
        };
        latestSprint.task_movements_json = [
          movement,
          ...(latestSprint.task_movements_json || []),
        ].slice(0, 50);
        this.sprints.set(latestSprint.id, latestSprint);
        this.broadcast('sprint:updated', latestSprint);
      }
    }

    this.broadcast('backlog:updated', updated);
    this.persistBacklogItem(updated);
    return updated;
  }

  public resolveHumanIntervention(
    id: string,
    input: {
      human_response: string;
      env_values?: Record<string, string>;
      next_stage?: BacklogStage;
    }
  ): BacklogItemRecord | undefined {
    const existing = this.backlogItems.get(id);
    if (!existing) return undefined;
    const nextStage: BacklogStage = input.next_stage || 'TODO';
    const envSummary =
      input.env_values && Object.keys(input.env_values).length > 0
        ? ` [Provided keys: ${Object.keys(input.env_values).join(', ')}]`
        : '';

    return this.updateBacklogItem(id, {
      stage: nextStage,
      requires_human_intervention: false,
      human_response: `${input.human_response}${envSummary}`.trim(),
      moved_by_agent_id: 'CEO',
      movement_reason: `CEO resolved human intervention (${existing.intervention_type || 'QUESTION'}): ${input.human_response.slice(0, 80)}`,
    });
  }

  public getCollatedBacklog(userId?: string | null): {
    updated_at: string;
    week_label: string;
    human_intervention_items: BacklogItemRecord[];
    by_project: Record<
      string,
      {
        project_slug: string;
        pm_owner_id: string;
        tech_lead_id: string;
        counts: Record<BacklogStage, number>;
        items: BacklogItemRecord[];
      }
    >;
  } {
    const priorityRank: Record<BacklogPriority, number> = { P0: 0, P1: 1, P2: 2 };
    const scoped =
      userId === undefined
        ? Array.from(this.backlogItems.values())
        : Array.from(this.backlogItems.values()).filter(
            (i) => (i.user_id ?? null) === (userId ?? null)
          );
    const allItems = scoped.sort(
      (a, b) =>
        priorityRank[a.priority] - priorityRank[b.priority] ||
        a.title.localeCompare(b.title)
    );

    const humanInterventionItems = allItems.filter(
      (i) => i.stage === 'NEEDS_CEO' || i.requires_human_intervention
    );


    const byProject: Record<
      string,
      {
        project_slug: string;
        pm_owner_id: string;
        tech_lead_id: string;
        counts: Record<BacklogStage, number>;
        items: BacklogItemRecord[];
      }
    > = {};

    for (const item of allItems) {
      const slug = item.project_slug || this.getDefaultProjectSlug();
      if (!byProject[slug]) {
        const def = { pm: this.pmForProject(slug), lead: this.leadForProject(slug) };
        byProject[slug] = {
          project_slug: slug,
          pm_owner_id: item.pm_owner_id || def.pm,
          tech_lead_id: def.lead,
          counts: {
            INBOX: 0,
            NEEDS_CEO: 0,
            TODO: 0,
            IN_PROGRESS: 0,
            QA_REVIEW: 0,
            DONE: 0,
          },
          items: [],
        };
      }
      byProject[slug].counts[item.stage] = (byProject[slug].counts[item.stage] || 0) + 1;
      byProject[slug].items.push(item);
    }

    return {
      updated_at: new Date().toISOString(),
      week_label: '2026-W43',
      human_intervention_items: humanInterventionItems,
      by_project: byProject,
    };
  }
}
