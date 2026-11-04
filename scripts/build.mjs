#!/usr/bin/env node
// Warden stag/prod build selector.
//
//   npm run build        -> prompts for stag/prod (default: prod)
//   npm run build:prod   -> prod, no prompt
//   npm run build:stag   -> stag, no prompt
//   npm run build:local  -> plain local build, no URL injection
//   WARDEN_ENV=stag npm run build -> no prompt (CI-friendly)
//
// The chosen target is baked into the dashboard bundle via VITE_API_URL /
// VITE_WS_URL (consumed by packages/web/src/api/base.ts). A value already
// present in the environment wins over the default below.

import { spawnSync } from 'node:child_process';
import readline from 'node:readline';

const TARGETS = {
  stag: {
    VITE_API_URL: 'https://stag-api.warden.autos',
    VITE_WS_URL: 'wss://stag-api.warden.autos/ws',
  },
  prod: {
    VITE_API_URL: 'https://api.warden.autos',
    VITE_WS_URL: 'wss://api.warden.autos/ws',
  },
};

const VALID = ['stag', 'prod', 'local'];

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => {
    rl.close();
    resolve(ans.trim().toLowerCase());
  }));
}

let target = (process.argv[2] || process.env.WARDEN_ENV || '').trim().toLowerCase();
if (target && !VALID.includes(target)) {
  console.error(`[build] Unknown target "${target}". Use stag, prod, or local.`);
  process.exit(1);
}
if (!target) {
  if (process.stdin.isTTY) {
    const ans = await ask('Build target [stag/prod] (default: prod): ');
    target = ans === '' ? 'prod' : ans;
    if (!['stag', 'prod'].includes(target)) {
      console.error(`[build] Unknown target "${target}". Use stag or prod.`);
      process.exit(1);
    }
  } else {
    target = 'prod'; // Non-interactive (CI): default to prod, never hang.
    console.log('[build] No TTY detected; defaulting to prod.');
  }
}

const env = { ...process.env };
if (target !== 'local') {
  for (const [key, value] of Object.entries(TARGETS[target])) {
    if (env[key]) {
      console.log(`[build] ${key}=${env[key]} (from environment, overrides ${target} default)`);
    } else {
      env[key] = value;
      console.log(`[build] ${key}=${value}`);
    }
  }
} else {
  console.log('[build] local: no URL injection, dashboard uses same-origin /api.');
}

const res = spawnSync('npm', ['run', 'build', '--workspaces', '--if-present'], {
  stdio: 'inherit',
  env,
});
process.exit(res.status ?? 1);
