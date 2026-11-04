/**
 * Signed-in users and their onboarding progress, stored in PostgreSQL
 * (`users` + `onboarding_profiles`). Every onboarding step and its full form
 * snapshot is written to the database — no JSON files.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

export type OnboardingStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE';

export const ONBOARDING_STEPS = ['f1', '1a', '1b', '1c', '2a', '2b', '2c', '3_import'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface UserRecord {
  id: string;
  phone: string;
  email: string | null;
  created_at: string;
  last_login_at: string;
  token_version: number;
  onboarding: {
    status: OnboardingStatus;
    step: OnboardingStep | null;
    form: Record<string, unknown>;
    updated_at: string;
  };
}

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://warden:warden_secret@localhost:5432/warden';

const pool = new Pool({ connectionString: DATABASE_URL, max: 10 });

/** Covers fresh containers and pre-existing volumes that never ran init.sql 17-18. */
const AUTH_DDL = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  token_version INTEGER NOT NULL DEFAULT 1
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;
CREATE TABLE IF NOT EXISTS onboarding_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'NOT_STARTED'
    CHECK (status IN ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETE')),
  step TEXT CHECK (step IN ('f1', '1a', '1b', '1c', '2a', '2b', '2c', '3_import')),
  form JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
`;

let ready: Promise<void> | null = null;
function ensureReady(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await pool.query(AUTH_DDL);
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

/** Test/CLI hook to drain the pool so the process can exit. */
export async function closeAuthPool(): Promise<void> {
  await pool.end().catch(() => undefined);
}

/** Repo-root .state dir (src/auth -> repo root is four levels up). */
export const STATE_DIR =
  process.env.AUTH_STATE_DIR?.trim() ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../.state');

const SECRET_FILE = path.join(STATE_DIR, 'auth-secret');

/** AUTH_JWT_SECRET, else a random secret generated once into .state/auth-secret. */
export function getJwtSecret(): string {
  const fromEnv = process.env.AUTH_JWT_SECRET?.trim();
  if (fromEnv) return fromEnv;
  try {
    const existing = fs.readFileSync(SECRET_FILE, 'utf8').trim();
    if (existing) return existing;
  } catch {
    /* first run */
  }
  const secret = crypto.randomBytes(48).toString('base64url');
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
  return secret;
}

interface UserRow {
  id: string;
  phone: string;
  email: string | null;
  created_at: Date | string;
  last_login_at: Date | string;
  token_version: number;
  ob_status: OnboardingStatus | null;
  ob_step: OnboardingStep | null;
  ob_form: Record<string, unknown> | null;
  ob_updated_at: Date | string | null;
}

function toRecord(row: UserRow): UserRecord {
  const stamp = (v: Date | string | null, fallback: Date | string): string =>
    v instanceof Date ? v.toISOString() : String(v ?? (fallback instanceof Date ? fallback.toISOString() : fallback));
  return {
    id: row.id,
    phone: row.phone,
    email: row.email ?? null,
    created_at: stamp(row.created_at, row.created_at),
    last_login_at: stamp(row.last_login_at, row.last_login_at),
    token_version: row.token_version,
    onboarding: {
      status: row.ob_status ?? 'NOT_STARTED',
      step: row.ob_step ?? null,
      form: row.ob_form ?? {},
      updated_at: stamp(row.ob_updated_at, row.created_at),
    },
  };
}

const SELECT_USER = `
SELECT u.id, u.phone, u.email, u.created_at, u.last_login_at, u.token_version,
       o.status AS ob_status, o.step AS ob_step, o.form AS ob_form, o.updated_at AS ob_updated_at
FROM users u LEFT JOIN onboarding_profiles o ON o.user_id = u.id
`;

export async function getUserByPhone(phone: string): Promise<UserRecord | null> {
  await ensureReady();
  const res = await pool.query<UserRow>(`${SELECT_USER} WHERE u.phone = $1`, [phone]);
  return res.rows[0] ? toRecord(res.rows[0]) : null;
}

export async function getUserByEmail(email: string): Promise<UserRecord | null> {
  await ensureReady();
  const res = await pool.query<UserRow>(`${SELECT_USER} WHERE u.email = $1`, [email]);
  return res.rows[0] ? toRecord(res.rows[0]) : null;
}

export async function getUserById(id: string): Promise<UserRecord | null> {
  await ensureReady();
  const res = await pool.query<UserRow>(`${SELECT_USER} WHERE u.id = $1`, [id]);
  return res.rows[0] ? toRecord(res.rows[0]) : null;
}

/** Creates the user on first sign-in; returns it plus whether it was new. */
export async function upsertUserOnLogin(phone: string): Promise<{ user: UserRecord; isNew: boolean }> {
  await ensureReady();
  const id = crypto.randomUUID();
  const res = await pool.query<{ id: string; created: boolean }>(
    `INSERT INTO users (id, phone, last_login_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (phone) DO UPDATE SET last_login_at = NOW()
     RETURNING id, (xmax = 0) AS created`,
    [id, phone]
  );
  const row = res.rows[0];
  await pool.query(
    `INSERT INTO onboarding_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [row.id]
  );
  const user = await getUserById(row.id);
  if (!user) throw new Error('User row missing after upsert');
  return { user, isNew: row.created };
}

