/**
 * DYNAMO COMMANDO — Automatic Context Compaction (`60K Token Threshold`) & Vertex AI Context Cache Manager
 * (`dynamocommando.md` Section 4.7)
 *
 * Responsibilities:
 * 1. Monitors cumulative conversation / turn context token volume.
 * 2. When total context tokens exceed `60,000`, compacts older conversation turns into a dense
 *    `<2,000`-token state checkpoint preserving:
 *    - Critical architectural & product decisions
 *    - File paths created, modified, or inspected
 *    - Build/test/runtime errors resolved
 *    - Pending acceptance criteria & next steps
 * 3. Keeps the most recent turns intact and archives compacted turns into `agent_memories` / `chat_messages`.
 * 4. Manages deterministic Vertex AI Context Cache keys & TTLs for `init_prompt` + `project_contexts`.
 */

import crypto from 'node:crypto';
import { estimateTokens, truncateToTokenLimit } from './TokenTracker.js';

export const COMPACTION_THRESHOLD_TOKENS = 60_000;
export const CHECKPOINT_MAX_TOKENS = 1_950; // Strictly < 2,000 tokens
export const DEFAULT_KEEP_RECENT_TURNS = 6;
export const DEFAULT_CONTEXT_CACHE_TTL_SECONDS = 3_600; // 1 hour TTL

export interface GeminiPartLike {
  text?: string;
  thought?: boolean;
  functionCall?: {
    name: string;
    args?: Record<string, unknown>;
  };
  functionResponse?: {
    name: string;
    response?: unknown;
  };
  fileData?: {
    mimeType: string;
    fileUri: string;
  };
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

export interface ConversationTurnLike {
  role: string;
  content?: string;
  parts?: GeminiPartLike[];
  tool_calls?: Array<{ id?: string; name?: string; function?: { name: string; arguments: string } }>;
  attachments?: unknown[];
  createdAt?: string;
}

export interface ArchivedCompactionRecord {
  id: string;
  agentId: string;
  runId?: string;
  threadId?: string;
  projectScope?: string;
  compactedTurnCount: number;
  originalTokens: number;
  checkpointTokens: number;
  checkpointMarkdown: string;
  rawTurnsJson: string;
  createdAt: string;
}

export interface CompactionResult<T extends ConversationTurnLike = ConversationTurnLike> {
  compacted: boolean;
  originalTokens: number;
  compactedTokens: number;
  tokensSaved: number;
  compactedTurnCount: number;
  keptTurnCount: number;
  checkpointSummary: string;
  turns: T[];
  archiveRecord?: ArchivedCompactionRecord;
}

export interface ContextCacheEntry {
  cacheKey: string;
  vertexCacheName: string;
  agentId: string;
  projectScope: string;
  modelId: string;
  contentHash: string;
  tokenCount: number;
  createdAt: number;
  expiresAt: number;
  ttlSeconds: number;
  systemInstruction: string;
  hitCount: number;
}

export type DbArchiveQueryFn = (
  sql: string,
  params?: unknown[]
) => Promise<{ rows?: unknown[] } | unknown>;

/**
 * Extracts readable text from either a Gemini-style `{ role, parts }` turn
 * or an OpenAI/standard `{ role, content }` chat message.
 */
export function serializeTurnToText(turn: ConversationTurnLike, index?: number): string {
  const prefix = index !== undefined ? `[Turn #${index + 1} | ${turn.role}]` : `[${turn.role}]`;
  const segments: string[] = [];

  if (typeof turn.content === 'string' && turn.content.trim()) {
    segments.push(turn.content.trim());
  }

  if (Array.isArray(turn.parts)) {
    for (const part of turn.parts) {
      if (part.text) {
        segments.push(part.thought ? `(Thought): ${part.text}` : part.text);
      }
      if (part.functionCall) {
        const argsPreview = JSON.stringify(part.functionCall.args ?? {}).slice(0, 400);
        segments.push(`ToolCall -> ${part.functionCall.name}(${argsPreview})`);
      }
      if (part.functionResponse) {
        const respPreview = JSON.stringify(part.functionResponse.response ?? {}).slice(0, 600);
        segments.push(`ToolResult <- ${part.functionResponse.name}: ${respPreview}`);
      }
      if (part.fileData) {
        segments.push(`Attachment [fileData: ${part.fileData.mimeType} -> ${part.fileData.fileUri}]`);
      }
      if (part.inlineData) {
        segments.push(`Attachment [inlineData: ${part.inlineData.mimeType}]`);
      }
    }
  }

  if (Array.isArray(turn.tool_calls)) {
    for (const tc of turn.tool_calls) {
      const fnName = tc.name || tc.function?.name || 'unknown_tool';
      const fnArgs = tc.function?.arguments ? tc.function.arguments.slice(0, 300) : '';
      segments.push(`ToolCall -> ${fnName}(${fnArgs})`);
    }
  }

  return `${prefix} ${segments.join('\n')}`;
}

/**
 * Computes total estimated tokens across a system instruction and an array of conversation turns.
 */
export function estimateConversationTokens(
  turns: ConversationTurnLike[],
  systemInstruction: string = ''
): number {
  let total = estimateTokens(systemInstruction);
  for (let i = 0; i < turns.length; i++) {
    total += estimateTokens(serializeTurnToText(turns[i], i));
  }
  return total;
}

/**
 * Deterministically extracts high-signal engineering state (decisions, file paths,
 * errors resolved, tool operations, and pending criteria) into a `<2,000`-token checkpoint.
 */
export function buildDeterministicStateCheckpoint(
  olderTurns: ConversationTurnLike[],
  meta: {
    agentId?: string;
    runId?: string;
    projectScope?: string;
    originalTokens: number;
  }
): string {
  const filePaths = new Set<string>();
  const decisions: string[] = [];
  const errorsAndFixes: string[] = [];
  const toolSummaries: string[] = [];
  const pendingCriteria: string[] = [];
  const keyExchanges: string[] = [];

  const filePathRegex =
    /(?:\/[\w.-]+)+\.(?:ts|tsx|js|mjs|cjs|json|sql|md|yaml|yml|css|html|py|sh|dockerfile)|(?:packages|src|scripts|context|memory|worklist|contracts|infra)\/[\w./-]+\.[\w]+/gi;

  for (let i = 0; i < olderTurns.length; i++) {
    const turn = olderTurns[i];
    const text = serializeTurnToText(turn, i);

    // 1. Extract all file paths referenced or modified
    const matches = text.match(filePathRegex);
    if (matches) {
      for (const m of matches) {
        if (filePaths.size < 40) {
          filePaths.add(m);
        }
      }
    }

    // 2. Inspect structured tool calls & responses
    if (Array.isArray(turn.parts)) {
      for (const part of turn.parts) {
        if (part.functionCall) {
          const args = part.functionCall.args || {};
          const pathArg =
            (args.filePath as string) ||
            (args.path as string) ||
            (args.dirPath as string) ||
            (args.cwd as string) ||
            '';
          if (pathArg) filePaths.add(pathArg);
          if (toolSummaries.length < 25) {
            toolSummaries.push(
              `\`${part.functionCall.name}\`${pathArg ? ` on \`${pathArg}\`` : ''}`
            );
          }
        }
        if (part.functionResponse) {
          const respStr = JSON.stringify(part.functionResponse.response || '');
          if (/error|failed|exception/i.test(respStr) && errorsAndFixes.length < 15) {
            errorsAndFixes.push(
              `Tool \`${part.functionResponse.name}\` reported: ${respStr.slice(0, 220)}`
            );
          }
        }
      }
    }

    // 3. Scan lines for architectural decisions, errors resolved, and pending acceptance criteria
    const lines = text.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.length < 12) continue;

