/**
 * Cloud user provisioning: demo + full modes.
 *
 * Runs once when a user completes dashboard onboarding. Every operator gets
 * isolated Postgres rows stamped with their user id — never shared Markdown.
 *
 * - demo: seeds a template project context, welcome thread, and starter
 *   backlog, copies the game scaffold into the user's own folder (see
 *   DemoFolders), then — when git is configured — creates the user's own
 *   `demo/<id>` branch off DEMO_BASE_REF on DEMO_REPO_FULL_NAME and opens
 *   one draft PR per user. Agent work lands on that branch (see AgentRunner
 *   branch routing).
 * - full: seeds a welcome thread with no repo attached yet.
 *
 * Git uses a single server-side demo credential (GITHUB_DEMO_TOKEN); branch
 * naming provides per-user isolation. Without git config, DB seeding still
 * runs and the workspace is marked NO_GIT_CONFIG. Folders need no git at
 * all, so the demo game + Cloudflare deploy work either way.
 *
 * Env: DATABASE_URL, GITHUB_DEMO_TOKEN, DEMO_REPO_FULL_NAME (owner/repo),
 * DEMO_BASE_REF (default 'demo-base'), DEMO_PR_BASE (default 'main').
 */
import crypto from 'node:crypto';
import { Pool } from 'pg';

export type DemoWorkspaceStatus = 'ACTIVE' | 'NO_GIT_CONFIG' | 'GIT_FAILED';

export type DemoDeployState =
  | 'NOT_DEPLOYED'
  | 'NOT_CONFIGURED'
  | 'BUILDING'
  | 'DEPLOYING'
  | 'ACTIVE'
  | 'FAILED';

export interface DemoWorkspace {
  user_id: string;
  mode: 'demo' | 'full';
  repo_full_name: string | null;
  base_ref: string | null;
  base_sha: string | null;
  branch: string | null;
  pr_number: number | null;
  pr_url: string | null;
  status: DemoWorkspaceStatus;
  local_dir: string | null;
  deploy_url: string | null;
  deploy_status: DemoDeployState;
}

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://warden:warden_secret@localhost:5432/warden';

const pool = new Pool({ connectionString: DATABASE_URL, max: 5 });

const WORKSPACE_DDL = `
CREATE TABLE IF NOT EXISTS demo_workspaces (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'demo' CHECK (mode IN ('demo', 'full')),
  repo_full_name TEXT,
  base_ref TEXT,
  base_sha TEXT,
  branch TEXT,
  pr_number INTEGER,
  pr_url TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'NO_GIT_CONFIG', 'GIT_FAILED')),
  local_dir TEXT,
  deploy_url TEXT,
  deploy_status TEXT NOT NULL DEFAULT 'NOT_DEPLOYED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`;

const WORKSPACE_ALTER = `
ALTER TABLE demo_workspaces ADD COLUMN IF NOT EXISTS local_dir TEXT;
ALTER TABLE demo_workspaces ADD COLUMN IF NOT EXISTS deploy_url TEXT;
ALTER TABLE demo_workspaces ADD COLUMN IF NOT EXISTS deploy_status TEXT NOT NULL DEFAULT 'NOT_DEPLOYED';`;

let ready: Promise<void> | null = null;
function ensureReady(): Promise<void> {
  if (!ready) {
    ready = pool
      .query(WORKSPACE_DDL)
      .then(() => pool.query(WORKSPACE_ALTER))
      .then(() => undefined)
      .catch((err) => {
        ready = null;
        throw err;
      });
  }
  return ready;
}

/** Test/CLI hook to drain the pool so the process can exit. */
export async function closeDemoPool(): Promise<void> {
  await pool.end().catch(() => undefined);
}

function toWorkspace(row: Record<string, any>): DemoWorkspace {
  return {
    user_id: String(row.user_id),
    mode: row.mode === 'full' ? 'full' : 'demo',
    repo_full_name: row.repo_full_name ?? null,
    base_ref: row.base_ref ?? null,
    base_sha: row.base_sha ?? null,
    branch: row.branch ?? null,
    pr_number: row.pr_number !== null && row.pr_number !== undefined ? Number(row.pr_number) : null,
    pr_url: row.pr_url ?? null,
    status: (row.status || 'ACTIVE') as DemoWorkspaceStatus,
    local_dir: row.local_dir ?? null,
    deploy_url: row.deploy_url ?? null,
    deploy_status: (row.deploy_status || 'NOT_DEPLOYED') as DemoDeployState,
  };
}

