/**
 * Per-operator token budgets for cloud mode.
 *
 * Caps live in `user_budgets` (one row per user, created at provisioning).
 * Usage is derived live from `agent_runs` token columns — no separate counter
 * to drift. A cap of 0 means unlimited.
 *
 * Env: DEMO_TOKEN_CAP (default 1000000), FULL_TOKEN_CAP (default 10000000).
 */
import { Pool } from 'pg';

export type UserBudgetStatus = 'OK' | 'WARNING_80_PCT' | 'EXCEEDED';

export interface UserBudgetUsage {
  userId: string;
  mode: 'demo' | 'full';
  /** 0 = unlimited. */
  cap: number;
  used: number;
  /** null when unlimited. */
  remaining: number | null;
  costUsd: number;
  status: UserBudgetStatus;
}

export interface UserTokenTelemetry {
  range: 'today' | '7d' | '30d' | 'all';
  totalTokens: number;
  totalCostUsd: number;
  totalRuns: number;
  cachedHitPct: number;
  byVertical: {
    TECH: { tokens: number; costUsd: number; runs: number; sharePct: number };
    SEO_AEO: { tokens: number; costUsd: number; runs: number; sharePct: number };
    SOCIAL: { tokens: number; costUsd: number; runs: number; sharePct: number };
  };
}

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://warden:warden_secret@localhost:5432/warden';

const pool = new Pool({ connectionString: DATABASE_URL, max: 5 });

const BUDGET_DDL = `
CREATE TABLE IF NOT EXISTS user_budgets (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'demo' CHECK (mode IN ('demo', 'full')),
  token_cap BIGINT NOT NULL DEFAULT 1000000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`;

let ready: Promise<void> | null = null;
function ensureReady(): Promise<void> {
  if (!ready) {
    ready = pool
      .query(BUDGET_DDL)
      .then(() => undefined)
      .catch((err) => {
        ready = null;
        throw err;
      });
  }
  return ready;
}

/** Test/CLI hook to drain the pool so the process can exit. */
export async function closeBudgetsPool(): Promise<void> {
  await pool.end().catch(() => undefined);
}

export function defaultCapForMode(mode: 'demo' | 'full'): number {
  if (mode === 'demo') {
    const raw = Number(process.env.DEMO_TOKEN_CAP ?? 1_000_000);
    return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 1_000_000;
  }
  const raw = Number(process.env.FULL_TOKEN_CAP ?? 10_000_000);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 10_000_000;
}

