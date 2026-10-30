/**
 * DYNAMO COMMANDO — Full-Spectrum Token Telemetry & Budget Guardrail Engine
 * (`dynamocommando.md` Section 4.7)
 *
 * Tracks:
 * - `tokens_in` (fresh prompt/input tokens)
 * - `tokens_cached` (Vertex AI Context Cache hits — up to 90% faster TTFT & 75% cheaper)
 * - `tokens_thinking` (Argon High / Gemini 2.5 Pro internal reasoning tokens)
 * - `tokens_out` (completion / code output tokens)
 * - `tokens_per_sec` (live streaming generation throughput)
 * - `cost_usd` (theoretical USD cost calculated against per-1M-token pricing tables)
 *
 * Enforces:
 * - `max_tokens_per_run` (default 1,000,000 tokens) -> signals `TOKEN_CAP_EXCEEDED`
 * - `truncateToTokenLimit(text, 8000)` -> prevents quadratic context explosion from large tool outputs
 */

export type TokenBudgetStatus = 'OK' | 'WARNING_80_PCT' | 'TOKEN_CAP_EXCEEDED';

export interface TokenUsage {
  tokens_in: number;
  tokens_cached: number;
  tokens_thinking: number;
  tokens_out: number;
  tokens_per_sec: number;
  cost_usd: number;
  duration_ms?: number;
  model_id?: string;
}

export interface ModelPricingSpec {
  /** USD per 1,000,000 fresh prompt tokens */
  inputPer1M: number;
  /** USD per 1,000,000 cached context tokens */
  cachedInputPer1M: number;
  /** USD per 1,000,000 internal reasoning/thinking tokens */
  thinkingPer1M: number;
  /** USD per 1,000,000 completion output tokens */
  outputPer1M: number;
}

/**
 * Standard per-1M-token pricing table (in USD) for unit-economics telemetry
 * across Vertex AI, Meta Muse, Anthropic, OpenAI, Ollama, and HuggingFace / vLLM models.
 */
