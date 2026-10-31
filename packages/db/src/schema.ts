// ============================================================================
// @commando/db — Drizzle ORM PostgreSQL + pgvector Schema & TypeScript Types
// ============================================================================

export type Department =
  | 'executive'
  | 'tech'
  | 'infra'
  | 'marketing'
  | 'sales'
  | 'hr'
  | 'ops'
  | 'finance';

export type HierarchyLevel = -1 | 0 | 1 | 2 | 3;

export type ModelProvider =
  | 'meta_muse'
  | 'ollama'
  | 'huggingface';

export type RoutingProfileId =
  | 'LOCAL_ZERO_COST'
  | 'META_MUSE_HACKATHON'
  | 'CUSTOM_HYBRID';

export interface StepModelRoute {
  provider: ModelProvider;
  modelId: string;
}

export interface StepRoutingConfig {
  planning?: StepModelRoute;
  tool_loop?: StepModelRoute;
  compaction?: StepModelRoute;
}

export type PermissionTier =
  | 'full_overdrive'
  | 'standard_autonomous'
  | 'strict_gate';

export type AgentStatus =
  | 'IDLE'
  | 'WORKING'
  | 'WAITING_FOR_CEO'
  | 'UNHEALTHY_LOOP'
  | 'TERMINATED_TIMEOUT'
  | 'ERROR';

export type AgentHealthStatus =
  | 'HEALTHY'
  | 'DEGRADED'
  | 'STUCK_LOOP'
  | 'ZOMBIE_NO_HEARTBEAT'
  | 'KILLED_24H_LIMIT';

export type RepoRole =
  | 'frontend'
  | 'backend'
  | 'fullstack'
  | 'infra'
  | 'shared-lib'
  | 'meta-docs';

export type MemoryType =
  | 'PINNED_PREFERENCE'
  | 'REPO_GOTCHA'
  | 'EPISODIC_LESSON'
  | 'CEO_DECISION'
  | 'OPEN_THREAD';

export type RunTriggerType =
  | 'CEO_CHAT'
  | 'DIRECT_MENTION'
  | 'DELEGATION'
  | 'DAILY_STANDUP'
  | 'STANDUP_CRON'
  | 'AGENT_DELEGATION'
  | 'IDLE_BACKLOG_PING';

export type AgentRunStatus =
  | 'RUNNING'
  | 'PAUSED_FOR_CEO'
  | 'VERIFYING_QA'
  | 'COMPLETED'
  | 'FAILED'
  | 'TERMINATED_TIMEOUT'
  | 'PAUSED_TOKEN_CAP';

export type InferenceStepType =
  | 'LLM_INFERENCE'
  | 'TOOL_CALL'
  | 'SUBAGENT_CALL'
  | 'QA_CHECK';

export type ChatThreadMode =
  | 'WARDEN_EXECUTIVE'
  | 'DIRECT_AGENT'
  | 'STANDUP'
  | 'STANDUP_ROOM';

export type ChatThreadStatus =
  | 'ACTIVE'
  | 'WAITING_FOR_CEO'
  | 'ARCHIVED';

export type ChatSenderType = 'CEO' | 'AGENT' | 'SYSTEM';

export type SprintStatus =
  | 'AWAITING_CEO_APPROVAL'
  | 'EXECUTING'
  | 'COMPLETED';

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

export type ApprovalGateType =
  | 'QUESTION'
  | 'STANDUP_SIGN_OFF'
  | 'STANDUP_SPRINT_PLAN'
  | 'DEPLOY_PERMISSION'
  | 'PROD_DEPLOY'
  | 'PAID_API_OR_SPEND'
  | 'AMBIGUOUS_REQUIREMENT'
  | 'EMPTY_BACKLOG_PING';

export type ApprovalGateStatus = 'PENDING' | 'RESOLVED' | 'APPROVED' | 'REJECTED';

export interface ChatAttachment {
  type: string;
  media_uri: string;
  public_url: string;
  filename: string;
  size_bytes?: number;
}

// ----------------------------------------------------------------------------
// Row Interfaces (snake_case DB representation)
// ----------------------------------------------------------------------------

