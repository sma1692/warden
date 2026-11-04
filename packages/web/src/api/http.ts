import { authHeaders, notifyUnauthorized } from './auth';
import { API_BASE } from './base';
import type { UserBudget } from '../types/warden';
import type { WsEventPayload } from './types';

export interface HttpHooks {
  emit: (event: WsEventPayload) => void;
  ensureSeeds: () => Promise<void>;
}

const TOKEN_LIMIT_MESSAGE =
  'Token limit reached! Your chat quota is exhausted — add your Meta Muse key in Settings to continue.';

async function request(
  path: string,
  init: RequestInit | undefined,
  timeoutMs: number
): Promise<Response | null> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
        ...(init?.headers || {}),
      },
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

/**
 * Network-first fetch returning the decoded body or null. Never throws except
 * for token-cap exhaustion, which callers surface as an error toast.
 */
export async function safeFetch<T>(
  hooks: HttpHooks,
  path: string,
  init?: RequestInit,
  timeoutMs: number = 45_000
): Promise<T | null> {
  await hooks.ensureSeeds();
  try {
    const res = await request(path, init, timeoutMs);
    if (!res) return null;
    if (res.status === 401) {
      notifyUnauthorized();
      return null;
    }
    if (res.status === 429 || res.status === 402) {
      const errData = (await res.json().catch(() => null)) as {
        code?: string;
        error?: string;
        budget?: UserBudget;
      } | null;
      if (errData?.code === 'TOKEN_CAP_EXCEEDED' || res.status === 402) {
        hooks.emit({
          type: 'BUDGET_EXCEEDED',
          data: { error: errData?.error || TOKEN_LIMIT_MESSAGE, budget: errData?.budget },
        });
        throw new Error(errData?.error || TOKEN_LIMIT_MESSAGE);
      }
    }
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof Error && err.message.includes('Token limit reached')) {
      throw err;
    }
    return null;
  }
}

/** Envelope fetch for `{ ok, ... }` APIs: always resolves a typed result. */
export async function keyFetch<T>(
  hooks: HttpHooks,
  path: string,
  init?: RequestInit,
  timeoutMs: number = 45_000
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  await hooks.ensureSeeds();
  try {
    const res = await request(path, init, timeoutMs);
    if (!res) {
      return { ok: false, error: 'Unable to connect right now. Please try again in a moment.' };
    }
    if (res.status === 401) {
      notifyUnauthorized();
      return { ok: false, error: 'Not signed in.' };
    }
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
    } | null;
    if (!res.ok || !data || data.ok === false) {
      return { ok: false, error: data?.error || `Request failed (HTTP ${res.status}).` };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: 'Unable to connect right now. Please try again in a moment.' };
  }
}
