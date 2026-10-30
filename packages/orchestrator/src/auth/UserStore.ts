/**
 * Signed-in users and their onboarding progress, persisted to .state/users.json
 * (gitignored). Small and single-process, so a JSON file is enough.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type OnboardingStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE';

export const ONBOARDING_STEPS = ['f1', '1a', '1b', '1c', '2a', '2b', '2c', '3_import'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface UserRecord {
  id: string;
  phone: string;
  created_at: string;
  last_login_at: string;
  token_version: number;
  onboarding: {
    status: OnboardingStatus;
    step: OnboardingStep | null;
    updated_at: string;
  };
}

/** Repo-root .state dir (src/auth -> repo root is four levels up). */
export const STATE_DIR =
  process.env.AUTH_STATE_DIR?.trim() ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../.state');

const USERS_FILE = path.join(STATE_DIR, 'users.json');
const SECRET_FILE = path.join(STATE_DIR, 'auth-secret');

let cache: Record<string, UserRecord> | null = null;

function load(): Record<string, UserRecord> {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')).users ?? {};
  } catch {
    cache = {};
  }
  return cache!;
}

function save(): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const tmp = `${USERS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ users: load() }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, USERS_FILE);
}

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

export function getUserByPhone(phone: string): UserRecord | null {
  return load()[phone] ?? null;
}

export function getUserById(id: string): UserRecord | null {
  return Object.values(load()).find((u) => u.id === id) ?? null;
}

/** Creates the user on first sign-in; returns it plus whether it was new. */
export function upsertUserOnLogin(phone: string): { user: UserRecord; isNew: boolean } {
  const users = load();
  const now = new Date().toISOString();
  const existing = users[phone];
  if (existing) {
    existing.last_login_at = now;
    save();
    return { user: existing, isNew: false };
  }
  const user: UserRecord = {
    id: crypto.randomUUID(),
    phone,
    created_at: now,
    last_login_at: now,
    token_version: 1,
    onboarding: { status: 'NOT_STARTED', step: null, updated_at: now },
  };
  users[phone] = user;
  save();
  return { user, isNew: true };
}

export function updateOnboarding(
  id: string,
  patch: { status?: OnboardingStatus; step?: OnboardingStep | null }
): UserRecord | null {
  const user = getUserById(id);
  if (!user) return null;
  // A finished onboarding never drops back to IN_PROGRESS from a stray step save.
  if (user.onboarding.status === 'COMPLETE' && patch.status !== 'COMPLETE' && patch.status !== 'NOT_STARTED') {
    return user;
  }
  user.onboarding = {
    status: patch.status ?? (patch.step ? 'IN_PROGRESS' : user.onboarding.status),
    step: patch.step !== undefined ? patch.step : user.onboarding.step,
    updated_at: new Date().toISOString(),
  };
  save();
  return user;
}

const revokeListeners = new Set<(userId: string) => void>();

/** Lets the server drop live connections (WebSockets) when a user's tokens are revoked. */
export function onTokensRevoked(listener: (userId: string) => void): () => void {
  revokeListeners.add(listener);
  return () => revokeListeners.delete(listener);
}

/** Revokes every token issued to this user so far. */
export function bumpTokenVersion(id: string): void {
  const user = getUserById(id);
  if (!user) return;
  user.token_version += 1;
  save();
  for (const listener of revokeListeners) listener(id);
}

export function publicUser(user: UserRecord) {
  return { id: user.id, phone: user.phone, created_at: user.created_at, onboarding: user.onboarding };
}