      if (
        /\b(decision|architecture|contract|schema|endpoint|approved|locked|must|standard|invariant)\b/i.test(
          line
        ) &&
        decisions.length < 12
      ) {
        decisions.push(line.slice(0, 240));
      } else if (
        /\b(error|bug|fix|fixed|resolved|typecheck|playwright|failed|passed|issue)\b/i.test(
          line
        ) &&
        errorsAndFixes.length < 12
      ) {
        errorsAndFixes.push(line.slice(0, 240));
      } else if (
        /\b(todo|pending|remaining|next step|acceptance criteria|must verify|blocker)\b/i.test(
          line
        ) &&
        pendingCriteria.length < 12
      ) {
        pendingCriteria.push(line.slice(0, 240));
      }
    }

    // Keep brief head/tail snippet of user/CEO & model messages
    if (turn.role === 'user' || turn.role === 'model' || turn.role === 'assistant') {
      const cleanMsg = (turn.content || turn.parts?.map((p) => p.text || '').join(' ') || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleanMsg && keyExchanges.length < 10) {
        keyExchanges.push(`- **${turn.role}**: ${cleanMsg.slice(0, 220)}`);
      }
    }
  }

  const sections: string[] = [
    `### [📦 AUTO-COMPACTED STATE CHECKPOINT — ${olderTurns.length} Earlier Turns (~${meta.originalTokens.toLocaleString()} tokens)]`,
    `> **Agent**: \`${meta.agentId || 'unknown'}\` | **Scope**: \`${meta.projectScope || 'global'}\` | **Run**: \`${meta.runId || 'n/a'}\``,
    '',
    `#### 1. Key Architectural & Product Decisions`,
    decisions.length > 0
      ? decisions.map((d) => `- ${d}`).join('\n')
      : '- Maintained core architecture & deterministic SQL/pgvector contracts.',
    '',
    `#### 2. Files Inspected / Modified (${filePaths.size})`,
    filePaths.size > 0
      ? Array.from(filePaths)
          .map((fp) => `- \`${fp}\``)
          .join('\n')
      : '- No explicit file paths recorded in compacted window.',
    '',
    `#### 3. Tool Executions & Verification Events`,
    toolSummaries.length > 0
      ? `- Executed: ${Array.from(new Set(toolSummaries)).join(', ')}`
      : '- No tool calls in compacted window.',
    errorsAndFixes.length > 0
      ? errorsAndFixes.map((e) => `- ${e}`).join('\n')
      : '- Zero unresolved build/runtime errors in compacted window.',
    '',
    `#### 4. Pending Acceptance Criteria & Continuity`,
    pendingCriteria.length > 0
      ? pendingCriteria.map((p) => `- ${p}`).join('\n')
      : '- Proceed with active sprint / backlog acceptance criteria in recent turns below.',
    '',
    `#### 5. Condensed Turn Digest`,
    keyExchanges.length > 0 ? keyExchanges.join('\n') : '- Earlier turns compacted cleanly.',
  ];

  const rawCheckpoint = sections.join('\n');
  return truncateToTokenLimit(rawCheckpoint, CHECKPOINT_MAX_TOKENS);
}