export interface AgentRow {
  id: string;
  slug: string;
  name: string;
  department: Department;
  hierarchy_level: HierarchyLevel;
  parent_agent_id: string | null;
  project_scope: string | null;
  model_provider: ModelProvider;
  model_id: string;
  fallback_provider: ModelProvider;
  fallback_model_id: string;
  step_routing_json: StepRoutingConfig;
  init_prompt: string;
  allowed_repos: string[];
  permission_tier: PermissionTier;
  status: AgentStatus;
  health_status: AgentHealthStatus;
  last_heartbeat_at: string | null;
  max_subagents: number;
  active_subagent_count: number;
  max_run_duration_ms: number;
  current_run_id: string | null;
  clocked_in_at: string | null;
  total_work_time_ms: number;
  total_runs: number;
  total_commits: number;
  max_tokens_per_run: number;
  today_tokens_used: number;
  total_tokens_in: number;
  total_tokens_cached: number;
  total_tokens_thinking: number;
  total_tokens_out: number;
  total_cost_usd: number;
  created_at: string;
  updated_at: string;
}

export interface ProviderCredentialRow {
  id: string;
  provider: ModelProvider;
  label: string;
  api_key_encrypted: string;
  base_url: string;
  remaining_budget_usd: number | null;
  rpm_limit: number | null;
  tpm_limit: number | null;
  priority_order: number;
  is_active: boolean;
  cooldown_until: string | null;
  total_requests: number;
  total_failures: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoutingProfileRow {
  id: RoutingProfileId;
  name: string;
  description: string;
  is_active: boolean;
  config_json: {
    default_level0_provider: ModelProvider;
    default_level0_model: string;
    default_level1_provider: ModelProvider;
    default_level1_model: string;
    default_level2_provider: ModelProvider;
    default_level2_model: string;
    compaction_provider: ModelProvider;
    compaction_model: string;
  };
  updated_at: string;
}

export interface ProjectContextRow {
  id: string;
  project_slug: string;
  repo_slug: string;
  git_repo_url: string | null;
  local_path: string | null;
  default_branch: string;
  role: RepoRole;
  docker_base_image: string;
  build_cmd: string | null;
  test_cmd: string | null;
  dev_preview_port: number | null;
  architecture_doc_md: string;
  topology_json: Record<string, unknown>;
  updated_at: string;
}

export interface AgentMemoryRow {
  id: string;
  agent_id: string;
  project_scope: string | null;
  memory_type: MemoryType;
  content: string;
  source_run_id: string | null;
  is_pinned: boolean;
  embedding: number[] | null;
  created_at: string;
}

export interface AgentRunRow {
  id: string;
  agent_id: string;
  parent_run_id: string | null;
  chat_thread_id: string | null;
  sprint_id: string | null;
  backlog_item_id: string | null;
  trigger_type: RunTriggerType;
  input_prompt: string;
  output_summary: string | null;
  status: AgentRunStatus;
  container_id: string | null;
  git_branch: string | null;
  git_commit_sha: string | null;
  preview_url: string | null;
  qa_passed: boolean | null;
  qa_screenshot_url: string | null;
  started_at: string;
  ended_at: string | null;
  active_duration_ms: number;
  pause_duration_ms: number;
  tokens_in: number;
  tokens_cached: number;
  tokens_thinking: number;
  tokens_out: number;
  cost_usd: number;
}

export interface InferenceStepRow {
  id: string;
  run_id: string;
  step_index: number;
  step_type: InferenceStepType;
  model_used: string | null;
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
  created_at: string;
}

export interface ChatThreadRow {
  id: string;
  title: string;
  mode: ChatThreadMode;
  target_agent_id: string | null;
  project_scope: string | null;
  status: ChatThreadStatus;
  created_at: string;
  updated_at: string;
}

export interface ChatMessageRow {
  id: string;
  thread_id: string;
  sender_type: ChatSenderType;
  sender_agent_id: string | null;
  recipient_agent_id: string | null;
  content: string;
  run_id: string | null;
  attachments_json: ChatAttachment[];
  embedding: number[] | null;
  created_at: string;
}

export interface SprintRow {
  id: string;
  date_ist: string;
  week_label?: string;
  status: SprintStatus;
  mom_summary_md: string;
  weekly_plan_json?: SprintWeeklyPlanEntry[];
  task_movements_json?: SprintTaskMovementEntry[];
  approved_at: string | null;
  ceo_notes: string | null;
  created_at: string;
}

export interface BacklogItemRow {
  id: string;
  title: string;
  spec_md: string;
  stage: BacklogStage;
  priority: BacklogPriority;
  department: Department;
  project_slug: string | null;
  pm_owner_id?: string | null;
  assigned_agent_id: string | null;
  sprint_id: string | null;
  target_week?: string | null;
  requires_human_intervention?: boolean;
  intervention_type?: HumanInterventionType | null;
  intervention_prompt?: string | null;
  required_env_keys?: string[];
  human_response?: string | null;
  requested_by_agent_id?: string | null;
  last_moved_at?: string | null;
  last_movement_note?: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface ApprovalGateRow {
  id: string;
  run_id: string | null;
  thread_id: string | null;
  agent_id: string;
  department: Department;
  project_scope: string | null;
  gate_type: ApprovalGateType;
  prompt_text: string;
  options_json: string[];
  status: ApprovalGateStatus;
  ceo_decision: string | null;
  telegram_notified_at: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface CodeChunkRow {
  id: string;
  project_slug: string;
  repo_slug: string;
  file_path: string;
  symbol_name: string;
  chunk_type: string;
  content: string;
  commit_sha: string | null;
  embedding: number[] | null;
  updated_at: string;
}

export type ContractStatus = 'DRAFT' | 'LOCKED' | 'IMPLEMENTED';

export interface ContractRow {
  id: string;
  project_slug: string;
  feature_slug: string;
  title: string;
  status: ContractStatus;
  file_path: string;
  content_md: string;
  embedding: number[] | null;
  updated_at: string;
}

// Type aliases for convenience across workspace packages
export type Agent = AgentRow;
export type ProjectContext = ProjectContextRow;
export type AgentMemory = AgentMemoryRow;
export type AgentRun = AgentRunRow;
export type InferenceStep = InferenceStepRow;
export type ChatThread = ChatThreadRow;
export type ChatMessage = ChatMessageRow;
export type Sprint = SprintRow;
export type BacklogItem = BacklogItemRow;
export type ApprovalGate = ApprovalGateRow;
export type CodeChunk = CodeChunkRow;
export type ProviderCredential = ProviderCredentialRow;
export type RoutingProfile = RoutingProfileRow;
export type Contract = ContractRow;

// ----------------------------------------------------------------------------
// Drizzle ORM pgTable Builder (with zero-dependency fallback before npm install)
// ----------------------------------------------------------------------------

interface ColumnBuilder<T = unknown> {
  columnName: string;
  dataType: string;
  isPrimaryKey?: boolean;
  isNotNull?: boolean;
  isUnique?: boolean;
  defaultValue?: unknown;
  primaryKey(): ColumnBuilder<T>;
  notNull(): ColumnBuilder<T>;
  unique(): ColumnBuilder<T>;
  default(val: unknown): ColumnBuilder<T>;
  defaultNow(): ColumnBuilder<T>;
  defaultRandom(): ColumnBuilder<T>;
  references(refFn: () => unknown, opts?: Record<string, unknown>): ColumnBuilder<T>;
  $type<U>(): ColumnBuilder<U>;
}

function createFallbackColumn<T = unknown>(dataType: string, columnName: string): ColumnBuilder<T> {
  const col: ColumnBuilder<T> = {
    columnName,
    dataType,
    primaryKey() {
      col.isPrimaryKey = true;
      return col;
    },
    notNull() {
      col.isNotNull = true;
      return col;
    },
    unique() {
      col.isUnique = true;
      return col;
    },
    default(val: unknown) {
      col.defaultValue = val;
      return col;
    },
    defaultNow() {
      col.defaultValue = 'NOW()';
      return col;
    },
    defaultRandom() {
      col.defaultValue = 'uuid_generate_v4()';
      return col;
    },
    references() {
      return col;
    },
    $type<U>() {
      return col as unknown as ColumnBuilder<U>;
    },
  };
  return col;
}

let drizzlePgCore: Record<string, any> | null = null;
try {
  const pkgName = 'drizzle-orm/pg-core';
  drizzlePgCore = await import(pkgName);
} catch {
  drizzlePgCore = null;
}

interface FallbackCol {
  $type: <U = any>() => any;
  [key: string]: any;
}
type DrizzleColFn = (name: string, ...args: any[]) => FallbackCol;

const pgTable: any =
  drizzlePgCore?.pgTable ??
  ((tableName: string, columns: Record<string, unknown>) => ({
    $tableName: tableName,
    ...columns,
  }));

const text: DrizzleColFn =
  drizzlePgCore?.text ?? ((name: string) => createFallbackColumn<string>('text', name));
const integer: DrizzleColFn =
  drizzlePgCore?.integer ?? ((name: string) => createFallbackColumn<number>('integer', name));
const bigint: DrizzleColFn =
  drizzlePgCore?.bigint ??
  ((name: string, _opts?: { mode: 'number' | 'bigint' }) =>
    createFallbackColumn<number>('bigint', name));
const boolean: DrizzleColFn =
  drizzlePgCore?.boolean ?? ((name: string) => createFallbackColumn<boolean>('boolean', name));
const numeric: DrizzleColFn =
  drizzlePgCore?.numeric ??
  ((name: string, _opts?: { precision?: number; scale?: number }) =>
    createFallbackColumn<string>('numeric', name));
const timestamp: DrizzleColFn =
  drizzlePgCore?.timestamp ??
  ((name: string, _opts?: { withTimezone?: boolean; mode?: string }) =>
    createFallbackColumn<Date>('timestamptz', name));
const uuid: DrizzleColFn =
  drizzlePgCore?.uuid ?? ((name: string) => createFallbackColumn<string>('uuid', name));
const jsonb: DrizzleColFn =
  drizzlePgCore?.jsonb ?? ((name: string) => createFallbackColumn<unknown>('jsonb', name));

const customVector768: any = drizzlePgCore?.customType
  ? drizzlePgCore.customType({
      dataType() {
        return 'vector(768)';
      },
      toDriver(value: number[]): string {
        return `[${value.join(',')}]`;
      },
      fromDriver(value: unknown): number[] {
        if (Array.isArray(value)) return value.map(Number);
        if (typeof value === 'string') {
          const trimmed = value.replace(/^\[|\]$/g, '').trim();
          if (!trimmed) return [];
          return trimmed.split(',').map((v) => Number(v.trim()));
        }
        return [];
      },
    })
  : (name: string) => createFallbackColumn<number[]>('vector(768)', name);

// ----------------------------------------------------------------------------
// 1. agents Table
// ----------------------------------------------------------------------------
export const agents = pgTable('agents', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  department: text('department').$type<Department>().notNull(),
  hierarchy_level: integer('hierarchy_level').$type<HierarchyLevel>().notNull(),
  parent_agent_id: text('parent_agent_id'),
  project_scope: text('project_scope'),
  model_provider: text('model_provider').$type<ModelProvider>().notNull().default('meta_muse'),
  model_id: text('model_id').notNull().default('muse-wonder-1.0'),
  fallback_provider: text('fallback_provider').$type<ModelProvider>().notNull().default('meta_muse'),
  fallback_model_id: text('fallback_model_id').notNull().default('muse-spark-1.3'),
  step_routing_json: jsonb('step_routing_json').$type<StepRoutingConfig>().notNull().default({}),
  init_prompt: text('init_prompt').notNull(),
  allowed_repos: jsonb('allowed_repos').$type<string[]>().notNull().default([]),
  permission_tier: text('permission_tier')
    .$type<PermissionTier>()
    .notNull()
    .default('standard_autonomous'),
  status: text('status').$type<AgentStatus>().notNull().default('IDLE'),
  health_status: text('health_status').$type<AgentHealthStatus>().notNull().default('HEALTHY'),
  last_heartbeat_at: timestamp('last_heartbeat_at', { withTimezone: true, mode: 'string' }),
  max_subagents: integer('max_subagents').notNull().default(4),
  active_subagent_count: integer('active_subagent_count').notNull().default(0),
  max_run_duration_ms: bigint('max_run_duration_ms', { mode: 'number' })
    .notNull()
    .default(86400000),
  current_run_id: uuid('current_run_id'),
  clocked_in_at: timestamp('clocked_in_at', { withTimezone: true, mode: 'string' }),
  total_work_time_ms: bigint('total_work_time_ms', { mode: 'number' }).notNull().default(0),
  total_runs: integer('total_runs').notNull().default(0),
  total_commits: integer('total_commits').notNull().default(0),
  max_tokens_per_run: bigint('max_tokens_per_run', { mode: 'number' })
    .notNull()
    .default(1000000),
  today_tokens_used: bigint('today_tokens_used', { mode: 'number' }).notNull().default(0),
  total_tokens_in: bigint('total_tokens_in', { mode: 'number' }).notNull().default(0),
  total_tokens_cached: bigint('total_tokens_cached', { mode: 'number' }).notNull().default(0),
  total_tokens_thinking: bigint('total_tokens_thinking', { mode: 'number' }).notNull().default(0),
  total_tokens_out: bigint('total_tokens_out', { mode: 'number' }).notNull().default(0),
  total_cost_usd: numeric('total_cost_usd', { precision: 14, scale: 6 }).notNull().default('0'),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
});

// ----------------------------------------------------------------------------
// 2. project_contexts Table
// ----------------------------------------------------------------------------
export const project_contexts = pgTable('project_contexts', {
  id: text('id').primaryKey(),
  project_slug: text('project_slug').notNull(),
  repo_slug: text('repo_slug').notNull(),
  git_repo_url: text('git_repo_url'),
  local_path: text('local_path'),
  default_branch: text('default_branch').notNull().default('main'),
  role: text('role').$type<RepoRole>().notNull(),
  docker_base_image: text('docker_base_image').notNull().default('commando-workspace:latest'),
  build_cmd: text('build_cmd'),
  test_cmd: text('test_cmd'),
  dev_preview_port: integer('dev_preview_port'),
  architecture_doc_md: text('architecture_doc_md').notNull().default(''),
  topology_json: jsonb('topology_json').$type<Record<string, unknown>>().notNull().default({}),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
});

// ----------------------------------------------------------------------------
// 3. agent_memories Table
// ----------------------------------------------------------------------------
export const agent_memories = pgTable('agent_memories', {
  id: uuid('id').primaryKey().defaultRandom(),
  agent_id: text('agent_id')
    .notNull()
    .references(() => agents.id),
  project_scope: text('project_scope'),
  memory_type: text('memory_type').$type<MemoryType>().notNull(),
  content: text('content').notNull(),
  source_run_id: uuid('source_run_id'),
  is_pinned: boolean('is_pinned').notNull().default(false),
  embedding: customVector768('embedding'),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
});

// ----------------------------------------------------------------------------
// 4. agent_runs Table
// ----------------------------------------------------------------------------
export const agent_runs = pgTable('agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  agent_id: text('agent_id')
    .notNull()
    .references(() => agents.id),
  parent_run_id: uuid('parent_run_id'),
  chat_thread_id: uuid('chat_thread_id'),
  sprint_id: text('sprint_id'),
  backlog_item_id: uuid('backlog_item_id'),
  trigger_type: text('trigger_type').$type<RunTriggerType>().notNull(),
  input_prompt: text('input_prompt').notNull(),
  output_summary: text('output_summary'),
  status: text('status').$type<AgentRunStatus>().notNull().default('RUNNING'),
  container_id: text('container_id'),
  git_branch: text('git_branch'),
  git_commit_sha: text('git_commit_sha'),
  preview_url: text('preview_url'),
  qa_passed: boolean('qa_passed'),
  qa_screenshot_url: text('qa_screenshot_url'),
  started_at: timestamp('started_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
  ended_at: timestamp('ended_at', { withTimezone: true, mode: 'string' }),
  active_duration_ms: bigint('active_duration_ms', { mode: 'number' }).notNull().default(0),
  pause_duration_ms: bigint('pause_duration_ms', { mode: 'number' }).notNull().default(0),
  tokens_in: bigint('tokens_in', { mode: 'number' }).notNull().default(0),
  tokens_cached: bigint('tokens_cached', { mode: 'number' }).notNull().default(0),
  tokens_thinking: bigint('tokens_thinking', { mode: 'number' }).notNull().default(0),
  tokens_out: bigint('tokens_out', { mode: 'number' }).notNull().default(0),
  cost_usd: numeric('cost_usd', { precision: 14, scale: 6 }).notNull().default('0'),
});

// ----------------------------------------------------------------------------
// 5. inference_steps Table
// ----------------------------------------------------------------------------
export const inference_steps = pgTable('inference_steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  run_id: uuid('run_id')
    .notNull()
    .references(() => agent_runs.id),
  step_index: integer('step_index').notNull(),
  step_type: text('step_type').$type<InferenceStepType>().notNull(),
  model_used: text('model_used'),
  thinking_text: text('thinking_text'),
  message_text: text('message_text'),
  tool_name: text('tool_name'),
  tool_args_json: jsonb('tool_args_json').$type<Record<string, unknown> | null>(),
  tool_output_json: jsonb('tool_output_json').$type<Record<string, unknown> | null>(),
  duration_ms: bigint('duration_ms', { mode: 'number' }).notNull().default(0),
  tokens_in: bigint('tokens_in', { mode: 'number' }).notNull().default(0),
  tokens_cached: bigint('tokens_cached', { mode: 'number' }).notNull().default(0),
  tokens_thinking: bigint('tokens_thinking', { mode: 'number' }).notNull().default(0),
  tokens_out: bigint('tokens_out', { mode: 'number' }).notNull().default(0),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
});

// ----------------------------------------------------------------------------
// 6. chat_threads Table
// ----------------------------------------------------------------------------
export const chat_threads = pgTable('chat_threads', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  mode: text('mode').$type<ChatThreadMode>().notNull().default('WARDEN_EXECUTIVE'),
  target_agent_id: text('target_agent_id').references(() => agents.id),
  project_scope: text('project_scope'),
  status: text('status').$type<ChatThreadStatus>().notNull().default('ACTIVE'),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
});

