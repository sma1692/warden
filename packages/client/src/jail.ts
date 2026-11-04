import fs from 'node:fs';
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
  if (!isWithin(root, target)) {
    throw new Error(`path escapes workspace: ${rel}`);
  }
  // Symlinks: compare real paths so a link inside the workspace cannot point outside it.
  const realRoot = realpathOfExisting(root);
  const realTarget = realpathOfExisting(target);
  if (!isWithin(realRoot, realTarget)) {
    throw new Error(`path escapes workspace via symlink: ${rel}`);
  }
  return realTarget;
}

function isWithin(root: string, target: string): boolean {
  return target === root || target.startsWith(root + path.sep);
}

/**
 * Real path of `p`, resolving symlinks through its nearest existing ancestor,
 * so paths for files that do not exist yet (writes) are still checked.
 */
export function realpathOfExisting(p: string): string {
  const missing: string[] = [];
  let current = p;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    missing.unshift(path.basename(current));
    current = parent;
  }
  const base = fs.existsSync(current) ? fs.realpathSync(current) : current;
  return missing.length > 0 ? path.join(base, ...missing) : base;
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