export class ContextCompactor {
  private readonly thresholdTokens: number;
  private readonly checkpointMaxTokens: number;
  private readonly contextCaches = new Map<string, ContextCacheEntry>();
  private readonly archivedCheckpoints: ArchivedCompactionRecord[] = [];
  private dbQueryFn?: DbArchiveQueryFn;
  private embedFn?: (text: string) => Promise<number[]>;

  constructor(options?: {
    thresholdTokens?: number;
    checkpointMaxTokens?: number;
    dbQueryFn?: DbArchiveQueryFn;
    embedFn?: (text: string) => Promise<number[]>;
  }) {
    this.thresholdTokens = options?.thresholdTokens ?? COMPACTION_THRESHOLD_TOKENS;
    this.checkpointMaxTokens = options?.checkpointMaxTokens ?? CHECKPOINT_MAX_TOKENS;
    this.dbQueryFn = options?.dbQueryFn;
    this.embedFn = options?.embedFn;
  }

  /**
   * Configures optional PostgreSQL persistence and embedding generator for archiving
   * compacted turns directly into `agent_memories` and `chat_messages`.
   */
  public configurePersistence(params: {
    dbQueryFn?: DbArchiveQueryFn;
    embedFn?: (text: string) => Promise<number[]>;
  }): void {
    if (params.dbQueryFn) this.dbQueryFn = params.dbQueryFn;
    if (params.embedFn) this.embedFn = params.embedFn;
  }

  /**
   * Checks if the current conversation + system prompt exceeds the 60,000-token threshold.
   */
  public needsCompaction(
    turns: ConversationTurnLike[],
    systemInstruction: string = '',
    customThreshold?: number
  ): {
    needed: boolean;
    totalTokens: number;
    thresholdTokens: number;
  } {
    const threshold = customThreshold ?? this.thresholdTokens;
    const totalTokens = estimateConversationTokens(turns, systemInstruction);
    return {
      needed: totalTokens > threshold && turns.length > 2,
      totalTokens,
      thresholdTokens: threshold,
    };
  }

