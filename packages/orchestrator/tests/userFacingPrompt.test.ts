import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUserFacingBlock,
  extractAgentGuide,
  formatOpenItemsForPrompt,
  loadAgentProductGuide,
} from '../src/engine/userFacingPrompt.js';

test('agent guide loads from docs/PRODUCT_GUIDE.md with real screen names', () => {
  const guide = loadAgentProductGuide();
  for (const name of ['Home', 'Team', 'Reports', 'Backlogs', 'Settings', 'NEEDS ACTION', 'Approve & spawn team']) {
    assert.ok(guide.includes(name), `guide should mention ${name}`);
  }
  assert.ok(!/live studio/i.test(guide));
  assert.ok(!guide.includes('agent-guide:start'));
});

test('extractAgentGuide returns null without markers', () => {
  assert.equal(extractAgentGuide('# no markers here'), null);
  assert.equal(extractAgentGuide('<!-- agent-guide:start --><!-- agent-guide:end -->'), null);
});

test('open items use plain words and no copyable headings', () => {
  const text = formatOpenItemsForPrompt(
    [{ id: 'abc-123', title: 'Support case: game crashes after the final move', priority: 'P0', summary: 'Arena crashes\n on match end.' }],
    [{ agent_id: 'cto', prompt_text: 'Ship the fix?' }]
  );
  assert.match(text, /urgent/);
  assert.match(text, /Arena crashes on match end\./);
  assert.ok(!text.includes('NEEDS_CEO'));
  assert.ok(!/LIVE STUDIO|Sign-Off|^#/m.test(text));
  assert.match(text, /task id for tools only: abc-123/);
});

test('empty queue says nothing is waiting', () => {
  assert.match(formatOpenItemsForPrompt([]), /Nothing is waiting on the user/);
});

test('user-facing block includes guide, reply style, and open items', () => {
  const block = buildUserFacingBlock(formatOpenItemsForPrompt([]));
  assert.match(block, /# Product guide/);
  assert.match(block, /# How to reply/);
  assert.match(block, /No headings/);
  assert.match(block, /Nothing is waiting/);
});

import { buildThreadHistory, unansweredNote } from '../src/engine/userFacingPrompt.js';

test('thread history drops the current message and flags unanswered ones', () => {
  const h = buildThreadHistory(
    [
      { sender_type: 'CEO', content: 'hello' },
      { sender_type: 'CEO', content: 'whats happening' },
      { sender_type: 'CEO', content: 'where are the replies' },
    ],
    'where are the replies'
  );
  assert.deepEqual(h.turns.map((t) => t.role), ['user', 'user']);
  assert.deepEqual(h.unansweredUserMessages, ['hello', 'whats happening']);
  const note = unansweredNote(h.unansweredUserMessages);
  assert.match(note, /2 messages/);
  assert.match(note, /"hello"/);
  assert.match(note, /say sorry/);
});

test('answered messages are not flagged, and agent turns become assistant turns', () => {
  const h = buildThreadHistory(
    [
      { sender_type: 'CEO', content: 'hi' },
      { sender_type: 'AGENT', sender_agent_id: 'warden', content: 'Hey! What can I help with?' },
      { sender_type: 'SYSTEM', content: 'ignored' },
      { sender_type: 'CEO', content: 'status?' },
    ],
    'status?'
  );
  assert.deepEqual(h.turns, [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'Hey! What can I help with?' },
  ]);
  assert.deepEqual(h.unansweredUserMessages, []);
  assert.equal(unansweredNote([]), '');
});

test('history is capped to the most recent turns', () => {
  const msgs = Array.from({ length: 30 }, (_, i) => ({
    sender_type: i % 2 === 0 ? 'CEO' : 'AGENT',
    content: `m${i}`,
  }));
  const h = buildThreadHistory(msgs, 'new question', { maxTurns: 6 });
  assert.equal(h.turns.length, 6);
  assert.equal(h.turns[5].content, 'm29');
});
