-- ============================================================================
-- DYNAMO COMMANDO — PostgreSQL 16 + pgvector Production Schema Initialization
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------------------
-- 1. agents (AI Employee Roster, Brain Config, Guardrails & Cumulative Timesheet)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  department TEXT NOT NULL CHECK (department IN ('executive', 'tech', 'infra', 'marketing', 'sales', 'hr', 'ops', 'support', 'finance', 'product')),
  hierarchy_level INTEGER NOT NULL CHECK (hierarchy_level IN (-1, 0, 1, 2, 3)),
  parent_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  project_scope TEXT,
  model_provider TEXT NOT NULL DEFAULT 'meta_muse' CHECK (model_provider IN ('meta_muse', 'ollama', 'huggingface')),
  model_id TEXT NOT NULL DEFAULT 'muse-wonder-1.0',
  fallback_provider TEXT NOT NULL DEFAULT 'meta_muse' CHECK (fallback_provider IN ('meta_muse', 'ollama', 'huggingface')),
  fallback_model_id TEXT NOT NULL DEFAULT 'muse-spark-1.3',
  step_routing_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  init_prompt TEXT NOT NULL,
  allowed_repos JSONB NOT NULL DEFAULT '[]'::jsonb,
  permission_tier TEXT NOT NULL DEFAULT 'standard_autonomous' CHECK (permission_tier IN ('full_overdrive', 'standard_autonomous', 'strict_gate')),
  status TEXT NOT NULL DEFAULT 'IDLE' CHECK (status IN ('IDLE', 'WORKING', 'WAITING_FOR_CEO', 'UNHEALTHY_LOOP', 'TERMINATED_TIMEOUT', 'ERROR')),
  health_status TEXT NOT NULL DEFAULT 'HEALTHY' CHECK (health_status IN ('HEALTHY', 'DEGRADED', 'STUCK_LOOP', 'ZOMBIE_NO_HEARTBEAT', 'KILLED_24H_LIMIT')),
  last_heartbeat_at TIMESTAMPTZ,
  max_subagents INTEGER NOT NULL DEFAULT 4,
  active_subagent_count INTEGER NOT NULL DEFAULT 0,
  max_run_duration_ms BIGINT NOT NULL DEFAULT 86400000,
  current_run_id UUID,
  clocked_in_at TIMESTAMPTZ,
  total_work_time_ms BIGINT NOT NULL DEFAULT 0,
  total_runs INTEGER NOT NULL DEFAULT 0,
  total_commits INTEGER NOT NULL DEFAULT 0,
  max_tokens_per_run BIGINT NOT NULL DEFAULT 1000000,
  today_tokens_used BIGINT NOT NULL DEFAULT 0,
  total_tokens_in BIGINT NOT NULL DEFAULT 0,
  total_tokens_cached BIGINT NOT NULL DEFAULT 0,
  total_tokens_thinking BIGINT NOT NULL DEFAULT 0,
  total_tokens_out BIGINT NOT NULL DEFAULT 0,
  total_cost_usd NUMERIC(14, 6) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agents_department ON agents(department);
CREATE INDEX IF NOT EXISTS idx_agents_parent ON agents(parent_agent_id);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_project_scope ON agents(project_scope);

-- ----------------------------------------------------------------------------
-- 2. project_contexts (Replaces projects.yaml & context/<project>/<repo>.md)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_contexts (
  id TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  repo_slug TEXT NOT NULL,
  git_repo_url TEXT,
  local_path TEXT,
  default_branch TEXT NOT NULL DEFAULT 'main',
  role TEXT NOT NULL CHECK (role IN ('frontend', 'backend', 'fullstack', 'infra', 'shared-lib', 'meta-docs')),
  docker_base_image TEXT NOT NULL DEFAULT 'commando-workspace:latest',
  build_cmd TEXT,
  test_cmd TEXT,
  dev_preview_port INTEGER,
  architecture_doc_md TEXT NOT NULL DEFAULT '',
  topology_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_slug, repo_slug)
);

CREATE INDEX IF NOT EXISTS idx_project_contexts_project ON project_contexts(project_slug);
CREATE INDEX IF NOT EXISTS idx_project_contexts_role ON project_contexts(role);

