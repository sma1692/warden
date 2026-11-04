import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface PushitInput {
  workspace: string;
  summary: string;
  bullets?: string[];
  targetBranch?: string;
  skipPush?: boolean;
  author?: string;
}

export interface PushitOutput {
  committed: boolean;
  pushed: boolean;
  branch: string;
  sha: string | null;
  header: string;
  versionBumped: boolean;
  newVersion: string | null;
  staged: number;
}

/**
 * Staging exclusions, mirroring the `pushit` skill: env files, secrets,
 * local topology files, build outputs, and node_modules. Gitignored files
 * never appear in `git status` output, so they are excluded implicitly.
 */
export function isExcludedFromStaging(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').trim();
  const base = path.basename(normalized);
  if (/^\.env\.(example|sample|template)$/i.test(base)) return false;
  if (/^\.env(\..+)?$/i.test(base)) return true;
  if (/\.(pem|key|p12|pfx|zip|tar\.gz|tgz)$/i.test(base)) return true;
  if (/^(id_rsa|id_ed25519)/i.test(base)) return true;
  if (
    normalized === 'projects.yaml' ||
    normalized === '.state/topology-cache.json' ||
    normalized === '.claude/settings.json' ||
    normalized === '.claude/settings.local.json'
  ) {
    return true;
  }
  if (/^(dist|dist-[^/]+|build)(\/|$)/i.test(normalized)) return true;
  if (/^node_modules(\/|$)/i.test(normalized)) return true;
  return false;
}

async function git(workspace: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: workspace,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout.trim();
}

function formatHeader(summary: string, bumpedVersion: string | null): string {
  let header = summary.replace(/—/g, '--').replace(/\s+/g, ' ').trim().toUpperCase();
  if (!header) header = 'UPDATE PROJECT SOURCE AND CONFIGURATION';
  if (bumpedVersion && !header.includes(`BUMP VERSION TO ${bumpedVersion.toUpperCase()}`)) {
    header = `${header}, BUMP VERSION TO ${bumpedVersion.toUpperCase()}`;
  }
  return header;
}

function formatMessage(header: string, bullets: string[], author: string): string {
  const lines = (bullets.length > 0 ? bullets : ['Update repository source files']).map((b) => {
    const stripped = b
      .replace(/^[-*•]\s*/, '')
      .replace(/—/g, '--')
      .replace(/Co-Authored-By:.*$/gi, '')
      .trim();
    return `- ${stripped.charAt(0).toUpperCase()}${stripped.slice(1)}`;
  });
  return [header, '', ...lines, '', `Author -- ${author}`].join('\n');
}

/** Pushit version rule: bump PATCH every 5th commit, roll to MINOR past .10. */
export function nextVersion(
  current: string,
  commitsSinceBump: number
): { shouldBump: boolean; next: string } {
  const match = current.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match || commitsSinceBump + 1 < 5) {
    return { shouldBump: false, next: current };
  }
  const major = Number(match[1]);
  let minor = Number(match[2]);
  let patch = Number(match[3]);
  if (patch >= 10) {
    patch = 0;
    minor += 1;
  } else {
    patch += 1;
  }
  return { shouldBump: true, next: `${major}.${minor}.${patch}` };
}

/**
 * Runs the 4-step pushit workflow (version-check, stage, commit, push) in
 * `workspace` using local git. Never force-pushes.
 */
export async function runPushit(input: PushitInput): Promise<PushitOutput> {
  const branch = await git(input.workspace, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!branch || branch === 'HEAD') {
    throw new Error('not on a branch (detached HEAD or unborn repo)');
  }

  const status = await git(input.workspace, ['status', '--porcelain=v1', '-uall']);
  const candidates = status
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const arrow = line.indexOf(' -> ');
      const file = arrow >= 0 ? line.slice(arrow + 4) : line.slice(3);
      return file.replace(/^"|"$/g, '').trim();
    })
    .filter((f) => f && !isExcludedFromStaging(f));

  let newVersion: string | null = null;
  try {
    const pkgRaw = await fs.readFile(path.join(input.workspace, 'package.json'), 'utf8');
    const current = (JSON.parse(pkgRaw).version as string) || '';
    let since = 0;
    try {
      const lastBump = await git(input.workspace, [
        'log',
        '-G',
        '"version":',
        '-n',
        '1',
        '--format=%H',
        '--',
        'package.json',
      ]);
      const range = lastBump ? `${lastBump}..HEAD` : 'HEAD';
      since = Number(await git(input.workspace, ['rev-list', '--count', range])) || 0;
    } catch {
      since = 0;
    }
    const bump = nextVersion(current, since);
    if (bump.shouldBump) {
      const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
      pkg.version = bump.next;
      await fs.writeFile(
        path.join(input.workspace, 'package.json'),
        `${JSON.stringify(pkg, null, 2)}\n`,
        'utf8'
      );
      newVersion = bump.next;
    }
  } catch (err) {
    if ((err as Error).message?.startsWith('not on a branch')) throw err;
    // No package.json or unparsable: skip version logic, keep staging.
  }

  const toStage = newVersion && !candidates.includes('package.json')
    ? [...candidates, 'package.json']
    : candidates;
  if (toStage.length > 0) {
    await git(input.workspace, ['add', '--', ...toStage]);
  }
  const stagedCount = Number(await git(input.workspace, ['diff', '--cached', '--name-only'])
    .then((out) => (out ? out.split('\n').length : 0)));

  const header = formatHeader(input.summary, newVersion);
  if (stagedCount === 0) {
    return {
      committed: false,
      pushed: false,
      branch,
      sha: null,
      header,
      versionBumped: false,
      newVersion: null,
      staged: 0,
    };
  }

  const message = formatMessage(header, input.bullets ?? [], input.author ?? 'warden-link');
  const msgFile = path.join(os.tmpdir(), `warden-link-pushit-${Date.now()}-${process.pid}.txt`);
  await fs.writeFile(msgFile, `${message}\n`, 'utf8');
  try {
    await git(input.workspace, ['commit', '-F', msgFile]);
  } finally {
    await fs.rm(msgFile, { force: true });
  }
  const sha = await git(input.workspace, ['rev-parse', 'HEAD']);

  let pushed = false;
  if (!input.skipPush) {
    const target = input.targetBranch?.trim();
    if (target && target !== branch) {
      await git(input.workspace, ['push', 'origin', `HEAD:${target}`]);
    } else {
      await git(input.workspace, ['push', 'origin', branch]);
    }
    pushed = true;
  }

  return {
    committed: true,
    pushed,
    branch,
    sha,
    header,
    versionBumped: newVersion !== null,
    newVersion,
    staged: stagedCount,
  };
}