// ----------------------------------------------------------------------------
// 7. chat_messages Table
// ----------------------------------------------------------------------------
export const chat_messages = pgTable('chat_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  thread_id: uuid('thread_id')
    .notNull()
    .references(() => chat_threads.id),
  sender_type: text('sender_type').$type<ChatSenderType>().notNull(),
  sender_agent_id: text('sender_agent_id').references(() => agents.id),
  recipient_agent_id: text('recipient_agent_id').references(() => agents.id),
  content: text('content').notNull(),
  run_id: uuid('run_id').references(() => agent_runs.id),
  attachments_json: jsonb('attachments_json').$type<ChatAttachment[]>().notNull().default([]),
  embedding: customVector768('embedding'),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
});

// ----------------------------------------------------------------------------
// 8. sprints Table
// ----------------------------------------------------------------------------
export const sprints = pgTable('sprints', {
  id: text('id').primaryKey(),
  date_ist: text('date_ist').notNull(),
  status: text('status').$type<SprintStatus>().notNull().default('AWAITING_CEO_APPROVAL'),
  mom_summary_md: text('mom_summary_md').notNull().default(''),
  approved_at: timestamp('approved_at', { withTimezone: true, mode: 'string' }),
  ceo_notes: text('ceo_notes'),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
});

// ----------------------------------------------------------------------------
// 9. backlog_items Table
// ----------------------------------------------------------------------------
export const backlog_items = pgTable('backlog_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  spec_md: text('spec_md').notNull().default(''),
  stage: text('stage').$type<BacklogStage>().notNull().default('INBOX'),
  priority: text('priority').$type<BacklogPriority>().notNull().default('P1'),
  department: text('department').$type<Department>().notNull().default('tech'),
  project_slug: text('project_slug'),
  assigned_agent_id: text('assigned_agent_id').references(() => agents.id),
  sprint_id: text('sprint_id').references(() => sprints.id),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
  completed_at: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
});

