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
