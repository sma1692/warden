// ============================================================================
// @commando/db — Deployment-specific data loader
// ============================================================================
// Private, deployment-specific data (agent rosters with project-scoped prompts,
// project keyword maps, preview ports) lives in `<COMMANDO_ROOT>/private-data/db/`
// and is never published. When absent, generic fallbacks are derived from
// `projects.yaml` (see `projects.example.yaml`).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import type { Department } from './schema.ts';

export const COMMANDO_ROOT: string =
  process.env.COMMANDO_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const PRIVATE_DATA_DIR: string =
  process.env.COMMANDO_PRIVATE_DATA_DIR || path.join(COMMANDO_ROOT, 'private-data');

/**
 * Reads `<PRIVATE_DATA_DIR>/<relPath>` as JSON, or returns `undefined` when missing/invalid.
 */
export function loadPrivateJson<T>(relPath: string): T | undefined {
  const file = path.join(PRIVATE_DATA_DIR, relPath);
  try {
    if (!fs.existsSync(file)) return undefined;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch (err) {
    console.warn(`[db] Ignoring unreadable private data file ${file}: ${(err as Error).message}`);
    return undefined;
  }
}

export interface ConfiguredProject {
  slug: string;
  department: Department;
  description: string;
  folders: string[];
}

/**
 * Parses the `projects:` map from `projects.yaml` (gitignored). Returns [] when absent.
 */
export function loadConfiguredProjects(): ConfiguredProject[] {
  const file = process.env.PROJECTS_YAML || path.join(COMMANDO_ROOT, 'projects.yaml');
  try {
    if (!fs.existsSync(file)) return [];
    const doc = (YAML.parse(fs.readFileSync(file, 'utf8')) || {}) as {
      projects?: Record<string, { description?: string; department?: string; folders?: unknown[] }>;
    };
    return Object.entries(doc.projects || {}).map(([slug, p]) => ({
      slug,
      department: (p?.department === 'infra' || p?.department === 'marketing' ? p.department : 'tech') as Department,
      description: typeof p?.description === 'string' ? p.description : '',
      folders: Array.isArray(p?.folders) ? p.folders.filter((f): f is string => typeof f === 'string') : [],
    }));
  } catch (err) {
    console.warn(`[db] Failed to parse ${file}: ${(err as Error).message}`);
    return [];
  }
}

export interface ProjectKeywordRule {
  /** Lowercase substrings; any match maps to this project. */
  match: string[];
  department: Department;
  projectSlug: string;
}

export interface DepartmentUnit {
  department: Department;
  project_slug: string;
  senior_agent_id: string;
}

export interface DeploymentProfile {
  /** Project used when nothing else matches. */
  defaultProject: string;
  /** Project owned by `infra_head` / `infra_jr`. */
  infraProject: string;
  /** Projects that have per-project `memory/<project>/<role>.md` files. */
  memoryScopedProjects: string[];
  /** Projects with a dedicated `pm:<project>` agent. */
  pmScopedProjects: string[];
  /** Projects with dedicated `tech_lead|backend_dev|frontend_dev:<project>` agents. */
  devScopedProjects: string[];
  /** Ordered keyword -> project rules used by markdown ingestion. */
  projectKeywordRules: ProjectKeywordRule[];
  /** Default local dev preview port per repo slug. */
  repoPreviewPorts: Record<string, number>;
  /** Default local dev preview port per project slug (fallback after repo). */
  projectPreviewPorts: Record<string, number>;
  /** Chat-log filename keyword -> default project. */
  chatThreadProjectRules: Array<{ match: string[]; projectSlug: string }>;
  /** Department units watched by the idle backlog monitor. */
  departmentUnits: DepartmentUnit[];
}

function buildFallbackProfile(): DeploymentProfile {
  const projects = loadConfiguredProjects();
  const tech = projects.filter((p) => p.department === 'tech').map((p) => p.slug);
  const infra = projects.filter((p) => p.department === 'infra').map((p) => p.slug);
  const defaultProject = process.env.COMMANDO_DEFAULT_PROJECT || tech[0] || 'demo-app';
  const infraProject = process.env.COMMANDO_INFRA_PROJECT || infra[0] || 'infra';
  const devScoped = tech.length ? tech : [defaultProject];

  const projectKeywordRules: ProjectKeywordRule[] = projects.map((p) => ({
    match: [p.slug.toLowerCase(), ...p.folders.map((f) => path.basename(f).toLowerCase())],
    department: p.department,
    projectSlug: p.slug,
  }));
  projectKeywordRules.push({ match: ['seo', 'aeo', 'marketing'], department: 'marketing', projectSlug: 'GLOBAL' });

  return {
    defaultProject,
    infraProject,
    memoryScopedProjects: devScoped,
    pmScopedProjects: [],
    devScopedProjects: devScoped,
    projectKeywordRules,
    repoPreviewPorts: {},
    projectPreviewPorts: {},
    chatThreadProjectRules: projects.map((p) => ({ match: [p.slug.toLowerCase()], projectSlug: p.slug })),
    departmentUnits: [
      ...devScoped.map((slug) => ({ department: 'tech' as Department, project_slug: slug, senior_agent_id: `tech_lead:${slug}` })),
      { department: 'infra', project_slug: infraProject, senior_agent_id: 'infra_head' },
      { department: 'marketing', project_slug: 'GLOBAL', senior_agent_id: 'seo_aeo_head' },
    ],
  };
}

let cachedProfile: DeploymentProfile | null = null;

/**
 * Deployment profile: `private-data/db/profile.json` merged over a generic fallback.
 */
export function getDeploymentProfile(): DeploymentProfile {
  if (cachedProfile) return cachedProfile;
  const fallback = buildFallbackProfile();
  const overrides = loadPrivateJson<Partial<DeploymentProfile>>('db/profile.json') || {};
  cachedProfile = { ...fallback, ...overrides };
  return cachedProfile;
}
