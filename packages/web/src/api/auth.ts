// JWT session for the signed-in operator. The token comes from POST /api/auth/otp/verify
// and is sent as `Authorization: Bearer` on every /api call.

export type OnboardingStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE';

export interface AuthUser {
  id: string;
  phone: string;
  created_at: string;
  onboarding: { status: OnboardingStatus; step: string | null; updated_at: string };
}

const TOKEN_KEY = 'warden.auth.token';
let memoryToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function getToken(): string | null {
  if (memoryToken) return memoryToken;
  try {
    memoryToken = window.localStorage.getItem(TOKEN_KEY);
  } catch {
    /* storage blocked */
  }
  return memoryToken;
}

export function setToken(token: string | null): void {
  memoryToken = token;
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage blocked: token lives for this page only */
  }
}

/** Called once by the app shell; fires when any API call returns 401. */
export function onUnauthorized(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export function notifyUnauthorized(): void {
  if (getToken()) {
    setToken(null);
    unauthorizedHandler?.();
  }
}

export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** JSON request to /api/auth/*; never throws. */
export async function authRequest<T = any>(
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  try {
    const res = await fetch(`/api/auth/${path}`, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.ok !== false, status: res.status, data };
  } catch {
    return {
      ok: false,
      status: 0,
      data: { error: 'Cannot reach the Commando server. Is the orchestrator running?' } as T & { error?: string },
    };
  }
}

export async function fetchMe(): Promise<AuthUser | null> {
  if (!getToken()) return null;
  const r = await authRequest<{ user: AuthUser }>('me');
  if (r.status === 401) setToken(null);
  return r.ok ? r.data.user : null;
}

export async function saveOnboarding(patch: { step?: string | null; status?: OnboardingStatus }): Promise<AuthUser | null> {
  const r = await authRequest<{ user: AuthUser }>('me/onboarding', { method: 'PATCH', body: patch });
  return r.ok ? r.data.user : null;
}

export async function signOut(): Promise<void> {
  await authRequest('logout', { method: 'POST' });
  setToken(null);
}
