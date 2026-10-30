/**
 * DYNAMO COMMANDO — Hybrid Memory Engine (`PostgreSQL + pgvector`)
 * (`dynamocommando.md` Section 3 & Section 4.1–4.3)
 *
 * Implements the Golden Rule of Hybrid Memory:
 * 1. Deterministic SQL Context (Always Injected 100% Reliably):
 *    - `agent.init_prompt`, hierarchy level, department, permission tier, allowed repos
 *    - Matching `project_contexts` (`architecture_doc_md`, `build_cmd`, `test_cmd`, `dev_preview_port`)
 *    - Active sprint (`sprints`) & active task spec (`backlog_items`)
 *    - All `is_pinned = true` rows from `agent_memories` (`PINNED_PREFERENCE`, `CEO_DECISION`)
 * 2. Semantic + Keyword Hybrid Recall (`pgvector` `vector(768)` + keyword scoring):
 *    - Embeds `queryText` into a 768-dim vector via `ModelRouter.embedText()`
 *    - Queries `agent_memories` (`EPISODIC_LESSON`, `REPO_GOTCHA`), past `chat_messages`,
 *      and `code_chunks` combining cosine similarity (`1 - (embedding <=> $1)`) + keyword overlap
 *      + relational scope filter (`project_scope`), injecting the top-5 relevant memories and code chunks.
 * 3. Episodic Memory Recording & Cross-Repo Codebase Indexing (`code_chunks`).
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  ModelRouter,
  modelRouter as defaultModelRouter,
  cosineSimilarity,
  computeDeterministicTrigramEmbedding,
  type ModelProvider,
  type StepRoutingConfig,
} from '../models/ModelRouter.js';
import { truncateToTokenLimit } from '../models/TokenTracker.js';
import {
  getDefaultProjectSlug,
  getInfraProjectSlug,
  loadPrivateData,
} from '../config/projectRegistry.js';

/**
 * Pinned Vector Embedding Invariance (`dynamocommando.md` Section 4.8.4):
 * Regardless of which chat model an agent is using (`muse-spark-1.3`, `gemini-2.5-pro`,
 * `claude-sonnet-4`, `qwen2.5-coder`), all vector embeddings (`agent_memories.embedding`,
 * `chat_messages.embedding`, `code_chunks.embedding`) are ALWAYS computed by the single
 * pinned embedding pipeline (`text-embedding-005` on Vertex AI, `nomic-embed-text` on Ollama,
 * or deterministic 768-dim trigram vector) so `pgvector` (`vector(768)`) never drifts.
 */
export const PINNED_EMBEDDING_PROVIDER = 'vertex' as const;
export const PINNED_EMBEDDING_MODEL_ID = 'text-embedding-005' as const;

export type MemoryType =
  | 'PINNED_PREFERENCE'
  | 'REPO_GOTCHA'
  | 'EPISODIC_LESSON'
  | 'CEO_DECISION';

export interface AgentProfileRecord {
  id: string;
  slug?: string;
  name?: string;
  department?: string;
  hierarchy_level?: number;
  parent_agent_id?: string | null;
  project_scope?: string | null;
  model_provider?: ModelProvider;
  model_id?: string;
  fallback_provider?: ModelProvider | null;
  fallback_model_id?: string | null;
  step_routing_json?: StepRoutingConfig | null;
  init_prompt: string;
  allowed_repos?: string[];
  permission_tier?: 'full_overdrive' | 'standard_autonomous' | 'strict_gate';
}

export interface ProjectContextRecord {
  id?: string;
  project_slug: string;
  repo_slug: string;
  git_repo_url?: string;
  default_branch?: string;
  role?: string;
  docker_base_image?: string;
  build_cmd?: string;
  test_cmd?: string;
  dev_preview_port?: number | null;
  architecture_doc_md: string;
  updated_at?: string;
}

export interface SprintRecord {
  id: string;
  date_ist: string;
  status: 'AWAITING_CEO_APPROVAL' | 'EXECUTING' | 'COMPLETED' | string;
  mom_summary_md?: string;
  approved_at?: string | null;
  ceo_notes?: string | null;
}

export interface BacklogItemRecord {
  id: string;
  title: string;
  spec_md: string;
  stage: 'INBOX' | 'TODO' | 'IN_PROGRESS' | 'QA_REVIEW' | 'DONE' | string;
  priority: 'P0' | 'P1' | 'P2' | string;
  project_slug?: string | null;
  assigned_agent_id?: string | null;
  sprint_id?: string | null;
}

export interface AgentMemoryRecord {
  id: string;
  agent_id: string;
  project_scope?: string | null;
  memory_type: MemoryType;
  content: string;
  source_run_id?: string | null;
  is_pinned: boolean;
  embedding?: number[];
  similarity_score?: number;
  keyword_score?: number;
  hybrid_score?: number;
  created_at: string;
}

export interface ChatMessageRecallRecord {
  id: string;
  thread_id: string;
  sender_type: 'CEO' | 'AGENT' | 'SYSTEM' | string;
  sender_agent_id?: string | null;
  recipient_agent_id?: string | null;
  content: string;
  embedding?: number[];
  hybrid_score?: number;
  created_at: string;
}

