import type { IncomingMessage, ServerResponse } from 'node:http';
import { ensureDemoFolder } from '../../demo/DemoFolders.js';
import { deployDemoProject, sanitizeSubdomain, cloudflareConfigured } from '../../demo/CloudflareDeployer.js';
import { getDemoMetadata, recordDeployment, type DemoMetadata } from '../../handlers/demoStatus.js';
import { getDemoWorkspace, recordDemoDeploy } from '../../demo/DemoProvisioning.js';

export const DEMO_BASE_DOMAIN =
  (process.env.DEMO_BASE_DOMAIN || 'warden.autos').trim();

/**
 * Builds a clean, unique DNS-compliant subdomain label.
 * Logic ensures format `<unique-subdomain>.warden.autos`.
 */
export function buildUniqueSubdomain(
  userId: string,
  gameId = 'demo-arena',
  customSubdomain?: string
): string {
  if (customSubdomain && customSubdomain.trim()) {
    let raw = customSubdomain.trim();
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      try {
        raw = new URL(raw).hostname;
      } catch {
        raw = raw.replace(/^https?:\/\//i, '').split('/')[0];
      }
    }
    raw = raw.split('/')[0].split('?')[0].split('#')[0];
    raw = raw.replace(/\.(warden\.autos|pages\.dev)$/i, '');
    const basePattern = new RegExp(`\\.${DEMO_BASE_DOMAIN}$`, 'i');
    raw = raw.replace(basePattern, '');

    // Prevent bug where <hash>.<projectName> extracts only <hash> to form dead link.
    // Extract canonical projectName (last segment) if multiple segments are present.
    if (raw.includes('.')) {
      const parts = raw.split('.').filter(Boolean);
      raw = parts[parts.length - 1];
    }
    return sanitizeSubdomain(raw, 58);
  }
  const cleanUser = userId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toLowerCase() || 'user';
  const cleanGame = sanitizeSubdomain(gameId, 25) || 'arena';
  return `u${cleanUser}-${cleanGame}`;
}

/**
 * Returns the fully qualified domain name `<unique-subdomain>.warden.autos`
 */
