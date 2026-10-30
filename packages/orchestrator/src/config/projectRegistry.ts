import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

/**
 * Project Registry & Private Data Loader
 *
 * Everything workspace-specific (project slugs, repo folders, seeded agents, demo backlog)
 * is resolved at runtime instead of being hardcoded:
 *
 * - Commando root: `COMMANDO_ROOT` env, an explicit root, `process.cwd()`, `../..` from cwd,
 *   or the repo root derived from this module's location.
 * - Projects: `COMMANDO_PROJECTS_FILE` env or `<root>/projects.yaml` (see `projects.example.yaml`).
 *   When absent, a small generic demo registry is used.
 * - Private data: JSON files under `COMMANDO_PRIVATE_DATA_DIR` env or
 *   `<root>/private-data/orchestrator/`. Every consumer falls back to generic demo data in code.
 */

export interface ProjectEntry {
  slug: string;
  description: string;
  department: string; // 'tech' | 'infra' | ...
  folders: string[];
  repos: string[]; // folder basenames
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

const DEMO_PROJECTS: ProjectEntry[] = [
  {
    slug: 'demo-game',
    description: 'Demo WebXR game (client + realtime server)',
    department: 'tech',
    folders: ['/path/to/demo-game/demo-game-client', '/path/to/demo-game/demo-game-server'],
    repos: ['demo-game-client', 'demo-game-server'],
  },
  {
    slug: 'example-api',
    description: 'Example REST API service',
    department: 'tech',
    folders: ['/path/to/example-api'],
    repos: ['example-api'],
  },
  {
    slug: 'infra-ops',
    description: 'Infrastructure, deploy scripts and cloud cost tooling',
    department: 'infra',
    folders: ['/path/to/infra-ops'],
    repos: ['infra-ops'],
  },
];

function looksLikeCommandoRoot(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, 'AGENTS.md')) ||
    fs.existsSync(path.join(dir, 'context')) ||
    fs.existsSync(path.join(dir, 'projects.yaml'))
  );
}

let cachedRoot: string | null = null;

export function resolveCommandoRoot(explicitRoot?: string): string {
  if (explicitRoot && fs.existsSync(explicitRoot)) return explicitRoot;
  if (cachedRoot) return cachedRoot;
  const candidates = [
    process.env.COMMANDO_ROOT || '',
    process.cwd(),
    path.resolve(process.cwd(), '../..'),
    // packages/orchestrator/src/config -> repo root
    path.resolve(MODULE_DIR, '../../../..'),
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c) && looksLikeCommandoRoot(c)) {
      cachedRoot = c;
      return c;
    }
  }
  cachedRoot = process.cwd();
  return cachedRoot;
}

export function getPrivateDataDir(): string {
  return (
    process.env.COMMANDO_PRIVATE_DATA_DIR ||
    path.join(resolveCommandoRoot(), 'private-data', 'orchestrator')
  );
}

const privateDataCache = new Map<string, unknown>();

/**
 * Loads `<private-data>/<name>.json` if present. Returns null when missing or invalid.
 */
export function loadPrivateData<T>(name: string): T | null {
  if (privateDataCache.has(name)) return privateDataCache.get(name) as T | null;
  let value: T | null = null;
  try {
    const p = path.join(getPrivateDataDir(), `${name}.json`);
    if (fs.existsSync(p)) {
      value = JSON.parse(fs.readFileSync(p, 'utf8')) as T;
    }
  } catch (err) {
    console.warn(`[projectRegistry] Failed to load private data "${name}":`, err);
    value = null;
  }
  privateDataCache.set(name, value);
  return value;
}

let cachedProjects: ProjectEntry[] | null = null;
let projectsFromFile = false;

export function getProjects(): ProjectEntry[] {
  if (cachedProjects) return cachedProjects;
  const file =
    process.env.COMMANDO_PROJECTS_FILE || path.join(resolveCommandoRoot(), 'projects.yaml');
  try {
    if (fs.existsSync(file)) {
      const parsed = YAML.parse(fs.readFileSync(file, 'utf8')) as {
        projects?: Record<string, { description?: string; department?: string; folders?: string[] }>;
      };
      const entries = Object.entries(parsed?.projects || {}).map(([slug, p]) => {
        const folders = Array.isArray(p?.folders) ? p.folders.filter(Boolean).map(String) : [];
        return {
          slug,
          description: String(p?.description || ''),
          department: String(p?.department || 'tech').toLowerCase(),
          folders,
          repos: folders.map((f) => path.basename(f)),
        };
      });
      if (entries.length > 0) {
        cachedProjects = entries;
        projectsFromFile = true;
        return entries;
      }
    }
  } catch (err) {
    console.warn('[projectRegistry] Failed to parse projects.yaml, using demo registry:', err);
  }
  cachedProjects = DEMO_PROJECTS;
  projectsFromFile = false;
  return cachedProjects;
}

export function isUsingDemoProjects(): boolean {
  getProjects();
  return !projectsFromFile;
}

export function getProject(slug: string): ProjectEntry | undefined {
  return getProjects().find((p) => p.slug === slug);
}

export function isInfraProject(slug: string | null | undefined): boolean {
  if (!slug) return false;
  return getProject(slug)?.department === 'infra';
}

export function getTechProjects(): ProjectEntry[] {
  return getProjects().filter((p) => p.department !== 'infra');
}

export function getDefaultProjectSlug(): string {
  return (
    process.env.COMMANDO_DEFAULT_PROJECT ||
    getTechProjects()[0]?.slug ||
    getProjects()[0]?.slug ||
    'general'
  );
}

export function getInfraProjectSlug(): string {
  return getProjects().find((p) => p.department === 'infra')?.slug || 'infra-ops';
}

/**
 * Keywords that identify a project in free text: its slug, the dash-separated parts of
 * its slug (>= 4 chars), and optionally its repo folder names.
 */
export function getProjectKeywords(p: ProjectEntry, includeRepos = false): string[] {
  const kws = new Set<string>([p.slug.toLowerCase()]);
  for (const part of p.slug.toLowerCase().split('-')) {
    if (part.length >= 4) kws.add(part);
  }
  if (includeRepos) {
    for (const r of p.repos) kws.add(r.toLowerCase());
  }
  return Array.from(kws);
}

/**
 * Finds the first non-default project mentioned in text, falling back to the default project.
 */
export function inferProjectFromText(
  text: string,
  options?: { includeRepos?: boolean; filter?: (p: ProjectEntry) => boolean }
): string {
  const lower = text.toLowerCase();
  const def = getDefaultProjectSlug();
  const includeRepos = Boolean(options?.includeRepos);
  for (const p of getProjects()) {
    if (p.slug === def) continue;
    if (options?.filter && !options.filter(p)) continue;
    if (getProjectKeywords(p, includeRepos).some((k) => lower.includes(k))) return p.slug;
  }
  return def;
}

/** Test hook: clears memoized registry/private data. */
export function resetProjectRegistryCache(): void {
  cachedProjects = null;
  cachedRoot = null;
  privateDataCache.clear();
}