// ----------------------------------------------------------------------------
// 10. approval_gates Table
// ----------------------------------------------------------------------------
export const approval_gates = pgTable('approval_gates', {
  id: uuid('id').primaryKey().defaultRandom(),
  run_id: uuid('run_id').references(() => agent_runs.id),
  thread_id: uuid('thread_id').references(() => chat_threads.id),
  agent_id: text('agent_id')
    .notNull()
    .references(() => agents.id),
  department: text('department').$type<Department>().notNull().default('tech'),
  project_scope: text('project_scope'),
  gate_type: text('gate_type').$type<ApprovalGateType>().notNull(),
  prompt_text: text('prompt_text').notNull(),
  options_json: jsonb('options_json').$type<string[]>().notNull().default([]),
  status: text('status').$type<ApprovalGateStatus>().notNull().default('PENDING'),
  ceo_decision: text('ceo_decision'),
  telegram_notified_at: timestamp('telegram_notified_at', { withTimezone: true, mode: 'string' }),
  resolved_at: timestamp('resolved_at', { withTimezone: true, mode: 'string' }),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
});

// ----------------------------------------------------------------------------
// 11. code_chunks Table
// ----------------------------------------------------------------------------
export const code_chunks = pgTable('code_chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  project_slug: text('project_slug').notNull(),
  repo_slug: text('repo_slug').notNull(),
  file_path: text('file_path').notNull(),
  symbol_name: text('symbol_name').notNull(),
  chunk_type: text('chunk_type').notNull(),
  content: text('content').notNull(),
  commit_sha: text('commit_sha'),
  embedding: customVector768('embedding'),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
});