export const MODEL_PRICING_TABLE: Record<string, ModelPricingSpec> = {
  // 1. Google Cloud Vertex AI / Gemini Models
  'gemini-3.1-pro-preview': {
    inputPer1M: 1.25,
    cachedInputPer1M: 0.3125,
    thinkingPer1M: 3.75,
    outputPer1M: 10.0,
  },
  'gemini-3.1-pro-argon-high': {
    inputPer1M: 1.25,
    cachedInputPer1M: 0.3125,
    thinkingPer1M: 3.75,
    outputPer1M: 10.0,
  },
  'gemini-3-flash-preview': {
    inputPer1M: 0.15,
    cachedInputPer1M: 0.0375,
    thinkingPer1M: 0.6,
    outputPer1M: 0.6,
  },
  'gemini-3.8-flash': {
    inputPer1M: 0.15,
    cachedInputPer1M: 0.0375,
    thinkingPer1M: 0.6,
    outputPer1M: 0.6,
  },
  'gemini-2.5-pro': {
    inputPer1M: 1.25,
    cachedInputPer1M: 0.3125,
    thinkingPer1M: 3.75,
    outputPer1M: 10.0,
  },
  'gemini-2.0-flash': {
    inputPer1M: 0.15,
    cachedInputPer1M: 0.0375,
    thinkingPer1M: 0.6,
    outputPer1M: 0.6,
  },
  'gemini-2.0-flash-lite': {
    inputPer1M: 0.1,
    cachedInputPer1M: 0.025,
    thinkingPer1M: 0.4,
    outputPer1M: 0.4,
  },
  'text-embedding-005': {
    inputPer1M: 0.025,
    cachedInputPer1M: 0.0,
    thinkingPer1M: 0.0,
    outputPer1M: 0.0,
  },

  // 2. Meta Muse Portfolio (`https://api.meta.ai/v1` + Self-Hosted Glimmer)
  'muse-wonder-1.0': {
    inputPer1M: 1.0,
    cachedInputPer1M: 0.25,
    thinkingPer1M: 3.0,
    outputPer1M: 4.0,
  },
  'muse-spark-1.3': {
    inputPer1M: 0.2,
    cachedInputPer1M: 0.05,
    thinkingPer1M: 0.4,
    outputPer1M: 0.8,
  },
  'muse-glimmer-30b': {
    inputPer1M: 0.12,
    cachedInputPer1M: 0.03,
    thinkingPer1M: 0.12,
    outputPer1M: 0.25,
  },
  'muse-image': {
    inputPer1M: 0.8,
    cachedInputPer1M: 0.2,
    thinkingPer1M: 0.0,
    outputPer1M: 2.4,
  },
  'muse-voice': {
    inputPer1M: 0.5,
    cachedInputPer1M: 0.125,
    thinkingPer1M: 0.0,
    outputPer1M: 1.5,
  },

  // 3. Anthropic Claude Models (`https://api.anthropic.com/v1/messages`)
  'claude-sonnet-4-20250514': {
    inputPer1M: 3.0,
    cachedInputPer1M: 0.3,
    thinkingPer1M: 15.0,
    outputPer1M: 15.0,
  },
  'claude-3-7-sonnet-latest': {
    inputPer1M: 3.0,
    cachedInputPer1M: 0.3,
    thinkingPer1M: 15.0,
    outputPer1M: 15.0,
  },
  'claude-opus-4-20250514': {
    inputPer1M: 15.0,
    cachedInputPer1M: 1.5,
    thinkingPer1M: 75.0,
    outputPer1M: 75.0,
  },
  'claude-3-5-haiku-latest': {
    inputPer1M: 0.8,
    cachedInputPer1M: 0.08,
    thinkingPer1M: 4.0,
    outputPer1M: 4.0,
  },

  // 4. OpenAI Models (`https://api.openai.com/v1/chat/completions`)
  'gpt-4.1': {
    inputPer1M: 2.0,
    cachedInputPer1M: 0.5,
    thinkingPer1M: 8.0,
    outputPer1M: 8.0,
  },
  'gpt-4.1-mini': {
    inputPer1M: 0.4,
    cachedInputPer1M: 0.1,
    thinkingPer1M: 1.6,
    outputPer1M: 1.6,
  },
  'o3': {
    inputPer1M: 2.0,
    cachedInputPer1M: 0.5,
    thinkingPer1M: 8.0,
    outputPer1M: 8.0,
  },
  'o4-mini': {
    inputPer1M: 1.1,
    cachedInputPer1M: 0.275,
    thinkingPer1M: 4.4,
    outputPer1M: 4.4,
  },

  // 5. Open-Weight Models on GCP GPU VM (Ollama / HuggingFace vLLM) — theoretical equivalent value
  'llama-3.3-70b': {
    inputPer1M: 0.6,
    cachedInputPer1M: 0.15,
    thinkingPer1M: 0.6,
    outputPer1M: 0.6,
  },
  'llama-3.3-70b-instruct': {
    inputPer1M: 0.6,
    cachedInputPer1M: 0.15,
    thinkingPer1M: 0.6,
    outputPer1M: 0.6,
  },
  'llama-4-maverick': {
    inputPer1M: 0.5,
    cachedInputPer1M: 0.125,
    thinkingPer1M: 0.5,
    outputPer1M: 0.75,
  },
  'qwen2.5-coder:32b': {
    inputPer1M: 0.3,
    cachedInputPer1M: 0.075,
    thinkingPer1M: 0.3,
    outputPer1M: 0.3,
  },
  'Qwen/Qwen2.5-Coder-32B-Instruct': {
    inputPer1M: 0.3,
    cachedInputPer1M: 0.075,
    thinkingPer1M: 0.3,
    outputPer1M: 0.3,
  },
  'deepseek-r1:70b': {
    inputPer1M: 0.55,
    cachedInputPer1M: 0.14,
    thinkingPer1M: 2.19,
    outputPer1M: 2.19,
  },
  'nomic-embed-text': {
    inputPer1M: 0.01,
    cachedInputPer1M: 0.0,
    thinkingPer1M: 0.0,
    outputPer1M: 0.0,
  },
  'bge-m3': {
    inputPer1M: 0.01,
    cachedInputPer1M: 0.0,
    thinkingPer1M: 0.0,
    outputPer1M: 0.0,
  },
};

