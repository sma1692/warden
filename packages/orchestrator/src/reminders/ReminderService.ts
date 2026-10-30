import { randomUUID } from 'node:crypto';
import * as chrono from 'chrono-node';
import { CronExpressionParser } from 'cron-parser';

export type ReminderChannel = 'whatsapp' | 'telegram' | 'macos' | 'apple_reminders';
export type ReminderStatus = 'PENDING' | 'FIRED' | 'CANCELLED' | 'FAILED';
export type ReminderCreatedVia = 'api' | 'chat' | 'whatsapp' | 'cli';

export const REMINDER_CHANNELS: ReminderChannel[] = ['whatsapp', 'telegram', 'macos', 'apple_reminders'];
export const REMINDER_STATUSES: ReminderStatus[] = ['PENDING', 'FIRED', 'CANCELLED', 'FAILED'];
const CREATED_VIA: ReminderCreatedVia[] = ['api', 'chat', 'whatsapp', 'cli'];

export interface ReminderRecord {
  id: string;
  text: string;
  dueAt: string;
  recurrence: string | null;
  timezone: string;
  channels: ReminderChannel[];
  status: ReminderStatus;
  lastFiredAt: string | null;
  fireCount: number;
  lastError: string | null;
  createdVia: ReminderCreatedVia;
  createdAt: string;
  updatedAt: string;
}

export interface ParsedReminder {
  text: string;
  dueAt: Date;
  recurrence: string | null;
}

export interface CreateReminderInput {
  text: string;
  dueAt?: Date | string | null;
  recurrence?: string | null;
  timezone?: string | null;
  channels?: ReminderChannel[] | null;
  createdVia?: ReminderCreatedVia;
}

export interface UpdateReminderInput {
  text?: string;
  dueAt?: Date | string;
  recurrence?: string | null;
  timezone?: string;
  channels?: ReminderChannel[];
  status?: ReminderStatus;
}

interface PgPoolLike {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

/**
 * Default reminder timezone: env REMINDER_TZ, else IST (Asia/Kolkata).
 */
export function getReminderTimezone(): string {
  const tz = (process.env.REMINDER_TZ || '').trim();
  if (tz && isValidTimezone(tz)) return tz;
  return 'Asia/Kolkata';
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------------------
// Timezone helpers (no extra dependency)
// ----------------------------------------------------------------------------

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

function getZonedParts(date: Date, tz: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hourCycle: 'h23',
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: Math.max(0, weekdays.indexOf(parts.weekday ?? 'Sun')),
  };
}

/** Offset of `tz` from UTC in minutes at `date` (IST => +330). */
function getTimezoneOffsetMinutes(date: Date, tz: string): number {
  const p = getZonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const truncated = Math.floor(date.getTime() / 60000) * 60000;
  return Math.round((asUtc - truncated) / 60000);
}

/** Converts a wall-clock time in `tz` to a UTC Date. */
function zonedWallTimeToDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let offset = getTimezoneOffsetMinutes(new Date(guess), tz);
  let result = guess - offset * 60000;
  const offset2 = getTimezoneOffsetMinutes(new Date(result), tz);
  if (offset2 !== offset) {
    offset = offset2;
    result = guess - offset * 60000;
  }
  return new Date(result);
}

// ----------------------------------------------------------------------------
// Cron helpers
// ----------------------------------------------------------------------------

/**
 * Returns the next fire time strictly after `after` for a cron expression in `tz`.
 * Throws on an invalid expression.
 */
export function computeNextRun(recurrence: string, after: Date = new Date(), tz = getReminderTimezone()): Date {
  const interval = CronExpressionParser.parse(recurrence, { currentDate: after, tz });
  return interval.next().toDate();
}

