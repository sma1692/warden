/**
 * Per-user demo project folders.
 *
 * Every demo user gets an isolated copy of the Tic-Tac-Toe Arena scaffold
 * under DEMO_WORKSPACE_ROOT/<userId>/, seeded from the tracked template in
 * `./template/`. All code edits happen in that folder; git pushes ride the
 * server's SSH setup. The user id prefix provides isolation and the
 * demo_workspaces row records the path.
 *
 * Env: DEMO_WORKSPACE_ROOT (default `<repo>/user-demos`, gitignored).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function demoTemplateDir(): string {
  const candidates = [
    path.join(HERE, 'template'),
    // Bundled deploys: resolve from the workspace checkout instead.
    path.resolve(process.cwd(), 'packages/orchestrator/src/demo/template'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
  }
  return candidates[0];
}

export function demoPrebuiltDir(): string {
  return path.join(demoTemplateDir(), 'build');
}

export function demoWorkspaceRoot(): string {
  const configured = (process.env.DEMO_WORKSPACE_ROOT || '').trim();
  if (configured) return path.resolve(configured);
  // packages/orchestrator/src/demo -> repo root is 4 levels up.
  return path.resolve(HERE, '..', '..', '..', '..', 'user-demos');
}

function sanitizeUserDir(userId: string): string {
  const cleaned = userId.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
  return cleaned || 'user';
}

/** Absolute path of this user's demo folder (created on demand). */
export function demoUserDir(userId: string): string {
  return path.join(demoWorkspaceRoot(), `u-${sanitizeUserDir(userId)}`);
}

function copyTree(src: string, dest: string): number {
  let count = 0;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      count += copyTree(from, to);
    } else {
      // Never overwrite a file the user (or an agent) already edited.
      if (!fs.existsSync(to)) {
        fs.copyFileSync(from, to);
        count++;
      }
    }
  }
  return count;
}

/**
 * Ensure the user's demo folder exists and is seeded from the template.
 * Idempotent: re-runs only fill in files that are still missing.
 */
export function ensureDemoFolder(userId: string): { dir: string; seededFiles: number } {
  const template = demoTemplateDir();
  if (!fs.existsSync(path.join(template, 'index.html'))) {
    throw new Error(`Demo template missing at ${template}`);
  }
  const dir = demoUserDir(userId);
  const seededFiles = copyTree(template, dir);
  return { dir, seededFiles };
}
