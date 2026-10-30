import path from 'node:path';
import { loadPrivateJson } from './privateData.js';

export type PermissionTier = 'full_overdrive' | 'standard_autonomous' | 'strict_gate';

export interface AgentPermissionProfile {
  agentSlug: string;
  permissionTier: PermissionTier;
  allowedRepos: string[];
}

export interface PermissionCheckResult {
  allowed: boolean;
  requiresApprovalGate?: boolean;
  reason?: string;
  sanitizedCommand?: string;
}

export interface RepoDefinition {
  repoSlug: string;
  projectSlug: string;
  role: 'frontend' | 'backend' | 'fullstack' | 'shared-lib' | 'infra';
  hostPath: string;
  defaultPreviewPort?: number;
}

interface PermissionRegistryFile {
  repoRegistry?: Record<string, RepoDefinition>;
  defaultAgentAllowedRepos?: Record<string, string[]>;
  roleFallbackRepos?: Record<string, string[]>;
}

/**
 * Deployment-specific registry loaded from `private-data/sandbox/permission-registry.json`
 * when present. The public fallback is empty: register repos there (or pass explicit
 * `allowedRepos`) to grant scoped agents access.
 */
const PERMISSION_REGISTRY = loadPrivateJson<PermissionRegistryFile>('sandbox/permission-registry.json', {});

/**
 * Canonical repository registry across all configured company projects.
 */
export const REPO_REGISTRY: Record<string, RepoDefinition> = PERMISSION_REGISTRY.repoRegistry ?? {};

/**
 * Default repository boundaries per agent slug (e.g. `@tech_lead:<project>`).
 * Executive roles always get `*`.
 */
export const DEFAULT_AGENT_ALLOWED_REPOS: Record<string, string[]> = {
  '@warden': ['*'],
  '@cto': ['*'],
  '@pm': ['*'],
  ...(PERMISSION_REGISTRY.defaultAgentAllowedRepos ?? {})
};

/**
 * Base-role fallbacks (e.g. `@infra_jr` -> infra repos) used when no exact slug matches.
 */
const ROLE_FALLBACK_REPOS: Record<string, string[]> = PERMISSION_REGISTRY.roleFallbackRepos ?? {};

/**
 * Hard-blocked destructive or secret-exfiltrating shell patterns across ALL permission tiers.
 */
const DESTRUCTIVE_COMMAND_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--recursive)\s+(\/|\/\*|~|\$HOME)\b/i,
    reason: 'Blocked destructive root/home filesystem wipe (`rm -rf /` or `rm -rf ~`).'
  },
  {
    pattern: /\b(mkfs|dd\s+if=\/dev\/(zero|random|urandom)|shutdown|reboot|halt|poweroff)\b/i,
    reason: 'Blocked low-level disk/system destruction command.'
  },
  {
    pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    reason: 'Blocked shell fork bomb.'
  },
  {
    pattern: /\b(cat|less|more|head|tail|bat|sed|awk|grep|rg)\b[^\n|;&]*\b(\.env(\.[a-zA-Z0-9_-]+)?|id_rsa|id_ed25519|[^\s]*\.pem|[^\s]*\.key)\b/i,
    reason: 'Blocked reading `.env` secrets or private keys into agent terminal logs.'
  },
  {
    pattern: /\b(printenv|env)\b(\s*$|\s*\|)/i,
    reason: 'Blocked dumping raw environment variables containing cloud secrets into logs.'
  },
  {
    pattern: /\bgit\s+push\s+(--force|-f)\b/i,
    reason: 'Blocked `git push --force` to protect remote history.'
  },
  {
    pattern: /\bgit\s+reset\s+--hard\s+origin\b/i,
    reason: 'Blocked destructive remote reset without explicit branch backup.'
  }
];

/**
 * High-impact production mutation patterns that require an approval gate under `strict_gate`
 * (or production deploy checks under `standard_autonomous`).
 */
const PRODUCTION_GATE_PATTERNS: Array<{ pattern: RegExp; reason: string; blockInStandard: boolean }> = [
  {
    pattern: /\bkalti(\.js)?\s+prune\b(?![^\n]*--dry-run)/i,
    reason: 'AWS resource pruning without `--dry-run` requires CEO approval gate.',
    blockInStandard: true
  },
  {
    pattern: /\bwrangler\s+pages\s+deploy\b[^\n]*--branch(=|\s+)(main|master|production)\b/i,
    reason: 'Direct Cloudflare Pages production deployment requires approval under strict_gate.',
    blockInStandard: false
  },
  {
    pattern: /\b(DROP\s+TABLE|DROP\s+DATABASE|TRUNCATE\s+TABLE)\b/i,
    reason: 'Destructive SQL schema drop/truncate requires CEO approval gate.',
    blockInStandard: true
  }
];

/**
 * Files and folders that agents are blocked from reading directly into LLM context
 * to prevent quadratic token explosion (Section 4.7) or secret leakage.
 */
