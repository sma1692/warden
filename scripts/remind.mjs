#!/usr/bin/env node
// Tiny CLI for the Commando reminders API.
//   node scripts/remind.mjs "tomorrow 6pm call the design team"
//   node scripts/remind.mjs "every weekday at 9am standup prep" --channels telegram,macos
//   node scripts/remind.mjs --list [--status PENDING]
//   node scripts/remind.mjs --cancel <id>
//   node scripts/remind.mjs --fire <id>

const PORT = process.env.ORCHESTRATOR_PORT || 4000;
const BASE = `http://localhost:${PORT}/api/reminders`;
const TZ = process.env.REMINDER_TZ || 'Asia/Kolkata';

function usage() {
  console.log(`Usage:
  node scripts/remind.mjs "<when> <what>" [--channels telegram,macos,whatsapp,apple_reminders]
  node scripts/remind.mjs --list [--status PENDING|FIRED|CANCELLED|FAILED]
  node scripts/remind.mjs --cancel <id>
  node scripts/remind.mjs --fire <id>`);
}

function fmt(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('en-IN', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' });
}

function line(r) {
  const rec = r.recurrence ? ` [cron ${r.recurrence}]` : '';
  return `${r.id}  ${r.status.padEnd(9)}  ${fmt(r.dueAt)}${rec}  ${r.text}  (${(r.channels || []).join(',')})`;
}

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    console.error(`Cannot reach orchestrator at ${BASE} (${err.cause?.code || err.message}). Is it running?`);
    process.exit(1);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`Error ${res.status}: ${data.error || res.statusText}`);
    process.exit(1);
  }
  return data;
}

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  args.splice(i, v && !v.startsWith('--') ? 2 : 1);
  return v && !v.startsWith('--') ? v : true;
};

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  usage();
  process.exit(args.length === 0 ? 1 : 0);
}

const list = flag('--list');
const cancel = flag('--cancel');
const fire = flag('--fire');
const status = flag('--status');
const channels = flag('--channels');

if (list) {
  const qs = typeof status === 'string' ? `?status=${encodeURIComponent(status.toUpperCase())}` : '';
  const { reminders } = await call('GET', qs);
  if (!reminders.length) console.log('No reminders.');
  for (const r of reminders) console.log(line(r));
} else if (typeof cancel === 'string') {
  const { reminder } = await call('DELETE', `/${encodeURIComponent(cancel)}`);
  console.log(`Cancelled: ${line(reminder)}`);
} else if (typeof fire === 'string') {
  const { reminder, results } = await call('POST', `/${encodeURIComponent(fire)}/fire`);
  console.log(`Fired: ${line(reminder)}`);
  for (const r of results || []) console.log(`  ${r.channel}: ${r.ok ? 'ok' : r.error}`);
} else {
  const text = args.join(' ').trim();
  if (!text) {
    usage();
    process.exit(1);
  }
  const body = { text, created_via: 'cli' };
  if (typeof channels === 'string') body.channels = channels.split(',');
  const { reminder } = await call('POST', '', body);
  console.log(`Created: ${line(reminder)}`);
}
