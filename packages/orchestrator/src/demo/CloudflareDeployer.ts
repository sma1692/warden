/**
 * Cloudflare per-user demo deploy.
 *
 * Builds a user's demo folder and deploys it to Cloudflare Pages as an
 * isolated project named `<prefix>-<user>-<game>`, with an optional custom
 * domain `<project>.<baseDomain>` once the zone is on Cloudflare DNS.
 *
 * Without CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN the deployer reports
 * NOT_CONFIGURED instead of failing silently — the dashboard shows the
 * local folder state until creds land.
 *
 * Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, CLOUDFLARE_BASE_DOMAIN,
 * CLOUDFLARE_PAGES_PREFIX (default 'warden'), CLOUDFLARE_PROD_BRANCH.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { demoPrebuiltDir } from './DemoFolders.js';

export type DemoDeployStatus =
  | 'NOT_DEPLOYED'
  | 'NOT_CONFIGURED'
  | 'BUILDING'
  | 'DEPLOYING'
  | 'ACTIVE'
  | 'FAILED';

export interface DemoDeployResult {
  ok: boolean;
  status: DemoDeployStatus;
  projectName: string;
  primaryUrl: string | null;
  pagesDevUrl: string | null;
  deploymentId: string | null;
  fileCount: number;
  totalDurationMs: number;
  error: string | null;
}

export function sanitizeSubdomain(raw: string, maxLength = 58): string {
  let cleaned = raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!cleaned) cleaned = `app-${Math.random().toString(36).slice(2, 8)}`;
  if (cleaned.length > maxLength) cleaned = cleaned.slice(0, maxLength).replace(/-+$/g, '');
  return cleaned;
}

export function buildProjectName(prefix: string, userId: string, gameId: string): string {
  return `${sanitizeSubdomain(prefix, 10)}-${sanitizeSubdomain(userId, 20)}-${sanitizeSubdomain(gameId, 25)}`;
}

function shortUser(userId: string): string {
  return userId.replace(/-/g, '').slice(0, 8) || 'user';
}

function cfHeaders(apiToken: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` };
}

function countFiles(dir: string): number {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    count += entry.isDirectory() ? countFiles(full) : 1;
  }
  return count;
}

function resolveDistDir(gameDir: string): string | null {
  for (const cand of ['dist', 'build', 'out', 'public']) {
    const p = path.join(gameDir, cand);
    if (fs.existsSync(path.join(p, 'index.html'))) return p;
  }
  return fs.existsSync(path.join(gameDir, 'index.html')) ? gameDir : null;
}

function buildGameDir(gameDir: string): { distPath: string; fileCount: number } {
  const dir = path.resolve(gameDir);
  // Prefer the predefined build folder for fast per-user Cloudflare deploys.
  const localBuild = path.join(dir, 'build');
  if (fs.existsSync(path.join(localBuild, 'index.html'))) {
    return { distPath: localBuild, fileCount: countFiles(localBuild) };
  }
  const templateBuild = demoPrebuiltDir();
  if (fs.existsSync(path.join(templateBuild, 'index.html'))) {
    return { distPath: templateBuild, fileCount: countFiles(templateBuild) };
  }
  if (!fs.existsSync(dir)) throw new Error(`Demo folder does not exist: ${dir}`);
  const pkgPath = path.join(dir, 'package.json');
  const pkg = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')) : null;
  const buildCmd: string | null = pkg?.scripts?.build ? 'npm run build' : null;
  if (buildCmd) {
    if (!fs.existsSync(path.join(dir, 'node_modules'))) {
      try {
        execSync('npm install --prefer-offline --no-audit --no-fund', {
          cwd: dir,
          stdio: 'pipe',
          timeout: 180000,
        });
      } catch (err: any) {
        throw new Error(`Demo npm install failed: ${err?.message || err}`);
      }
    }
    try {
      execSync(buildCmd, { cwd: dir, stdio: 'pipe', env: { ...process.env, CI: 'true' }, timeout: 180000 });
    } catch (err: any) {
      const out = err?.stderr ? String(err.stderr) : String(err?.message || err);
      throw new Error(`Demo build failed ('${buildCmd}'): ${out.slice(0, 2000)}`);
    }
  }
  const distPath = resolveDistDir(dir);
  if (!distPath) throw new Error(`No index.html found under ${dir} (checked dist/, build/, out/, public/, root)`);
  return { distPath, fileCount: countFiles(distPath) };
}

async function ensurePagesProject(accountId: string, apiToken: string, projectName: string, branch: string): Promise<void> {
  const base = 'https://api.cloudflare.com/client/v4';
  const check = await fetch(`${base}/accounts/${accountId}/pages/projects/${projectName}`, {
    headers: cfHeaders(apiToken),
  });
  if (check.status === 200) return;
  const created = await fetch(`${base}/accounts/${accountId}/pages/projects`, {
    method: 'POST',
    headers: cfHeaders(apiToken),
    body: JSON.stringify({ name: projectName, production_branch: branch }),
  });
  if (!created.ok && created.status !== 409) {
    const data = (await created.json().catch(() => null)) as any;
    throw new Error(`Pages project create failed: ${data?.errors?.[0]?.message || created.statusText}`);
  }
}

function deployViaWrangler(accountId: string, apiToken: string, distDir: string, projectName: string, branch: string): { deploymentId: string; pagesDevUrl: string } {
  const cmd =
    `npx --yes wrangler pages deploy "${distDir}" ` +
    `--project-name="${projectName}" --branch="${branch}" --commit-dirty=true`;
  let output: string;
  try {
    output = execSync(cmd, {
      env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: apiToken },
      stdio: 'pipe',
      timeout: 240000,
    }).toString();
  } catch (err: any) {
    const out = err?.stderr ? String(err.stderr) : String(err?.message || err);
    throw new Error(`Wrangler deploy failed: ${out.slice(0, 2000)}`);
  }
  const urls = output.match(/https:\/\/[a-zA-Z0-9.-]+\.pages\.dev/g) || [];
  const pagesDevUrl = urls.find((u) => u === `https://${projectName}.pages.dev`) || urls[urls.length - 1] || `https://${projectName}.pages.dev`;
  const idMatch = output.match(/Deployment ID:\s*([a-f0-9-]+)/i);
  return { deploymentId: idMatch ? idMatch[1] : `cf-${Date.now()}`, pagesDevUrl };
}

async function attachCustomDomain(accountId: string, apiToken: string, projectName: string, fqdn: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/domains`,
      { method: 'POST', headers: cfHeaders(apiToken), body: JSON.stringify({ name: fqdn }) }
    );
    return res.ok || res.status === 409;
  } catch (err) {
    console.warn(`[DemoDeploy] Custom domain attach failed for ${fqdn}:`, err);
    return false;
  }
}

export function cloudflareConfigured(): boolean {
  return Boolean((process.env.CLOUDFLARE_ACCOUNT_ID || '').trim() && (process.env.CLOUDFLARE_API_TOKEN || '').trim());
}

export function demoProjectName(userId: string, gameId = 'demo-arena'): string {
  const prefix = (process.env.CLOUDFLARE_PAGES_PREFIX || 'warden').trim() || 'warden';
  return buildProjectName(prefix, `u${shortUser(userId)}`, gameId);
}

/**
 * Build + deploy the user's demo folder. Never throws for missing creds:
 * returns NOT_CONFIGURED so the API can report degraded state honestly.
 */
