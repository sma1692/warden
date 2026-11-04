import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestAgent,
  createTestRun,
  newTestStore,
} from './helpers.js';

describe('OrchestratorStore', () => {
  it('seeds the executive roster on construction', () => {
    const store = newTestStore();

    assert.equal(store.getAgent('warden')?.slug, '@warden');
    assert.equal(store.getAgent('@cto')?.slug, '@cto');
    assert.equal(store.getAgent('cto')?.id, 'cto');
    assert.ok(store.getAllAgents().length >= 3);
  });

  it('round-trips agents and resolves id, slug, and bare names', async () => {
    const store = newTestStore();
    const agent = await createTestAgent(store);

    assert.equal(store.getAgent(agent.id)?.slug, agent.slug);
    assert.equal(store.getAgent(agent.slug)?.id, agent.id);
    assert.equal(store.getAgent(agent.slug.slice(1))?.id, agent.id);
    assert.equal(store.getAgent('@no_such_agent'), undefined);
  });

  it('auto-registers unknown role slugs and rejects malformed ones', async () => {
    const store = newTestStore();

    const existing = await store.ensureAgentBySlug('@cto');
    assert.equal(existing?.id, 'cto');

    const registered = await store.ensureAgentBySlug('@test_lead:demogame');
    assert.ok(registered);
    assert.equal(registered.slug, '@test_lead:demogame');
    assert.equal(store.getAgent('@test_lead:demogame')?.id, registered.id);

    assert.equal(await store.ensureAgentBySlug('@@bogus!!'), undefined);
  });

  it('round-trips runs and assigns 1-based step indexes', async () => {
    const store = newTestStore();
    const agent = await createTestAgent(store);
    const run = createTestRun(store, agent);

    assert.ok(run.id);
    assert.equal(run.status, 'RUNNING');
    assert.equal(run.tokens_in, 0);

    const updated = store.updateRun(run.id, { status: 'COMPLETED' });
    assert.equal(updated?.status, 'COMPLETED');
    assert.equal(store.updateRun('run_missing', { status: 'FAILED' }), undefined);

    for (let i = 0; i < 2; i += 1) {
      store.addInferenceStep({
        run_id: run.id,
        step_type: 'LLM_INFERENCE',
        model_used: 'meta_muse:muse-spark-1.3',
        thinking_text: null,
        message_text: `step ${i}`,
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
    const steps = store.getStepsForRun(run.id);
    assert.equal(steps.length, 2);
    assert.deepEqual(
      steps.map((s) => s.step_index),
      [1, 2]
    );
  });

  it('creates approval gates as PENDING and indexes them', async () => {
    const store = newTestStore();
    const agent = await createTestAgent(store);
    const run = createTestRun(store, agent);

    const gate = store.createApprovalGate({
      run_id: run.id,
      thread_id: null,
      agent_id: agent.id,
      department: agent.department,
      project_scope: agent.project_scope,
      gate_type: 'TOKEN_CAP_EXCEEDED',
      prompt_text: 'approve more tokens?',
      options_json: { choices: ['YES', 'NO'] },
      telegram_notified_at: null,
    });

    assert.equal(gate.status, 'PENDING');
    assert.equal(store.approvalGates.get(gate.id)?.run_id, run.id);
  });
});
