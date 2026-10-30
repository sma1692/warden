// ============================================================================
// @commando/db — Dual-Mode PostgreSQL + pgvector Client & Vector Math Utilities
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { schema } from './schema.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const COMMANDO_ROOT = path.resolve(__dirname, '../../..');

// Auto-load root `.env` so DATABASE_URL, GEMINI_API_KEY, ANTHROPIC_API_KEY, TELEGRAM_* work from any workspace cwd
(function loadRootEnv() {
  const envPath = path.join(COMMANDO_ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  try {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined || process.env[key] === '') {
        process.env[key] = val;
      }
    }
  } catch {
    // Ignore read errors
  }
})();

export const DEFAULT_SNAPSHOT_PATH =
  process.env.COMMANDO_DB_SNAPSHOT_PATH ||
  path.join(COMMANDO_ROOT, '.state', 'dynamocommando-db.json');
export const INIT_SQL_PATH = path.join(COMMANDO_ROOT, 'infra', 'postgres', 'init.sql');
export const DEFAULT_DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://commando:commando_secret@localhost:5432/dynamocommando';

/**
 * Computes cosine similarity in [-1, 1] between two numeric vectors (e.g. 768-dim embeddings).
 */
export function cosineSimilarity(
  a: number[] | null | undefined,
  b: number[] | null | undefined
): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

/**
 * Generates a deterministic, L2-normalized 768-dimensional embedding vector using
 * token + character n-gram feature hashing. Used as an instant zero-latency fallback
 * when Vertex AI (`text-embedding-005`) or Ollama (`nomic-embed-text`) is not called.
 */
export function generateDeterministicEmbedding(text: string, dimensions = 768): number[] {
  const vec = new Float64Array(dimensions);
  const normalized = (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9_@./:-]+/g, ' ')
    .trim();

  if (!normalized) {
    vec[0] = 1;
    return Array.from(vec);
  }

  const tokens = normalized.split(/\s+/);
  for (let t = 0; t < tokens.length; t++) {
    const token = tokens[t];
    if (!token) continue;
    // Unigram token hash
    let h1 = 2166136261;
    for (let i = 0; i < token.length; i++) {
      h1 ^= token.charCodeAt(i);
      h1 = Math.imul(h1, 16777619);
    }
    const idx1 = Math.abs(h1) % dimensions;
    const sign1 = (h1 & 1) === 0 ? 1 : -1;
    vec[idx1] += sign1 * 1.5;

    // Bigram token hash
    if (t + 1 < tokens.length) {
      const bigram = `${token}_${tokens[t + 1]}`;
      let h2 = 2166136261;
      for (let i = 0; i < bigram.length; i++) {
        h2 ^= bigram.charCodeAt(i);
        h2 = Math.imul(h2, 16777619);
      }
      const idx2 = Math.abs(h2) % dimensions;
      const sign2 = (h2 & 1) === 0 ? 1 : -1;
      vec[idx2] += sign2 * 1.0;
    }

    // Character trigram hashes for sub-word recall
    for (let c = 0; c <= token.length - 3; c++) {
      const tri = token.slice(c, c + 3);
      let h3 = 5381;
      for (let i = 0; i < tri.length; i++) {
        h3 = (Math.imul(h3, 33) ^ tri.charCodeAt(i)) | 0;
      }
      const idx3 = Math.abs(h3) % dimensions;
      vec[idx3] += 0.35;
    }
  }

  let normSq = 0;
  for (let i = 0; i < dimensions; i++) {
    normSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(normSq) || 1;
  const out = new Array<number>(dimensions);
  for (let i = 0; i < dimensions; i++) {
    out[i] = Number((vec[i] / norm).toFixed(6));
  }
  return out;
}

export function formatPgVector(embedding: number[] | null | undefined): string | null {
  if (!embedding || embedding.length === 0) return null;
  return `[${embedding.join(',')}]`;
}

export function parsePgVector(raw: unknown): number[] | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw.map(Number);
  if (typeof raw === 'string') {
    const trimmed = raw.replace(/^\[|\]$/g, '').trim();
    if (!trimmed) return null;
    return trimmed.split(',').map((v) => Number(v.trim()));
  }
  return null;
}