export interface CodeChunkRecord {
  id: string;
  project_slug: string;
  repo_slug: string;
  file_path: string;
  symbol_name: string;
  chunk_type: 'function' | 'class' | 'interface' | 'config' | 'module';
  start_line: number;
  end_line: number;
  content: string;
  embedding?: number[];
  similarity_score?: number;
  keyword_score?: number;
  hybrid_score?: number;
  updated_at: string;
}

export interface RecordEpisodicMemoryInput {
  id?: string;
  agentId: string;
  projectScope?: string | null;
  memoryType?: MemoryType;
  content: string;
  sourceRunId?: string | null;
  isPinned?: boolean;
}

export interface BuildAgentSystemPromptObjectParams {
  agent: AgentProfileRecord;
  projectContexts?: ProjectContextRecord[];
  activeSprint?: SprintRecord | null;
  activeBacklogItem?: BacklogItemRecord | null;
  queryText?: string;
  pinnedMemories?: AgentMemoryRecord[];
  topK?: number;
}

export type SqlQueryExecutor = (
  sql: string,
  params?: unknown[]
) => Promise<{ rows?: Record<string, unknown>[] } | Record<string, unknown>[]>;

/**
 * Computes normalized keyword match score (`0.0` to `1.0`) between `queryText` and `candidateText`
 * to complement `pgvector` semantic similarity in hybrid ranking.
 */
export function computeKeywordMatchScore(queryText: string, candidateText: string): number {
  if (!queryText || !candidateText) return 0;
  const stopWords = new Set([
    'the',
    'and',
    'for',
    'with',
    'that',
    'this',
    'from',
    'what',
    'how',
    'are',
    'was',
    'were',
    'have',
    'has',
    'into',
    'our',
    'can',
    'you',
  ]);
  const queryKeywords = Array.from(
    new Set(
      queryText
        .toLowerCase()
        .split(/[^a-z0-9_./:-]+/)
        .filter((w) => w.length >= 3 && !stopWords.has(w))
    )
  );
  if (queryKeywords.length === 0) return 0;

  const lowerCandidate = candidateText.toLowerCase();
  let hits = 0;
  for (const kw of queryKeywords) {
    if (lowerCandidate.includes(kw)) {
      hits += 1;
    }
  }
  return Number((hits / queryKeywords.length).toFixed(4));
}

export class HybridMemoryEngine {
  private readonly modelRouter: ModelRouter;
  private dbQuery?: SqlQueryExecutor;
  private readonly memoryStore = new Map<string, AgentMemoryRecord>();
  private readonly chatRecallStore = new Map<string, ChatMessageRecallRecord>();
  private readonly codeChunkStore = new Map<string, CodeChunkRecord>();

  constructor(options?: {
    modelRouter?: ModelRouter;
    dbQuery?: SqlQueryExecutor;
  }) {
    this.modelRouter = options?.modelRouter ?? defaultModelRouter;
    this.dbQuery = options?.dbQuery;
    this.seedDefaultMemories();
  }

  private seedDefaultMemories(): void {
    const now = new Date().toISOString();
    type SeedMemory = Omit<AgentMemoryRecord, 'embedding' | 'created_at'>;
    const privateDefaults = loadPrivateData<{ defaults?: SeedMemory[] }>('memories')?.defaults;
    const defaultSlug = getDefaultProjectSlug();
    const infraSlug = getInfraProjectSlug();
    const defaults: SeedMemory[] = privateDefaults?.length
      ? privateDefaults
      : [
          {
            id: 'mem-pinned-commit-format',
            agent_id: '@cto',
            project_scope: null,
            memory_type: 'PINNED_PREFERENCE',
            content:
              'All git commits must use ALL CAPS comma-separated headers, active-verb bullet points, and the configured author footer without AI attribution trailers.',
            is_pinned: true,
          },
          {
            id: 'mem-ceo-verify-gate',
            agent_id: '@warden',
            project_scope: null,
            memory_type: 'CEO_DECISION',
            content:
              'Every engineering task must pass compilation, automated tests, and Playwright headless verification with zero console errors before transitioning to QA_REVIEW.',
            is_pinned: true,
          },
          {
            id: `mem-gotcha-${defaultSlug}-contracts`,
            agent_id: `@tech_lead:${defaultSlug}`,
            project_scope: defaultSlug,
            memory_type: 'REPO_GOTCHA',
            content: `In ${defaultSlug}, realtime room state schemas and REST payloads must be locked in contracts/ before modifying client stores or server controllers.`,
            is_pinned: false,
          },
          {
            id: 'mem-lesson-headless-webgl',
            agent_id: '@cto',
            project_scope: null,
            memory_type: 'EPISODIC_LESSON',
            content:
              'For WebGL/Three.js games, headless Chromium requires --use-gl=angle --use-angle=swiftshader flags during Playwright visual smoke tests.',
            is_pinned: false,
          },
          {
            id: `mem-gotcha-${infraSlug}-deploy`,
            agent_id: '@infra_head',
            project_scope: infraSlug,
            memory_type: 'REPO_GOTCHA',
            content:
              'Large binary 3D/audio assets belong in object storage buckets, whereas static web bundles deploy to a static hosting CDN.',
            is_pinned: false,
          },
        ];

    for (const item of defaults) {
      this.memoryStore.set(item.id, {
        ...item,
        embedding: computeDeterministicTrigramEmbedding(item.content),
        created_at: now,
      });
    }
  }