/** Creates the user's budget row if missing; never overwrites an existing cap. */
export async function ensureBudget(
  userId: string,
  mode: 'demo' | 'full'
): Promise<void> {
  await ensureReady();
  await pool.query(
    `INSERT INTO user_budgets (user_id, mode, token_cap)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, mode, defaultCapForMode(mode)]
  );
}

export async function getUserUsage(userId: string): Promise<UserBudgetUsage> {
  await ensureReady();
  const capRes = await pool.query<{ mode: string; token_cap: string | number }>(
    'SELECT mode, token_cap FROM user_budgets WHERE user_id = $1',
    [userId]
  );
  // No row (e.g. pre-provisioning user): fail closed to the demo default.
  const mode = capRes.rows[0]?.mode === 'full' ? 'full' : 'demo';
  const cap =
    capRes.rows[0]?.token_cap !== undefined && capRes.rows[0]?.token_cap !== null
      ? Number(capRes.rows[0].token_cap)
      : defaultCapForMode('demo');
  const useRes = await pool.query<{ used: string | number; cost: string | number }>(
    `SELECT COALESCE(SUM(tokens_in + tokens_cached + tokens_thinking + tokens_out), 0) AS used,
            COALESCE(SUM(cost_usd), 0) AS cost
     FROM agent_runs WHERE user_id = $1`,
    [userId]
  );
  const used = Number(useRes.rows[0]?.used ?? 0);
  const costUsd = Number(useRes.rows[0]?.cost ?? 0);
  let status: UserBudgetStatus = 'OK';
  if (cap > 0) {
    if (used >= cap) status = 'EXCEEDED';
    else if (used >= cap * 0.8) status = 'WARNING_80_PCT';
  }
  return {
    userId,
    mode,
    cap,
    used,
    remaining: cap === 0 ? null : Math.max(0, cap - used),
    costUsd,
    status,
  };
}

/** Returns the subset of the given users whose budget is exhausted. */
export async function getOverBudgetUserIds(
  userIds: string[]
): Promise<Array<{ userId: string; used: number; cap: number }>> {
  const out: Array<{ userId: string; used: number; cap: number }> = [];
  for (const userId of new Set(userIds)) {
    if (!userId) continue;
    const usage = await getUserUsage(userId);
    if (usage.status === 'EXCEEDED') {
      out.push({ userId, used: usage.used, cap: usage.cap });
    }
  }
  return out;
}

function classifyVertical(
  agentId: string | null | undefined,
  slug: string | null | undefined,
  department: string | null | undefined
): 'TECH' | 'SEO_AEO' | 'SOCIAL' {
  const idSlug = `${agentId || ''} ${slug || ''}`.toLowerCase();
  const dept = `${department || ''}`.toLowerCase();
  if (idSlug.includes('seo') || idSlug.includes('aeo') || idSlug.includes('cbo') || dept.includes('seo') || dept.includes('aeo')) {
    return 'SEO_AEO';
  }
  if (
    idSlug.includes('social') ||
    idSlug.includes('cmo') ||
    dept.includes('social') ||
    dept.includes('marketing')
  ) {
    return 'SOCIAL';
  }
  return 'TECH';
}

export async function getUserTokenTelemetry(
  userId: string,
  rawRange: string
): Promise<UserTokenTelemetry> {
  await ensureReady();
  const normalized = (rawRange || 'today').toLowerCase();
  const range: 'today' | '7d' | '30d' | 'all' =
    normalized === '7d'
      ? '7d'
      : normalized === '30d'
        ? '30d'
        : normalized === 'all'
          ? 'all'
          : 'today';

  // Ensure existing demo users who provisioned before agent_runs seeding have their starter runs
  try {
    const wsRes = await pool.query<{ mode: string }>(
      'SELECT mode FROM demo_workspaces WHERE user_id = $1',
      [userId]
    );
    if (wsRes.rows[0]?.mode === 'demo') {
      const { seedDemoAgentRuns } = await import('../demo/DemoProvisioning.js');
      await seedDemoAgentRuns(userId);
    }
  } catch {
    // ignore if demo_workspaces table does not exist yet
  }

  let timeClause = '';
  if (range === 'today') {
    timeClause = 'AND r.started_at >= CURRENT_DATE';
  } else if (range === '7d') {
    timeClause = "AND r.started_at >= NOW() - INTERVAL '7 days'";
  } else if (range === '30d') {
    timeClause = "AND r.started_at >= NOW() - INTERVAL '30 days'";
  }

  const res = await pool.query<{
    agent_id: string;
    slug: string | null;
    department: string | null;
    tokens_in: string | number;
    tokens_cached: string | number;
    tokens: string | number;
    cost: string | number;
  }>(
    `SELECT r.agent_id,
            a.slug,
            a.department,
            COALESCE(r.tokens_in, 0) AS tokens_in,
            COALESCE(r.tokens_cached, 0) AS tokens_cached,
            COALESCE(r.tokens_in, 0) + COALESCE(r.tokens_cached, 0) + COALESCE(r.tokens_thinking, 0) + COALESCE(r.tokens_out, 0) AS tokens,
            COALESCE(r.cost_usd, 0) AS cost
     FROM agent_runs r
     LEFT JOIN agents a ON a.id = r.agent_id
     WHERE r.user_id = $1 ${timeClause}`,
    [userId]
  );

  const acc = {
    TECH: { tokens: 0, costUsd: 0, runs: 0 },
    SEO_AEO: { tokens: 0, costUsd: 0, runs: 0 },
    SOCIAL: { tokens: 0, costUsd: 0, runs: 0 },
  };

  let totalCached = 0;
  let totalPromptInput = 0;

  for (const row of res.rows) {
    const v = classifyVertical(row.agent_id, row.slug, row.department);
    const t = Number(row.tokens ?? 0);
    const c = Number(row.cost ?? 0);
    const tIn = Number(row.tokens_in ?? 0);
    const tCached = Number(row.tokens_cached ?? 0);
    acc[v].tokens += t;
    acc[v].costUsd += c;
    acc[v].runs += 1;
    totalCached += tCached;
    totalPromptInput += tIn + tCached;
  }

  const totalTokens = acc.TECH.tokens + acc.SEO_AEO.tokens + acc.SOCIAL.tokens;
  const totalCostUsd = Number(
    (acc.TECH.costUsd + acc.SEO_AEO.costUsd + acc.SOCIAL.costUsd).toFixed(6)
  );
  const totalRuns = acc.TECH.runs + acc.SEO_AEO.runs + acc.SOCIAL.runs;
  const cachedHitPct =
    totalPromptInput > 0 ? Math.min(99, Math.round((totalCached / totalPromptInput) * 100)) : 0;

  const pct = (n: number) => (totalTokens > 0 ? Math.round((n / totalTokens) * 100) : 0);

  return {
    range,
    totalTokens,
    totalCostUsd,
    totalRuns,
    cachedHitPct,
    byVertical: {
      TECH: {
        tokens: acc.TECH.tokens,
        costUsd: Number(acc.TECH.costUsd.toFixed(6)),
        runs: acc.TECH.runs,
        sharePct: pct(acc.TECH.tokens),
      },
      SEO_AEO: {
        tokens: acc.SEO_AEO.tokens,
        costUsd: Number(acc.SEO_AEO.costUsd.toFixed(6)),
        runs: acc.SEO_AEO.runs,
        sharePct: pct(acc.SEO_AEO.tokens),
      },
      SOCIAL: {
        tokens: acc.SOCIAL.tokens,
        costUsd: Number(acc.SOCIAL.costUsd.toFixed(6)),
        runs: acc.SOCIAL.runs,
        sharePct: pct(acc.SOCIAL.tokens),
      },
    },
  };
}