  /**
   * Compacts older conversation turns into a dense `<2,000`-token state checkpoint when
   * total context exceeds `thresholdTokens` (default `60,000`), keeping the most recent turns
   * intact and archiving the compacted history into `agent_memories` / `chat_messages`.
   */
  public async compactIfNeeded<T extends ConversationTurnLike>(params: {
    turns: T[];
    systemInstruction?: string;
    agentId?: string;
    runId?: string;
    threadId?: string;
    projectScope?: string;
    thresholdTokens?: number;
    keepRecentTurns?: number;
    force?: boolean;
    summarizer?: (textToSummarize: string) => Promise<string>;
    onArchive?: (record: ArchivedCompactionRecord) => Promise<void> | void;
  }): Promise<CompactionResult<T>> {
    const threshold = params.thresholdTokens ?? this.thresholdTokens;
    const systemInstruction = params.systemInstruction ?? '';
    const originalTokens = estimateConversationTokens(params.turns, systemInstruction);
    const keepRecent = Math.max(
      2,
      Math.min(params.keepRecentTurns ?? DEFAULT_KEEP_RECENT_TURNS, params.turns.length - 1)
    );

    if ((!params.force && originalTokens <= threshold) || params.turns.length <= 2) {
      return {
        compacted: false,
        originalTokens,
        compactedTokens: originalTokens,
        tokensSaved: 0,
        compactedTurnCount: 0,
        keptTurnCount: params.turns.length,
        checkpointSummary: '',
        turns: params.turns,
      };
    }

    const splitIndex = Math.max(1, params.turns.length - keepRecent);
    const olderTurns = params.turns.slice(0, splitIndex);
    const recentTurns = params.turns.slice(splitIndex);

    let checkpointSummary = '';
    if (params.summarizer) {
      try {
        const serializedOlder = olderTurns
          .map((t, idx) => serializeTurnToText(t, idx))
          .join('\n\n');
        const llmSummary = await params.summarizer(serializedOlder);
        if (llmSummary && llmSummary.trim()) {
          checkpointSummary = truncateToTokenLimit(
            `### [📦 AUTO-COMPACTED STATE CHECKPOINT — ${olderTurns.length} Earlier Turns]\n${llmSummary.trim()}`,
            this.checkpointMaxTokens
          );
        }
      } catch {
        // Fallback to deterministic state checkpoint extraction below
      }
    }

    if (!checkpointSummary) {
      checkpointSummary = buildDeterministicStateCheckpoint(olderTurns, {
        agentId: params.agentId,
        runId: params.runId,
        projectScope: params.projectScope,
        originalTokens,
      });
    }

    // Construct the synthetic checkpoint turn matching the caller's turn structure (Gemini parts vs standard content)
    const sampleTurn = params.turns[0];
    const usesGeminiParts = Array.isArray(sampleTurn?.parts);

    const checkpointTurn = (
      usesGeminiParts
        ? {
            role: 'user',
            parts: [{ text: checkpointSummary }],
          }
        : {
            role: 'system',
            content: checkpointSummary,
          }
    ) as unknown as T;

    const newTurns: T[] = [checkpointTurn, ...recentTurns];
    const compactedTokens = estimateConversationTokens(newTurns, systemInstruction);
    const checkpointTokens = estimateTokens(checkpointSummary);

    const archiveRecord: ArchivedCompactionRecord = {
      id: crypto.randomUUID(),
      agentId: params.agentId || '@warden',
      runId: params.runId,
      threadId: params.threadId,
      projectScope: params.projectScope,
      compactedTurnCount: olderTurns.length,
      originalTokens,
      checkpointTokens,
      checkpointMarkdown: checkpointSummary,
      rawTurnsJson: JSON.stringify(olderTurns),
      createdAt: new Date().toISOString(),
    };

    this.archivedCheckpoints.push(archiveRecord);

    // Trigger custom archive hook if provided
    if (params.onArchive) {
      await params.onArchive(archiveRecord);
    }

    // Persist compacted checkpoint into `agent_memories` / `chat_messages` if DB query executor is wired
    if (this.dbQueryFn) {
      await this.persistCompactionToDatabase(archiveRecord);
    }

    return {
      compacted: true,
      originalTokens,
      compactedTokens,
      tokensSaved: Math.max(0, originalTokens - compactedTokens),
      compactedTurnCount: olderTurns.length,
      keptTurnCount: recentTurns.length,
      checkpointSummary,
      turns: newTurns,
      archiveRecord,
    };
  }