export const DEFAULT_MAX_TOKENS_PER_RUN =
  Number(process.env.MAX_TOKENS_PER_RUN) > 0
    ? Number(process.env.MAX_TOKENS_PER_RUN)
    : 1_000_000;

export const DEFAULT_TOOL_OUTPUT_MAX_TOKENS = 8_000;

export class TokenCapExceededError extends Error {
  public readonly code = 'TOKEN_CAP_EXCEEDED' as const;
  public readonly runId: string;
  public readonly agentId?: string;
  public readonly totalTokensUsed: number;
  public readonly maxTokensPerRun: number;

  constructor(params: {
    runId: string;
    agentId?: string;
    totalTokensUsed: number;
    maxTokensPerRun: number;
  }) {
    super(
      `TOKEN_CAP_EXCEEDED: Run "${params.runId}"${params.agentId ? ` (${params.agentId})` : ''} consumed ${params.totalTokensUsed.toLocaleString()} tokens, exceeding the per-run cap of ${params.maxTokensPerRun.toLocaleString()} tokens.`
    );
    this.name = 'TokenCapExceededError';
    this.runId = params.runId;
    this.agentId = params.agentId;
    this.totalTokensUsed = params.totalTokensUsed;
    this.maxTokensPerRun = params.maxTokensPerRun;
  }
}

export interface RunTokenBudgetCheck {
  runId: string;
  agentId?: string;
  status: TokenBudgetStatus;
  signal: 'TOKEN_CAP_EXCEEDED' | null;
  totalTokensUsed: number;
  maxTokensPerRun: number;
  utilizationRatio: number;
  stepUsage: TokenUsage;
  cumulativeUsage: TokenUsage;
  message?: string;
}

export interface RunTelemetryRecord {
  runId: string;
  agentId?: string;
  modelId: string;
  steps: number;
  startedAt: string;
  updatedAt: string;
  maxTokensPerRun: number;
  status: TokenBudgetStatus;
  usage: TokenUsage;
}

export interface AgentTelemetryRecord {
  agentId: string;
  todayTokensUsed: number;
  totalTokensIn: number;
  totalTokensCached: number;
  totalTokensThinking: number;
  totalTokensOut: number;
  totalCostUsd: number;
  lastTokensPerSec: number;
  updatedAt: string;
}

/**
 * Estimates the number of LLM tokens in a string without requiring a native C++ tokenizer.
 * Combines character count (~3.8 chars/token for code/English) and word/symbol boundaries.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const charEstimate = Math.ceil(text.length / 3.8);
  const tokenSplits = text
    .trim()
    .split(/[\s,.;:!?()[\]{}"'`<>/\\+=*-]+/)
    .filter(Boolean).length;
  return Math.max(1, Math.round((charEstimate * 0.65) + (tokenSplits * 0.45)));
}

/**
 * Truncates tool outputs or file reads to a strict token ceiling (default 8,000 tokens)
 * to prevent accidental ingestion of `dist/`, `package-lock.json`, or massive logs.
 */
