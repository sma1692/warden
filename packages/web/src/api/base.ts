// Single source of truth for the control-plane API + WebSocket endpoints.
//
// Local dev default is same-origin: `/api` (proxied to the orchestrator by
// Vite) and a WS URL derived from window.location.
// Stag/prod builds bake in absolute URLs via VITE_API_URL / VITE_WS_URL,
// injected by `npm run build` (see scripts/build.mjs).

function readEnv(name: string): string {
  try {
    return (import.meta.env?.[name] as string | undefined ?? '').replace(/\/+$/, '');
  } catch {
    return '';
  }
}

const apiOrigin = readEnv('VITE_API_URL');

/** REST base: absolute in stag/prod builds, `/api` locally. */
export const API_BASE = apiOrigin ? `${apiOrigin}/api` : '/api';

/** Absolute WS endpoint for the control plane. Falls back to same-host. */
export function wsUrl(token: string): string {
  const rawWs = readEnv('VITE_WS_URL');
  if (rawWs) return `${rawWs}?token=${encodeURIComponent(token)}`;
  if (apiOrigin) {
    const proto = apiOrigin.startsWith('https:') ? 'wss:' : 'ws:';
    return `${proto}//${apiOrigin.replace(/^https?:\/\//, '')}/ws?token=${encodeURIComponent(token)}`;
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
}
