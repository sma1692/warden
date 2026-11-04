import path from 'node:path';

/**
 * Resolves a command path inside the workspace root. Throws when the path is
 * absolute, empty, or escapes the root (including via `..` segments).
 */
export function resolveInside(workspace: string, rel: string): string {
  if (typeof rel !== 'string' || !rel.trim()) {
    throw new Error('missing path');
  }
  if (path.isAbsolute(rel)) {
    throw new Error(`absolute paths are not allowed: ${rel}`);
  }
  const root = path.resolve(workspace);
  const target = path.resolve(root, rel);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`path escapes workspace: ${rel}`);
  }
  return target;
}

const SECRET_BASENAMES: RegExp[] = [
  /^\.env(\..+)?$/i,
  /\.(pem|key|p12|pfx)$/i,
  /^(id_rsa|id_ed25519)/i,
];

/**
 * Refuses reads of secret files (`.env`, private keys). `.env.example`-style
 * templates stay readable.
 */
export function assertReadable(rel: string): void {
  const base = rel.replace(/\\/g, '/').split('/').pop() || '';
  if (/^\.env\.(example|sample|template)$/i.test(base)) return;
  if (SECRET_BASENAMES.some((re) => re.test(base))) {
    throw new Error(`refused: ${base} looks like a secret file`);
  }
}
