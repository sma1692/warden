/**
 * WhatsApp one-time-code sign-in. Pending codes and rate limits are in-memory;
 * a verified code creates/loads the user (UserStore) and returns a signed JWT.
 *
 * Env:
 *   WHATSAPP_OTP_TEMPLATE       Approved AUTHENTICATION template name (needed to reach numbers outside the 24h window)
 *   WHATSAPP_OTP_TEMPLATE_LANG  Template language (default WHATSAPP_TEMPLATE_LANG or en_US)
 *   WHATSAPP_LOGIN_NUMBERS      Optional allowlist, comma-separated. Empty or '*' lets any number sign in.
 *   AUTH_JWT_SECRET             HS256 secret (default: generated once into .state/auth-secret)
 *   AUTH_JWT_TTL_DAYS           Token lifetime in days (default 30)
 *   AUTH_DEV_OTP                Local testing only: 6-digit code accepted for any allowed number, nothing is sent.
 *                               Ignored when NODE_ENV=production.
 */
import crypto from 'node:crypto';
import {
  isWhatsAppConfigured,
  maskNumber,
  normalizeWhatsAppNumber,
  sendWhatsAppAuthCode,
} from '../bridge/whatsapp/index.js';
import { signJwt, verifyJwt } from './jwt.js';
import { getJwtSecret, getUserById, publicUser, upsertUserOnLogin, type UserRecord } from './UserStore.js';

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

export type OtpRequestResult =
  | { ok: true; expiresInSec: number; resendInSec: number; via: 'template' | 'text' | 'dev' }
  | { ok: false; status: number; error: string; retryAfterSec?: number };

export type OtpVerifyResult =
  | { ok: true; token: string; expiresAt: string; isNewUser: boolean; user: ReturnType<typeof publicUser> }
  | { ok: false; status: number; error: string; attemptsLeft?: number };

const pending = new Map<string, PendingCode>();
const sendLog = new Map<string, number[]>();
const ipLog = new Map<string, number[]>();

let warnedDevOtp = false;
function devOtp(): string | null {
  const code = (process.env.AUTH_DEV_OTP ?? '').trim();
  if (!/^\d{6}$/.test(code)) return null;
  if (process.env.NODE_ENV === 'production') return null;
  if (!warnedDevOtp) {
    warnedDevOtp = true;
    console.warn('[AUTH] !!! AUTH_DEV_OTP is set: codes are NOT sent and the fixed dev code signs in any allowed number. Local testing only. !!!');
  }
  return code;
}

function hashCode(phone: string, code: string): Buffer {
  return crypto.createHash('sha256').update(`${phone}:${code}`).digest();
}

/** Keeps timestamps within the last hour and returns them. */
function recent(log: Map<string, number[]>, key: string, now: number): number[] {
  const kept = (log.get(key) ?? []).filter((t) => now - t < HOUR_MS);
  log.set(key, kept);
  return kept;
}

/** null = open sign-up (any number); otherwise only these numbers can request a code. */
function allowedNumbers(): string[] | null {
  const raw = (process.env.WHATSAPP_LOGIN_NUMBERS ?? '').trim();
  if (!raw || raw === '*') return null;
  const list = raw.split(',').map(normalizeWhatsAppNumber).filter(Boolean);
  return list.length > 0 ? list : null;
}

/** Shared by OTP and WhatsApp click-to-chat sign-in. */
export function isLoginAllowed(phone: string): boolean {
  const allowed = allowedNumbers();
  return !allowed || allowed.includes(normalizeWhatsAppNumber(phone));
}

function tokenTtlSec(): number {
  const days = Number(process.env.AUTH_JWT_TTL_DAYS);
  return Math.round((Number.isFinite(days) && days > 0 ? days : 30) * 86_400);
}

export function otpLoginStatus(): { whatsapp: boolean; dev: boolean } {
  return { whatsapp: isWhatsAppConfigured(), dev: devOtp() !== null };
}

