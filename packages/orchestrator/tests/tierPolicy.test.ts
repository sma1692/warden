import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  agentTier,
  baseAgentId,
  canReadRawSource,
  capUpwardReply,
  isInsideRoot,
  upwardWordCap,
} from '../src/engine/tierPolicy.ts';

test('baseAgentId strips @, project suffix, and case', () => {
  assert.equal(baseAgentId('@PM:demo-game'), 'pm');
  assert.equal(baseAgentId('@tech_lead demo'), 'tech_lead');
  assert.equal(baseAgentId('warden'), 'warden');
});

test('agentTier maps the documented hierarchy', () => {
  assert.equal(agentTier('@warden'), 'ROOT');
  assert.equal(agentTier('cto'), 'L0');
  assert.equal(agentTier('@cbo'), 'L0');
  assert.equal(agentTier('@pm:demo'), 'L1');
  assert.equal(agentTier('tech_lead:demo'), 'L1');
  assert.equal(agentTier('@reader_scout'), 'L2_READ');
  assert.equal(agentTier('@frontend_dev'), 'L2_WRITE');
});

test('upward word caps match AGENTS.md', () => {
  assert.equal(upwardWordCap('@warden'), null);
  assert.equal(upwardWordCap('@cto'), 120);
  assert.equal(upwardWordCap('@pm'), 150);
  assert.equal(upwardWordCap('@reader_scout'), 150);
  assert.equal(upwardWordCap('@backend_dev'), 200);
});

test('capUpwardReply leaves short replies untouched', () => {
  const r = capUpwardReply('done: 2 files changed', '@backend_dev', 'run_1');
  assert.equal(r.truncated, false);
  assert.equal(r.text, 'done: 2 files changed');
});

test('capUpwardReply trims long replies to the tier cap and points at the run', () => {
  const long = Array.from({ length: 500 }, (_, i) => `w${i}`).join(' ');
  const r = capUpwardReply(long, '@cto', 'run_abc');
  assert.equal(r.truncated, true);
  assert.equal(r.originalWords, 500);
  const body = r.text.split('\n\n[')[0];
  assert.equal(body.split(/\s+/).length, 120);
  assert.match(r.text, /run_abc/);
});

test('raw source firewall: only Level 2 reads code, upper tiers read docs', () => {
  assert.equal(canReadRawSource('@warden', 'src/index.ts'), false);
  assert.equal(canReadRawSource('@cto', 'packages/api/server.ts'), false);
  assert.equal(canReadRawSource('@tech_lead:demo', 'src/App.tsx'), false);
  assert.equal(canReadRawSource('@tech_lead:demo', 'README.md'), true);
  assert.equal(canReadRawSource('@pm', 'docs/spec.md'), true);
  assert.equal(canReadRawSource('@reader_scout', 'src/App.tsx'), true);
  assert.equal(canReadRawSource('@frontend_dev', 'src/App.tsx'), true);
});

test('isInsideRoot rejects traversal and sibling-prefix escapes', () => {
  const root = path.resolve('/tmp/ws/repo');
  assert.equal(isInsideRoot(root, 'src/a.ts'), true);
  assert.equal(isInsideRoot(root, ''), true);
  assert.equal(isInsideRoot(root, '../repo-evil/x.ts'), false);
  assert.equal(isInsideRoot(root, '../../etc/passwd'), false);
  assert.equal(isInsideRoot(root, '/etc/passwd'), false);
});
