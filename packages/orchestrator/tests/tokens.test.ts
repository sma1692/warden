import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TokenCapExceededError,
  TokenTracker,
  calculateCostUsd,
  estimateTokens,
  getModelPricing,
  truncateToTokenLimit,
} from '../src/models/TokenTracker.js';

describe('TokenTracker utilities', () => {
  it('estimates zero for empty text and grows with length', () => {
    assert.equal(estimateTokens(''), 0);
    assert.ok(estimateTokens('hello') >= 1);
    const short = estimateTokens('hello world');
    const long = estimateTokens(`hello world\n`.repeat(200));
    assert.ok(long > short);
  });

  it('leaves short text untouched and brackets long output', () => {
    const short = 'all systems nominal';
    assert.equal(truncateToTokenLimit(short, 100), short);

    const head = 'HEAD-MARKER\n';
    const tail = '\nTAIL-MARKER';
    const body = `${head}${'log line with enough words to burn tokens\n'.repeat(400)}${tail}`;
    const cut = truncateToTokenLimit(body, 100);
    assert.ok(cut.includes('TRUNCATED BY TOKEN GUARDRAIL'));
    assert.ok(cut.startsWith('HEAD-MARKER'));
    assert.ok(cut.endsWith('TAIL-MARKER'));
    assert.ok(estimateTokens(cut) < estimateTokens(body));
  });

  it('falls back to Spark pricing for unknown models', () => {
    const spark = getModelPricing('muse-spark-1.3');
    assert.deepEqual(getModelPricing('some-future-model-9'), spark);
  });

  it('prices usage from the model spec with cached-input discount', () => {
    const pricing = getModelPricing('muse-spark-1.3');
    const usage = {
      tokens_in: 10_000,
      tokens_cached: 4_000,
      tokens_thinking: 1_000,
      tokens_out: 2_000,
    };
    const expected = Number(
      (
        ((6000 / 1_000_000) * pricing.inputPer1M +
          (4000 / 1_000_000) * pricing.cachedInputPer1M +
          (1000 / 1_000_000) * pricing.thinkingPer1M +
          (2000 / 1_000_000) * pricing.outputPer1M)
      ).toFixed(6)
    );
    assert.equal(calculateCostUsd('muse-spark-1.3', usage), expected);
    assert.equal(
      calculateCostUsd('muse-spark-1.3', { tokens_in: 0, tokens_out: 0 }),
      0
    );
  });

  it('tracks run budgets with warn / exceed / throw transitions', () => {
    const tracker = new TokenTracker(1000);

    const warn = tracker.recordStepUsage({
      runId: 'run_warn',
      modelId: 'muse-spark-1.3',
      tokens_in: 850,
      tokens_out: 0,
    });
    assert.equal(warn.status, 'WARNING_80_PCT');
    assert.equal(warn.signal, null);

    let callbackFired = 0;
    tracker.onTokenCapExceeded(() => {
      callbackFired += 1;
    });
    const exceeded = tracker.recordStepUsage({
      runId: 'run_over',
      modelId: 'muse-spark-1.3',
      tokens_in: 900,
      tokens_thinking: 100,
      tokens_out: 50,
    });
    assert.equal(exceeded.status, 'TOKEN_CAP_EXCEEDED');
    assert.equal(exceeded.signal, 'TOKEN_CAP_EXCEEDED');
    assert.equal(exceeded.totalTokensUsed, 1050);
    assert.equal(callbackFired, 1);

    assert.throws(
      () =>
        tracker.recordStepUsage({
          runId: 'run_throw',
          modelId: 'muse-spark-1.3',
          tokens_in: 2000,
          tokens_out: 0,
          throwOnExceed: true,
        }),
      TokenCapExceededError
    );

    assert.equal(tracker.checkBudget('run_never_seen').status, 'OK');
    const telemetry = tracker.getRunTelemetry('run_over');
    assert.ok(telemetry);
    assert.equal(telemetry.steps, 1);
  });
});
