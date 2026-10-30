// ============================================================================
// @commando/db — Dual-Mode DatabaseStore (PostgreSQL + pgvector <-> JSON Snapshot)
// ============================================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_SNAPSHOT_PATH,
  PostgresClientManager,
  cosineSimilarity,
  formatPgVector,
  generateDeterministicEmbedding,
  parsePgVector,
  pgClient,
} from './client.ts';
import type {
  AgentHealthStatus,
  AgentMemoryRow,
  AgentRow,
  AgentRunRow,
  AgentRunStatus,
  AgentStatus,
  ApprovalGateRow,
  ApprovalGateStatus,
  ApprovalGateType,
  BacklogItemRow,
  BacklogPriority,
  BacklogStage,
  ChatAttachment,
  ChatMessageRow,
  ChatSenderType,
  ChatThreadMode,
  ChatThreadRow,
  ChatThreadStatus,
  CodeChunkRow,
  ContractRow,
  ContractStatus,
  Department,
  HierarchyLevel,
  HumanInterventionType,
  InferenceStepRow,
  InferenceStepType,
  MemoryType,
  ModelProvider,
  PermissionTier,
  ProjectContextRow,
  ProviderCredentialRow,
  RepoRole,
  RoutingProfileId,
  RoutingProfileRow,
  RunTriggerType,
  SprintRow,
  SprintStatus,
  StepRoutingConfig,
} from './schema.ts';
import {
  SEED_AGENTS,
  SEED_PROVIDER_CREDENTIALS,
  SEED_ROUTING_PROFILES,
} from './seed-agents.ts';
import { getDeploymentProfile } from './privateData.ts';

export interface DatabaseSnapshot {
  version: string;
  updated_at: string;
  active_routing_profile: RoutingProfileId;
  agents: AgentRow[];
  provider_credentials: ProviderCredentialRow[];
  routing_profiles: RoutingProfileRow[];
  project_contexts: ProjectContextRow[];
  agent_memories: AgentMemoryRow[];
  agent_runs: AgentRunRow[];
  inference_steps: InferenceStepRow[];
  chat_threads: ChatThreadRow[];
  chat_messages: ChatMessageRow[];
  sprints: SprintRow[];
  backlog_items: BacklogItemRow[];
  approval_gates: ApprovalGateRow[];
  code_chunks: CodeChunkRow[];
  contracts: ContractRow[];
}

export interface DepartmentBacklogSummary {
  department: Department;
  project_slug: string;
  senior_agent_id: string;
  inbox_count: number;
  todo_count: number;
  in_progress_count: number;
  qa_review_count: number;
  done_count: number;
  active_queue_count: number;
  working_agents_count: number;
  last_empty_backlog_ping_at: string | null;
  needs_backlog_ping: boolean;
}

export interface AgentHealthCheckItem {
  agent: AgentRow;
  active_run: AgentRunRow | null;
  runtime_ms: number;
  heartbeat_age_ms: number | null;
  is_over_24h_limit: boolean;
  is_heartbeat_stale: boolean;
  is_over_token_cap: boolean;
  is_subagent_cap_exceeded: boolean;
}

export interface CompanyTelemetrySummary {
  mode: 'postgres' | 'json-snapshot';
  postgres_connected: boolean;
  total_agents: number;
  working_agents: number;
  waiting_for_ceo_agents: number;
  unhealthy_agents: number;
  total_runs: number;
  total_commits: number;
  total_work_time_ms: number;
  today_tokens_used: number;
  total_tokens_in: number;
  total_tokens_cached: number;
  total_tokens_thinking: number;
  total_tokens_out: number;
  total_cost_usd: number;
  pending_approvals: number;
  active_backlog_count: number;
}

function normalizeAgentKey(idOrSlug: string): string {
  return idOrSlug.trim().replace(/^@/, '');
}

export class DatabaseStore {
  private snapshotPath: string;
  private pg: PostgresClientManager;
  private state: DatabaseSnapshot;
  private initialized = false;

  constructor(
    snapshotPath: string = DEFAULT_SNAPSHOT_PATH,
    pgManager: PostgresClientManager = pgClient
  ) {
    this.snapshotPath = snapshotPath;
    this.pg = pgManager;
    this.state = this.loadOrCreateEmptySnapshot();
  }

  private loadOrCreateEmptySnapshot(): DatabaseSnapshot {
    try {
      if (fs.existsSync(this.snapshotPath)) {
        const raw = fs.readFileSync(this.snapshotPath, 'utf8');
        const parsed = JSON.parse(raw) as Partial<DatabaseSnapshot>;
        const seedById = new Map(SEED_AGENTS.map((s) => [s.id, s]));
        const agents =
          Array.isArray(parsed.agents) && parsed.agents.length > 0
            ? parsed.agents.map((a) => {
                const seed = seedById.get(a.id);
                return {
                  ...a,
                  fallback_provider:
                    a.fallback_provider || seed?.fallback_provider || 'vertex',
                  fallback_model_id:
                    a.fallback_model_id || seed?.fallback_model_id || 'gemini-2.0-flash',
                  step_routing_json:
                    a.step_routing_json && Object.keys(a.step_routing_json).length > 0
                      ? a.step_routing_json
                      : seed?.step_routing_json || {
                          planning: { provider: 'vertex', modelId: 'gemini-2.5-pro' },
                          tool_loop: { provider: 'vertex', modelId: 'gemini-2.0-flash' },
                          compaction: { provider: 'ollama', modelId: 'qwen2.5-coder:32b' },
                        },
                };
              })
            : structuredClone(SEED_AGENTS);
        // Ensure any new seed agents are merged in
        const existingIds = new Set(agents.map((a) => a.id));
        for (const seed of SEED_AGENTS) {
          if (!existingIds.has(seed.id)) {
            agents.push(structuredClone(seed));
          }
        }

        const provider_credentials =
          Array.isArray(parsed.provider_credentials) &&
          parsed.provider_credentials.length > 0
            ? parsed.provider_credentials
            : structuredClone(SEED_PROVIDER_CREDENTIALS);
        const existingCredIds = new Set(provider_credentials.map((c) => c.id));
        for (const seedCred of SEED_PROVIDER_CREDENTIALS) {
          if (!existingCredIds.has(seedCred.id)) {
            provider_credentials.push(structuredClone(seedCred));
          }
        }

        const routing_profiles =
          Array.isArray(parsed.routing_profiles) && parsed.routing_profiles.length > 0
            ? parsed.routing_profiles
            : structuredClone(SEED_ROUTING_PROFILES);

        return {
          version: parsed.version || '2.1.0',
          updated_at: parsed.updated_at || new Date().toISOString(),
          active_routing_profile:
            parsed.active_routing_profile ||
            routing_profiles.find((p) => p.is_active)?.id ||
            'GCP_ZERO_COST',
          agents,
          provider_credentials,
          routing_profiles,
          project_contexts: Array.isArray(parsed.project_contexts) ? parsed.project_contexts : [],
          agent_memories: Array.isArray(parsed.agent_memories) ? parsed.agent_memories : [],
          agent_runs: Array.isArray(parsed.agent_runs) ? parsed.agent_runs : [],
          inference_steps: Array.isArray(parsed.inference_steps) ? parsed.inference_steps : [],
          chat_threads: Array.isArray(parsed.chat_threads) ? parsed.chat_threads : [],
          chat_messages: Array.isArray(parsed.chat_messages) ? parsed.chat_messages : [],
          sprints: Array.isArray(parsed.sprints) ? parsed.sprints : [],
          backlog_items: Array.isArray(parsed.backlog_items) ? parsed.backlog_items : [],
          approval_gates: Array.isArray(parsed.approval_gates) ? parsed.approval_gates : [],
          code_chunks: Array.isArray(parsed.code_chunks) ? parsed.code_chunks : [],
          contracts: Array.isArray(parsed.contracts) ? parsed.contracts : [],
        };
      }
    } catch {
      // Fall through to fresh snapshot
    }

    return {
      version: '2.1.0',
      updated_at: new Date().toISOString(),
      active_routing_profile: 'GCP_ZERO_COST',
      agents: structuredClone(SEED_AGENTS),
      provider_credentials: structuredClone(SEED_PROVIDER_CREDENTIALS),
      routing_profiles: structuredClone(SEED_ROUTING_PROFILES),
      project_contexts: [],
      agent_memories: [],
      agent_runs: [],
      inference_steps: [],
      chat_threads: [],
      chat_messages: [],
      sprints: [],
      backlog_items: [],
      approval_gates: [],
      code_chunks: [],
      contracts: [],
    };
  }

