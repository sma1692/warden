/**
 * Email one-time-code sign-in. Mirrors OtpService (pending codes, rate
 * limits) but keyed by normalized email and delivered over SMTP.
 *
 * Without SMTP creds, local dev falls back to logging the code (dev-log);
 * production without SMTP returns 503 instead of pretending.
 */
import crypto from 'node:crypto';
import { isEmailConfigured, sendEmailCode } from './EmailSender.js';
import { issueToken, type OtpRequestResult, type OtpVerifyResult } from './OtpService.js';
import { publicUser, upsertUserOnEmail } from './UserStore.js';

const CODE_TTL_MS = 5 * 60_000;
const RESEND_COOLDOWN_MS = 30_000;
const MAX_SENDS_PER_HOUR = 5;
const MAX_VERIFY_ATTEMPTS = 5;
const MAX_REQUESTS_PER_IP_PER_HOUR = 20;
const HOUR_MS = 60 * 60_000;

interface PendingCode {
  hash: Buffer;
  expiresAt: number;
  attempts: number;
  sentAt: number;
}

const pending = new Map<string, PendingCode>();
const sendLog = new Map<string, number[]>();
const ipLog = new Map<string, number[]>();

export function normalizeEmail(raw: string): string {
  return String(raw || '').trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function hashCode(email: string, code: string): Buffer {
  return crypto.createHash('sha256').update(`${email}:${code}`).digest();
}

function recent(log: Map<string, number[]>, key: string, now: number): number[] {
  const kept = (log.get(key) ?? []).filter((t) => now - t < HOUR_MS);
  log.set(key, kept);
  return kept;
}

export function emailLoginStatus(): { email: boolean; dev: boolean } {
  const dev = !isEmailConfigured() && process.env.NODE_ENV !== 'production';
  return { email: isEmailConfigured(), dev };
}

export async function requestEmailOtp(rawEmail: string, ip = 'unknown'): Promise<OtpRequestResult> {
  const configured = isEmailConfigured();
  const dev = !configured && process.env.NODE_ENV !== 'production';
  if (!configured && !dev) {
    return { ok: false, status: 503, error: 'Email sign-in is not configured on the server (SMTP_HOST/SMTP_USER/SMTP_PASS).' };
  }
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) {
    return { ok: false, status: 400, error: 'Enter a valid email address.' };
  }

  const now = Date.now();
  const ipHits = recent(ipLog, ip, now);
  if (ipHits.length >= MAX_REQUESTS_PER_IP_PER_HOUR) {
    return { ok: false, status: 429, error: 'Too many code requests. Try again later.', retryAfterSec: 3600 };
  }
  ipHits.push(now);

  const existing = pending.get(email);
  if (existing && now - existing.sentAt < RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((RESEND_COOLDOWN_MS - (now - existing.sentAt)) / 1000);
    return { ok: false, status: 429, error: `Wait ${wait}s before requesting a new code.`, retryAfterSec: wait };
  }
  const sends = recent(sendLog, email, now);
  if (sends.length >= MAX_SENDS_PER_HOUR) {
    return { ok: false, status: 429, error: 'Too many codes sent to this address. Try again in an hour.', retryAfterSec: 3600 };
  }

  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  if (dev) {
    console.log(`[AUTH] Email OTP for ${email} (dev, SMTP unset): ${code}`);
  } else {
    const sent = await sendEmailCode(email, code);
    if (!sent.ok) return { ok: false, status: 502, error: `Could not send the code via email. ${sent.error}` };
  }

  sends.push(now);
  pending.set(email, { hash: hashCode(email, code), expiresAt: now + CODE_TTL_MS, attempts: 0, sentAt: now });
  return {
    ok: true,
    expiresInSec: CODE_TTL_MS / 1000,
    resendInSec: RESEND_COOLDOWN_MS / 1000,
    via: dev ? 'dev' : 'text',
  };
}

export async function verifyEmailOtp(rawEmail: string, rawCode: string): Promise<OtpVerifyResult> {
  const email = normalizeEmail(rawEmail);
  const code = String(rawCode ?? '').replace(/\D/g, '');
  const entry = pending.get(email);
  if (!entry || Date.now() > entry.expiresAt) {
    pending.delete(email);
    return { ok: false, status: 400, error: 'Code expired or not requested. Request a new code.' };
  }
  if (code.length !== 6) {
    return { ok: false, status: 400, error: 'Enter the 6-digit code.', attemptsLeft: MAX_VERIFY_ATTEMPTS - entry.attempts };
  }

  entry.attempts += 1;
  if (!crypto.timingSafeEqual(entry.hash, hashCode(email, code))) {
    const attemptsLeft = MAX_VERIFY_ATTEMPTS - entry.attempts;
    if (attemptsLeft <= 0) {
      pending.delete(email);
      return { ok: false, status: 429, error: 'Too many wrong attempts. Request a new code.', attemptsLeft: 0 };
    }
    return { ok: false, status: 401, error: 'Incorrect code.', attemptsLeft };
  }

  pending.delete(email);
  const { user, isNew } = await upsertUserOnEmail(email);
  const { token, expiresAt } = issueToken(user);
  console.log(`[AUTH] Email OTP verified for ${email} (${isNew ? 'new user' : 'returning user'})`);
  return { ok: true, token, expiresAt, isNewUser: isNew, user: publicUser(user) };
}
