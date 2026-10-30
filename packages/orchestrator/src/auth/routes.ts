import type { IncomingMessage, ServerResponse } from 'node:http';
import { authenticateToken, issueToken, otpLoginStatus, requestOtp, verifyOtp } from './OtpService.js';
import * as waLogin from './WhatsAppLinkLogin.js';
import {
  bumpTokenVersion,
  ONBOARDING_STEPS,
  publicUser,
  updateOnboarding,
  type OnboardingStatus,
  type OnboardingStep,
  type UserRecord,
} from './UserStore.js';

export interface AuthRouteContext {
  pathname: string;
  method: string;
  readJsonBody: () => Promise<Record<string, any>>;
  sendJson: (res: ServerResponse, status: number, body: unknown) => void;
}

/**
 * HttpOnly cookie carrying the same JWT. Only /media and the /ws upgrade read it
 * (an <img> or WebSocket cannot set headers); /api routes require the Bearer header,
 * which keeps them safe from cross-site request forgery.
 */
export const SESSION_COOKIE = 'warden_session';

/** Paths reachable without a token. */
export function isPublicPath(pathname: string, method: string): boolean {
  if (method === 'OPTIONS') return true;
  if (pathname === '/webhook/whatsapp') return true;
  if (pathname.startsWith('/api/auth/otp/') || pathname.startsWith('/api/auth/wa/')) return true;
  if (pathname === '/api/health' && (method === 'GET' || method === 'HEAD')) return true;
  return false;
}

function readCookie(req: IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

/**
 * Bearer header always; the cookie and `?token=` only when `allowAmbient`
 * (media and WebSocket upgrades).
 */
export function extractToken(req: IncomingMessage, allowAmbient = false): string | undefined {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7).trim();
  if (!allowAmbient) return undefined;
  const q = new URL(req.url || '/', 'http://localhost').searchParams.get('token');
  return q || readCookie(req, SESSION_COOKIE);
}

export function authenticateRequest(req: IncomingMessage, allowAmbient = false): UserRecord | null {
  return authenticateToken(extractToken(req, allowAmbient));
}

function setSessionCookie(res: ServerResponse, token: string | null, expiresAt?: string): void {
  const base = `${SESSION_COOKIE}=${token ? encodeURIComponent(token) : ''}; Path=/; HttpOnly; SameSite=Strict`;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    token && expiresAt ? `${base}; Expires=${new Date(expiresAt).toUTCString()}${secure}` : `${base}; Max-Age=0${secure}`
  );
}

function clientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
}

/**
 * Handles /api/auth routes. Returns true when the request was handled.
 *
 *  GET   /api/auth/otp/status        { whatsapp, dev }                        public
 *  POST  /api/auth/otp/request       { phone }        -> code via WhatsApp    public
 *  POST  /api/auth/otp/verify        { phone, code }  -> { token, user, ... } public
 *  POST  /api/auth/wa/start                           -> { id, code, wa_link } public (click-to-chat)
 *  GET   /api/auth/wa/status?id=     PENDING | VERIFIED { token, user } | EXPIRED  public
 *  GET   /api/auth/me                                 -> { user }             Bearer
 *  PATCH /api/auth/me/onboarding     { step?, status? } -> { user }           Bearer
 *  POST  /api/auth/refresh                            -> { token, ... }       Bearer
 *  POST  /api/auth/logout            revokes all of this user's tokens        Bearer
 */
