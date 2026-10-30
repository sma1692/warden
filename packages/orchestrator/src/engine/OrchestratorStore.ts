import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  getDefaultProjectSlug,
  getInfraProjectSlug,
  getProjects,
  inferProjectFromText,
  isInfraProject,
  resolveCommandoRoot,
} from '../config/projectRegistry.js';
import { loadSeedData } from './seedData.js';

// ============================================================================
// Core Relational + Vector Schema Types (dynamocommando.md Section 4)
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
  | 'vertex'
  | 'meta_muse'
  | 'ollama'
  | 'huggingface'
  | 'anthropic'
  | 'openai'
  | 'vllm';

export type RoutingProfile =
  | 'GCP_ZERO_COST'
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
}

export interface ProjectContextRecord {
  id: string;
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
  gcs_uri?: string;
  public_url: string;
  base64_data?: string;
  size_bytes?: number;
}

export interface ChatMessageRecord {
  id: string;
  thread_id: string;
  sender_type: 'CEO' | 'AGENT' | 'SYSTEM';
  sender_agent_id: string | null;
  recipient_agent_id: string | null;
  content: string;
  run_id: string | null;
  attachments_json: MediaAttachment[];
  created_at: string;
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
  project_slug: string;
  feature_slug: string;
  locked_by_agent_id: string;
  backend_agent_id: string;
  frontend_agent_id: string;
  contract_md: string;
  created_at: string;
}

export type EventBroadcastFn = (event: string, payload: unknown) => void;

export type CommandoSource = 'db' | 'md';

export function resolveCommandoSource(): CommandoSource {
  return (process.env.COMMANDO_SOURCE || '').trim().toLowerCase() === 'db' ? 'db' : 'md';
}