export interface PgPoolLike {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
  end(): Promise<void>;
  on(event: 'error', listener: (err: Error) => void): unknown;
}

/**
 * Manages optional PostgreSQL (`pg.Pool` + Drizzle ORM) connection with automatic
 * fast health probing and fallback detection when the Docker Postgres container is offline.
 */
export class PostgresClientManager {
  private connectionString: string;
  private pool: PgPoolLike | null = null;
  private drizzleDb: any = null;
  private connected = false;
  private lastCheckAt = 0;
  private schemaInitialized = false;

  constructor(connectionString: string = DEFAULT_DATABASE_URL) {
    this.connectionString = connectionString;
  }

  public isConnected(): boolean {
    return this.connected && this.pool !== null;
  }

  public getDrizzle(): any {
    return this.drizzleDb;
  }

  public getPool(): PgPoolLike | null {
    return this.pool;
  }

  /**
   * Attempts to connect to PostgreSQL with a fast 1.5s timeout.
   * Returns true if PostgreSQL is online and reachable, false otherwise.
   */
  public async connect(forceRetry = false): Promise<boolean> {
    if (this.connected && this.pool && !forceRetry) {
      return true;
    }
    const now = Date.now();
    if (!forceRetry && this.lastCheckAt > 0 && now - this.lastCheckAt < 10_000) {
      return this.connected;
    }
    this.lastCheckAt = now;

    try {
      const pgModName = 'pg';
      const pgMod: any = await import(pgModName);
      const PoolClass = pgMod.Pool || pgMod.default?.Pool;
      if (!PoolClass) {
        this.connected = false;
        return false;
      }

      const pool: PgPoolLike = new PoolClass({
        connectionString: this.connectionString,
        max: 10,
        connectionTimeoutMillis: 1500,
        idleTimeoutMillis: 30000,
      });

      // Idle clients emit 'error' when Postgres drops the socket (restart, container stop).
      // Without a listener, Node treats it as unhandled and crashes the process.
      pool.on('error', (err) => {
        console.warn(`[db] PostgreSQL idle client error: ${err.message}`);
        if (this.pool === pool) {
          this.connected = false;
          this.pool = null;
          this.drizzleDb = null;
          this.lastCheckAt = 0;
          pool.end().catch(() => {});
        }
      });

      await pool.query('SELECT 1');
      this.pool = pool;
      this.connected = true;

      try {
        const drizzleModName = 'drizzle-orm/node-postgres';
        const drizzleMod: any = await import(drizzleModName);
        if (drizzleMod?.drizzle) {
          this.drizzleDb = drizzleMod.drizzle(pool, { schema });
        }
      } catch {
        this.drizzleDb = null;
      }

      if (!this.schemaInitialized) {
        await this.ensureSchema();
      }

      return true;
    } catch {
      this.connected = false;
      this.pool = null;
      return false;
    }
  }

  /**
   * Executes `infra/postgres/init.sql` idempotently on PostgreSQL.
   */
  public async ensureSchema(): Promise<boolean> {
    if (!this.pool || !this.connected) return false;
    try {
      if (fs.existsSync(INIT_SQL_PATH)) {
        const ddl = fs.readFileSync(INIT_SQL_PATH, 'utf8');
        await this.pool.query(ddl);
        this.schemaInitialized = true;
      }
      return true;
    } catch {
      return false;
    }
  }

  public async query<T = any>(
    sqlText: string,
    params: unknown[] = []
  ): Promise<{ rows: T[]; rowCount: number } | null> {
    const ok = await this.connect();
    if (!ok || !this.pool) return null;
    try {
      const res = await this.pool.query(sqlText, params);
      return {
        rows: (res.rows as T[]) || [],
        rowCount: res.rowCount ?? res.rows?.length ?? 0,
      };
    } catch {
      this.connected = false;
      return null;
    }
  }

  public async close(): Promise<void> {
    if (this.pool) {
      try {
        await this.pool.end();
      } catch {
        // Ignore close errors
      }
    }
    this.pool = null;
    this.drizzleDb = null;
    this.connected = false;
  }
}

export const pgClient = new PostgresClientManager();