export async function deployDemoProject(userId: string, gameDir: string, gameId = 'demo-arena'): Promise<DemoDeployResult> {
  const started = Date.now();
  const projectName = demoProjectName(userId, gameId);
  console.log(`[🚀 DEMO DEPLOY] Starting deploy for user=${userId} project=${projectName} dir=${gameDir}`);
  const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const apiToken = (process.env.CLOUDFLARE_API_TOKEN || '').trim();
  if (!accountId || !apiToken) {
    console.warn(`[⚠️ DEMO DEPLOY] Skipping Cloudflare upload for ${projectName}: CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN is empty in .env. Serving local prebuilt game fallback (/demo-game/index.html).`);
    return {
      ok: false,
      status: 'NOT_CONFIGURED',
      projectName,
      primaryUrl: null,
      pagesDevUrl: null,
      deploymentId: null,
      fileCount: 0,
      totalDurationMs: Date.now() - started,
      error: 'Missing CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN. Deploy works to pages.dev once creds land.',
    };
  }
  const branch = (process.env.CLOUDFLARE_PROD_BRANCH || 'main').trim() || 'main';
  try {
    console.log(`[🚀 DEMO DEPLOY] Resolving build directory from ${gameDir} for ${projectName}...`);
    const { distPath, fileCount } = buildGameDir(gameDir);
    console.log(`[🚀 DEMO DEPLOY] Resolved build directory: ${distPath} (${fileCount} files)`);
    await ensurePagesProject(accountId, apiToken, projectName, branch);
    console.log(`[🚀 DEMO DEPLOY] Uploading ${distPath} (${fileCount} files) via Wrangler to project=${projectName} branch=${branch}...`);
    const { deploymentId, pagesDevUrl } = deployViaWrangler(accountId, apiToken, distPath, projectName, branch);
    console.log(`[🚀 DEMO DEPLOY] Wrangler upload complete: deploymentId=${deploymentId} pagesDevUrl=${pagesDevUrl}`);
    const baseDomain = (process.env.CLOUDFLARE_BASE_DOMAIN || '').trim();
    let primaryUrl: string | null = pagesDevUrl;
    if (baseDomain) {
      const fqdn = `${projectName}.${baseDomain}`;
      if (await attachCustomDomain(accountId, apiToken, projectName, fqdn)) primaryUrl = `https://${fqdn}`;
    }
    console.log(`[🚀 DEMO DEPLOY] Live at ${primaryUrl} (${Date.now() - started}ms)`);
    return {
      ok: true,
      status: 'ACTIVE',
      projectName,
      primaryUrl,
      pagesDevUrl,
      deploymentId,
      fileCount,
      totalDurationMs: Date.now() - started,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[❌ DEMO DEPLOY] Failed for ${projectName}:`, message);
    return {
      ok: false,
      status: 'FAILED',
      projectName,
      primaryUrl: null,
      pagesDevUrl: null,
      deploymentId: null,
      fileCount: 0,
      totalDurationMs: Date.now() - started,
      error: message,
    };
  }
}