export function isValidCron(recurrence: string): boolean {
  try {
    CronExpressionParser.parse(recurrence);
    return true;
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------------------
// Natural language parsing
// ----------------------------------------------------------------------------

const DAY_TOKENS: Record<string, number> = {
  sun: 0, sunday: 0, sundays: 0,
  mon: 1, monday: 1, mondays: 1,
  tue: 2, tues: 2, tuesday: 2, tuesdays: 2,
  wed: 3, weds: 3, wednesday: 3, wednesdays: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, thursdays: 4,
  fri: 5, friday: 5, fridays: 5,
  sat: 6, saturday: 6, saturdays: 6,
};

const DAY_WORD = '(?:sun|mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?)(?:day)?s?';
const LEAD_IN_RE =
  /^\s*(?:\/remind(?:er)?\b|hey\s+\w+[,\s]+)?\s*(?:please\s+)?(?:(?:can|could)\s+you\s+)?(?:remind\s+me\b|set\s+(?:a\s+)?reminder\b|add\s+(?:a\s+)?reminder\b|reminder\s*[:\-]|ping\s+me\b|nudge\s+me\b|alert\s+me\b)?\s*(?:to\s+|that\s+|about\s+|for\s+)?/i;

interface RecurrenceMatch {
  /** Cron fields when time-of-day still needs to be filled in: [dom, month, dow]. */
  dateFields?: [string, string, string];
  /** Fully formed cron (interval-based, no time-of-day). */
  cron?: string;
  defaultHour?: number;
  matched: string;
}

function detectRecurrence(body: string, now: Date, tz: string): RecurrenceMatch | null {
  let m: RegExpMatchArray | null;

  // every N minutes / hours
  m = body.match(/\bevery\s+(\d+|an?|one)?\s*(minutes?|mins?|m|hours?|hrs?|h)\b/i);
  if (m) {
    const raw = (m[1] || '1').toLowerCase();
    const n = /^\d+$/.test(raw) ? Math.max(1, parseInt(raw, 10)) : 1;
    const unit = (m[2] ?? '').toLowerCase();
    if (unit.startsWith('m')) {
      const step = Math.min(n, 59);
      return { cron: step === 1 ? '* * * * *' : `*/${step} * * * *`, matched: m[0] };
    }
    const step = Math.min(n, 23);
    return { cron: step === 1 ? '0 * * * *' : `0 */${step} * * *`, matched: m[0] };
  }
  m = body.match(/\b(hourly)\b/i);
  if (m) return { cron: '0 * * * *', matched: m[0] };

  // every weekday / weekdays
  m = body.match(/\b(?:every|each|on)\s+(?:week\s?days?|working\s+days?|business\s+days?)\b|\bweekdays\b/i);
  if (m) return { dateFields: ['*', '*', '1-5'], matched: m[0] };

  m = body.match(/\b(?:every|each|on)\s+weekends?\b|\bweekends\b/i);
  if (m) return { dateFields: ['*', '*', '0,6'], matched: m[0] };

  // every morning / evening / night
  m = body.match(/\bevery\s+(morning|afternoon|evening|night)\b/i);
  if (m) {
    const part = (m[1] ?? '').toLowerCase();
    const hour = part === 'morning' ? 9 : part === 'afternoon' ? 14 : part === 'evening' ? 18 : 21;
    return { dateFields: ['*', '*', '*'], defaultHour: hour, matched: m[0] };
  }

  // every day / daily / everyday
  m = body.match(/\b(?:every\s*day|each\s+day|daily)\b/i);
  if (m) return { dateFields: ['*', '*', '*'], matched: m[0] };

  // every monday[, wednesday and friday]
  const daysRe = new RegExp(
    `\\b(?:every|each|on)\\s+(${DAY_WORD}(?:\\s*(?:,|and|&|\\+)\\s*${DAY_WORD})*)\\b`,
    'i'
  );
  m = body.match(daysRe);
  if (m && (/^(?:every|each)/i.test(m[0]) || /days\b/i.test(m[1] ?? ''))) {
    const days = new Set<number>();
    for (const tok of (m[1] ?? '').toLowerCase().split(/[\s,&+]+|and/)) {
      const t = tok.trim();
      if (!t) continue;
      const d = DAY_TOKENS[t] ?? DAY_TOKENS[t.replace(/s$/, '')];
      if (d !== undefined) days.add(d);
    }
    if (days.size > 0) {
      return {
        dateFields: ['*', '*', [...days].sort((a, b) => a - b).join(',')],
        matched: m[0],
      };
    }
  }

  // every week / weekly (same weekday as now)
  m = body.match(/\b(?:every\s+week|weekly)\b/i);
  if (m) return { dateFields: ['*', '*', String(getZonedParts(now, tz).weekday)], matched: m[0] };

  // every month / monthly (on the Nth)
  m = body.match(/\b(?:every\s+month|monthly)(?:\s+on\s+the\s+(\d{1,2})(?:st|nd|rd|th)?)?\b/i);
  if (m) {
    const dom = m[1] ? Math.min(31, Math.max(1, parseInt(m[1], 10))) : getZonedParts(now, tz).day;
    return { dateFields: [String(dom), '*', '*'], matched: m[0] };
  }

  return null;
}

function cleanupText(text: string): string {
  return text
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,.;:\-]+|[\s,.;:\-]+$/g, '')
    .replace(/^(?:to|that|about|for|at|on|and)\s+/i, '')
    .replace(/\s+(?:to|at|on|and)$/i, '')
    .trim();
}