// ----------------------------------------------------------------------------
// 12. provider_credentials Table
// ----------------------------------------------------------------------------
export const provider_credentials = pgTable('provider_credentials', {
  id: text('id').primaryKey(),
  provider: text('provider').$type<ModelProvider>().notNull(),
  label: text('label').notNull(),
  api_key_encrypted: text('api_key_encrypted').notNull().default(''),
  base_url: text('base_url').notNull().default(''),
  remaining_budget_usd: numeric('remaining_budget_usd', { precision: 14, scale: 6 }),
  rpm_limit: integer('rpm_limit'),
  tpm_limit: integer('tpm_limit'),
  priority_order: integer('priority_order').notNull().default(1),
  is_active: boolean('is_active').notNull().default(true),
  cooldown_until: timestamp('cooldown_until', { withTimezone: true, mode: 'string' }),
  total_requests: bigint('total_requests', { mode: 'number' }).notNull().default(0),
  total_failures: integer('total_failures').notNull().default(0),
  last_error: text('last_error'),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
});

// ----------------------------------------------------------------------------
// 13. routing_profiles Table
// ----------------------------------------------------------------------------
export const routing_profiles = pgTable('routing_profiles', {
  id: text('id').$type<RoutingProfileId>().primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  is_active: boolean('is_active').notNull().default(false),
  config_json: jsonb('config_json').$type<RoutingProfileRow['config_json']>().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
});

