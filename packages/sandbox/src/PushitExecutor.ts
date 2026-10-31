import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface PushitOptions {
  workspacePath: string;
  mode?: 'docker' | 'local' | 'cloud-ephemeral';
  containerName?: string;
  shortRunId?: string;
  summaryHeader: string;
  bullets: string[];
  targetBranch?: string;
  skipPush?: boolean;
}

export interface PushitResult {
  committed: boolean;
  pushed: boolean;
  branch: string;
  commitSha: string | null;
  commitHeader: string;
  commitMessage: string;
  versionBumped: boolean;
  previousVersion: string | null;
  newVersion: string | null;
  commitsSinceLastBump: number;
  stagedFiles: string[];
  excludedFiles: string[];
  logs: string;
}

/**
 * Computes the next semantic version according to the Commando `pushit` rule:
 * - Never auto-modify `MAJOR`.
 * - Every 5th commit (`commitsSinceLastBump + 1 >= 5`), increment `PATCH` by `1`.
 * - If `PATCH` is already `10` when the 5th commit hits, reset `PATCH` to `0` and increment `MINOR` by `1` (e.g. `0.0.10 -> 0.1.0`).
 */
export function computeNextVersion(
  currentVersion: string,
  commitsSinceLastBump: number
): { shouldBump: boolean; nextVersion: string } {
  const match = currentVersion.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return { shouldBump: false, nextVersion: currentVersion };
  }

  const major = Number(match[1]);
  let minor = Number(match[2]);
  let patch = Number(match[3]);

  if (commitsSinceLastBump + 1 < 5) {
    return { shouldBump: false, nextVersion: `${major}.${minor}.${patch}` };
  }

  if (patch >= 10) {
    patch = 0;
    minor += 1;
  } else {
    patch += 1;
  }

  return {
    shouldBump: true,
    nextVersion: `${major}.${minor}.${patch}`
  };
}

/**
 * Checks whether a modified/untracked file path must be excluded from `pushit` staging:
 * - `.env*` files (except `.env.example` / `.env.sample`)
 * - Secrets, credentials, or private keys (`*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa*`)
 * - Local topology/config files (`projects.yaml`, `.state/topology-cache.json`, `.claude/settings*.json`)
 * - Build outputs & archives (`dist/`, `dist*`, `build/`, `*.zip`, `*.tar.gz`)
 */
export function isExcludedFromStaging(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').trim();
  const base = path.basename(normalized);

  if (/^\.env\.(example|sample|template)$/i.test(base)) {
    return false;
  }
  if (/^\.env(\..+)?$/i.test(base)) {
    return true;
  }
  if (/\.(pem|key|p12|pfx|zip|tar\.gz|tgz)$/i.test(base)) {
    return true;
  }
  if (/^(id_rsa|id_ed25519)/i.test(base)) {
    return true;
  }
  if (
    normalized === 'projects.yaml' ||
    normalized === '.state/topology-cache.json' ||
    normalized === '.claude/settings.json' ||
    normalized === '.claude/settings.local.json'
  ) {
    return true;
  }
  if (/^(dist|dist-[^/]+|build)(\/|$)/i.test(normalized)) {
    return true;
  }
  if (/^node_modules(\/|$)/i.test(normalized)) {
    return true;
  }
  return false;
}

/**
 * Formats the commit message in strict `S.M:A` format:
 * - Header: `ALL CAPS, COMMA-SEPARATED SUMMARY OF CHANGES` (with `BUMP VERSION TO X.Y.Z` appended if bumped)
 * - Blank line
 * - `-` bullet points starting with active verbs (no em dashes `—`)
 * - Blank line
 * - Footer: `Author -- S.M:A` (never any `Co-Authored-By` or AI trailers)
 */
export function formatPushitCommitMessage(opts: {
  summaryHeader: string;
  bullets: string[];
  bumpedVersion?: string | null;
}): { header: string; fullMessage: string } {
  let cleanHeader = opts.summaryHeader
    .replace(/—/g, '--')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

  if (!cleanHeader) {
    cleanHeader = 'UPDATE PROJECT SOURCE AND CONFIGURATION';
  }

  if (
    opts.bumpedVersion &&
    !cleanHeader.includes(`BUMP VERSION TO ${opts.bumpedVersion.toUpperCase()}`)
  ) {
    cleanHeader = `${cleanHeader}, BUMP VERSION TO ${opts.bumpedVersion.toUpperCase()}`;
  }

  const sanitizedBullets = (
    opts.bullets.length > 0
      ? opts.bullets
      : ['Update repository source files and synchronize configuration']
  ).map((b) => {
    const stripped = b
      .replace(/^[-*•]\s*/, '')
      .replace(/—/g, '--')
      .replace(/Co-Authored-By:.*$/gi, '')
      .trim();
    return `- ${stripped.charAt(0).toUpperCase()}${stripped.slice(1)}`;
  });

  const fullMessage = [
    cleanHeader,
    '',
    ...sanitizedBullets,
    '',
    'Author -- S.M:A'
  ].join('\n');

  return {
    header: cleanHeader,
    fullMessage
  };
}