function removeOnce(haystack: string, needle: string): string {
  const idx = haystack.indexOf(needle);
  if (idx === -1) return haystack;
  return `${haystack.slice(0, idx)} ${haystack.slice(idx + needle.length)}`;
}

/**
 * Parses natural language like:
 *  - "remind me tomorrow 6pm to call Alex"
 *  - "every weekday at 9am standup prep"
 *  - "in 20 minutes check deploy"
 * into `{ text, dueAt, recurrence }`. Returns null when no time could be found.
 */
export function parseReminderText(
  input: string,
  now: Date = new Date(),
  tz: string = getReminderTimezone()
): ParsedReminder | null {
  const original = (input || '').trim();
  if (!original) return null;

  let body = original.replace(LEAD_IN_RE, ' ').trim();
  const refOptions = { instant: now, timezone: getTimezoneOffsetMinutes(now, tz) };
  const recurrence = detectRecurrence(body, now, tz);

  if (recurrence) {
    body = removeOnce(body, recurrence.matched);
    let cron = recurrence.cron ?? null;

    if (!cron && recurrence.dateFields) {
      let hour = recurrence.defaultHour ?? 9;
      let minute = 0;
      const results = chrono.parse(body, refOptions, { forwardDate: true });
      const timed = results.find((r) => r.start.isCertain('hour'));
      if (timed) {
        hour = timed.start.get('hour') ?? hour;
        minute = timed.start.get('minute') ?? 0;
        body = removeOnce(body, timed.text);
      }
      const [dom, month, dow] = recurrence.dateFields;
      cron = `${minute} ${hour} ${dom} ${month} ${dow}`;
    }

    if (!cron) return null;
    let dueAt: Date;
    try {
      dueAt = computeNextRun(cron, now, tz);
    } catch {
      return null;
    }
    const text = cleanupText(body) || original;
    return { text, dueAt, recurrence: cron };
  }

  const results = chrono.parse(body, refOptions, { forwardDate: true });
  const result = results[0];
  if (!result) return null;

  let dueAt = result.start.date();
  if (!result.start.isCertain('hour')) {
    // Date-only phrases ("tomorrow", "on friday") default to 09:00 local time.
    const p = getZonedParts(dueAt, tz);
    dueAt = zonedWallTimeToDate(p.year, p.month, p.day, 9, 0, tz);
    if (dueAt.getTime() <= now.getTime()) {
      dueAt = new Date(now.getTime() + 60_000);
    }
  }

  const text = cleanupText(removeOnce(body, result.text)) || original;
  return { text, dueAt, recurrence: null };
}

/**
 * Cheap heuristic for chat / WhatsApp glue: does this message ask for a reminder?
 */
