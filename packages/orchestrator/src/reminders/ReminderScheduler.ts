import { dispatchReminder, type ChannelResult, type ReminderChannelOptions } from './channels.js';
import {
  claimDueReminders,
  claimReminderForManualFire,
  finalizeReminderFire,
  type ReminderRecord,
} from './ReminderService.js';

export interface ReminderFireEvent {
  reminder: ReminderRecord;
  results: ChannelResult[];
  updated: ReminderRecord | null;
}

export interface ReminderSchedulerOptions extends ReminderChannelOptions {
  /** Poll interval in ms (default 30s, env REMINDER_POLL_MS). */
  intervalMs?: number;
  /** Max reminders claimed per tick (default 25). */
  batchSize?: number;
  /** Called after each fire, e.g. to broadcast `reminder:fired` over WebSocket. */
  onFired?: (event: ReminderFireEvent) => void;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

export interface ReminderSchedulerHandle {
  stop(): void;
  /** Runs one poll immediately (also used by tests). */
  tick(): Promise<number>;
}

/**
 * Fires one already-claimed reminder and persists the outcome. Never throws.
 */
export async function fireClaimedReminder(
  reminder: ReminderRecord,
  options: ReminderSchedulerOptions = {},
  finalizeOptions?: { keepSchedule?: boolean }
): Promise<ReminderFireEvent> {
  let results: ChannelResult[] = [];
  let updated: ReminderRecord | null = null;
  try {
    const outcome = await dispatchReminder(reminder, options);
    results = outcome.results;
    updated = await finalizeReminderFire(reminder, outcome, finalizeOptions);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    options.logger?.error?.(`[reminders] fire ${reminder.id} failed: ${msg}`);
    try {
      updated = await finalizeReminderFire(reminder, { allFailed: true, error: msg });
    } catch {
      // DB unreachable; the row stays FIRED and will need manual attention
    }
  }
  const event: ReminderFireEvent = { reminder, results, updated };
  try {
    options.onFired?.(event);
  } catch {
    // Listener errors must never break the scheduler
  }
  return event;
}

/**
 * Fires a reminder immediately regardless of due time (POST /api/reminders/:id/fire).
 * Recurring reminders keep their schedule.
 */
export async function fireReminderNow(
  id: string,
  options: ReminderSchedulerOptions = {}
): Promise<ReminderFireEvent | null> {
  const claimed = await claimReminderForManualFire(id);
  if (!claimed) return null;
  return fireClaimedReminder(claimed, options, { keepSchedule: true });
}

/**
 * Starts the reminder poller. Polls every 30s, atomically claims due PENDING reminders
 * (safe across multiple processes), fans out to channels, and reschedules recurring ones.
 */
export function startReminderScheduler(options: ReminderSchedulerOptions = {}): ReminderSchedulerHandle {
  const envInterval = Number(process.env.REMINDER_POLL_MS);
  const intervalMs = options.intervalMs ?? (Number.isFinite(envInterval) && envInterval >= 1000 ? envInterval : 30_000);
  const batchSize = options.batchSize ?? 25;
  const logger = options.logger ?? console;
  let running = false;
  let stopped = false;
  let lastErrorLogged = '';

  const tick = async (): Promise<number> => {
    if (running || stopped) return 0;
    running = true;
    let fired = 0;
    try {
      const due = await claimDueReminders(batchSize);
      lastErrorLogged = '';
      for (const reminder of due) {
        const event = await fireClaimedReminder(reminder, { ...options, logger });
        fired += 1;
        const failed = event.results.filter((r) => !r.ok).map((r) => r.channel);
        logger.log(
          `[reminders] fired ${reminder.id} "${reminder.text.slice(0, 60)}" -> ${event.updated?.status ?? '?'}` +
            (failed.length ? ` (failed: ${failed.join(', ')})` : '')
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== lastErrorLogged) {
        logger.warn(`[reminders] poll skipped: ${msg}`);
        lastErrorLogged = msg;
      }
    } finally {
      running = false;
    }
    return fired;
  };

  const safeTick = () => {
    tick().catch(() => {
      /* tick already handles errors */
    });
  };

  const timer = setInterval(safeTick, intervalMs);
  timer.unref?.();
  const firstRun = setTimeout(safeTick, 2_000);
  firstRun.unref?.();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
      clearTimeout(firstRun);
    },
    tick,
  };
}
