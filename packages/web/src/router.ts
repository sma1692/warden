/**
 * Tiny history-synced router for the Warden dashboard (no dependency).
 *
 * Every screen the app can show maps to a real path, so refresh, deep links,
 * and Back/Forward keep working. Navigation helpers push history entries;
 * components listen for `popstate` to restore state on Back/Forward.
 *
 * Route map:
 * - `/`                    landing (fresh boot shows the loader first)
 * - `/login`, `/otp`       auth steps
 * - `/onboarding/<step>`   onboarding steps (f1, 1a…2c, 3_import)
 * - `/home` (`/dashboard`) dashboard tabs: home, agents, reports, backlogs, seo, settings
 */

export const APP_TABS = ['home', 'agents', 'reports', 'backlogs', 'seo', 'settings'] as const;
export type AppTab = (typeof APP_TABS)[number];

export const ONBOARDING_STEPS = [
  'f1',
  '1a',
  '1b',
  '1c',
  '2a',
  '2b',
  '2c',
  '3_import',
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

const AUTH_STEPS = ['landing', 'architecture', 'security', 'docs', 'login', 'otp'] as const;

function normalize(pathname: string): string {
  if (!pathname) return '/';
  const path = pathname.split('?')[0].split('#')[0];
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path || '/';
}

/** Deep-linkable auth/onboarding step for a path, or null when it is not an auth path. */
export function authStepForPath(pathname: string): string | null {
  const path = normalize(pathname);
  if (path === '/') return 'landing';
  if (path === '/architecture') return 'architecture';
  if (path === '/security') return 'security';
  if (path === '/docs') return 'docs';
  if (path === '/login') return 'login';
  if (path === '/otp') return 'otp';
  if (path.startsWith('/onboarding/')) {
    const step = path.slice('/onboarding/'.length);
    if ((ONBOARDING_STEPS as readonly string[]).includes(step)) return step;
    return null;
  }
  return null;
}

/** Canonical path for an auth/onboarding step id. `loading` shares `/` with landing. */
export function pathForAuthStep(step: string): string {
  if (step === 'architecture') return '/architecture';
  if (step === 'security') return '/security';
  if (step === 'docs') return '/docs';
  if (step === 'login') return '/login';
  if (step === 'otp') return '/otp';
  if ((ONBOARDING_STEPS as readonly string[]).includes(step)) return `/onboarding/${step}`;
  if ((AUTH_STEPS as readonly string[]).includes(step)) return '/';
  return '/';
}

/** Dashboard tab for a path (`/dashboard` is an alias of home), or null. */
export function appTabForPath(pathname: string): string | null {
  const path = normalize(pathname);
  if (path === '/dashboard') return 'home';
  if (path === '/activity') return 'reports';
  const tab = path.startsWith('/') ? path.slice(1) : path;
  if ((APP_TABS as readonly string[]).includes(tab)) return tab;
  return null;
}

/** Canonical path for a dashboard tab. Dynamic window tabs resolve to their parent. */
export function pathForAppTab(tab: string): string {
  if (tab.startsWith('win-agent-')) return '/agents';
  if (tab.startsWith('win-report-') || tab === 'reports') return '/activity';
  if ((APP_TABS as readonly string[]).includes(tab)) return `/${tab}`;
  return '/home';
}

export function isAuthPath(pathname: string): boolean {
  return authStepForPath(pathname) !== null;
}

export function isAppPath(pathname: string): boolean {
  return appTabForPath(pathname) !== null;
}

export function getPathname(): string {
  if (typeof window === 'undefined') return '/';
  return normalize(window.location.pathname);
}

/**
 * Move to a path. No-op when already there. `replace` avoids adding a history
 * entry (initial mount, loader transitions, window-tab switches).
 */
export function navigateTo(path: string, opts?: { replace?: boolean }): void {
  if (typeof window === 'undefined') return;
  const target = normalize(path);
  if (normalize(window.location.pathname) === target) return;
  if (opts?.replace) {
    window.history.replaceState(null, '', target);
  } else {
    window.history.pushState(null, '', target);
  }
}

/** Subscribe to Back/Forward navigation. Returns an unsubscribe function. */
export function onLocationChange(listener: (pathname: string) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => listener(getPathname());
  window.addEventListener('popstate', handler);
  return () => window.removeEventListener('popstate', handler);
}