export function truncateToTokenLimit(
  text: string,
  maxTokens: number = DEFAULT_TOOL_OUTPUT_MAX_TOKENS
): string {
  if (!text) return '';
  const estimated = estimateTokens(text);
  if (estimated <= maxTokens) {
    return text;
  }

  // Approximate target character length (~3.7 chars per token)
  const targetChars = Math.max(120, Math.floor(maxTokens * 3.7));
  if (text.length <= targetChars) {
    return text;
  }

  // Keep 80% from the head and 20% from the tail so error summaries at the end of logs remain visible
  const headChars = Math.floor(targetChars * 0.8);
  const tailChars = Math.floor(targetChars * 0.2);

  const headSlice = text.slice(0, headChars);
  const tailSlice = text.slice(text.length - tailChars);

  // Align to nearest newline when possible for clean formatting
  const cleanHeadEnd = headSlice.lastIndexOf('\n');
  const cleanHead = cleanHeadEnd > headChars * 0.7 ? headSlice.slice(0, cleanHeadEnd) : headSlice;

  const cleanTailStart = tailSlice.indexOf('\n');
  const cleanTail =
    cleanTailStart !== -1 && cleanTailStart < tailChars * 0.3
      ? tailSlice.slice(cleanTailStart + 1)
      : tailSlice;

  return (
    `${cleanHead}\n\n` +
    `... [TRUNCATED BY TOKEN GUARDRAIL: Output was ~${estimated.toLocaleString()} tokens, capped at ${maxTokens.toLocaleString()} tokens] ...\n\n` +
    `${cleanTail}`
  );
}

/**
 * Resolves pricing spec for a given model ID (with prefix fallback for versioned model names).
 */
export function getModelPricing(modelId: string): ModelPricingSpec {
  const normalized = (modelId || 'gemini-2.0-flash').trim();
  if (MODEL_PRICING_TABLE[normalized]) {
    return MODEL_PRICING_TABLE[normalized];
  }

  const lower = normalized.toLowerCase();
  if (lower.includes('gemini-3.8')) {
    return MODEL_PRICING_TABLE['gemini-3.8-flash'];
  }
  if (lower.includes('gemini-2.5-pro') || lower.includes('argon')) {
    return MODEL_PRICING_TABLE['gemini-2.5-pro'];
  }
  if (lower.includes('gemini-2.0-flash') || lower.includes('gemini-2.0-flash')) {
    return MODEL_PRICING_TABLE['gemini-2.0-flash'];
  }
  if (lower.includes('embedding') || lower.includes('embed')) {
    return MODEL_PRICING_TABLE['text-embedding-005'];
  }
  if (lower.includes('muse-wonder')) {
    return MODEL_PRICING_TABLE['muse-wonder-1.0'];
  }
  if (lower.includes('muse-spark')) {
    return MODEL_PRICING_TABLE['muse-spark-1.3'];
  }
  if (lower.includes('muse-glimmer')) {
    return MODEL_PRICING_TABLE['muse-glimmer-30b'];
  }
  if (lower.includes('muse-image')) {
    return MODEL_PRICING_TABLE['muse-image'];
  }
  if (lower.includes('muse-voice')) {
    return MODEL_PRICING_TABLE['muse-voice'];
  }
  if (lower.includes('claude-opus')) {
    return MODEL_PRICING_TABLE['claude-opus-4-20250514'];
  }
  if (lower.includes('claude-3-5-haiku') || lower.includes('claude-haiku')) {
    return MODEL_PRICING_TABLE['claude-3-5-haiku-latest'];
  }
  if (lower.includes('claude')) {
    return MODEL_PRICING_TABLE['claude-sonnet-4-20250514'];
  }
  if (lower.includes('gpt-4.1-mini') || lower.includes('gpt-4o-mini')) {
    return MODEL_PRICING_TABLE['gpt-4.1-mini'];
  }
  if (lower.includes('gpt-4') || lower === 'o3') {
    return MODEL_PRICING_TABLE['gpt-4.1'];
  }
  if (lower.includes('o4-mini')) {
    return MODEL_PRICING_TABLE['o4-mini'];
  }
  if (lower.includes('llama-3.3') || lower.includes('llama3.3')) {
    return MODEL_PRICING_TABLE['llama-3.3-70b'];
  }
  if (lower.includes('llama-4') || lower.includes('llama4')) {
    return MODEL_PRICING_TABLE['llama-4-maverick'];
  }
  if (lower.includes('qwen')) {
    return MODEL_PRICING_TABLE['qwen2.5-coder:32b'];
  }
  if (lower.includes('deepseek')) {
    return MODEL_PRICING_TABLE['deepseek-r1:70b'];
  }

  // Default fallback to Gemini 2.5 Flash pricing
  return MODEL_PRICING_TABLE['gemini-2.0-flash'];
}

