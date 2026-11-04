import type { IncomingMessage, ServerResponse } from 'node:http';
import { drainCommands, enqueueCommand, getResult, storeResults } from './commandQueue.js';

interface ClientRouteCtx {
  pathname: string;
  method: string;
  requestUserId: string | null;
  readJsonBody: () => Promise<Record<string, any>>;
  sendJson: (res: ServerResponse, status: number, body: unknown) => void;
}

/**
 * Handles /api/client routes for connected `warden-link` agents.
 * Returns true when the request was handled. Registered after the auth gate,
 * so requestUserId is always set here.
 *
 *  POST /api/client/enqueue  { command } -> { ok, id }      operator queues work
 *  POST /api/client/poll     { client }  -> { ok, commands } agent picks up work
 *  POST /api/client/result   { results } -> { ok, stored }   agent reports back
 *  GET  /api/client/result?id=...        -> { ok, result }   operator checks outcome
 */
export async function handleClientRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ClientRouteCtx
): Promise<boolean> {
  const { pathname, method, requestUserId } = ctx;
  if (!pathname.startsWith('/api/client/')) return false;

  if (!requestUserId) {
    ctx.sendJson(res, 401, { ok: false, error: 'Not signed in' });
    return true;
  }

  if (pathname === '/api/client/enqueue' && method === 'POST') {
    const body: Record<string, any> = await ctx.readJsonBody().catch(() => ({}));
    const input = (body?.command ?? {}) as Record<string, unknown>;
    const queued = enqueueCommand(requestUserId, input);
    if (!queued.ok) {
      const full = queued.error.includes('queue is full');
      ctx.sendJson(res, full ? 429 : 400, { ok: false, error: queued.error });
      return true;
    }
    ctx.sendJson(res, 200, { ok: true, id: queued.command.id });
    return true;
  }

  if (pathname === '/api/client/poll' && method === 'POST') {
    await ctx.readJsonBody().catch(() => ({}));
    ctx.sendJson(res, 200, { ok: true, commands: drainCommands(requestUserId) });
    return true;
  }

  if (pathname === '/api/client/result' && method === 'POST') {
    const body: Record<string, any> = await ctx.readJsonBody().catch(() => ({}));
    const incoming = Array.isArray(body?.results) ? body.results : [];
    const stored = storeResults(requestUserId, incoming);
    ctx.sendJson(res, 200, { ok: true, stored });
    return true;
  }

  if (pathname === '/api/client/result' && method === 'GET') {
    const id = new URL(req.url || '/', 'http://localhost').searchParams.get('id') || '';
    const result = id ? getResult(requestUserId, id) : null;
    if (!result) {
      ctx.sendJson(res, 404, { ok: false, error: 'result not found (yet?)' });
      return true;
    }
    ctx.sendJson(res, 200, { ok: true, result });
    return true;
  }

  return false;
}