export function looksLikeReminderRequest(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  if (/^\/remind(?:er)?\b/i.test(t)) return true;
  if (/\b(?:remind\s+me|set\s+(?:a\s+)?reminder|add\s+(?:a\s+)?reminder|create\s+(?:a\s+)?reminder)\b/i.test(t)) {
    return true;
  }
  if (/^\s*(?:reminder\s*[:\-]|ping\s+me\b|nudge\s+me\b)/i.test(t)) return true;
  return false;
}

// ----------------------------------------------------------------------------
// Persistence
// ----------------------------------------------------------------------------

let poolPromise: Promise<PgPoolLike> | null = null;

async function getPool(): Promise<PgPoolLike> {
  if (!poolPromise) {
    poolPromise = (async () => {
      const modName = '@commando/db';
      const mod: any = await import(/* @vite-ignore */ modName);
      const client = mod.pgClient;
      if (!client) throw new Error('@commando/db pgClient not exported');
      const ok = await client.connect();
      const pool = client.getPool?.();
      if (!ok || !pool) throw new Error('PostgreSQL not reachable (reminders require DATABASE_URL)');
      return pool as PgPoolLike;
    })();
    poolPromise.catch(() => {
      poolPromise = null;
    });
  }
  return poolPromise;
}

/** Inject a pool explicitly (tests or callers that already hold one). */
export function setReminderPool(pool: PgPoolLike): void {
  poolPromise = Promise.resolve(pool);
}

function toIso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function rowToReminder(row: any): ReminderRecord {
  return {
    id: row.id,
    text: row.text,
    dueAt: toIso(row.due_at) ?? '',
    recurrence: row.recurrence ?? null,
    timezone: row.timezone ?? getReminderTimezone(),
    channels: (Array.isArray(row.channels) ? row.channels : []) as ReminderChannel[],
    status: row.status as ReminderStatus,
    lastFiredAt: toIso(row.last_fired_at),
    fireCount: Number(row.fire_count ?? 0),
    lastError: row.last_error ?? null,
    createdVia: (row.created_via ?? 'api') as ReminderCreatedVia,
    createdAt: toIso(row.created_at) ?? '',
    updatedAt: toIso(row.updated_at) ?? '',
  };
}

function toDate(v: Date | string): Date {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) throw new ReminderValidationError(`Invalid due_at: ${String(v)}`);
  return d;
}

export class ReminderValidationError extends Error {}

