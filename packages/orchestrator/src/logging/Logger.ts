import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import util from 'node:util';

export interface RequestLogContext {
  reqId: string;
  method?: string;
  path?: string;
  ip?: string;
  userId?: string | null;
}

const requestContextStorage = new AsyncLocalStorage<RequestLogContext>();

export function generateRequestId(incomingHeader?: string | string[]): string {
  const raw = Array.isArray(incomingHeader) ? incomingHeader[0] : incomingHeader;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (/^[a-zA-Z0-9._-]{4,64}$/.test(trimmed)) {
      return trimmed;
    }
  }
  return `req_${crypto.randomBytes(4).toString('hex')}`;
}

export function runWithRequestContext<T>(
  ctx: RequestLogContext,
  fn: () => T
): T {
  return requestContextStorage.run(ctx, fn);
}

export function getRequestContext(): RequestLogContext | undefined {
  return requestContextStorage.getStore();
}

export function getCurrentRequestId(): string | undefined {
  return requestContextStorage.getStore()?.reqId;
}

export function setRequestContextUser(userId: string | null | undefined): void {
  const store = requestContextStorage.getStore();
  if (store && userId) {
    store.userId = userId;
  }
}

function resolveDefaultLogDir(wardenRoot?: string): string {
  if (process.env.WARDEN_LOG_DIR) {
    return path.resolve(process.env.WARDEN_LOG_DIR);
  }
  if (wardenRoot) {
    const resolved = path.resolve(wardenRoot);
    // Guard against workspace cwd (`.../packages/orchestrator`) being passed as wardenRoot
    if (
      path.basename(resolved) === 'orchestrator' &&
      path.basename(path.dirname(resolved)) === 'packages'
    ) {
      return path.resolve(resolved, '../..', 'logs');
    }
    return path.resolve(resolved, 'logs');
  }
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // packages/orchestrator/src/logging -> repo root is 4 levels up
  const repoRoot = path.resolve(__dirname, '../../../..');
  return path.join(repoRoot, 'logs');
}

function formatDateYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

class DailyRotatingLogger {
  private logDir: string;
  private retentionDays: number;
  private currentDay: string = '';
  private installed = false;
  private origLog = console.log.bind(console);
  private origInfo = console.info.bind(console);
  private origWarn = console.warn.bind(console);
  private origError = console.error.bind(console);

  constructor() {
    this.logDir = resolveDefaultLogDir();
    this.retentionDays = Math.max(
      1,
      Number(process.env.WARDEN_LOG_RETENTION_DAYS || 14)
    );
  }

  public configure(options?: { wardenRoot?: string; logDir?: string; retentionDays?: number }): void {
    if (options?.logDir) {
      this.logDir = path.resolve(options.logDir);
    } else if (options?.wardenRoot && !process.env.WARDEN_LOG_DIR) {
      this.logDir = resolveDefaultLogDir(options.wardenRoot);
    }
    if (typeof options?.retentionDays === 'number' && options.retentionDays >= 1) {
      this.retentionDays = options.retentionDays;
    }
    this.ensureLogDir();
  }

  public getLogDir(): string {
    return this.logDir;
  }

  private ensureLogDir(): void {
    try {
      fs.mkdirSync(this.logDir, { recursive: true });
    } catch {
      // ignore if read-only fs
    }
  }

  private rotateIfNeeded(now: Date): string {
    const day = formatDateYmd(now);
    if (day !== this.currentDay) {
      this.currentDay = day;
      this.ensureLogDir();
      this.pruneOldLogs(now);
    }
    return day;
  }

  private pruneOldLogs(now: Date): void {
    try {
      if (!fs.existsSync(this.logDir)) return;
      const cutoffMs = now.getTime() - this.retentionDays * 24 * 60 * 60 * 1000;
      const entries = fs.readdirSync(this.logDir);
      for (const name of entries) {
        const match = name.match(/^warden(?:-(?:error))?-(\d{4}-\d{2}-\d{2})\.log$/);
        if (!match) continue;
        const fileDate = new Date(`${match[1]}T00:00:00Z`);
        if (!Number.isNaN(fileDate.getTime()) && fileDate.getTime() < cutoffMs) {
          fs.unlinkSync(path.join(this.logDir, name));
        }
      }
    } catch {
      // non-fatal cleanup error
    }
  }

  public writeLine(level: 'INFO' | 'WARN' | 'ERROR', args: unknown[]): void {
    const now = new Date();
    const iso = now.toISOString();
    const ctx = requestContextStorage.getStore();
    const reqTag = ctx?.reqId ? `[req:${ctx.reqId}]` : '[sys]';
    const userTag = ctx?.userId
      ? ` [user:${ctx.userId.replace(/-/g, '').slice(0, 8)}]`
      : '';
    const msg = util.format(...args);
    const prefix = `${iso} [${level}] ${reqTag}${userTag}`;
    const formattedLine = `${prefix} ${msg}`;

    if (level === 'ERROR') {
      this.origError(formattedLine);
    } else if (level === 'WARN') {
      this.origWarn(formattedLine);
    } else {
      this.origLog(formattedLine);
    }

    try {
      const day = this.rotateIfNeeded(now);
      const dailyFile = path.join(this.logDir, `warden-${day}.log`);
      const latestFile = path.join(this.logDir, 'warden.log');
      const lineWithNewline = `${formattedLine}\n`;
      fs.appendFileSync(dailyFile, lineWithNewline, 'utf8');
      fs.appendFileSync(latestFile, lineWithNewline, 'utf8');
      if (level === 'WARN' || level === 'ERROR') {
        const errorFile = path.join(this.logDir, `warden-error-${day}.log`);
        fs.appendFileSync(errorFile, lineWithNewline, 'utf8');
      }
    } catch {
      // Never crash request handling if disk write fails
    }
  }

  public install(options?: { wardenRoot?: string }): void {
    this.configure(options);
    if (this.installed) return;
    this.installed = true;

    console.log = (...args: unknown[]) => {
      this.writeLine('INFO', args);
    };
    console.info = (...args: unknown[]) => {
      this.writeLine('INFO', args);
    };
    console.warn = (...args: unknown[]) => {
      this.writeLine('WARN', args);
    };
    console.error = (...args: unknown[]) => {
      this.writeLine('ERROR', args);
    };

    process.on('uncaughtException', (err) => {
      this.writeLine('ERROR', ['[UNCAUGHT EXCEPTION]', err]);
    });
    process.on('unhandledRejection', (reason) => {
      this.writeLine('ERROR', ['[UNHANDLED REJECTION]', reason]);
    });

    const day = formatDateYmd(new Date());
    this.writeLine('INFO', [
      `[WARDEN LOGGER] Day-rotated file logging active -> ${path.join(this.logDir, `warden-${day}.log`)} (alias: ${path.join(this.logDir, 'warden.log')}, retention: ${this.retentionDays}d)`,
    ]);
  }
}

export const dailyLogger = new DailyRotatingLogger();

export function installProcessLogger(options?: { wardenRoot?: string }): void {
  dailyLogger.install(options);
}