  private async persistCompactionToDatabase(record: ArchivedCompactionRecord): Promise<void> {
    if (!this.dbQueryFn) return;
    try {
      let vectorLiteral: string | null = null;
      if (this.embedFn) {
        const vec = await this.embedFn(record.checkpointMarkdown);
        if (Array.isArray(vec) && vec.length === 768) {
          vectorLiteral = `[${vec.join(',')}]`;
        }
      }

      if (vectorLiteral) {
        await this.dbQueryFn(
          `INSERT INTO agent_memories (id, agent_id, project_scope, memory_type, content, source_run_id, is_pinned, embedding, created_at)
           VALUES ($1, $2, $3, 'EPISODIC_LESSON', $4, $5, false, $6::vector, NOW())
           ON CONFLICT (id) DO NOTHING`,
          [
            record.id,
            record.agentId,
            record.projectScope ?? null,
            record.checkpointMarkdown,
            record.runId ?? null,
            vectorLiteral,
          ]
        );
      } else {
        await this.dbQueryFn(
          `INSERT INTO agent_memories (id, agent_id, project_scope, memory_type, content, source_run_id, is_pinned, created_at)
           VALUES ($1, $2, $3, 'EPISODIC_LESSON', $4, $5, false, NOW())
           ON CONFLICT (id) DO NOTHING`,
          [
            record.id,
            record.agentId,
            record.projectScope ?? null,
            record.checkpointMarkdown,
            record.runId ?? null,
          ]
        );
      }

      if (record.threadId) {
        await this.dbQueryFn(
          `INSERT INTO chat_messages (id, thread_id, sender_type, sender_agent_id, content, run_id, attachments_json, created_at)
           VALUES ($1, $2, 'SYSTEM', $3, $4, $5, '[]'::jsonb, NOW())
           ON CONFLICT (id) DO NOTHING`,
          [
            crypto.randomUUID(),
            record.threadId,
            record.agentId,
            record.checkpointMarkdown,
            record.runId ?? null,
          ]
        );
      }
    } catch {
      // Non-fatal if DB table is not migrated yet in unit tests
    }
  }

  /**
   * Creates or retrieves a deterministic Vertex AI Context Cache entry for an agent's
   * `init_prompt` + `project_contexts` payload.
   */
  public getOrCreateContextCache(params: {
    agentId: string;
    projectScope?: string;
    systemInstruction: string;
    modelId?: string;
    ttlSeconds?: number;
  }): ContextCacheEntry {
    this.pruneExpiredCaches();

    const scope = params.projectScope || 'GLOBAL';
    const modelId = params.modelId || 'gemini-2.5-pro';
    const ttlSeconds = params.ttlSeconds ?? DEFAULT_CONTEXT_CACHE_TTL_SECONDS;
    const contentHash = crypto
      .createHash('sha256')
      .update(`${params.agentId}::${scope}::${modelId}::${params.systemInstruction}`)
      .digest('hex')
      .slice(0, 24);

    const cacheKey = `ctx_${params.agentId.replace(/^@/, '')}_${scope}_${contentHash}`;
    const now = Date.now();
    const existing = this.contextCaches.get(cacheKey);

    if (existing && existing.expiresAt > now) {
      existing.hitCount += 1;
      existing.expiresAt = now + ttlSeconds * 1000; // Sliding TTL refresh on hit
      return existing;
    }

    const project = process.env.GOOGLE_CLOUD_PROJECT || 'local';
    const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
    const vertexCacheName = `projects/${project}/locations/${location}/cachedContents/${cacheKey}`;

    const entry: ContextCacheEntry = {
      cacheKey,
      vertexCacheName,
      agentId: params.agentId,
      projectScope: scope,
      modelId,
      contentHash,
      tokenCount: estimateTokens(params.systemInstruction),
      createdAt: now,
      expiresAt: now + ttlSeconds * 1000,
      ttlSeconds,
      systemInstruction: params.systemInstruction,
      hitCount: 0,
    };

    this.contextCaches.set(cacheKey, entry);
    return entry;
  }

  public getCachedContext(cacheKey: string): ContextCacheEntry | null {
    const entry = this.contextCaches.get(cacheKey);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.contextCaches.delete(cacheKey);
      return null;
    }
    entry.hitCount += 1;
    return entry;
  }

  public invalidateAgentCache(agentId: string): number {
    let removed = 0;
    for (const [key, entry] of this.contextCaches.entries()) {
      if (entry.agentId === agentId) {
        this.contextCaches.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  public pruneExpiredCaches(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [key, entry] of this.contextCaches.entries()) {
      if (entry.expiresAt <= now) {
        this.contextCaches.delete(key);
        pruned += 1;
      }
    }
    return pruned;
  }

  public getCacheStats(): {
    activeCaches: number;
    totalCachedTokens: number;
    entries: ContextCacheEntry[];
  } {
    this.pruneExpiredCaches();
    const entries = Array.from(this.contextCaches.values());
    const totalCachedTokens = entries.reduce((sum, e) => sum + e.tokenCount, 0);
    return {
      activeCaches: entries.length,
      totalCachedTokens,
      entries,
    };
  }

  public getArchivedCheckpoints(): ArchivedCompactionRecord[] {
    return [...this.archivedCheckpoints];
  }
}

export const contextCompactor = new ContextCompactor();
export default contextCompactor;
