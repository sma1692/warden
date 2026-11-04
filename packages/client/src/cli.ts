#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { executeCommand } from './executor.js';
import type { CommandResult, PollResponse } from './protocol.js';

/**
 * warden-link: polls the control plane for commands and executes them inside
 * one workspace. Usage:
 *   warden-link start --url https://api.example.com --key <jwt> --workspace ./repo
 */

const DEFAULT_INTERVAL_MS = 5000;
const MAX_INTERVAL_MS = 30000;

function log(msg: string): void {
  console.log(`[warden-link ${new Date().toISOString()}] ${msg}`);
}

async function version(): Promise<string> {
  try {
    const pkgUrl = new URL('../package.json', import.meta.url);
    const raw = await fs.readFile(pkgUrl, 'utf8');
    return (JSON.parse(raw).version as string) || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function help(): string {
  return [
    'warden-link — run Warden commands inside one local workspace.',
    '',
    'Usage:',
    '  warden-link start --url <api> --key <jwt> --workspace <dir> [--interval-ms <n>] [--name <label>]',
    '  warden-link --help | --version',
    '',
    'The client polls POST /api/client/poll, executes read_file / write_file /',
    'pushit commands inside --workspace, and posts results back. Paths outside',
    'the workspace are refused; secret files (.env, private keys) are unreadable.',
  ].join('\n');
}

function parseArgs(argv: string[]): {
  command: string | null;
  url: string;
  key: string;
  workspace: string;
  intervalMs: number;
  name: string;
} {
  const out = { command: null as string | null, url: '', key: '', workspace: '', intervalMs: DEFAULT_INTERVAL_MS, name: 'warden-link' };
  const args = [...argv];
  if (args[0] && !args[0].startsWith('--')) out.command = args.shift() as string;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const next = args[i + 1] ?? '';
    if ((flag === '--url' || flag === '--key' || flag === '--workspace' || flag === '--name') && next) {
      if (flag === '--url') out.url = next.replace(/\/+$/, '');
      if (flag === '--key') out.key = next;
      if (flag === '--workspace') out.workspace = next;
      if (flag === '--name') out.name = next;
      i++;
    } else if (flag === '--interval-ms' && next) {
      const n = Number(next);
      if (Number.isFinite(n) && n >= 1000) out.intervalMs = Math.min(n, MAX_INTERVAL_MS);
      i++;
    }
  }
  return out;
}

async function poll(
  apiUrl: string,
  key: string,
  client: { name: string; version: string; platform: string }
): Promise<PollResponse> {
  const res = await fetch(`${apiUrl}/api/client/poll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ client }),
  });
  const data = (await res.json().catch(() => ({}))) as PollResponse;
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `poll failed with HTTP ${res.status}`);
  }
  return data;
}

async function postResults(
  apiUrl: string,
  key: string,
  results: CommandResult[]
): Promise<void> {
  if (results.length === 0) return;
  const res = await fetch(`${apiUrl}/api/client/result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ results }),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `result post failed with HTTP ${res.status}`);
  }
}

async function start(opts: {
  url: string;
  key: string;
  workspace: string;
  intervalMs: number;
  name: string;
}): Promise<void> {
  const root = path.resolve(opts.workspace);
  const stat = await fs.stat(root).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`workspace is not a directory: ${root}`);
  }
  const client = { name: opts.name, version: await version(), platform: process.platform };
  log(`connected workspace=${root} poll=${opts.intervalMs}ms`);

  let stopped = false;
  const stop = () => {
    if (!stopped) {
      stopped = true;
      log('shutting down');
    }
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  let backoffMs = opts.intervalMs;
  while (!stopped) {
    try {
      const { commands } = await poll(opts.url, opts.key, client);
      backoffMs = opts.intervalMs;
      const results: CommandResult[] = [];
      for (const cmd of commands ?? []) {
        log(`exec ${cmd.kind} ${(cmd as { path?: string }).path ?? (cmd as { summary?: string }).summary ?? cmd.id}`);
        const result = await executeCommand(root, cmd);
        log(`done ${cmd.id} ok=${result.ok}${result.error ? ` error=${result.error}` : ''}`);
        results.push(result);
      }
      await postResults(opts.url, opts.key, results);
    } catch (err) {
      log(`poll error: ${err instanceof Error ? err.message : String(err)} (retry in ${Math.round(backoffMs / 1000)}s)`);
      backoffMs = Math.min(backoffMs * 2, MAX_INTERVAL_MS);
    }
    if (!stopped) {
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(help());
    return;
  }
  if (argv.includes('--version') || argv.includes('-v')) {
    console.log(await version());
    return;
  }
  const opts = parseArgs(argv);
  if (opts.command !== 'start' || !opts.url || !opts.key || !opts.workspace) {
    console.error(help());
    process.exitCode = 2;
    return;
  }
  try {
    await start(opts);
  } catch (err) {
    console.error(`[warden-link] fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

void main();