  /**
   * Attaches a PostgreSQL + `pgvector` query executor (`(sql, params) => Promise<{ rows }>`).
   */
  public setDatabaseExecutor(dbQuery: SqlQueryExecutor): void {
    this.dbQuery = dbQuery;
  }

  private async runQuery<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<T[] | null> {
    if (!this.dbQuery) return null;
    try {
      const res = await this.dbQuery(sql, params);
      if (Array.isArray(res)) return res as T[];
      if (res && typeof res === 'object' && Array.isArray((res as { rows?: unknown[] }).rows)) {
        return (res as { rows: T[] }).rows;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Builds the complete hybrid system prompt for an agent run:
   * 1. Deterministic SQL Context (`agent.init_prompt`, `project_contexts`, `activeSprint`, `activeBacklogItem`, `is_pinned = true` memories)
   * 2. Semantic + Keyword Hybrid Recall (`pgvector` top-5 episodic memories, past chat turns, and cross-repo `code_chunks`)
   *
   * Supports both positional arguments:
   *   `buildAgentSystemPrompt(agent, projectContexts, activeSprint, activeBacklogItem, queryText)`
   * and a single parameter object:
   *   `buildAgentSystemPrompt({ agent, projectContexts, activeSprint, activeBacklogItem, queryText })`
   */
  public async buildAgentSystemPrompt(
    agentOrParams: AgentProfileRecord | BuildAgentSystemPromptObjectParams,
    projectContextsArg: ProjectContextRecord[] = [],
    activeSprintArg: SprintRecord | null = null,
    activeBacklogItemArg: BacklogItemRecord | null = null,
    queryTextArg: string = ''
  ): Promise<string> {
    let agent: AgentProfileRecord;
    let projectContexts: ProjectContextRecord[];
    let activeSprint: SprintRecord | null;
    let activeBacklogItem: BacklogItemRecord | null;
    let queryText: string;
    let explicitPinned: AgentMemoryRecord[] | undefined;
    let topK = 5;

    if ('agent' in agentOrParams && agentOrParams.agent) {
      agent = agentOrParams.agent;
      projectContexts = agentOrParams.projectContexts ?? [];
      activeSprint = agentOrParams.activeSprint ?? null;
      activeBacklogItem = agentOrParams.activeBacklogItem ?? null;
      queryText = agentOrParams.queryText ?? '';
      explicitPinned = agentOrParams.pinnedMemories;
      topK = agentOrParams.topK ?? 5;
    } else {
      agent = agentOrParams as AgentProfileRecord;
      projectContexts = projectContextsArg ?? [];
      activeSprint = activeSprintArg ?? null;
      activeBacklogItem = activeBacklogItemArg ?? null;
      queryText = queryTextArg ?? '';
    }

    const agentId = agent.slug || agent.id || '@warden';
    const projectScope =
      agent.project_scope ||
      activeBacklogItem?.project_slug ||
      projectContexts[0]?.project_slug ||
      null;

    // 1. Fetch Pinned Standing Memories (`is_pinned = true`, `PINNED_PREFERENCE`, `CEO_DECISION`)
    const pinnedMemories =
      explicitPinned ?? (await this.getPinnedMemories(agent.id || agentId, projectScope));

    // 2. Semantic + Keyword Hybrid Recall (`pgvector`) for `queryText` (or active backlog title/spec)
    const effectiveQuery =
      queryText.trim() ||
      (activeBacklogItem
        ? `${activeBacklogItem.title}\n${activeBacklogItem.spec_md}`
        : `${agentId} ${projectScope || ''}`);

    const [episodicMemories, relevantChatTurns, relevantCodeChunks] = await Promise.all([
      this.recallEpisodicMemories({
        queryText: effectiveQuery,
        agentId: agent.id || agentId,
        projectScope,
        topK,
      }),
      this.recallPastChatMessages({
        queryText: effectiveQuery,
        projectScope,
        topK: 3,
      }),
      this.recallCodeChunks({
        queryText: effectiveQuery,
        projectSlug: projectScope || undefined,
        topK,
      }),
    ]);

    // Filter matching project_contexts for this agent's project_scope & allowed_repos
    const allowedReposSet =
      Array.isArray(agent.allowed_repos) && agent.allowed_repos.length > 0
        ? new Set(agent.allowed_repos)
        : null;

    const filteredContexts = projectContexts.filter((ctx) => {
      if (projectScope && ctx.project_slug !== projectScope && ctx.project_slug !== 'GLOBAL') {
        return false;
      }
      if (
        allowedReposSet &&
        ctx.repo_slug !== 'GLOBAL' &&
        !allowedReposSet.has(ctx.repo_slug) &&
        !allowedReposSet.has(ctx.project_slug)
      ) {
        return false;
      }
      return true;
    });

    const contextsToInject = filteredContexts.length > 0 ? filteredContexts : projectContexts;

    // Assemble Deterministic + Semantic Hybrid System Prompt
    const sections: string[] = [];

    // Section A: Deterministic Core Agent Identity & Init Prompt
    sections.push(
      `# 1. DETERMINISTIC AGENT IDENTITY & CORE ROLE (\`${agentId}\`)`,
      `- **Agent ID**: \`${agent.id}\` (${agent.name || agentId})`,
      `- **Department**: \`${agent.department || 'TECH'}\` | **Hierarchy Level**: \`${agent.hierarchy_level ?? 0}\``,
      `- **Project Scope**: \`${projectScope || 'ALL_PROJECTS'}\``,
      `- **Permission Tier**: \`${agent.permission_tier || 'standard_autonomous'}\``,
      `- **Allowed Repositories**: ${
        Array.isArray(agent.allowed_repos) && agent.allowed_repos.length > 0
          ? agent.allowed_repos.map((r) => `\`${r}\``).join(', ')
          : '`ALL`'
      }`,
      ``,
      `## Role Instructions (\`init_prompt\`)`,
      agent.init_prompt.trim()
    );

    // Section B: Deterministic Pinned Preferences & Standing CEO Decisions (`is_pinned = true`)
    sections.push(
      ``,
      `# 2. PINNED STANDING RULES & CEO DECISIONS (\`is_pinned = true\`)`
    );
    if (pinnedMemories.length > 0) {
      for (const pm of pinnedMemories) {
        sections.push(
          `- **[${pm.memory_type}${pm.project_scope ? ` | ${pm.project_scope}` : ''}]**: ${pm.content.trim()}`
        );
      }
    } else {
      sections.push(`- Follow strict repository boundaries, contract handshakes, and zero-error build/Playwright gates.`);
    }

    // Section C: Deterministic Project & Repository Architecture Contexts (`project_contexts`)
    if (contextsToInject.length > 0) {
      sections.push(``, `# 3. DETERMINISTIC PROJECT & REPOSITORY ARCHITECTURE (\`project_contexts\`)`);
      for (const ctx of contextsToInject) {
        sections.push(
          `## Project: \`${ctx.project_slug}\` / Repo: \`${ctx.repo_slug}\` (Role: \`${ctx.role || 'fullstack'}\`)`,
          `- **Git Repo**: \`${ctx.git_repo_url || 'local'}\` (Branch: \`${ctx.default_branch || 'main'}\`)`,
          `- **Build Command**: \`${ctx.build_cmd || 'npm run build'}\` | **Test Command**: \`${ctx.test_cmd || 'npm test'}\` | **Preview Port**: \`${ctx.dev_preview_port ?? 'n/a'}\``,
          ``,
          truncateToTokenLimit(ctx.architecture_doc_md || '', 4000)
        );
      }
    }

    // Section D: Active Sprint & Backlog Task Spec (`sprints` + `backlog_items`)
    if (activeSprint || activeBacklogItem) {
      sections.push(``, `# 4. ACTIVE SPRINT & ASSIGNED TASK SPECIFICATION`);
      if (activeSprint) {
        sections.push(
          `## Active Sprint: \`${activeSprint.id}\` (${activeSprint.date_ist} — Status: \`${activeSprint.status}\`)`,
          activeSprint.ceo_notes ? `- **CEO Notes**: ${activeSprint.ceo_notes}` : '',
          activeSprint.mom_summary_md
            ? truncateToTokenLimit(activeSprint.mom_summary_md, 1500)
            : ''
        );
      }
      if (activeBacklogItem) {
        sections.push(
          `## Assigned Backlog Item: \`[${activeBacklogItem.priority}] ${activeBacklogItem.title}\` (\`${activeBacklogItem.id}\` — Stage: \`${activeBacklogItem.stage}\`)`,
          truncateToTokenLimit(activeBacklogItem.spec_md, 2500)
        );
      }
    }

    // Section E: pgvector Hybrid Semantic + Keyword Recall (Top-5 Episodic Memories & Gotchas)
    sections.push(
      ``,
      `# 5. HYBRID SEMANTIC MEMORY RECALL (\`pgvector\` Top-${topK} Episodic Lessons & Repo Gotchas)`
    );
    if (episodicMemories.length > 0) {
      for (const mem of episodicMemories) {
        const scoreTag =
          mem.hybrid_score !== undefined ? ` (relevance: ${(mem.hybrid_score * 100).toFixed(0)}%)` : '';
        sections.push(
          `- **[${mem.memory_type} | ${mem.project_scope || 'GLOBAL'}${scoreTag}]**: ${mem.content.trim()}`
        );
      }
    } else {
      sections.push(`- No prior episodic memories matched the current query threshold.`);
    }

    // Section F: Relevant Past Chat Context (`chat_messages` pgvector recall)
    if (relevantChatTurns.length > 0) {
      sections.push(``, `# 6. RELEVANT PAST CONVERSATION RECALL (\`chat_messages\` \`pgvector\`)`);
      for (const chat of relevantChatTurns) {
        sections.push(
          `- **[${chat.sender_type}${chat.sender_agent_id ? ` (${chat.sender_agent_id})` : ''} @ ${chat.created_at}]**: ${chat.content.slice(0, 350)}`
        );
      }
    }

    // Section G: Cross-Repo Codebase Intelligence (`code_chunks` pgvector recall)
    if (relevantCodeChunks.length > 0) {
      sections.push(
        ``,
        `# 7. CROSS-REPO CODEBASE INTELLIGENCE (\`code_chunks\` \`pgvector\` Top-${relevantCodeChunks.length})`
      );
      for (const chunk of relevantCodeChunks) {
        sections.push(
          `### \`${chunk.project_slug}/${chunk.repo_slug}\` — \`${chunk.file_path}\` (\`${chunk.symbol_name}\`, lines ${chunk.start_line}–${chunk.end_line})`,
          '```typescript',
          truncateToTokenLimit(chunk.content, 600),
          '```'
        );
      }
    }

    return sections.filter((s) => s !== undefined).join('\n');
  }

  /**
   * Fetches all deterministic `is_pinned = true` rows (`PINNED_PREFERENCE`, `CEO_DECISION`)
   * for the specified agent and project scope.
   */
  public async getPinnedMemories(
    agentId: string,
    projectScope?: string | null
  ): Promise<AgentMemoryRecord[]> {
    const normalizedAgent = agentId.replace(/^@/, '');
    const sqlRows = await this.runQuery<AgentMemoryRecord>(
      `SELECT id, agent_id, project_scope, memory_type, content, source_run_id, is_pinned, created_at
       FROM agent_memories
       WHERE is_pinned = true
         AND (agent_id = $1 OR agent_id = $2 OR memory_type = 'CEO_DECISION')
         AND ($3::text IS NULL OR project_scope IS NULL OR project_scope = $3 OR project_scope = 'GLOBAL')
       ORDER BY created_at DESC
       LIMIT 25`,
      [agentId, normalizedAgent, projectScope ?? null]
    );

    if (sqlRows && sqlRows.length > 0) {
      return sqlRows;
    }

    // Fallback to in-memory store
    const results: AgentMemoryRecord[] = [];
    for (const mem of this.memoryStore.values()) {
      if (!mem.is_pinned && mem.memory_type !== 'PINNED_PREFERENCE' && mem.memory_type !== 'CEO_DECISION') {
        continue;
      }
      const agentMatches =
        mem.agent_id === agentId ||
        mem.agent_id.replace(/^@/, '') === normalizedAgent ||
        mem.memory_type === 'CEO_DECISION';
      const scopeMatches =
        !projectScope ||
        !mem.project_scope ||
        mem.project_scope === projectScope ||
        mem.project_scope === 'GLOBAL';
      if (agentMatches && scopeMatches) {
        results.push(mem);
      }
    }
    return results.slice(0, 25);
  }

  /**
   * Pinned Vector Embedding Invariance (`dynamocommando.md` Section 4.8.4):
   * Always routes through the pinned 768-dim embedding pipeline (`text-embedding-005` on Vertex AI,
   * `nomic-embed-text` on Ollama, or deterministic 768-dim trigram vector) regardless of which
   * chat model (`muse-spark-1.3`, `gemini-2.5-pro`, `claude-sonnet-4`, `qwen2.5-coder`) an agent uses.
   */
  public async embedWithPinnedPipeline(text: string): Promise<number[]> {
    const pinnedProvider =
      (process.env.PINNED_EMBEDDING_PROVIDER as 'vertex' | 'ollama' | 'deterministic' | undefined) ||
      PINNED_EMBEDDING_PROVIDER;
    const pinnedModelId =
      process.env.PINNED_EMBEDDING_MODEL || PINNED_EMBEDDING_MODEL_ID;
    return this.modelRouter.embedText(text, {
      provider: pinnedProvider === 'deterministic' ? undefined : (pinnedProvider as any),
      modelId: pinnedModelId,
    });
  }

  /**
   * Hybrid Semantic (`1 - (embedding <=> $1)`) + Keyword Recall over `agent_memories`
   * for `EPISODIC_LESSON` and `REPO_GOTCHA`.
   */
  public async recallEpisodicMemories(params: {
    queryText: string;
    agentId?: string;
    projectScope?: string | null;
    topK?: number;
  }): Promise<AgentMemoryRecord[]> {
    const topK = params.topK ?? 5;
    const queryEmbedding = await this.embedWithPinnedPipeline(params.queryText);
    const vectorLiteral = `[${queryEmbedding.join(',')}]`;

    const primaryKeyword =
      params.queryText
        .toLowerCase()
        .split(/[^a-z0-9_-]+/)
        .find((w) => w.length >= 4) || '';

    const sqlRows = await this.runQuery<AgentMemoryRecord>(
      `SELECT
         id,
         agent_id,
         project_scope,
         memory_type,
         content,
         source_run_id,
         is_pinned,
         created_at,
         (1 - (embedding <=> $1::vector)) AS similarity_score,
         CASE WHEN $2 <> '' AND content ILIKE ('%' || $2 || '%') THEN 0.25 ELSE 0.0 END AS keyword_score,
         ((1 - (embedding <=> $1::vector)) * 0.75 +
          CASE WHEN $2 <> '' AND content ILIKE ('%' || $2 || '%') THEN 0.25 ELSE 0.0 END) AS hybrid_score
       FROM agent_memories
       WHERE is_pinned = false
         AND ($3::text IS NULL OR project_scope IS NULL OR project_scope = $3 OR project_scope = 'GLOBAL')
         AND ($4::text IS NULL OR agent_id = $4 OR memory_type = 'REPO_GOTCHA')
       ORDER BY hybrid_score DESC
       LIMIT $5`,
      [
        vectorLiteral,
        primaryKeyword,
        params.projectScope ?? null,
        params.agentId ?? null,
        topK,
      ]
    );

    if (sqlRows && sqlRows.length > 0) {
      return sqlRows;
    }

    // Fallback: In-memory hybrid cosine similarity + keyword ranking
    const candidates: AgentMemoryRecord[] = [];
    for (const mem of this.memoryStore.values()) {
      if (mem.is_pinned) continue;
      if (
        params.projectScope &&
        mem.project_scope &&
        mem.project_scope !== params.projectScope &&
        mem.project_scope !== 'GLOBAL'
      ) {
        continue;
      }
      const vecScore = mem.embedding ? cosineSimilarity(queryEmbedding, mem.embedding) : 0;
      const kwScore = computeKeywordMatchScore(params.queryText, mem.content);
      const hybridScore = Number((vecScore * 0.75 + kwScore * 0.25).toFixed(4));
      candidates.push({
        ...mem,
        similarity_score: Number(vecScore.toFixed(4)),
        keyword_score: kwScore,
        hybrid_score: hybridScore,
      });
    }

    candidates.sort((a, b) => (b.hybrid_score ?? 0) - (a.hybrid_score ?? 0));
    return candidates.slice(0, topK);
  }

  /**
   * Hybrid Semantic + Keyword Recall over past `chat_messages`.
   */
  public async recallPastChatMessages(params: {
    queryText: string;
    projectScope?: string | null;
    topK?: number;
  }): Promise<ChatMessageRecallRecord[]> {
    const topK = params.topK ?? 3;
    const queryEmbedding = await this.embedWithPinnedPipeline(params.queryText);
    const vectorLiteral = `[${queryEmbedding.join(',')}]`;

    const sqlRows = await this.runQuery<ChatMessageRecallRecord>(
      `SELECT
         cm.id,
         cm.thread_id,
         cm.sender_type,
         cm.sender_agent_id,
         cm.recipient_agent_id,
         cm.content,
         cm.created_at,
         (1 - (cm.embedding <=> $1::vector)) AS hybrid_score
       FROM chat_messages cm
       LEFT JOIN chat_threads ct ON ct.id = cm.thread_id
       WHERE cm.embedding IS NOT NULL
         AND ($2::text IS NULL OR ct.project_scope IS NULL OR ct.project_scope = $2)
       ORDER BY cm.embedding <=> $1::vector ASC
       LIMIT $3`,
      [vectorLiteral, params.projectScope ?? null, topK]
    );

    if (sqlRows && sqlRows.length > 0) {
      return sqlRows;
    }

    const candidates: ChatMessageRecallRecord[] = [];
    for (const msg of this.chatRecallStore.values()) {
      const vecScore = msg.embedding ? cosineSimilarity(queryEmbedding, msg.embedding) : 0;
      const kwScore = computeKeywordMatchScore(params.queryText, msg.content);
      candidates.push({
        ...msg,
        hybrid_score: Number((vecScore * 0.75 + kwScore * 0.25).toFixed(4)),
      });
    }
    candidates.sort((a, b) => (b.hybrid_score ?? 0) - (a.hybrid_score ?? 0));
    return candidates.slice(0, topK);
  }

  /**
   * Hybrid Semantic + Keyword Recall over `code_chunks` (`pgvector` Cross-Repo Codebase Intelligence).
   */
  public async recallCodeChunks(params: {
    queryText: string;
    projectSlug?: string;
    repoSlug?: string;
    topK?: number;
  }): Promise<CodeChunkRecord[]> {
    const topK = params.topK ?? 5;
    const queryEmbedding = await this.embedWithPinnedPipeline(params.queryText);
    const vectorLiteral = `[${queryEmbedding.join(',')}]`;
    const primaryKeyword =
      params.queryText
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .find((w) => w.length >= 3) || '';

    const sqlRows = await this.runQuery<CodeChunkRecord>(
      `SELECT
         id,
         project_slug,
         repo_slug,
         file_path,
         symbol_name,
         chunk_type,
         start_line,
         end_line,
         content,
         updated_at,
         (1 - (embedding <=> $1::vector)) AS similarity_score,
         CASE WHEN $2 <> '' AND (symbol_name ILIKE ('%' || $2 || '%') OR content ILIKE ('%' || $2 || '%'))
              THEN 0.25 ELSE 0.0 END AS keyword_score,
         ((1 - (embedding <=> $1::vector)) * 0.75 +
          CASE WHEN $2 <> '' AND (symbol_name ILIKE ('%' || $2 || '%') OR content ILIKE ('%' || $2 || '%'))
               THEN 0.25 ELSE 0.0 END) AS hybrid_score
       FROM code_chunks
       WHERE ($3::text IS NULL OR project_slug = $3)
         AND ($4::text IS NULL OR repo_slug = $4)
       ORDER BY hybrid_score DESC
       LIMIT $5`,
      [
        vectorLiteral,
        primaryKeyword,
        params.projectSlug ?? null,
        params.repoSlug ?? null,
        topK,
      ]
    );

    if (sqlRows && sqlRows.length > 0) {
      return sqlRows;
    }

    const candidates: CodeChunkRecord[] = [];
    for (const chunk of this.codeChunkStore.values()) {
      if (params.projectSlug && chunk.project_slug !== params.projectSlug) continue;
      if (params.repoSlug && chunk.repo_slug !== params.repoSlug) continue;

      const vecScore = chunk.embedding ? cosineSimilarity(queryEmbedding, chunk.embedding) : 0;
      const kwScore = computeKeywordMatchScore(
        params.queryText,
        `${chunk.symbol_name} ${chunk.file_path} ${chunk.content}`
      );
      const hybridScore = Number((vecScore * 0.75 + kwScore * 0.25).toFixed(4));
      candidates.push({
        ...chunk,
        similarity_score: Number(vecScore.toFixed(4)),
        keyword_score: kwScore,
        hybrid_score: hybridScore,
      });
    }

    candidates.sort((a, b) => (b.hybrid_score ?? 0) - (a.hybrid_score ?? 0));
    return candidates.slice(0, topK);
  }

  /**
   * Stores a new lesson learned (`EPISODIC_LESSON`, `REPO_GOTCHA`, `PINNED_PREFERENCE`, or `CEO_DECISION`)
   * after an `agent_run` with a freshly computed 768-dim embedding in `agent_memories`.
   */
  public async recordEpisodicMemory(
    params: RecordEpisodicMemoryInput
  ): Promise<AgentMemoryRecord> {
    const id = params.id || crypto.randomUUID();
    const memoryType: MemoryType = params.memoryType || 'EPISODIC_LESSON';
    const isPinned =
      params.isPinned ??
      (memoryType === 'PINNED_PREFERENCE' || memoryType === 'CEO_DECISION');
    const embedding = await this.embedWithPinnedPipeline(params.content);
    const createdAt = new Date().toISOString();

    const record: AgentMemoryRecord = {
      id,
      agent_id: params.agentId,
      project_scope: params.projectScope ?? null,
      memory_type: memoryType,
      content: params.content,
      source_run_id: params.sourceRunId ?? null,
      is_pinned: isPinned,
      embedding,
      created_at: createdAt,
    };

    // Always store in local memory map for instant zero-latency access & offline resilience
    this.memoryStore.set(id, record);

    // Upsert into PostgreSQL `agent_memories` with `vector(768)`
    const vectorLiteral = `[${embedding.join(',')}]`;
    await this.runQuery(
      `INSERT INTO agent_memories (
         id, agent_id, project_scope, memory_type, content, source_run_id, is_pinned, embedding, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector, $9)
       ON CONFLICT (id) DO UPDATE SET
         content = EXCLUDED.content,
         is_pinned = EXCLUDED.is_pinned,
         embedding = EXCLUDED.embedding`,
      [
        record.id,
        record.agent_id,
        record.project_scope,
        record.memory_type,
        record.content,
        record.source_run_id,
        record.is_pinned,
        vectorLiteral,
        record.created_at,
      ]
    );

    return record;
  }

  /**
   * Scans key TypeScript/JavaScript source files in `repoPath`, extracts functions/classes/interfaces/configs,
   * computes 768-dim embeddings via `ModelRouter.embedText()`, and upserts them into `code_chunks`
   * for Cross-Repo Codebase Intelligence (`dynamocommando.md` Section 3).
   */
  public async indexRepoCodeChunks(
    projectSlug: string,
    repoSlug: string,
    repoPath: string,
    options?: { maxFiles?: number; maxChunks?: number }
  ): Promise<{
    projectSlug: string;
    repoSlug: string;
    filesScanned: number;
    chunksIndexed: number;
    chunks: CodeChunkRecord[];
  }> {
    const maxFiles = options?.maxFiles ?? 120;
    const maxChunks = options?.maxChunks ?? 400;

    if (!repoPath || !fs.existsSync(repoPath)) {
      return {
        projectSlug,
        repoSlug,
        filesScanned: 0,
        chunksIndexed: 0,
        chunks: [],
      };
    }

    const sourceFiles = this.collectRepoSourceFiles(repoPath, maxFiles);
    const extractedChunks: CodeChunkRecord[] = [];

    for (const absFile of sourceFiles) {
      if (extractedChunks.length >= maxChunks) break;
      const relFile = path.relative(repoPath, absFile).replace(/\\/g, '/');
      let fileContent = '';
      try {
        fileContent = fs.readFileSync(absFile, 'utf8');
      } catch {
        continue;
      }
      if (!fileContent.trim()) continue;

      const fileChunks = this.extractSemanticChunksFromFile(
        projectSlug,
        repoSlug,
        relFile,
        fileContent
      );

      for (const rawChunk of fileChunks) {
        if (extractedChunks.length >= maxChunks) break;
        const embeddingText = `${projectSlug}/${repoSlug} ${rawChunk.file_path} ${rawChunk.symbol_name} (${rawChunk.chunk_type})\n${rawChunk.content}`;
        const embedding = await this.embedWithPinnedPipeline(embeddingText);
        const chunkRecord: CodeChunkRecord = {
          ...rawChunk,
          embedding,
        };
        extractedChunks.push(chunkRecord);
        this.codeChunkStore.set(chunkRecord.id, chunkRecord);

        const vectorLiteral = `[${embedding.join(',')}]`;
        await this.runQuery(
          `INSERT INTO code_chunks (
             id, project_slug, repo_slug, file_path, symbol_name, chunk_type, start_line, end_line, content, embedding, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::vector, NOW())
           ON CONFLICT (id) DO UPDATE SET
             start_line = EXCLUDED.start_line,
             end_line = EXCLUDED.end_line,
             content = EXCLUDED.content,
             embedding = EXCLUDED.embedding,
             updated_at = NOW()`,
          [
            chunkRecord.id,
            chunkRecord.project_slug,
            chunkRecord.repo_slug,
            chunkRecord.file_path,
            chunkRecord.symbol_name,
            chunkRecord.chunk_type,
            chunkRecord.start_line,
            chunkRecord.end_line,
            chunkRecord.content,
            vectorLiteral,
          ]
        );
      }
    }

    return {
      projectSlug,
      repoSlug,
      filesScanned: sourceFiles.length,
      chunksIndexed: extractedChunks.length,
      chunks: extractedChunks,
    };
  }

  private collectRepoSourceFiles(rootDir: string, maxFiles: number): string[] {
    const ignoredDirs = new Set([
      'node_modules',
      '.git',
      'dist',
      'build',
      '.next',
      '.turbo',
      'coverage',
      '.state',
      '.cache',
    ]);
    const validExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.jsx', '.sql', '.glsl']);
    const collected: string[] = [];

    const walk = (dir: string, depth: number) => {
      if (depth > 6 || collected.length >= maxFiles) return;
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (collected.length >= maxFiles) break;
        if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!ignoredDirs.has(entry.name)) {
            walk(fullPath, depth + 1);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (
            validExtensions.has(ext) &&
            !entry.name.endsWith('.d.ts') &&
            !entry.name.endsWith('.min.js')
          ) {
            collected.push(fullPath);
          }
        }
      }
    };

