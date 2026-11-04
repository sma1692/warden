// Single registry for every localStorage key plus throw-safe helpers.
// Restricted environments (private mode, blocked storage) degrade to
// in-memory behavior instead of crashing the caller.

export const StorageKeys = {
  /** Dashboard light/dark theme. */
  theme: 'warden_surface_theme',
  /** JWT session token (mirrored in memory by api/auth). */
  authToken: 'warden.auth.token',
  /** Consultation knob config JSON. */
  consultationKnob: 'warden_consultation_knob_v1',
  /** Gallery-mode onboarding resume step. */
  onboardingStep: 'warden_onboarding_saved_step_v1',
} as const;

export type StorageKey = (typeof StorageKeys)[keyof typeof StorageKeys];

export function readStorage(key: StorageKey): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: StorageKey, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage blocked */
  }
}

export function removeStorage(key: StorageKey): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* storage blocked */
  }
}

export function readStorageJson<T>(key: StorageKey): T | null {
  const raw = readStorage(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeStorageJson(key: StorageKey, value: unknown): void {
  try {
    writeStorage(key, JSON.stringify(value));
  } catch {
    /* unserializable or storage blocked */
  }
}