/**
 * Calculates theoretical USD cost for a single step or cumulative run.
 */
export function calculateCostUsd(
  modelId: string,
  usage: {
    tokens_in: number;
    tokens_cached?: number;
    tokens_thinking?: number;
    tokens_out: number;
  }
): number {
  const pricing = getModelPricing(modelId);
  const freshIn = Math.max(0, (usage.tokens_in || 0) - (usage.tokens_cached || 0));
  const cachedIn = Math.max(0, usage.tokens_cached || 0);
  const thinking = Math.max(0, usage.tokens_thinking || 0);
  const out = Math.max(0, usage.tokens_out || 0);

  const cost =
    (freshIn / 1_000_000) * pricing.inputPer1M +
    (cachedIn / 1_000_000) * pricing.cachedInputPer1M +
    (thinking / 1_000_000) * pricing.thinkingPer1M +
    (out / 1_000_000) * pricing.outputPer1M;

  return Number(cost.toFixed(6));
}

export interface RecordStepUsageInput {
  runId?: string;
  agentId?: string;
  modelId: string;
  tokens_in: number;
  tokens_cached?: number;
  tokens_thinking?: number;
  tokens_out: number;
  duration_ms?: number;
  max_tokens_per_run?: number;
  throwOnExceed?: boolean;
}

export class TokenTracker {
  private readonly runRecords = new Map<string, RunTelemetryRecord>();
  private readonly agentRecords = new Map<string, AgentTelemetryRecord>();
  private readonly defaultMaxTokensPerRun: number;
  private onBudgetExceededCallbacks: Array<(check: RunTokenBudgetCheck) => void> = [];

  constructor(defaultMaxTokensPerRun: number = DEFAULT_MAX_TOKENS_PER_RUN) {
    this.defaultMaxTokensPerRun = defaultMaxTokensPerRun;
  }

  /**
   * Registers a listener notified immediately whenever a run exceeds `max_tokens_per_run`.
   */
  public onTokenCapExceeded(callback: (check: RunTokenBudgetCheck) => void): void {
    this.onBudgetExceededCallbacks.push(callback);
  }

