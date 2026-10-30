#!/usr/bin/env node
/**
 * scripts/onboard.mjs
 *
 * Programmatic and CLI onboarding utility for Commando / Warden.
 * - Detects first-run state (.state/onboarded.json).
 * - Updates .claude/settings.local.json with allowed repo paths.
 * - Configures projects.yaml, context/, memory/, worklist/.
 * - Triggers repo-tool.mjs sync-in to establish zero-popup .state/mirror/<repo>.
 * - Marks completion in .state/onboarded.json.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE_DIR = path.join(ROOT, '.state');
const ONBOARDED_FILE = path.join(STATE_DIR, 'onboarded.json');
const PROJECTS_YAML = path.join(ROOT, 'projects.yaml');
const CLAUDE_DIR = path.join(ROOT, '.claude');
const SETTINGS_LOCAL = path.join(CLAUDE_DIR, 'settings.local.json');
const SETTINGS_DEFAULT = path.join(CLAUDE_DIR, 'settings.json');
const SETTINGS_EXAMPLE = path.join(CLAUDE_DIR, 'settings.example.json');

export function isOnboarded() {
  if (!fs.existsSync(ONBOARDED_FILE)) return false;
  try {
    const data = JSON.parse(fs.readFileSync(ONBOARDED_FILE, 'utf8'));
    return Boolean(data.completed);
  } catch {
    return false;
  }
}

export function updateClaudeSettings(repoPaths = []) {
  fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  let settings = {
    permissions: {
      allow: [
        'Bash(npm *)',
        'Bash(git status*)',
        'Bash(git diff*)',
        'Bash(git log*)',
        'Bash(node scripts/repo-tool.mjs *)'
      ],
      additionalDirectories: []
    }
  };

  const candidateFile = fs.existsSync(SETTINGS_LOCAL)
    ? SETTINGS_LOCAL
    : fs.existsSync(SETTINGS_DEFAULT)
      ? SETTINGS_DEFAULT
      : SETTINGS_EXAMPLE;

  if (fs.existsSync(candidateFile)) {
    try {
      const existing = JSON.parse(fs.readFileSync(candidateFile, 'utf8'));
      if (existing.permissions) {
        settings.permissions.allow = Array.from(
          new Set([...(settings.permissions.allow || []), ...(existing.permissions.allow || [])])
        );
        settings.permissions.additionalDirectories = Array.from(
          new Set([...(settings.permissions.additionalDirectories || []), ...(existing.permissions.additionalDirectories || [])])
        );
      }
    } catch (e) {
      console.warn(`Could not parse ${candidateFile}:`, e.message);
    }
  }

  // Ensure workspace ROOT is allowed
  const normalizedRoot = path.resolve(ROOT);
  if (!settings.permissions.additionalDirectories.includes(normalizedRoot)) {
    settings.permissions.additionalDirectories.push(normalizedRoot);
  }
  const rootReadPattern = `Read(${normalizedRoot}/**)`;
  const rootEditPattern = `Edit(${normalizedRoot}/**)`;
  const rootWritePattern = `Write(${normalizedRoot}/**)`;
  if (!settings.permissions.allow.includes(rootReadPattern)) settings.permissions.allow.push(rootReadPattern);
  if (!settings.permissions.allow.includes(rootEditPattern)) settings.permissions.allow.push(rootEditPattern);
  if (!settings.permissions.allow.includes(rootWritePattern)) settings.permissions.allow.push(rootWritePattern);

  // Add each external repo path
  for (const rawPath of repoPaths) {
    if (!rawPath) continue;
    const resolved = path.resolve(rawPath);
    if (!settings.permissions.additionalDirectories.includes(resolved)) {
      settings.permissions.additionalDirectories.push(resolved);
    }
    const readPattern = `Read(${resolved}/**)`;
    const editPattern = `Edit(${resolved}/**)`;
    const writePattern = `Write(${resolved}/**)`;
    if (!settings.permissions.allow.includes(readPattern)) settings.permissions.allow.push(readPattern);
    if (!settings.permissions.allow.includes(editPattern)) settings.permissions.allow.push(editPattern);
    if (!settings.permissions.allow.includes(writePattern)) settings.permissions.allow.push(writePattern);
  }

  fs.writeFileSync(SETTINGS_LOCAL, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  console.log(`Updated Claude settings at: ${SETTINGS_LOCAL}`);
  return settings;
}

export function syncProjectMirrors(projectKeys = []) {
  const repoToolPath = path.join(ROOT, 'scripts', 'repo-tool.mjs');
  if (!fs.existsSync(repoToolPath)) {
    console.warn(`repo-tool.mjs not found at ${repoToolPath}`);
    return;
  }

  for (const proj of projectKeys) {
    try {
      console.log(`Initializing sandbox mirror for project "${proj}"...`);
      execSync(`node "${repoToolPath}" sync-in "${proj}"`, {
        cwd: ROOT,
        stdio: 'inherit'
      });
    } catch (err) {
      console.error(`Failed to sync-in project ${proj}:`, err.message);
    }
  }
}

export function completeOnboarding(metadata = {}) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const payload = {
    completed: true,
    completedAt: new Date().toISOString(),
    version: '1.0.0',
    operator: metadata.operator || {
      name: 'Operator',
      company: 'Organization',
      timezone: 'UTC'
    },
    projects: metadata.projects || [],
    settingsConfigured: true,
    mirrorInitialized: true
  };

  fs.writeFileSync(ONBOARDED_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`Onboarding state recorded at: ${ONBOARDED_FILE}`);
  return payload;
}

// CLI check or interactive entrypoint
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const cmd = process.argv[2];
  if (cmd === 'check') {
    const status = isOnboarded();
    console.log(status ? 'ONBOARDED' : 'FIRST_RUN_REQUIRED');
    process.exit(status ? 0 : 1);
  } else if (cmd === 'complete') {
    completeOnboarding();
    process.exit(0);
  } else {
    console.log(`Commando Onboarding Status: ${isOnboarded() ? 'Completed' : 'Pending First-Run'}`);
    console.log(`Run with:`);
    console.log(`  node scripts/onboard.mjs check`);
    console.log(`  node scripts/onboard.mjs complete`);
  }
}
