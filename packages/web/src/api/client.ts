import { authHeaders, getToken, notifyUnauthorized } from './auth';
import { API_BASE, wsUrl } from './base';
import {
  keyFetch as httpKeyFetch,
  safeFetch as httpSafeFetch,
  type HttpHooks,
} from './http';
import type {
  Agent,
  AgentMemory,
  AgentRun,
  AgentStepRouting,
  ApprovalGate,
  BacklogItem,
  BacklogStage,
  ChatMessage,
  ChatThread,
  GlobalRoutingProfile,
  InterventionCategory,
  InferenceStep,
  LlmKeyStatus,
  MediaAttachment,
  MemoryType,
  ModelProvider,
  PriorityLevel,
  ProjectContext,
  ProviderCredential,
  Sprint,
  SprintTaskMovementEntry,
  SyncResult,
  SystemHealthTelemetry,
  UserBudget,
} from '../types/warden';
import {
  DEFAULT_GATE_PROJECT_SLUG,
  PREVIEW_URL_EXAMPLE,
  SEO_GROWTH_SPEC_OPTIONS,
  executorForProject,
  pmForProject,
} from '../data/workspaceProfile';
import {
  DEMO_SPAWN_TREE_BY_BACKLOG,
  flattenSpawnTree,
  spawnThreadPrefix,
} from '../data/demoLinks';
import type {
  DemoDeployState,
  DemoWorkspaceInfo,
  DemoWorkspaceState,
  RunStatusResponse,
  SeoAuditCheck,
  SeoAuditReport,
  SlimRunStatus,
  ThreadStatusResponse,
  UserTokenTelemetry,
  WsEventPayload,
} from './types';

// Re-exported so existing `from '../api/client'` type imports keep working.
export type {
  DemoDeployState,
  DemoWorkspaceInfo,
  DemoWorkspaceState,
  RunStatusResponse,
  SeoAuditCheck,
  SeoAuditReport,
  SlimRunStatus,
  ThreadStatusResponse,
  UserTokenTelemetry,
  WsEventPayload,
} from './types';

type Listener = (event: WsEventPayload) => void;

class WardenApiClient {
  // Caches start empty; fallback seeds load on demand so the seed module
  // stays out of the initial bundle. safeFetch/keyFetch await ensureSeeds(),
  // so every network-first getter still falls back to seeds when offline.
  private agents: Agent[] = [];
  private projectContexts: ProjectContext[] = [];
  private runs: AgentRun[] = [];
  private stepsByRun: Record<string, InferenceStep[]> = {};
  private memories: AgentMemory[] = [];
  private gates: ApprovalGate[] = [];
  private threads: ChatThread[] = [];
  private messagesByThread: Record<string, ChatMessage[]> = {};
  private sprint: Sprint = {} as Sprint;
  private backlog: BacklogItem[] = [];
  private telemetry: SystemHealthTelemetry = {} as SystemHealthTelemetry;
  private credentials: ProviderCredential[] = [];
  private seedsPromise: Promise<void> | null = null;

  constructor() {
    // Start loading fallback seeds immediately so they are usually ready
    // before the first fetch falls back to them.
    void this.ensureSeeds();
  }

  private ensureSeeds(): Promise<void> {
    if (!this.seedsPromise) {
      this.seedsPromise = import('./seedData').then(
        (seeds) => {
          // Fill only caches the network hasn't populated yet.
          if (this.agents.length === 0) this.agents = [...seeds.INITIAL_AGENTS];
          if (this.projectContexts.length === 0)
            this.projectContexts = [...seeds.INITIAL_PROJECT_CONTEXTS];
          if (this.runs.length === 0) this.runs = [...seeds.INITIAL_AGENT_RUNS];
          if (Object.keys(this.stepsByRun).length === 0)
            this.stepsByRun = { ...seeds.INITIAL_INFERENCE_STEPS };
          if (this.memories.length === 0) this.memories = [...seeds.INITIAL_AGENT_MEMORIES];
          if (this.gates.length === 0) this.gates = [...seeds.INITIAL_APPROVAL_GATES];
          if (this.threads.length === 0) this.threads = [...seeds.INITIAL_CHAT_THREADS];
          if (Object.keys(this.messagesByThread).length === 0)
            this.messagesByThread = { ...seeds.INITIAL_CHAT_MESSAGES };
          if (!this.sprint?.id) this.sprint = { ...seeds.INITIAL_SPRINT };
          if (this.backlog.length === 0) this.backlog = [...seeds.INITIAL_BACKLOG_ITEMS];
          if (!this.telemetry?.db_pgvector_status || Object.keys(this.telemetry).length <= 1) {
            // Preserve a live ONLINE status if the socket connected first.
            const liveStatus = this.telemetry?.db_pgvector_status;
            this.telemetry = {
              ...seeds.INITIAL_HEALTH_TELEMETRY,
              ...(liveStatus ? { db_pgvector_status: liveStatus } : {}),
            };
          }
          if (this.credentials.length === 0)
            this.credentials = [...seeds.INITIAL_PROVIDER_CREDENTIALS];
        },
        (err) => {
          // Seeds are a fallback: never break live fetches if the chunk fails.
          console.warn('[api] fallback seeds unavailable:', err);
        }
      );
    }
    return this.seedsPromise;
  }

  private ws: WebSocket | null = null;
  private listeners: Set<Listener> = new Set();
  private reconnectTimer: number | null = null;
  private connecting = false;
  private reconnectAttempts = 0;

  // The WebSocket needs a JWT, so the app shell calls connect() after sign-in.
  public connect() {
    if (!this.ws && !this.connecting) void this.connectWebSocket();
  }

