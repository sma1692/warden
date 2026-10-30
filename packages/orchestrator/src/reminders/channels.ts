import { execFile } from 'node:child_process';
import { TelegramPushPager } from '../telegram/TelegramPushPager.js';
import type { ReminderChannel, ReminderRecord } from './ReminderService.js';
import { REMINDER_CHANNELS } from './ReminderService.js';

export interface ChannelResult {
  channel: ReminderChannel;
  ok: boolean;
  error?: string;
}

export interface ReminderChannelOptions {
  /** Share the server's pager so reminder pushes show up in the Dashboard Telegram feed. */
  telegramPager?: TelegramPushPager;
  /** Per-channel timeout in ms (default 20s). */
  timeoutMs?: number;
}

interface WhatsAppModule {
  isWhatsAppConfigured?: () => boolean;
  sendWhatsAppText?: (to: string | undefined, text: string) => Promise<{ ok: boolean; error?: string }>;
}

let whatsAppModulePromise: Promise<WhatsAppModule | null> | null = null;

/**
 * Lazily loads the WhatsApp bridge. Returns null when the module is missing or fails to load.
 */
async function loadWhatsApp(): Promise<WhatsAppModule | null> {
  if (!whatsAppModulePromise) {
    whatsAppModulePromise = (async () => {
      try {
        const spec = '../bridge/whatsapp/WhatsAppClient.js';
        return (await import(/* @vite-ignore */ spec)) as WhatsAppModule;
      } catch {
        return null;
      }
    })();
  }
  return whatsAppModulePromise;
}

export async function isWhatsAppAvailable(): Promise<boolean> {
  const mod = await loadWhatsApp();
  try {
    return Boolean(mod?.isWhatsAppConfigured?.());
  } catch {
    return false;
  }
}

/**
 * Default channels: env REMINDER_DEFAULT_CHANNELS (comma list), else telegram + macos (+ whatsapp when configured).
 */
export async function resolveDefaultChannels(): Promise<ReminderChannel[]> {
  const envList = (process.env.REMINDER_DEFAULT_CHANNELS || '')
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter((c): c is ReminderChannel => REMINDER_CHANNELS.includes(c as ReminderChannel));
  if (envList.length > 0) return [...new Set(envList)];

  const channels: ReminderChannel[] = ['telegram', 'macos'];
  if (await isWhatsAppAvailable()) channels.unshift('whatsapp');
  return channels;
}

export function formatReminderMessage(reminder: Pick<ReminderRecord, 'text' | 'recurrence'>): string {
  const suffix = reminder.recurrence ? `\n(repeats: ${reminder.recurrence})` : '';
  return `⏰ Reminder: ${reminder.text}${suffix}`;
}

function runOsascript(args: string[], timeoutMs: number): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    if (process.platform !== 'darwin') {
      resolve({ ok: false, error: 'osascript is only available on macOS' });
      return;
    }
    execFile('osascript', args, { timeout: timeoutMs }, (err, _stdout, stderr) => {
      if (err) {
        const detail = (stderr || err.message || '').toString().trim();
        resolve({ ok: false, error: `osascript failed: ${detail.slice(0, 240)}` });
      } else {
        resolve({ ok: true });
      }
    });
  });
}

async function sendTelegram(
  reminder: ReminderRecord,
  options: ReminderChannelOptions
): Promise<{ ok: boolean; error?: string }> {
  const pager = options.telegramPager ?? new TelegramPushPager();
  const record = await pager.sendAlert({
    type: 'QUESTION',
    agentSlug: '@warden',
    projectScope: 'Reminders',
    headline: formatReminderMessage(reminder),
  });
  return record.deliveredViaApi ? { ok: true } : { ok: false, error: record.error ?? 'Telegram not delivered' };
}

async function sendMacNotification(
  reminder: ReminderRecord,
  timeoutMs: number
): Promise<{ ok: boolean; error?: string }> {
  // Text is passed via argv so no AppleScript string escaping is needed.
  return runOsascript(
    [
      '-e', 'on run argv',
      '-e', 'display notification (item 1 of argv) with title "Commando Reminder" sound name "Glass"',
      '-e', 'end run',
      reminder.recurrence ? `${reminder.text} (repeats)` : reminder.text,
    ],
    timeoutMs
  );
}

async function sendAppleReminder(
  reminder: ReminderRecord,
  timeoutMs: number
): Promise<{ ok: boolean; error?: string }> {
  // Same JXA approach as scripts/apple-sync.mjs: push a Reminder into the default list.
  const jxa = `
function run(argv) {
  const rem = Application('Reminders');
  if (!rem.running()) { rem.launch(); delay(1); }
  const list = rem.defaultList();
  const prop = { name: argv[0] };
  if (argv[1]) prop.dueDate = new Date(argv[1]);
  list.reminders.push(rem.Reminder(prop));
  return 'OK';
}`;
  return runOsascript(['-l', 'JavaScript', '-e', jxa, reminder.text, reminder.dueAt || ''], timeoutMs);
}

async function sendWhatsApp(reminder: ReminderRecord): Promise<{ ok: boolean; error?: string }> {
  const mod = await loadWhatsApp();
  if (!mod?.sendWhatsAppText) return { ok: false, error: 'WhatsApp bridge not available' };
  if (mod.isWhatsAppConfigured && !mod.isWhatsAppConfigured()) {
    return { ok: false, error: 'WhatsApp not configured' };
  }
  return mod.sendWhatsAppText(undefined, formatReminderMessage(reminder));
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/**
 * Sends to a single channel. Never throws.
 */
export async function sendToChannel(
  channel: ReminderChannel,
  reminder: ReminderRecord,
  options: ReminderChannelOptions = {}
): Promise<ChannelResult> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  try {
    let result: { ok: boolean; error?: string };
    switch (channel) {
      case 'telegram':
        result = await withTimeout(sendTelegram(reminder, options), timeoutMs, 'telegram');
        break;
      case 'macos':
        result = await sendMacNotification(reminder, timeoutMs);
        break;
      case 'apple_reminders':
        result = await sendAppleReminder(reminder, timeoutMs);
        break;
      case 'whatsapp':
        result = await withTimeout(sendWhatsApp(reminder), timeoutMs, 'whatsapp');
        break;
      default:
        result = { ok: false, error: `Unknown channel: ${String(channel)}` };
    }
    return result.ok ? { channel, ok: true } : { channel, ok: false, error: result.error ?? 'unknown error' };
  } catch (err) {
    return { channel, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Fans a reminder out to all of its channels in parallel; one failure never blocks the others.
 */
export async function dispatchReminder(
  reminder: ReminderRecord,
  options: ReminderChannelOptions = {}
): Promise<{ results: ChannelResult[]; allFailed: boolean; error: string | null }> {
  const channels = reminder.channels.length > 0 ? reminder.channels : await resolveDefaultChannels();
  const results = await Promise.all(channels.map((c) => sendToChannel(c, reminder, options)));
  const failures = results.filter((r) => !r.ok);
  const error = failures.length > 0 ? failures.map((f) => `${f.channel}: ${f.error}`).join(' | ') : null;
  return {
    results,
    allFailed: results.length === 0 || failures.length === results.length,
    error,
  };
}