export class PushitExecutor {
  /**
   * Executes the full 4-step `pushit` workflow inside a Docker container or local repository.
   */
  static async execute(opts: PushitOptions): Promise<PushitResult> {
    const mode = opts.mode ?? 'local';
    const logs: string[] = [];

    const runGit = async (args: string[]): Promise<string> => {
      if (mode === 'cloud-ephemeral' && opts.shortRunId) {
        const { stdout } = await execFileAsync(
          'ssh',
          ['-S', `/tmp/commando-ssh-${opts.shortRunId}.sock`, 'commando@127.0.0.1', 'bash', '-lc', `cd ${opts.workspacePath} && git ${args.map(a => '"' + a.replace(/"/g, '\\"') + '"').join(' ')}`],
          { maxBuffer: 4 * 1024 * 1024 }
        );
        return stdout.trim();
      }
      if (mode === 'docker' && opts.containerName) {
        const { stdout } = await execFileAsync(
          'docker',
          ['exec', '-w', '/workspace', opts.containerName, 'git', ...args],
          { maxBuffer: 4 * 1024 * 1024 }
        );
        return stdout.trim();
      }
      const { stdout } = await execFileAsync('git', args, {
        cwd: opts.workspacePath,
        maxBuffer: 4 * 1024 * 1024
      });
      return stdout.trim();
    };

    const readPackageJson = async (): Promise<string | null> => {
      try {
        if (mode === 'cloud-ephemeral' && opts.shortRunId) {
          const { stdout } = await execFileAsync('ssh', [
            '-S',
            `/tmp/commando-ssh-${opts.shortRunId}.sock`,
            'commando@127.0.0.1',
            'bash',
            '-lc',
            `cat ${opts.workspacePath}/package.json`
          ]);
          return stdout;
        }
        if (mode === 'docker' && opts.containerName) {
          const { stdout } = await execFileAsync('docker', [
            'exec',
            '-w',
            '/workspace',
            opts.containerName,
            'cat',
            'package.json'
          ]);
          return stdout;
        }
        return await fs.readFile(path.join(opts.workspacePath, 'package.json'), 'utf8');
      } catch {
        return null;
      }
    };

    const writePackageJson = async (content: string): Promise<void> => {
      if (mode === 'cloud-ephemeral' && opts.shortRunId) {
        const encoded = Buffer.from(content, 'utf8').toString('base64');
        await execFileAsync('ssh', [
          '-S',
          `/tmp/commando-ssh-${opts.shortRunId}.sock`,
          'commando@127.0.0.1',
          'bash',
          '-lc',
          `echo "${encoded}" | base64 -d > ${opts.workspacePath}/package.json`
        ]);
        return;
      }
      if (mode === 'docker' && opts.containerName) {
        const encoded = Buffer.from(content, 'utf8').toString('base64');
        await execFileAsync('docker', [
          'exec',
          '-w',
          '/workspace',
          opts.containerName,
          'bash',
          '-lc',
          `echo "${encoded}" | base64 -d > package.json`
        ]);
        return;
      }
      await fs.writeFile(path.join(opts.workspacePath, 'package.json'), content, 'utf8');
    };

    // 1. Determine current branch
    const branch =
      opts.targetBranch || (await runGit(['rev-parse', '--abbrev-ref', 'HEAD']));

    // 2. Inspect dirty/untracked files via `git status --porcelain`
    const porcelain = await runGit(['status', '--porcelain', '-uall']);
    if (!porcelain) {
      return {
        committed: false,
        pushed: false,
        branch,
        commitSha: null,
        commitHeader: '',
        commitMessage: '',
        versionBumped: false,
        previousVersion: null,
        newVersion: null,
        commitsSinceLastBump: 0,
        stagedFiles: [],
        excludedFiles: [],
        logs: 'Working tree is clean; nothing to commit.'
      };
    }

    const candidateFiles: string[] = [];
    for (const line of porcelain.split('\n')) {
      if (!line.trim()) continue;
      const rawPath = line.slice(3).trim();
      // Handle rename syntax `old -> new`
      const resolvedPath = rawPath.includes(' -> ')
        ? rawPath.split(' -> ').pop()!.trim()
        : rawPath.replace(/^"|"$/g, '');
      candidateFiles.push(resolvedPath);
    }

    const stagedFiles: string[] = [];
    const excludedFiles: string[] = [];

    for (const file of candidateFiles) {
      if (isExcludedFromStaging(file)) {
        excludedFiles.push(file);
      } else {
        stagedFiles.push(file);
      }
    }

    if (stagedFiles.length === 0) {
      return {
        committed: false,
        pushed: false,
        branch,
        commitSha: null,
        commitHeader: '',
        commitMessage: '',
        versionBumped: false,
        previousVersion: null,
        newVersion: null,
        commitsSinceLastBump: 0,
        stagedFiles: [],
        excludedFiles,
        logs: `All modified files were excluded by safety rules: [${excludedFiles.join(', ')}]`
      };
    }

    // 3. Step 1 of `pushit`: Check `package.json` version and count commits since last `"version":` bump
    let previousVersion: string | null = null;
    let newVersion: string | null = null;
    let versionBumped = false;
    let commitsSinceLastBump = 0;

    const pkgRaw = await readPackageJson();
    if (pkgRaw) {
      try {
        const pkgObj = JSON.parse(pkgRaw) as { version?: string };
        if (typeof pkgObj.version === 'string') {
          previousVersion = pkgObj.version;

          let lastBumpSha = '';
          try {
            lastBumpSha = await runGit([
              'log',
              '-G',
              '"version":',
              '-n',
              '1',
              '--format=%H',
              '--',
              'package.json'
            ]);
          } catch {
            lastBumpSha = '';
          }

          try {
            const countStr = lastBumpSha
              ? await runGit(['rev-list', '--count', `${lastBumpSha}..HEAD`])
              : await runGit(['rev-list', '--count', 'HEAD']);
            commitsSinceLastBump = Number.parseInt(countStr, 10) || 0;
          } catch {
            commitsSinceLastBump = 0;
          }

          const bumpDecision = computeNextVersion(previousVersion, commitsSinceLastBump);
          newVersion = bumpDecision.nextVersion;
          if (bumpDecision.shouldBump && newVersion !== previousVersion) {
            versionBumped = true;
            const updatedPkgRaw = pkgRaw.replace(
              /("version"\s*:\s*")([^"]+)(")/,
              `$1${newVersion}$3`
            );
            await writePackageJson(updatedPkgRaw);
            if (!stagedFiles.includes('package.json')) {
              stagedFiles.push('package.json');
            }
            logs.push(
              `Bumped package.json version: ${previousVersion} -> ${newVersion} (${commitsSinceLastBump + 1}/5 commits).`
            );
          } else {
            logs.push(
              `Version kept at ${previousVersion} (${commitsSinceLastBump + 1}/5 commits since last bump).`
            );
          }
        }
      } catch (err) {
        logs.push(`Skipped package.json version check: ${(err as Error).message}`);
      }
    }

    // 4. Stage allowed files
    await runGit(['add', '--', ...stagedFiles]);

    // 5. Format commit message and commit
    const { header: commitHeader, fullMessage: commitMessage } =
      formatPushitCommitMessage({
        summaryHeader: opts.summaryHeader,
        bullets: opts.bullets,
        bumpedVersion: versionBumped ? newVersion : null
      });

    await runGit(['commit', '-m', commitMessage]);
    const commitSha = await runGit(['rev-parse', 'HEAD']);
    logs.push(`Committed ${commitSha.slice(0, 8)} on branch ${branch}: ${commitHeader}`);

    // 6. Push to `origin <branch>` unless `skipPush` is true
    let pushed = false;
    if (!opts.skipPush) {
      await runGit(['push', 'origin', branch]);
      pushed = true;
      logs.push(`Pushed ${commitSha.slice(0, 8)} to origin/${branch}.`);
    }

    return {
      committed: true,
      pushed,
      branch,
      commitSha,
      commitHeader,
      commitMessage,
      versionBumped,
      previousVersion,
      newVersion,
      commitsSinceLastBump,
      stagedFiles,
      excludedFiles,
      logs: logs.join('\n')
    };
  }
}