    walk(rootDir, 0);
    return collected;
  }

  private extractSemanticChunksFromFile(
    projectSlug: string,
    repoSlug: string,
    relFilePath: string,
    fileContent: string
  ): Omit<CodeChunkRecord, 'embedding'>[] {
    const lines = fileContent.split(/\r?\n/);
    const chunks: Omit<CodeChunkRecord, 'embedding'>[] = [];
    const declRegex =
      /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(function|class|interface|type|const|let)\s+([A-Za-z0-9_$]+)/;

    let currentSymbol = path.basename(relFilePath);
    let currentType: CodeChunkRecord['chunk_type'] = 'module';
    let startLine = 1;
    let buffer: string[] = [];

    const flushChunk = (endLine: number) => {
      const content = buffer.join('\n').trim();
      if (content.length < 30) {
        buffer = [];
        return;
      }
      const deterministicId = crypto
        .createHash('sha1')
        .update(`${projectSlug}:${repoSlug}:${relFilePath}:${currentSymbol}:${startLine}`)
        .digest('hex')
        .slice(0, 32);

      chunks.push({
        id: deterministicId,
        project_slug: projectSlug,
        repo_slug: repoSlug,
        file_path: relFilePath,
        symbol_name: currentSymbol,
        chunk_type: currentType,
        start_line: startLine,
        end_line: endLine,
        content: content.slice(0, 2400),
        updated_at: new Date().toISOString(),
      });
      buffer = [];
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(declRegex);
      if (match && buffer.length >= 18) {
        flushChunk(i);
        const kind = match[1];
        currentSymbol = match[2];
        currentType =
          kind === 'class'
            ? 'class'
            : kind === 'interface' || kind === 'type'
              ? 'interface'
              : kind === 'function'
                ? 'function'
                : 'config';
        startLine = i + 1;
      } else if (buffer.length >= 80) {
        flushChunk(i);
        startLine = i + 1;
      }
      buffer.push(line);
    }

    if (buffer.length > 0) {
      flushChunk(lines.length);
    }

    return chunks;
  }
}

export const hybridMemoryEngine = new HybridMemoryEngine();
export default hybridMemoryEngine;
