import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Repo root of the command center. Override with `COMMANDO_ROOT`.
 */
export const COMMANDO_ROOT: string =
  process.env.COMMANDO_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Loads an optional JSON file from `<COMMANDO_ROOT>/private-data/<relPath>`.
 * Deployment-specific data (repo registries, project rosters) lives there and is
 * never published. Returns `fallback` when the file is missing or invalid.
 */
export function loadPrivateJson<T>(relPath: string, fallback: T): T {
  const file = path.join(process.env.COMMANDO_PRIVATE_DATA_DIR || path.join(COMMANDO_ROOT, 'private-data'), relPath);
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch (err) {
    console.warn(`[sandbox] Ignoring unreadable private data file ${file}: ${(err as Error).message}`);
    return fallback;
  }
}
