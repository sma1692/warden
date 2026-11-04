// JWT session for the signed-in operator. The token comes from POST /api/auth/otp/verify
// and is sent as `Authorization: Bearer` on every /api call.
import { API_BASE } from './base';
import { StorageKeys, readStorage, removeStorage, writeStorage } from '../utils/storage';

export type OnboardingStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE';

export interface AuthUser {
  id: string;
  phone: string;
  email?: string | null;
  created_at: string;
  onboarding: {
    status: OnboardingStatus;
    step: string | null;
    form: Record<string, any> | null;
    updated_at: string;
  };
}

let memoryToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function getToken(): string | null {
  if (memoryToken) return memoryToken;
  memoryToken = readStorage(StorageKeys.authToken);
  return memoryToken;
}

export function setToken(token: string | null): void {
  memoryToken = token;
  // Storage blocked: the token lives for this page only.
  if (token) writeStorage(StorageKeys.authToken, token);
  else removeStorage(StorageKeys.authToken);
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
    const res = await fetch(`${API_BASE}/auth/${path}`, {
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
      data: { error: 'Unable to connect right now. Please try again in a moment.' } as T & { error?: string },
    };
  }
}

export async function fetchMe(): Promise<AuthUser | null> {
  if (!getToken()) return null;
  const r = await authRequest<{ user: AuthUser }>('me');
  if (r.status === 401) setToken(null);
  return r.ok ? r.data.user : null;
}

export async function saveOnboarding(patch: {
  step?: string | null;
  status?: OnboardingStatus;
  form?: Record<string, any>;
}): Promise<AuthUser | null> {
  const r = await authRequest<{ user: AuthUser }>('me/onboarding', { method: 'PATCH', body: patch });
  return r.ok ? r.data.user : null;
}

export async function signOut(): Promise<void> {
  await authRequest('logout', { method: 'POST' });
  setToken(null);
}

export interface WhatsAppLoginRequest {
  id: string;
  code: string;
  message: string;
  wa_link: string;
  business_number: string;
  expires_at: string;
}

export interface WhatsAppLoginStatus {
  status: 'PENDING' | 'VERIFIED' | 'EXPIRED';
  token?: string;
  is_new_user?: boolean;
  user?: AuthUser;
}

/** Starts a click-to-chat WhatsApp sign-in; 503 means the server has no business number. */
export function startWhatsAppSignIn(): Promise<{
  ok: boolean;
  status: number;
  data: WhatsAppLoginRequest & { error?: string };
}> {
  return authRequest<WhatsAppLoginRequest>('wa/start', { method: 'POST' });
}

/** Polls a pending WhatsApp sign-in until the webhook verifies the sender. */
export function checkWhatsAppSignIn(
  id: string
): Promise<{ ok: boolean; status: number; data: WhatsAppLoginStatus & { error?: string } }> {
  return authRequest<WhatsAppLoginStatus>(`wa/status?id=${encodeURIComponent(id)}`);
}