export function normalizeChannels(channels: unknown): ReminderChannel[] | null {
  if (channels === undefined || channels === null) return null;
  const list = Array.isArray(channels) ? channels : String(channels).split(',');
  const out: ReminderChannel[] = [];
  for (const c of list) {
    const v = String(c).trim().toLowerCase().replace(/[\s-]+/g, '_') as ReminderChannel;
    if (!v) continue;
    if (!REMINDER_CHANNELS.includes(v)) {
      throw new ReminderValidationError(
        `Unknown channel "${String(c)}" (allowed: ${REMINDER_CHANNELS.join(', ')})`
      );
    }
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

export async function createReminder(input: CreateReminderInput): Promise<ReminderRecord> {
  const text = (input.text || '').trim();
  if (!text) throw new ReminderValidationError('text is required');
  const timezone = input.timezone && isValidTimezone(input.timezone) ? input.timezone : getReminderTimezone();
  const recurrence = input.recurrence ? input.recurrence.trim() : null;
  if (recurrence && !isValidCron(recurrence)) {
    throw new ReminderValidationError(`Invalid cron expression: ${recurrence}`);
  }

  let dueAt: Date;
  if (input.dueAt) {
    dueAt = toDate(input.dueAt);
  } else if (recurrence) {
    dueAt = computeNextRun(recurrence, new Date(), timezone);
  } else {
    throw new ReminderValidationError('due_at or recurrence is required');
  }

  const { resolveDefaultChannels } = await import('./channels.js');
  const channels = normalizeChannels(input.channels) ?? (await resolveDefaultChannels());
  const createdVia = CREATED_VIA.includes(input.createdVia as ReminderCreatedVia)
    ? (input.createdVia as ReminderCreatedVia)
    : 'api';

  const pool = await getPool();
  const id = `rem_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const { rows } = await pool.query(
    `INSERT INTO reminders (id, text, due_at, recurrence, timezone, channels, status, created_via)
     VALUES ($1, $2, $3, $4, $5, $6::text[], 'PENDING', $7)
     RETURNING *`,
    [id, text, dueAt.toISOString(), recurrence, timezone, channels, createdVia]
  );
  return rowToReminder(rows[0]);
}

/**
 * Parses natural language and creates the reminder. Throws ReminderValidationError when unparseable.
 */
export async function createReminderFromText(
  text: string,
  options?: { channels?: ReminderChannel[] | null; createdVia?: ReminderCreatedVia; now?: Date }
): Promise<ReminderRecord> {
  const tz = getReminderTimezone();
  const parsed = parseReminderText(text, options?.now ?? new Date(), tz);
  if (!parsed) {
    throw new ReminderValidationError(
      `Could not find a time in "${text}". Try "tomorrow 6pm call Alex" or "every weekday at 9am standup prep".`
    );
  }
  return createReminder({
    text: parsed.text,
    dueAt: parsed.dueAt,
    recurrence: parsed.recurrence,
    timezone: tz,
    channels: options?.channels ?? null,
    createdVia: options?.createdVia,
  });
}

export async function listReminders(filter?: {
  status?: ReminderStatus | null;
  limit?: number;
}): Promise<ReminderRecord[]> {
  const pool = await getPool();
  const limit = Math.min(Math.max(filter?.limit ?? 200, 1), 1000);
  if (filter?.status) {
    const { rows } = await pool.query(
      `SELECT * FROM reminders WHERE status = $1 ORDER BY due_at ASC LIMIT $2`,
      [filter.status, limit]
    );
    return rows.map(rowToReminder);
  }
  const { rows } = await pool.query(
    `SELECT * FROM reminders
     ORDER BY (status = 'PENDING') DESC, due_at ASC
     LIMIT $1`,
    [limit]
  );
  return rows.map(rowToReminder);
}

export async function getReminder(id: string): Promise<ReminderRecord | null> {
  const pool = await getPool();
  const { rows } = await pool.query(`SELECT * FROM reminders WHERE id = $1`, [id]);
  return rows[0] ? rowToReminder(rows[0]) : null;
}

export async function updateReminder(id: string, patch: UpdateReminderInput): Promise<ReminderRecord | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const push = (sql: string, value: unknown) => {
    values.push(value);
    sets.push(sql.replace('?', `$${values.length}`));
  };

  if (patch.text !== undefined) {
    const t = patch.text.trim();
    if (!t) throw new ReminderValidationError('text cannot be empty');
    push('text = ?', t);
  }
  if (patch.timezone !== undefined) {
    if (!isValidTimezone(patch.timezone)) throw new ReminderValidationError(`Invalid timezone: ${patch.timezone}`);
    push('timezone = ?', patch.timezone);
  }
  if (patch.recurrence !== undefined) {
    const r = patch.recurrence ? patch.recurrence.trim() : null;
    if (r && !isValidCron(r)) throw new ReminderValidationError(`Invalid cron expression: ${r}`);
    push('recurrence = ?', r);
    if (r && patch.dueAt === undefined) {
      push('due_at = ?', computeNextRun(r, new Date(), patch.timezone ?? getReminderTimezone()).toISOString());
    }
  }
  if (patch.dueAt !== undefined) push('due_at = ?', toDate(patch.dueAt).toISOString());
  if (patch.channels !== undefined) {
    push('channels = ?::text[]', normalizeChannels(patch.channels) ?? []);
  }
  if (patch.status !== undefined) {
    if (!REMINDER_STATUSES.includes(patch.status)) {
      throw new ReminderValidationError(`Invalid status: ${String(patch.status)}`);
    }
    push('status = ?', patch.status);
    if (patch.status === 'PENDING') sets.push('last_error = NULL');
  }

  if (sets.length === 0) return getReminder(id);
  sets.push('updated_at = NOW()');
  values.push(id);
  const pool = await getPool();
  const { rows } = await pool.query(
    `UPDATE reminders SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`,
    values
  );
  return rows[0] ? rowToReminder(rows[0]) : null;
}

export async function cancelReminder(id: string): Promise<ReminderRecord | null> {
  const pool = await getPool();
  const { rows } = await pool.query(
    `UPDATE reminders SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id]
  );
  return rows[0] ? rowToReminder(rows[0]) : null;
}

