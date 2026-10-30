import {
  AgentRecord,
  AgentRunRecord,
  InferenceStepRecord,
  OrchestratorStore,
} from '../engine/OrchestratorStore.js';
import { TelegramPushPager } from '../telegram/TelegramPushPager.js';

export interface SandboxEmergencyAdapter {
  emergencySaveAndKill?: (
    runId: string,
    reason: string
  ) => Promise<{ recoveryBranch?: string } | void>;
  destroyContainer?: (runIdOrContainerId: string) => Promise<void>;
}

export interface SubagentSpawnCheckResult {
  allowed: boolean;
  reason?: string;
}

export interface SystemHealthTelemetry {
  timestamp: string;
  overallStatus: 'HEALTHY' | 'DEGRADED' | 'ALERT';
  activeRunsCount: number;
  workingAgentsCount: number;
  activeSubagentsTotal: number;
  maxSubagentsCapacity: number;
  zombieAgentsCount: number;
  stuckLoopAgentsCount: number;
  terminated24hCount: number;
  containerRamUsedMb: number;
  containerRamQuotaMb: number;
  sandboxLatencyMs: number;
  todayTokensBurned: number;
  lifetimeTokensBurned: number;
  lifetimeCostUsd: number;
}

/**
 * HealthAndQuotaGuard — Runaway Agent Guardrails, 24-Hour Hard Kill & Live Health Watchdog
 * (dynamocommando.md Sections 4.6 & 4.7)
 *
 * Runs every 15 seconds to enforce:
 * 1. Strict Subagent Fan-Out Caps (anti-fork-bomb: max_subagents=4, max_spawns_per_run=12, MAX_DEPTH=4)
 * 2. 24-Hour Maximum Execution Timeout (saves uncommitted work to wip/timeout-<runId> & destroys container)
 * 3. 30-Second Heartbeat Check & Zombie Detection (>3m no heartbeat -> ZOMBIE_NO_HEARTBEAT; >5m -> auto-restart/terminate)
 * 4. Repetitive Tool Loop Detection (3 identical failing tool calls -> STUCK_LOOP circuit breaker)
 * 5. Per-Run Token Cap (default 1,000,000 tokens -> PAUSED_TOKEN_CAP + Approval Gate + Telegram push)
 */
export class HealthAndQuotaGuard {
  public static readonly WATCHDOG_INTERVAL_MS = 15_000;
  public static readonly HEARTBEAT_INTERVAL_MS = 30_000;
  public static readonly ZOMBIE_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes
  public static readonly ZOMBIE_TERMINATE_MS = 5 * 60 * 1000; // 5 minutes
  public static readonly MAX_SPAWNS_PER_RUN = 12;
  public static readonly MAX_HIERARCHY_LEVEL_FOR_SPAWN = 2; // Level 3 workers cannot delegate (MAX_DEPTH = 4: -1 -> 0 -> 1 -> 2 -> 3)
  public static readonly DEFAULT_MAX_RUN_DURATION_MS =
    Number(process.env.MAX_RUN_DURATION_MS) || 86_400_000; // 24 hours
  public static readonly DEFAULT_MAX_TOKENS_PER_RUN =
    Number(process.env.MAX_TOKENS_PER_RUN) || 1_000_000;

  private store: OrchestratorStore;
  private telegramPager: TelegramPushPager;
  private sandboxAdapter?: SandboxEmergencyAdapter;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private lastHeartbeatTickAt = 0;

  constructor(options: {
    store: OrchestratorStore;
    telegramPager: TelegramPushPager;
    sandboxAdapter?: SandboxEmergencyAdapter;
  }) {
    this.store = options.store;
    this.telegramPager = options.telegramPager;
    this.sandboxAdapter = options.sandboxAdapter;
  }

  public setSandboxAdapter(adapter: SandboxEmergencyAdapter): void {
    this.sandboxAdapter = adapter;
  }

