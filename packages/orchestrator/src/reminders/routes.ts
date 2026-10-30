import type { IncomingMessage, ServerResponse } from 'node:http';
import { fireReminderNow, type ReminderSchedulerOptions } from './ReminderScheduler.js';
import {
  REMINDER_STATUSES,
  ReminderValidationError,
  cancelReminder,
  createReminder,
  createReminderFromText,
  getReminder,
  listReminders,
  normalizeChannels,
  updateReminder,
  type ReminderCreatedVia,
  type ReminderStatus,
  type UpdateReminderInput,
} from './ReminderService.js';

export interface ReminderRouteContext {
  pathname: string;
  method: string;
  readJsonBody: () => Promise<any>;
  sendJson: (res: ServerResponse, status: number, body: unknown) => void;
  /** Optional channel/broadcast options used by POST /api/reminders/:id/fire. */
  fireOptions?: ReminderSchedulerOptions;
}

function errorStatus(err: unknown): number {
  if (err instanceof ReminderValidationError) return 400;
  const msg = err instanceof Error ? err.message : String(err);
  if (/not reachable|ECONNREFUSED|pgClient/i.test(msg)) return 503;
  return 500;
}

/**
 * Handles /api/reminders routes. Returns true when the request was handled.
 *
 *  GET    /api/reminders[?status=PENDING]
 *  POST   /api/reminders            { text } (natural language) or { text, due_at, recurrence, channels }
 *  GET    /api/reminders/:id
 *  PATCH  /api/reminders/:id        { text?, due_at?, recurrence?, channels?, status?, timezone? }
 *  DELETE /api/reminders/:id        (sets CANCELLED)
 *  POST   /api/reminders/:id/fire   (fire now, for testing)
 */
export async function handleReminderRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ReminderRouteContext
): Promise<boolean> {
  const { pathname, sendJson } = ctx;
  if (pathname !== '/api/reminders' && !pathname.startsWith('/api/reminders/')) return false;
  const method = (ctx.method || 'GET').toUpperCase();
  const segments = pathname.replace(/\/+$/, '').split('/').slice(3).map(decodeURIComponent);
  const [id, action] = segments;

  try {
    if (!id) {
      if (method === 'GET') {
        const url = new URL(req.url || pathname, 'http://localhost');
        const statusParam = (url.searchParams.get('status') || '').toUpperCase();
        if (statusParam && !REMINDER_STATUSES.includes(statusParam as ReminderStatus)) {
          sendJson(res, 400, { error: `Invalid status: ${statusParam}` });
          return true;
        }
        const limit = Number(url.searchParams.get('limit')) || undefined;
        const reminders = await listReminders({
          status: (statusParam || null) as ReminderStatus | null,
          limit,
        });
        sendJson(res, 200, { reminders, count: reminders.length });
        return true;
      }

      if (method === 'POST') {
        const body = (await ctx.readJsonBody()) || {};
        const text = typeof body.text === 'string' ? body.text : '';
        const createdVia = (body.created_via ?? body.createdVia ?? 'api') as ReminderCreatedVia;
        const channels = normalizeChannels(body.channels);
        const dueAt = body.due_at ?? body.dueAt ?? null;
        const recurrence = body.recurrence ?? null;

        const reminder =
          dueAt || recurrence
            ? await createReminder({
                text,
                dueAt,
                recurrence,
                timezone: body.timezone ?? null,
                channels,
                createdVia,
              })
            : await createReminderFromText(text, { channels, createdVia });
        sendJson(res, 201, { reminder });
        return true;
      }

      sendJson(res, 405, { error: `Method ${method} not allowed on /api/reminders` });
      return true;
    }

    if (action === 'fire') {
      if (method !== 'POST') {
        sendJson(res, 405, { error: 'Use POST to fire a reminder' });
        return true;
      }
      const event = await fireReminderNow(id, ctx.fireOptions);
      if (!event) {
        sendJson(res, 404, { error: `Reminder ${id} not found or cancelled` });
        return true;
      }
      sendJson(res, 200, { reminder: event.updated ?? event.reminder, results: event.results });
      return true;
    }

    if (action) {
      sendJson(res, 404, { error: `Unknown reminders route: ${pathname}` });
      return true;
    }

    if (method === 'GET') {
      const reminder = await getReminder(id);
      if (!reminder) sendJson(res, 404, { error: `Reminder ${id} not found` });
      else sendJson(res, 200, { reminder });
      return true;
    }

    if (method === 'PATCH') {
      const body = (await ctx.readJsonBody()) || {};
      const patch: UpdateReminderInput = {};
      if (body.text !== undefined) patch.text = String(body.text);
      if (body.due_at !== undefined || body.dueAt !== undefined) patch.dueAt = body.due_at ?? body.dueAt;
      if (body.recurrence !== undefined) patch.recurrence = body.recurrence;
      if (body.timezone !== undefined) patch.timezone = String(body.timezone);
      if (body.channels !== undefined) patch.channels = normalizeChannels(body.channels) ?? [];
      if (body.status !== undefined) patch.status = String(body.status).toUpperCase() as ReminderStatus;
      const reminder = await updateReminder(id, patch);
      if (!reminder) sendJson(res, 404, { error: `Reminder ${id} not found` });
      else sendJson(res, 200, { reminder });
      return true;
    }

    if (method === 'DELETE') {
      const reminder = await cancelReminder(id);
      if (!reminder) sendJson(res, 404, { error: `Reminder ${id} not found` });
      else sendJson(res, 200, { reminder });
      return true;
    }

    sendJson(res, 405, { error: `Method ${method} not allowed on /api/reminders/:id` });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendJson(res, errorStatus(err), { error: msg });
    return true;
  }
}