export function getDemoSubdomainFqdn(subdomain: string, baseDomain = DEMO_BASE_DOMAIN): string {
  let clean = subdomain.trim();
  if (clean.startsWith('http://') || clean.startsWith('https://')) {
    try {
      clean = new URL(clean).hostname;
    } catch {
      clean = clean.replace(/^https?:\/\//i, '').split('/')[0];
    }
  }
  clean = clean.split('/')[0].split('?')[0].split('#')[0];
  clean = clean.replace(/\.(warden\.autos|pages\.dev)$/i, '');
  const basePattern = new RegExp(`\\.${baseDomain}$`, 'i');
  clean = clean.replace(basePattern, '');

  // Prevent bug where <hash>.<projectName> extracts only <hash>.
  // Preserve full hostname or extract canonical project name.
  if (clean.includes('.')) {
    const parts = clean.split('.').filter(Boolean);
    clean = parts[parts.length - 1];
  }
  const cleanSubdomain = sanitizeSubdomain(clean);
  return `${cleanSubdomain}.${baseDomain}`;
}

/**
 * Returns the full HTTPS URL `https://<unique-subdomain>.warden.autos`
 */
export function getDemoSubdomainUrl(subdomain: string, baseDomain = DEMO_BASE_DOMAIN): string {
  return `https://${getDemoSubdomainFqdn(subdomain, baseDomain)}`;
}

/**
 * Resolves the unique subdomain details for a user and game:
 * returns `<unique-subdomain>`, `<unique-subdomain>.warden.autos`, and HTTPS URL.
 */
export function resolveDemoSubdomain(
  userId: string,
  gameId = 'demo-arena',
  customSubdomain?: string,
  baseDomain = DEMO_BASE_DOMAIN
): { subdomain: string; fqdn: string; url: string } {
  const subdomain = buildUniqueSubdomain(userId, gameId, customSubdomain);
  const fqdn = getDemoSubdomainFqdn(subdomain, baseDomain);
  const url = getDemoSubdomainUrl(subdomain, baseDomain);
  return { subdomain, fqdn, url };
}

export interface SpawnDemoOptions {
  gameId?: string;
  customSubdomain?: string;
}

export interface SpawnDemoResult {
  ok: boolean;
  subdomain: string;
  fqdn: string;
  url: string;
  localDir: string;
  metadata: DemoMetadata;
}

/**
 * Spawns the demo path for a user, provisioning the isolated scaffold
 * and configuring the unique `<unique-subdomain>.pages.dev` path.
 */
export async function spawnDemoPath(
  userId: string,
  options?: SpawnDemoOptions
): Promise<SpawnDemoResult> {
  const gameId = options?.gameId || 'demo-arena';
  const { subdomain, fqdn, url } = resolveDemoSubdomain(userId, gameId, options?.customSubdomain);
  const { dir } = ensureDemoFolder(userId);

  const metadata = recordDeployment(userId, {
    subdomain,
    projectName: subdomain,
    deployUrl: url,
    status: 'NOT_DEPLOYED',
  });

  return {
    ok: true,
    subdomain,
    fqdn,
    url,
    localDir: dir,
    metadata,
  };
}

export interface DeployDemoPathResult {
  ok: boolean;
  subdomain: string;
  fqdn: string;
  url: string;
  pagesDevUrl: string | null;
  status: string;
  metadata: DemoMetadata;
  rawDeployResult: any;
}

/**
 * Deploys the demo path to Cloudflare and returns the `.warden.autos` URL.
 * Automatically increments the version number (v1, v2, ...) and records the update timestamp.
 */
export async function deployDemoPath(
  userId: string,
  options?: SpawnDemoOptions
): Promise<DeployDemoPathResult> {
  const gameId = options?.gameId || 'demo-arena';
  const { subdomain, fqdn, url } = resolveDemoSubdomain(userId, gameId, options?.customSubdomain);
  const { dir } = ensureDemoFolder(userId);

  // Check existing workspace if available
  const workspace = await getDemoWorkspace(userId).catch(() => null);
  const targetDir = workspace?.local_dir || dir;

  // Mark deploy in progress
  await recordDemoDeploy(userId, { deploy_url: null, deploy_status: 'DEPLOYING' }).catch(() => null);

  // Deploy project with custom domain specified
  const result = await deployDemoProject(userId, targetDir, gameId, subdomain);
  const effectiveProject = result.projectName || subdomain;
  const canonicalUrl = `https://${subdomain}.${DEMO_BASE_DOMAIN}`;
  let finalUrl = result.primaryUrl || canonicalUrl;

  // If finalUrl points to a .pages.dev preview or dead hash link, normalize to .warden.autos
  if (finalUrl.includes('.pages.dev')) {
    finalUrl = canonicalUrl;
  }

  // Record deployment: increments version (e.g. v1 -> v2) and stamps update timestamp
  const metadata = recordDeployment(userId, {
    subdomain,
    projectName: effectiveProject,
    deployUrl: finalUrl,
    status: result.status,
  });

  await recordDemoDeploy(userId, {
    deploy_url: finalUrl,
    deploy_status: result.status as any,
  }).catch(() => null);

  return {
    ok: result.ok,
    subdomain,
    fqdn: `${subdomain}.${DEMO_BASE_DOMAIN}`,
    url: finalUrl,
    pagesDevUrl: result.pagesDevUrl,
    status: result.status,
    metadata,
    rawDeployResult: result,
  };
}

export interface DemoSubdomainRouteCtx {
  pathname: string;
  method: string;
  requestUserId: string | null;
  readJsonBody: () => Promise<Record<string, any>>;
  sendJson: (res: ServerResponse, status: number, body: unknown) => void;
  broadcastEvent?: (event: string, payload: unknown) => void;
}

/**
 * Handles HTTP routes for demo subdomain spawning and deployments:
 * - GET  /api/demo/subdomain
 * - POST /api/demo/subdomain/spawn (or /api/demo/spawn)
 * - POST /api/demo/subdomain/deploy (or /api/demo/deploy)
 * - GET  /api/demo/metadata (or /api/demo/status)
 */
export async function handleDemoSubdomainRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: DemoSubdomainRouteCtx
): Promise<boolean> {
  const { pathname, method, requestUserId } = ctx;

  const validPaths = [
    '/api/demo/subdomain',
    '/api/demo/subdomain/spawn',
    '/api/demo/spawn',
    '/api/demo/subdomain/deploy',
    '/api/demo/deploy',
    '/api/demo/metadata',
    '/api/demo/status',
  ];

  if (!validPaths.includes(pathname)) {
    return false;
  }

  const urlObj = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
  const queryUserId = urlObj.searchParams.get('userId') || urlObj.searchParams.get('user_id');
  const targetUser = requestUserId || queryUserId;

  if (!targetUser) {
    ctx.sendJson(res, 401, { ok: false, error: 'Not signed in' });
    return true;
  }

  if (pathname === '/api/demo/status' || pathname === '/api/demo/metadata') {
    if (method === 'GET') {
      const metadata = getDemoMetadata(targetUser);
      ctx.sendJson(res, 200, { ok: true, metadata });
      return true;
    }
  }

  if (pathname === '/api/demo/subdomain' && method === 'GET') {
    const { subdomain, fqdn, url } = resolveDemoSubdomain(targetUser);
    const metadata = getDemoMetadata(targetUser);
    ctx.sendJson(res, 200, {
      ok: true,
      subdomain,
      fqdn,
      url,
      baseDomain: DEMO_BASE_DOMAIN,
      cloudflareConfigured: cloudflareConfigured(),
      metadata,
    });
    return true;
  }

  if ((pathname === '/api/demo/subdomain/spawn' || pathname === '/api/demo/spawn') && method === 'POST') {
    const body: Record<string, any> = (await ctx.readJsonBody().catch(() => ({}))) || {};
    const spawnRes = await spawnDemoPath(targetUser, {
      gameId: body?.gameId,
      customSubdomain: body?.subdomain,
    });
    ctx.sendJson(res, 201, spawnRes);
    return true;
  }

  if ((pathname === '/api/demo/subdomain/deploy' || pathname === '/api/demo/deploy') && method === 'POST') {
    const body: Record<string, any> = (await ctx.readJsonBody().catch(() => ({}))) || {};
    const deployRes = await deployDemoPath(targetUser, {
      gameId: body?.gameId,
      customSubdomain: body?.subdomain,
    });
    if (ctx.broadcastEvent) {
      ctx.broadcastEvent('backlog:updated', {
        user_id: targetUser,
        kind: 'demo-deploy',
        status: deployRes.status,
        version: deployRes.metadata.version,
        updatedAt: deployRes.metadata.updatedAt,
      });
    }
    ctx.sendJson(res, deployRes.ok ? 201 : 200, deployRes);
    return true;
  }

  return false;
}