  public saveSnapshot(): void {
    this.state.updated_at = new Date().toISOString();
    const dir = path.dirname(this.snapshotPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = `${this.snapshotPath}.tmp.${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.snapshotPath);
  }

  public reloadSnapshotFromDisk(): void {
    this.state = this.loadOrCreateEmptySnapshot();
  }

  public getSnapshot(): DatabaseSnapshot {
    return this.state;
  }

  public getMode(): 'postgres' | 'json-snapshot' {
    return this.pg.isConnected() ? 'postgres' : 'json-snapshot';
  }

  public async init(): Promise<{ mode: 'postgres' | 'json-snapshot'; postgresConnected: boolean }> {
    if (!fs.existsSync(this.snapshotPath)) {
      this.saveSnapshot();
    }
    const pgOk = await this.pg.connect();
    if (pgOk) {
      await this.syncSeedAgentsToPostgres();
    }
    this.initialized = true;
    return {
      mode: this.getMode(),
      postgresConnected: pgOk,
    };
  }

  public async connect(): Promise<{ mode: 'postgres' | 'json-snapshot'; postgresConnected: boolean }> {
    return this.init();
  }

  public async close(): Promise<void> {
    await this.pg.close();
  }

  public getSnapshotPath(): string {
    return this.snapshotPath;
  }

  public resetState(): void {
    this.state = {
      version: '2.1.0',
      updated_at: new Date().toISOString(),
      active_routing_profile: 'GCP_ZERO_COST',
      agents: structuredClone(SEED_AGENTS),
      provider_credentials: structuredClone(SEED_PROVIDER_CREDENTIALS),
      routing_profiles: structuredClone(SEED_ROUTING_PROFILES),
      project_contexts: [],
      agent_memories: [],
      agent_runs: [],
      inference_steps: [],
      chat_threads: [],
      chat_messages: [],
      sprints: [],
      backlog_items: [],
      approval_gates: [],
      code_chunks: [],
      contracts: [],
    };
    this.saveSnapshot();
  }

  public async seedAgents(seeds: AgentRow[] = SEED_AGENTS): Promise<AgentRow[]> {
    const results: AgentRow[] = [];
    for (const seed of seeds) {
      results.push(await this.upsertAgent(seed));
    }
    return results;
  }

  private async syncSeedAgentsToPostgres(): Promise<void> {
    if (!this.pg.isConnected()) return;

    // Ensure additive schema migrations for sprints, backlog_items, and contracts are present
    await this.pg.query(`
      ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_department_check;
      ALTER TABLE agents ADD CONSTRAINT agents_department_check
        CHECK (department IN ('executive', 'tech', 'infra', 'marketing', 'sales', 'hr', 'ops', 'support', 'finance', 'product'));
      ALTER TABLE sprints ADD COLUMN IF NOT EXISTS week_label TEXT;
      ALTER TABLE sprints ADD COLUMN IF NOT EXISTS weekly_plan_json JSONB NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE sprints ADD COLUMN IF NOT EXISTS task_movements_json JSONB NOT NULL DEFAULT '[]'::jsonb;
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
    `);

    for (const agent of this.state.agents) {
      await this.pg.query(
        `INSERT INTO agents (
          id, slug, name, department, hierarchy_level, parent_agent_id, project_scope,
          model_provider, model_id, fallback_provider, fallback_model_id, step_routing_json,
          init_prompt, allowed_repos, permission_tier,
          status, health_status, last_heartbeat_at, max_subagents, active_subagent_count,
          max_run_duration_ms, current_run_id, clocked_in_at, total_work_time_ms,
          total_runs, total_commits, max_tokens_per_run, today_tokens_used,
          total_tokens_in, total_tokens_cached, total_tokens_thinking, total_tokens_out,
          total_cost_usd, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12::jsonb,
          $13, $14::jsonb, $15,
          $16, $17, $18, $19, $20,
          $21, $22, $23, $24,
          $25, $26, $27, $28,
          $29, $30, $31, $32,
          $33, $34, $35
        )
        ON CONFLICT (id) DO NOTHING`,
        [
          agent.id,
          agent.slug,
          agent.name,
          agent.department,
          agent.hierarchy_level,
          agent.parent_agent_id,
          agent.project_scope,
          agent.model_provider,
          agent.model_id,
          agent.fallback_provider || 'vertex',
          agent.fallback_model_id || 'gemini-2.0-flash',
          JSON.stringify(agent.step_routing_json || {}),
          agent.init_prompt,
          JSON.stringify(agent.allowed_repos || []),
          agent.permission_tier,
          agent.status,
          agent.health_status,
          agent.last_heartbeat_at,
          agent.max_subagents,
          agent.active_subagent_count,
          agent.max_run_duration_ms,
          agent.current_run_id,
          agent.clocked_in_at,
          agent.total_work_time_ms,
          agent.total_runs,
          agent.total_commits,
          agent.max_tokens_per_run,
          agent.today_tokens_used,
          agent.total_tokens_in,
          agent.total_tokens_cached,
          agent.total_tokens_thinking,
          agent.total_tokens_out,
          agent.total_cost_usd,
          agent.created_at,
          agent.updated_at,
        ]
      );
    }

    for (const cred of this.state.provider_credentials) {
      await this.pg.query(
        `INSERT INTO provider_credentials (
          id, provider, label, api_key_encrypted, base_url, remaining_budget_usd,
          rpm_limit, tpm_limit, priority_order, is_active, cooldown_until,
          total_requests, total_failures, last_error, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11,
          $12, $13, $14, $15, $16
        )
        ON CONFLICT (id) DO NOTHING`,
        [
          cred.id,
          cred.provider,
          cred.label,
          cred.api_key_encrypted,
          cred.base_url,
          cred.remaining_budget_usd,
          cred.rpm_limit,
          cred.tpm_limit,
          cred.priority_order,
          cred.is_active,
          cred.cooldown_until,
          cred.total_requests,
          cred.total_failures,
          cred.last_error,
          cred.created_at,
          cred.updated_at,
        ]
      );
    }

    for (const profile of this.state.routing_profiles) {
      await this.pg.query(
        `INSERT INTO routing_profiles (
          id, name, description, is_active, config_json, updated_at
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
        ON CONFLICT (id) DO NOTHING`,
        [
          profile.id,
          profile.name,
          profile.description,
          profile.is_active,
          JSON.stringify(profile.config_json || {}),
          profile.updated_at,
        ]
      );
    }
  }

  public getStatus() {
    return {
      mode: this.getMode(),
      postgresConnected: this.pg.isConnected(),
      snapshotPath: this.snapshotPath,
      activeRoutingProfile: this.state.active_routing_profile,
      counts: {
        agents: this.state.agents.length,
        provider_credentials: this.state.provider_credentials.length,
        routing_profiles: this.state.routing_profiles.length,
        project_contexts: this.state.project_contexts.length,
        agent_memories: this.state.agent_memories.length,
        agent_runs: this.state.agent_runs.length,
        inference_steps: this.state.inference_steps.length,
        chat_threads: this.state.chat_threads.length,
        chat_messages: this.state.chat_messages.length,
        sprints: this.state.sprints.length,
        backlog_items: this.state.backlog_items.length,
        approval_gates: this.state.approval_gates.length,
        code_chunks: this.state.code_chunks.length,
        contracts: this.state.contracts.length,
      },
    };
  }

  // ==========================================================================
  // 1. AGENTS REPOSITORY
  // ==========================================================================

  private mapPgAgentRow(r: any): AgentRow {
    return {
      id: String(r.id),
      slug: String(r.slug),
      name: String(r.name),
      department: r.department as Department,
      hierarchy_level: Number(r.hierarchy_level) as HierarchyLevel,
      parent_agent_id: r.parent_agent_id ?? null,
      project_scope: r.project_scope ?? null,
      model_provider: (r.model_provider || 'vertex') as ModelProvider,
      model_id: String(r.model_id || 'gemini-2.5-pro'),
      fallback_provider: (r.fallback_provider || 'vertex') as ModelProvider,
      fallback_model_id: String(r.fallback_model_id || 'gemini-2.0-flash'),
      step_routing_json:
        r.step_routing_json && typeof r.step_routing_json === 'object'
          ? (r.step_routing_json as StepRoutingConfig)
          : {},
      init_prompt: String(r.init_prompt || ''),
      allowed_repos: Array.isArray(r.allowed_repos) ? r.allowed_repos : [],
      permission_tier: (r.permission_tier || 'standard_autonomous') as PermissionTier,
      status: (r.status || 'IDLE') as AgentStatus,
      health_status: (r.health_status || 'HEALTHY') as AgentHealthStatus,
      last_heartbeat_at: r.last_heartbeat_at ? new Date(r.last_heartbeat_at).toISOString() : null,
      max_subagents: Number(r.max_subagents ?? 4),
      active_subagent_count: Number(r.active_subagent_count ?? 0),
      max_run_duration_ms: Number(r.max_run_duration_ms ?? 86_400_000),
      current_run_id: r.current_run_id ?? null,
      clocked_in_at: r.clocked_in_at ? new Date(r.clocked_in_at).toISOString() : null,
      total_work_time_ms: Number(r.total_work_time_ms ?? 0),
      total_runs: Number(r.total_runs ?? 0),
      total_commits: Number(r.total_commits ?? 0),
      max_tokens_per_run: Number(r.max_tokens_per_run ?? 1_000_000),
      today_tokens_used: Number(r.today_tokens_used ?? 0),
      total_tokens_in: Number(r.total_tokens_in ?? 0),
      total_tokens_cached: Number(r.total_tokens_cached ?? 0),
      total_tokens_thinking: Number(r.total_tokens_thinking ?? 0),
      total_tokens_out: Number(r.total_tokens_out ?? 0),
      total_cost_usd: Number(r.total_cost_usd ?? 0),
      created_at: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
      updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
    };
  }

  public async listAgents(filter?: {
    department?: Department;
    project_scope?: string;
    status?: AgentStatus;
    hierarchy_level?: HierarchyLevel;
  }): Promise<AgentRow[]> {
    if (this.pg.isConnected()) {
      const res = await this.pg.query(
        'SELECT * FROM agents ORDER BY hierarchy_level ASC, department ASC, id ASC'
      );
      if (res && res.rows.length > 0) {
        this.state.agents = res.rows.map((r) => this.mapPgAgentRow(r));
      }
    }

    let items = [...this.state.agents];
    if (filter?.department) {
      items = items.filter((a) => a.department === filter.department);
    }
    if (filter?.project_scope) {
      items = items.filter(
        (a) => a.project_scope === filter.project_scope || a.project_scope === 'GLOBAL'
      );
    }
    if (filter?.status) {
      items = items.filter((a) => a.status === filter.status);
    }
    if (filter?.hierarchy_level !== undefined) {
      items = items.filter((a) => a.hierarchy_level === filter.hierarchy_level);
    }
    return items.sort(
      (a, b) => a.hierarchy_level - b.hierarchy_level || a.id.localeCompare(b.id)
    );
  }

  public async getAgents(filter?: {
    department?: Department;
    project_scope?: string;
    status?: AgentStatus;
    hierarchy_level?: HierarchyLevel;
  }): Promise<AgentRow[]> {
    return this.listAgents(filter);
  }

  public async getAgent(idOrSlug: string): Promise<AgentRow | null> {
    const key = normalizeAgentKey(idOrSlug);
    const slugKey = `@${key}`;
    if (this.pg.isConnected()) {
      const res = await this.pg.query(
        'SELECT * FROM agents WHERE id = $1 OR slug = $2 LIMIT 1',
        [key, slugKey]
      );
      if (res && res.rows[0]) {
        return this.mapPgAgentRow(res.rows[0]);
      }
    }
    const found = this.state.agents.find(
      (a) => a.id === key || a.slug === slugKey || a.id === idOrSlug || a.slug === idOrSlug
    );
    return found ? structuredClone(found) : null;
  }

  public async upsertAgent(
    input: Partial<AgentRow> & { id: string; name?: string }
  ): Promise<AgentRow> {
    const now = new Date().toISOString();
    const id = normalizeAgentKey(input.id);
    const existingIdx = this.state.agents.findIndex((a) => a.id === id);
    const existing = existingIdx >= 0 ? this.state.agents[existingIdx] : undefined;

    const merged: AgentRow = {
      id,
      slug: input.slug || existing?.slug || `@${id}`,
      name: input.name || existing?.name || id,
      department: input.department || existing?.department || 'tech',
      hierarchy_level:
        input.hierarchy_level !== undefined
          ? input.hierarchy_level
          : (existing?.hierarchy_level ?? 2),
      parent_agent_id:
        input.parent_agent_id !== undefined
          ? input.parent_agent_id
          : (existing?.parent_agent_id ?? 'cto'),
      project_scope:
        input.project_scope !== undefined
          ? input.project_scope
          : (existing?.project_scope ?? 'GLOBAL'),
      model_provider: input.model_provider || existing?.model_provider || 'vertex',
      model_id: input.model_id || existing?.model_id || 'gemini-2.5-pro',
      fallback_provider:
        input.fallback_provider || existing?.fallback_provider || 'vertex',
      fallback_model_id:
        input.fallback_model_id || existing?.fallback_model_id || 'gemini-2.0-flash',
      step_routing_json:
        input.step_routing_json ??
        existing?.step_routing_json ?? {
          planning: { provider: 'vertex', modelId: 'gemini-2.5-pro' },
          tool_loop: { provider: 'vertex', modelId: 'gemini-2.0-flash' },
          compaction: { provider: 'ollama', modelId: 'qwen2.5-coder:32b' },
        },
      init_prompt: input.init_prompt ?? existing?.init_prompt ?? '',
      allowed_repos: input.allowed_repos ?? existing?.allowed_repos ?? [],
      permission_tier:
        input.permission_tier || existing?.permission_tier || 'standard_autonomous',
      status: input.status || existing?.status || 'IDLE',
      health_status: input.health_status || existing?.health_status || 'HEALTHY',
      last_heartbeat_at:
        input.last_heartbeat_at !== undefined
          ? input.last_heartbeat_at
          : (existing?.last_heartbeat_at ?? now),
      max_subagents: input.max_subagents ?? existing?.max_subagents ?? 4,
      active_subagent_count:
        input.active_subagent_count ?? existing?.active_subagent_count ?? 0,
      max_run_duration_ms:
        input.max_run_duration_ms ?? existing?.max_run_duration_ms ?? 86_400_000,
      current_run_id:
        input.current_run_id !== undefined
          ? input.current_run_id
          : (existing?.current_run_id ?? null),
      clocked_in_at:
        input.clocked_in_at !== undefined
          ? input.clocked_in_at
          : (existing?.clocked_in_at ?? null),
      total_work_time_ms: input.total_work_time_ms ?? existing?.total_work_time_ms ?? 0,
      total_runs: input.total_runs ?? existing?.total_runs ?? 0,
      total_commits: input.total_commits ?? existing?.total_commits ?? 0,
      max_tokens_per_run:
        input.max_tokens_per_run ?? existing?.max_tokens_per_run ?? 1_000_000,
      today_tokens_used: input.today_tokens_used ?? existing?.today_tokens_used ?? 0,
      total_tokens_in: input.total_tokens_in ?? existing?.total_tokens_in ?? 0,
      total_tokens_cached: input.total_tokens_cached ?? existing?.total_tokens_cached ?? 0,
      total_tokens_thinking:
        input.total_tokens_thinking ?? existing?.total_tokens_thinking ?? 0,
      total_tokens_out: input.total_tokens_out ?? existing?.total_tokens_out ?? 0,
      total_cost_usd: Number(input.total_cost_usd ?? existing?.total_cost_usd ?? 0),
      created_at: existing?.created_at || input.created_at || now,
      updated_at: now,
    };

    if (existingIdx >= 0) {
      this.state.agents[existingIdx] = merged;
    } else {
      this.state.agents.push(merged);
    }
    this.saveSnapshot();

    if (this.pg.isConnected()) {
      await this.pg.query(
        `INSERT INTO agents (
          id, slug, name, department, hierarchy_level, parent_agent_id, project_scope,
          model_provider, model_id, fallback_provider, fallback_model_id, step_routing_json,
          init_prompt, allowed_repos, permission_tier,
          status, health_status, last_heartbeat_at, max_subagents, active_subagent_count,
          max_run_duration_ms, current_run_id, clocked_in_at, total_work_time_ms,
          total_runs, total_commits, max_tokens_per_run, today_tokens_used,
          total_tokens_in, total_tokens_cached, total_tokens_thinking, total_tokens_out,
          total_cost_usd, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12::jsonb,
          $13, $14::jsonb, $15,
          $16, $17, $18, $19, $20,
          $21, $22, $23, $24,
          $25, $26, $27, $28,
          $29, $30, $31, $32,
          $33, $34, $35
        )
        ON CONFLICT (id) DO UPDATE SET
          slug = EXCLUDED.slug,
          name = EXCLUDED.name,
          department = EXCLUDED.department,
          hierarchy_level = EXCLUDED.hierarchy_level,
          parent_agent_id = EXCLUDED.parent_agent_id,
          project_scope = EXCLUDED.project_scope,
          model_provider = EXCLUDED.model_provider,
          model_id = EXCLUDED.model_id,
          fallback_provider = EXCLUDED.fallback_provider,
          fallback_model_id = EXCLUDED.fallback_model_id,
          step_routing_json = EXCLUDED.step_routing_json,
          init_prompt = EXCLUDED.init_prompt,
          allowed_repos = EXCLUDED.allowed_repos,
          permission_tier = EXCLUDED.permission_tier,
          status = EXCLUDED.status,
          health_status = EXCLUDED.health_status,
          last_heartbeat_at = EXCLUDED.last_heartbeat_at,
          max_subagents = EXCLUDED.max_subagents,
          active_subagent_count = EXCLUDED.active_subagent_count,
          max_run_duration_ms = EXCLUDED.max_run_duration_ms,
          current_run_id = EXCLUDED.current_run_id,
          clocked_in_at = EXCLUDED.clocked_in_at,
          total_work_time_ms = EXCLUDED.total_work_time_ms,
          total_runs = EXCLUDED.total_runs,
          total_commits = EXCLUDED.total_commits,
          max_tokens_per_run = EXCLUDED.max_tokens_per_run,
          today_tokens_used = EXCLUDED.today_tokens_used,
          total_tokens_in = EXCLUDED.total_tokens_in,
          total_tokens_cached = EXCLUDED.total_tokens_cached,
          total_tokens_thinking = EXCLUDED.total_tokens_thinking,
          total_tokens_out = EXCLUDED.total_tokens_out,
          total_cost_usd = EXCLUDED.total_cost_usd,
          updated_at = EXCLUDED.updated_at`,
        [
          merged.id,
          merged.slug,
          merged.name,
          merged.department,
          merged.hierarchy_level,
          merged.parent_agent_id,
          merged.project_scope,
          merged.model_provider,
          merged.model_id,
          merged.fallback_provider,
          merged.fallback_model_id,
          JSON.stringify(merged.step_routing_json || {}),
          merged.init_prompt,
          JSON.stringify(merged.allowed_repos),
          merged.permission_tier,
          merged.status,
          merged.health_status,
          merged.last_heartbeat_at,
          merged.max_subagents,
          merged.active_subagent_count,
          merged.max_run_duration_ms,
          merged.current_run_id,
          merged.clocked_in_at,
          merged.total_work_time_ms,
          merged.total_runs,
          merged.total_commits,
          merged.max_tokens_per_run,
          merged.today_tokens_used,
          merged.total_tokens_in,
          merged.total_tokens_cached,
          merged.total_tokens_thinking,
          merged.total_tokens_out,
          merged.total_cost_usd,
          merged.created_at,
          merged.updated_at,
        ]
      );
    }

    return structuredClone(merged);
  }

  public async updateAgent(
    idOrSlug: string,
    patch: Partial<AgentRow>
  ): Promise<AgentRow | null> {
    const existing = await this.getAgent(idOrSlug);
    if (!existing) return null;
    return this.upsertAgent({ ...existing, ...patch, id: existing.id });
  }

  public async updateAgentBrain(
    idOrSlug: string,
    patch: {
      init_prompt?: string;
      model_provider?: ModelProvider;
      model_id?: string;
      fallback_provider?: ModelProvider;
      fallback_model_id?: string;
      step_routing_json?: StepRoutingConfig;
      allowed_repos?: string[];
      permission_tier?: PermissionTier;
      max_subagents?: number;
      max_run_duration_ms?: number;
      max_tokens_per_run?: number;
    }
  ): Promise<AgentRow | null> {
    return this.updateAgent(idOrSlug, patch);
  }

  public async recordAgentHeartbeat(
    idOrSlug: string,
    patch?: {
      status?: AgentStatus;
      health_status?: AgentHealthStatus;
      active_subagent_count?: number;
    }
  ): Promise<AgentRow | null> {
    return this.updateAgent(idOrSlug, {
      ...patch,
      last_heartbeat_at: new Date().toISOString(),
    });
  }

  public async incrementAgentTelemetry(
    idOrSlug: string,
    delta: {
      work_time_ms?: number;
      runs?: number;
      commits?: number;
      tokens_in?: number;
      tokens_cached?: number;
      tokens_thinking?: number;
      tokens_out?: number;
      cost_usd?: number;
    }
  ): Promise<AgentRow | null> {
    const existing = await this.getAgent(idOrSlug);
    if (!existing) return null;
    const addedTokens =
      (delta.tokens_in || 0) + (delta.tokens_thinking || 0) + (delta.tokens_out || 0);
    return this.upsertAgent({
      ...existing,
      total_work_time_ms: existing.total_work_time_ms + (delta.work_time_ms || 0),
      total_runs: existing.total_runs + (delta.runs || 0),
      total_commits: existing.total_commits + (delta.commits || 0),
      today_tokens_used: existing.today_tokens_used + addedTokens,
      total_tokens_in: existing.total_tokens_in + (delta.tokens_in || 0),
      total_tokens_cached: existing.total_tokens_cached + (delta.tokens_cached || 0),
      total_tokens_thinking: existing.total_tokens_thinking + (delta.tokens_thinking || 0),
      total_tokens_out: existing.total_tokens_out + (delta.tokens_out || 0),
      total_cost_usd: Number(
        (existing.total_cost_usd + (delta.cost_usd || 0)).toFixed(6)
      ),
    });
  }

  // ==========================================================================
  // 2. PROJECT CONTEXTS REPOSITORY
  // ==========================================================================

  public async listProjectContexts(projectSlug?: string): Promise<ProjectContextRow[]> {
    if (this.pg.isConnected()) {
      const res = projectSlug
        ? await this.pg.query(
            'SELECT * FROM project_contexts WHERE project_slug = $1 ORDER BY id ASC',
            [projectSlug]
          )
        : await this.pg.query('SELECT * FROM project_contexts ORDER BY id ASC');
      if (res && res.rows.length > 0) {
        return res.rows.map((r) => ({
          id: String(r.id),
          project_slug: String(r.project_slug),
          repo_slug: String(r.repo_slug),
          git_repo_url: r.git_repo_url ?? null,
          local_path: r.local_path ?? null,
          default_branch: String(r.default_branch || 'main'),
          role: (r.role || 'fullstack') as RepoRole,
          docker_base_image: String(r.docker_base_image || 'commando-workspace:latest'),
          build_cmd: r.build_cmd ?? null,
          test_cmd: r.test_cmd ?? null,
          dev_preview_port: r.dev_preview_port !== null ? Number(r.dev_preview_port) : null,
          architecture_doc_md: String(r.architecture_doc_md || ''),
          topology_json:
            r.topology_json && typeof r.topology_json === 'object' ? r.topology_json : {},
          updated_at: r.updated_at
            ? new Date(r.updated_at).toISOString()
            : new Date().toISOString(),
        }));
      }
    }

    let items = [...this.state.project_contexts];
    if (projectSlug) {
      items = items.filter((p) => p.project_slug === projectSlug);
    }
    return items.sort((a, b) => a.id.localeCompare(b.id));
  }

  public async getProjectContexts(projectSlug?: string): Promise<ProjectContextRow[]> {
    return this.listProjectContexts(projectSlug);
  }

  public async getProjectContext(
    projectSlug: string,
    repoSlug = 'GLOBAL'
  ): Promise<ProjectContextRow | null> {
    const id = `${projectSlug}:${repoSlug}`;
    const found = this.state.project_contexts.find(
      (c) =>
        c.id === id || (c.project_slug === projectSlug && c.repo_slug === repoSlug)
    );
    return found ? structuredClone(found) : null;
  }

  public async upsertProjectContext(
    input: Partial<ProjectContextRow> & { project_slug: string; repo_slug: string }
  ): Promise<ProjectContextRow> {
    const now = new Date().toISOString();
    const id = input.id || `${input.project_slug}:${input.repo_slug}`;
    const existingIdx = this.state.project_contexts.findIndex(
      (c) =>
        c.id === id ||
        (c.project_slug === input.project_slug && c.repo_slug === input.repo_slug)
    );
    const existing =
      existingIdx >= 0 ? this.state.project_contexts[existingIdx] : undefined;

    const merged: ProjectContextRow = {
      id,
      project_slug: input.project_slug,
      repo_slug: input.repo_slug,
      git_repo_url: input.git_repo_url ?? existing?.git_repo_url ?? null,
      local_path: input.local_path ?? existing?.local_path ?? null,
      default_branch: input.default_branch || existing?.default_branch || 'main',
      role: input.role || existing?.role || 'fullstack',
      docker_base_image:
        input.docker_base_image ||
        existing?.docker_base_image ||
        'commando-workspace:latest',
      build_cmd: input.build_cmd ?? existing?.build_cmd ?? null,
      test_cmd: input.test_cmd ?? existing?.test_cmd ?? null,
      dev_preview_port:
        input.dev_preview_port !== undefined
          ? input.dev_preview_port
          : (existing?.dev_preview_port ?? null),
      architecture_doc_md:
        input.architecture_doc_md ?? existing?.architecture_doc_md ?? '',
      topology_json: input.topology_json ?? existing?.topology_json ?? {},
      updated_at: now,
    };

    if (existingIdx >= 0) {
      this.state.project_contexts[existingIdx] = merged;
    } else {
      this.state.project_contexts.push(merged);
    }
    this.saveSnapshot();

    if (this.pg.isConnected()) {
      await this.pg.query(
        `INSERT INTO project_contexts (
          id, project_slug, repo_slug, git_repo_url, local_path, default_branch,
          role, docker_base_image, build_cmd, test_cmd, dev_preview_port,
          architecture_doc_md, topology_json, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11,
          $12, $13::jsonb, $14
        )
        ON CONFLICT (id) DO UPDATE SET
          project_slug = EXCLUDED.project_slug,
          repo_slug = EXCLUDED.repo_slug,
          git_repo_url = EXCLUDED.git_repo_url,
          local_path = EXCLUDED.local_path,
          default_branch = EXCLUDED.default_branch,
          role = EXCLUDED.role,
          docker_base_image = EXCLUDED.docker_base_image,
          build_cmd = EXCLUDED.build_cmd,
          test_cmd = EXCLUDED.test_cmd,
          dev_preview_port = EXCLUDED.dev_preview_port,
          architecture_doc_md = EXCLUDED.architecture_doc_md,
          topology_json = EXCLUDED.topology_json,
          updated_at = EXCLUDED.updated_at`,
        [
          merged.id,
          merged.project_slug,
          merged.repo_slug,
          merged.git_repo_url,
          merged.local_path,
          merged.default_branch,
          merged.role,
          merged.docker_base_image,
          merged.build_cmd,
          merged.test_cmd,
          merged.dev_preview_port,
          merged.architecture_doc_md,
          JSON.stringify(merged.topology_json || {}),
          merged.updated_at,
        ]
      );
    }

    return structuredClone(merged);
  }

  // ==========================================================================
  // 3. AGENT MEMORIES REPOSITORY (Pinned + pgvector Semantic Search)
  // ==========================================================================

  public async listAgentMemories(filter?: {
    agent_id?: string;
    project_scope?: string;
    is_pinned?: boolean;
    memory_type?: MemoryType;
    limit?: number;
  }): Promise<AgentMemoryRow[]> {
    let items = [...this.state.agent_memories];
    if (filter?.agent_id) {
      const norm = normalizeAgentKey(filter.agent_id);
      items = items.filter((m) => m.agent_id === norm || m.agent_id === filter.agent_id);
    }
    if (filter?.project_scope) {
      items = items.filter(
        (m) =>
          m.project_scope === filter.project_scope ||
          m.project_scope === 'GLOBAL' ||
          m.project_scope === null
      );
    }
    if (filter?.is_pinned !== undefined) {
      items = items.filter((m) => m.is_pinned === filter.is_pinned);
    }
    if (filter?.memory_type) {
      items = items.filter((m) => m.memory_type === filter.memory_type);
    }
    items.sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (filter?.limit && filter.limit > 0) {
      items = items.slice(0, filter.limit);
    }
    return items;
  }

  public async getAgentMemories(filter?: {
    agent_id?: string;
    project_scope?: string;
    is_pinned?: boolean;
    memory_type?: MemoryType;
    limit?: number;
  }): Promise<AgentMemoryRow[]> {
    return this.listAgentMemories(filter);
  }

  public async getPinnedMemories(
    agentId: string,
    projectScope?: string | null
  ): Promise<AgentMemoryRow[]> {
    return this.listAgentMemories({
      agent_id: agentId,
      project_scope: projectScope ?? undefined,
      is_pinned: true,
    });
  }

  public async addAgentMemory(
    input: Partial<AgentMemoryRow> & {
      agent_id: string;
      content: string;
      memory_type?: MemoryType;
    }
  ): Promise<AgentMemoryRow> {
    const agentId = normalizeAgentKey(input.agent_id);
    const trimmedContent = input.content.trim();

    // Deduplicate identical (agent_id, content)
    const existingIdx = this.state.agent_memories.findIndex(
      (m) => m.agent_id === agentId && m.content.trim() === trimmedContent
    );

    const memoryType: MemoryType = input.memory_type || 'EPISODIC_LESSON';
    const isPinned =
      input.is_pinned !== undefined
        ? input.is_pinned
        : memoryType === 'PINNED_PREFERENCE' || memoryType === 'REPO_GOTCHA';

    const embedding =
      input.embedding && input.embedding.length === 768
        ? input.embedding
        : generateDeterministicEmbedding(`${agentId} ${input.project_scope || ''} ${trimmedContent}`);

    const row: AgentMemoryRow = {
      id:
        input.id ||
        (existingIdx >= 0
          ? this.state.agent_memories[existingIdx].id
          : crypto.randomUUID()),
      agent_id: agentId,
      project_scope: input.project_scope ?? null,
      memory_type: memoryType,
      content: trimmedContent,
      source_run_id: input.source_run_id ?? null,
      is_pinned: isPinned,
      embedding,
      created_at:
        existingIdx >= 0
          ? this.state.agent_memories[existingIdx].created_at
          : input.created_at || new Date().toISOString(),
    };

    if (existingIdx >= 0) {
      this.state.agent_memories[existingIdx] = row;
    } else {
      this.state.agent_memories.push(row);
    }
    this.saveSnapshot();

    if (this.pg.isConnected()) {
      await this.pg.query(
        `INSERT INTO agent_memories (
          id, agent_id, project_scope, memory_type, content,
          source_run_id, is_pinned, embedding, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector, $9)
        ON CONFLICT (id) DO UPDATE SET
          memory_type = EXCLUDED.memory_type,
          content = EXCLUDED.content,
          is_pinned = EXCLUDED.is_pinned,
          embedding = EXCLUDED.embedding`,
        [
          row.id,
          row.agent_id,
          row.project_scope,
          row.memory_type,
          row.content,
          row.source_run_id,
          row.is_pinned,
          formatPgVector(row.embedding),
          row.created_at,
        ]
      );
    }

    return structuredClone(row);
  }

  public async createAgentMemory(
    input: Partial<AgentMemoryRow> & {
      agent_id: string;
      content: string;
      memory_type?: MemoryType;
    }
  ): Promise<AgentMemoryRow> {
    return this.addAgentMemory(input);
  }

  public async deleteAgentMemory(id: string): Promise<boolean> {
    const before = this.state.agent_memories.length;
    this.state.agent_memories = this.state.agent_memories.filter((m) => m.id !== id);
    const changed = this.state.agent_memories.length !== before;
    if (changed) this.saveSnapshot();
    if (this.pg.isConnected()) {
      await this.pg.query('DELETE FROM agent_memories WHERE id = $1', [id]);
    }
    return changed;
  }

  public async searchAgentMemories(params: {
    queryText?: string;
    queryEmbedding?: number[];
    agent_id?: string;
    project_scope?: string;
    memory_type?: MemoryType;
    topK?: number;
    includePinned?: boolean;
  }): Promise<Array<AgentMemoryRow & { similarity: number }>> {
    const topK = params.topK ?? 5;
    const queryVec =
      params.queryEmbedding && params.queryEmbedding.length === 768
        ? params.queryEmbedding
        : generateDeterministicEmbedding(params.queryText || '');

    if (this.pg.isConnected()) {
      const clauses: string[] = ['embedding IS NOT NULL'];
      const sqlParams: unknown[] = [formatPgVector(queryVec)];
      if (params.agent_id) {
        sqlParams.push(normalizeAgentKey(params.agent_id));
        clauses.push(`agent_id = $${sqlParams.length}`);
      }
      if (params.project_scope) {
        sqlParams.push(params.project_scope);
        clauses.push(`(project_scope = $${sqlParams.length} OR project_scope IS NULL OR project_scope = 'GLOBAL')`);
      }
      if (params.memory_type) {
        sqlParams.push(params.memory_type);
        clauses.push(`memory_type = $${sqlParams.length}`);
      }
      if (params.includePinned === false) {
        clauses.push('is_pinned = FALSE');
      }
      sqlParams.push(topK);
      const res = await this.pg.query(
        `SELECT *, 1 - (embedding <=> $1::vector) AS similarity
         FROM agent_memories
         WHERE ${clauses.join(' AND ')}
         ORDER BY embedding <=> $1::vector ASC
         LIMIT $${sqlParams.length}`,
        sqlParams
      );
      if (res && res.rows.length > 0) {
        return res.rows.map((r) => ({
          id: String(r.id),
          agent_id: String(r.agent_id),
          project_scope: r.project_scope ?? null,
          memory_type: r.memory_type as MemoryType,
          content: String(r.content),
          source_run_id: r.source_run_id ?? null,
          is_pinned: Boolean(r.is_pinned),
          embedding: parsePgVector(r.embedding),
          created_at: new Date(r.created_at).toISOString(),
          similarity: Number(r.similarity ?? 0),
        }));
      }
    }

    let candidates = [...this.state.agent_memories];
    if (params.agent_id) {
      const norm = normalizeAgentKey(params.agent_id);
      candidates = candidates.filter((m) => m.agent_id === norm);
    }
    if (params.project_scope) {
      candidates = candidates.filter(
        (m) =>
          m.project_scope === params.project_scope ||
          m.project_scope === 'GLOBAL' ||
          m.project_scope === null
      );
    }
    if (params.memory_type) {
      candidates = candidates.filter((m) => m.memory_type === params.memory_type);
    }
    if (params.includePinned === false) {
      candidates = candidates.filter((m) => !m.is_pinned);
    }

    const keywords = (params.queryText || '')
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 2);

    const scored = candidates.map((m) => {
      const vecSim = cosineSimilarity(m.embedding, queryVec);
      let keywordBoost = 0;
      if (keywords.length > 0) {
        const lower = m.content.toLowerCase();
        const hits = keywords.filter((kw) => lower.includes(kw)).length;
        keywordBoost = (hits / keywords.length) * 0.25;
      }
      return {
        ...m,
        similarity: Number(Math.min(1, vecSim + keywordBoost).toFixed(4)),
      };
    });

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, topK);
  }

  // ==========================================================================
  // 4. AGENT RUNS REPOSITORY
  // ==========================================================================

  public async listAgentRuns(filter?: {
    agent_id?: string;
    status?: AgentRunStatus;
    chat_thread_id?: string;
    sprint_id?: string;
    backlog_item_id?: string;
    limit?: number;
  }): Promise<AgentRunRow[]> {
    let items = [...this.state.agent_runs];
    if (filter?.agent_id) {
      const norm = normalizeAgentKey(filter.agent_id);
      items = items.filter((r) => r.agent_id === norm || r.agent_id === filter.agent_id);
    }
    if (filter?.status) {
      items = items.filter((r) => r.status === filter.status);
    }
    if (filter?.chat_thread_id) {
      items = items.filter((r) => r.chat_thread_id === filter.chat_thread_id);
    }
    if (filter?.sprint_id) {
      items = items.filter((r) => r.sprint_id === filter.sprint_id);
    }
    if (filter?.backlog_item_id) {
      items = items.filter((r) => r.backlog_item_id === filter.backlog_item_id);
    }
    items.sort((a, b) => b.started_at.localeCompare(a.started_at));
    if (filter?.limit && filter.limit > 0) {
      items = items.slice(0, filter.limit);
    }
    return items;
  }

  public async getAgentRuns(filter?: {
    agent_id?: string;
    status?: AgentRunStatus;
    chat_thread_id?: string;
    sprint_id?: string;
    backlog_item_id?: string;
    limit?: number;
  }): Promise<AgentRunRow[]> {
    return this.listAgentRuns(filter);
  }

  public async getAgentRun(id: string): Promise<AgentRunRow | null> {
    const found = this.state.agent_runs.find((r) => r.id === id);
    return found ? structuredClone(found) : null;
  }

  public async startAgentRun(
    input: Partial<AgentRunRow> & {
      agent_id: string;
      input_prompt: string;
      trigger_type?: RunTriggerType;
    }
  ): Promise<AgentRunRow> {
    const now = new Date().toISOString();
    const agentId = normalizeAgentKey(input.agent_id);
    const run: AgentRunRow = {
      id: input.id || crypto.randomUUID(),
      agent_id: agentId,
      parent_run_id: input.parent_run_id ?? null,
      chat_thread_id: input.chat_thread_id ?? null,
      sprint_id: input.sprint_id ?? null,
      backlog_item_id: input.backlog_item_id ?? null,
      trigger_type: input.trigger_type || 'CEO_CHAT',
      input_prompt: input.input_prompt,
      output_summary: input.output_summary ?? null,
      status: input.status || 'RUNNING',
      container_id: input.container_id ?? null,
      git_branch: input.git_branch ?? null,
      git_commit_sha: input.git_commit_sha ?? null,
      preview_url: input.preview_url ?? null,
      qa_passed: input.qa_passed ?? null,
      qa_screenshot_url: input.qa_screenshot_url ?? null,
      started_at: input.started_at || now,
      ended_at: input.ended_at ?? null,
      active_duration_ms: input.active_duration_ms ?? 0,
      pause_duration_ms: input.pause_duration_ms ?? 0,
      tokens_in: input.tokens_in ?? 0,
      tokens_cached: input.tokens_cached ?? 0,
      tokens_thinking: input.tokens_thinking ?? 0,
      tokens_out: input.tokens_out ?? 0,
      cost_usd: Number(input.cost_usd ?? 0),
    };

    const existingIdx = this.state.agent_runs.findIndex((r) => r.id === run.id);
    if (existingIdx >= 0) {
      this.state.agent_runs[existingIdx] = run;
    } else {
      this.state.agent_runs.push(run);
    }

    if (run.status === 'RUNNING') {
      await this.updateAgent(agentId, {
        status: 'WORKING',
        health_status: 'HEALTHY',
        current_run_id: run.id,
        clocked_in_at: run.started_at,
        last_heartbeat_at: now,
      });
    } else {
      this.saveSnapshot();
    }

    if (this.pg.isConnected()) {
      await this.pg.query(
        `INSERT INTO agent_runs (
          id, agent_id, parent_run_id, chat_thread_id, sprint_id, backlog_item_id,
          trigger_type, input_prompt, output_summary, status, container_id,
          git_branch, git_commit_sha, preview_url, qa_passed, qa_screenshot_url,
          started_at, ended_at, active_duration_ms, pause_duration_ms,
          tokens_in, tokens_cached, tokens_thinking, tokens_out, cost_usd
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11,
          $12, $13, $14, $15, $16,
          $17, $18, $19, $20,
          $21, $22, $23, $24, $25
        )
        ON CONFLICT (id) DO UPDATE SET
          output_summary = EXCLUDED.output_summary,
          status = EXCLUDED.status,
          container_id = EXCLUDED.container_id,
          git_branch = EXCLUDED.git_branch,
          git_commit_sha = EXCLUDED.git_commit_sha,
          preview_url = EXCLUDED.preview_url,
          qa_passed = EXCLUDED.qa_passed,
          qa_screenshot_url = EXCLUDED.qa_screenshot_url,
          ended_at = EXCLUDED.ended_at,
          active_duration_ms = EXCLUDED.active_duration_ms,
          pause_duration_ms = EXCLUDED.pause_duration_ms,
          tokens_in = EXCLUDED.tokens_in,
          tokens_cached = EXCLUDED.tokens_cached,
          tokens_thinking = EXCLUDED.tokens_thinking,
          tokens_out = EXCLUDED.tokens_out,
          cost_usd = EXCLUDED.cost_usd`,
        [
          run.id,
          run.agent_id,
          run.parent_run_id,
          run.chat_thread_id,
          run.sprint_id,
          run.backlog_item_id,
          run.trigger_type,
          run.input_prompt,
          run.output_summary,
          run.status,
          run.container_id,
          run.git_branch,
          run.git_commit_sha,
          run.preview_url,
          run.qa_passed,
          run.qa_screenshot_url,
          run.started_at,
          run.ended_at,
          run.active_duration_ms,
          run.pause_duration_ms,
          run.tokens_in,
          run.tokens_cached,
          run.tokens_thinking,
          run.tokens_out,
          run.cost_usd,
        ]
      );
    }

    return structuredClone(run);
  }

  public async createAgentRun(
    input: Partial<AgentRunRow> & {
      agent_id: string;
      input_prompt: string;
      trigger_type?: RunTriggerType;
    }
  ): Promise<AgentRunRow> {
    return this.startAgentRun(input);
  }

  public async updateAgentRun(
    id: string,
    patch: Partial<AgentRunRow>
  ): Promise<AgentRunRow | null> {
    const idx = this.state.agent_runs.findIndex((r) => r.id === id);
    if (idx < 0) return null;
    const updated: AgentRunRow = {
      ...this.state.agent_runs[idx],
      ...patch,
      id,
    };
    this.state.agent_runs[idx] = updated;
    this.saveSnapshot();

    if (this.pg.isConnected()) {
      await this.startAgentRun(updated);
    }
    return structuredClone(updated);
  }

  public async completeAgentRun(
    id: string,
    result: {
      status?: AgentRunStatus;
      output_summary?: string;
      git_commit_sha?: string;
      git_branch?: string;
      preview_url?: string;
      qa_passed?: boolean;
      qa_screenshot_url?: string;
      tokens_in?: number;
      tokens_cached?: number;
      tokens_thinking?: number;
      tokens_out?: number;
      cost_usd?: number;
      skip_telemetry_increment?: boolean;
    }
  ): Promise<AgentRunRow | null> {
    const existing = await this.getAgentRun(id);
    if (!existing) return null;

    const endedAt = new Date().toISOString();
    const durationMs = Math.max(
      100,
      Date.parse(endedAt) - Date.parse(existing.started_at) - (existing.pause_duration_ms || 0)
    );

    const updated = await this.updateAgentRun(id, {
      status: result.status || 'COMPLETED',
      output_summary: result.output_summary ?? existing.output_summary,
      git_commit_sha: result.git_commit_sha ?? existing.git_commit_sha,
      git_branch: result.git_branch ?? existing.git_branch,
      preview_url: result.preview_url ?? existing.preview_url,
      qa_passed: result.qa_passed ?? existing.qa_passed,
      qa_screenshot_url: result.qa_screenshot_url ?? existing.qa_screenshot_url,
      ended_at: endedAt,
      active_duration_ms: existing.active_duration_ms || durationMs,
      tokens_in: result.tokens_in ?? existing.tokens_in,
      tokens_cached: result.tokens_cached ?? existing.tokens_cached,
      tokens_thinking: result.tokens_thinking ?? existing.tokens_thinking,
      tokens_out: result.tokens_out ?? existing.tokens_out,
      cost_usd: result.cost_usd ?? existing.cost_usd,
    });

    if (existing.status !== 'COMPLETED' && !result.skip_telemetry_increment) {
      await this.incrementAgentTelemetry(existing.agent_id, {
        work_time_ms: durationMs,
        runs: 1,
        commits: result.git_commit_sha ? 1 : 0,
        tokens_in: result.tokens_in || 0,
        tokens_cached: result.tokens_cached || 0,
        tokens_thinking: result.tokens_thinking || 0,
        tokens_out: result.tokens_out || 0,
        cost_usd: result.cost_usd || 0,
      });
    }

    await this.updateAgent(existing.agent_id, {
      status:
        result.status === 'PAUSED_FOR_CEO'
          ? 'WAITING_FOR_CEO'
          : result.status === 'TERMINATED_TIMEOUT'
          ? 'TERMINATED_TIMEOUT'
          : 'IDLE',
      current_run_id: null,
      clocked_in_at: null,
      last_heartbeat_at: endedAt,
    });

    return updated;
  }

  // ==========================================================================
  // 5. INFERENCE STEPS REPOSITORY
  // ==========================================================================

  public async listInferenceSteps(runId: string): Promise<InferenceStepRow[]> {
    return this.state.inference_steps
      .filter((s) => s.run_id === runId)
      .sort((a, b) => a.step_index - b.step_index);
  }

  public async getInferenceSteps(runId: string): Promise<InferenceStepRow[]> {
    return this.listInferenceSteps(runId);
  }

  public async appendInferenceStep(
    input: Partial<InferenceStepRow> & {
      run_id: string;
      step_type: InferenceStepType;
    }
  ): Promise<InferenceStepRow> {
    const existingForRun = this.state.inference_steps.filter(
      (s) => s.run_id === input.run_id
    );
    const nextIdx =
      input.step_index !== undefined ? input.step_index : existingForRun.length + 1;

    const step: InferenceStepRow = {
      id: input.id || crypto.randomUUID(),
      run_id: input.run_id,
      step_index: nextIdx,
      step_type: input.step_type,
      model_used: input.model_used ?? null,
      thinking_text: input.thinking_text ?? null,
      message_text: input.message_text ?? null,
      tool_name: input.tool_name ?? null,
      tool_args_json: input.tool_args_json ?? null,
      tool_output_json: input.tool_output_json ?? null,
      duration_ms: input.duration_ms ?? 0,
      tokens_in: input.tokens_in ?? 0,
      tokens_cached: input.tokens_cached ?? 0,
      tokens_thinking: input.tokens_thinking ?? 0,
      tokens_out: input.tokens_out ?? 0,
      created_at: input.created_at || new Date().toISOString(),
    };

    this.state.inference_steps.push(step);
    this.saveSnapshot();

    if (this.pg.isConnected()) {
      await this.pg.query(
        `INSERT INTO inference_steps (
          id, run_id, step_index, step_type, model_used, thinking_text,
          message_text, tool_name, tool_args_json, tool_output_json,
          duration_ms, tokens_in, tokens_cached, tokens_thinking, tokens_out, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9::jsonb, $10::jsonb,
          $11, $12, $13, $14, $15, $16
        )
        ON CONFLICT (id) DO NOTHING`,
        [
          step.id,
          step.run_id,
          step.step_index,
          step.step_type,
          step.model_used,
          step.thinking_text,
          step.message_text,
          step.tool_name,
          step.tool_args_json ? JSON.stringify(step.tool_args_json) : null,
          step.tool_output_json ? JSON.stringify(step.tool_output_json) : null,
          step.duration_ms,
          step.tokens_in,
          step.tokens_cached,
          step.tokens_thinking,
          step.tokens_out,
          step.created_at,
        ]
      );
    }

    return structuredClone(step);
  }

  public async createInferenceStep(
    input: Partial<InferenceStepRow> & {
      run_id: string;
      step_type: InferenceStepType;
    }
  ): Promise<InferenceStepRow> {
    return this.appendInferenceStep(input);
  }

  // ==========================================================================
  // 6 & 7. CHAT THREADS & CHAT MESSAGES REPOSITORY (Multimodal + pgvector)
  // ==========================================================================

  public async listChatThreads(filter?: {
    mode?: ChatThreadMode;
    status?: ChatThreadStatus;
    target_agent_id?: string;
    project_scope?: string;
    limit?: number;
  }): Promise<ChatThreadRow[]> {
    let items = [...this.state.chat_threads];
    if (filter?.mode) {
      items = items.filter((t) => t.mode === filter.mode);
    }
    if (filter?.status) {
      items = items.filter((t) => t.status === filter.status);
    }
    if (filter?.target_agent_id) {
      const norm = normalizeAgentKey(filter.target_agent_id);
      items = items.filter(
        (t) => t.target_agent_id === norm || t.target_agent_id === filter.target_agent_id
      );
    }
    if (filter?.project_scope) {
      items = items.filter((t) => t.project_scope === filter.project_scope);
    }
    items.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    if (filter?.limit && filter.limit > 0) {
      items = items.slice(0, filter.limit);
    }
    return items;
  }

  public async getChatThreads(filter?: {
    mode?: ChatThreadMode;
    status?: ChatThreadStatus;
    target_agent_id?: string;
    project_scope?: string;
    limit?: number;
  }): Promise<ChatThreadRow[]> {
    return this.listChatThreads(filter);
  }

  public async getChatThread(id: string): Promise<ChatThreadRow | null> {
    const found = this.state.chat_threads.find((t) => t.id === id);
    return found ? structuredClone(found) : null;
  }

  public async createChatThread(
    input: Partial<ChatThreadRow> & { title: string }
  ): Promise<ChatThreadRow> {
    const now = new Date().toISOString();
    const id = input.id || crypto.randomUUID();
    const existingIdx = this.state.chat_threads.findIndex((t) => t.id === id);
    const existing = existingIdx >= 0 ? this.state.chat_threads[existingIdx] : undefined;

    const thread: ChatThreadRow = {
      id,
      title: input.title || existing?.title || 'Executive Session',
      mode: input.mode || existing?.mode || 'WARDEN_EXECUTIVE',
      target_agent_id: input.target_agent_id
        ? normalizeAgentKey(input.target_agent_id)
        : (existing?.target_agent_id ?? 'warden'),
      project_scope: input.project_scope ?? existing?.project_scope ?? 'GLOBAL',
      status: input.status || existing?.status || 'ACTIVE',
      created_at: existing?.created_at || input.created_at || now,
      updated_at: input.updated_at || now,
    };

    if (existingIdx >= 0) {
      this.state.chat_threads[existingIdx] = thread;
    } else {
      this.state.chat_threads.push(thread);
    }
    this.saveSnapshot();

    if (this.pg.isConnected()) {
      await this.pg.query(
        `INSERT INTO chat_threads (
          id, title, mode, target_agent_id, project_scope, status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          mode = EXCLUDED.mode,
          target_agent_id = EXCLUDED.target_agent_id,
          project_scope = EXCLUDED.project_scope,
          status = EXCLUDED.status,
          updated_at = EXCLUDED.updated_at`,
        [
          thread.id,
          thread.title,
          thread.mode,
          thread.target_agent_id,
          thread.project_scope,
          thread.status,
          thread.created_at,
          thread.updated_at,
        ]
      );
    }

    return structuredClone(thread);
  }

  public async upsertChatThread(
    input: Partial<ChatThreadRow> & { title: string }
  ): Promise<ChatThreadRow> {
    return this.createChatThread(input);
  }

  public async updateChatThread(
    id: string,
    patch: Partial<ChatThreadRow>
  ): Promise<ChatThreadRow | null> {
    const existing = await this.getChatThread(id);
    if (!existing) return null;
    return this.createChatThread({
      ...existing,
      ...patch,
      id,
      updated_at: new Date().toISOString(),
    });
  }

  public async listChatMessages(
    threadId: string,
    limit?: number
  ): Promise<ChatMessageRow[]> {
    let msgs = this.state.chat_messages
      .filter((m) => m.thread_id === threadId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (limit && limit > 0 && msgs.length > limit) {
      msgs = msgs.slice(msgs.length - limit);
    }
    return msgs;
  }

  public async getChatMessages(
    threadId: string,
    limit?: number
  ): Promise<ChatMessageRow[]> {
    return this.listChatMessages(threadId, limit);
  }

  public async appendChatMessage(
    input: Partial<ChatMessageRow> & {
      thread_id: string;
      sender_type: ChatSenderType;
      content: string;
    }
  ): Promise<ChatMessageRow> {
    const now = input.created_at || new Date().toISOString();
    const id = input.id || crypto.randomUUID();
    const embedding =
      input.embedding && input.embedding.length === 768
        ? input.embedding
        : generateDeterministicEmbedding(input.content);

    const msg: ChatMessageRow = {
      id,
      thread_id: input.thread_id,
      sender_type: input.sender_type,
      sender_agent_id: input.sender_agent_id
        ? normalizeAgentKey(input.sender_agent_id)
        : null,
      recipient_agent_id: input.recipient_agent_id
        ? normalizeAgentKey(input.recipient_agent_id)
        : null,
      content: input.content,
      run_id: input.run_id ?? null,
      attachments_json: Array.isArray(input.attachments_json)
        ? (input.attachments_json as ChatAttachment[])
        : [],
      embedding,
      created_at: now,
    };

    const existingIdx = this.state.chat_messages.findIndex((m) => m.id === id);
    if (existingIdx >= 0) {
      this.state.chat_messages[existingIdx] = msg;
    } else {
      this.state.chat_messages.push(msg);
    }

    const threadIdx = this.state.chat_threads.findIndex((t) => t.id === input.thread_id);
    if (threadIdx >= 0) {
      this.state.chat_threads[threadIdx].updated_at = now;
    }
    this.saveSnapshot();

    if (this.pg.isConnected()) {
      await this.pg.query(
        `INSERT INTO chat_messages (
          id, thread_id, sender_type, sender_agent_id, recipient_agent_id,
          content, run_id, attachments_json, embedding, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::vector, $10)
        ON CONFLICT (id) DO UPDATE SET
          content = EXCLUDED.content,
          attachments_json = EXCLUDED.attachments_json,
          embedding = EXCLUDED.embedding`,
        [
          msg.id,
          msg.thread_id,
          msg.sender_type,
          msg.sender_agent_id,
          msg.recipient_agent_id,
          msg.content,
          msg.run_id,
          JSON.stringify(msg.attachments_json),
          formatPgVector(msg.embedding),
          msg.created_at,
        ]
      );
    }

    return structuredClone(msg);
  }

  public async createChatMessage(
    input: Partial<ChatMessageRow> & {
      thread_id: string;
      sender_type: ChatSenderType;
      content: string;
    }
  ): Promise<ChatMessageRow> {
    return this.appendChatMessage(input);
  }

  public async searchChatMessages(params: {
    queryText?: string;
    queryEmbedding?: number[];
    thread_id?: string;
    sender_agent_id?: string;
    topK?: number;
  }): Promise<Array<ChatMessageRow & { similarity: number }>> {
    const topK = params.topK ?? 5;
    const queryVec =
      params.queryEmbedding && params.queryEmbedding.length === 768
        ? params.queryEmbedding
        : generateDeterministicEmbedding(params.queryText || '');

    let candidates = [...this.state.chat_messages];
    if (params.thread_id) {
      candidates = candidates.filter((m) => m.thread_id === params.thread_id);
    }
    if (params.sender_agent_id) {
      const norm = normalizeAgentKey(params.sender_agent_id);
      candidates = candidates.filter((m) => m.sender_agent_id === norm);
    }

    const scored = candidates.map((m) => ({
      ...m,
      similarity: Number(cosineSimilarity(m.embedding, queryVec).toFixed(4)),
    }));
    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, topK);
  }

  // ==========================================================================
  // 8. SPRINTS REPOSITORY (Replaces standups/*.md)
  // ==========================================================================

  public async listSprints(limit?: number): Promise<SprintRow[]> {
    const sorted = [...this.state.sprints].sort((a, b) =>
      b.date_ist.localeCompare(a.date_ist)
    );
    return limit && limit > 0 ? sorted.slice(0, limit) : sorted;
  }

  public async getSprints(limit?: number): Promise<SprintRow[]> {
    return this.listSprints(limit);
  }

  public async getSprint(idOrDate: string): Promise<SprintRow | null> {
    const found = this.state.sprints.find(
      (s) => s.id === idOrDate || s.date_ist === idOrDate
    );
    return found ? structuredClone(found) : null;
  }

  public async getLatestSprint(): Promise<SprintRow | null> {
    const list = await this.listSprints(1);
    return list[0] ?? null;
  }

  public async upsertSprint(
    input: Partial<SprintRow> & { id?: string; date_ist: string }
  ): Promise<SprintRow> {
    const now = new Date().toISOString();
    const id = input.id || `spr_${input.date_ist.replace(/-/g, '_')}`;
    const existingIdx = this.state.sprints.findIndex(
      (s) => s.id === id || s.date_ist === input.date_ist
    );
    const existing = existingIdx >= 0 ? this.state.sprints[existingIdx] : undefined;

    const sprint: SprintRow = {
      id,
      date_ist: input.date_ist,
      week_label: input.week_label ?? existing?.week_label ?? undefined,
      status: input.status || existing?.status || 'AWAITING_CEO_APPROVAL',
      mom_summary_md: input.mom_summary_md ?? existing?.mom_summary_md ?? '',
      weekly_plan_json: input.weekly_plan_json ?? existing?.weekly_plan_json ?? [],
      task_movements_json: input.task_movements_json ?? existing?.task_movements_json ?? [],
      approved_at: input.approved_at ?? existing?.approved_at ?? null,
      ceo_notes: input.ceo_notes ?? existing?.ceo_notes ?? null,
      created_at: existing?.created_at || input.created_at || now,
    };

    if (existingIdx >= 0) {
      this.state.sprints[existingIdx] = sprint;
    } else {
      this.state.sprints.push(sprint);
    }
    this.saveSnapshot();

    if (this.pg.isConnected()) {
      await this.pg.query(
        `INSERT INTO sprints (
          id, date_ist, week_label, status, mom_summary_md,
          weekly_plan_json, task_movements_json, approved_at, ceo_notes, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE SET
          week_label = EXCLUDED.week_label,
          status = EXCLUDED.status,
          mom_summary_md = EXCLUDED.mom_summary_md,
          weekly_plan_json = EXCLUDED.weekly_plan_json,
          task_movements_json = EXCLUDED.task_movements_json,
          approved_at = EXCLUDED.approved_at,
          ceo_notes = EXCLUDED.ceo_notes`,
        [
          sprint.id,
          sprint.date_ist,
          sprint.week_label ?? null,
          sprint.status,
          sprint.mom_summary_md,
          JSON.stringify(sprint.weekly_plan_json || []),
          JSON.stringify(sprint.task_movements_json || []),
          sprint.approved_at,
          sprint.ceo_notes,
          sprint.created_at,
        ]
      );
    }

    return structuredClone(sprint);
  }

  public async approveSprint(id: string, ceoNotes?: string): Promise<SprintRow | null> {
    const existing = await this.getSprint(id);
    if (!existing) return null;
    return this.upsertSprint({
      ...existing,
      status: 'EXECUTING',
      approved_at: new Date().toISOString(),
      ceo_notes: ceoNotes ?? existing.ceo_notes,
    });
  }

  // ==========================================================================
  // 9. BACKLOG ITEMS REPOSITORY (Replaces worklist/inbox.md, todo/, done/)
  // ==========================================================================

  public async listBacklogItems(filter?: {
    stage?: BacklogStage | BacklogStage[];
    priority?: BacklogPriority;
    department?: Department;
    project_slug?: string;
    assigned_agent_id?: string;
    sprint_id?: string;
  }): Promise<BacklogItemRow[]> {
    let items = [...this.state.backlog_items];
    if (filter?.stage) {
      const stages = Array.isArray(filter.stage) ? filter.stage : [filter.stage];
      items = items.filter((b) => stages.includes(b.stage));
    }
    if (filter?.priority) {
      items = items.filter((b) => b.priority === filter.priority);
    }
    if (filter?.department) {
      items = items.filter((b) => b.department === filter.department);
    }
    if (filter?.project_slug) {
      items = items.filter((b) => b.project_slug === filter.project_slug);
    }
    if (filter?.assigned_agent_id) {
      const norm = normalizeAgentKey(filter.assigned_agent_id);
      items = items.filter(
        (b) =>
          b.assigned_agent_id === norm ||
          b.assigned_agent_id === filter.assigned_agent_id
      );
    }
    if (filter?.sprint_id) {
      items = items.filter((b) => b.sprint_id === filter.sprint_id);
    }

    const priorityRank: Record<BacklogPriority, number> = { P0: 0, P1: 1, P2: 2 };
    items.sort(
      (a, b) =>
        (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9) ||
        b.created_at.localeCompare(a.created_at)
    );
    return items;
  }

  public async getBacklogItems(filter?: {
    stage?: BacklogStage | BacklogStage[];
    priority?: BacklogPriority;
    department?: Department;
    project_slug?: string;
    assigned_agent_id?: string;
    sprint_id?: string;
  }): Promise<BacklogItemRow[]> {
    return this.listBacklogItems(filter);
  }

  public async getBacklogItem(id: string): Promise<BacklogItemRow | null> {
    const found = this.state.backlog_items.find((b) => b.id === id);
    return found ? structuredClone(found) : null;
  }

  public async createBacklogItem(
    input: Partial<BacklogItemRow> & { title: string }
  ): Promise<BacklogItemRow> {
    const now = new Date().toISOString();
    const existingIdx = this.state.backlog_items.findIndex(
      (b) =>
        (input.id && b.id === input.id) ||
        b.title.trim().toLowerCase() === input.title.trim().toLowerCase()
    );
    const existing =
      existingIdx >= 0 ? this.state.backlog_items[existingIdx] : undefined;

    const stage: BacklogStage = input.stage || existing?.stage || 'INBOX';
    const item: BacklogItemRow = {
      id: input.id || existing?.id || crypto.randomUUID(),
      title: input.title.trim(),
      spec_md: input.spec_md ?? existing?.spec_md ?? '',
      stage,
      priority: input.priority || existing?.priority || 'P1',
      department: input.department || existing?.department || 'tech',
      project_slug: input.project_slug ?? existing?.project_slug ?? getDeploymentProfile().defaultProject,
      assigned_agent_id: input.assigned_agent_id
        ? normalizeAgentKey(input.assigned_agent_id)
        : (existing?.assigned_agent_id ?? null),
      pm_owner_id: input.pm_owner_id
        ? normalizeAgentKey(input.pm_owner_id)
        : (existing?.pm_owner_id ?? null),
      sprint_id: input.sprint_id ?? existing?.sprint_id ?? null,
      target_week: input.target_week ?? existing?.target_week ?? null,
      requires_human_intervention:
        input.requires_human_intervention ??
        existing?.requires_human_intervention ??
        stage === 'NEEDS_CEO',
      intervention_type:
        (input.intervention_type ??
          existing?.intervention_type ??
          null) as HumanInterventionType | null,
      intervention_prompt:
        input.intervention_prompt ?? existing?.intervention_prompt ?? null,
      required_env_keys:
        input.required_env_keys ?? existing?.required_env_keys ?? [],
      human_response: input.human_response ?? existing?.human_response ?? null,
      requested_by_agent_id: input.requested_by_agent_id
        ? normalizeAgentKey(input.requested_by_agent_id)
        : (existing?.requested_by_agent_id ?? null),
      last_moved_at: input.last_moved_at ?? existing?.last_moved_at ?? now,
      last_movement_note:
        input.last_movement_note ?? existing?.last_movement_note ?? null,
      created_at: existing?.created_at || input.created_at || now,
      completed_at:
        stage === 'DONE'
          ? input.completed_at || existing?.completed_at || now
          : (input.completed_at ?? existing?.completed_at ?? null),
    };

    if (existingIdx >= 0) {
      this.state.backlog_items[existingIdx] = item;
    } else {
      this.state.backlog_items.push(item);
    }
    this.saveSnapshot();

    if (this.pg.isConnected()) {
      await this.pg.query(
        `INSERT INTO backlog_items (
          id, title, spec_md, stage, priority, department, project_slug,
          assigned_agent_id, pm_owner_id, sprint_id, target_week,
          requires_human_intervention, intervention_type, intervention_prompt,
          required_env_keys, human_response, requested_by_agent_id,
          last_moved_at, last_movement_note, created_at, completed_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11,
          $12, $13, $14,
          $15::jsonb, $16, $17,
          $18, $19, $20, $21
        )
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          spec_md = EXCLUDED.spec_md,
          stage = EXCLUDED.stage,
          priority = EXCLUDED.priority,
          department = EXCLUDED.department,
          project_slug = EXCLUDED.project_slug,
          assigned_agent_id = EXCLUDED.assigned_agent_id,
          pm_owner_id = EXCLUDED.pm_owner_id,
          sprint_id = EXCLUDED.sprint_id,
          target_week = EXCLUDED.target_week,
          requires_human_intervention = EXCLUDED.requires_human_intervention,
          intervention_type = EXCLUDED.intervention_type,
          intervention_prompt = EXCLUDED.intervention_prompt,
          required_env_keys = EXCLUDED.required_env_keys,
          human_response = EXCLUDED.human_response,
          requested_by_agent_id = EXCLUDED.requested_by_agent_id,
          last_moved_at = EXCLUDED.last_moved_at,
          last_movement_note = EXCLUDED.last_movement_note,
          completed_at = EXCLUDED.completed_at`,
        [
          item.id,
          item.title,
          item.spec_md,
          item.stage,
          item.priority,
          item.department,
          item.project_slug,
          item.assigned_agent_id,
          item.pm_owner_id ?? null,
          item.sprint_id,
          item.target_week ?? null,
          Boolean(item.requires_human_intervention),
          item.intervention_type ?? null,
          item.intervention_prompt ?? null,
          JSON.stringify(item.required_env_keys || []),
          item.human_response ?? null,
          item.requested_by_agent_id ?? null,
          item.last_moved_at ?? null,
          item.last_movement_note ?? null,
          item.created_at,
          item.completed_at,
        ]
      );
    }

    return structuredClone(item);
  }

  public async upsertBacklogItem(
    input: Partial<BacklogItemRow> & { title: string }
  ): Promise<BacklogItemRow> {
    return this.createBacklogItem(input);
  }

  public async updateBacklogItem(
    id: string,
    patch: Partial<BacklogItemRow>
  ): Promise<BacklogItemRow | null> {
    const existing = await this.getBacklogItem(id);
    if (!existing) return null;
    return this.createBacklogItem({ ...existing, ...patch, id });
  }

  public async deleteBacklogItem(id: string): Promise<boolean> {
    const before = this.state.backlog_items.length;
    this.state.backlog_items = this.state.backlog_items.filter((b) => b.id !== id);
    const changed = this.state.backlog_items.length !== before;
    if (changed) this.saveSnapshot();
    if (this.pg.isConnected()) {
      await this.pg.query('DELETE FROM backlog_items WHERE id = $1', [id]);
    }
    return changed;
  }

  // ==========================================================================
  // 10. APPROVAL GATES REPOSITORY (Human-in-the-Loop & Backlog Ping Tracker)
  // ==========================================================================

  public async listApprovalGates(filter?: {
    status?: ApprovalGateStatus;
    department?: Department;
    project_scope?: string;
    gate_type?: ApprovalGateType;
    agent_id?: string;
    thread_id?: string;
  }): Promise<ApprovalGateRow[]> {
    let items = [...this.state.approval_gates];
    if (filter?.status) {
      items = items.filter((g) => g.status === filter.status);
    }
    if (filter?.department) {
      items = items.filter((g) => g.department === filter.department);
    }
    if (filter?.project_scope) {
      items = items.filter((g) => g.project_scope === filter.project_scope);
    }
    if (filter?.gate_type) {
      items = items.filter((g) => g.gate_type === filter.gate_type);
    }
    if (filter?.agent_id) {
      const norm = normalizeAgentKey(filter.agent_id);
      items = items.filter((g) => g.agent_id === norm);
    }
    if (filter?.thread_id) {
      items = items.filter((g) => g.thread_id === filter.thread_id);
    }
    return items.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  public async getApprovalGates(filter?: {
    status?: ApprovalGateStatus;
    department?: Department;
    project_scope?: string;
    gate_type?: ApprovalGateType;
    agent_id?: string;
    thread_id?: string;
  }): Promise<ApprovalGateRow[]> {
    return this.listApprovalGates(filter);
  }

  public async getApprovalGate(id: string): Promise<ApprovalGateRow | null> {
    const found = this.state.approval_gates.find((g) => g.id === id);
    return found ? structuredClone(found) : null;
  }

  public async createApprovalGate(
    input: Partial<ApprovalGateRow> & {
      agent_id: string;
      gate_type: ApprovalGateType;
      prompt_text: string;
    }
  ): Promise<ApprovalGateRow> {
    const now = new Date().toISOString();
    const agentId = normalizeAgentKey(input.agent_id);
    const gate: ApprovalGateRow = {
      id: input.id || crypto.randomUUID(),
      run_id: input.run_id ?? null,
      thread_id: input.thread_id ?? null,
      agent_id: agentId,
      department: input.department || 'tech',
      project_scope: input.project_scope ?? null,
      gate_type: input.gate_type,
      prompt_text: input.prompt_text,
      options_json: Array.isArray(input.options_json) ? input.options_json : [],
      status: input.status || 'PENDING',
      ceo_decision: input.ceo_decision ?? null,
      telegram_notified_at: input.telegram_notified_at ?? null,
      resolved_at: input.resolved_at ?? null,
      created_at: input.created_at || now,
    };

    const existingIdx = this.state.approval_gates.findIndex((g) => g.id === gate.id);
    if (existingIdx >= 0) {
      this.state.approval_gates[existingIdx] = gate;
    } else {
      this.state.approval_gates.push(gate);
    }
    this.saveSnapshot();

    if (this.pg.isConnected()) {
      await this.pg.query(
        `INSERT INTO approval_gates (
          id, run_id, thread_id, agent_id, department, project_scope,
          gate_type, prompt_text, options_json, status, ceo_decision,
          telegram_notified_at, resolved_at, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14)
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          ceo_decision = EXCLUDED.ceo_decision,
          telegram_notified_at = EXCLUDED.telegram_notified_at,
          resolved_at = EXCLUDED.resolved_at`,
        [
          gate.id,
          gate.run_id,
          gate.thread_id,
          gate.agent_id,
          gate.department,
          gate.project_scope,
          gate.gate_type,
          gate.prompt_text,
          JSON.stringify(gate.options_json),
          gate.status,
          gate.ceo_decision,
          gate.telegram_notified_at,
          gate.resolved_at,
          gate.created_at,
        ]
      );
    }

    return structuredClone(gate);
  }

  public async resolveApprovalGate(
    id: string,
    ceoDecision: string
  ): Promise<ApprovalGateRow | null> {
    const existing = await this.getApprovalGate(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    const updated = await this.createApprovalGate({
      ...existing,
      status: 'RESOLVED',
      ceo_decision: ceoDecision,
      resolved_at: now,
    });
    if (existing.agent_id) {
      const ag = await this.getAgent(existing.agent_id);
      if (ag && ag.status === 'WAITING_FOR_CEO') {
        await this.updateAgent(existing.agent_id, { status: 'IDLE' });
      }
    }
    return updated;
  }

  // ==========================================================================
  // 11. CODE CHUNKS REPOSITORY (Cross-Repo RAG via pgvector HNSW)
  // ==========================================================================

  public async listCodeChunks(filter?: {
    project_slug?: string;
    repo_slug?: string;
    file_path?: string;
    limit?: number;
  }): Promise<CodeChunkRow[]> {
    let items = [...this.state.code_chunks];
    if (filter?.project_slug) {
      items = items.filter((c) => c.project_slug === filter.project_slug);
    }
    if (filter?.repo_slug) {
      items = items.filter((c) => c.repo_slug === filter.repo_slug);
    }
    if (filter?.file_path) {
      items = items.filter((c) => c.file_path === filter.file_path);
    }
    if (filter?.limit && filter.limit > 0) {
      items = items.slice(0, filter.limit);
    }
    return items;
  }

  public async upsertCodeChunk(
    input: Partial<CodeChunkRow> & {
      project_slug: string;
      repo_slug: string;
      file_path: string;
      symbol_name: string;
      content: string;
    }
  ): Promise<CodeChunkRow> {
    const now = new Date().toISOString();
    const existingIdx = this.state.code_chunks.findIndex(
      (c) =>
        (input.id && c.id === input.id) ||
        (c.repo_slug === input.repo_slug &&
          c.file_path === input.file_path &&
          c.symbol_name === input.symbol_name)
    );
    const existing =
      existingIdx >= 0 ? this.state.code_chunks[existingIdx] : undefined;

    const embedding =
      input.embedding && input.embedding.length === 768
        ? input.embedding
        : generateDeterministicEmbedding(
            `${input.repo_slug} ${input.file_path} ${input.symbol_name} ${input.content}`
          );

    const chunk: CodeChunkRow = {
      id: input.id || existing?.id || crypto.randomUUID(),
      project_slug: input.project_slug,
      repo_slug: input.repo_slug,
      file_path: input.file_path,
      symbol_name: input.symbol_name,
      chunk_type: input.chunk_type || existing?.chunk_type || 'module',
      content: input.content,
      commit_sha: input.commit_sha ?? existing?.commit_sha ?? null,
      embedding,
      updated_at: now,
    };

    if (existingIdx >= 0) {
      this.state.code_chunks[existingIdx] = chunk;
    } else {
      this.state.code_chunks.push(chunk);
    }
    this.saveSnapshot();

    if (this.pg.isConnected()) {
      await this.pg.query(
        `INSERT INTO code_chunks (
          id, project_slug, repo_slug, file_path, symbol_name,
          chunk_type, content, commit_sha, embedding, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector, $10)
        ON CONFLICT (id) DO UPDATE SET
          content = EXCLUDED.content,
          commit_sha = EXCLUDED.commit_sha,
          embedding = EXCLUDED.embedding,
          updated_at = EXCLUDED.updated_at`,
        [
          chunk.id,
          chunk.project_slug,
          chunk.repo_slug,
          chunk.file_path,
          chunk.symbol_name,
          chunk.chunk_type,
          chunk.content,
          chunk.commit_sha,
          formatPgVector(chunk.embedding),
          chunk.updated_at,
        ]
      );
    }

    return structuredClone(chunk);
  }

  public async searchCodeChunks(params: {
    queryText?: string;
    queryEmbedding?: number[];
    project_slug?: string;
    repo_slug?: string;
    topK?: number;
  }): Promise<Array<CodeChunkRow & { similarity: number }>> {
    const topK = params.topK ?? 5;
    const queryVec =
      params.queryEmbedding && params.queryEmbedding.length === 768
        ? params.queryEmbedding
        : generateDeterministicEmbedding(params.queryText || '');

    let candidates = [...this.state.code_chunks];
    if (params.project_slug) {
      candidates = candidates.filter((c) => c.project_slug === params.project_slug);
    }
    if (params.repo_slug) {
      candidates = candidates.filter((c) => c.repo_slug === params.repo_slug);
    }

    const scored = candidates.map((c) => ({
      ...c,
      similarity: Number(cosineSimilarity(c.embedding, queryVec).toFixed(4)),
    }));
    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, topK);
  }

  // ==========================================================================
  // WATCHDOG & TELEMETRY QUERIES (IdleBacklogMonitor & HealthAndQuotaGuard)
  // ==========================================================================

  /**
   * Computes backlog queue counts grouped by department and project_slug for
   * Section 4.5 `IdleBacklogMonitor` (Zero-Idle Department Watchdog).
   */
  public async getDepartmentBacklogCounts(
    cooldownMs = 4 * 60 * 60 * 1000
  ): Promise<DepartmentBacklogSummary[]> {
    const units: Array<{
      department: Department;
      project_slug: string;
      senior_agent_id: string;
    }> = getDeploymentProfile().departmentUnits;

    const nowMs = Date.now();
    const results: DepartmentBacklogSummary[] = [];

    for (const unit of units) {
      const unitItems = this.state.backlog_items.filter(
        (b) =>
          b.project_slug === unit.project_slug ||
          (unit.project_slug === 'GLOBAL' && b.department === unit.department)
      );

      const inbox_count = unitItems.filter((b) => b.stage === 'INBOX').length;
      const todo_count = unitItems.filter((b) => b.stage === 'TODO').length;
      const in_progress_count = unitItems.filter((b) => b.stage === 'IN_PROGRESS').length;
      const qa_review_count = unitItems.filter((b) => b.stage === 'QA_REVIEW').length;
      const done_count = unitItems.filter((b) => b.stage === 'DONE').length;
      const active_queue_count = inbox_count + todo_count + in_progress_count;

      const working_agents_count = this.state.agents.filter(
        (a) =>
          (a.project_scope === unit.project_slug || a.department === unit.department) &&
          a.status === 'WORKING'
      ).length;

      const matchingPings = this.state.approval_gates
        .filter(
          (g) =>
            g.gate_type === 'EMPTY_BACKLOG_PING' &&
            (g.project_scope === unit.project_slug || g.department === unit.department)
        )
        .sort((a, b) => b.created_at.localeCompare(a.created_at));

      const lastPing = matchingPings[0];
      const lastPingAt = lastPing?.created_at ?? null;
      const hasUnresolvedOrRecentPing = Boolean(
        lastPing &&
          (lastPing.status === 'PENDING' ||
            nowMs - Date.parse(lastPing.created_at) < cooldownMs)
      );

      results.push({
        department: unit.department,
        project_slug: unit.project_slug,
        senior_agent_id: unit.senior_agent_id,
        inbox_count,
        todo_count,
        in_progress_count,
        qa_review_count,
        done_count,
        active_queue_count,
        working_agents_count,
        last_empty_backlog_ping_at: lastPingAt,
        needs_backlog_ping:
          active_queue_count === 0 &&
          working_agents_count === 0 &&
          !hasUnresolvedOrRecentPing,
      });
    }

    return results;
  }

  /**
   * Computes live health & quota metrics for all agents for Section 4.6 `HealthAndQuotaGuard`.
   */
  public async getActiveAgentHealthReport(
    nowMs: number = Date.now()
  ): Promise<AgentHealthCheckItem[]> {
    const report: AgentHealthCheckItem[] = [];
    for (const agent of this.state.agents) {
      const activeRun = agent.current_run_id
        ? this.state.agent_runs.find((r) => r.id === agent.current_run_id) ?? null
        : null;

      const startedMs = agent.clocked_in_at
        ? Date.parse(agent.clocked_in_at)
        : activeRun
        ? Date.parse(activeRun.started_at)
        : null;

      const runtimeMs =
        agent.status === 'WORKING' && startedMs ? Math.max(0, nowMs - startedMs) : 0;

      const heartbeatAgeMs = agent.last_heartbeat_at
        ? Math.max(0, nowMs - Date.parse(agent.last_heartbeat_at))
        : null;

      const runTokens = activeRun
        ? (activeRun.tokens_in || 0) +
          (activeRun.tokens_thinking || 0) +
          (activeRun.tokens_out || 0)
        : 0;

      report.push({
        agent: structuredClone(agent),
        active_run: activeRun ? structuredClone(activeRun) : null,
        runtime_ms: runtimeMs,
        heartbeat_age_ms: heartbeatAgeMs,
        is_over_24h_limit:
          agent.status === 'WORKING' && runtimeMs > agent.max_run_duration_ms,
        is_heartbeat_stale:
          agent.status === 'WORKING' &&
          heartbeatAgeMs !== null &&
          heartbeatAgeMs > 3 * 60 * 1000,
        is_over_token_cap:
          agent.status === 'WORKING' && runTokens > agent.max_tokens_per_run,
        is_subagent_cap_exceeded: agent.active_subagent_count > agent.max_subagents,
      });
    }
    return report;
  }

  public async getCompanyTelemetrySummary(): Promise<CompanyTelemetrySummary> {
    const agents = this.state.agents;
    return {
      mode: this.getMode(),
      postgres_connected: this.pg.isConnected(),
      total_agents: agents.length,
      working_agents: agents.filter((a) => a.status === 'WORKING').length,
      waiting_for_ceo_agents: agents.filter((a) => a.status === 'WAITING_FOR_CEO')
        .length,
      unhealthy_agents: agents.filter((a) => a.health_status !== 'HEALTHY').length,
      total_runs: agents.reduce((acc, a) => acc + (a.total_runs || 0), 0),
      total_commits: agents.reduce((acc, a) => acc + (a.total_commits || 0), 0),
      total_work_time_ms: agents.reduce(
        (acc, a) => acc + (a.total_work_time_ms || 0),
        0
      ),
      today_tokens_used: agents.reduce((acc, a) => acc + (a.today_tokens_used || 0), 0),
      total_tokens_in: agents.reduce((acc, a) => acc + (a.total_tokens_in || 0), 0),
      total_tokens_cached: agents.reduce(
        (acc, a) => acc + (a.total_tokens_cached || 0),
        0
      ),
      total_tokens_thinking: agents.reduce(
        (acc, a) => acc + (a.total_tokens_thinking || 0),
        0
      ),
      total_tokens_out: agents.reduce((acc, a) => acc + (a.total_tokens_out || 0), 0),
      total_cost_usd: Number(
        agents
          .reduce((acc, a) => acc + Number(a.total_cost_usd || 0), 0)
          .toFixed(4)
      ),
      pending_approvals: this.state.approval_gates.filter(
        (g) => g.status === 'PENDING'
      ).length,
      active_backlog_count: this.state.backlog_items.filter((b) =>
        ['INBOX', 'TODO', 'IN_PROGRESS', 'QA_REVIEW'].includes(b.stage)
      ).length,
    };
  }

  // ==========================================================================
  // 12. PROVIDER CREDENTIALS REPOSITORY (Multi-Token Credit Pool & Failover)
  // ==========================================================================

  private mapPgProviderCredentialRow(r: any): ProviderCredentialRow {
    return {
      id: String(r.id),
      provider: r.provider as ModelProvider,
      label: String(r.label),
      api_key_encrypted: String(r.api_key_encrypted || ''),
      base_url: String(r.base_url || ''),
      remaining_budget_usd:
        r.remaining_budget_usd !== null && r.remaining_budget_usd !== undefined
          ? Number(r.remaining_budget_usd)
          : null,
      rpm_limit:
        r.rpm_limit !== null && r.rpm_limit !== undefined ? Number(r.rpm_limit) : null,
      tpm_limit:
        r.tpm_limit !== null && r.tpm_limit !== undefined ? Number(r.tpm_limit) : null,
      priority_order: Number(r.priority_order ?? 1),
      is_active: Boolean(r.is_active ?? true),
      cooldown_until: r.cooldown_until
        ? new Date(r.cooldown_until).toISOString()
        : null,
      total_requests: Number(r.total_requests ?? 0),
      total_failures: Number(r.total_failures ?? 0),
      last_error: r.last_error ?? null,
      created_at: r.created_at
        ? new Date(r.created_at).toISOString()
        : new Date().toISOString(),
      updated_at: r.updated_at
        ? new Date(r.updated_at).toISOString()
        : new Date().toISOString(),
    };
  }

  public async listProviderCredentials(filter?: {
    provider?: ModelProvider;
    is_active?: boolean;
  }): Promise<ProviderCredentialRow[]> {
    if (this.pg.isConnected()) {
      const res = await this.pg.query(
        'SELECT * FROM provider_credentials ORDER BY provider ASC, priority_order ASC, id ASC'
      );
      if (res && res.rows.length > 0) {
        this.state.provider_credentials = res.rows.map((r) =>
          this.mapPgProviderCredentialRow(r)
        );
      }
    }

    let items = [...this.state.provider_credentials];
    if (filter?.provider) {
      items = items.filter((c) => c.provider === filter.provider);
    }
    if (filter?.is_active !== undefined) {
      items = items.filter((c) => c.is_active === filter.is_active);
    }
    return items.sort(
      (a, b) =>
        a.provider.localeCompare(b.provider) ||
        a.priority_order - b.priority_order ||
        a.id.localeCompare(b.id)
    );
  }

  public async getProviderCredentials(filter?: {
    provider?: ModelProvider;
    is_active?: boolean;
  }): Promise<ProviderCredentialRow[]> {
    return this.listProviderCredentials(filter);
  }

  public async getProviderCredential(id: string): Promise<ProviderCredentialRow | null> {
    const found = this.state.provider_credentials.find((c) => c.id === id);
    return found ? structuredClone(found) : null;
  }

  public async upsertProviderCredential(
    input: Partial<ProviderCredentialRow> & {
      provider: ModelProvider;
      label: string;
    }
  ): Promise<ProviderCredentialRow> {
    const now = new Date().toISOString();
    const id =
      input.id ||
      `cred_${input.provider}_${crypto.randomUUID().slice(0, 8)}`;
    const existingIdx = this.state.provider_credentials.findIndex((c) => c.id === id);
    const existing =
      existingIdx >= 0 ? this.state.provider_credentials[existingIdx] : undefined;

    const merged: ProviderCredentialRow = {
      id,
      provider: input.provider,
      label: input.label,
      api_key_encrypted:
        input.api_key_encrypted ?? existing?.api_key_encrypted ?? '',
      base_url: input.base_url ?? existing?.base_url ?? '',
      remaining_budget_usd:
        input.remaining_budget_usd !== undefined
          ? input.remaining_budget_usd
          : (existing?.remaining_budget_usd ?? null),
      rpm_limit:
        input.rpm_limit !== undefined ? input.rpm_limit : (existing?.rpm_limit ?? null),
      tpm_limit:
        input.tpm_limit !== undefined ? input.tpm_limit : (existing?.tpm_limit ?? null),
      priority_order: input.priority_order ?? existing?.priority_order ?? 1,
      is_active: input.is_active ?? existing?.is_active ?? true,
      cooldown_until:
        input.cooldown_until !== undefined
          ? input.cooldown_until
          : (existing?.cooldown_until ?? null),
      total_requests: input.total_requests ?? existing?.total_requests ?? 0,
      total_failures: input.total_failures ?? existing?.total_failures ?? 0,
      last_error:
        input.last_error !== undefined ? input.last_error : (existing?.last_error ?? null),
      created_at: existing?.created_at || input.created_at || now,
      updated_at: now,
    };

    if (existingIdx >= 0) {
      this.state.provider_credentials[existingIdx] = merged;
    } else {
      this.state.provider_credentials.push(merged);
    }
    this.saveSnapshot();

    if (this.pg.isConnected()) {
      await this.pg.query(
        `INSERT INTO provider_credentials (
          id, provider, label, api_key_encrypted, base_url, remaining_budget_usd,
          rpm_limit, tpm_limit, priority_order, is_active, cooldown_until,
          total_requests, total_failures, last_error, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11,
          $12, $13, $14, $15, $16
        )
        ON CONFLICT (id) DO UPDATE SET
          provider = EXCLUDED.provider,
          label = EXCLUDED.label,
          api_key_encrypted = EXCLUDED.api_key_encrypted,
          base_url = EXCLUDED.base_url,
          remaining_budget_usd = EXCLUDED.remaining_budget_usd,
          rpm_limit = EXCLUDED.rpm_limit,
          tpm_limit = EXCLUDED.tpm_limit,
          priority_order = EXCLUDED.priority_order,
          is_active = EXCLUDED.is_active,
          cooldown_until = EXCLUDED.cooldown_until,
          total_requests = EXCLUDED.total_requests,
          total_failures = EXCLUDED.total_failures,
          last_error = EXCLUDED.last_error,
          updated_at = EXCLUDED.updated_at`,
        [
          merged.id,
          merged.provider,
          merged.label,
          merged.api_key_encrypted,
          merged.base_url,
          merged.remaining_budget_usd,
          merged.rpm_limit,
          merged.tpm_limit,
          merged.priority_order,
          merged.is_active,
          merged.cooldown_until,
          merged.total_requests,
          merged.total_failures,
          merged.last_error,
          merged.created_at,
          merged.updated_at,
        ]
      );
    }

    return structuredClone(merged);
  }

  public async deleteProviderCredential(id: string): Promise<boolean> {
    const before = this.state.provider_credentials.length;
    this.state.provider_credentials = this.state.provider_credentials.filter(
      (c) => c.id !== id
    );
    const changed = this.state.provider_credentials.length !== before;
    if (changed) this.saveSnapshot();
    if (this.pg.isConnected()) {
      await this.pg.query('DELETE FROM provider_credentials WHERE id = $1', [id]);
    }
    return changed;
  }

  /**
   * Selects the best available credential for `provider`:
   * - `is_active === true`
   * - `cooldown_until === null` or expired (`cooldown_until <= now`)
   * - `remaining_budget_usd === null` or `> 0`
   * Ordered by `priority_order ASC, total_requests ASC`.
   */
  public async selectActiveCredentialForProvider(
    provider: ModelProvider,
    nowMs: number = Date.now()
  ): Promise<ProviderCredentialRow | null> {
    const creds = await this.listProviderCredentials({ provider, is_active: true });
    const eligible = creds.filter((c) => {
      const cooldownOk =
        !c.cooldown_until || Date.parse(c.cooldown_until) <= nowMs;
      const budgetOk =
        c.remaining_budget_usd === null || c.remaining_budget_usd > 0;
      return cooldownOk && budgetOk;
    });
    eligible.sort(
      (a, b) =>
        a.priority_order - b.priority_order ||
        a.total_requests - b.total_requests
    );
    return eligible[0] ? structuredClone(eligible[0]) : null;
  }

  /**
   * Marks a credential as temporarily cooled down (or deactivated on 402/exhausted)
   * and increments `total_failures` for auto-failover to the next token in the pool.
   */
  public async markCredentialCooldown(
    id: string,
    errorMessage: string,
    cooldownMs: number = 60_000,
    deactivate = false
  ): Promise<ProviderCredentialRow | null> {
    const existing = await this.getProviderCredential(id);
    if (!existing) return null;
    const cooldownUntil =
      cooldownMs > 0 ? new Date(Date.now() + cooldownMs).toISOString() : null;
    return this.upsertProviderCredential({
      ...existing,
      is_active: deactivate ? false : existing.is_active,
      cooldown_until: cooldownUntil,
      total_failures: (existing.total_failures || 0) + 1,
      last_error: errorMessage,
    });
  }

  public async recordCredentialUsage(
    id: string,
    costUsd = 0
  ): Promise<ProviderCredentialRow | null> {
    const existing = await this.getProviderCredential(id);
    if (!existing) return null;
    const nextBudget =
      existing.remaining_budget_usd !== null
        ? Math.max(0, Number((existing.remaining_budget_usd - costUsd).toFixed(6)))
        : null;
    return this.upsertProviderCredential({
      ...existing,
      remaining_budget_usd: nextBudget,
      is_active: nextBudget !== null && nextBudget <= 0 ? false : existing.is_active,
      cooldown_until: null,
      total_requests: (existing.total_requests || 0) + 1,
    });
  }

  // ==========================================================================
  // 13. ROUTING PROFILES & 1-CLICK HACKATHON SWITCHER REPOSITORY
  // ==========================================================================

  public async listRoutingProfiles(): Promise<RoutingProfileRow[]> {
    return structuredClone(this.state.routing_profiles);
  }

  public async getActiveRoutingProfile(): Promise<RoutingProfileRow> {
    const activeId = this.state.active_routing_profile || 'GCP_ZERO_COST';
    const found =
      this.state.routing_profiles.find((p) => p.id === activeId) ||
      this.state.routing_profiles.find((p) => p.is_active) ||
      SEED_ROUTING_PROFILES[0];
    return structuredClone(found);
  }

  /**
   * 1-Click Global Routing Profile Switcher (`GCP_ZERO_COST` | `META_MUSE_HACKATHON` | `CUSTOM_HYBRID`).
   * Updates `routing_profiles.is_active` and (when `applyToAgents !== false`) updates all
   * hierarchy agents' `model_provider`, `model_id`, `fallback_provider`, `fallback_model_id`,
   * and `step_routing_json` in a single atomic operation.
   */
  public async setActiveRoutingProfile(
    profileId: RoutingProfileId,
    applyToAgents = true
  ): Promise<{ profile: RoutingProfileRow; updatedAgents: number }> {
    const now = new Date().toISOString();
    this.state.active_routing_profile = profileId;

    let activeProfile: RoutingProfileRow | undefined;
    for (const profile of this.state.routing_profiles) {
      profile.is_active = profile.id === profileId;
      if (profile.is_active) {
        profile.updated_at = now;
        activeProfile = profile;
      }
      if (this.pg.isConnected()) {
        await this.pg.query(
          `INSERT INTO routing_profiles (id, name, description, is_active, config_json, updated_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6)
           ON CONFLICT (id) DO UPDATE SET
             is_active = EXCLUDED.is_active,
             updated_at = EXCLUDED.updated_at`,
          [
            profile.id,
            profile.name,
            profile.description,
            profile.is_active,
            JSON.stringify(profile.config_json || {}),
            profile.updated_at,
          ]
        );
      }
    }

    if (!activeProfile) {
      activeProfile = structuredClone(SEED_ROUTING_PROFILES[0]);
    }

    let updatedAgents = 0;
    if (applyToAgents && profileId !== 'CUSTOM_HYBRID') {
      const cfg = activeProfile.config_json;
      for (const agent of this.state.agents) {
        const isLevel0OrRoot = agent.hierarchy_level <= 0;
        const isLevel1 = agent.hierarchy_level === 1;
        const primaryProvider = isLevel0OrRoot
          ? cfg.default_level0_provider
          : isLevel1
          ? cfg.default_level1_provider
          : cfg.default_level2_provider;
        const primaryModel = isLevel0OrRoot
          ? cfg.default_level0_model
          : isLevel1
          ? cfg.default_level1_model
          : cfg.default_level2_model;

        await this.upsertAgent({
          ...agent,
          model_provider: primaryProvider,
          model_id: primaryModel,
          fallback_provider:
            primaryProvider === 'meta_muse'
              ? 'vertex'
              : agent.hierarchy_level >= 2
              ? 'ollama'
              : 'vertex',
          fallback_model_id:
            primaryProvider === 'meta_muse'
              ? 'gemini-2.5-pro'
              : agent.hierarchy_level >= 2
              ? 'qwen2.5-coder:32b'
              : 'gemini-2.0-flash',
          step_routing_json: {
            planning: {
              provider: cfg.default_level0_provider,
              modelId: cfg.default_level0_model,
            },
            tool_loop: {
              provider: cfg.default_level2_provider,
              modelId: cfg.default_level2_model,
            },
            compaction: {
              provider: cfg.compaction_provider,
              modelId: cfg.compaction_model,
            },
          },
        });
        updatedAgents += 1;
      }
    } else {
      this.saveSnapshot();
    }

    return {
      profile: structuredClone(activeProfile),
      updatedAgents,
    };
  }

  // ==========================================================================
  // 14. CONTRACTS REPOSITORY (Synchronized with contracts/<project>-<slug>.md)
  // ==========================================================================

  public async listContracts(filter?: {
    project_slug?: string;
    status?: ContractStatus;
  }): Promise<ContractRow[]> {
    if (this.pg.isConnected()) {
      const res = await this.pg.query(
        'SELECT * FROM contracts ORDER BY project_slug ASC, feature_slug ASC'
      );
      if (res && res.rows.length > 0) {
        this.state.contracts = res.rows.map((r) => ({
          id: String(r.id),
          project_slug: String(r.project_slug),
          feature_slug: String(r.feature_slug),
          title: String(r.title),
          status: (r.status || 'LOCKED') as ContractStatus,
          file_path: String(r.file_path),
          content_md: String(r.content_md || ''),
          embedding: parsePgVector(r.embedding),
          updated_at: r.updated_at
            ? new Date(r.updated_at).toISOString()
            : new Date().toISOString(),
        }));
      }
    }

    let items = [...this.state.contracts];
    if (filter?.project_slug) {
      items = items.filter((c) => c.project_slug === filter.project_slug);
    }
    if (filter?.status) {
      items = items.filter((c) => c.status === filter.status);
    }
    return items.sort((a, b) => a.id.localeCompare(b.id));
  }

  public async getContract(idOrSlug: string): Promise<ContractRow | null> {
    const found = this.state.contracts.find(
      (c) =>
        c.id === idOrSlug ||
        `${c.project_slug}:${c.feature_slug}` === idOrSlug ||
        c.file_path === idOrSlug
    );
    return found ? structuredClone(found) : null;
  }

  public async upsertContract(
    input: Partial<ContractRow> & {
      project_slug: string;
      feature_slug: string;
      title: string;
      file_path: string;
      content_md: string;
    }
  ): Promise<ContractRow> {
    const now = new Date().toISOString();
    const id =
      input.id ||
      `ctr_${input.project_slug.replace(/[^a-zA-Z0-9_]/g, '_')}_${input.feature_slug.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    const existingIdx = this.state.contracts.findIndex(
      (c) =>
        c.id === id ||
        (c.project_slug === input.project_slug && c.feature_slug === input.feature_slug)
    );
    const existing = existingIdx >= 0 ? this.state.contracts[existingIdx] : undefined;

    const embedding =
      input.embedding && input.embedding.length === 768
        ? input.embedding
        : generateDeterministicEmbedding(
            `${input.project_slug} ${input.feature_slug} ${input.title} ${input.content_md}`
          );

    const row: ContractRow = {
      id,
      project_slug: input.project_slug,
      feature_slug: input.feature_slug,
      title: input.title,
      status: input.status || existing?.status || 'LOCKED',
      file_path: input.file_path,
      content_md: input.content_md,
      embedding,
      updated_at: now,
    };

    if (existingIdx >= 0) {
      this.state.contracts[existingIdx] = row;
    } else {
      this.state.contracts.push(row);
    }
    this.saveSnapshot();

    if (this.pg.isConnected()) {
      await this.pg.query(
        `INSERT INTO contracts (
          id, project_slug, feature_slug, title, status,
          file_path, content_md, embedding, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector, $9)
        ON CONFLICT (id) DO UPDATE SET
          project_slug = EXCLUDED.project_slug,
          feature_slug = EXCLUDED.feature_slug,
          title = EXCLUDED.title,
          status = EXCLUDED.status,
          file_path = EXCLUDED.file_path,
          content_md = EXCLUDED.content_md,
          embedding = EXCLUDED.embedding,
          updated_at = EXCLUDED.updated_at`,
        [
          row.id,
          row.project_slug,
          row.feature_slug,
          row.title,
          row.status,
          row.file_path,
          row.content_md,
          formatPgVector(row.embedding),
          row.updated_at,
        ]
      );
    }

    return structuredClone(row);
  }

  public async upsertChatSessionLog(input: {
    id: string;
    thread_id: string;
    file_path: string;
    title: string;
    content_md: string;
    turn_count: number;
  }): Promise<void> {
    if (!this.pg.isConnected()) return;
    const embedding = generateDeterministicEmbedding(`${input.title} ${input.content_md}`);
    await this.pg.query(
      `INSERT INTO chat_session_logs (
        id, thread_id, file_path, title, content_md, turn_count, embedding, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8)
      ON CONFLICT (id) DO UPDATE SET
        thread_id = EXCLUDED.thread_id,
        file_path = EXCLUDED.file_path,
        title = EXCLUDED.title,
        content_md = EXCLUDED.content_md,
        turn_count = EXCLUDED.turn_count,
        embedding = EXCLUDED.embedding,
        updated_at = EXCLUDED.updated_at`,
      [
        input.id,
        input.thread_id,
        input.file_path,
        input.title,
        input.content_md,
        input.turn_count,
        formatPgVector(embedding),
        new Date().toISOString(),
      ]
    );
  }
}

export const dbStore = new DatabaseStore();
export const db = dbStore;
