import type { IncomingMessage, ServerResponse } from 'node:http';

export interface DemoMetadata {
  userId: string;
  version: string;
  versionNumber: number;
  updatedAt: string;
  timestamp: number;
  lastDeployedAt: string | null;
  status: string;
  deployUrl: string | null;
  subdomain?: string | null;
  projectName?: string | null;
}

const metadataStore = new Map<string, DemoMetadata>();

/**
 * Initializes or retrieves existing demo metadata for a user.
 */
function getOrInitMetadata(userId: string): DemoMetadata {
  const existing = metadataStore.get(userId);
  if (existing) {
    return existing;
  }
  const now = new Date();
  const initial: DemoMetadata = {
    userId,
    version: 'v1',
    versionNumber: 1,
    updatedAt: now.toISOString(),
    timestamp: now.getTime(),
    lastDeployedAt: null,
    status: 'NOT_DEPLOYED',
    deployUrl: null,
    subdomain: null,
    projectName: null,
  };
  metadataStore.set(userId, initial);
  return initial;
}

/**
 * Returns demo metadata for a user, including the current version (e.g. v1, v2)
 * and timestamp of the update.
 */
export function getDemoMetadata(userId: string): DemoMetadata {
  return { ...getOrInitMetadata(userId) };
}

/**
 * Normalizes a Pages deploy URL so it never becomes a dead <hash>.pages.dev link.
 * Working Cloudflare URLs are preserved as-is; only hash-prefixed preview URLs
 * are healed to the canonical https://<projectName>.pages.dev/ project URL.
 * The custom .warden.autos domain is served separately once its attach verifies.
 */
export function normalizeDeployUrl(
  rawUrl: string | null | undefined,
  projectName?: string | null
): string | null {
  if (!rawUrl) {
    return projectName ? `https://${projectName}.pages.dev/` : null;
  }

  const trimmed = rawUrl.trim();
  try {
    const parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    const host = parsed.hostname.toLowerCase();

    if (host.endsWith('.warden.autos')) {
      const parts = host.replace(/\.warden\.autos$/, '').split('.').filter(Boolean);
      if (parts.length > 1) {
        // Deployment preview or hash URL: <hash>.<projectName>.warden.autos
        const proj = projectName || parts[parts.length - 1];
        return `https://${proj}.warden.autos/`;
      }
      if (parts.length === 1) {
        const single = parts[0];
        if (projectName && single !== projectName && /^[a-f0-9]{7,}$/i.test(single)) {
          return `https://${projectName}.warden.autos/`;
        }
        return `https://${single}.warden.autos/`;
      }
      return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
    }

    if (host.endsWith('.pages.dev')) {
      const parts = host.replace(/\.pages\.dev$/, '').split('.').filter(Boolean);
      if (parts.length > 1) {
        // Deployment preview URL: <hash>.<projectName>.pages.dev
        // Heal to the canonical Cloudflare project URL, never a hash link.
        const proj = projectName || parts[parts.length - 1];
        return `https://${proj}.pages.dev/`;
      }
      if (parts.length === 1) {
        const single = parts[0];
        // Dead link check: if single part is a hex hash and projectName is known, heal it
        if (projectName && single !== projectName && /^[a-f0-9]{7,}$/i.test(single)) {
          return `https://${projectName}.pages.dev/`;
        }
        return `https://${single}.pages.dev/`;
      }
    }
    return trimmed;
  } catch {
    return trimmed;
  }
}

/**
 * Called when a new version is deployed.
 * Increments the version number (e.g. v1 -> v2) and sets the update timestamp.
 */