-- ----------------------------------------------------------------------------
-- 3. chat_threads (Resumable Multimodal Executive, Direct @agent & Standup Chats)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_threads (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'WARDEN_EXECUTIVE' CHECK (mode IN ('WARDEN_EXECUTIVE', 'DIRECT_AGENT', 'STANDUP', 'STANDUP_ROOM')),
  target_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  project_scope TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'WAITING_FOR_CEO', 'ARCHIVED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_threads_status ON chat_threads(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_threads_target_agent ON chat_threads(target_agent_id);

-- ----------------------------------------------------------------------------
-- 4. sprints (Replaces standups/*.md — 12:00 PM IST Daily Standup & Sprint Plan)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sprints (
  id TEXT PRIMARY KEY,
  date_ist TEXT NOT NULL,
  week_label TEXT,
  status TEXT NOT NULL DEFAULT 'AWAITING_CEO_APPROVAL' CHECK (status IN ('DRAFTING', 'AWAITING_CEO_APPROVAL', 'EXECUTING', 'COMPLETED')),
  mom_summary_md TEXT NOT NULL DEFAULT '',
  weekly_plan_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  task_movements_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  approved_at TIMESTAMPTZ,
  ceo_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE sprints ADD COLUMN IF NOT EXISTS week_label TEXT;
ALTER TABLE sprints ADD COLUMN IF NOT EXISTS weekly_plan_json JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE sprints ADD COLUMN IF NOT EXISTS task_movements_json JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_sprints_date_ist ON sprints(date_ist DESC);
CREATE INDEX IF NOT EXISTS idx_sprints_status ON sprints(status);

-- ----------------------------------------------------------------------------
-- 5. backlog_items (Replaces worklist/inbox.md, worklist/<project>/backlog.md, todo/, done/)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS backlog_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  spec_md TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT 'INBOX' CHECK (stage IN ('INBOX', 'NEEDS_CEO', 'TODO', 'IN_PROGRESS', 'QA_REVIEW', 'DONE')),
  priority TEXT NOT NULL DEFAULT 'P1' CHECK (priority IN ('P0', 'P1', 'P2')),
  department TEXT NOT NULL DEFAULT 'tech',
  project_slug TEXT,
  assigned_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  pm_owner_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  sprint_id TEXT REFERENCES sprints(id) ON DELETE SET NULL,
  target_week TEXT,
  requires_human_intervention BOOLEAN NOT NULL DEFAULT FALSE,
  intervention_type TEXT,
  intervention_prompt TEXT,
  required_env_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  human_response TEXT,
  requested_by_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  last_moved_at TIMESTAMPTZ,
  last_movement_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE backlog_items DROP CONSTRAINT IF EXISTS backlog_items_stage_check;
ALTER TABLE backlog_items ADD CONSTRAINT backlog_items_stage_check
  CHECK (stage IN ('INBOX', 'NEEDS_CEO', 'TODO', 'IN_PROGRESS', 'QA_REVIEW', 'DONE'));
ALTER TABLE backlog_items ADD COLUMN IF NOT EXISTS pm_owner_id TEXT REFERENCES agents(id) ON DELETE SET NULL;
ALTER TABLE backlog_items ADD COLUMN IF NOT EXISTS target_week TEXT;
ALTER TABLE backlog_items ADD COLUMN IF NOT EXISTS requires_human_intervention BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE backlog_items ADD COLUMN IF NOT EXISTS intervention_type TEXT;
ALTER TABLE backlog_items ADD COLUMN IF NOT EXISTS intervention_prompt TEXT;
ALTER TABLE backlog_items ADD COLUMN IF NOT EXISTS required_env_keys JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE backlog_items ADD COLUMN IF NOT EXISTS human_response TEXT;
ALTER TABLE backlog_items ADD COLUMN IF NOT EXISTS requested_by_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL;
ALTER TABLE backlog_items ADD COLUMN IF NOT EXISTS last_moved_at TIMESTAMPTZ;
ALTER TABLE backlog_items ADD COLUMN IF NOT EXISTS last_movement_note TEXT;

CREATE INDEX IF NOT EXISTS idx_backlog_items_stage_priority ON backlog_items(stage, priority);
CREATE INDEX IF NOT EXISTS idx_backlog_items_dept_project ON backlog_items(department, project_slug, stage);
CREATE INDEX IF NOT EXISTS idx_backlog_items_assigned_agent ON backlog_items(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_backlog_items_needs_ceo ON backlog_items(requires_human_intervention, stage, priority);

-- ----------------------------------------------------------------------------
-- 6. agent_runs (Employee Time-Clock & Ephemeral Docker Container Sessions)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  parent_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
  chat_thread_id TEXT REFERENCES chat_threads(id) ON DELETE SET NULL,
  sprint_id TEXT REFERENCES sprints(id) ON DELETE SET NULL,
  backlog_item_id TEXT REFERENCES backlog_items(id) ON DELETE SET NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('CEO_CHAT', 'DIRECT_MENTION', 'DELEGATION', 'DAILY_STANDUP', 'STANDUP_CRON', 'AGENT_DELEGATION', 'IDLE_BACKLOG_PING')),
  input_prompt TEXT NOT NULL DEFAULT '',
  output_summary TEXT,
  status TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'PAUSED_FOR_CEO', 'VERIFYING_QA', 'COMPLETED', 'FAILED', 'TERMINATED_TIMEOUT', 'PAUSED_TOKEN_CAP')),
  container_id TEXT,
  git_branch TEXT,
  git_commit_sha TEXT,
  preview_url TEXT,
  qa_passed BOOLEAN,
  qa_screenshot_url TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  active_duration_ms BIGINT NOT NULL DEFAULT 0,
  pause_duration_ms BIGINT NOT NULL DEFAULT 0,
  tokens_in BIGINT NOT NULL DEFAULT 0,
  tokens_cached BIGINT NOT NULL DEFAULT 0,
  tokens_thinking BIGINT NOT NULL DEFAULT 0,
  tokens_out BIGINT NOT NULL DEFAULT 0,
  cost_usd NUMERIC(14, 6) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_started ON agent_runs(agent_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);
CREATE INDEX IF NOT EXISTS idx_agent_runs_parent ON agent_runs(parent_run_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_thread ON agent_runs(chat_thread_id);

-- ----------------------------------------------------------------------------
-- 7. agent_memories (Synchronized with memory/*.md — Pinned + pgvector Episodic Recall)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_memories (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  project_scope TEXT,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('PINNED_PREFERENCE', 'REPO_GOTCHA', 'EPISODIC_LESSON', 'CEO_DECISION', 'OPEN_THREAD')),
  content TEXT NOT NULL,
  source_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  embedding vector(768),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_memories_agent_pinned ON agent_memories(agent_id, is_pinned);
CREATE INDEX IF NOT EXISTS idx_agent_memories_project ON agent_memories(project_scope);
CREATE INDEX IF NOT EXISTS idx_agent_memories_embedding_hnsw
  ON agent_memories USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_agent_memories_content_fts
  ON agent_memories USING gin (to_tsvector('english', content));

-- ----------------------------------------------------------------------------
-- 8. inference_steps (Granular Thought, LLM Turn & Tool Execution Trace)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inference_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  step_type TEXT NOT NULL CHECK (step_type IN ('LLM_INFERENCE', 'TOOL_CALL', 'SUBAGENT_CALL', 'QA_CHECK')),
  model_used TEXT,
  thinking_text TEXT,
  message_text TEXT,
  tool_name TEXT,
  tool_args_json JSONB,
  tool_output_json JSONB,
  duration_ms BIGINT NOT NULL DEFAULT 0,
  tokens_in BIGINT NOT NULL DEFAULT 0,
  tokens_cached BIGINT NOT NULL DEFAULT 0,
  tokens_thinking BIGINT NOT NULL DEFAULT 0,
  tokens_out BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inference_steps_run_idx ON inference_steps(run_id, step_index ASC);

-- ----------------------------------------------------------------------------
-- 9. chat_messages (Multimodal Chat Turns + pgvector Semantic Recall)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('CEO', 'AGENT', 'SYSTEM')),
  sender_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  recipient_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
  attachments_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  embedding vector(768),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_created ON chat_messages(thread_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_embedding_hnsw
  ON chat_messages USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_chat_messages_content_fts
  ON chat_messages USING gin (to_tsvector('english', content));

-- ----------------------------------------------------------------------------
-- 10. approval_gates (Human-in-the-Loop Blocker, Backlog Ping & Telegram Tracker)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS approval_gates (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
  thread_id TEXT REFERENCES chat_threads(id) ON DELETE SET NULL,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  department TEXT NOT NULL DEFAULT 'tech',
  project_scope TEXT,
  gate_type TEXT NOT NULL CHECK (gate_type IN ('QUESTION', 'STANDUP_SIGN_OFF', 'STANDUP_SPRINT_PLAN', 'DEPLOY_PERMISSION', 'PROD_DEPLOY', 'PAID_API_OR_SPEND', 'AMBIGUOUS_REQUIREMENT', 'EMPTY_BACKLOG_PING')),
  prompt_text TEXT NOT NULL,
  options_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RESOLVED', 'APPROVED', 'REJECTED')),
  ceo_decision TEXT,
  telegram_notified_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approval_gates_status ON approval_gates(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_gates_dept_type ON approval_gates(department, gate_type, created_at DESC);

-- ----------------------------------------------------------------------------
-- 11. code_chunks (Cross-Repo Codebase Intelligence & RAG via pgvector HNSW)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS code_chunks (
  id TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  repo_slug TEXT NOT NULL,
  file_path TEXT NOT NULL,
  symbol_name TEXT NOT NULL,
  chunk_type TEXT NOT NULL,
  content TEXT NOT NULL,
  commit_sha TEXT,
  embedding vector(768),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_code_chunks_project_repo ON code_chunks(project_slug, repo_slug);
CREATE INDEX IF NOT EXISTS idx_code_chunks_file ON code_chunks(repo_slug, file_path);
CREATE INDEX IF NOT EXISTS idx_code_chunks_embedding_hnsw
  ON code_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_code_chunks_content_fts
  ON code_chunks USING gin (to_tsvector('english', content));

-- ----------------------------------------------------------------------------
-- 12. provider_credentials (Multi-Provider Credential Pool & Auto-Failover Ledger)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provider_credentials (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('meta_muse', 'ollama', 'huggingface')),
  label TEXT NOT NULL,
  api_key_encrypted TEXT NOT NULL DEFAULT '',
  base_url TEXT NOT NULL DEFAULT '',
  remaining_budget_usd NUMERIC(14, 6),
  rpm_limit INTEGER,
  tpm_limit INTEGER,
  priority_order INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  cooldown_until TIMESTAMPTZ,
  total_requests BIGINT NOT NULL DEFAULT 0,
  total_failures INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_credentials_provider_priority
  ON provider_credentials(provider, is_active, priority_order ASC);

-- ----------------------------------------------------------------------------
-- 13. routing_profiles (Global Model Routing Profile & Hackathon Switcher)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS routing_profiles (
  id TEXT PRIMARY KEY CHECK (id IN ('LOCAL_ZERO_COST', 'META_MUSE_HACKATHON', 'CUSTOM_HYBRID')),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 14. contracts (Synchronized with contracts/<project>-<slug>.md + pgvector RAG)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  feature_slug TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'LOCKED' CHECK (status IN ('DRAFT', 'LOCKED', 'IMPLEMENTED')),
  file_path TEXT NOT NULL,
  content_md TEXT NOT NULL DEFAULT '',
  embedding vector(768),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_slug, feature_slug)
);

CREATE INDEX IF NOT EXISTS idx_contracts_project_status ON contracts(project_slug, status);
CREATE INDEX IF NOT EXISTS idx_contracts_embedding_hnsw
  ON contracts USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_contracts_content_fts
  ON contracts USING gin (to_tsvector('english', title || ' ' || content_md));

-- ----------------------------------------------------------------------------
-- 15. chat_session_logs (Full-File Markdown Mirror of chats/*.md + pgvector RAG)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_session_logs (
  id TEXT PRIMARY KEY,
  thread_id TEXT REFERENCES chat_threads(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  content_md TEXT NOT NULL DEFAULT '',
  turn_count INTEGER NOT NULL DEFAULT 0,
  embedding vector(768),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_session_logs_embedding_hnsw
  ON chat_session_logs USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_chat_session_logs_content_fts
  ON chat_session_logs USING gin (to_tsvector('english', title || ' ' || content_md));

-- ----------------------------------------------------------------------------
-- 16. reminders (CEO Reminders / Cron: WhatsApp, Telegram, macOS, Apple Reminders)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  recurrence TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  channels TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]
    CHECK (channels <@ ARRAY['whatsapp', 'telegram', 'macos', 'apple_reminders']::TEXT[]),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'FIRED', 'CANCELLED', 'FAILED')),
  last_fired_at TIMESTAMPTZ,
  fire_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_via TEXT NOT NULL DEFAULT 'api' CHECK (created_via IN ('api', 'chat', 'whatsapp', 'cli')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reminders_status_due ON reminders(status, due_at);
CREATE INDEX IF NOT EXISTS idx_reminders_created_at ON reminders(created_at DESC);