  /**
   * Records token telemetry for an LLM call or tool step and checks the run's token budget.
   */
  public recordStepUsage(input: RecordStepUsageInput): RunTokenBudgetCheck {
    const runId = input.runId || 'global-ephemeral-run';
    const modelId = input.modelId || 'gemini-2.0-flash';
    const maxTokensPerRun = input.max_tokens_per_run ?? this.defaultMaxTokensPerRun;

    const tokensIn = Math.max(0, Math.round(input.tokens_in || 0));
    const tokensCached = Math.max(0, Math.round(input.tokens_cached || 0));
    const tokensThinking = Math.max(0, Math.round(input.tokens_thinking || 0));
    const tokensOut = Math.max(0, Math.round(input.tokens_out || 0));
    const durationMs = Math.max(1, Math.round(input.duration_ms || 250));

    const generatedTokens = tokensOut + tokensThinking;
    const tokensPerSec = Number(((generatedTokens / durationMs) * 1000).toFixed(2));
    const stepCostUsd = calculateCostUsd(modelId, {
      tokens_in: tokensIn,
      tokens_cached: tokensCached,
      tokens_thinking: tokensThinking,
      tokens_out: tokensOut,
    });

    const stepUsage: TokenUsage = {
      tokens_in: tokensIn,
      tokens_cached: tokensCached,
      tokens_thinking: tokensThinking,
      tokens_out: tokensOut,
      tokens_per_sec: tokensPerSec,
      cost_usd: stepCostUsd,
      duration_ms: durationMs,
      model_id: modelId,
    };

    const nowIso = new Date().toISOString();
    let runRecord = this.runRecords.get(runId);

    if (!runRecord) {
      runRecord = {
        runId,
        agentId: input.agentId,
        modelId,
        steps: 0,
        startedAt: nowIso,
        updatedAt: nowIso,
        maxTokensPerRun,
        status: 'OK',
        usage: {
          tokens_in: 0,
          tokens_cached: 0,
          tokens_thinking: 0,
          tokens_out: 0,
          tokens_per_sec: 0,
          cost_usd: 0,
          duration_ms: 0,
          model_id: modelId,
        },
      };
      this.runRecords.set(runId, runRecord);
    }

    runRecord.steps += 1;
    runRecord.updatedAt = nowIso;
    if (input.agentId) {
      runRecord.agentId = input.agentId;
    }
    runRecord.modelId = modelId;
    runRecord.maxTokensPerRun = maxTokensPerRun;

    runRecord.usage.tokens_in += tokensIn;
    runRecord.usage.tokens_cached += tokensCached;
    runRecord.usage.tokens_thinking += tokensThinking;
    runRecord.usage.tokens_out += tokensOut;
    runRecord.usage.duration_ms = (runRecord.usage.duration_ms || 0) + durationMs;
    runRecord.usage.tokens_per_sec = tokensPerSec;
    runRecord.usage.cost_usd = Number((runRecord.usage.cost_usd + stepCostUsd).toFixed(6));

    // Update per-agent cumulative telemetry if agentId is provided
    if (input.agentId) {
      let agentRec = this.agentRecords.get(input.agentId);
      if (!agentRec) {
        agentRec = {
          agentId: input.agentId,
          todayTokensUsed: 0,
          totalTokensIn: 0,
          totalTokensCached: 0,
          totalTokensThinking: 0,
          totalTokensOut: 0,
          totalCostUsd: 0,
          lastTokensPerSec: 0,
          updatedAt: nowIso,
        };
        this.agentRecords.set(input.agentId, agentRec);
      }
      const stepTotal = tokensIn + tokensThinking + tokensOut;
      agentRec.todayTokensUsed += stepTotal;
      agentRec.totalTokensIn += tokensIn;
      agentRec.totalTokensCached += tokensCached;
      agentRec.totalTokensThinking += tokensThinking;
      agentRec.totalTokensOut += tokensOut;
      agentRec.totalCostUsd = Number((agentRec.totalCostUsd + stepCostUsd).toFixed(6));
      agentRec.lastTokensPerSec = tokensPerSec;
      agentRec.updatedAt = nowIso;
    }

    const totalTokensUsed =
      runRecord.usage.tokens_in +
      runRecord.usage.tokens_thinking +
      runRecord.usage.tokens_out;

    const utilizationRatio = Number((totalTokensUsed / maxTokensPerRun).toFixed(4));

    let status: TokenBudgetStatus = 'OK';
    let signal: 'TOKEN_CAP_EXCEEDED' | null = null;
    let message: string | undefined;

    if (totalTokensUsed > maxTokensPerRun) {
      status = 'TOKEN_CAP_EXCEEDED';
      signal = 'TOKEN_CAP_EXCEEDED';
      message = `TOKEN_CAP_EXCEEDED: Run "${runId}" used ${totalTokensUsed.toLocaleString()} tokens (limit: ${maxTokensPerRun.toLocaleString()}).`;
    } else if (utilizationRatio >= 0.8) {
      status = 'WARNING_80_PCT';
      message = `Run "${runId}" is at ${(utilizationRatio * 100).toFixed(1)}% of its ${maxTokensPerRun.toLocaleString()} token budget.`;
    }

    runRecord.status = status;

    const checkResult: RunTokenBudgetCheck = {
      runId,
      agentId: runRecord.agentId,
      status,
      signal,
      totalTokensUsed,
      maxTokensPerRun,
      utilizationRatio,
      stepUsage,
      cumulativeUsage: { ...runRecord.usage },
      message,
    };

    if (status === 'TOKEN_CAP_EXCEEDED') {
      for (const cb of this.onBudgetExceededCallbacks) {
        try {
          cb(checkResult);
        } catch {
          // Ignore callback errors
        }
      }
      if (input.throwOnExceed) {
        throw new TokenCapExceededError({
          runId,
          agentId: runRecord.agentId,
          totalTokensUsed,
          maxTokensPerRun,
        });
      }
    }

    return checkResult;
  }