  /**
   * Starts the 15-second background watchdog loop.
   */
  public startWatchdogLoop(): void {
    if (this.watchdogTimer) return;
    this.watchdogTimer = setInterval(() => {
      void this.runWatchdogTick();
    }, HealthAndQuotaGuard.WATCHDOG_INTERVAL_MS);
  }

  public stopWatchdogLoop(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  /**
   * Anti-Fork-Bomb Gate: Validates if a parent agent/run is allowed to spawn a child subagent.
   */
  public canSpawnSubagent(
    parentAgent: AgentRecord,
    parentRun: AgentRunRecord
  ): SubagentSpawnCheckResult {
    // 1. Hard Hierarchy Depth Ceiling (MAX_DEPTH = 4: -1 -> 0 -> 1 -> 2 -> 3)
    if (parentAgent.hierarchy_level >= 3) {
      return {
        allowed: false,
        reason: `Hierarchy depth ceiling reached (Level ${parentAgent.hierarchy_level} worker cannot delegate subagents; MAX_DEPTH = 4).`,
      };
    }

    // 2. Per-Agent Concurrent Cap (max_subagents, default 4)
    const maxConcurrent = parentAgent.max_subagents ?? 4;
    if (parentAgent.active_subagent_count >= maxConcurrent) {
      return {
        allowed: false,
        reason: `Agent ${parentAgent.slug} reached concurrent subagent cap (${parentAgent.active_subagent_count}/${maxConcurrent}).`,
      };
    }

    // 3. Per-Run Total Spawn Cap (max_spawns_per_run = 12)
    const spawnsInRun = this.countSubagentSpawnsInRun(parentRun.id);
    if (spawnsInRun >= HealthAndQuotaGuard.MAX_SPAWNS_PER_RUN) {
      return {
        allowed: false,
        reason: `Run ${parentRun.id} reached per-run total subagent spawn cap (${spawnsInRun}/${HealthAndQuotaGuard.MAX_SPAWNS_PER_RUN}). Synthesize findings and yield.`,
      };
    }

    return { allowed: true };
  }

  private countSubagentSpawnsInRun(runId: string): number {
    const run = this.store.runs.get(runId);
    const steps = this.store.getStepsForRun(runId);
    const stepSpawns = steps.filter((s) => s.step_type === 'SUBAGENT_CALL').length;
    return Math.max(run?.spawns_count ?? 0, stepSpawns);
  }

  /**
   * Emits a heartbeat for an active agent.
   */
  public async recordAgentHeartbeat(agentIdOrSlug: string): Promise<void> {
    await this.store.updateAgent(agentIdOrSlug, {
      last_heartbeat_at: new Date().toISOString(),
      health_status: 'HEALTHY',
    });
  }

  /**
   * Executes one full sweep of the HealthAndQuotaGuard watchdog.
   */
  public async runWatchdogTick(): Promise<SystemHealthTelemetry> {
    const nowMs = Date.now();
    const shouldEmit30sHeartbeat =
      nowMs - this.lastHeartbeatTickAt >= HealthAndQuotaGuard.HEARTBEAT_INTERVAL_MS;
    if (shouldEmit30sHeartbeat) {
      this.lastHeartbeatTickAt = nowMs;
    }

    // 1. Inspect all RUNNING agent_runs for 24h timeout, repetitive tool loops, and 1M token cap
    for (const run of this.store.runs.values()) {
      if (run.status !== 'RUNNING') continue;

      const agent = this.store.getAgent(run.agent_id);
      if (!agent) continue;

      const startedAtMs = new Date(run.started_at).getTime();
      const elapsedMs = Math.max(0, nowMs - startedAtMs);

      // Update live active_duration_ms
      run.active_duration_ms = elapsedMs;

      // A. 24-Hour Maximum Execution Timeout Check
      const maxDurationMs =
        agent.max_run_duration_ms ||
        HealthAndQuotaGuard.DEFAULT_MAX_RUN_DURATION_MS;
      if (elapsedMs > maxDurationMs) {
        await this.enforce24HourTimeoutKill(agent, run);
        continue;
      }

      // B. Repetitive Tool Loop Detection (3 identical failing tool calls in a row)
      const steps = this.store.getStepsForRun(run.id);
      if (this.hasRepetitiveFailingToolLoop(steps)) {
        await this.tripStuckLoopCircuitBreaker(agent, run, steps);
        continue;
      }

      // C. Per-Run Token Cap (max_tokens_per_run = 1,000,000)
      const totalRunTokens =
        (run.tokens_in || 0) +
        (run.tokens_thinking || 0) +
        (run.tokens_out || 0);
      const maxTokens =
        agent.max_tokens_per_run ||
        HealthAndQuotaGuard.DEFAULT_MAX_TOKENS_PER_RUN;
      if (totalRunTokens >= maxTokens) {
        await this.pauseRunForTokenCap(agent, run, totalRunTokens, maxTokens);
        continue;
      }
    }

    // 2. Inspect all agents for 30s Heartbeat & Zombie Detection
    for (const agent of this.store.getAllAgents()) {
      if (agent.status === 'WORKING') {
        const lastHbMs = agent.last_heartbeat_at
          ? new Date(agent.last_heartbeat_at).getTime()
          : nowMs;
        const silenceMs = nowMs - lastHbMs;

        if (silenceMs > HealthAndQuotaGuard.ZOMBIE_TERMINATE_MS) {
          // Auto-terminate / restart after 5 minutes of no heartbeat
          if (agent.current_run_id) {
            this.store.updateRun(agent.current_run_id, {
              status: 'FAILED',
              ended_at: new Date().toISOString(),
              output_summary:
                'Auto-terminated by HealthAndQuotaGuard after >5 minutes without heartbeat (ZOMBIE_NO_HEARTBEAT).',
            });
          }
          await this.store.updateAgent(agent.id, {
            status: 'IDLE',
            health_status: 'ZOMBIE_NO_HEARTBEAT',
            current_run_id: null,
            clocked_in_at: null,
            last_heartbeat_at: new Date().toISOString(),
          });
        } else if (silenceMs > HealthAndQuotaGuard.ZOMBIE_THRESHOLD_MS) {
          if (agent.health_status !== 'ZOMBIE_NO_HEARTBEAT') {
            await this.store.updateAgent(agent.id, {
              health_status: 'ZOMBIE_NO_HEARTBEAT',
            });
            await this.telegramPager.sendAlert({
              type: 'ZOMBIE_NO_HEARTBEAT',
              agentSlug: agent.slug,
              projectScope: agent.project_scope,
              runId: agent.current_run_id,
              details: `No heartbeat received for ${Math.round(silenceMs / 1000)}s.`,
            });
          }
        } else if (shouldEmit30sHeartbeat && agent.current_run_id) {
          const activeRun = this.store.runs.get(agent.current_run_id);
          if (activeRun && activeRun.status === 'RUNNING') {
            await this.store.updateAgent(agent.id, {
              last_heartbeat_at: new Date().toISOString(),
            });
          }
        }
      }
    }

    const telemetry = this.getSystemHealthTelemetry();
    this.store.broadcast('health:tick', telemetry);
    return telemetry;
  }

  /**
   * Enforces the 24-Hour Hard Kill Timeout:
   * 1. Saves uncommitted work to wip/timeout-<runId> and destroys container.
   * 2. Marks run and agent TERMINATED_TIMEOUT / KILLED_24H_LIMIT.
   * 3. Fires TelegramPushPager alert and broadcasts WebSocket event.
   */
  public async enforce24HourTimeoutKill(
    agent: AgentRecord,
    run: AgentRunRecord
  ): Promise<void> {
    let recoveryBranch = `wip/timeout-${run.id}`;
    if (this.sandboxAdapter?.emergencySaveAndKill) {
      try {
        const res = await this.sandboxAdapter.emergencySaveAndKill(
          run.id,
          '24H_TIMEOUT'
        );
        if (res && typeof res === 'object' && res.recoveryBranch) {
          recoveryBranch = res.recoveryBranch;
        }
      } catch {
        // Proceed with termination even if docker daemon is offline
      }
    }

    const endedAt = new Date().toISOString();
    this.store.updateRun(run.id, {
      status: 'TERMINATED_TIMEOUT',
      ended_at: endedAt,
      git_branch: recoveryBranch,
      output_summary: `Exceeded max runtime (${agent.max_run_duration_ms}ms). Uncommitted changes saved to ${recoveryBranch} and container destroyed safely.`,
    });

    await this.store.updateAgent(agent.id, {
      status: 'TERMINATED_TIMEOUT',
      health_status: 'KILLED_24H_LIMIT',
      current_run_id: null,
      clocked_in_at: null,
      active_subagent_count: 0,
    });

    await this.telegramPager.notifyKilled24hLimit({
      agentSlug: agent.slug,
      projectScope: agent.project_scope,
      runId: run.id,
      recoveryBranch,
      threadId: run.chat_thread_id,
    });
  }

  /**
   * Inspects the last 3 TOOL_CALL steps of a run.
   * Returns true if the exact same tool_name + tool_args_json was called 3 times in a row and failed.
   */
  public hasRepetitiveFailingToolLoop(steps: InferenceStepRecord[]): boolean {
    const toolSteps = steps.filter((s) => s.step_type === 'TOOL_CALL');
    if (toolSteps.length < 3) return false;

    const lastThree = toolSteps.slice(-3);
    const first = lastThree[0];
    const firstSig = `${first.tool_name ?? ''}::${JSON.stringify(first.tool_args_json ?? {})}`;

    for (const step of lastThree) {
      const sig = `${step.tool_name ?? ''}::${JSON.stringify(step.tool_args_json ?? {})}`;
      if (sig !== firstSig) return false;

      const out = step.tool_output_json || {};
      const isFailure =
        out.error !== undefined ||
        out.ok === false ||
        out.success === false ||
        (typeof out.exitCode === 'number' && out.exitCode !== 0);
      if (!isFailure) return false;
    }

    return true;
  }

  private async tripStuckLoopCircuitBreaker(
    agent: AgentRecord,
    run: AgentRunRecord,
    steps: InferenceStepRecord[]
  ): Promise<void> {
    const lastTool = steps.filter((s) => s.step_type === 'TOOL_CALL').slice(-1)[0];
    const summary = `Circuit breaker tripped (STUCK_LOOP): Agent ${agent.slug} called tool "${lastTool?.tool_name}" with identical arguments and failed 3 times consecutively. Escalated to supervisor (${agent.parent_agent_id || '@cto'}).`;

    this.store.updateRun(run.id, {
      status: 'UNHEALTHY_LOOP',
      ended_at: new Date().toISOString(),
      output_summary: summary,
    });

    await this.store.updateAgent(agent.id, {
      status: 'UNHEALTHY_LOOP',
      health_status: 'STUCK_LOOP',
      current_run_id: null,
      clocked_in_at: null,
    });

    if (run.chat_thread_id) {
      this.store.addChatMessage({
        thread_id: run.chat_thread_id,
        sender_type: 'SYSTEM',
        sender_agent_id: agent.parent_agent_id || 'cto',
        recipient_agent_id: 'CEO',
        content: `🟠 **[Watchdog Escalation — STUCK_LOOP]**: ${summary}`,
        run_id: run.id,
      });
    }

    await this.telegramPager.sendAlert({
      type: 'STUCK_LOOP',
      agentSlug: agent.slug,
      projectScope: agent.project_scope,
      runId: run.id,
      threadId: run.chat_thread_id,
      details: summary,
    });
  }

  private async pauseRunForTokenCap(
    agent: AgentRecord,
    run: AgentRunRecord,
    totalTokens: number,
    maxTokens: number
  ): Promise<void> {
    const promptText = `Agent ${agent.slug} reached its per-run token cap (${totalTokens.toLocaleString()} / ${maxTokens.toLocaleString()} tokens). Approve an additional 500,000 token budget to continue or terminate the run?`;

    this.store.updateRun(run.id, {
      status: 'PAUSED_TOKEN_CAP',
      output_summary: promptText,
    });

    await this.store.updateAgent(agent.id, {
      status: 'PAUSED_TOKEN_CAP',
    });

    const gate = this.store.createApprovalGate({
      run_id: run.id,
      thread_id: run.chat_thread_id,
      agent_id: agent.id,
      department: agent.department,
      project_scope: agent.project_scope,
      gate_type: 'TOKEN_CAP_EXCEEDED',
      prompt_text: promptText,
      options_json: {
        choices: ['EXTEND_BUDGET_500K', 'TERMINATE_RUN'],
        current_tokens: totalTokens,
        max_tokens: maxTokens,
      },
      telegram_notified_at: new Date().toISOString(),
    });

    await this.telegramPager.sendAlert({
      type: 'TOKEN_CAP',
      agentSlug: agent.slug,
      projectScope: agent.project_scope,
      runId: run.id,
      threadId: run.chat_thread_id,
      gateId: gate.id,
      details: promptText,
    });
  }

  /**
   * Computes live Dashboard Health Telemetry Bar metrics.
   */
  public getSystemHealthTelemetry(): SystemHealthTelemetry {
    const agents = this.store.getAllAgents();
    const activeRuns = Array.from(this.store.runs.values()).filter(
      (r) => r.status === 'RUNNING'
    );
    const workingAgents = agents.filter((a) => a.status === 'WORKING');
    const activeSubagentsTotal = agents.reduce(
      (sum, a) => sum + (a.active_subagent_count || 0),
      0
    );
    const maxSubagentsCapacity = agents.reduce(
      (sum, a) => sum + (a.max_subagents || 0),
      0
    );
    const zombieAgentsCount = agents.filter(
      (a) => a.health_status === 'ZOMBIE_NO_HEARTBEAT'
    ).length;
    const stuckLoopAgentsCount = agents.filter(
      (a) => a.health_status === 'STUCK_LOOP'
    ).length;
    const terminated24hCount = agents.filter(
      (a) => a.health_status === 'KILLED_24H_LIMIT'
    ).length;

    const todayTokensBurned = agents.reduce(
      (sum, a) => sum + (a.today_tokens_used || 0),
      0
    );
    const lifetimeTokensBurned = agents.reduce(
      (sum, a) =>
        sum +
        (a.total_tokens_in || 0) +
        (a.total_tokens_thinking || 0) +
        (a.total_tokens_out || 0),
      0
    );
    const lifetimeCostUsd = Number(
      agents.reduce((sum, a) => sum + (a.total_cost_usd || 0), 0).toFixed(2)
    );

    const overallStatus =
      zombieAgentsCount > 0 || stuckLoopAgentsCount > 0
        ? 'DEGRADED'
        : 'HEALTHY';

    return {
      timestamp: new Date().toISOString(),
      overallStatus,
      activeRunsCount: activeRuns.length,
      workingAgentsCount: workingAgents.length,
      activeSubagentsTotal,
      maxSubagentsCapacity,
      zombieAgentsCount,
      stuckLoopAgentsCount,
      terminated24hCount,
      containerRamUsedMb: 420 + activeRuns.length * 380,
      containerRamQuotaMb: 8192,
      sandboxLatencyMs: 38,
      todayTokensBurned,
      lifetimeTokensBurned,
      lifetimeCostUsd,
    };
  }
}
