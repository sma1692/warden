/**
 * WhatsApp click-to-chat sign-in ("reverse OTP").
 *
 * 1. The login page calls start(): it gets a secret request id (kept in the browser) and a short
 *    code shown inside a wa.me link / QR, e.g. "Sign me in to Warden: LOGIN-7F3K9Q".
 * 2. The user sends that message. The webhook calls handleInboundLoginText(); the sender's number
 *    is proven by WhatsApp itself, so the request is marked verified and a JWT is minted.
 * 3. The page polls status(id) and picks the JWT up once.
 *
 * Because the user messages first, the reply is a free-form message inside the 24h service
 * window: no template, no per-code fee. The code is useless without the request id.
 *
 * Env: WHATSAPP_BUSINESS_NUMBER (wa.me target, else looked up from the Graph API),
 *      WARDEN_APP_URL (optional link in WhatsApp replies).
 */
import crypto from 'node:crypto';
import { getCeoNumbers, getWhatsAppBusinessNumber, maskNumber, normalizeWhatsAppNumber } from '../bridge/whatsapp/index.js';
import { isLoginAllowed, issueToken } from './OtpService.js';
import { getUserByPhone, publicUser, upsertUserOnLogin, type UserRecord } from './UserStore.js';

const REQUEST_TTL_MS = 10 * 60_000;
const MAX_STARTS_PER_IP_PER_HOUR = 30;
const HOUR_MS = 60 * 60_000;
// No 0/O/1/I/L: the code may be read aloud or retyped.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_PATTERN = /\bLOGIN-([A-Z0-9]{6})\b/i;

interface LoginRequest {
  id: string;
  code: string;
  expiresAt: number;
  result?: { token: string; tokenExpiresAt: string; isNewUser: boolean; user: ReturnType<typeof publicUser> };
}

const byId = new Map<string, LoginRequest>();
const byCode = new Map<string, LoginRequest>();
const ipLog = new Map<string, number[]>();

const STEP_LABELS: Record<string, string> = {
  f1: 'track selection',
  '1a': 'your company brief (1A)',
  '1b': 'your AI org chart (1B)',
  '1c': 'your starter backlog (1C)',
  '2a': 'your company links (2A)',
  '2b': 'your team twins (2B)',
  '2c': 'your starter backlog (2C)',
  '3_import': 'the .md bundle import',
};

function appLink(): string {
  const url = (process.env.WARDEN_APP_URL ?? '').trim();
  return url ? ` ${url}` : '';
}

function prune(now: number): void {
  for (const r of byId.values()) {
    if (now > r.expiresAt) {
      byId.delete(r.id);
      byCode.delete(r.code);
    }
  }
}

function newCode(): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < 6; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (!byCode.has(code)) return code;
  }
}

export type StartResult =
  | { ok: true; id: string; code: string; message: string; waLink: string; businessNumber: string; expiresAt: string }
  | { ok: false; status: number; error: string; retryAfterSec?: number };

export async function start(ip = 'unknown'): Promise<StartResult> {
  const businessNumber = await getWhatsAppBusinessNumber();
  if (!businessNumber) {
    return {
      ok: false,
      status: 503,
      error: 'WhatsApp sign-in is not set up: set WHATSAPP_BUSINESS_NUMBER (or a valid WHATSAPP_API_TOKEN + WHATSAPP_PHONE_NUMBER_ID).',
    };
  }
  const now = Date.now();
  prune(now);
  const hits = (ipLog.get(ip) ?? []).filter((t) => now - t < HOUR_MS);
  if (hits.length >= MAX_STARTS_PER_IP_PER_HOUR) {
    return { ok: false, status: 429, error: 'Too many sign-in attempts. Try again later.', retryAfterSec: 3600 };
  }
  hits.push(now);
  ipLog.set(ip, hits);

  const req: LoginRequest = { id: crypto.randomBytes(24).toString('base64url'), code: newCode(), expiresAt: now + REQUEST_TTL_MS };
  byId.set(req.id, req);
  byCode.set(req.code, req);
  const message = `Sign me in to Warden: LOGIN-${req.code}`;
  return {
    ok: true,
    id: req.id,
    code: req.code,
    message,
    waLink: `https://wa.me/${businessNumber}?text=${encodeURIComponent(message)}`,
    businessNumber,
    expiresAt: new Date(req.expiresAt).toISOString(),
  };
}