  /**
   * Alias for `recordStepUsage`.
   */
  public recordUsage(input: RecordStepUsageInput): RunTokenBudgetCheck {
    return this.recordStepUsage(input);
  }

  /**
   * Checks whether a given `runId` is currently within its `max_tokens_per_run` budget.
   */
  public checkBudget(
    runId: string,
    maxTokensPerRun: number = this.defaultMaxTokensPerRun
  ): RunTokenBudgetCheck {
    const rec = this.runRecords.get(runId);
    if (!rec) {
      const emptyUsage: TokenUsage = {
        tokens_in: 0,
        tokens_cached: 0,
        tokens_thinking: 0,
        tokens_out: 0,
        tokens_per_sec: 0,
        cost_usd: 0,
      };
      return {
        runId,
        status: 'OK',
        signal: null,
        totalTokensUsed: 0,
        maxTokensPerRun,
        utilizationRatio: 0,
        stepUsage: emptyUsage,
        cumulativeUsage: emptyUsage,
      };
    }

    const totalTokensUsed =
      rec.usage.tokens_in + rec.usage.tokens_thinking + rec.usage.tokens_out;
    const cap = maxTokensPerRun || rec.maxTokensPerRun || this.defaultMaxTokensPerRun;
    const utilizationRatio = Number((totalTokensUsed / cap).toFixed(4));
    const exceeded = totalTokensUsed > cap;
    const status: TokenBudgetStatus = exceeded
      ? 'TOKEN_CAP_EXCEEDED'
      : utilizationRatio >= 0.8
        ? 'WARNING_80_PCT'
        : 'OK';

    return {
      runId,
      agentId: rec.agentId,
      status,
      signal: exceeded ? 'TOKEN_CAP_EXCEEDED' : null,
      totalTokensUsed,
      maxTokensPerRun: cap,
      utilizationRatio,
      stepUsage: { ...rec.usage },
      cumulativeUsage: { ...rec.usage },
      message: exceeded
        ? `TOKEN_CAP_EXCEEDED: Run "${runId}" used ${totalTokensUsed.toLocaleString()} / ${cap.toLocaleString()} tokens.`
        : undefined,
    };
  }

  public getRunTelemetry(runId: string): RunTelemetryRecord | null {
    const rec = this.runRecords.get(runId);
    return rec ? { ...rec, usage: { ...rec.usage } } : null;
  }

  public getAgentTelemetry(agentId: string): AgentTelemetryRecord | null {
    const rec = this.agentRecords.get(agentId);
    return rec ? { ...rec } : null;
  }

  public getAllRunsTelemetry(): RunTelemetryRecord[] {
    return Array.from(this.runRecords.values()).map((r) => ({
      ...r,
      usage: { ...r.usage },
    }));
  }

  public getAllAgentsTelemetry(): AgentTelemetryRecord[] {
    return Array.from(this.agentRecords.values()).map((a) => ({ ...a }));
  }

  public resetRun(runId: string): void {
    this.runRecords.delete(runId);
  }

  public estimateTokens(text: string): number {
    return estimateTokens(text);
  }

  public truncateToTokenLimit(
    text: string,
    maxTokens: number = DEFAULT_TOOL_OUTPUT_MAX_TOKENS
  ): string {
    return truncateToTokenLimit(text, maxTokens);
  }
}

export const tokenTracker = new TokenTracker();
export default tokenTracker;
