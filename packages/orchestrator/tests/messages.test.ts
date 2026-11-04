import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeMessagesById } from '../src/engine/OrchestratorStore.js';
import { newTestStore } from './helpers.js';

describe('chat message ids', () => {
  it('assigns unique full-length ids', () => {
    const store = newTestStore();
    const thread = store.createThread({
      title: 'id smoke',
      mode: 'WARDEN_EXECUTIVE',
      target_agent_id: 'warden',
    });

    const ids = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const msg = store.addChatMessage({
        thread_id: thread.id,
        sender_type: 'CEO',
        content: `hello ${i}`,
      });
      assert.ok(msg.id.startsWith('msg_'));
      assert.equal(msg.id.length, 'msg_'.length + 36);
      assert.ok(!ids.has(msg.id));
      ids.add(msg.id);
    }
    assert.equal(store.messagesByThread.get(thread.id)?.length, 200);
  });

  it('dedupeMessagesById drops repeat rows keeping the first', () => {
    const rows = [
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
      { id: 'a', n: 3 },
    ];
    assert.deepEqual(dedupeMessagesById(rows), [
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
    ]);
  });
});