export async function getDemoWorkspace(userId: string): Promise<DemoWorkspace | null> {
  await ensureReady();
  const res = await pool.query('SELECT * FROM demo_workspaces WHERE user_id = $1', [userId]);
  return res.rows[0] ? toWorkspace(res.rows[0]) : null;
}

async function saveWorkspace(ws: DemoWorkspace): Promise<DemoWorkspace> {
  await ensureReady();
  const res = await pool.query(
    `INSERT INTO demo_workspaces
       (user_id, mode, repo_full_name, base_ref, base_sha, branch, pr_number, pr_url, status,
        local_dir, deploy_url, deploy_status, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       mode = EXCLUDED.mode,
       repo_full_name = EXCLUDED.repo_full_name,
       base_ref = EXCLUDED.base_ref,
       base_sha = EXCLUDED.base_sha,
       branch = EXCLUDED.branch,
       pr_number = EXCLUDED.pr_number,
       pr_url = EXCLUDED.pr_url,
       status = EXCLUDED.status,
       local_dir = COALESCE(EXCLUDED.local_dir, demo_workspaces.local_dir),
       deploy_url = COALESCE(EXCLUDED.deploy_url, demo_workspaces.deploy_url),
       deploy_status = EXCLUDED.deploy_status,
       updated_at = NOW()
     RETURNING *`,
    [
      ws.user_id,
      ws.mode,
      ws.repo_full_name,
      ws.base_ref,
      ws.base_sha,
      ws.branch,
      ws.pr_number,
      ws.pr_url,
      ws.status,
      ws.local_dir,
      ws.deploy_url,
      ws.deploy_status,
    ]
  );
  return toWorkspace(res.rows[0]);
}

/** Record a deploy outcome without touching any other workspace field. */
export async function recordDemoDeploy(
  userId: string,
  outcome: { deploy_url: string | null; deploy_status: DemoDeployState }
): Promise<DemoWorkspace | null> {
  await ensureReady();
  const res = await pool.query(
    `UPDATE demo_workspaces
     SET deploy_url = COALESCE($2, deploy_url), deploy_status = $3, updated_at = NOW()
     WHERE user_id = $1 RETURNING *`,
    [userId, outcome.deploy_url, outcome.deploy_status]
  );
  return res.rows[0] ? toWorkspace(res.rows[0]) : null;
}

// ----------------------------------------------------------------------------
// Minimal GitHub REST helpers (no new dependencies)
// ----------------------------------------------------------------------------

