import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HealthAndQuotaGuard } from '../src/watchdogs/HealthAndQuotaGuard.js';
import {
  createTestAgent,
  createTestRun,
  minutesAgo,
  newTestStore,
} from './helpers.js';

describe('HealthAndQuotaGuard', () => {
  it('pins the demo-fixed 30-minute default runtime', () => {
    assert.equal(
      HealthAndQuotaGuard.DEFAULT_MAX_RUN_DURATION_MS,
      30 * 60 * 1000
    );
  });

  it('kills runs past their agent cap and records a recovery branch', async () => {
    const store = newTestStore();
    const guard = new HealthAndQuotaGuard({ store });
    const agent = await createTestAgent(store, { max_run_duration_ms: 60_000 });
    const run = createTestRun(store, agent);
    store.updateRun(run.id, { started_at: minutesAgo(2) });

    await guard.runWatchdogTick();

    const ended = store.runs.get(run.id);
    assert.ok(ended);
    assert.equal(ended.status, 'TERMINATED_TIMEOUT');
    assert.ok(ended.ended_at);
    assert.equal(ended.git_branch, `wip/timeout-${run.id}`);
    const updated = store.getAgent(agent.id);
    assert.ok(updated);
    assert.equal(updated.status, 'TERMINATED_TIMEOUT');
    assert.equal(updated.health_status, 'KILLED_24H_LIMIT');
    assert.equal(updated.current_run_id, null);
    assert.equal(updated.active_subagent_count, 0);
  });

  it('falls back to the 30-minute default when the agent cap is falsy', async () => {
    const store = newTestStore();
    const guard = new HealthAndQuotaGuard({ store });
    const agent = await createTestAgent(store);
    await store.updateAgent(agent.id, { max_run_duration_ms: 0 });
    const run = createTestRun(store, agent);
    store.updateRun(run.id, { started_at: minutesAgo(31) });

    await guard.runWatchdogTick();

    const agentAfter = store.getAgent(agent.id);
    assert.ok(agentAfter);
    assert.equal(agentAfter.max_run_duration_ms, 0);
    assert.equal(store.runs.get(run.id)?.status, 'TERMINATED_TIMEOUT');
  });

  it('honors a sandbox adapter recovery branch, and survives adapter failure', async () => {
    const store = newTestStore();
    const guard = new HealthAndQuotaGuard({
      store,
      sandboxAdapter: {
        emergencySaveAndKill: async () => ({
          recoveryBranch: 'wip/timeout-stub-branch',
        }),
      },
    });
    const agent = await createTestAgent(store, { max_run_duration_ms: 1 });
    const run = createTestRun(store, agent);
    store.updateRun(run.id, { started_at: minutesAgo(1) });

    await guard.runWatchdogTick();

    assert.equal(
      store.runs.get(run.id)?.git_branch,
      'wip/timeout-stub-branch'
    );

    const failingStore = newTestStore();
    const failingGuard = new HealthAndQuotaGuard({
      store: failingStore,
      sandboxAdapter: {
        emergencySaveAndKill: async () => {
          throw new Error('docker daemon offline');
        },
      },
    });
    const agent2 = await createTestAgent(failingStore, {
      max_run_duration_ms: 1,
    });
    const run2 = createTestRun(failingStore, agent2);
    failingStore.updateRun(run2.id, { started_at: minutesAgo(1) });

    await failingGuard.runWatchdogTick();

    const ended = failingStore.runs.get(run2.id);
    assert.ok(ended);
    assert.equal(ended.status, 'TERMINATED_TIMEOUT');
    assert.equal(ended.git_branch, `wip/timeout-${run2.id}`);
  });

  it('leaves fresh, under-budget runs alone and refreshes their duration', async () => {
    const store = newTestStore();
    const guard = new HealthAndQuotaGuard({ store });
    const agent = await createTestAgent(store, { max_tokens_per_run: 1_000_000 });
    const run = createTestRun(store, agent);

    await guard.runWatchdogTick();

    const same = store.runs.get(run.id);
    assert.ok(same);
    assert.equal(same.status, 'RUNNING');
    assert.ok(same.active_duration_ms >= 0);
  });

  it('trips the stuck-loop breaker on 3 identical failing tool calls', async () => {
    const store = newTestStore();
    const guard = new HealthAndQuotaGuard({ store });
    const agent = await createTestAgent(store);
    const run = createTestRun(store, agent);
    for (let i = 0; i < 3; i += 1) {
      store.addInferenceStep({
        run_id: run.id,
        step_type: 'TOOL_CALL',
        model_used: 'meta_muse:muse-spark-1.3',
        thinking_text: null,
        message_text: null,
        tool_name: 'read_file',
        tool_args_json: { path: 'missing.txt' },
        tool_output_json: { error: 'ENOENT' },
        duration_ms: 5,
        tokens_in: 10,
        tokens_cached: 0,
        tokens_thinking: 0,
        tokens_out: 5,
        cost_usd: 0,
      });
    }

    await guard.runWatchdogTick();

    assert.equal(store.runs.get(run.id)?.status, 'UNHEALTHY_LOOP');
    const updated = store.getAgent(agent.id);
    assert.ok(updated);
    assert.equal(updated.status, 'UNHEALTHY_LOOP');
    assert.equal(updated.health_status, 'STUCK_LOOP');
  });

  it('does not trip the breaker when the repeat run includes a success', async () => {
    const store = newTestStore();
    const guard = new HealthAndQuotaGuard({ store });
    const agent = await createTestAgent(store);
    const run = createTestRun(store, agent);
    const outputs = [{ error: 'ENOENT' }, { ok: true }, { error: 'ENOENT' }];
    for (const tool_output_json of outputs) {
      store.addInferenceStep({
        run_id: run.id,
        step_type: 'TOOL_CALL',
        model_used: 'meta_muse:muse-spark-1.3',
        thinking_text: null,
        message_text: null,
        tool_name: 'read_file',
        tool_args_json: { path: 'missing.txt' },
        tool_output_json,
        duration_ms: 5,
        tokens_in: 10,
        tokens_cached: 0,
        tokens_thinking: 0,
        tokens_out: 5,
        cost_usd: 0,
      });
    }

    await guard.runWatchdogTick();

    assert.equal(store.runs.get(run.id)?.status, 'RUNNING');
  });

  it('pauses runs at the token cap and raises an approval gate', async () => {
    const store = newTestStore();
    const guard = new HealthAndQuotaGuard({ store });
    const agent = await createTestAgent(store, { max_tokens_per_run: 1000 });
    const run = createTestRun(store, agent);
    store.updateRun(run.id, {
      tokens_in: 600,
      tokens_thinking: 300,
      tokens_out: 200,
    });

    await guard.runWatchdogTick();

    assert.equal(store.runs.get(run.id)?.status, 'PAUSED_TOKEN_CAP');
    assert.equal(store.getAgent(agent.id)?.status, 'PAUSED_TOKEN_CAP');
    const gates = [...store.approvalGates.values()].filter(
      (g) => g.gate_type === 'TOKEN_CAP_EXCEEDED' && g.run_id === run.id
    );
    assert.equal(gates.length, 1);
  });

  it('enforces the anti-fork-bomb spawn caps', async () => {
    const store = newTestStore();
    const guard = new HealthAndQuotaGuard({ store });

    const worker = await createTestAgent(store, { hierarchy_level: 3 });
    const workerRun = createTestRun(store, worker);
    const depth = guard.canSpawnSubagent(worker, workerRun);
    assert.equal(depth.allowed, false);

    const capped = await createTestAgent(store, {
      hierarchy_level: 1,
      max_subagents: 1,
    });
    await store.updateAgent(capped.id, { active_subagent_count: 1 });
    const cappedRun = createTestRun(store, capped);
    const cappedAgent = store.getAgent(capped.id);
    assert.ok(cappedAgent);
    assert.equal(guard.canSpawnSubagent(cappedAgent, cappedRun).allowed, false);

    const spawner = await createTestAgent(store, { hierarchy_level: 1 });
    const spawnRun = createTestRun(store, spawner);
    for (let i = 0; i < 12; i += 1) {
      store.addInferenceStep({
        run_id: spawnRun.id,
        step_type: 'SUBAGENT_CALL',
        model_used: 'meta_muse:muse-spark-1.3',
        thinking_text: null,
        message_text: `delegate ${i}`,
        tool_name: null,
        tool_args_json: null,
        tool_output_json: null,
        duration_ms: 1,
        tokens_in: 1,
        tokens_cached: 0,
        tokens_thinking: 0,
        tokens_out: 1,
        cost_usd: 0,
      });
    }
    assert.equal(guard.canSpawnSubagent(spawner, spawnRun).allowed, false);

    const free = await createTestAgent(store, { hierarchy_level: 1 });
    const freeRun = createTestRun(store, free);
    assert.equal(guard.canSpawnSubagent(free, freeRun).allowed, true);
  });

  it('flags zombies on silence and terminates them past 5 minutes', async () => {
    const store = newTestStore();
    const guard = new HealthAndQuotaGuard({ store });

    const quiet = await createTestAgent(store);
    const quietRun = createTestRun(store, quiet);
    await store.updateAgent(quiet.id, {
      status: 'WORKING',
      current_run_id: quietRun.id,
      last_heartbeat_at: minutesAgo(4),
    });

    const dead = await createTestAgent(store);
    const deadRun = createTestRun(store, dead);
    await store.updateAgent(dead.id, {
      status: 'WORKING',
      current_run_id: deadRun.id,
      last_heartbeat_at: minutesAgo(6),
    });

    await guard.runWatchdogTick();

    const quietAfter = store.getAgent(quiet.id);
    assert.ok(quietAfter);
    assert.equal(quietAfter.health_status, 'ZOMBIE_NO_HEARTBEAT');
    assert.equal(quietAfter.status, 'WORKING');
    assert.equal(store.runs.get(quietRun.id)?.status, 'RUNNING');

    const deadAfter = store.getAgent(dead.id);
    assert.ok(deadAfter);
    assert.equal(deadAfter.health_status, 'ZOMBIE_NO_HEARTBEAT');
    assert.equal(deadAfter.status, 'IDLE');
    assert.equal(deadAfter.current_run_id, null);
    assert.equal(store.runs.get(deadRun.id)?.status, 'FAILED');
  });

  it('reports telemetry consistent with store state', async () => {
    const store = newTestStore();
    const guard = new HealthAndQuotaGuard({ store });
    const agent = await createTestAgent(store);
    createTestRun(store, agent);

    const telemetry = await guard.runWatchdogTick();

    assert.equal(telemetry.activeRunsCount, 1);
    assert.equal(telemetry.overallStatus, 'HEALTHY');
    assert.equal(telemetry.zombieAgentsCount, 0);
    assert.ok(telemetry.timestamp);
  });
});
