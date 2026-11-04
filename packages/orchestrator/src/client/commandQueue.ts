import { randomUUID } from 'node:crypto';

/**
 * In-memory per-user command queue for connected `warden-link` agents.
 * At-most-once delivery: commands are dequeued when polled. Results are kept
 * for operator inspection until the process restarts.
 */

export type QueuedCommand =
  | { id: string; kind: 'read_file'; path: string; enqueuedAt: string }
  | { id: string; kind: 'write_file'; path: string; content: string; enqueuedAt: string }
  | {
      id: string;
      kind: 'pushit';
      summary: string;
      bullets?: string[];
      targetBranch?: string;
      skipPush?: boolean;
      enqueuedAt: string;
    };

export interface StoredResult {
  id: string;
  userId: string;
  ok: boolean;
  output?: string;
  error?: string;
  at: string;
}

const MAX_QUEUE = 100;
const MAX_RESULTS = 500;
const MAX_CONTENT_BYTES = 1024 * 1024;

const queues = new Map<string, QueuedCommand[]>();
const results = new Map<string, StoredResult>();

function isRelativePath(p: unknown): p is string {
  if (typeof p !== 'string' || !p.trim()) return false;
  if (p.startsWith('/')) return false;
  const parts = p.replace(/\\/g, '/').split('/');
  return !parts.includes('..');
}

export function validateCommandInput(
  input: Record<string, unknown>
): { ok: true; command: QueuedCommand } | { ok: false; error: string } {
  const kind = input?.kind;
  const id = randomUUID();
  const enqueuedAt = new Date().toISOString();
  if (kind === 'read_file') {
    if (!isRelativePath(input.path)) return { ok: false, error: 'read_file needs a relative path' };
    return { ok: true, command: { id, kind, path: input.path, enqueuedAt } };
  }
  if (kind === 'write_file') {
    if (!isRelativePath(input.path)) return { ok: false, error: 'write_file needs a relative path' };
    if (typeof input.content !== 'string') {
      return { ok: false, error: 'write_file needs a string content' };
    }
    if (Buffer.byteLength(input.content, 'utf8') > MAX_CONTENT_BYTES) {
      return { ok: false, error: 'content exceeds 1MB cap' };
    }
    return { ok: true, command: { id, kind, path: input.path, content: input.content, enqueuedAt } };
  }
  if (kind === 'pushit') {
    if (typeof input.summary !== 'string' || !input.summary.trim()) {
      return { ok: false, error: 'pushit needs a summary' };
    }
    const command: Extract<QueuedCommand, { kind: 'pushit' }> = {
      id,
      kind: 'pushit',
      summary: input.summary.trim(),
      enqueuedAt,
    };
    if (Array.isArray(input.bullets)) {
      command.bullets = input.bullets
        .filter((b): b is string => typeof b === 'string')
        .slice(0, 20);
    }
    if (typeof input.targetBranch === 'string' && input.targetBranch.trim()) {
      command.targetBranch = input.targetBranch.trim().slice(0, 128);
    }
    if (input.skipPush === true) command.skipPush = true;
    return { ok: true, command };
  }
  return { ok: false, error: `unknown command kind: ${String(kind)}` };
}

export function enqueueCommand(
  userId: string,
  input: Record<string, unknown>
): { ok: true; command: QueuedCommand } | { ok: false; error: string } {
  const queue = queues.get(userId) ?? [];
  if (queue.length >= MAX_QUEUE) {
    return { ok: false, error: 'command queue is full (100); wait for the client to drain it' };
  }
  const validated = validateCommandInput(input);
  if (!validated.ok) return validated;
  queue.push(validated.command);
  queues.set(userId, queue);
  return { ok: true, command: validated.command };
}

/** Removes and returns every pending command for the user. */
export function drainCommands(userId: string): QueuedCommand[] {
  const pending = queues.get(userId) ?? [];
  queues.set(userId, []);
  return pending;
}

export function storeResults(
  userId: string,
  incoming: Array<{ id?: unknown; ok?: unknown; output?: unknown; error?: unknown }>
): number {
  let stored = 0;
  for (const r of incoming) {
    if (typeof r.id !== 'string' || !r.id) continue;
    results.set(`${userId}:${r.id}`, {
      id: r.id,
      userId,
      ok: r.ok === true,
      output: typeof r.output === 'string' ? r.output.slice(0, 64 * 1024) : undefined,
      error: typeof r.error === 'string' ? r.error.slice(0, 4096) : undefined,
      at: new Date().toISOString(),
    });
    stored++;
  }
  while (results.size > MAX_RESULTS) {
    const oldest = results.keys().next();
    if (oldest.done) break;
    results.delete(oldest.value);
  }
  return stored;
}

export function getResult(userId: string, id: string): StoredResult | null {
  return results.get(`${userId}:${id}`) ?? null;
}