async function ghFetch(
  path: string,
  token: string,
  init?: { method?: string; body?: unknown }
): Promise<{ ok: boolean; status: number; json: any }> {
  const res = await fetch(`https://api.github.com${path}`, {
    method: init?.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'warden-control-plane',
      'Content-Type': 'application/json',
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json };
}

async function resolveBaseSha(repo: string, token: string, baseRef: string): Promise<string> {
  for (const kind of ['heads', 'tags']) {
    const res = await ghFetch(`/repos/${repo}/git/ref/${kind}/${baseRef}`, token);
    if (res.ok && res.json?.object?.sha) return String(res.json.object.sha);
  }
  throw new Error(`Base ref '${baseRef}' not found on ${repo} (need a branch or tag).`);
}

async function createBranch(
  repo: string,
  token: string,
  branch: string,
  sha: string
): Promise<void> {
  const res = await ghFetch(`/repos/${repo}/git/refs`, token, {
    method: 'POST',
    body: { ref: `refs/heads/${branch}`, sha },
  });
  // 422 = ref already exists (idempotent retry); anything else is fatal.
  if (!res.ok && res.status !== 422) {
    throw new Error(`Branch create failed (${res.status}): ${res.json?.message || 'unknown'}`);
  }
}

async function openDraftPr(
  repo: string,
  token: string,
  head: string,
  base: string,
  title: string
): Promise<{ number: number; html_url: string }> {
  const created = await ghFetch(`/repos/${repo}/pulls`, token, {
    method: 'POST',
    body: { title, head, base, body: 'Warden demo workspace PR. One branch per demo user.', draft: true },
  });
  if (created.ok && created.json?.number) {
    return { number: Number(created.json.number), html_url: String(created.json.html_url || '') };
  }
  // 422 usually means a PR already exists for this head; reuse it.
  const existing = await ghFetch(
    `/repos/${repo}/pulls?head=${encodeURIComponent(head)}&state=open`,
    token
  );
  const first = Array.isArray(existing.json) ? existing.json[0] : null;
  if (first?.number) {
    return { number: Number(first.number), html_url: String(first.html_url || '') };
  }
  throw new Error(`PR open failed (${created.status}): ${created.json?.message || 'unknown'}`);
}

// ----------------------------------------------------------------------------
// Provisioning
// ----------------------------------------------------------------------------

function shortUserId(userId: string): string {
  return userId.replace(/-/g, '').slice(0, 8);
}

export async function seedDemoAgentRuns(userId: string): Promise<void> {
  try {
    const countRes = await pool.query<{ cnt: string | number }>(
      'SELECT COUNT(*)::int AS cnt FROM agent_runs WHERE user_id = $1',
      [userId]
    );
    if (Number(countRes.rows[0]?.cnt ?? 0) > 0) return;

    const agentsRes = await pool.query<{ id: string; slug: string; department: string }>(
      'SELECT id, slug, department FROM agents'
    );
    const rows = agentsRes.rows;
    if (rows.length === 0) return;

    const pickAgent = (candidates: string[], deptFallback?: string): string => {
      for (const c of candidates) {
        const exact = rows.find((r) => r.id === c || r.slug === `@${c}`);
        if (exact) return exact.id;
        const prefix = rows.find((r) => r.id.startsWith(`${c}:`) || r.slug.startsWith(`@${c}:`));
        if (prefix) return prefix.id;
      }
      if (deptFallback) {
        const byDept = rows.find((r) => r.department?.toLowerCase() === deptFallback.toLowerCase());
        if (byDept) return byDept.id;
      }
      return rows[0].id;
    };

    const wardenId = pickAgent(['warden', 'cto']);
    const techLeadId = pickAgent(['tech_lead', 'cto', 'warden'], 'tech');
    const frontendDevId = pickAgent(['frontend_dev', 'backend_dev', 'pm', 'cto'], 'tech');
    const seoAgentId = pickAgent(['seo_aeo_head', 'seo_content_dev', 'aeo_analyst', 'cbo']);
    const socialAgentId = pickAgent(['social_lead', 'cmo'], 'marketing');

    const seedRuns = [
      {
        agent_id: techLeadId,
        trigger_type: 'DAILY_STANDUP',
        input_prompt: 'Triage arena crash report & lock end-state guard contract',
        output_summary: '[Demo seed] Reproduced match-end crash; locked minimal guard + Playwright regression spec.',
        interval: '25 minutes',
        duration_ms: 18400,
        tokens_in: 2100,
        tokens_cached: 1200,
        tokens_thinking: 620,
        tokens_out: 680,
        cost_usd: 0.0142,
      },
      {
        agent_id: frontendDevId,
        trigger_type: 'DELEGATION',
        input_prompt: 'Scaffold trophy ladder sprite atlas & match-end regression guard',
        output_summary: '[Demo seed] Prepared 12-sprite trophy atlas manifest and verified end-state guard in sandbox.',
        interval: '25 minutes',
        duration_ms: 24100,
        tokens_in: 1450,
        tokens_cached: 850,
        tokens_thinking: 410,
        tokens_out: 510,
        cost_usd: 0.0098,
      },
      {
        agent_id: seoAgentId,
        trigger_type: 'DAILY_STANDUP',
        input_prompt: 'Draft Trophy Launch how-to SEO cluster + FAQ JSON-LD schema',
        output_summary: '[Demo seed] Shipped 4 semantic how-to guide outlines with structured FAQPage schema.',
        interval: '25 minutes',
        duration_ms: 15200,
        tokens_in: 980,
        tokens_cached: 520,
        tokens_thinking: 240,
        tokens_out: 380,
        cost_usd: 0.0064,
      },
      {
        agent_id: socialAgentId,
        trigger_type: 'DAILY_STANDUP',
        input_prompt: 'Prepare 5 player-flex launch clips & announcement thread',
        output_summary: '[Demo seed] Cut 5 vertical storyboard scripts + launch thread copy for Reels & Shorts.',
        interval: '25 minutes',
        duration_ms: 11800,
        tokens_in: 540,
        tokens_cached: 280,
        tokens_thinking: 140,
        tokens_out: 220,
        cost_usd: 0.0036,
      },
      {
        agent_id: wardenId,
        trigger_type: 'CEO_CHAT',
        input_prompt: 'Initial workspace architecture index & backlog synthesis',
        output_summary: '[Demo seed] Indexed Tic-Tac-Toe Arena repository and synthesized P0/P1 launch backlog.',
        interval: '3 days',
        duration_ms: 31500,
        tokens_in: 4800,
        tokens_cached: 3100,
        tokens_thinking: 1250,
        tokens_out: 1480,
        cost_usd: 0.032,
      },
      {
        agent_id: seoAgentId,
        trigger_type: 'DAILY_STANDUP',
        input_prompt: 'Baseline llms.txt, robots.txt & SERP citation benchmark',
        output_summary: '[Demo seed] Generated baseline llms.txt discovery manifest and AI answer citation audit.',
        interval: '3 days',
        duration_ms: 22600,
        tokens_in: 3100,
        tokens_cached: 1850,
        tokens_thinking: 780,
        tokens_out: 970,
        cost_usd: 0.02,
      },
    ];

    for (const r of seedRuns) {
      await pool.query(
        `INSERT INTO agent_runs (
          id, user_id, agent_id, trigger_type, input_prompt, output_summary,
          status, qa_passed, started_at, ended_at, active_duration_ms, pause_duration_ms,
          tokens_in, tokens_cached, tokens_thinking, tokens_out, cost_usd
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          'COMPLETED', TRUE, NOW() - $7::interval, NOW() - $7::interval + ($8 || ' milliseconds')::interval, $8::bigint, 0,
          $9, $10, $11, $12, $13
        )`,
        [
          crypto.randomUUID(),
          userId,
          r.agent_id,
          r.trigger_type,
          r.input_prompt,
          r.output_summary,
          r.interval,
          r.duration_ms,
          r.tokens_in,
          r.tokens_cached,
          r.tokens_thinking,
          r.tokens_out,
          r.cost_usd,
        ]
      );
    }
    console.log(`[🚀 DEMO PROVISION] Seeded ${seedRuns.length} realistic agent_runs for user=${userId}`);
  } catch (err) {
    console.error('[DemoProvisioning] Failed to seed demo agent_runs:', err);
  }
}

async function seedDemoRows(
  userId: string,
  opts: { repoFullName: string | null; branch: string | null }
): Promise<void> {
  const mod: Record<string, any> = await import(/* @vite-ignore */ '@warden/db');
  const dbStore = mod?.dbStore;
  if (!dbStore) throw new Error('Provisioning requires @warden/db');
  if (typeof dbStore.init === 'function') await dbStore.init().catch(() => undefined);

  const repoSlug = opts.repoFullName ? opts.repoFullName.split('/')[1] || 'demo-project' : 'demo-project';

  await dbStore.upsertProjectContext({
    user_id: userId,
    project_slug: 'demo-project',
    repo_slug: repoSlug,
    git_repo_url: opts.repoFullName ? `https://github.com/${opts.repoFullName}` : null,
    default_branch: opts.branch || 'main',
    role: 'fullstack',
    build_cmd: 'npm install && npm run build',
    test_cmd: 'npm run typecheck',
    architecture_doc_md:
      '# Demo Project: Tic-Tac-Toe Arena\n\nSeeded Warden demo target. Playable Vite + vanilla JS game ' +
      'in your own folder. Expansion roadmap in BACKLOG.md: Chest System, LiveOps, Trophy Ladder, Realtime Multiplayer.',
  });

  const thread = await dbStore.createChatThread({
    user_id: userId,
    title: 'Welcome to your Warden demo',
    mode: 'WARDEN_EXECUTIVE',
    target_agent_id: 'warden',
    project_scope: 'demo-project',
    status: 'ACTIVE',
  });
  await dbStore.appendChatMessage({
    user_id: userId,
    thread_id: thread.id,
    sender_type: 'AGENT',
    sender_agent_id: 'warden',
    content:
      `Your demo workspace is ready. Your game folder is seeded and the trophy launch backlog is waiting.` +
      (opts.branch ? ` Code edits land on \`${opts.branch}\` through your PR.` : ``) +
      ` Approve the hotfix or the asset batch in NEEDS ACTION to watch a loop close.`,
  });

  const starters = [
    {
      title: 'Generate trophy system art set (12 sprites + 4 animations)',
      spec_md: 'Per ASSETS_MANIFEST.md: trophy ladder art in the locked style, packed as a sprite atlas in the demo game bundle.',
      stage: 'TODO',
      priority: 'P0',
    },
    {
      title: 'Support case: game crashes after the final move',
      spec_md: 'Player report: the arena crashes on match end. Reproduced by triage; minimal end-state guard plus Playwright regression test ready for approval.',
      stage: 'NEEDS_CEO',
      priority: 'P0',
    },
    {
      title: 'Trophy launch SEO cluster (4 guides + FAQ schema)',
      spec_md: 'How-to trophy guides with FAQ schema so launch searches land on the demo game. How-to intent first.',
      stage: 'TODO',
      priority: 'P1',
    },
    {
      title: 'Trophy launch social visuals (5 clips + launch thread)',
      spec_md: 'Player-flex clips cut from the new art set plus the announcement thread. Premiere on Reels + Shorts.',
      stage: 'TODO',
      priority: 'P1',
    },
  ] as const;
  for (const s of starters) {
    await dbStore.createBacklogItem({
      user_id: userId,
      title: s.title,
      spec_md: s.spec_md,
      stage: s.stage,
      priority: s.priority,
      department: 'tech',
      project_slug: 'demo-project',
    });
  }

  await seedDemoAgentRuns(userId);
}

async function seedFullRows(userId: string): Promise<void> {
  const mod: Record<string, any> = await import(/* @vite-ignore */ '@warden/db');
  const dbStore = mod?.dbStore;
  if (!dbStore) throw new Error('Provisioning requires @warden/db');
  if (typeof dbStore.init === 'function') await dbStore.init().catch(() => undefined);

  const thread = await dbStore.createChatThread({
    user_id: userId,
    title: 'Welcome to Warden',
    mode: 'WARDEN_EXECUTIVE',
    target_agent_id: 'warden',
    project_scope: 'GLOBAL',
    status: 'ACTIVE',
  });
  await dbStore.appendChatMessage({
    user_id: userId,
    thread_id: thread.id,
    sender_type: 'AGENT',
    sender_agent_id: 'warden',
    content:
      'Onboarding complete. Warden now holds your company memory. Point agents at your repo and they will close loops on your code with one approval from you.',
  });
}

async function deployInitialDemoBuild(
  userId: string,
  localDir: string | null
): Promise<{ deploy_url: string | null; deploy_status: DemoDeployState }> {
  try {
    const { demoPrebuiltDir, demoTemplateDir } = await import('./DemoFolders.js');
    const { deployDemoProject } = await import('./CloudflareDeployer.js');
    const targetDir = localDir || demoPrebuiltDir() || demoTemplateDir();
    console.log(`[🚀 DEMO PROVISION] Running initial demo build deploy for user=${userId} targetDir=${targetDir}`);
    const res = await deployDemoProject(userId, targetDir);
    if (res.ok && res.primaryUrl) {
      const out = { deploy_url: res.primaryUrl, deploy_status: 'ACTIVE' as DemoDeployState };
      console.log(`[🚀 DEMO PROVISION] Initial deploy succeeded: deploy_url=${out.deploy_url} deploy_status=${out.deploy_status}`);
      return out;
    }
    // When Cloudflare creds are not configured locally, point to the local prebuilt game
    // so the dashboard "Latest release" button still opens the playable v1 game.
    const fallback = { deploy_url: '/demo-game/index.html', deploy_status: 'ACTIVE' as DemoDeployState };
    console.log(`[🚀 DEMO PROVISION] Initial deploy using local fallback: deploy_url=${fallback.deploy_url} deploy_status=${fallback.deploy_status} (reason: ${res.status})`);
    return fallback;
  } catch (err) {
    console.error('[DemoProvisioning] Initial demo deploy failed; falling back to local build:', err);
    return { deploy_url: '/demo-game/index.html', deploy_status: 'ACTIVE' };
  }
}

/**
 * Idempotent per-user provisioning. Safe to call on every COMPLETE save;
 * existing workspaces return immediately (after ensuring initial deploy for demo users).
 */
export async function provisionUser(
  userId: string,
  form: Record<string, unknown> | null | undefined
): Promise<DemoWorkspace> {
  console.log(`[🚀 DEMO PROVISION] Starting provisionUser for user=${userId}`);
  const existing = await getDemoWorkspace(userId).catch(() => null);
  if (existing) {
    console.log(`[🚀 DEMO PROVISION] Existing workspace found for user=${userId} mode=${existing.mode} deploy_status=${existing.deploy_status} deploy_url=${existing.deploy_url}`);
    if (existing.mode === 'demo') {
      await seedDemoAgentRuns(userId);
      if (!existing.deploy_url || existing.deploy_status === 'NOT_DEPLOYED') {
        const deployed = await deployInitialDemoBuild(userId, existing.local_dir);
        const updated = await recordDemoDeploy(userId, deployed).catch(() => null);
        return updated || existing;
      }
    }
    return existing;
  }

  const isDemo = form?.demo === true || form?.mode === 'demo' || form?.chosenMode === 'demo';
  const mode = isDemo ? 'demo' : 'full';
  console.log(`[🚀 DEMO PROVISION] Provisioning new workspace for user=${userId} mode=${mode}`);

  const { ensureBudget } = await import('../budgets/UserBudgets.js');
  await ensureBudget(userId, mode).catch((err) =>
    console.error('[DemoProvisioning] Budget row failed:', err)
  );

  if (!isDemo) {
    await seedFullRows(userId);
    console.log(`[🚀 DEMO PROVISION] Seeded full-mode DB rows for user=${userId}`);
    return saveWorkspace({
      user_id: userId,
      mode: 'full',
      repo_full_name: null,
      base_ref: null,
      base_sha: null,
      branch: null,
      pr_number: null,
      pr_url: null,
      status: 'ACTIVE',
      local_dir: null,
      deploy_url: null,
      deploy_status: 'NOT_DEPLOYED',
    });
  }

  const repo = (process.env.DEMO_REPO_FULL_NAME || '').trim();
  const baseRef = (process.env.DEMO_BASE_REF || 'demo-base').trim();
  const prBase = (process.env.DEMO_PR_BASE || 'main').trim();
  const token = (process.env.GITHUB_DEMO_TOKEN || '').trim();
  const branch = `demo/u${shortUserId(userId)}-${crypto.randomBytes(3).toString('hex')}`;

  // DB seeds first: the workspace is usable even if git is unconfigured.
  await seedDemoRows(userId, { repoFullName: repo || null, branch });
  console.log(`[🚀 DEMO PROVISION] Seeded demo DB rows (context, welcome thread, backlog, agent_runs) for user=${userId}`);

  // Per-user demo folder: best effort, never fails provisioning.
  let localDir: string | null = null;
  try {
    const { ensureDemoFolder } = await import('./DemoFolders.js');
    localDir = ensureDemoFolder(userId).dir;
    console.log(`[🚀 DEMO PROVISION] Demo folder ready at ${localDir}`);
  } catch (err) {
    console.error('[DemoProvisioning] Demo folder seed failed; DB seeds kept:', err);
  }

  // Deploy the predefined build folder to Cloudflare Pages on their unique subdomain.
  const initialDeploy = await deployInitialDemoBuild(userId, localDir);
  console.log(`[🚀 DEMO PROVISION] deployInitialDemoBuild returned deploy_url=${initialDeploy.deploy_url} deploy_status=${initialDeploy.deploy_status}`);

  if (!token || !repo) {
    return saveWorkspace({
      user_id: userId,
      mode: 'demo',
      repo_full_name: repo || null,
      base_ref: baseRef,
      base_sha: null,
      branch,
      pr_number: null,
      pr_url: null,
      status: 'NO_GIT_CONFIG',
      local_dir: localDir,
      deploy_url: initialDeploy.deploy_url,
      deploy_status: initialDeploy.deploy_status,
    });
  }

  try {
    const sha = await resolveBaseSha(repo, token, baseRef);
    await createBranch(repo, token, branch, sha);
    const pr = await openDraftPr(repo, token, branch, prBase, `Demo workspace ${branch}`);
    return saveWorkspace({
      user_id: userId,
      mode: 'demo',
      repo_full_name: repo,
      base_ref: baseRef,
      base_sha: sha,
      branch,
      pr_number: pr.number,
      pr_url: pr.html_url || null,
      status: 'ACTIVE',
      local_dir: localDir,
      deploy_url: initialDeploy.deploy_url,
      deploy_status: initialDeploy.deploy_status,
    });
  } catch (err) {
    console.error('[DemoProvisioning] Git setup failed; DB seeds kept:', err);
    return saveWorkspace({
      user_id: userId,
      mode: 'demo',
      repo_full_name: repo,
      base_ref: baseRef,
      base_sha: null,
      branch,
      pr_number: null,
      pr_url: null,
      status: 'GIT_FAILED',
      local_dir: localDir,
      deploy_url: initialDeploy.deploy_url,
      deploy_status: initialDeploy.deploy_status,
    });
  }
}
