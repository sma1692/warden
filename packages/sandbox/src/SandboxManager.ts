import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  PermissionGuard,
  truncateToolOutput,
  normalizeAgentSlug,
  type PermissionTier
} from './PermissionGuard.js';
import {
  PreviewRouter,
  defaultPreviewRouter,
  toShortRunId,
  type PreviewRoute
} from './PreviewRouter.js';
import { PlaywrightQAGate, type QAResult } from './PlaywrightQAGate.js';
import { PushitExecutor, type PushitResult } from './PushitExecutor.js';
import { COMMANDO_ROOT, loadPrivateJson } from './privateData.js';

/**
 * Resolves the ephemeral-VM infra CLI (`cloud-ephemeral launch|snapshot|terminate`).
 * Order: `INFRA_EPHEMERAL_CLI` env, then candidates from
 * `private-data/sandbox/infra-cli.json` (relative paths resolve from the repo root).
 */
async function resolveEphemeralInfraCli(): Promise<string> {
  const cfg = loadPrivateJson<{ ephemeralCliCandidates?: string[]; legacyEnvVar?: string }>('sandbox/infra-cli.json', {});
  const candidates = [
    process.env.INFRA_EPHEMERAL_CLI,
    cfg.legacyEnvVar ? process.env[cfg.legacyEnvVar] : undefined,
    ...(cfg.ephemeralCliCandidates ?? []).map((p) => path.resolve(COMMANDO_ROOT, p))
  ].filter(Boolean) as string[];
  if (candidates.length === 0) {
    throw new Error('No ephemeral infra CLI configured. Set INFRA_EPHEMERAL_CLI.');
  }
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next candidate
    }
  }
  return candidates[0];
}

const execFileAsync = promisify(execFile);

export interface SandboxTelemetry {
  runId: string;
  containerId: string;
  mode: 'docker' | 'local' | 'cloud-ephemeral';
  cpuPercent: number;
  memUsedMb: number;
  memLimitMb: number;
  lastHeartbeatAt: string;
}

export interface SpawnSandboxOptions {
  runId: string;
  agentSlug: string;
  repoSlug: string;
  taskId?: string;
  hostRepoPath?: string;
  gitRepoUrl?: string;
  baseBranch?: string;
  dockerImage?: string;
  cpus?: number;
  memoryGb?: number;
  allowedRepos?: string[];
  permissionTier?: PermissionTier;
  preferLocalFallback?: boolean;
  preferCloudEphemeralShift?: boolean;
  onHeartbeat?: (telemetry: SandboxTelemetry) => void | Promise<void>;
}

export interface SandboxSession {
  runId: string;
  shortRunId: string;
  agentSlug: string;
  repoSlug: string;
  taskId: string;
  mode: 'docker' | 'local' | 'cloud-ephemeral';
  containerName: string;
  containerId: string;
  workspacePath: string;
  gitBranch: string;
  previewRoute: PreviewRoute;
  allowedRepos: string[];
  permissionTier: PermissionTier;
  startedAt: string;
  lastHeartbeatAt: string;
  telemetry: SandboxTelemetry;
}

export interface SandboxExecResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  combinedOutput: string;
  truncated: boolean;
  originalTokensEstimate: number;
  returnedTokensEstimate: number;
  durationMs: number;
  blockedByPermissionGuard?: boolean;
  requiresApprovalGate?: boolean;
}

export interface EmergencyKillResult {
  runId: string;
  recoveryBranch: string | null;
  recoveryCommitSha: string | null;
  killedAt: string;
  reason: string;
}

/**
 * Converts `@frontend_dev:my-project` -> `frontend-dev-my-project` for git branch naming.
 */