/** Email sign-in. The phone column keeps a namespaced placeholder so the NOT NULL/UNIQUE shape holds. */
export async function upsertUserOnEmail(email: string): Promise<{ user: UserRecord; isNew: boolean }> {
  await ensureReady();
  const id = crypto.randomUUID();
  const phonePlaceholder = `email:${email}`;
  const res = await pool.query<{ id: string; created: boolean }>(
    `INSERT INTO users (id, phone, email, last_login_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (email) DO UPDATE SET last_login_at = NOW()
     RETURNING id, (xmax = 0) AS created`,
    [id, phonePlaceholder, email]
  );
  const row = res.rows[0];
  await pool.query(
    `INSERT INTO onboarding_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [row.id]
  );
  const user = await getUserById(row.id);
  if (!user) throw new Error('User row missing after upsert');
  return { user, isNew: row.created };
}

export async function updateOnboarding(
  id: string,
  patch: { status?: OnboardingStatus; step?: OnboardingStep | null; form?: Record<string, unknown> }
): Promise<UserRecord | null> {
  await ensureReady();
  const user = await getUserById(id);
  if (!user) return null;

  const existingForm = (user.onboarding.form || {}) as Record<string, unknown>;
  const existingModeRaw =
    existingForm.mode === 'demo' || existingForm.mode === 'full'
      ? existingForm.mode
      : existingForm.chosenMode === 'demo' || existingForm.chosenMode === 'full'
        ? existingForm.chosenMode
        : existingForm.demo === true
          ? 'demo'
          : null;

  // A finished onboarding never drops back to IN_PROGRESS or NOT_STARTED.
  if (user.onboarding.status === 'COMPLETE' && patch.status !== 'COMPLETE' && patch.form === undefined) {
    return user;
  }
  const status: OnboardingStatus =
    user.onboarding.status === 'COMPLETE'
      ? 'COMPLETE'
      : (patch.status ?? (patch.step ? 'IN_PROGRESS' : user.onboarding.status));
  const step = patch.step !== undefined ? patch.step : user.onboarding.step;

  let nextForm: Record<string, unknown> | undefined = patch.form
    ? { ...existingForm, ...patch.form }
    : undefined;
  if (nextForm) {
    const incomingMode =
      nextForm.mode === 'demo' || nextForm.mode === 'full'
        ? nextForm.mode
        : nextForm.chosenMode === 'demo' || nextForm.chosenMode === 'full'
          ? nextForm.chosenMode
          : nextForm.demo === true
            ? 'demo'
            : null;
    const finalMode = existingModeRaw ?? incomingMode;
    if (finalMode === 'demo' || finalMode === 'full') {
      nextForm.mode = finalMode;
      nextForm.chosenMode = finalMode;
      nextForm.demo = finalMode === 'demo';
    }
  }

  await pool.query(
    `INSERT INTO onboarding_profiles (user_id, status, step, form, updated_at)
     VALUES ($1, $2, $3, COALESCE($4::jsonb, '{}'::jsonb), NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       status = EXCLUDED.status,
       step = EXCLUDED.step,
       form = CASE WHEN $4 IS NULL THEN onboarding_profiles.form ELSE EXCLUDED.form END,
       updated_at = NOW()`,
    [id, status, step, nextForm !== undefined ? JSON.stringify(nextForm) : null]
  );
  return (await getUserById(id)) ?? user;
}

const revokeListeners = new Set<(userId: string) => void>();

/** Lets the server drop live connections (WebSockets) when a user's tokens are revoked. */
export function onTokensRevoked(listener: (userId: string) => void): () => void {
  revokeListeners.add(listener);
  return () => revokeListeners.delete(listener);
}

/** Revokes every token issued to this user so far. */
export async function bumpTokenVersion(id: string): Promise<void> {
  await ensureReady();
  await pool.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [id]);
  for (const listener of revokeListeners) listener(id);
}

export function publicUser(user: UserRecord) {
  return {
    id: user.id,
    phone: user.phone,
    email: user.email,
    created_at: user.created_at,
    onboarding: user.onboarding,
  };
}
