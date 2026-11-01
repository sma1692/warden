import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AuthRouteContext } from './routes.js';

/**
 * GitHub OAuth connect flow — the cloud-safe code-edit path.
 *
 * Agents never touch the user's local filesystem. Instead the user connects a
 * GitHub account once, picks a repo, and agents branch / edit / open PRs
 * directly on git. (Private folders stay reachable via the local runner.)
 *
 * Routes (all public: the GitHub token itself is the credential, held
 * server-side; harden with per-user binding before multi-tenant use):
 *  GET  /api/github/status      { configured, connected, login?, repo? }
 *  GET  /api/github/authorize   302 -> github.com OAuth consent
 *  GET  /api/github/callback    code exchange -> 302 back to the app
 *  GET  /api/github/repos       [{ full_name, private, default_branch, html_url }]
 *  POST /api/github/select      { repo_full_name } -> persists the edit target
 *  POST /api/github/disconnect  clears the stored token
 *
 * Env: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_REDIRECT_URL
 * (default redirect: http://localhost:4000/api/github/callback).
 * App return URL: WARDEN_APP_URL or PUBLIC_APP_URL (default http://localhost:5173).
 */

const STATE_TTL_MS = 10 * 60 * 1000;
const pendingStates = new Map<string, number>();

function stateFile(): string {
  return path.join(process.cwd(), '.state', 'github.json');
}

interface GithubPersisted {
  accessToken: string;
  login: string;
  repoFullName: string | null;
  connectedAt: string;
}

function loadPersisted(): GithubPersisted | null {
  try {
    const raw = fs.readFileSync(stateFile(), 'utf8');
    return JSON.parse(raw) as GithubPersisted;
  } catch {
    return null;
  }
}

function savePersisted(data: GithubPersisted): void {
  fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
  fs.writeFileSync(stateFile(), JSON.stringify(data, null, 2), 'utf8');
}

function clearPersisted(): void {
  try {
    fs.unlinkSync(stateFile());
  } catch {
    // already disconnected
  }
}

function clientId(): string {
  return process.env.GITHUB_CLIENT_ID || '';
}

function redirectUrl(req: IncomingMessage): string {
  if (process.env.GITHUB_REDIRECT_URL) return process.env.GITHUB_REDIRECT_URL;
  const host = req.headers.host || 'localhost:4000';
  const proto =
    (req.headers['x-forwarded-proto'] as string) ||
    (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}/api/github/callback`;
}

function appBaseUrl(): string {
  return (
    process.env.WARDEN_APP_URL ||
    process.env.PUBLIC_APP_URL ||
    'http://localhost:5173'
  ).replace(/\/$/, '');
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location });
  res.end();
}

async function exchangeCode(code: string, redirectUri: string): Promise<string | null> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: clientId(),
      client_secret: process.env.GITHUB_CLIENT_SECRET || '',
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string; error?: string };
  return data.access_token || null;
}

async function fetchLogin(accessToken: string): Promise<string | null> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'warden-control-plane',
    },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { login?: string };
  return data.login || null;
}

export async function handleGithubRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: AuthRouteContext
): Promise<boolean> {
  const { pathname, method, readJsonBody, sendJson } = ctx;
  if (!pathname.startsWith('/api/github/')) return false;

  if (pathname === '/api/github/status' && method === 'GET') {
    const saved = loadPersisted();
    sendJson(res, 200, {
      ok: true,
      configured: Boolean(clientId() && process.env.GITHUB_CLIENT_SECRET),
      connected: Boolean(saved?.accessToken),
      login: saved?.login || null,
      repo: saved?.repoFullName || null,
    });
    return true;
  }

  if (pathname === '/api/github/authorize' && method === 'GET') {
    if (!clientId() || !process.env.GITHUB_CLIENT_SECRET) {
      sendJson(res, 503, {
        ok: false,
        error:
          'GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, then retry. Paste a repo URL instead to continue without OAuth.',
      });
      return true;
    }
    const state = randomBytes(16).toString('hex');
    pendingStates.set(state, Date.now() + STATE_TTL_MS);
    const params = new URLSearchParams({
      client_id: clientId(),
      redirect_uri: redirectUrl(req),
      scope: 'repo',
      state,
    });
    redirect(res, `https://github.com/login/oauth/authorize?${params.toString()}`);
    return true;
  }

  if (pathname === '/api/github/callback' && method === 'GET') {
    const url = new URL(req.url || '/', 'http://localhost');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const expires = state ? pendingStates.get(state) : undefined;
    if (state) pendingStates.delete(state);
    if (!code || !expires || expires < Date.now()) {
      redirect(res, `${appBaseUrl()}/?github=error&reason=bad_state`);
      return true;
    }
    try {
      const token = await exchangeCode(code, redirectUrl(req));
      if (!token) {
        redirect(res, `${appBaseUrl()}/?github=error&reason=exchange_failed`);
        return true;
      }
      const login = (await fetchLogin(token)) || 'github-user';
      savePersisted({
        accessToken: token,
        login,
        repoFullName: loadPersisted()?.repoFullName || null,
        connectedAt: new Date().toISOString(),
      });
      redirect(
        res,
        `${appBaseUrl()}/?github=connected&login=${encodeURIComponent(login)}`
      );
    } catch {
      redirect(res, `${appBaseUrl()}/?github=error&reason=callback_failed`);
    }
    return true;
  }

  if (pathname === '/api/github/repos' && method === 'GET') {
    const saved = loadPersisted();
    if (!saved?.accessToken) {
      sendJson(res, 401, { ok: false, error: 'GitHub is not connected.' });
      return true;
    }
    const url = new URL(req.url || '/', 'http://localhost');
    const perPage = Math.min(
      100,
      Math.max(1, Number(url.searchParams.get('per_page')) || 30)
    );
    const gh = await fetch(
      `https://api.github.com/user/repos?per_page=${perPage}&sort=updated`,
      {
        headers: {
          Authorization: `Bearer ${saved.accessToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'warden-control-plane',
        },
      }
    );
    if (!gh.ok) {
      sendJson(res, 502, { ok: false, error: 'GitHub API request failed.' });
      return true;
    }
    const repos = (await gh.json()) as Array<{
      full_name: string;
      private: boolean;
      default_branch: string;
      html_url: string;
    }>;
    sendJson(res, 200, {
      ok: true,
      repos: repos.map((r) => ({
        full_name: r.full_name,
        private: r.private,
        default_branch: r.default_branch,
        html_url: r.html_url,
      })),
    });
    return true;
  }

  if (pathname === '/api/github/select' && method === 'POST') {
    const saved = loadPersisted();
    if (!saved?.accessToken) {
      sendJson(res, 401, { ok: false, error: 'GitHub is not connected.' });
      return true;
    }
    const body = await readJsonBody();
    const repoFullName = String(body.repo_full_name || '').trim();
    if (!repoFullName || !repoFullName.includes('/')) {
      sendJson(res, 400, { ok: false, error: 'Pass repo_full_name as owner/repo.' });
      return true;
    }
    savePersisted({ ...saved, repoFullName });
    sendJson(res, 200, { ok: true, repo: repoFullName });
    return true;
  }

  if (pathname === '/api/github/disconnect' && method === 'POST') {
    clearPersisted();
    sendJson(res, 200, { ok: true, connected: false });
    return true;
  }

  return false;
}
