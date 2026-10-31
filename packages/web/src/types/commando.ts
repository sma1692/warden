export type DepartmentUnit =
  | 'EXECUTIVE'
  | 'TECH'
  | 'MARKETING'
  | 'INFRA'
  | 'PLANNED_CSUITE';

export type ModelProvider =
  | 'meta_muse'
  | 'ollama'
  | 'huggingface';

export type GlobalRoutingProfile =
  | 'LOCAL_ZERO_COST'
  | 'META_MUSE_HACKATHON'
  | 'CUSTOM_HYBRID';

export const PROVIDER_MODELS: Record<ModelProvider, string[]> = {
  meta_muse: [
    'muse-wonder-1.0',
    'muse-pro',
    'muse-spark-1.3',
    'muse-light',
    'muse-flash',
    'muse-glimmer-30b',
    'muse-image',
    'muse-voice',
  ],
  ollama: ['llama-3.3-70b', 'muse-glimmer-30b'],
  huggingface: [
    'meta-llama/Llama-3.3-70B-Instruct',
  ],
};

export interface AgentStepRouting {
  planning_model: string;
  tool_loop_model: string;
  compaction_model: string;
}

export interface ProviderCredential {
  id: string;
  provider: ModelProvider;
  label: string;
  api_key_masked: string;
  endpoint_url: string;
  remaining_budget_usd: number;
  rpm_limit: number;
  priority_order: number;
  status: 'ACTIVE' | 'COOLDOWN';
  cooldown_until: string | null;
  last_used_at: string;
}