export async function handleAuthRoutes(req: IncomingMessage, res: ServerResponse, ctx: AuthRouteContext): Promise<boolean> {
  const { pathname, sendJson } = ctx;
  if (!pathname.startsWith('/api/auth/')) return false;
  const method = (ctx.method || 'GET').toUpperCase();

  if (pathname === '/api/auth/otp/status' && method === 'GET') {
    sendJson(res, 200, otpLoginStatus());
    return true;
  }

  if (pathname === '/api/auth/otp/request' && method === 'POST') {
    const body = await ctx.readJsonBody();
    const r = await requestOtp(String(body.phone ?? ''), clientIp(req));
    if (r.ok) {
      sendJson(res, 200, { ok: true, expires_in_sec: r.expiresInSec, resend_in_sec: r.resendInSec, via: r.via });
    } else {
      if (r.retryAfterSec) res.setHeader('Retry-After', String(r.retryAfterSec));
      sendJson(res, r.status, { ok: false, error: r.error, retry_after_sec: r.retryAfterSec });
    }
    return true;
  }

  if (pathname === '/api/auth/otp/verify' && method === 'POST') {
    const body = await ctx.readJsonBody();
    const r = verifyOtp(String(body.phone ?? ''), String(body.code ?? ''));
    if (r.ok) {
      setSessionCookie(res, r.token, r.expiresAt);
      sendJson(res, 200, { ok: true, token: r.token, expires_at: r.expiresAt, is_new_user: r.isNewUser, user: r.user });
    } else {
      sendJson(res, r.status, { ok: false, error: r.error, attempts_left: r.attemptsLeft });
    }
    return true;
  }

  if (pathname === '/api/auth/wa/start' && method === 'POST') {
    const r = await waLogin.start(clientIp(req));
    if (r.ok) {
      sendJson(res, 200, {
        ok: true,
        id: r.id,
        code: r.code,
        message: r.message,
        wa_link: r.waLink,
        business_number: r.businessNumber,
        expires_at: r.expiresAt,
      });
    } else {
      if (r.retryAfterSec) res.setHeader('Retry-After', String(r.retryAfterSec));
      sendJson(res, r.status, { ok: false, error: r.error });
    }
    return true;
  }

  if (pathname === '/api/auth/wa/status' && method === 'GET') {
    const id = new URL(req.url || '/', 'http://localhost').searchParams.get('id') ?? '';
    const r = waLogin.status(id);
    if (r.status === 'VERIFIED') {
      setSessionCookie(res, r.token, r.tokenExpiresAt);
      sendJson(res, 200, {
        ok: true,
        status: r.status,
        token: r.token,
        expires_at: r.tokenExpiresAt,
        is_new_user: r.isNewUser,
        user: r.user,
      });
    } else if (r.status === 'PENDING') {
      sendJson(res, 200, { ok: true, status: r.status, expires_at: r.expiresAt });
    } else {
      sendJson(res, 410, { ok: false, status: r.status, error: 'Sign-in request expired. Refresh the QR code.' });
    }
    return true;
  }

  // Everything below needs a valid Bearer token.
  const user = authenticateRequest(req);
  if (!user) {
    sendJson(res, 401, { ok: false, error: 'Not signed in' });
    return true;
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    sendJson(res, 200, { ok: true, user: publicUser(user) });
    return true;
  }

  if (pathname === '/api/auth/me/onboarding' && (method === 'PATCH' || method === 'POST')) {
    const body = await ctx.readJsonBody();
    const patch: { status?: OnboardingStatus; step?: OnboardingStep | null } = {};
    if (body.step !== undefined) {
      if (body.step !== null && !ONBOARDING_STEPS.includes(body.step)) {
        sendJson(res, 400, { ok: false, error: `step must be one of ${ONBOARDING_STEPS.join(', ')}` });
        return true;
      }
      patch.step = body.step;
    }
    if (body.status !== undefined) {
      if (!['NOT_STARTED', 'IN_PROGRESS', 'COMPLETE'].includes(body.status)) {
        sendJson(res, 400, { ok: false, error: 'status must be NOT_STARTED, IN_PROGRESS or COMPLETE' });
        return true;
      }
      patch.status = body.status;
    }
    const updated = updateOnboarding(user.id, patch);
    sendJson(res, 200, { ok: true, user: updated ? publicUser(updated) : publicUser(user) });
    return true;
  }

  if (pathname === '/api/auth/refresh' && method === 'POST') {
    const { token, expiresAt } = issueToken(user);
    setSessionCookie(res, token, expiresAt);
    sendJson(res, 200, { ok: true, token, expires_at: expiresAt, user: publicUser(user) });
    return true;
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    bumpTokenVersion(user.id);
    setSessionCookie(res, null);
    sendJson(res, 200, { ok: true });
    return true;
  }

  sendJson(res, 404, { ok: false, error: 'Not found' });
  return true;
}
