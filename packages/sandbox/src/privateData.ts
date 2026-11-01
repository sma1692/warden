import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Repo root of the command center. Override with `WARDEN_ROOT`.
 */
export const WARDEN_ROOT: string =
  process.env.WARDEN_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Loads an optional JSON file from `<WARDEN_ROOT>/private-data/<relPath>`.
 * Deployment-specific data (repo registries, project rosters) lives there and is
 * never published. Returns `fallback` when the file is missing or invalid.
 */
export function loadPrivateJson<T>(relPath: string, fallback: T): T {
  const file = path.join(process.env.WARDEN_PRIVATE_DATA_DIR || path.join(WARDEN_ROOT, 'private-data'), relPath);
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch (err) {
    console.warn(`[sandbox] Ignoring unreadable private data file ${file}: ${(err as Error).message}`);
    return fallback;
  }
}