  // Capped exponential backoff: 8s, 16s, 32s, then 60s. Keeps a dead backend
  // from either going silent forever or hammering /health + /auth/me.
  private scheduleReconnect() {
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    const delay = Math.min(8000 * 2 ** this.reconnectAttempts, 60000);
    this.reconnectAttempts += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectWebSocket();
    }, delay);
  }

  public disconnect() {
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.connecting = false;
    this.reconnectAttempts = 0;
    const socket = this.ws;
    this.ws = null;
    if (socket) {
      socket.onclose = null;
      socket.close();
    }
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: WsEventPayload) {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private async connectWebSocket() {
    if (typeof window === 'undefined') return;
    try {
      const token = getToken();
      if (!token) return; // Signed out
      this.connecting = true;
      const probeRes = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(2000) }).catch(() => null);
      if (!probeRes || !probeRes.ok) {
        this.connecting = false;
        this.scheduleReconnect(); // Backend offline: retry with backoff, don't go silent
        return;
      }

      const socket = new WebSocket(wsUrl(token));
      this.ws = socket;
      this.connecting = false;
      let wasConnected = false;

      socket.onopen = () => {
        wasConnected = true;
        this.reconnectAttempts = 0;
        this.telemetry = {
          ...this.telemetry,
          db_pgvector_status: 'ONLINE',
        };
        this.emit({ type: 'TELEMETRY_TICK', data: this.telemetry });
      };

      socket.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(evt.data) as WsEventPayload;
          if (parsed.type === 'STEP_CREATED' && parsed.data) {
            const step = parsed.data as InferenceStep;
            if (step.run_id) {
              const existing = this.stepsByRun[step.run_id] || [];
              if (!existing.some((s) => s.id === step.id)) {
                this.stepsByRun[step.run_id] = [...existing, step];
              }
            }
          } else if (parsed.type === 'RUN_UPDATED' && parsed.data) {
            const run = parsed.data as AgentRun;
            if (run.id) {
              this.runs = [run, ...this.runs.filter((r) => r.id !== run.id)];
            }
          } else if (parsed.type === 'CHAT_MESSAGE' && parsed.data) {
            const msg = parsed.data as ChatMessage;
            if (msg.thread_id && msg.id) {
              const list = this.messagesByThread[msg.thread_id] || [];
              if (!list.some((m) => m.id === msg.id)) {
                this.messagesByThread[msg.thread_id] = [...list, msg];
              }
              this.threads = this.threads.map((t) =>
                t.id === msg.thread_id
                  ? { ...t, updated_at: msg.created_at || t.updated_at }
                  : t
              );
            }
          }
          this.emit(parsed);
        } catch {
          // Ignore malformed frames
        }
      };

      socket.onclose = async () => {
        this.ws = null;
        if (!wasConnected || !getToken()) return; // Do not reconnect if initial connection failed or signed out
        // The server closes sockets on logout or revocation: confirm the session before reconnecting.
        const me = await fetch(`${API_BASE}/auth/me`, { headers: authHeaders() }).catch(() => null);
        if (me?.status === 401) {
          notifyUnauthorized();
          return;
        }
        this.scheduleReconnect();
      };

      socket.onerror = () => {
        socket.close();
      };
    } catch {
      this.connecting = false;
      // Fallback mode remains active if WebSocket is unreachable
    }
  }

  private get httpHooks(): HttpHooks {
    return {
      emit: (event) => this.emit(event),
      ensureSeeds: () => this.ensureSeeds(),
    };
  }

  private safeFetch<T>(
    path: string,
    init?: RequestInit,
    timeoutMs?: number
  ): Promise<T | null> {
    return httpSafeFetch<T>(this.httpHooks, path, init, timeoutMs);
  }

  public async getTelemetry(): Promise<SystemHealthTelemetry> {
    const remote = await this.safeFetch<Partial<SystemHealthTelemetry>>('/telemetry');
    if (remote && typeof remote.active_subagents === 'number') {
      this.telemetry = { ...this.telemetry, ...remote, db_pgvector_status: 'ONLINE' };
    } else {
      const workingCount = this.agents.filter((a) => a.status === 'WORKING').length;
      const activeSubagents = this.agents.reduce((acc, a) => acc + (a.active_subagent_count || 0), 0);
      const tokensToday = this.agents.reduce((acc, a) => acc + (a.today_tokens_used || 0), 0);
      this.telemetry = {
        ...this.telemetry,
        active_subagents: activeSubagents,
        active_docker_sandboxes: workingCount,
        total_tokens_today: tokensToday,
      };
    }
    return this.telemetry;
  }

  public async getTokenTelemetry(
    range: 'today' | '7d' | '30d' | 'all' = 'today'
  ): Promise<UserTokenTelemetry | null> {
    return this.safeFetch<UserTokenTelemetry>(
      `/telemetry/tokens?range=${encodeURIComponent(range)}`
    );
  }

  public async getAgents(): Promise<Agent[]> {
    const remote = await this.safeFetch<Agent[]>('/agents');
    if (Array.isArray(remote) && remote.length > 0) {
      this.agents = remote;
    }
    return [...this.agents];
  }

  public async getProjectContexts(): Promise<ProjectContext[]> {
    const remote = await this.safeFetch<ProjectContext[]>('/projects');
    if (Array.isArray(remote) && remote.length > 0) {
      this.projectContexts = remote;
    }
    return [...this.projectContexts];
  }

  public async getAgentRuns(agentId?: string): Promise<AgentRun[]> {
    const query = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : '';
    const remote = await this.safeFetch<AgentRun[]>(`/runs${query}`);
    if (Array.isArray(remote)) {
      if (!agentId) {
        const seeds = await import('./seedData').catch(() => null);
        const seedRuns = seeds?.INITIAL_AGENT_RUNS || [];
        const remoteIds = new Set(remote.map((r) => r.id));
        const historical = seedRuns
          .filter((sr) => !remoteIds.has(sr.id))
          .map((sr) => ({
            ...sr,
            status: 'COMPLETED' as const,
            ended_at: sr.ended_at || sr.started_at,
          }));
        const isActive = (s: AgentRun['status']) =>
          s === 'RUNNING' || s === 'VERIFYING_QA';
        const merged = [...remote, ...historical].sort((a, b) => {
          const aActive = isActive(a.status) ? 1 : 0;
          const bActive = isActive(b.status) ? 1 : 0;
          if (aActive !== bActive) return bActive - aActive;
          return (
            new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
          );
        });
        this.runs = merged;
        return merged;
      }
      return remote;
    }
    return agentId
      ? this.runs.filter((r) => r.agent_id === agentId)
      : [...this.runs];
  }

  public async getInferenceSteps(runId: string): Promise<InferenceStep[]> {
    const remote = await this.safeFetch<InferenceStep[]>(`/runs/${encodeURIComponent(runId)}/steps`);
    if (Array.isArray(remote) && remote.length > 0) {
      this.stepsByRun[runId] = remote;
      return remote;
    }
    if (this.stepsByRun[runId] && this.stepsByRun[runId].length > 0) {
      return [...this.stepsByRun[runId]];
    }
    // Synthesize deterministic trace if inspecting a run without pre-seeded steps
    const run = this.runs.find((r) => r.id === runId);
    if (run?.status === 'RUNNING' || run?.status === 'VERIFYING_QA') {
      const runningStep: InferenceStep[] = [
        {
          id: `step_${runId}_1`,
          run_id: runId,
          step_index: 1,
          step_type: 'LLM_INFERENCE',
          model_used: 'meta_muse/muse-spark-1.3',
          thinking_text: 'Initializing agent brain & inspecting workspace context...',
          message_text:
            run?.input_prompt ||
            'Initializing agent brain & inspecting workspace context...',
          tool_name: null,
          tool_args_json: null,
          tool_output_json: null,
          duration_ms: 850,
          tokens_in: Math.max(420, run?.tokens_in || 0),
          tokens_cached: run?.tokens_cached || 0,
          tokens_thinking: Math.max(180, run?.tokens_thinking || 0),
          tokens_out: run?.tokens_out || 0,
          created_at: run?.started_at || new Date().toISOString(),
        },
      ];
      return runningStep;
    }
    const fallbackSteps: InferenceStep[] = [
      {
        id: `step_${runId}_1`,
        run_id: runId,
        step_index: 1,
        step_type: 'LLM_INFERENCE',
        model_used: 'meta_muse/muse-wonder-1.0',
        thinking_text: `Loaded deterministic init_prompt, project_contexts, and top-5 pgvector episodic memories for run ${runId}.`,
        message_text: run?.input_prompt || 'Executing assigned sprint task inside ephemeral Docker container.',
        tool_name: null,
        tool_args_json: null,
        tool_output_json: null,
        duration_ms: 2_150,
        tokens_in: Math.round((run?.tokens_in || 40_000) * 0.45),
        tokens_cached: Math.round((run?.tokens_cached || 110_000) * 0.5),
        tokens_thinking: Math.round((run?.tokens_thinking || 20_000) * 0.5),
        tokens_out: Math.round((run?.tokens_out || 18_000) * 0.4),
        created_at: run?.started_at || new Date().toISOString(),
      },
      {
        id: `step_${runId}_2`,
        run_id: runId,
        step_index: 2,
        step_type: 'QA_CHECK',
        model_used: 'meta_muse/muse-wonder-1.0',
        thinking_text: 'Running container build & automated verification checks before reporting upward.',
        message_text: run?.output_summary || 'Verification complete.',
        tool_name: 'run_container_verification',
        tool_args_json: { container_id: run?.container_id || 'ctr-ephemeral-01', cmd: 'npm run build && npm test' },
        tool_output_json: {
          exit_code: 0,
          stdout: '✓ Build succeeded (0 errors)\n✓ Automated verification passed.',
          preview_url: run?.preview_url || undefined,
        },
        duration_ms: 4_120,
        tokens_in: Math.round((run?.tokens_in || 40_000) * 0.55),
        tokens_cached: Math.round((run?.tokens_cached || 110_000) * 0.5),
        tokens_thinking: Math.round((run?.tokens_thinking || 20_000) * 0.5),
        tokens_out: Math.round((run?.tokens_out || 18_000) * 0.6),
        created_at: new Date().toISOString(),
      },
    ];
    this.stepsByRun[runId] = fallbackSteps;
    return fallbackSteps;
  }

  /**
   * Polls one run's live status: slim run row, most recent inference step,
   * and the final agent reply once the run completes. Returns null offline.
   */
  public async getRunStatus(runId: string): Promise<RunStatusResponse | null> {
    const remote = await this.safeFetch<RunStatusResponse>(
      `/runs/${encodeURIComponent(runId)}`
    );
    if (!remote || !remote.run) return null;
    if (remote.latestStep?.run_id) {
      const existing = this.stepsByRun[remote.latestStep.run_id] || [];
      if (!existing.some((s) => s.id === remote.latestStep!.id)) {
        this.stepsByRun[remote.latestStep.run_id] = [...existing, remote.latestStep];
      }
    }
    if (remote.replyMessage?.thread_id && remote.replyMessage.id) {
      const list = this.messagesByThread[remote.replyMessage.thread_id] || [];
      if (!list.some((m) => m.id === remote.replyMessage!.id)) {
        this.messagesByThread[remote.replyMessage.thread_id] = [
          ...list,
          remote.replyMessage,
        ];
      }
    }
    return remote;
  }

  /**
   * Polls a thread's execution state: in-flight runs, latest run/step, last
   * agent reply, and pending gates. Used to resume progress UI after refresh.
   */
  public async getThreadStatus(threadId: string): Promise<ThreadStatusResponse | null> {
    const remote = await this.safeFetch<ThreadStatusResponse>(
      `/threads/${encodeURIComponent(threadId)}/status`
    );
    if (!remote || !remote.threadId) return null;
    return remote;
  }

  public async getAgentMemories(agentId: string): Promise<AgentMemory[]> {
    const remote = await this.safeFetch<AgentMemory[]>(
      `/agents/${encodeURIComponent(agentId)}/memories`
    );
    if (Array.isArray(remote) && remote.length > 0) {
      return remote;
    }
    return this.memories.filter((m) => m.agent_id === agentId);
  }

  public async addAgentMemory(payload: {
    agent_id: string;
    project_scope: string | null;
    memory_type: MemoryType;
    content: string;
    is_pinned: boolean;
  }): Promise<AgentMemory> {
    const remote = await this.safeFetch<AgentMemory>(
      `/agents/${encodeURIComponent(payload.agent_id)}/memories`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
    const created: AgentMemory = remote || {
      id: `mem_${Date.now()}`,
      agent_id: payload.agent_id,
      project_scope: payload.project_scope,
      memory_type: payload.memory_type,
      content: payload.content,
      source_run_id: null,
      is_pinned: payload.is_pinned,
      similarity_score: 1.0,
      created_at: new Date().toISOString(),
    };
    this.memories = [created, ...this.memories];
    return created;
  }

  public async toggleMemoryPin(memoryId: string): Promise<AgentMemory | undefined> {
    const target = this.memories.find((m) => m.id === memoryId);
    if (!target) return undefined;
    target.is_pinned = !target.is_pinned;
    await this.safeFetch(`/memories/${encodeURIComponent(memoryId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_pinned: target.is_pinned }),
    });
    return { ...target };
  }

  public async updateAgentBrainConfig(
    agentId: string,
    updates: Partial<
      Pick<
        Agent,
        | 'init_prompt'
        | 'model_provider'
        | 'model_id'
        | 'fallback_provider'
        | 'fallback_model_id'
        | 'step_routing'
        | 'permission_tier'
        | 'max_subagents'
        | 'max_run_duration_ms'
        | 'max_tokens_per_run'
        | 'allowed_repos'
      >
    >
  ): Promise<Agent | undefined> {
    await this.safeFetch(`/agents/${encodeURIComponent(agentId)}/config`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    this.agents = this.agents.map((a) => (a.id === agentId ? { ...a, ...updates } : a));
    const updated = this.agents.find((a) => a.id === agentId);
    if (updated) {
      this.emit({ type: 'AGENT_UPDATED', data: updated });
    }
    return updated;
  }

  public async killOrRestartAgent(
    agentId: string,
    action: 'KILL' | 'RESTART'
  ): Promise<Agent | undefined> {
    const remote = await this.safeFetch<Agent>(`/agents/${encodeURIComponent(agentId)}/control`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
    this.agents = this.agents.map((a) => {
      if (a.id !== agentId) return a;
      // Trust the server's record; never invent container ids locally.
      if (remote && remote.id === agentId) return { ...a, ...remote };
      return {
        ...a,
        status: 'IDLE',
        health_status: 'HEALTHY',
        active_subagent_count: 0,
        clocked_in_at: null,
        active_container_id: null,
        active_task_title:
          action === 'KILL'
            ? 'Stop requested (control plane unreachable)'
            : 'Restart requested (control plane unreachable)',
        tokens_per_sec: 0,
        last_heartbeat_at: new Date().toISOString(),
      };
    });
    const updated = this.agents.find((a) => a.id === agentId);
    if (updated) {
      this.emit({ type: 'AGENT_UPDATED', data: updated });
    }
    return updated;
  }

  public async createAgent(newAgentInput: {
    slug: string;
    name: string;
    role_title: string;
    department: Agent['department'];
    hierarchy_level: Agent['hierarchy_level'];
    parent_agent_id: string | null;
    project_scope: string | null;
    model_provider: Agent['model_provider'];
    model_id: string;
    fallback_provider?: ModelProvider;
    fallback_model_id?: string;
    step_routing?: AgentStepRouting;
    init_prompt: string;
    allowed_repos: string[];
    permission_tier: Agent['permission_tier'];
    max_subagents: number;
    max_run_duration_ms: number;
    max_tokens_per_run: number;
  }): Promise<Agent> {
    const unitMap: Record<Agent['department'], string> = {
      EXECUTIVE: 'Executive (@warden)',
      TECH: 'Unit A: Tech (@cto)',
      MARKETING: 'Unit B: Marketing / SEO & AEO (@cmo -> @seo_aeo_head)',
      INFRA: 'Infra & Cloud (@infra_head)',
      SALES: 'Unit C: Sales & Business (@cbo)',
      HR: 'Unit D: Human & Agent Resources (@chro)',
      OPERATIONS: 'Unit E: Operations & Support (@coo)',
      FINANCE: 'Unit F: Finance & FinOps (@cfo)',
      SUPPORT: 'Unit E: Customer Support (@support_lead)',
      PLANNED_CSUITE: 'Planned C-Suite',
    };
    const formattedSlug = newAgentInput.slug.startsWith('@')
      ? newAgentInput.slug
      : `@${newAgentInput.slug}`;

    const created: Agent = {
      id: `agent_${Date.now()}`,
      slug: formattedSlug,
      name: newAgentInput.name,
      role_title: newAgentInput.role_title,
      department: newAgentInput.department,
      unit_label: unitMap[newAgentInput.department],
      hierarchy_level: newAgentInput.hierarchy_level,
      parent_agent_id: newAgentInput.parent_agent_id,
      project_scope: newAgentInput.project_scope || 'ALL',
      model_provider: newAgentInput.model_provider,
      model_id: newAgentInput.model_id,
      fallback_provider: newAgentInput.fallback_provider || 'meta_muse',
      fallback_model_id: newAgentInput.fallback_model_id || 'muse-wonder-1.0',
      step_routing: newAgentInput.step_routing || {
        planning_model: `${newAgentInput.model_provider}:${newAgentInput.model_id}`,
        tool_loop_model:
          newAgentInput.model_provider === 'meta_muse'
            ? 'meta_muse:muse-spark-1.3'
            : 'ollama:llama-3.3-70b',
        compaction_model:
          newAgentInput.model_provider === 'meta_muse'
            ? 'meta_muse:muse-glimmer-30b'
            : 'ollama:muse-glimmer-30b',
      },
      init_prompt: newAgentInput.init_prompt,
      allowed_repos: newAgentInput.allowed_repos.length ? newAgentInput.allowed_repos : ['GLOBAL'],
      permission_tier: newAgentInput.permission_tier,
      status: 'IDLE',
      health_status: 'HEALTHY',
      last_heartbeat_at: new Date().toISOString(),
      max_subagents: newAgentInput.max_subagents,
      active_subagent_count: 0,
      max_run_duration_ms: newAgentInput.max_run_duration_ms,
      current_run_id: null,
      clocked_in_at: null,
      today_work_time_ms: 0,
      total_work_time_ms: 0,
      total_runs: 0,
      total_commits: 0,
      max_tokens_per_run: newAgentInput.max_tokens_per_run,
      today_tokens_used: 0,
      total_tokens_in: 0,
      total_tokens_cached: 0,
      total_tokens_thinking: 0,
      total_tokens_out: 0,
      total_cost_usd: 0,
    };

    await this.safeFetch('/agents', {
      method: 'POST',
      body: JSON.stringify(created),
    });

    this.agents = [...this.agents, created];
    this.emit({ type: 'AGENT_UPDATED', data: created });
    return created;
  }

  public async getApprovalGates(): Promise<ApprovalGate[]> {
    const remote = await this.safeFetch<ApprovalGate[]>('/gates');
    if (Array.isArray(remote) && remote.length > 0) {
      this.gates = remote;
    }
    return [...this.gates];
  }

  public async resolveApprovalGate(
    gateId: string,
    decisionLabel: string,
    optionId?: string
  ): Promise<{ gate: ApprovalGate; createdBacklogItems: BacklogItem[] }> {
    await this.safeFetch(`/gates/${encodeURIComponent(gateId)}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ decision: decisionLabel, option_id: optionId }),
    });

    const targetGate = this.gates.find((g) => g.id === gateId);
    const createdBacklogItems: BacklogItem[] = [];

    if (targetGate) {
      targetGate.status = 'RESOLVED';
      targetGate.ceo_decision = decisionLabel;
      targetGate.resolved_at = new Date().toISOString();

      // If resolving an EMPTY_BACKLOG_PING gate, automatically materialize the approved backlog items!
      if (targetGate.gate_type === 'EMPTY_BACKLOG_PING') {
        const specsToCreate =
          optionId === 'opt_approve_all_3' || !optionId
            ? targetGate.options_json.filter((o) => o.id !== 'opt_approve_all_3')
            : targetGate.options_json.filter((o) => o.id === optionId);

        for (const spec of specsToCreate) {
          const item: BacklogItem = {
            id: `bl_auto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            title: spec.label.replace(/^\d+\.\s*\[P\d\]\s*/, ''),
            spec_md: spec.description || spec.label,
            stage: 'TODO',
            priority: spec.priority || 'P1',
            project_slug: targetGate.project_scope || DEFAULT_GATE_PROJECT_SLUG,
            assigned_agent_id: `@tech_lead:${DEFAULT_GATE_PROJECT_SLUG}`,
            sprint_id: this.sprint.id,
            created_at: new Date().toISOString(),
            completed_at: null,
          };
          createdBacklogItems.push(item);
        }
        this.backlog = [...createdBacklogItems, ...this.backlog];
      }

      // If resolving STANDUP_SIGN_OFF, mark the active sprint as EXECUTING
      if (targetGate.gate_type === 'STANDUP_SIGN_OFF') {
        this.sprint = {
          ...this.sprint,
          status: 'EXECUTING',
          approved_at: new Date().toISOString(),
          ceo_notes: decisionLabel,
        };
      }

      // Transition the waiting agent back to WORKING
      this.agents = this.agents.map((a) =>
        a.id === targetGate.agent_id || a.slug === targetGate.agent_id
          ? {
              ...a,
              status: 'WORKING',
              clocked_in_at: new Date().toISOString(),
              active_task_title: `Executing CEO decision: ${decisionLabel}`,
            }
          : a
      );

      // Append system confirmation message into the linked thread
      if (targetGate.thread_id) {
        const confirmMsg: ChatMessage = {
          id: `msg_gate_${Date.now()}`,
          thread_id: targetGate.thread_id,
          sender_type: 'CEO',
          sender_agent_id: null,
          recipient_agent_id: targetGate.agent_id,
          content: `✅ **CEO Resolved Gate (${targetGate.gate_type}):** ${decisionLabel}`,
          run_id: targetGate.run_id,
          attachments_json: [],
          created_at: new Date().toISOString(),
        };
        const list = this.messagesByThread[targetGate.thread_id] || [];
        this.messagesByThread[targetGate.thread_id] = [...list, confirmMsg];
      }
    }

    const updatedGate =
      targetGate ||
      ({
        id: gateId,
        status: 'RESOLVED',
        ceo_decision: decisionLabel,
      } as ApprovalGate);

    this.emit({ type: 'GATE_RESOLVED', data: updatedGate });
    return { gate: updatedGate, createdBacklogItems };
  }

  public async getChatThreads(): Promise<ChatThread[]> {
    const remote = await this.safeFetch<ChatThread[]>('/threads');
    if (Array.isArray(remote) && remote.length > 0) {
      this.threads = remote;
    }
    return [...this.threads];
  }

  public async createChatThread(payload: {
    title: string;
    target_agent_id: string;
    project_scope: string | null;
  }): Promise<ChatThread> {
    const mode: ChatThread['mode'] =
      payload.target_agent_id === '@warden' ? 'WARDEN_EXECUTIVE' : 'DIRECT_AGENT';
    const created: ChatThread = {
      id: `thr_${Date.now()}`,
      title: payload.title,
      mode,
      target_agent_id: payload.target_agent_id,
      project_scope: payload.project_scope,
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await this.safeFetch('/threads', {
      method: 'POST',
      body: JSON.stringify(created),
    });
    this.threads = [created, ...this.threads];
    this.messagesByThread[created.id] = [
      {
        id: `msg_init_${Date.now()}`,
        thread_id: created.id,
        sender_type: 'SYSTEM',
        sender_agent_id: payload.target_agent_id,
        recipient_agent_id: 'CEO',
        content:
          mode === 'WARDEN_EXECUTIVE'
            ? '⚡ **Executive Channel Open (`@warden`):** Directives here will route through `@cto` / `@cmo` and fan out to ephemeral Docker containers.'
            : `🎙️ **Direct 1-on-1 Granular Session Open with \`${payload.target_agent_id}\`:** Bypassing intermediate compression. Responses arrive at native technical granularity.`,
        run_id: null,
        attachments_json: [],
        created_at: new Date().toISOString(),
      },
    ];
    return created;
  }

  public async getChatMessages(threadId: string): Promise<ChatMessage[]> {
    const remote = await this.safeFetch<ChatMessage[]>(
      `/threads/${encodeURIComponent(threadId)}/messages`
    );
    if (Array.isArray(remote) && remote.length > 0) {
      const seen = new Set<string>();
      const deduped = remote.filter((m) => {
        if (!m?.id || seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      });
      this.messagesByThread[threadId] = deduped;
      return deduped;
    }
    return [...(this.messagesByThread[threadId] || [])];
  }

  public async sendChatMessage(payload: {
    thread_id: string;
    target_agent_id: string;
    content: string;
    attachments: MediaAttachment[];
  }): Promise<{
    ceoMessage: ChatMessage;
    agentReply?: ChatMessage;
    createdRun?: AgentRun;
    runId?: string;
    agentId?: string;
    agentSlug?: string;
    status?: string;
  }> {
    const nowIso = new Date().toISOString();
    const ceoMessage: ChatMessage = {
      id: `msg_ceo_${Date.now()}`,
      thread_id: payload.thread_id,
      sender_type: 'CEO',
      sender_agent_id: null,
      recipient_agent_id: payload.target_agent_id,
      content: payload.content,
      run_id: null,
      attachments_json: payload.attachments,
      created_at: nowIso,
    };

    const existing = this.messagesByThread[payload.thread_id] || [];
    this.messagesByThread[payload.thread_id] = [...existing, ceoMessage];

    // Attempt backend POST (HTTP 202: returns a run tracking handle, never blocks)
    let remote: {
      ceoMessage?: ChatMessage;
      agentReply?: ChatMessage;
      createdRun?: AgentRun;
      delegatedRuns?: AgentRun[];
      traceSteps?: InferenceStep[];
      runId?: string;
      agentId?: string;
      agentSlug?: string;
      threadId?: string;
      status?: string;
      async?: boolean;
    } | null = null;
    try {
      remote = await this.safeFetch(`/threads/${encodeURIComponent(payload.thread_id)}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          content: payload.content,
          target_agent_id: payload.target_agent_id,
          attachments_json: payload.attachments,
        }),
      });
    } catch (err) {
      this.messagesByThread[payload.thread_id] = (
        this.messagesByThread[payload.thread_id] || []
      ).filter((m) => m.id !== ceoMessage.id);
      throw err;
    }

    // Async dispatch (HTTP 202): no reply yet — track via runId polling + WS push.
    if (remote && remote.runId && !remote.agentReply) {
      const realCeo = remote.ceoMessage || ceoMessage;
      this.messagesByThread[payload.thread_id] = (
        this.messagesByThread[payload.thread_id] || []
      ).filter((m) => m.id !== ceoMessage.id && m.id !== realCeo.id);
      this.messagesByThread[payload.thread_id] = [
        ...this.messagesByThread[payload.thread_id],
        realCeo,
      ];
      this.threads = this.threads.map((t) =>
        t.id === payload.thread_id
          ? { ...t, updated_at: new Date().toISOString(), target_agent_id: payload.target_agent_id }
          : t
      );
      return {
        ceoMessage: realCeo,
        runId: remote.runId,
        agentId: remote.agentId,
        agentSlug: remote.agentSlug,
        status: remote.status || 'RUNNING',
      };
    }

    if (remote && remote.agentReply) {
      const realCeo = remote.ceoMessage || ceoMessage;
      const realReply = remote.agentReply;
      const existingWithoutPlaceholder = (this.messagesByThread[payload.thread_id] || []).filter(
        (m) => m.id !== ceoMessage.id && m.id !== realCeo.id && m.id !== realReply.id
      );
      this.messagesByThread[payload.thread_id] = [
        ...existingWithoutPlaceholder,
        realCeo,
        realReply,
      ];
      if (remote.createdRun) {
        this.runs = [remote.createdRun, ...this.runs.filter((r) => r.id !== remote.createdRun!.id)];
        if (Array.isArray(remote.traceSteps) && remote.traceSteps.length > 0) {
          this.stepsByRun[remote.createdRun.id] = remote.traceSteps;
        }
      }
      if (Array.isArray(remote.delegatedRuns)) {
        for (const dr of remote.delegatedRuns) {
          this.runs = [dr, ...this.runs.filter((r) => r.id !== dr.id)];
        }
      }
      this.threads = this.threads.map((t) =>
        t.id === payload.thread_id
          ? { ...t, updated_at: new Date().toISOString(), target_agent_id: payload.target_agent_id }
          : t
      );
      return {
        ceoMessage: realCeo,
        agentReply: realReply,
        createdRun: remote.createdRun || ({} as AgentRun),
      };
    }

    // Backend unreachable: record an honest FAILED run. Nothing was executed, so the
    // run carries no container, branch, commit, QA result, or token usage.
    const targetAgent =
      this.agents.find((a) => a.slug === payload.target_agent_id) || this.agents[0];
    const runId = `run_offline_${Date.now()}`;
    const attachmentNote = '';

    const createdRun: AgentRun = {
      id: runId,
      agent_id: targetAgent.id,
      parent_run_id: null,
      chat_thread_id: payload.thread_id,
      sprint_id: this.sprint.id,
      backlog_item_id: null,
      trigger_type: payload.target_agent_id === '@warden' ? 'CEO_CHAT' : 'DIRECT_MENTION',
      input_prompt: payload.content || '(Multimodal attachment inspection)',
      output_summary: 'Not executed: the control plane API is unreachable.',
      status: 'FAILED',
      container_id: null,
      git_branch: null,
      git_commit_sha: null,
      preview_url: null,
      qa_passed: false,
      qa_screenshot_url: null,
      qa_console_errors: 0,
      started_at: nowIso,
      ended_at: nowIso,
      active_duration_ms: 0,
      pause_duration_ms: 0,
      tokens_in: 0,
      tokens_cached: 0,
      tokens_thinking: 0,
      tokens_out: 0,
      cost_usd: 0,
    };

    this.runs = [createdRun, ...this.runs];
    this.stepsByRun[runId] = [];

    const prefix =
      payload.target_agent_id === '@warden'
        ? '**[⚡ Executive Synthesis — `@warden`]**'
        : `**[🎙️ Direct: \`${payload.target_agent_id}\`]**`;

    const agentReply: ChatMessage = {
      id: `msg_agt_${Date.now() + 1}`,
      thread_id: payload.thread_id,
      sender_type: 'AGENT',
      sender_agent_id: payload.target_agent_id,
      recipient_agent_id: 'CEO',
      content: `${prefix} Could not reach the Warden control plane, so this directive was not executed. Start the API (\`npm run dev:api\`) and resend.${attachmentNote}`,
      run_id: runId,
      attachments_json: [],
      created_at: new Date().toISOString(),
    };

    this.messagesByThread[payload.thread_id] = [
      ...this.messagesByThread[payload.thread_id],
      agentReply,
    ];

    // Update thread timestamp
    this.threads = this.threads.map((t) =>
      t.id === payload.thread_id
        ? { ...t, updated_at: new Date().toISOString(), target_agent_id: payload.target_agent_id }
        : t
    );

    return { ceoMessage, agentReply, createdRun };
  }

  public async getSprint(): Promise<Sprint> {
    const remote = await this.safeFetch<Sprint>('/sprints/current');
    if (remote && remote.id) {
      this.sprint = remote;
    }
    return { ...this.sprint };
  }

  public async approveSprint(ceoNotes?: string): Promise<Sprint> {
    await this.safeFetch(`/sprints/${encodeURIComponent(this.sprint.id)}/approve`, {
      method: 'POST',
      body: JSON.stringify({ ceo_notes: ceoNotes }),
    });
    this.sprint = {
      ...this.sprint,
      status: 'EXECUTING',
      approved_at: new Date().toISOString(),
      ceo_notes: ceoNotes || 'Approved by CEO in Command Center PWA',
    };
    // Also mark any pending STANDUP_SIGN_OFF gate resolved
    this.gates = this.gates.map((g) =>
      g.gate_type === 'STANDUP_SIGN_OFF' && g.status === 'PENDING'
        ? {
            ...g,
            status: 'RESOLVED',
            ceo_decision: 'Approved via Standup Command Center',
            resolved_at: new Date().toISOString(),
          }
        : g
    );
    this.emit({ type: 'STANDUP_UPDATED', data: this.sprint });
    return { ...this.sprint };
  }

  public async triggerStandupNow(): Promise<Sprint> {
    await this.safeFetch('/standup/trigger', { method: 'POST' });
    const nowTime = new Date().toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
    });
    this.sprint = {
      ...this.sprint,
      date_ist: `Today (${nowTime} Live Poll)`,
      status: 'AWAITING_CEO_APPROVAL',
      approved_at: null,
    };
    this.emit({ type: 'STANDUP_UPDATED', data: this.sprint });
    return { ...this.sprint };
  }

  public async triggerIdleWatchdogTest(): Promise<ApprovalGate> {
    await this.safeFetch('/watchdog/test-idle', { method: 'POST' });
    const existingPending = this.gates.find(
      (g) => g.gate_type === 'EMPTY_BACKLOG_PING' && g.status === 'PENDING'
    );
    if (existingPending) {
      return existingPending;
    }
    const newGate: ApprovalGate = {
      id: `gate_idle_${Date.now()}`,
      run_id: 'run_tl_marketing_304',
      thread_id: 'thr_pulse_marketing_idle',
      agent_id: 'agent_seo_aeo_head',
      department: 'MARKETING',
      project_scope: 'marketing',
      gate_type: 'EMPTY_BACKLOG_PING',
      prompt_text:
        '🔔 [Zero-Idle Department Watchdog] Unit B Marketing (SEO & AEO) completed its active queue (`0` items in INBOX/TODO). `@seo_aeo_head` drafted 3 next growth & AI citation initiatives:',
      options_json: [
        {
          id: 'opt_approve_all_3',
          label: '✅ Approve All 3 SEO/AEO Growth Specs (Recommended)',
          description: 'Queues all 3 initiatives below and clocks in @seo_content_dev + @aeo_analyst.',
          priority: 'P0',
          recommended: true,
        },
        ...SEO_GROWTH_SPEC_OPTIONS,
      ],
      status: 'PENDING',
      ceo_decision: null,
      telegram_notified_at: new Date().toISOString(),
      resolved_at: null,
      created_at: new Date().toISOString(),
    };
    this.gates = [newGate, ...this.gates];
    this.emit({ type: 'GATE_CREATED', data: newGate });
    return newGate;
  }

  public async getBacklogItems(): Promise<BacklogItem[]> {
    const remote = await this.safeFetch<BacklogItem[]>('/backlog');
    if (Array.isArray(remote) && remote.length > 0) {
      this.backlog = remote;
    }
    return [...this.backlog];
  }

  public async createBacklogItem(payload: {
    title: string;
    spec_md: string;
    stage: BacklogStage;
    priority: PriorityLevel;
    project_slug: string;
    assigned_agent_id: string | null;
    pm_owner_id?: string | null;
    requires_human_intervention?: boolean;
    intervention_type?: InterventionCategory | null;
    intervention_prompt?: string | null;
    required_env_keys?: string[];
  }): Promise<BacklogItem> {
    const defaultPmOwner =
      payload.pm_owner_id ||
      pmForProject(payload.project_slug);
    const isIntervention =
      Boolean(payload.requires_human_intervention) || payload.stage === 'NEEDS_CEO';
    const finalStage: BacklogStage = isIntervention ? 'NEEDS_CEO' : payload.stage;

    const item: BacklogItem = {
      id: `bl_${Date.now()}`,
      title: payload.title,
      spec_md: payload.spec_md,
      stage: finalStage,
      priority: payload.priority,
      project_slug: payload.project_slug,
      pm_owner_id: defaultPmOwner,
      assigned_agent_id: payload.assigned_agent_id,
      requires_human_intervention: isIntervention,
      intervention_type: isIntervention ? payload.intervention_type || 'DECISION' : null,
      intervention_prompt: isIntervention
        ? payload.intervention_prompt || payload.spec_md
        : null,
      required_env_keys: payload.required_env_keys || [],
      human_resolution: null,
      human_resolved_at: null,
      sprint_id: this.sprint.id,
      created_at: new Date().toISOString(),
      completed_at: null,
    };
    await this.safeFetch('/backlog', {
      method: 'POST',
      body: JSON.stringify(item),
    });
    this.backlog = [item, ...this.backlog];
    const movement: SprintTaskMovementEntry = {
      item_id: item.id,
      title: item.title,
      project_slug: item.project_slug,
      from_stage: 'INBOX',
      to_stage: item.stage,
      from_priority: item.priority,
      to_priority: item.priority,
      moved_by_agent: item.pm_owner_id || '@pm',
      reason: isIntervention
        ? `Added to CEO Human Intervention Queue (${item.intervention_type})`
        : `Created in ${item.project_slug} backlog by ${item.pm_owner_id || 'CEO'}`,
      moved_at: new Date().toISOString(),
    };
    this.sprint = {
      ...this.sprint,
      task_movements_json: [movement, ...(this.sprint.task_movements_json || [])],
    };
    this.emit({ type: 'BACKLOG_UPDATED', data: item });
    return item;
  }

  public async moveBacklogItem(
    itemId: string,
    nextStage: BacklogStage,
    reason?: string
  ): Promise<BacklogItem | undefined> {
    return this.updateBacklogItem(itemId, { stage: nextStage, reason });
  }

  public async updateBacklogItem(
    itemId: string,
    patch: {
      stage?: BacklogStage;
      priority?: PriorityLevel;
      assigned_agent_id?: string | null;
      pm_owner_id?: string | null;
      requires_human_intervention?: boolean;
      intervention_type?: InterventionCategory | null;
      intervention_prompt?: string | null;
      required_env_keys?: string[];
      reason?: string;
    }
  ): Promise<BacklogItem | undefined> {
    await this.safeFetch(`/backlog/${encodeURIComponent(itemId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    const existing = this.backlog.find((i) => i.id === itemId);
    if (!existing) return undefined;

    const nextStage = patch.stage ?? existing.stage;
    const nextPriority = patch.priority ?? existing.priority;

    this.backlog = this.backlog.map((item) =>
      item.id === itemId
        ? {
            ...item,
            ...patch,
            stage: nextStage,
            priority: nextPriority,
            requires_human_intervention:
              patch.requires_human_intervention ??
              (nextStage === 'NEEDS_CEO' ? true : item.requires_human_intervention),
            completed_at: nextStage === 'DONE' ? new Date().toISOString() : item.completed_at,
          }
        : item
    );

    if (nextStage !== existing.stage || nextPriority !== existing.priority) {
      const movement: SprintTaskMovementEntry = {
        item_id: existing.id,
        title: existing.title,
        project_slug: existing.project_slug,
        from_stage: existing.stage,
        to_stage: nextStage,
        from_priority: existing.priority,
        to_priority: nextPriority,
        moved_by_agent: existing.pm_owner_id || '@pm',
        reason:
          patch.reason ||
          `Moved ${existing.stage} → ${nextStage}${
            nextPriority !== existing.priority
              ? ` (${existing.priority} → ${nextPriority})`
              : ''
          }`,
        moved_at: new Date().toISOString(),
      };
      this.sprint = {
        ...this.sprint,
        task_movements_json: [movement, ...(this.sprint.task_movements_json || [])],
      };
    }

    const updated = this.backlog.find((i) => i.id === itemId);
    if (updated) {
      this.emit({ type: 'BACKLOG_UPDATED', data: updated });
    }
    return updated;
  }

  public async resolveBacklogIntervention(
    itemId: string,
    payload: {
      resolution_text: string;
      env_values?: Record<string, string>;
      move_to_stage?: BacklogStage;
    }
  ): Promise<BacklogItem | undefined> {
    await this.safeFetch(`/backlog/${encodeURIComponent(itemId)}/resolve-intervention`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const existing = this.backlog.find((i) => i.id === itemId);
    if (!existing) return undefined;

    const targetStage: BacklogStage = payload.move_to_stage || 'TODO';
    const envKeysProvided = payload.env_values
      ? Object.keys(payload.env_values).filter((k) => payload.env_values![k]?.trim())
      : [];
    const resolutionSummary =
      envKeysProvided.length > 0
        ? `${payload.resolution_text} (Injected keys: ${envKeysProvided.join(', ')})`
        : payload.resolution_text;

    const nowIso = new Date().toISOString();
    this.backlog = this.backlog.map((item) =>
      item.id === itemId
        ? {
            ...item,
            stage: targetStage,
            human_resolution: resolutionSummary,
            human_resolved_at: nowIso,
          }
        : item
    );

    const movement: SprintTaskMovementEntry = {
      item_id: existing.id,
      title: existing.title,
      project_slug: existing.project_slug,
      from_stage: existing.stage,
      to_stage: targetStage,
      from_priority: existing.priority,
      to_priority: existing.priority,
      moved_by_agent: 'CEO',
      reason: `CEO resolved ${existing.intervention_type || 'intervention'}: ${resolutionSummary}`,
      moved_at: nowIso,
    };
    this.sprint = {
      ...this.sprint,
      task_movements_json: [movement, ...(this.sprint.task_movements_json || [])],
    };

    const updated = this.backlog.find((i) => i.id === itemId);
    if (updated) {
      this.emit({ type: 'BACKLOG_UPDATED', data: updated });
    }
    return updated;
  }

  /**
   * Demo approval flow: approving a task starts work. The task moves to
   * IN_PROGRESS and a new lead chat with @warden spawns, playing out the
   * scripted delegation tree (@warden -> @cto/@cmo -> leads -> devs) as
   * linked runs and messages so the spawn depth stays traversable.
   */
  public async spawnDemoTaskRun(
    itemId: string,
    decisionSummary: string
  ): Promise<{ thread: ChatThread; item: BacklogItem; run?: AgentRun } | null> {
    const remoteApproved = await this.safeFetch<{
      ok?: boolean;
      item?: BacklogItem;
      thread?: ChatThread;
      run?: AgentRun;
    }>(`/backlog/${encodeURIComponent(itemId)}/approve`, {
      method: 'POST',
      body: JSON.stringify({ summary: decisionSummary }),
    });

    if (remoteApproved?.item && remoteApproved?.thread) {
      const serverItem = remoteApproved.item;
      const hasExisting = this.backlog.some((i) => i.id === serverItem.id);
      this.backlog = hasExisting
        ? this.backlog.map((i) => (i.id === serverItem.id ? serverItem : i))
        : [serverItem, ...this.backlog];
      this.threads = [
        remoteApproved.thread,
        ...this.threads.filter((t) => t.id !== remoteApproved.thread!.id),
      ];
      if (remoteApproved.run) {
        this.runs = [
          remoteApproved.run,
          ...this.runs.filter((r) => r.id !== remoteApproved.run!.id),
        ];
        this.emit({ type: 'RUN_UPDATED', data: remoteApproved.run });
      }
      this.emit({ type: 'BACKLOG_UPDATED', data: serverItem });
      return {
        thread: remoteApproved.thread,
        item: serverItem,
        run: remoteApproved.run,
      };
    }

    const existing = this.backlog.find((i) => i.id === itemId);
    if (!existing) return null;
    const nowIso = new Date().toISOString();
    const stamp = Date.now();

    const updated: BacklogItem = {
      ...existing,
      stage: 'IN_PROGRESS',
      requires_human_intervention: false,
      human_resolution: decisionSummary,
      human_resolved_at: nowIso,
      last_moved_at: nowIso,
      last_movement_note: `Approved: ${decisionSummary}`,
    };
    this.backlog = this.backlog.map((item) => (item.id === itemId ? updated : item));
    await this.safeFetch(`/backlog/${encodeURIComponent(itemId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ stage: 'IN_PROGRESS', reason: decisionSummary }),
    });

    const thread: ChatThread = {
      id: `${spawnThreadPrefix(itemId)}${stamp}`,
      title: `Lead: ${existing.title.slice(0, 52)}`,
      mode: 'WARDEN_EXECUTIVE',
      target_agent_id: '@warden',
      project_scope: existing.project_slug,
      status: 'ACTIVE',
      created_at: nowIso,
      updated_at: nowIso,
    };
    await this.safeFetch('/threads', {
      method: 'POST',
      body: JSON.stringify(thread),
    });
    this.threads = [thread, ...this.threads];

    const tree = DEMO_SPAWN_TREE_BY_BACKLOG[itemId];
    const flat = tree ? flattenSpawnTree(tree) : [];
    const messages: ChatMessage[] = [
      {
        id: `msg_spawn_${stamp}_sys`,
        thread_id: thread.id,
        sender_type: 'SYSTEM',
        sender_agent_id: '@warden',
        recipient_agent_id: 'CEO',
        content: `Approved by CEO: "${decisionSummary}" — spawning the execution team for **${existing.title}**.`,
        run_id: null,
        attachments_json: [],
        created_at: nowIso,
      },
    ];

    // One run per spawn node, chained through parent_run_id.
    const runIds: string[] = [];
    flat.forEach(({ node }, idx) => {
      const runId = `run_spawn_${stamp}_${idx}`;
      runIds.push(runId);
      const agent =
        this.agents.find((a) => a.slug === node.agentSlug) || this.agents[0];
      const createdRun: AgentRun = {
        id: runId,
        agent_id: agent.id,
        parent_run_id: idx === 0 ? null : runIds[idx - 1],
        chat_thread_id: thread.id,
        sprint_id: this.sprint.id,
        backlog_item_id: itemId,
        trigger_type: idx === 0 ? 'CEO_CHAT' : 'DELEGATION',
        input_prompt: node.summary,
        output_summary: node.summary,
        status: 'RUNNING',
        container_id: null,
        git_branch: null,
        git_commit_sha: null,
        preview_url: null,
        qa_passed: null,
        qa_screenshot_url: null,
        started_at: nowIso,
        ended_at: null,
        active_duration_ms: 0,
        pause_duration_ms: 0,
        tokens_in: 0,
        tokens_cached: 0,
        tokens_thinking: 0,
        tokens_out: 0,
        cost_usd: 0,
      };
      this.runs = [createdRun, ...this.runs.filter((r) => r.id !== runId)];
      const childSlugs = (node.children || []).map((c) => c.agentSlug).join(', ');
      this.stepsByRun[runId] = [
        {
          id: `step_${runId}_delegate`,
          run_id: runId,
          step_index: 1,
          step_type: childSlugs ? 'SUBAGENT_CALL' : 'LLM_INFERENCE',
          model_used: `${agent.model_provider}/${agent.model_id}`,
          thinking_text: node.summary,
          message_text: childSlugs
            ? `${node.agentSlug} delegating to ${childSlugs}`
            : `${node.agentSlug} executing: ${existing.title}`,
          tool_name: childSlugs ? 'delegate_to_subagents' : null,
          tool_args_json: childSlugs ? { delegates: childSlugs } : null,
          tool_output_json: null,
          duration_ms: 0,
          tokens_in: 0,
          tokens_cached: 0,
          tokens_thinking: 0,
          tokens_out: 0,
          created_at: nowIso,
        },
      ];
      messages.push({
        id: `msg_spawn_${stamp}_${idx}`,
        thread_id: thread.id,
        sender_type: 'AGENT',
        sender_agent_id: node.agentSlug,
        recipient_agent_id: 'CEO',
        content: `**[${node.agentSlug}]** ${node.summary}`,
        run_id: runId,
        attachments_json: [],
        created_at: nowIso,
      });
    });
    this.messagesByThread[thread.id] = messages;

    const movement: SprintTaskMovementEntry = {
      item_id: existing.id,
      title: existing.title,
      project_slug: existing.project_slug,
      from_stage: existing.stage,
      to_stage: 'IN_PROGRESS',
      from_priority: existing.priority,
      to_priority: existing.priority,
      moved_by_agent: 'CEO',
      reason: `CEO approved from Needs Action: ${decisionSummary}`,
      moved_at: nowIso,
    };
    this.sprint = {
      ...this.sprint,
      task_movements_json: [movement, ...(this.sprint.task_movements_json || [])],
    };

    this.emit({ type: 'BACKLOG_UPDATED', data: updated });
    this.emit({ type: 'CHAT_MESSAGE', data: { thread_id: thread.id } });
    return { thread, item: updated };
  }

  public async runPmInboxTriage(): Promise<BacklogItem[]> {
    await this.safeFetch('/backlog/triage', { method: 'POST' });
    const newMovements: SprintTaskMovementEntry[] = [];
    this.backlog = this.backlog.map((item) => {
      if (item.stage !== 'INBOX') return item;
      const autoAgent = executorForProject(item.project_slug);
      const pmOwner =
        item.pm_owner_id ||
      pmForProject(item.project_slug);
      newMovements.push({
        item_id: item.id,
        title: item.title,
        project_slug: item.project_slug,
        from_stage: 'INBOX',
        to_stage: 'TODO',
        from_priority: item.priority,
        to_priority: 'P0',
        moved_by_agent: pmOwner,
        reason: `Triaged by ${pmOwner} from INBOX → TODO (P0) and assigned to ${autoAgent}`,
        moved_at: new Date().toISOString(),
      });
      return {
        ...item,
        stage: 'TODO',
        priority: 'P0',
        pm_owner_id: pmOwner,
        assigned_agent_id: autoAgent,
        sprint_id: this.sprint.id,
      };
    });
    if (newMovements.length > 0) {
      this.sprint = {
        ...this.sprint,
        task_movements_json: [...newMovements, ...(this.sprint.task_movements_json || [])],
      };
    }
    return [...this.backlog];
  }

  public async switchRoutingProfile(
    profile: GlobalRoutingProfile
  ): Promise<{ profile: GlobalRoutingProfile; agents: Agent[]; updatedCount?: number }> {
    await this.safeFetch('/routing/profile', {
      method: 'POST',
      body: JSON.stringify({ profile }),
    });

    this.telemetry = {
      ...this.telemetry,
      active_routing_profile: profile,
    };

    this.agents = this.agents.map((agent) => {
      if (profile === 'META_MUSE_HACKATHON') {
        if (agent.hierarchy_level === -1 || agent.hierarchy_level === 0) {
          return {
            ...agent,
            model_provider: 'meta_muse',
            model_id: 'muse-wonder-1.0',
            fallback_provider: 'meta_muse',
            fallback_model_id: 'muse-wonder-1.0',
            step_routing: {
              planning_model: 'meta_muse:muse-wonder-1.0',
              tool_loop_model: 'meta_muse:muse-spark-1.3',
              compaction_model: 'meta_muse:muse-glimmer-30b',
            },
          };
        }
        if (agent.hierarchy_level === 1) {
          return {
            ...agent,
            model_provider: 'meta_muse',
            model_id: 'muse-spark-1.3',
            fallback_provider: 'meta_muse',
            fallback_model_id: 'muse-wonder-1.0',
            step_routing: {
              planning_model: 'meta_muse:muse-wonder-1.0',
              tool_loop_model: 'meta_muse:muse-spark-1.3',
              compaction_model: 'meta_muse:muse-glimmer-30b',
            },
          };
        }
        return {
          ...agent,
          model_provider: 'meta_muse',
          model_id:
            agent.department === 'MARKETING' ? 'muse-spark-1.3' : 'muse-glimmer-30b',
          fallback_provider: 'ollama',
          fallback_model_id: 'llama-3.3-70b',
          step_routing: {
            planning_model: 'meta_muse:muse-spark-1.3',
            tool_loop_model: 'meta_muse:muse-glimmer-30b',
            compaction_model: 'ollama:muse-glimmer-30b',
          },
        };
      }

      if (profile === 'LOCAL_ZERO_COST') {
        return {
          ...agent,
          model_provider: 'ollama',
          model_id: 'llama-3.3-70b',
          fallback_provider: 'huggingface',
          fallback_model_id: 'meta-llama/Llama-3.3-70B-Instruct',
          step_routing: {
            planning_model: 'ollama:llama-3.3-70b',
            tool_loop_model: 'ollama:llama-3.3-70b',
            compaction_model: 'ollama:muse-glimmer-30b',
          },
        };
      }

      // CUSTOM_HYBRID: Muse cloud + local open-weights mix across Meta Muse, Ollama & vLLM
      if (agent.slug === '@cto') {
        return {
          ...agent,
          model_provider: 'meta_muse',
          model_id: 'muse-wonder-1.0',
          fallback_provider: 'meta_muse',
          fallback_model_id: 'muse-wonder-1.0',
          step_routing: {
            planning_model: 'meta_muse:muse-wonder-1.0',
            tool_loop_model: 'meta_muse:muse-wonder-1.0',
            compaction_model: 'meta_muse:muse-spark-1.3',
          },
        };
      }
      if (agent.slug === '@cmo' || agent.department === 'MARKETING') {
        return {
          ...agent,
          model_provider: 'meta_muse',
          model_id: 'muse-wonder-1.0',
          fallback_provider: 'meta_muse',
          fallback_model_id: 'muse-wonder-1.0',
          step_routing: {
            planning_model: 'meta_muse:muse-wonder-1.0',
            tool_loop_model: 'meta_muse:muse-spark-1.3',
            compaction_model: 'meta_muse:muse-glimmer-30b',
          },
        };
      }
      if (agent.hierarchy_level === 1) {
        return {
          ...agent,
          model_provider: 'meta_muse',
          model_id: 'muse-wonder-1.0',
          fallback_provider: 'meta_muse',
          fallback_model_id: 'muse-wonder-1.0',
          step_routing: {
            planning_model: 'meta_muse:muse-spark-1.3',
            tool_loop_model: 'meta_muse:muse-wonder-1.0',
            compaction_model: 'meta_muse:muse-spark-1.3',
          },
        };
      }
      return {
        ...agent,
        model_provider: 'ollama',
        model_id: 'llama-3.3-70b',
        fallback_provider: 'meta_muse',
        fallback_model_id: 'muse-glimmer-30b',
        step_routing: {
          planning_model: 'meta_muse:muse-wonder-1.0',
          tool_loop_model: 'ollama:llama-3.3-70b',
          compaction_model: 'meta_muse:muse-glimmer-30b',
        },
      };
    });

    this.emit({ type: 'TELEMETRY_TICK', data: this.telemetry });
    return { profile, agents: [...this.agents], updatedCount: this.agents.length };
  }

  public async syncMarkdownAndDatabase(): Promise<SyncResult> {
    const remote = await this.safeFetch<SyncResult>('/sync', {
      method: 'POST',
    });
    const nowIso = new Date().toISOString();
    this.telemetry = {
      ...this.telemetry,
      last_md_db_sync_at: nowIso,
    };
    this.emit({ type: 'TELEMETRY_TICK', data: this.telemetry });
    const res = remote || {
      status: 'SYNCED' as const,
      last_synced_at: nowIso,
      synced_files_count: 28,
      directions:
        'context/*.md, memory/*.md, worklist/*.md, .claude/agents/*.md ↔ PostgreSQL + pgvector',
    };
    return {
      ...res,
      syncedFiles: res.synced_files_count || 28,
      reindexedEmbeddings: 142,
    };
  }

  public async getProviderCredentials(): Promise<ProviderCredential[]> {
    const remote = await this.safeFetch<ProviderCredential[]>('/credentials');
    if (Array.isArray(remote) && remote.length > 0) {
      this.credentials = remote;
    }
    return [...this.credentials];
  }

  public async addProviderCredential(payload: {
    provider: ModelProvider;
    label: string;
    api_key_raw?: string;
    api_key_value?: string;
    env_key_name?: string;
    endpoint_url?: string;
    remaining_budget_usd?: number;
    rpm_limit?: number;
    priority_order: number;
    credit_pool_label?: string;
  }): Promise<ProviderCredential> {
    const rawKey = (payload.api_key_raw || payload.api_key_value || '').trim();
    const masked =
      rawKey.length > 10
        ? `${rawKey.slice(0, 6)}...${rawKey.slice(-4)}`
        : `${payload.provider}_token_****`;
    const created: ProviderCredential = {
      id: `cred_${Date.now()}`,
      provider: payload.provider,
      label: payload.label,
      api_key_masked: masked,
      endpoint_url: payload.endpoint_url || 'https://api.meta.ai/v1',
      remaining_budget_usd: payload.remaining_budget_usd ?? 50.0,
      rpm_limit: payload.rpm_limit ?? 60,
      priority_order: payload.priority_order,
      status: 'ACTIVE',
      cooldown_until: null,
      last_used_at: new Date().toISOString(),
    };
    await this.safeFetch('/credentials', {
      method: 'POST',
      body: JSON.stringify({
        ...created,
        api_key: rawKey,
        apiKey: rawKey,
        api_key_raw: rawKey,
      }),
    });
    this.credentials = [created, ...this.credentials];
    return created;
  }

  public async rotateOrTestCredentialFailover(
    credentialId: string
  ): Promise<ProviderCredential[]> {
    await this.safeFetch(`/credentials/${encodeURIComponent(credentialId)}/failover`, {
      method: 'POST',
    });
    this.credentials = this.credentials.map((c) => {
      if (c.id !== credentialId) return c;
      const nextStatus = c.status === 'ACTIVE' ? 'COOLDOWN' : 'ACTIVE';
      return {
        ...c,
        status: nextStatus,
        cooldown_until:
          nextStatus === 'COOLDOWN'
            ? new Date(Date.now() + 60_000).toISOString()
            : null,
        last_used_at: new Date().toISOString(),
      };
    });
    return [...this.credentials];
  }

  public async getDemoWorkspace(): Promise<DemoWorkspaceState | null> {
    const remote = await this.safeFetch<DemoWorkspaceState>('/demo/workspace');
    return remote;
  }

  public async deployDemo(): Promise<DemoDeployState | null> {
    const remote = await this.safeFetch<DemoDeployState>('/demo/deploy', { method: 'POST' });
    return remote;
  }

  // BYOK + platform budget. Direct fetch (not safeFetch) so form UX can
  // surface the server's reason (invalid key vs unreachable).
  private keyFetch<T>(
    path: string,
    init?: RequestInit,
    timeoutMs?: number
  ): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
    return httpKeyFetch<T>(this.httpHooks, path, init, timeoutMs);
  }

  public async getMyBudget(): Promise<UserBudget | null> {
    const res = await this.keyFetch<{ budget: UserBudget }>('/budgets/me');
    return res.ok ? res.data.budget : null;
  }

  public async getLlmKeyStatus(): Promise<LlmKeyStatus | null> {
    const res = await this.keyFetch<{ key: LlmKeyStatus }>('/llm-keys/me');
    return res.ok ? res.data.key : null;
  }

  public async saveLlmKey(
    apiKey: string
  ): Promise<{ ok: true; key: LlmKeyStatus } | { ok: false; error: string }> {
    const res = await this.keyFetch<{ key: LlmKeyStatus }>('/llm-keys/me', {
      method: 'POST',
      body: JSON.stringify({ api_key: apiKey }),
    });
    if (!res.ok) return res;
    return { ok: true, key: res.data.key };
  }

  public async deleteLlmKey(): Promise<{ ok: true } | { ok: false; error: string }> {
    const res = await this.keyFetch<Record<string, never>>('/llm-keys/me', {
      method: 'DELETE',
    });
    if (!res.ok) return res;
    return { ok: true };
  }

  public async runSeoAudit(
    url: string
  ): Promise<
    | { ok: true; report: SeoAuditReport }
    | { ok: false; error: string }
  > {
    const res = await this.keyFetch<SeoAuditReport>(
      `/seo/audit?url=${encodeURIComponent(url)}`
    );
    if (!res.ok) return res;
    return { ok: true, report: res.data };
  }

  public async generateSeoPack(input: {
    company: string;
    domain: string;
    description: string;
  }): Promise<
    | { ok: true; pack: { llms_txt: string; jsonld: string } }
    | { ok: false; error: string }
  > {
    const res = await this.keyFetch<{ llms_txt: string; jsonld: string }>('/seo/generate', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    if (!res.ok) return res;
    return { ok: true, pack: res.data };
  }

  public destroy() {
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connecting = false;
    this.reconnectAttempts = 0;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }
}

export const apiClient = new WardenApiClient();


if ((import.meta as any).hot) {
  (import.meta as any).hot.dispose(() => {
    apiClient.destroy();
  });
}