const BLOCKED_READ_PATH_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /(^|\/)\.env(\.[a-zA-Z0-9_-]+)?$/i,
    reason: 'Reading `.env` secret files is strictly prohibited (except `.env.example`).'
  },
  {
    pattern: /\.(pem|key|p12|pfx)$/i,
    reason: 'Reading private key / certificate files into context is prohibited.'
  },
  {
    pattern: /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/i,
    reason: 'Reading lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`) is blocked to prevent context token explosion (Section 4.7).'
  },
  {
    pattern: /(^|\/)(dist|build|node_modules|\.git)\//i,
    reason: 'Reading build artifacts (`dist/`, `build/`, `node_modules/`) directly into context is blocked (Section 4.7).'
  }
];

/**
 * Enforces the 8,000-token maximum ceiling per tool output (Section 4.7 of `dynamocommando.md`).
 * Uses a conservative 4 chars/token heuristic (32,000 chars for 8,000 tokens) and preserves both
 * the head (75%) and tail (25%) of the output so build/test errors at the end of logs are never lost.
 */
export function truncateToolOutput(output: string, maxTokens = 8000): {
  text: string;
  truncated: boolean;
  originalTokensEstimate: number;
  returnedTokensEstimate: number;
} {
  if (!output) {
    return {
      text: '',
      truncated: false,
      originalTokensEstimate: 0,
      returnedTokensEstimate: 0
    };
  }

  // Redact any accidental inline bearer tokens or AWS/GCP secret keys before returning to LLM
  const redacted = redactSecrets(output);
  const charsPerToken = 4;
  const maxChars = Math.max(512, maxTokens * charsPerToken);
  const originalTokensEstimate = Math.ceil(redacted.length / charsPerToken);

  if (redacted.length <= maxChars) {
    return {
      text: redacted,
      truncated: false,
      originalTokensEstimate,
      returnedTokensEstimate: originalTokensEstimate
    };
  }

  const headChars = Math.floor(maxChars * 0.72);
  const tailChars = Math.floor(maxChars * 0.23);
  const omittedChars = redacted.length - headChars - tailChars;
  const omittedTokens = Math.ceil(omittedChars / charsPerToken);

  const banner = `\n\n... [TRUNCATED BY PERMISSION_GUARD: omitted ~${omittedTokens} tokens (${omittedChars} chars) to enforce the ${maxTokens}-token tool output ceiling (Section 4.7)] ...\n\n`;
  const truncatedText = redacted.slice(0, headChars) + banner + redacted.slice(redacted.length - tailChars);

  return {
    text: truncatedText,
    truncated: true,
    originalTokensEstimate,
    returnedTokensEstimate: Math.ceil(truncatedText.length / charsPerToken)
  };
}

/**
 * Redacts common cloud credentials or tokens if they ever appear in stdout/stderr.
 */