/** Hard delete (used by tests / cleanup only; the API cancels instead). */
export async function purgeReminder(id: string): Promise<boolean> {
  const pool = await getPool();
  const { rowCount } = await pool.query(`DELETE FROM reminders WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

/**
 * Atomically claims due PENDING reminders. `FOR UPDATE SKIP LOCKED` + the status flip to
 * FIRED guarantee two scheduler processes never fire the same reminder twice.
 */
export async function claimDueReminders(limit = 25): Promise<ReminderRecord[]> {
  const pool = await getPool();
  const { rows } = await pool.query(
    `UPDATE reminders r
        SET status = 'FIRED', last_fired_at = NOW(), fire_count = r.fire_count + 1, updated_at = NOW()
       FROM (
         SELECT id FROM reminders
          WHERE status = 'PENDING' AND due_at <= NOW()
          ORDER BY due_at ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
       ) due
      WHERE r.id = due.id
      RETURNING r.*`,
    [limit]
  );
  return rows.map(rowToReminder);
}

/**
 * Records the outcome of a fire. Recurring reminders get their next due_at and stay PENDING;
 * one-shots become FIRED; total channel failure marks FAILED.
 */
export async function finalizeReminderFire(
  reminder: ReminderRecord,
  outcome: { allFailed: boolean; error: string | null },
  options?: { keepSchedule?: boolean }
): Promise<ReminderRecord | null> {
  const pool = await getPool();

  if (outcome.allFailed) {
    const { rows } = await pool.query(
      `UPDATE reminders SET status = 'FAILED', last_error = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [reminder.id, outcome.error ?? 'All channels failed']
    );
    return rows[0] ? rowToReminder(rows[0]) : null;
  }

  if (reminder.recurrence) {
    if (options?.keepSchedule) {
      const { rows } = await pool.query(
        `UPDATE reminders SET status = 'PENDING', last_error = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [reminder.id, outcome.error]
      );
      return rows[0] ? rowToReminder(rows[0]) : null;
    }
    try {
      const base = new Date(Math.max(Date.now(), new Date(reminder.dueAt).getTime()));
      const next = computeNextRun(reminder.recurrence, base, reminder.timezone || getReminderTimezone());
      const { rows } = await pool.query(
        `UPDATE reminders SET status = 'PENDING', due_at = $2, last_error = $3, updated_at = NOW()
          WHERE id = $1 RETURNING *`,
        [reminder.id, next.toISOString(), outcome.error]
      );
      return rows[0] ? rowToReminder(rows[0]) : null;
    } catch (err) {
      const msg = `Invalid recurrence: ${err instanceof Error ? err.message : String(err)}`;
      const { rows } = await pool.query(
        `UPDATE reminders SET status = 'FAILED', last_error = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [reminder.id, msg]
      );
      return rows[0] ? rowToReminder(rows[0]) : null;
    }
  }

  const { rows } = await pool.query(
    `UPDATE reminders SET status = 'FIRED', last_error = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [reminder.id, outcome.error]
  );
  return rows[0] ? rowToReminder(rows[0]) : null;
}

/**
 * Marks a reminder (any non-cancelled status) as being fired right now, for manual/test firing.
 */
export async function claimReminderForManualFire(id: string): Promise<ReminderRecord | null> {
  const pool = await getPool();
  const { rows } = await pool.query(
    `UPDATE reminders
        SET last_fired_at = NOW(), fire_count = fire_count + 1, updated_at = NOW()
      WHERE id = $1 AND status <> 'CANCELLED'
      RETURNING *`,
    [id]
  );
  return rows[0] ? rowToReminder(rows[0]) : null;
}