export type StatusResult =
  | { status: 'PENDING'; expiresAt: string }
  | { status: 'VERIFIED'; token: string; tokenExpiresAt: string; isNewUser: boolean; user: ReturnType<typeof publicUser> }
  | { status: 'EXPIRED' };

/** Polled by the login page. A verified result is handed out once, then forgotten. */
export function status(id: string): StatusResult {
  const req = byId.get(id);
  if (!req || Date.now() > req.expiresAt) {
    if (req) {
      byId.delete(req.id);
      byCode.delete(req.code);
    }
    return { status: 'EXPIRED' };
  }
  if (!req.result) return { status: 'PENDING', expiresAt: new Date(req.expiresAt).toISOString() };
  byId.delete(req.id);
  return { status: 'VERIFIED', ...req.result };
}

function stageLine(user: UserRecord): string {
  const { status: s, step } = user.onboarding;
  if (s === 'COMPLETE') return 'Your command center is ready.';
  if (s === 'IN_PROGRESS' && step) return `You stopped at ${STEP_LABELS[step] ?? step}.`;
  return 'You have not set up your workspace yet.';
}

function signedInReply(user: UserRecord, isNew: boolean): string {
  if (isNew) return "✅ You're signed in to Warden. Welcome!\n\nGo back to your browser and pick how to set up your AI workforce.";
  const { status: s, step } = user.onboarding;
  if (s === 'COMPLETE') return '✅ Signed in. Welcome back!\n\nYour command center is open in your browser.';
  if (s === 'IN_PROGRESS' && step) {
    return `✅ Signed in. Welcome back!\n\nYou stopped at ${STEP_LABELS[step] ?? step}. Your browser picks up right there.`;
  }
  return '✅ Signed in. Welcome back!\n\nGo back to your browser and pick how to set up your AI workforce.';
}

/**
 * Webhook hook for text from ANY sender, before the CEO allowlist.
 * Returns the reply to send, or null to pass the message on (CEO chat with the agents).
 */
export function handleInboundLoginText(from: string, text: string): string | null {
  const phone = normalizeWhatsAppNumber(from);
  const match = CODE_PATTERN.exec(text);

  if (match) {
    prune(Date.now());
    const req = byCode.get(match[1].toUpperCase());
    if (!req || req.result) {
      return '⌛ That sign-in code has expired or was already used. Refresh the QR code on the login page and send the new message.';
    }
    if (!isLoginAllowed(phone)) {
      console.warn(`[AUTH] WhatsApp sign-in refused for ${maskNumber(phone)} (not in WHATSAPP_LOGIN_NUMBERS)`);
      return 'This number is not allowed to sign in to this workspace.';
    }
    byCode.delete(req.code);
    const { user, isNew } = upsertUserOnLogin(phone);
    const { token, expiresAt } = issueToken(user);
    req.result = { token, tokenExpiresAt: expiresAt, isNewUser: isNew, user: publicUser(user) };
    console.log(`[AUTH] WhatsApp sign-in for ${maskNumber(phone)} (${isNew ? 'new user' : 'returning user'})`);
    return signedInReply(user, isNew);
  }

  // The CEO's ordinary messages go to the agents as before.
  if (getCeoNumbers().includes(phone)) return null;

  const user = getUserByPhone(phone);
  if (user) {
    return `Hi! ${stageLine(user)}\n\nTo sign in on a computer, open the Warden login page${appLink()} and scan the QR code.`;
  }
  return `Hi! This is Warden 👋\n\nTo sign in, open the Warden login page${appLink()} and scan the QR code, or tap "Open WhatsApp" there. Your number is all you need.`;
}
