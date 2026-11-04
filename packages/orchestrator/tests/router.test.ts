import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HierarchyRouter } from '../src/engine/HierarchyRouter.js';
import type { AgentRunner } from '../src/engine/AgentRunner.js';
import { newTestStore } from './helpers.js';

function newTestRouter() {
  const store = newTestStore();
  // parseDirectMention / beginRouteMessage never touch the runner (it is only
  // used by routeMessage's delegation passes), so a stub is honest here.
  const router = new HierarchyRouter({
    store,
    agentRunner: {} as AgentRunner,
  });
  return { store, router };
}

describe('HierarchyRouter', () => {
  it('routes plain text to warden in executive mode', async () => {
    const { router } = newTestRouter();

    const parsed = await router.parseDirectMention('ship the trophy art set');

    assert.equal(parsed.isDirect, false);
    assert.equal(parsed.targetAgent.id, 'warden');
    assert.equal(parsed.cleanPrompt, 'ship the trophy art set');
  });

  it('treats an explicit @warden mention as executive mode', async () => {
    const { router } = newTestRouter();

    const parsed = await router.parseDirectMention('@warden status update');

    assert.equal(parsed.isDirect, false);
    assert.equal(parsed.targetAgent.id, 'warden');
  });

  it('routes single-role mentions to the seeded agent', async () => {
    const { router } = newTestRouter();

    const parsed = await router.parseDirectMention('@cto review the plan');

    assert.equal(parsed.isDirect, true);
    assert.equal(parsed.targetAgent.slug, '@cto');
    assert.equal(parsed.cleanPrompt, 'review the plan');
  });

  it('routes colon-form project mentions, auto-registering unknown roles', async () => {
    const { store, router } = newTestRouter();

    const parsed = await router.parseDirectMention(
      '@tech_lead:demogame fix the login bug'
    );

    assert.equal(parsed.isDirect, true);
    assert.equal(parsed.targetAgent.slug, '@tech_lead:demogame');
    assert.equal(parsed.cleanPrompt, 'fix the login bug');
    assert.equal(store.getAgent('@tech_lead:demogame')?.slug, '@tech_lead:demogame');
  });

  it('routes space-form project mentions', async () => {
    const { router } = newTestRouter();

    const parsed = await router.parseDirectMention('@pm demogame triage the inbox');

    assert.equal(parsed.isDirect, true);
    assert.equal(parsed.targetAgent.slug, '@pm:demogame');
    assert.equal(parsed.cleanPrompt, 'triage the inbox');
  });

  it('never auto-registers raw agent_* ids from explicit targets', async () => {
    const { store, router } = newTestRouter();

    const parsed = await router.parseDirectMention(
      'hello',
      'agent_no_such_agent',
      'WARDEN_EXECUTIVE'
    );

    assert.equal(parsed.isDirect, false);
    assert.equal(store.getAgent('agent_no_such_agent'), undefined);
  });

  it('beginRouteMessage creates the thread, CEO message, and root run', async () => {
    const { store, router } = newTestRouter();

    const result = await router.beginRouteMessage({
      threadId: 'thr_smoke_exec',
      content: 'hello warden',
    });

    assert.equal(result.thread.id, 'thr_smoke_exec');
    assert.equal(result.isDirect, false);
    assert.equal(result.targetAgent.id, 'warden');
    assert.equal(result.userMessage.sender_type, 'CEO');
    assert.equal(result.userMessage.content, 'hello warden');
    assert.equal(result.rootRun.status, 'RUNNING');
    assert.equal(result.rootRun.trigger_type, 'CEO_CHAT');
    assert.equal(result.rootRun.chat_thread_id, 'thr_smoke_exec');
    assert.ok(store.threads.get('thr_smoke_exec'));
  });

  it('beginRouteMessage marks direct mentions as DIRECT_MENTION runs', async () => {
    const { router } = newTestRouter();

    const result = await router.beginRouteMessage({
      threadId: 'thr_smoke_direct',
      content: '@cto review the plan',
    });

    assert.equal(result.isDirect, true);
    assert.equal(result.targetAgent.slug, '@cto');
    assert.equal(result.rootRun.trigger_type, 'DIRECT_MENTION');
    assert.equal(result.rootRun.agent_id, result.targetAgent.id);
  });
});