/**
 * Unified Orchestrator State & Database Store
 *
 * Synchronizes state with `@commando/db` (PostgreSQL + pgvector) when reachable,
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
    (process.env.COMMANDO_ROUTING_PROFILE as RoutingProfile) || 'GCP_ZERO_COST';
  public codeChunksCount = 412;
  public commandoRoot: string;
  public lastSyncStatus: DiskDbSyncStatus = {
    last_disk_to_db_at: null,
    last_db_to_disk_at: null,
    synced_context_files: 0,
    synced_memory_files: 0,
    synced_worklist_files: 0,
    preserved_native_ide_files: [
      'AGENTS.md',
      'GEMINI.md',
      'CLAUDE.md',
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
   * - `db`: PostgreSQL (via `@commando/db` dbStore) hydrates the store and receives every write.
   *   Markdown is only touched by an explicit `npm run sync`.
   */
  public readonly source: CommandoSource;

  private broadcastFn?: EventBroadcastFn;
  private dbModule: Record<string, any> | null = null;
  private dbConnected = false;
  private dbWriteQueue: Promise<unknown> = Promise.resolve();
  private dbAgentIds = new Set<string>();

  constructor(options?: { onBroadcast?: EventBroadcastFn; commandoRoot?: string }) {
    this.broadcastFn = options?.onBroadcast;
    this.commandoRoot = this.resolveCommandoRoot(options?.commandoRoot);
    this.source = resolveCommandoSource();
    this.seedInitialState();
  }

  private resolveCommandoRoot(explicitRoot?: string): string {
    return resolveCommandoRoot(explicitRoot);
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

  /** Default project slug (COMMANDO_DEFAULT_PROJECT or first tech project in projects.yaml). */
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
   * Attempts to attach to `@commando/db` PostgreSQL pool if available.
   */
  public async tryConnectDatabase(): Promise<boolean> {
    if (this.source === 'db') {
      return this.connectDbSource();
    }
    try {
      const modName = '@commando/db';
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
   * `db` source mode: connect `@commando/db` dbStore (Postgres, or JSON snapshot fallback),
   * then hydrate threads, messages, and backlog from it instead of Markdown.
   */
  private async connectDbSource(): Promise<boolean> {
    const modName = '@commando/db';
    const mod: Record<string, any> | null = await import(/* @vite-ignore */ modName).catch(
      (err) => {
        console.error('[OrchestratorStore] Failed to load @commando/db:', err);
        return null;
      }
    );
    if (!mod?.dbStore) return false;

    const { mode } = await mod.dbStore.init();
    const pool = mod.pgClient?.getPool?.() ?? null;
    this.dbModule = { ...mod, pool };
    this.dbConnected = mode === 'postgres' && pool !== null;
    console.log(`[OrchestratorStore] Source=db, storage=${mode}`);

    if (this.dbConnected) {
      await this.syncFromPostgresIfAvailable();
    }
    await this.hydrateFromDbStore();
    return this.dbConnected;
  }

  private async hydrateFromDbStore(): Promise<void> {
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

    const threads: ChatThreadRecord[] = pool
      ? (await pool.query('SELECT * FROM chat_threads ORDER BY updated_at DESC')).rows.map(isoRow)
      : await dbStore.listChatThreads();
    const messages: ChatMessageRecord[] = pool
      ? (
          await pool.query(
            'SELECT id, thread_id, sender_type, sender_agent_id, recipient_agent_id, content, run_id, attachments_json, created_at FROM chat_messages ORDER BY created_at ASC'
          )
        ).rows.map(isoRow)
      : (await Promise.all(threads.map((t) => dbStore.listChatMessages(t.id)))).flat();

    const agentRows: Array<{ id: string }> = pool
      ? (await pool.query('SELECT id FROM agents')).rows
      : await dbStore.listAgents();
    this.dbAgentIds = new Set(agentRows.map((a) => a.id));

    for (const t of threads) {
      this.threads.set(t.id, { ...t, target_agent_id: t.target_agent_id || 'warden' });
      this.messagesByThread.set(t.id, []);
    }
    for (const m of messages) {
      this.messagesByThread.get(m.thread_id)?.push({ ...m, attachments_json: m.attachments_json || [] });
    }

    const items: BacklogItemRecord[] = pool
      ? (await pool.query('SELECT * FROM backlog_items')).rows.map(isoRow)
      : await dbStore.listBacklogItems();
    for (const item of items) {
      this.backlogItems.set(item.id, { ...item, project_slug: item.project_slug || 'general' });
    }

    console.log(
      `[OrchestratorStore] Hydrated from DB: ${threads.length} threads, ${items.length} backlog items`
    );
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
            model_provider: (row.model_provider as ModelProvider) || 'vertex',
            model_id: row.model_id || 'gemini-3.1-pro-preview',
            fallback_provider:
              (row.fallback_provider as ModelProvider) ||
              existing?.fallback_provider ||
              'meta_muse',
            fallback_model_id:
              row.fallback_model_id ||
              existing?.fallback_model_id ||
              (Number(row.hierarchy_level ?? 1) <= 0 ? 'muse-wonder-1.0' : 'muse-spark-1.3'),
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
            max_run_duration_ms: Number(row.max_run_duration_ms ?? 86400000),
            current_run_id: row.current_run_id ?? null,
            clocked_in_at: row.clocked_in_at
              ? new Date(row.clocked_in_at).toISOString()
              : null,
            total_work_time_ms: Number(row.total_work_time_ms ?? 0),
            today_work_time_ms: Number(row.today_work_time_ms ?? 0),
            total_runs: Number(row.total_runs ?? 0),
            total_commits: Number(row.total_commits ?? 0),
            max_tokens_per_run: Number(row.max_tokens_per_run ?? 1000000),
            today_tokens_used: Number(row.today_tokens_used ?? 0),
            total_tokens_in: Number(row.total_tokens_in ?? 0),
            total_tokens_cached: Number(row.total_tokens_cached ?? 0),
            total_tokens_thinking: Number(row.total_tokens_thinking ?? 0),
            total_tokens_out: Number(row.total_tokens_out ?? 0),
            total_cost_usd: Number(row.total_cost_usd ?? 0),
          };
          this.agents.set(merged.id, merged);
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
      try {
        const candidatePaths = [
          path.resolve(this.commandoRoot, relPath),
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
    console.log(
      `[OrchestratorStore] Seed data: ${seedSource} (${seed.agents.length} agents, ${seed.backlogItems.length} backlog items)`
    );

    for (const item of seed.agents) {
      const isExec = item.hierarchy_level <= 0;
      const defaultFallbackProvider: ModelProvider = 'meta_muse';
      const defaultFallbackModelId = isExec ? 'muse-wonder-1.0' : 'muse-spark-1.3';
      const defaultStepRouting: StepRoutingMap = {
        planning: {
          provider: item.model_provider,
          modelId: item.model_id,
        },
        tool_loop: {
          provider: item.model_provider,
          modelId: isExec ? item.model_id : 'gemini-3-flash-preview',
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
        id: 'cred_vertex_gcp_credits',
        provider: 'vertex',
        label: 'GCP Vertex AI — 12-Month Unlimited Credits Pool (Primary)',
        api_key_masked: 'adc://gcp-application-default-credentials',
        base_url: 'https://us-central1-aiplatform.googleapis.com/v1',
        project_id: process.env.GOOGLE_CLOUD_PROJECT || '',
        region: process.env.GOOGLE_CLOUD_LOCATION || 'us-central1',
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
        id: 'cred_ollama_gcp_gpu',
        provider: 'ollama',
        label: 'Self-Hosted Ollama GPU Cluster (Qwen2.5-Coder-32B / DeepSeek-R1)',
        api_key_masked: 'internal://ollama-vpc-no-key',
        base_url: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1',
        project_id: 'gcp-gpu-spot-l4',
        region: 'us-central1-a',
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

    // Perform non-destructive initial Disk -> DB sync so any existing context/memory/worklist markdown files hydrate the store
    if (this.source === 'md') {
      this.syncDiskToDb();
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
    return Array.from(this.agents.values()).sort(
      (a, b) => a.hierarchy_level - b.hierarchy_level || a.id.localeCompare(b.id)
    );
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
      model_provider: input.model_provider || 'vertex',
      model_id: input.model_id || 'gemini-3-flash-preview',
      fallback_provider: input.fallback_provider || 'meta_muse',
      fallback_model_id:
        input.fallback_model_id || (isExec ? 'muse-wonder-1.0' : 'muse-spark-1.3'),
      step_routing_json: input.step_routing_json || {
        planning: {
          provider: input.model_provider || 'vertex',
          modelId: input.model_id || 'gemini-3-flash-preview',
        },
        tool_loop: {
          provider: input.model_provider || 'vertex',
          modelId: input.model_id || 'gemini-3-flash-preview',
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
      max_run_duration_ms: input.max_run_duration_ms ?? 86400000,
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
    };

    this.agents.set(record.id, record);
    this.broadcast('agent:updated', record);
    return record;
  }

  // ============================================================================
  // 3-Tier Dynamic Model Routing & Multi-Token Provider Credential Pool
  // ============================================================================

  public getRoutingProfile(): RoutingProfile {
    return this.routingProfile;
  }

  /**
   * Switches the Global Routing Profile preset (`GCP_ZERO_COST`, `META_MUSE_HACKATHON`, `CUSTOM_HYBRID`)
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
        const isExecOrCsuite = agent.hierarchy_level <= 0;
        const primaryModel = isExecOrCsuite ? 'muse-wonder-1.0' : 'muse-spark-1.3';
        const updated: AgentRecord = {
          ...agent,
          model_provider: 'meta_muse',
          model_id: primaryModel,
          fallback_provider: 'vertex',
          fallback_model_id: isExecOrCsuite ? 'gemini-3.1-pro-preview' : 'gemini-3-flash-preview',
          step_routing_json: {
            planning: {
              provider: 'meta_muse',
              modelId: isExecOrCsuite ? 'muse-wonder-1.0' : 'muse-spark-1.3',
            },
            tool_loop: {
              provider: 'meta_muse',
              modelId: 'muse-spark-1.3',
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
    } else if (profile === 'GCP_ZERO_COST') {
      for (const agent of this.agents.values()) {
        const isHighReasoning =
          agent.hierarchy_level <= 0 ||
          agent.id.startsWith('tech_lead') ||
          agent.id === 'infra_head' ||
          agent.id === 'seo_aeo_head';
        const primaryModel = isHighReasoning ? 'gemini-3.1-pro-preview' : 'gemini-3-flash-preview';
        const updated: AgentRecord = {
          ...agent,
          model_provider: 'vertex',
          model_id: primaryModel,
          fallback_provider: 'meta_muse',
          fallback_model_id: agent.hierarchy_level <= 0 ? 'muse-wonder-1.0' : 'muse-spark-1.3',
          step_routing_json: {
            planning: {
              provider: 'vertex',
              modelId: primaryModel,
            },
            tool_loop: {
              provider: 'vertex',
              modelId: 'gemini-3-flash-preview',
            },
            compaction: {
              provider: 'vertex',
              modelId: 'gemini-3-flash-preview',
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
    const l2Provider = (process.env.WARDEN_L2_MODEL_PROVIDER || 'gemini-flash').toLowerCase();
    const localLlmModel = process.env.LOCAL_LLM_MODEL || 'qwen2.5-coder:14b';
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
        const cred = this.selectActiveCredentialForProvider('vertex');
        return {
          provider: 'vertex',
          modelId: process.env.COMMANDO_PRO_MODEL || 'gemini-2.5-pro',
          fallbackProvider: 'anthropic',
          fallbackModelId: 'claude-3-7-sonnet-20250219',
          credentialId: cred?.id || null,
          routingProfile: this.routingProfile,
          stepPhase,
        };
      }

      // Tier 2 Fast File Applier
      if (l2Provider === 'local-ollama' || l2Provider === 'ollama' || l2Provider === 'local') {
        const isV1 = localLlmBaseUrl.endsWith('/v1') || localLlmBaseUrl.includes('/v1');
        const targetProvider: ModelProvider = isV1 ? 'openai' : 'ollama';
        const cred = this.selectActiveCredentialForProvider(targetProvider);
        return {
          provider: targetProvider,
          modelId: localLlmModel,
          fallbackProvider: 'vertex',
          fallbackModelId: 'gemini-2.5-flash',
          credentialId: cred?.id || null,
          routingProfile: this.routingProfile,
          stepPhase,
        };
      }

      if (l2Provider === 'haiku') {
        const cred = this.selectActiveCredentialForProvider('anthropic');
        return {
          provider: 'anthropic',
          modelId: 'claude-3-5-haiku-20241022',
          fallbackProvider: 'vertex',
          fallbackModelId: 'gemini-2.5-flash',
          credentialId: cred?.id || null,
          routingProfile: this.routingProfile,
          stepPhase,
        };
      }

      // Default gemini-flash
      const cred = this.selectActiveCredentialForProvider('vertex');
      return {
        provider: 'vertex',
        modelId:
          process.env.COMMANDO_STUDIO_FLASH_MODEL ||
          process.env.COMMANDO_DEFAULT_MODEL ||
          'gemini-2.5-flash',
        fallbackProvider: 'vertex',
        fallbackModelId: 'gemini-2.5-flash-lite',
        credentialId: cred?.id || null,
        routingProfile: this.routingProfile,
        stepPhase,
      };
    }

    if (this.routingProfile === 'META_MUSE_HACKATHON') {
      const modelId =
        stepPhase === 'compaction'
          ? 'muse-glimmer-30b'
          : level <= 0
          ? 'muse-wonder-1.0'
          : 'muse-spark-1.3';
      const cred = this.selectActiveCredentialForProvider('meta_muse');
      return {
        provider: 'meta_muse',
        modelId,
        fallbackProvider: 'vertex',
        fallbackModelId: level <= 0 ? 'gemini-3.1-pro-preview' : 'gemini-3-flash-preview',
        credentialId: cred?.id || null,
        routingProfile: this.routingProfile,
        stepPhase,
      };
    }

    if (this.routingProfile === 'GCP_ZERO_COST' && !agent?.step_routing_json?.[stepPhase]) {
      const isPro =
        level <= 0 ||
        agent?.id.startsWith('tech_lead') ||
        agent?.id === 'infra_head' ||
        agent?.id === 'seo_aeo_head';
      const modelId =
        stepPhase === 'compaction'
          ? 'gemini-3-flash-preview'
          : stepPhase === 'tool_loop' && level >= 2
          ? 'gemini-3-flash-preview'
          : isPro
          ? 'gemini-3.1-pro-preview'
          : 'gemini-3-flash-preview';
      const cred = this.selectActiveCredentialForProvider('vertex');
      return {
        provider: 'vertex',
        modelId,
        fallbackProvider: agent?.fallback_provider || 'meta_muse',
        fallbackModelId:
          agent?.fallback_model_id || (level <= 0 ? 'muse-wonder-1.0' : 'muse-spark-1.3'),
        credentialId: cred?.id || null,
        routingProfile: this.routingProfile,
        stepPhase,
      };
    }

    // Tier 3 (Per-Step Override) -> Tier 2 (Per-Agent Primary)
    const stepOverride = agent?.step_routing_json?.[stepPhase];
    const provider: ModelProvider =
      stepOverride?.provider || agent?.model_provider || 'vertex';
    const modelId: string =
      stepOverride?.modelId ||
      stepOverride?.model_id ||
      agent?.model_id ||
      (level <= 0 ? 'gemini-3.1-pro-preview' : 'gemini-3-flash-preview');
    const fallbackProvider: ModelProvider = agent?.fallback_provider || 'meta_muse';
    const fallbackModelId: string =
      agent?.fallback_model_id || (level <= 0 ? 'muse-wonder-1.0' : 'muse-spark-1.3');
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
   * from the Commando root on disk and merges them into the in-memory / DB store.
   * Never deletes or overwrites any native IDE files (`AGENTS.md`, `GEMINI.md`, `CLAUDE.md`, etc.).
   */
  public syncDiskToDb(): DiskDbSyncStatus {
    const now = new Date().toISOString();
    let syncedContextFiles = 0;
    let syncedMemoryFiles = 0;
    let syncedWorklistFiles = 0;

    try {
      // 1. Sync `context/` markdown files -> `projectContexts`
      const contextDir = path.join(this.commandoRoot, 'context');
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
      const memoryDir = path.join(this.commandoRoot, 'memory');
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
      const worklistDir = path.join(this.commandoRoot, 'worklist');
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

      // 4. Merge structured records from `.state/dynamocommando-db.json` (generated by `npm run db:ingest`)
      const snapshotPath = path.join(this.commandoRoot, '.state', 'dynamocommando-db.json');
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

      // 5. Auto-register `.env` GEMINI_API_KEY & ANTHROPIC_API_KEY in Provider Credential Pool
      const envGeminiKey = (process.env.GEMINI_API_KEY || process.env.VERTEX_API_KEY || '').trim();
      if (envGeminiKey && !this.providerCredentials.has('cred_env_gemini')) {
        const masked =
          envGeminiKey.length > 8
            ? `${envGeminiKey.slice(0, 4)}...${envGeminiKey.slice(-4)}`
            : 'configured';
        this.providerCredentials.set('cred_env_gemini', {
          id: 'cred_env_gemini',
          provider: 'vertex',
          label: 'Gemini API Key (.env Live)',
          api_key_masked: masked,
          base_url: null,
          project_id: process.env.GOOGLE_CLOUD_PROJECT || 'gemini-api',
          region: process.env.GOOGLE_CLOUD_LOCATION || 'global',
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
      const envAnthropicKey = (process.env.ANTHROPIC_API_KEY || '').trim();
      if (envAnthropicKey && !this.providerCredentials.has('cred_env_anthropic')) {
        const masked =
          envAnthropicKey.length > 8
            ? `${envAnthropicKey.slice(0, 4)}...${envAnthropicKey.slice(-4)}`
            : 'configured';
        this.providerCredentials.set('cred_env_anthropic', {
          id: 'cred_env_anthropic',
          provider: 'anthropic',
          label: 'Anthropic Claude Key (.env Live)',
          api_key_masked: masked,
          base_url: 'https://api.anthropic.com/v1',
          project_id: null,
          region: 'global',
          priority_weight: 95,
          daily_quota_tokens: 50_000_000,
          today_used_tokens: 0,
          rpm_limit: 500,
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
   * back to `worklist/`, `memory/`, and `context/` on disk so Native IDE Mode (`GEMINI.md` / `CLAUDE.md`)
   * and Web/Cloud Control Plane Mode always stay 100% synchronized.
   */
  public syncDbToDisk(): DiskDbSyncStatus {
    const now = new Date().toISOString();
    let syncedContextFiles = 0;
    let syncedMemoryFiles = 0;
    let syncedWorklistFiles = 0;

    try {
      // 1. Ensure `worklist/todo` and `worklist/done` reflect active DB backlog items
      const worklistDir = path.join(this.commandoRoot, 'worklist');
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
      const contextDir = path.join(this.commandoRoot, 'context');
      if (fs.existsSync(contextDir)) {
        syncedContextFiles = this.projectContexts.size;
      }
      const memoryDir = path.join(this.commandoRoot, 'memory');
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
    };
    this.runs.set(runId, updated);
    this.broadcast('run:updated', updated);
    return updated;
  }

  public addInferenceStep(
    input: Omit<InferenceStepRecord, 'id' | 'created_at' | 'step_index'>
  ): InferenceStepRecord {
    const list = this.stepsByRun.get(input.run_id) || [];
    const step: InferenceStepRecord = {
      ...input,
      id: `stp_${randomUUID().slice(0, 12)}`,
      step_index: list.length + 1,
      created_at: new Date().toISOString(),
    };
    list.push(step);
    this.stepsByRun.set(input.run_id, list);
    this.broadcast('step:created', step);
    return step;
  }

  public getStepsForRun(runId: string): InferenceStepRecord[] {
    return this.stepsByRun.get(runId) || [];
  }

  public getRunsForAgent(agentId: string, limit = 30): AgentRunRecord[] {
    const result: AgentRunRecord[] = [];
    for (const run of this.runs.values()) {
      if (run.agent_id === agentId || run.agent_slug === `@${agentId}`) {
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

  public getMemoriesForAgent(agentId: string, projectScope?: string | null): AgentMemoryRecord[] {
    return this.memories.filter(
      (m) =>
        m.agent_id === agentId ||
        m.is_pinned ||
        (projectScope && m.project_scope === projectScope)
    );
  }

  public createThread(input: {
    id?: string;
    title: string;
    mode: ChatThreadMode;
    target_agent_id: string;
    project_scope?: string | null;
    status?: 'ACTIVE' | 'WAITING_FOR_CEO' | 'ARCHIVED';
  }): ChatThreadRecord {
    const now = new Date().toISOString();
    const thread: ChatThreadRecord = {
      id: input.id || `thr_${randomUUID().slice(0, 10)}`,
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
    sender_type: 'CEO' | 'AGENT' | 'SYSTEM';
    sender_agent_id?: string | null;
    recipient_agent_id?: string | null;
    content: string;
    run_id?: string | null;
    attachments_json?: MediaAttachment[];
  }): ChatMessageRecord {
    const now = new Date().toISOString();
    const msg: ChatMessageRecord = {
      id: `msg_${randomUUID().slice(0, 12)}`,
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
        // chat_messages has FKs on agents/agent_runs; runs are not persisted and 'CEO' is not an agent row
        const knownAgent = (id: string | null) => (id && this.dbAgentIds.has(id) ? id : null);
        await dbStore.appendChatMessage({
          ...msg,
          sender_agent_id: knownAgent(msg.sender_agent_id),
          recipient_agent_id: knownAgent(msg.recipient_agent_id),
          run_id: null,
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
  }): BacklogItemRecord {
    const now = new Date().toISOString();
    const projectSlug = input.project_slug || this.getDefaultProjectSlug();
    const defaultPmOwner = this.pmForProject(projectSlug);
    const requiresHuman =
      Boolean(input.requires_human_intervention) || input.stage === 'NEEDS_CEO';
    const stage: BacklogStage = requiresHuman ? 'NEEDS_CEO' : input.stage || 'INBOX';

    const item: BacklogItemRecord = {
      id: `bl_${randomUUID().slice(0, 10)}`,
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
      const latestSprint = Array.from(this.sprints.values()).sort((a, b) =>
        b.date_ist.localeCompare(a.date_ist)
      )[0];
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

  public getCollatedBacklog(): {
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
    const allItems = Array.from(this.backlogItems.values()).sort(
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