// ----------------------------------------------------------------------------
// 14. contracts Table
// ----------------------------------------------------------------------------
export const contracts = pgTable('contracts', {
  id: text('id').primaryKey(),
  project_slug: text('project_slug').notNull(),
  feature_slug: text('feature_slug').notNull(),
  title: text('title').notNull(),
  status: text('status').$type<ContractStatus>().notNull().default('LOCKED'),
  file_path: text('file_path').notNull(),
  content_md: text('content_md').notNull().default(''),
  embedding: customVector768('embedding'),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
});

// Export camelCase aliases as well so both conventions work seamlessly
export const projectContexts = project_contexts;
export const agentMemories = agent_memories;
export const agentRuns = agent_runs;
export const inferenceSteps = inference_steps;
export const chatThreads = chat_threads;
export const chatMessages = chat_messages;
export const backlogItems = backlog_items;
export const approvalGates = approval_gates;
export const codeChunks = code_chunks;
export const providerCredentials = provider_credentials;
export const routingProfiles = routing_profiles;

export const schema = {
  agents,
  project_contexts,
  agent_memories,
  agent_runs,
  inference_steps,
  chat_threads,
  chat_messages,
  sprints,
  backlog_items,
  approval_gates,
  code_chunks,
  provider_credentials,
  routing_profiles,
  contracts,
};