export interface SyncResult {
  status: 'SYNCED';
  last_synced_at: string;
  synced_files_count: number;
  directions: string;
  syncedFiles?: number;
  reindexedEmbeddings?: number;
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

export interface Agent {
  id: string;
  slug: string;
  name: string;
  role_title: string;
  department: DepartmentUnit;
  unit_label: string;
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
  status: AgentStatus;
  health_status: AgentHealthStatus;
  last_heartbeat_at: string;
  max_subagents: number;
  active_subagent_count: number;
  max_run_duration_ms: number;
  current_run_id: string | null;
  clocked_in_at: string | null;
  active_container_id?: string | null;
  active_git_branch?: string | null;
  active_preview_url?: string | null;
  active_task_title?: string | null;
  container_ram_mb?: number;
  container_cpu_pct?: number;
  tokens_per_sec?: number;
  today_work_time_ms: number;
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
}

export interface ProjectContext {
  id: string;
  project_slug: string;
  repo_slug: string;
  git_repo_url: string;
  default_branch: string;
  role: 'frontend' | 'backend' | 'infra' | 'shared-lib' | 'marketing';
  docker_base_image: string;
  build_cmd: string;
  test_cmd: string;
  dev_preview_port: number | null;
  architecture_doc_md: string;
  updated_at: string;
}

export type MemoryType =
  | 'PINNED_PREFERENCE'
  | 'REPO_GOTCHA'
  | 'EPISODIC_LESSON'
  | 'CEO_DECISION';

export interface AgentMemory {
  id: string;
  agent_id: string;
  project_scope: string | null;
  memory_type: MemoryType;
  content: string;
  source_run_id: string | null;
  is_pinned: boolean;
  similarity_score?: number;
  created_at: string;
}

export interface AgentRun {
  id: string;
  agent_id: string;
  parent_run_id: string | null;
  chat_thread_id: string | null;
  sprint_id: string | null;
  backlog_item_id: string | null;
  trigger_type: 'CEO_CHAT' | 'DIRECT_MENTION' | 'DELEGATION' | 'DAILY_STANDUP';
  input_prompt: string;
  output_summary: string;
  status: 'RUNNING' | 'PAUSED_FOR_CEO' | 'VERIFYING_QA' | 'COMPLETED' | 'FAILED';
  container_id: string | null;
  git_branch: string | null;
  git_commit_sha: string | null;
  preview_url: string | null;
  qa_passed: boolean | null;
  qa_screenshot_url: string | null;
  qa_console_errors?: number;
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

export interface InferenceStep {
  id: string;
  run_id: string;
  step_index: number;
  step_type: 'LLM_INFERENCE' | 'TOOL_CALL' | 'SUBAGENT_CALL' | 'QA_CHECK';
  model_used: string;
  thinking_text: string | null;
  message_text: string | null;
  tool_name: string | null;
  tool_args_json: Record<string, unknown> | null;
  tool_output_json: {
    stdout?: string;
    stderr?: string;
    diff?: string;
    exit_code?: number;
    preview_url?: string;
    qa_report?: string;
  } | null;
  duration_ms: number;
  tokens_in: number;
  tokens_cached: number;
  tokens_thinking: number;
  tokens_out: number;
  created_at: string;
}

export interface MediaAttachment {
  id: string;
  type: string;
  filename: string;
  media_uri: string;
  public_url: string;
  base64_data?: string;
  size_bytes?: number;
}

export interface ChatThread {
  id: string;
  title: string;
  mode: 'WARDEN_EXECUTIVE' | 'DIRECT_AGENT' | 'STANDUP';
  target_agent_id: string;
  project_scope: string | null;
  status: 'ACTIVE' | 'WAITING_FOR_CEO' | 'ARCHIVED';
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
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

export type PriorityLevel = 'P0' | 'P1' | 'P2';

export type InterventionCategory =
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
  pm_agent_slug?: string;
  week_goal?: string;
  locked_p0_ids?: string[];
  queued_p1_ids?: string[];
  needs_ceo_ids?: string[];
  assigned_agent_id: string;
  priority: PriorityLevel;
  stage: BacklogStage;
  target_week: string;
}

export interface SprintTaskMovementEntry {
  id?: string;
  backlog_item_id?: string;
  item_id?: string;
  title: string;
  project_slug: string;
  from_stage: BacklogStage;
  to_stage: BacklogStage;
  from_priority?: PriorityLevel;
  to_priority?: PriorityLevel;
  moved_by_agent_id?: string;
  moved_by_agent?: string;
  reason: string;
  moved_at: string;
}

export interface BacklogItem {
  id: string;
  title: string;
  spec_md: string;
  stage: BacklogStage;
  priority: PriorityLevel;
  project_slug: string;
  pm_owner_id?: string | null;
  assigned_agent_id: string | null;
  sprint_id: string | null;
  target_week?: string | null;
  requires_human_intervention?: boolean;
  intervention_type?: InterventionCategory | null;
  intervention_prompt?: string | null;
  required_env_keys?: string[];
  human_response?: string | null;
  human_resolution?: string | null;
  human_resolved_at?: string | null;
  requested_by_agent_id?: string | null;
  last_moved_at?: string | null;
  last_movement_note?: string | null;
  live_preview_url?: string | null;
  qa_passed?: boolean | null;
  created_at: string;
  completed_at: string | null;
}

export interface Sprint {
  id: string;
  date_ist: string;
  week_label?: string;
  status: 'AWAITING_CEO_APPROVAL' | 'EXECUTING' | 'COMPLETED';
  mom_summary_md: string;
  weekly_plan_json?: SprintWeeklyPlanEntry[];
  task_movements_json?: SprintTaskMovementEntry[];
  approved_at: string | null;
  ceo_notes: string | null;
  tasks_total: number;
  tasks_completed: number;
  tokens_burned: number;
  cost_usd: number;
}

export type GateType =
  | 'QUESTION'
  | 'STANDUP_SIGN_OFF'
  | 'DEPLOY_PERMISSION'
  | 'EMPTY_BACKLOG_PING';

export interface GateOption {
  id: string;
  label: string;
  description?: string;
  priority?: PriorityLevel;
  recommended?: boolean;
}

export interface ApprovalGate {
  id: string;
  run_id: string | null;
  thread_id: string | null;
  agent_id: string;
  department: string;
  project_scope: string | null;
  gate_type: GateType;
  prompt_text: string;
  options_json: GateOption[];
  status: 'PENDING' | 'RESOLVED';
  ceo_decision: string | null;
  telegram_notified_at: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface SystemHealthTelemetry {
  heartbeat_ok: boolean;
  active_subagents: number;
  max_subagents_pool: number;
  sandbox_latency_ms: number;
  active_docker_sandboxes: number;
  total_tokens_today: number;
  theoretical_usd_burn_today: number;
  telegram_pager_status: 'CONNECTED' | 'DEGRADED' | 'SIMULATED';
  db_pgvector_status: 'ONLINE' | 'FALLBACK_SEED';
  muse_cache_hit_rate_pct: number;
  active_routing_profile?: GlobalRoutingProfile;
  last_md_db_sync_at?: string;
  embedding_model_pinned?: string;
}

export interface StandupReport {
  id: string;
  date: string;
  title: string;
  chair: string;
  sprint_week: string;
  status: 'APPROVED_EXECUTING' | 'AWAITING_CEO_APPROVAL' | 'ARCHIVED';
  markdown_content: string;
  needs_ceo_count: number;
  total_commitments: number;
  polled_agents: string[];
}

export interface BrainStatusEvent {
  thread_id: string;
  run_id: string | null;
  parent_run_id?: string | null;
  agent_id: string;
  agent_slug: string;
  phase: 'ROUTING' | 'THINKING' | 'STEP_DONE' | 'TOOL_CALL' | 'DELEGATING' | 'QA_CHECK' | 'COMPLETED';
  model_used: string;
  thought: string;
  completed_step: string;
  next_action: string;
  timestamp: string;
}