export function recordDeployment(
  userId: string,
  details?: {
    deployUrl?: string | null;
    status?: string;
    subdomain?: string | null;
    projectName?: string | null;
    version?: string;
    increment?: boolean;
  }
): DemoMetadata {
  const current = getOrInitMetadata(userId);
  let nextVersionNumber: number;

  if (details?.version) {
    const parsed = parseInt(details.version.replace(/^v/i, ''), 10);
    nextVersionNumber = isNaN(parsed) ? current.versionNumber + 1 : parsed;
  } else if (details?.increment === true) {
    nextVersionNumber = current.versionNumber + 1;
  } else if (current.lastDeployedAt !== null) {
    // Already deployed at least once: deploying a new version increments it (e.g. v1 -> v2, v2 -> v3)
    nextVersionNumber = current.versionNumber + 1;
  } else {
    // First deployment: stays v1 (or current versionNumber)
    nextVersionNumber = current.versionNumber >= 1 ? current.versionNumber : 1;
  }

  let resolvedProject = details?.projectName !== undefined ? details.projectName : current.projectName;
  let resolvedSubdomain = details?.subdomain !== undefined ? details.subdomain : current.subdomain;
  let rawUrl = details?.deployUrl !== undefined ? details.deployUrl : current.deployUrl;

  // Infer project name if missing from deployUrl with multiple parts
  if (!resolvedProject && rawUrl) {
    try {
      const parsed = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
      if (parsed.hostname.endsWith('.warden.autos')) {
        const parts = parsed.hostname.replace(/\.warden\.autos$/, '').split('.').filter(Boolean);
        if (parts.length > 1) {
          resolvedProject = parts[parts.length - 1];
        } else if (parts.length === 1 && !/^[a-f0-9]{7,}$/i.test(parts[0])) {
          resolvedProject = parts[0];
        }
      } else if (parsed.hostname.endsWith('.pages.dev')) {
        const parts = parsed.hostname.replace(/\.pages\.dev$/, '').split('.').filter(Boolean);
        if (parts.length > 1) {
          resolvedProject = parts[parts.length - 1];
        } else if (parts.length === 1 && !/^[a-f0-9]{7,}$/i.test(parts[0])) {
          resolvedProject = parts[0];
        }
      }
    } catch {}
  }

  // Normalize URL to prevent dead <hash>.pages.dev links
  const normalizedUrl = normalizeDeployUrl(rawUrl, resolvedProject);

  // If subdomain was mistakenly set to a dead hash, heal it
  if (resolvedProject && (!resolvedSubdomain || /^[a-f0-9]{7,}$/i.test(resolvedSubdomain))) {
    resolvedSubdomain = resolvedProject;
  }

  const now = new Date();
  const updated: DemoMetadata = {
    ...current,
    versionNumber: nextVersionNumber,
    version: `v${nextVersionNumber}`,
    updatedAt: now.toISOString(),
    timestamp: now.getTime(),
    lastDeployedAt: now.toISOString(),
    status: details?.status || 'ACTIVE',
    deployUrl: normalizedUrl,
    subdomain: resolvedSubdomain,
    projectName: resolvedProject,
  };

  metadataStore.set(userId, updated);
  return { ...updated };
}

/**
 * Explicitly increment the demo version and update timestamp.
 */
export function incrementDemoVersion(
  userId: string,
  details?: {
    deployUrl?: string | null;
    status?: string;
    subdomain?: string | null;
    projectName?: string | null;
  }
): DemoMetadata {
  return recordDeployment(userId, { ...details, increment: true });
}

/**
 * Resets metadata store (primarily for unit tests).
 */
export function resetDemoMetadata(userId?: string): void {
  if (userId) {
    metadataStore.delete(userId);
  } else {
    metadataStore.clear();
  }
}

export interface DemoStatusRouteCtx {
  pathname: string;
  method: string;
  requestUserId: string | null;
  sendJson: (res: ServerResponse, status: number, body: unknown) => void;
}

/**
 * Handles HTTP route requests for demo status/metadata:
 * GET /api/demo/status or /api/demo/metadata
 */
export async function handleDemoStatusRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: DemoStatusRouteCtx
): Promise<boolean> {
  const { pathname, method, requestUserId } = ctx;
  if (pathname !== '/api/demo/status' && pathname !== '/api/demo/metadata') {
    return false;
  }

  const urlObj = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
  const queryUserId = urlObj.searchParams.get('userId') || urlObj.searchParams.get('user_id');
  const targetUser = requestUserId || queryUserId;

  if (!targetUser) {
    ctx.sendJson(res, 401, { ok: false, error: 'Not signed in' });
    return true;
  }

  if (method === 'GET') {
    const metadata = getDemoMetadata(targetUser);
    ctx.sendJson(res, 200, { ok: true, metadata });
    return true;
  }

  return false;
}
