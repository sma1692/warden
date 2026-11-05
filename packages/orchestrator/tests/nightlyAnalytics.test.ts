import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sendGa4Events,
  sendGa4Event,
  getGa4DailyTrafficSummary,
  forwardPromptEvent,
  forwardAgentSpawnEvent,
  forwardTokenSpendEvent,
} from '../src/analytics/ga4.js';
import {
  renderNightlyAnalyticsEmailHtml,
  sendSesEmail,
} from '../src/cron/sesSender.js';
import {
  collectNightlyMetrics,
  runNightlyAnalytics,
  scheduleNightlyAnalyticsCron,
  NIGHTLY_CRON_EXPRESSION,
  CRON_TIMEZONE,
} from '../src/cron/nightlyAnalytics.js';

describe('GA4 Measurement Protocol & Telemetry', () => {
  it('handles event formatting and returns graceful result when credentials are unset', async () => {
    const res = await sendGa4Event('test_event', { key: 'value', number: 42 });
    assert.equal(res.ok, true);
    assert.equal(typeof res.forwarded, 'boolean');
  });

  it('forwards specialized agent lifecycle and token events cleanly', async () => {
    const promptRes = await forwardPromptEvent({
      threadId: 't-123',
      agentId: 'a-cto',
      promptLength: 150,
      model: 'meta-muse',
    });
    assert.equal(promptRes.ok, true);

    const spawnRes = await forwardAgentSpawnEvent({
      agentId: 'a-backend-dev',
      department: 'tech',
      hierarchyLevel: 2,
    });
    assert.equal(spawnRes.ok, true);

    const tokenRes = await forwardTokenSpendEvent({
      tokensIn: 1000,
      tokensOut: 250,
      costUsd: 0.05,
    });
    assert.equal(tokenRes.ok, true);
  });

  it('retrieves GA4 daily traffic summary with expected keys and structure', async () => {
    const traffic = await getGa4DailyTrafficSummary();
    assert.ok(traffic.activeUsers > 0);
    assert.ok(traffic.sessions > 0);
    assert.ok(traffic.pageViews > 0);
    assert.ok(Array.isArray(traffic.topSources));
    assert.ok(Array.isArray(traffic.topPages));
    assert.ok(traffic.topSources.length > 0);
  });
});

describe('Nightly Analytics Brief & SES Sender', () => {
  it('collects all required metrics categories', async () => {
    const metrics = await collectNightlyMetrics();

    // Verify all 6 mandatory categories from spec
    assert.ok(metrics.users.totalRegistered > 0, 'Users category must be populated');
    assert.ok(metrics.users.dau > 0, 'DAU must be populated');
    assert.ok(metrics.conversations.totalPromptsToday > 0, 'Conversations category must be populated');
    assert.ok(metrics.agents.totalAgents > 0, 'Agents category must be populated');
    assert.ok(metrics.tokenSpend.costUsdToday >= 0, 'Token Spend category must be populated');
    assert.ok(metrics.ga4Traffic.activeUsers > 0, 'GA4 Traffic category must be populated');
    assert.ok(metrics.infraHealth.postgresStatus, 'Infra Health category must be populated');
  });

  it('renders branded HTML email containing all 6 required sections', async () => {
    const metrics = await collectNightlyMetrics();
    const html = renderNightlyAnalyticsEmailHtml(metrics);

    assert.ok(html.includes('WARDEN AUTOMATONS'), 'Email must contain Warden branding');
    assert.ok(html.includes('Users &amp; Retention'), 'Must contain Users & Retention section');
    assert.ok(html.includes('Conversations &amp; Prompts'), 'Must contain Conversations & Prompts section');
    assert.ok(html.includes('Agents Spawned'), 'Must contain Agents Spawned section');
    assert.ok(html.includes('Token Spend'), 'Must contain Token Spend section');
    assert.ok(html.includes('GA4 Traffic'), 'Must contain GA4 Traffic section');
    assert.ok(html.includes('Infrastructure Health'), 'Must contain Infra Health section');
  });

  it('executes SES sender in dry-run mode without external network calls', async () => {
    const res = await sendSesEmail({
      to: 'owner@warden.autos',
      subject: 'Test Subject',
      htmlBody: '<h1>Test Body</h1>',
      dryRun: true,
    });

    assert.equal(res.ok, true);
    assert.equal(res.dryRun, true);
    assert.equal(res.transport, 'console_preview');
  });

  it('executes runNightlyAnalytics in dry-run mode end-to-end', async () => {
    const { ok, metrics, sesResult } = await runNightlyAnalytics({ dryRun: true });
    assert.equal(ok, true);
    assert.equal(sesResult.dryRun, true);
    assert.ok(metrics.date);
    assert.ok(metrics.generatedAtIst);
  });

  it('verifies 12:00 AM IST cron schedule calculation', () => {
    assert.equal(NIGHTLY_CRON_EXPRESSION, '0 0 * * *');
    assert.equal(CRON_TIMEZONE, 'Asia/Kolkata');

    const cronHandle = scheduleNightlyAnalyticsCron({ dryRun: true });
    const nextRun = cronHandle.getNextRun();
    assert.ok(nextRun instanceof Date);
    assert.ok(nextRun.getTime() > Date.now());
    cronHandle.stop();
  });
});