export function redactSecrets(input: string): string {
  return input
    .replace(/\b(AKIA[0-9A-Z]{16})\b/g, 'AKIA****************')
    .replace(/(AWS_SECRET_ACCESS_KEY\s*=\s*)([^\s"']+)/gi, '$1[REDACTED]')
    .replace(/(CLOUDFLARE_API_TOKEN\s*=\s*)([^\s"']+)/gi, '$1[REDACTED]')
    .replace(/(TELEGRAM_BOT_TOKEN\s*=\s*)([^\s"']+)/gi, '$1[REDACTED]');
}

/**
 * Normalizes an agent slug (e.g. `frontend_dev:my-project` -> `@frontend_dev:my-project`).
 */
export function normalizeAgentSlug(slug: string): string {
  const trimmed = slug.trim();
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

export class PermissionGuard {
  /**
   * Resolves the allowed repository slugs for an agent, falling back to `DEFAULT_AGENT_ALLOWED_REPOS`.
   */
  static getAllowedRepos(agentSlug: string, explicitAllowedRepos?: string[]): string[] {
    if (explicitAllowedRepos && explicitAllowedRepos.length > 0) {
      return explicitAllowedRepos;
    }
    const normalized = normalizeAgentSlug(agentSlug);
    if (DEFAULT_AGENT_ALLOWED_REPOS[normalized]) {
      return DEFAULT_AGENT_ALLOWED_REPOS[normalized];
    }
    // Check base role prefix (e.g., `@tech_lead:custom` -> `@tech_lead`)
    const baseRole = normalized.split(':')[0];
    if (baseRole === '@warden' || baseRole === '@cto' || baseRole === '@pm') {
      return ['*'];
    }
    if (ROLE_FALLBACK_REPOS[baseRole]) {
      return ROLE_FALLBACK_REPOS[baseRole];
    }
    return [];
  }

  /**
   * Checks whether an agent is permitted to spawn a sandbox or mutate files in `repoSlug`.
   */
  static canAccessRepo(
    agentSlug: string,
    repoSlug: string,
    explicitAllowedRepos?: string[]
  ): PermissionCheckResult {
    const allowedRepos = this.getAllowedRepos(agentSlug, explicitAllowedRepos);
    const normalizedRepo = repoSlug.trim();

    if (allowedRepos.includes('*') || allowedRepos.includes(normalizedRepo)) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `Agent ${normalizeAgentSlug(agentSlug)} is not permitted to access repository "${normalizedRepo}". Allowed repositories: [${allowedRepos.join(', ') || 'none'}].`
    };
  }

  /**
   * Validates a file read/write operation inside a repository against boundary rules and Section 4.7 guards.
   */
  static validateFileOperation(opts: {
    agentSlug: string;
    repoSlug: string;
    filePath: string;
    mode: 'read' | 'write';
    allowedRepos?: string[];
    permissionTier?: PermissionTier;
  }): PermissionCheckResult {
    const repoCheck = this.canAccessRepo(opts.agentSlug, opts.repoSlug, opts.allowedRepos);
    if (!repoCheck.allowed) {
      return repoCheck;
    }

    const normalizedPath = opts.filePath.replace(/\\/g, '/');

    // Prevent path traversal outside workspace/repo root
    if (normalizedPath.includes('../') || normalizedPath.startsWith('/etc/') || normalizedPath.startsWith('/root/')) {
      return {
        allowed: false,
        reason: `Blocked path traversal outside repository sandbox: "${opts.filePath}".`
      };
    }

    // Allow `.env.example` or `.env.sample`, block real `.env*`
    const isExampleEnv = /\.env\.(example|sample|template)$/i.test(normalizedPath);
    if (!isExampleEnv) {
      for (const rule of BLOCKED_READ_PATH_PATTERNS) {
        if (rule.pattern.test(normalizedPath)) {
          return {
            allowed: false,
            reason: rule.reason
          };
        }
      }
    }

    // In `strict_gate` tier, writing to production deployment configs requires approval
    if (
      opts.mode === 'write' &&
      opts.permissionTier === 'strict_gate' &&
      /(^|\/)(protect\.json|sites\.json|Dockerfile|Caddyfile)$/i.test(normalizedPath)
    ) {
      return {
        allowed: false,
        requiresApprovalGate: true,
        reason: `Agent ${normalizeAgentSlug(opts.agentSlug)} is under 'strict_gate' tier; modifying critical config "${path.basename(normalizedPath)}" requires CEO approval.`
      };
    }

    return { allowed: true };
  }

  /**
   * Validates a shell command before executing inside the sandbox container or local fallback.
   */
  static validateCommand(opts: {
    agentSlug: string;
    repoSlug: string;
    command: string;
    allowedRepos?: string[];
    permissionTier?: PermissionTier;
  }): PermissionCheckResult {
    const repoCheck = this.canAccessRepo(opts.agentSlug, opts.repoSlug, opts.allowedRepos);
    if (!repoCheck.allowed) {
      return repoCheck;
    }

    const cmd = opts.command.trim();
    if (!cmd) {
      return { allowed: false, reason: 'Empty command is not allowed.' };
    }

    // 1. Check hard-blocked destructive / secret-dumping patterns across all tiers
    for (const rule of DESTRUCTIVE_COMMAND_PATTERNS) {
      if (rule.pattern.test(cmd)) {
        return {
          allowed: false,
          reason: rule.reason
        };
      }
    }

    // 2. Prevent reading `dist/` or `package-lock.json` via `cat`/`head`/`tail` shell commands
    if (/\b(cat|less|more)\b[^\n]*\b(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)\b/i.test(cmd)) {
      return {
        allowed: false,
        reason: 'Reading lockfiles via shell is blocked to prevent context window overflow (Section 4.7).'
      };
    }

    // 3. Enforce permission tier rules (`full_overdrive`, `standard_autonomous`, `strict_gate`)
    const tier: PermissionTier = opts.permissionTier ?? 'standard_autonomous';
    for (const gateRule of PRODUCTION_GATE_PATTERNS) {
      if (gateRule.pattern.test(cmd)) {
        if (tier === 'strict_gate' || (tier === 'standard_autonomous' && gateRule.blockInStandard)) {
          return {
            allowed: false,
            requiresApprovalGate: true,
            reason: gateRule.reason
          };
        }
      }
    }

    return {
      allowed: true,
      sanitizedCommand: cmd
    };
  }

  /**
   * Resolves a repository definition by slug, with support for custom host paths.
   */
  static resolveRepo(repoSlug: string, customHostPath?: string): RepoDefinition {
    const known = REPO_REGISTRY[repoSlug];
    if (known) {
      return customHostPath ? { ...known, hostPath: customHostPath } : known;
    }
    return {
      repoSlug,
      projectSlug: 'custom',
      role: 'fullstack',
      hostPath: customHostPath ?? path.resolve(process.cwd(), repoSlug),
      defaultPreviewPort: 4173
    };
  }
}