function sanitizeBranchSegment(raw: string): string {
  return raw
    .replace(/^@/, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'agent';
}

/**
 * Parses Docker memory strings like `1.2GiB`, `450MiB`, `512kB` into megabytes.
 */
function parseMemoryToMb(memStr: string): number {
  const match = memStr.trim().match(/^([\d.]+)\s*([a-zA-Z]+)/);
  if (!match) return 0;
  const val = Number.parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  if (unit.startsWith('g')) return Math.round(val * 1024);
  if (unit.startsWith('m')) return Math.round(val);
  if (unit.startsWith('k')) return Math.round(val / 1024);
  return Math.round(val / (1024 * 1024));
}

export interface CloudShiftInstanceInfo {
  instanceId: string;
  ip: string;
  expiresAt: number;
}

export interface CloudShiftSession extends SandboxSession {
  mode: 'cloud-ephemeral';
  cloudInstance: CloudShiftInstanceInfo;
}

export class SandboxManager {
  private async spawnShiftInstance(opts: SpawnSandboxOptions, agentSlug: string, shortRunId: string, repoSlug: string, gitBranch: string, previewRoute: PreviewRoute): Promise<CloudShiftSession | null> {
    const shiftKey = `${agentSlug}-${repoSlug}`;
    let activeShift = this.shiftSessions.get(shiftKey);
    const now = Date.now();

    if (activeShift && now < activeShift.cloudInstance.expiresAt - 15 * 60 * 1000) {
      // Warm handoff
      try {
        await execFileAsync('ssh', ['-S', `/tmp/commando-ssh-${activeShift.shortRunId}.sock`, 'commando@127.0.0.1', 'bash', '-lc', `cd /workspace/repos/${repoSlug} && git checkout -B ${gitBranch}`]);
        activeShift.runId = opts.runId;
        activeShift.shortRunId = shortRunId;
        activeShift.taskId = opts.taskId || shortRunId;
        activeShift.gitBranch = gitBranch;
        activeShift.previewRoute = previewRoute;
        return activeShift;
      } catch (err) {
        // Fall through
      }
    }

    try {
      const ttl = 28800;
      const infraCliScript = await resolveEphemeralInfraCli();

      const { stdout } = await execFileAsync('node', [
        infraCliScript,
        'cloud-ephemeral', 'launch',
        '--run-id', shortRunId,
        '--agent', agentSlug,
        '--project', repoSlug,
        '--repo', repoSlug,
        '--ttl', ttl.toString(),
        '--json'
      ]);
      const result = JSON.parse(stdout);
      const instanceName: string = result.instanceName || result.instanceId;
      const instanceIp: string = result.externalIp || result.ip || '127.0.0.1';
      const sshUser: string = result.sshUser || 'commando';

      // Start SSH ControlMaster (with identity key if provided)
      const sockPath = `/tmp/commando-ssh-${shortRunId}.sock`;
      const sshArgs = [
        '-M', '-S', sockPath,
        '-f', '-N',
        '-o', 'ControlPersist=8h',
        '-o', 'StrictHostKeyChecking=no',
        '-L', `${previewRoute.hostPort}:127.0.0.1:${previewRoute.containerPort}`
      ];
      if (result.sshKeyPath) {
        sshArgs.push('-i', result.sshKeyPath);
      }
      sshArgs.push(`${sshUser}@${instanceIp}`);
      await execFileAsync('ssh', sshArgs);

      await execFileAsync('ssh', ['-S', sockPath, `${sshUser}@127.0.0.1`, 'bash', '-lc', `mkdir -p /workspace/repos/${repoSlug} && cd /workspace/repos/${repoSlug} && git checkout -B ${gitBranch}`]).catch(() => {});

      const expiresAt = result.expiresAt ? new Date(result.expiresAt).getTime() : now + ttl * 1000;
      const session: CloudShiftSession = {
        runId: opts.runId,
        shortRunId,
        agentSlug,
        repoSlug,
        taskId: opts.taskId || shortRunId,
        mode: 'cloud-ephemeral',
        containerName: instanceName,
        containerId: result.instanceId || instanceName,
        workspacePath: result.workspacePath || `/workspace/repos/${repoSlug}`,
        gitBranch,
        previewRoute,
        allowedRepos: opts.allowedRepos || [],
        permissionTier: opts.permissionTier || 'standard_autonomous',
        startedAt: result.startedAt || new Date().toISOString(),
        lastHeartbeatAt: new Date().toISOString(),
        telemetry: {
          runId: opts.runId,
          containerId: result.instanceId || instanceName,
          mode: 'cloud-ephemeral',
          cpuPercent: 0,
          memUsedMb: 0,
          memLimitMb: 16384,
          lastHeartbeatAt: new Date().toISOString()
        },
        cloudInstance: {
          instanceId: instanceName,
          ip: instanceIp,
          expiresAt
        }
      };

      this.shiftSessions.set(shiftKey, session);

      // Schedule pre-teardown at T = 7h 45m (15 mins before 8h blow-up)
      setTimeout(() => {
        this.runPushit(opts.runId, { summaryHeader: 'AUTO SHIFT TEARDOWN', bullets: ['Save WIP before shift teardown'], skipPush: false })
          .finally(() => this.backupShiftImage(session.containerName))
          .finally(() => this.destroyShiftInstance(session.containerName));
      }, (ttl - 900) * 1000).unref();

      return session;
    } catch (err) {
      console.error(err);
      return null;
    }
  }

  async backupShiftImage(runIdOrInstanceName: string): Promise<boolean> {
    try {
      const infraCliScript = await resolveEphemeralInfraCli();
      await execFileAsync('node', [
        infraCliScript,
        'cloud-ephemeral', 'snapshot',
        '--instance', runIdOrInstanceName,
        '--json'
      ]);
      return true;
    } catch {
      return false;
    }
  }

  async destroyShiftInstance(runIdOrInstanceName: string): Promise<boolean> {
    try {
      const infraCliScript = await resolveEphemeralInfraCli();
      await execFileAsync('node', [
        infraCliScript,
        'cloud-ephemeral', 'terminate',
        '--instance', runIdOrInstanceName,
        '--json'
      ]);
      return true;
    } catch {
      return false;
    }
  }

  private readonly sessions = new Map<string, SandboxSession>();
  private readonly shiftSessions = new Map<string, CloudShiftSession>();
  private readonly heartbeatTimers = new Map<string, NodeJS.Timeout>();
  private readonly previewRouter: PreviewRouter;

  constructor(previewRouter: PreviewRouter = defaultPreviewRouter) {
    this.previewRouter = previewRouter;
  }

  /**
   * Checks whether the Docker daemon AND the target image (`commando-workspace:latest`) are available on the host.
   */
  async isDockerWorkspaceAvailable(
    image = 'commando-workspace:latest'
  ): Promise<boolean> {
    try {
      await execFileAsync('docker', ['info'], { timeout: 3000 });
      await execFileAsync('docker', ['image', 'inspect', image], { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Spawns an isolated ephemeral sandbox (`commando-run-<shortRunId>`) for an agent run:
   * - Validates `PermissionGuard.canAccessRepo(agentSlug, repoSlug, allowedRepos)`
   * - Allocates a live preview port (`15000-15999`) via `PreviewRouter`
   * - Spawns Docker container (`--cpus=2 --memory=8g`) OR seamlessly falls back to Local Isolated Sandbox mode
   * - Checks out feature branch `agent/<agentSlug>/<taskId>`
   * - Starts the 30-second heartbeat & CPU/RAM telemetry poller (`docker stats --no-stream` or host stats).
   */
  async spawnSandbox(opts: SpawnSandboxOptions): Promise<SandboxSession> {
    const existing = this.sessions.get(opts.runId);
    if (existing) {
      return existing;
    }

    const agentSlug = normalizeAgentSlug(opts.agentSlug);
    const allowedRepos = PermissionGuard.getAllowedRepos(agentSlug, opts.allowedRepos);
    const permissionTier: PermissionTier =
      opts.permissionTier ?? 'standard_autonomous';

    // 1. Enforce repository boundary via PermissionGuard
    const repoCheck = PermissionGuard.canAccessRepo(
      agentSlug,
      opts.repoSlug,
      allowedRepos
    );
    if (!repoCheck.allowed) {
      throw new Error(repoCheck.reason || `Access denied to repo ${opts.repoSlug}`);
    }

    const repoDef = PermissionGuard.resolveRepo(opts.repoSlug, opts.hostRepoPath);
    const shortRunId = toShortRunId(opts.runId);
    const taskId = sanitizeBranchSegment(opts.taskId || shortRunId);
    const gitBranch = `agent/${sanitizeBranchSegment(agentSlug)}/${taskId}`;
    const containerName = `commando-run-${shortRunId}`;
    const dockerImage = opts.dockerImage || 'commando-workspace:latest';
    const cpus = opts.cpus ?? 2;
    const memoryGb = opts.memoryGb ?? 8;

    // 2. Allocate dynamic preview port (15000-15999)
    const previewRoute = await this.previewRouter.allocateRoute({
      runId: opts.runId,
      agentSlug,
      repoSlug: opts.repoSlug,
      containerPort: repoDef.defaultPreviewPort ?? 4173
    });
    if (opts.preferCloudEphemeralShift) {
      const shiftSession = await this.spawnShiftInstance(opts, agentSlug, shortRunId, opts.repoSlug, gitBranch, previewRoute);
      if (shiftSession) {
        this.sessions.set(opts.runId, shiftSession);
        this.startHeartbeatPoller(shiftSession, opts.onHeartbeat);
        return shiftSession;
      }
    }


    // 3. Check if Docker daemon + `commando-workspace:latest` is available
    const useDocker =
      !opts.preferLocalFallback &&
      (await this.isDockerWorkspaceAvailable(dockerImage));

    let mode: 'docker' | 'local' | 'cloud-ephemeral' = 'local';
    let containerId = `local-${shortRunId}`;
    let workspacePath = repoDef.hostPath;

    if (useDocker) {
      try {
        const dockerArgs = [
          'run',
          '-d',
          '--name',
          containerName,
          `--cpus=${cpus}`,
          `--memory=${memoryGb}g`,
          '-p',
          `${previewRoute.hostPort}:${previewRoute.containerPort}`,
          '-e',
          `COMMANDO_RUN_ID=${opts.runId}`,
          '-e',
          `COMMANDO_AGENT_SLUG=${agentSlug}`,
          '-e',
          `COMMANDO_REPO_SLUG=${opts.repoSlug}`
        ];

        // Mount or copy repo into `/workspace` inside container
        const { stdout } = await execFileAsync('docker', [
          ...dockerArgs,
          dockerImage
        ]);
        containerId = stdout.trim().slice(0, 12) || containerName;
        mode = 'docker';
        workspacePath = '/workspace';

        // Seed `/workspace` from host repo or remote URL and checkout isolated feature branch
        if (opts.gitRepoUrl) {
          await execFileAsync('docker', [
            'exec',
            containerName,
            'git',
            'clone',
            opts.gitRepoUrl,
            '/workspace'
          ]);
        } else {
          await execFileAsync('docker', [
            'cp',
            `${repoDef.hostPath}/.`,
            `${containerName}:/workspace`
          ]);
        }

        await execFileAsync('docker', [
          'exec',
          '-w',
          '/workspace',
          containerName,
          'git',
          'checkout',
          '-B',
          gitBranch
        ]).catch(() => {});
      } catch {
        // Clean up partial container and fall back to Local Isolated Sandbox
        await execFileAsync('docker', ['rm', '-f', containerName]).catch(() => {});
        mode = 'local';
        containerId = `local-${shortRunId}`;
        workspacePath = repoDef.hostPath;
      }
    }

    const nowIso = new Date().toISOString();
    const initialTelemetry: SandboxTelemetry = {
      runId: opts.runId,
      containerId,
      mode,
      cpuPercent: 0,
      memUsedMb: Math.round((os.totalmem() - os.freemem()) / (1024 * 1024)),
      memLimitMb: memoryGb * 1024,
      lastHeartbeatAt: nowIso
    };

    const session: SandboxSession = {
      runId: opts.runId,
      shortRunId,
      agentSlug,
      repoSlug: opts.repoSlug,
      taskId,
      mode,
      containerName,
      containerId,
      workspacePath,
      gitBranch,
      previewRoute,
      allowedRepos,
      permissionTier,
      startedAt: nowIso,
      lastHeartbeatAt: nowIso,
      telemetry: initialTelemetry
    };

    this.sessions.set(opts.runId, session);

    // 4. Start 30-second heartbeat + CPU/RAM telemetry poller
    this.startHeartbeatPoller(session, opts.onHeartbeat);

    return session;
  }

  /**
   * Executes a shell command inside the sandbox (Docker container or Local Fallback),
   * guarded by `PermissionGuard.validateCommand` and the 8,000-token output truncation ceiling.
   */
  async execInSandbox(
    runId: string,
    command: string,
    toolName = 'run_command',
    timeoutMs = 120_000
  ): Promise<SandboxExecResult> {
    const startedAt = Date.now();
    const session = this.sessions.get(runId);
    if (!session) {
      return {
        ok: false,
        exitCode: 1,
        stdout: '',
        stderr: `Sandbox session not found for runId "${runId}".`,
        combinedOutput: `Sandbox session not found for runId "${runId}".`,
        truncated: false,
        originalTokensEstimate: 12,
        returnedTokensEstimate: 12,
        durationMs: 0
      };
    }

    // 1. Validate command against PermissionGuard
    const check = PermissionGuard.validateCommand({
      agentSlug: session.agentSlug,
      repoSlug: session.repoSlug,
      command,
      allowedRepos: session.allowedRepos,
      permissionTier: session.permissionTier
    });

    if (!check.allowed) {
      const msg = `[PermissionGuard Blocked ${toolName}]: ${check.reason}`;
      return {
        ok: false,
        exitCode: 126,
        stdout: '',
        stderr: msg,
        combinedOutput: msg,
        truncated: false,
        originalTokensEstimate: Math.ceil(msg.length / 4),
        returnedTokensEstimate: Math.ceil(msg.length / 4),
        durationMs: Date.now() - startedAt,
        blockedByPermissionGuard: true,
        requiresApprovalGate: check.requiresApprovalGate
      };
    }

    // 2. Execute inside Docker container or Local workspace
    try {
      const { stdout, stderr } =
        session.mode === 'cloud-ephemeral'
          ? await execFileAsync(
              'ssh',
              [
                '-S',
                `/tmp/commando-ssh-${session.shortRunId}.sock`,
                'commando@127.0.0.1',
                'bash',
                '-lc',
                `cd ${session.workspacePath} && ${command}`
              ],
              { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }
            )
          : session.mode === 'docker'
          ? await execFileAsync(
              'docker',
              [
                'exec',
                '-w',
                '/workspace',
                session.containerName,
                'bash',
                '-lc',
                command
              ],
              { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }
            )
          : await execFileAsync('bash', ['-lc', command], {
              cwd: session.workspacePath,
              timeout: timeoutMs,
              maxBuffer: 16 * 1024 * 1024
            });

      const truncatedStdout = truncateToolOutput(stdout, 8000);
      const truncatedStderr = truncateToolOutput(stderr, 4000);
      const combined = truncateToolOutput(
        [stdout, stderr].filter(Boolean).join('\n'),
        8000
      );

      session.lastHeartbeatAt = new Date().toISOString();

      return {
        ok: true,
        exitCode: 0,
        stdout: truncatedStdout.text,
        stderr: truncatedStderr.text,
        combinedOutput: combined.text,
        truncated: combined.truncated,
        originalTokensEstimate: combined.originalTokensEstimate,
        returnedTokensEstimate: combined.returnedTokensEstimate,
        durationMs: Date.now() - startedAt
      };
    } catch (err: unknown) {
      const execErr = err as {
        code?: number;
        stdout?: string;
        stderr?: string;
        message?: string;
      };
      const rawOut = execErr.stdout ?? '';
      const rawErr = execErr.stderr || execErr.message || String(err);
      const combined = truncateToolOutput(
        [rawOut, rawErr].filter(Boolean).join('\n'),
        8000
      );

      return {
        ok: false,
        exitCode: typeof execErr.code === 'number' ? execErr.code : 1,
        stdout: truncateToolOutput(rawOut, 8000).text,
        stderr: truncateToolOutput(rawErr, 8000).text,
        combinedOutput: combined.text,
        truncated: combined.truncated,
        originalTokensEstimate: combined.originalTokensEstimate,
        returnedTokensEstimate: combined.returnedTokensEstimate,
        durationMs: Date.now() - startedAt
      };
    }
  }

  /**
   * Reads a file inside the sandbox, guarded by `PermissionGuard.validateFileOperation`
   * and the 8,000-token output truncation ceiling.
   */
  async readFileInSandbox(
    runId: string,
    relativePath: string
  ): Promise<SandboxExecResult> {
    const startedAt = Date.now();
    const session = this.sessions.get(runId);
    if (!session) {
      throw new Error(`Sandbox session not found for runId "${runId}"`);
    }

    const fileCheck = PermissionGuard.validateFileOperation({
      agentSlug: session.agentSlug,
      repoSlug: session.repoSlug,
      filePath: relativePath,
      mode: 'read',
      allowedRepos: session.allowedRepos,
      permissionTier: session.permissionTier
    });

    if (!fileCheck.allowed) {
      const msg = `[PermissionGuard Blocked read_file]: ${fileCheck.reason}`;
      return {
        ok: false,
        exitCode: 126,
        stdout: '',
        stderr: msg,
        combinedOutput: msg,
        truncated: false,
        originalTokensEstimate: Math.ceil(msg.length / 4),
        returnedTokensEstimate: Math.ceil(msg.length / 4),
        durationMs: Date.now() - startedAt,
        blockedByPermissionGuard: true
      };
    }

    try {
      let content: string;
      if (session.mode === 'cloud-ephemeral') {
        const { stdout } = await execFileAsync('ssh', [
          '-S',
          `/tmp/commando-ssh-${session.shortRunId}.sock`,
          'commando@127.0.0.1',
          'bash',
          '-lc',
          `cat ${session.workspacePath}/${relativePath}`
        ]);
        content = stdout;
      } else if (session.mode === 'docker') {
        const { stdout } = await execFileAsync('docker', [
          'exec',
          '-w',
          '/workspace',
          session.containerName,
          'cat',
          relativePath
        ]);
        content = stdout;
      } else {
        const resolved = path.resolve(session.workspacePath, relativePath);
        content = await fs.readFile(resolved, 'utf8');
      }

      const truncated = truncateToolOutput(content, 8000);
      return {
        ok: true,
        exitCode: 0,
        stdout: truncated.text,
        stderr: '',
        combinedOutput: truncated.text,
        truncated: truncated.truncated,
        originalTokensEstimate: truncated.originalTokensEstimate,
        returnedTokensEstimate: truncated.returnedTokensEstimate,
        durationMs: Date.now() - startedAt
      };
    } catch (err: unknown) {
      const msg = (err as Error).message;
      return {
        ok: false,
        exitCode: 1,
        stdout: '',
        stderr: msg,
        combinedOutput: msg,
        truncated: false,
        originalTokensEstimate: Math.ceil(msg.length / 4),
        returnedTokensEstimate: Math.ceil(msg.length / 4),
        durationMs: Date.now() - startedAt
      };
    }
  }

  /**
   * Writes a file inside the sandbox, guarded by `PermissionGuard.validateFileOperation`.
   */
  async writeFileInSandbox(
    runId: string,
    relativePath: string,
    content: string
  ): Promise<SandboxExecResult> {
    const startedAt = Date.now();
    const session = this.sessions.get(runId);
    if (!session) {
      throw new Error(`Sandbox session not found for runId "${runId}"`);
    }

    const fileCheck = PermissionGuard.validateFileOperation({
      agentSlug: session.agentSlug,
      repoSlug: session.repoSlug,
      filePath: relativePath,
      mode: 'write',
      allowedRepos: session.allowedRepos,
      permissionTier: session.permissionTier
    });

    if (!fileCheck.allowed) {
      const msg = `[PermissionGuard Blocked write_file]: ${fileCheck.reason}`;
      return {
        ok: false,
        exitCode: 126,
        stdout: '',
        stderr: msg,
        combinedOutput: msg,
        truncated: false,
        originalTokensEstimate: Math.ceil(msg.length / 4),
        returnedTokensEstimate: Math.ceil(msg.length / 4),
        durationMs: Date.now() - startedAt,
        blockedByPermissionGuard: true,
        requiresApprovalGate: fileCheck.requiresApprovalGate
      };
    }

    try {
      if (session.mode === 'cloud-ephemeral') {
        const b64 = Buffer.from(content, 'utf8').toString('base64');
        const dir = path.posix.dirname(relativePath);
        await execFileAsync('ssh', [
          '-S',
          `/tmp/commando-ssh-${session.shortRunId}.sock`,
          'commando@127.0.0.1',
          'bash',
          '-lc',
          `mkdir -p "${session.workspacePath}/${dir}" && echo "${b64}" | base64 -d > "${session.workspacePath}/${relativePath}"`
        ]);
      } else if (session.mode === 'docker') {
        const b64 = Buffer.from(content, 'utf8').toString('base64');
        const dir = path.posix.dirname(relativePath);
        await execFileAsync('docker', [
          'exec',
          '-w',
          '/workspace',
          session.containerName,
          'bash',
          '-lc',
          `mkdir -p "${dir}" && echo "${b64}" | base64 -d > "${relativePath}"`
        ]);
      } else {
        const resolved = path.resolve(session.workspacePath, relativePath);
        await fs.mkdir(path.dirname(resolved), { recursive: true });
        await fs.writeFile(resolved, content, 'utf8');
      }

      const msg = `Wrote ${content.length} bytes to ${relativePath}`;
      return {
        ok: true,
        exitCode: 0,
        stdout: msg,
        stderr: '',
        combinedOutput: msg,
        truncated: false,
        originalTokensEstimate: Math.ceil(msg.length / 4),
        returnedTokensEstimate: Math.ceil(msg.length / 4),
        durationMs: Date.now() - startedAt
      };
    } catch (err: unknown) {
      const msg = (err as Error).message;
      return {
        ok: false,
        exitCode: 1,
        stdout: '',
        stderr: msg,
        combinedOutput: msg,
        truncated: false,
        originalTokensEstimate: Math.ceil(msg.length / 4),
        returnedTokensEstimate: Math.ceil(msg.length / 4),
        durationMs: Date.now() - startedAt
      };
    }
  }

  /**
   * Runs the Automated Headless Playwright + WebGL QA Gate (`PlaywrightQAGate`) inside the active sandbox.
   */
  async runQAGate(
    runId: string,
    opts: { skipBrowserCheck?: boolean; mediaDir?: string } = {}
  ): Promise<QAResult> {
    const session = this.sessions.get(runId);
    if (!session) {
      throw new Error(`Sandbox session not found for runId "${runId}"`);
    }

    return PlaywrightQAGate.runVerificationGate({
      runId: session.runId,
      repoSlug: session.repoSlug,
      workspacePath: session.workspacePath,
      mode: session.mode,
      containerName: session.containerName,
      shortRunId: session.shortRunId,
      previewPort:
        session.mode === 'docker'
          ? session.previewRoute.containerPort
          : session.previewRoute.hostPort,
      previewUrl: session.previewRoute.previewUrl,
      mediaDir: opts.mediaDir,
      skipBrowserCheck: opts.skipBrowserCheck
    });
  }

  /**
   * Runs the automated `pushit` protocol (`PushitExecutor`) inside the active sandbox.
   */
  async runPushit(
    runId: string,
    opts: {
      summaryHeader: string;
      bullets: string[];
      skipPush?: boolean;
    }
  ): Promise<PushitResult> {
    const session = this.sessions.get(runId);
    if (!session) {
      throw new Error(`Sandbox session not found for runId "${runId}"`);
    }

    return PushitExecutor.execute({
      workspacePath: session.workspacePath,
      mode: session.mode,
      containerName: session.containerName,
      shortRunId: session.shortRunId,
      summaryHeader: opts.summaryHeader,
      bullets: opts.bullets,
      skipPush: opts.skipPush
    });
  }

  /**
   * Section 4.6 24-Hour Hard Kill & Emergency Recovery (`HealthAndQuotaGuard`):
   * 1. Commits any uncommitted container work to recovery branch `wip/timeout-<shortRunId>`
   * 2. Sends `SIGTERM` -> `SIGKILL` and destroys the Docker container cleanly
   * 3. Releases the preview port and stops the heartbeat timer.
   */
  async emergencySaveAndKill(
    runId: string,
    reason = 'Exceeded 24-hour maximum runtime limit (HARD_KILL_TIMEOUT)'
  ): Promise<EmergencyKillResult> {
    const session = this.sessions.get(runId);
    const shortId = toShortRunId(runId);
    const recoveryBranch = `wip/timeout-${shortId}`;
    let recoveryCommitSha: string | null = null;

    if (session) {
      try {
        if (session.mode === 'docker') {
          const saveScript = [
            `git checkout -B ${recoveryBranch}`,
            'git add -A',
            `git commit -m "WIP RECOVERY BEFORE TIMEOUT KILL (${shortId})\n\n- Save uncommitted container work before hard timeout termination\n\nAuthor -- S.M:A" || true`,
            'git rev-parse HEAD'
          ].join(' && ');

          const { stdout } = await execFileAsync(
            'docker',
            ['exec', '-w', '/workspace', session.containerName, 'bash', '-lc', saveScript],
            { timeout: 10_000 }
          );
          const lines = stdout.trim().split('\n');
          recoveryCommitSha = lines[lines.length - 1]?.trim() || null;

          // Send SIGTERM then SIGKILL via docker stop -t 3
          await execFileAsync('docker', ['stop', '-t', '3', session.containerName], {
            timeout: 8000
          }).catch(() => {});
        } else {
          // In local fallback mode, check if repo has uncommitted changes without switching active developer branch destructively
          const { stdout: statusOut } = await execFileAsync(
            'git',
            ['status', '--porcelain'],
            { cwd: session.workspacePath }
          );
          if (statusOut.trim()) {
            // Create a git stash / recovery ref without losing working state
            const { stdout: stashSha } = await execFileAsync(
              'git',
              ['stash', 'create', `wip/timeout-${shortId}: ${reason}`],
              { cwd: session.workspacePath }
            );
            if (stashSha.trim()) {
              recoveryCommitSha = stashSha.trim();
              await execFileAsync(
                'git',
                ['branch', '-f', recoveryBranch, recoveryCommitSha],
                { cwd: session.workspacePath }
              ).catch(() => {});
            }
          }
        }
      } catch {
        // Proceed to destroy container even if git recovery failed
      }
    }

    await this.destroySandbox(runId);

    return {
      runId,
      recoveryBranch: recoveryCommitSha ? recoveryBranch : null,
      recoveryCommitSha,
      killedAt: new Date().toISOString(),
      reason
    };
  }

  /**
   * Tears down the sandbox container, stops its 30s heartbeat poller, and releases its preview port.
   */
  async destroySandbox(runId: string): Promise<boolean> {
    const timer = this.heartbeatTimers.get(runId);
    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(runId);
    }

    this.previewRouter.releaseRoute(runId);

    const session = this.sessions.get(runId);
    if (!session) {
      return false;
    }

    this.sessions.delete(runId);

    if (session.mode === 'docker') {
      await execFileAsync('docker', ['rm', '-f', session.containerName], {
        timeout: 10_000
      }).catch(() => {});
    }

    return true;
  }

  getSandbox(runId: string): SandboxSession | undefined {
    return this.sessions.get(runId);
  }

  listActiveSandboxes(): SandboxSession[] {
    return Array.from(this.sessions.values());
  }

  getTelemetry(runId: string): SandboxTelemetry | undefined {
    return this.sessions.get(runId)?.telemetry;
  }

  /**
   * Polls container CPU & RAM usage every 30 seconds (`docker stats --no-stream` or host stats)
   * and updates `session.lastHeartbeatAt` & `session.telemetry`.
   */
  private startHeartbeatPoller(
    session: SandboxSession,
    onHeartbeat?: (telemetry: SandboxTelemetry) => void | Promise<void>
  ): void {
    const poll = async () => {
      const nowIso = new Date().toISOString();
      let cpuPercent = 0;
      let memUsedMb = Math.round((os.totalmem() - os.freemem()) / (1024 * 1024));
      let memLimitMb = session.telemetry.memLimitMb;

      if (session.mode === 'docker') {
        try {
          const { stdout } = await execFileAsync(
            'docker',
            [
              'stats',
              '--no-stream',
              '--format',
              '{{.CPUPerc}}|{{.MemUsage}}',
              session.containerName
            ],
            { timeout: 4000 }
          );
          const [cpuRaw, memRaw] = stdout.trim().split('|');
          if (cpuRaw) {
            cpuPercent = Number.parseFloat(cpuRaw.replace('%', '')) || 0;
          }
          if (memRaw && memRaw.includes('/')) {
            const [usedPart, limitPart] = memRaw.split('/');
            memUsedMb = parseMemoryToMb(usedPart);
            memLimitMb = parseMemoryToMb(limitPart) || memLimitMb;
          }
        } catch {
          // Keep previous stats if docker stats timed out
        }
      } else {
        const load = os.loadavg()[0] ?? 0;
        const cpuCount = Math.max(1, os.cpus().length);
        cpuPercent = Math.min(100, Math.round((load / cpuCount) * 100 * 10) / 10);
      }

      session.lastHeartbeatAt = nowIso;
      session.telemetry = {
        runId: session.runId,
        containerId: session.containerId,
        mode: session.mode,
        cpuPercent,
        memUsedMb,
        memLimitMb,
        lastHeartbeatAt: nowIso
      };

      if (onHeartbeat) {
        try {
          await onHeartbeat(session.telemetry);
        } catch {
          // Ignore callback errors
        }
      }
    };

    const timer = setInterval(() => {
      void poll();
    }, 30_000);
    timer.unref();
    this.heartbeatTimers.set(session.runId, timer);
  }
}

export const defaultSandboxManager = new SandboxManager();