export async function requestOtp(rawPhone: string, ip = 'unknown'): Promise<OtpRequestResult> {
  const dev = devOtp();
  if (!dev && !isWhatsAppConfigured()) {
    return { ok: false, status: 503, error: 'WhatsApp is not configured on the server (set WHATSAPP_API_TOKEN and WHATSAPP_PHONE_NUMBER_ID).' };
  }
  const phone = normalizeWhatsAppNumber(rawPhone || '');
  if (phone.length < 8 || phone.length > 15) {
    return { ok: false, status: 400, error: 'Enter a valid WhatsApp number with country code.' };
  }

  const now = Date.now();
  const ipHits = recent(ipLog, ip, now);
  if (ipHits.length >= MAX_REQUESTS_PER_IP_PER_HOUR) {
    return { ok: false, status: 429, error: 'Too many code requests. Try again later.', retryAfterSec: 3600 };
  }
  ipHits.push(now);

  if (!isLoginAllowed(phone)) {
    return { ok: false, status: 403, error: 'This number is not allowed to sign in to this workspace.' };
  }

  const existing = pending.get(phone);
  if (existing && now - existing.sentAt < RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((RESEND_COOLDOWN_MS - (now - existing.sentAt)) / 1000);
    return { ok: false, status: 429, error: `Wait ${wait}s before requesting a new code.`, retryAfterSec: wait };
  }
  const sends = recent(sendLog, phone, now);
  if (sends.length >= MAX_SENDS_PER_HOUR) {
    return { ok: false, status: 429, error: 'Too many codes sent to this number. Try again in an hour.', retryAfterSec: 3600 };
  }

  const code = dev ?? crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  if (!dev) {
    const sent = await sendWhatsAppAuthCode(phone, code);
    if (!sent.ok) {
      const error = sent.outsideWindow
        ? 'WhatsApp blocked the message: no approved authentication template is set (WHATSAPP_OTP_TEMPLATE), and this number has not messaged the business number in the last 24h.'
        : `Could not send the code via WhatsApp. ${sent.error ?? ''}`.trim();
      return { ok: false, status: 502, error };
    }
  }

  sends.push(now);
  pending.set(phone, { hash: hashCode(phone, code), expiresAt: now + CODE_TTL_MS, attempts: 0, sentAt: now });
  console.log(`[AUTH] OTP ${dev ? 'issued (dev, not sent)' : 'sent'} to ${maskNumber(phone)}`);
  return {
    ok: true,
    expiresInSec: CODE_TTL_MS / 1000,
    resendInSec: RESEND_COOLDOWN_MS / 1000,
    via: dev ? 'dev' : process.env.WHATSAPP_OTP_TEMPLATE?.trim() ? 'template' : 'text',
  };
}

export function issueToken(user: UserRecord): { token: string; expiresAt: string } {
  const ttl = tokenTtlSec();
  const token = signJwt({ sub: user.id, phone: user.phone, ver: user.token_version }, getJwtSecret(), ttl);
  return { token, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() };
}

export function verifyOtp(rawPhone: string, rawCode: string): OtpVerifyResult {
  const phone = normalizeWhatsAppNumber(rawPhone || '');
  const code = String(rawCode ?? '').replace(/\D/g, '');
  const entry = pending.get(phone);
  if (!entry || Date.now() > entry.expiresAt) {
    pending.delete(phone);
    return { ok: false, status: 400, error: 'Code expired or not requested. Request a new code.' };
  }
  if (code.length !== 6) {
    return { ok: false, status: 400, error: 'Enter the 6-digit code.', attemptsLeft: MAX_VERIFY_ATTEMPTS - entry.attempts };
  }

  entry.attempts += 1;
  if (!crypto.timingSafeEqual(entry.hash, hashCode(phone, code))) {
    const attemptsLeft = MAX_VERIFY_ATTEMPTS - entry.attempts;
    if (attemptsLeft <= 0) {
      pending.delete(phone);
      return { ok: false, status: 429, error: 'Too many wrong attempts. Request a new code.', attemptsLeft: 0 };
    }
    return { ok: false, status: 401, error: 'Incorrect code.', attemptsLeft };
  }

  pending.delete(phone);
  const { user, isNew } = upsertUserOnLogin(phone);
  const { token, expiresAt } = issueToken(user);
  console.log(`[AUTH] OTP verified for ${maskNumber(phone)} (${isNew ? 'new user' : 'returning user'})`);
  return { ok: true, token, expiresAt, isNewUser: isNew, user: publicUser(user) };
}

/** Resolves a bearer JWT to its user; null when invalid, expired, or revoked. */
export function authenticateToken(token: string | undefined | null): UserRecord | null {
  if (!token) return null;
  const claims = verifyJwt(token, getJwtSecret());
  if (!claims) return null;
  const user = getUserById(claims.sub);
  if (!user || user.token_version !== claims.ver) return null;
  return user;
}
