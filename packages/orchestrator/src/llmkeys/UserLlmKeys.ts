/**
 * Per-user Meta Muse API keys (BYOK).
 *
 * Operators can store their own Meta Muse key so their runs bill to them
 * instead of the shared platform pool. Until a user adds a key, runs use the
 * platform pool while their `user_budgets` cap lasts; once exhausted, runs
 * pause until they add a key.
 *
 * Keys are AES-256-GCM encrypted with a server-side secret before Postgres.
 * Only the last-4 hint ever leaves the server. If the secret is lost or
 * rotated, stored keys fail to decrypt and are treated as missing — the user
 * simply re-enters their key.
 *
 * Secret: LLM_KEY_SECRET env, else generated once into `.state/llm-key-secret`
 * (0600, gitignored — same pattern as `.state/auth-secret`).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

export interface LlmKeyStatus {
  has_key: boolean;
  key_hint: string | null;
  validated_at: string | null;
}

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://warden:warden_secret@localhost:5432/warden';

const pool = new Pool({ connectionString: DATABASE_URL, max: 5 });

const KEY_DDL = `
CREATE TABLE IF NOT EXISTS user_llm_keys (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'meta_muse',
  key_encrypted TEXT NOT NULL,
  key_hint TEXT NOT NULL,
  validated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`;

let ready: Promise<void> | null = null;
function ensureReady(): Promise<void> {
  if (!ready) {
    ready = pool
      .query(KEY_DDL)
      .then(() => undefined)
      .catch((err) => {
        ready = null;
        throw err;
      });
  }
  return ready;
}

/** Test/CLI hook to drain the pool so the process can exit. */
export async function closeLlmKeysPool(): Promise<void> {
  await pool.end().catch(() => undefined);
}

let cachedSecret: Buffer | null = null;

/** 32-byte AES key: env override, else a persisted generated secret. */
export function getKeySecret(): Buffer {
  if (cachedSecret) return cachedSecret;
  const fromEnv = (process.env.LLM_KEY_SECRET || '').trim();
  if (fromEnv) {
    cachedSecret = crypto.createHash('sha256').update(fromEnv, 'utf8').digest();
    return cachedSecret;
  }
  const file = path.join(process.cwd(), '.state', 'llm-key-secret');
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{64}$/i.test(raw)) {
      cachedSecret = Buffer.from(raw, 'hex');
      return cachedSecret;
    }
  } catch {
    // missing or unreadable: generate below
  }
  const fresh = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, fresh.toString('hex'), { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // best effort on restrictive filesystems
  }
  cachedSecret = fresh;
  return cachedSecret;
}

export function encryptKey(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKeySecret(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${Buffer.concat([iv, tag, ct]).toString('base64')}`;
}

/** Returns null when the blob is corrupt or was encrypted with another secret. */
export function decryptKey(blob: string): string | null {
  try {
    if (!blob.startsWith('v1:')) return null;
    const raw = Buffer.from(blob.slice(3), 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKeySecret(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function keyHint(raw: string): string {
  const tail = raw.trim().slice(-4);
  return `••••${tail}`;
}

/** Decrypted user key, or null when none is stored (or it no longer decrypts). */
export async function getUserLlmKey(userId: string): Promise<string | null> {
  if (!userId) return null;
  await ensureReady();
  const res = await pool.query<{ key_encrypted: string }>(
    'SELECT key_encrypted FROM user_llm_keys WHERE user_id = $1',
    [userId]
  );
  const blob = res.rows[0]?.key_encrypted;
  if (!blob) return null;
  const plain = decryptKey(blob);
  if (!plain) {
    console.warn(
      '[UserLlmKeys] Stored key for user failed to decrypt (secret rotated?); treating as missing.'
    );
  }
  return plain;
}

export async function hasUserLlmKey(userId: string): Promise<boolean> {
  return (await getUserLlmKey(userId)) !== null;
}

/** Masked status safe to send to the dashboard. */
export async function getUserLlmKeyStatus(userId: string): Promise<LlmKeyStatus> {
  if (!userId) return { has_key: false, key_hint: null, validated_at: null };
  await ensureReady();
  const res = await pool.query<{ key_hint: string; validated_at: Date | string | null }>(
    'SELECT key_hint, validated_at FROM user_llm_keys WHERE user_id = $1',
    [userId]
  );
  const row = res.rows[0];
  if (!row) return { has_key: false, key_hint: null, validated_at: null };
  // A row that no longer decrypts counts as missing everywhere.
  if ((await getUserLlmKey(userId)) === null) {
    return { has_key: false, key_hint: null, validated_at: null };
  }
  return {
    has_key: true,
    key_hint: row.key_hint,
    validated_at:
      row.validated_at instanceof Date
        ? row.validated_at.toISOString()
        : (row.validated_at ?? null),
  };
}

function metaMuseBaseUrl(): string {
  return (process.env.META_MUSE_BASE_URL || 'https://api.meta.ai/v1').replace(/\/+$/, '');
}

/**
 * One tiny chat call to prove the key works before storing it.
 * 401/403/402 verdicts are definitive; anything else is "could not verify".
 */
export async function validateMetaMuseKey(
  rawKey: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = rawKey.trim();
  if (key.length < 8) return { ok: false, error: 'That key looks too short. Paste the full Meta Muse API key.' };
  let res: Response;
  try {
    res = await fetch(`${metaMuseBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'muse-spark-1.3',
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 4,
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { ok: false, error: 'Could not reach Meta to verify the key. Try again.' };
  }
  if (res.ok) return { ok: true };
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: 'Meta rejected this key (unauthorized). Check it at dev.meta.ai and try again.' };
  }
  if (res.status === 402) {
    return { ok: false, error: 'This key has no Meta credit left. Top it up, then try again.' };
  }
  return { ok: false, error: `Meta returned HTTP ${res.status}; could not verify the key. Try again.` };
}

/** Validates, then stores (one row per user). Throws on validation failure. */
export async function saveUserLlmKey(
  userId: string,
  rawKey: string
): Promise<LlmKeyStatus> {
  const key = rawKey.trim();
  const verdict = await validateMetaMuseKey(key);
  if (verdict.ok === false) throw new Error(verdict.error);
  await ensureReady();
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO user_llm_keys (user_id, provider, key_encrypted, key_hint, validated_at, updated_at)
     VALUES ($1, 'meta_muse', $2, $3, $4, $4)
     ON CONFLICT (user_id) DO UPDATE SET
       key_encrypted = EXCLUDED.key_encrypted,
       key_hint = EXCLUDED.key_hint,
       validated_at = EXCLUDED.validated_at,
       updated_at = EXCLUDED.updated_at`,
    [userId, encryptKey(key), keyHint(key), now]
  );
  return { has_key: true, key_hint: keyHint(key), validated_at: now };
}

export async function deleteUserLlmKey(userId: string): Promise<void> {
  if (!userId) return;
  await ensureReady();
  await pool.query('DELETE FROM user_llm_keys WHERE user_id = $1', [userId]);
}
