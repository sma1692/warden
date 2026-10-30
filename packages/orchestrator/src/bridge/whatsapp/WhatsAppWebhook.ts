import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  downloadWhatsAppMedia,
  getCeoNumbers,
  markWhatsAppRead,
  maskNumber,
  normalizeWhatsAppNumber,
  sendWhatsAppText,
} from './WhatsAppClient.js';

/**
 * WhatsApp Cloud API webhook.
 *
 *   GET  /webhook/whatsapp  -> subscription verification (hub.mode / hub.verify_token / hub.challenge)
 *   POST /webhook/whatsapp  -> inbound notifications, verified via X-Hub-Signature-256 (WHATSAPP_APP_SECRET)
 *
 * Env: WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_CEO_NUMBER (allowlist, comma-separated),
 *      WHATSAPP_ACK_DELAY_MS (default 5000; "on it" ack if the agent reply takes longer),
 *      WHATSAPP_AUTO_REPLY (if set, every inbound message gets this fixed text instead of an agent reply).
 *
 * Inbound routing:
 *   any sender, text -> ctx.onAnySenderText first (sign-in codes, stage replies); a non-null reply ends it
 * then (after allowlist + dedupe + auto-reply short-circuit):
 *   interactive button_reply / list_reply, template quick-reply `button` -> ctx.onInboundButton
 *     (falls back to ctx.onInboundText with the button title when no button handler is set)
 *   text  -> ctx.onInboundText
 *   audio -> ctx.onInboundAudio (media downloaded first)
 */

export const WHATSAPP_WEBHOOK_PATH = '/webhook/whatsapp';
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export interface WhatsAppInboundText {
  from: string;
  text: string;
  messageId: string;
  timestamp: string;
}

export interface WhatsAppInboundAudio {
  from: string;
  messageId: string;
  audio: Buffer;
  mimeType: string;
}

export interface WhatsAppInboundButton {
  from: string;
  messageId: string;
  /** Reply ID we set on the button (or template quick-reply payload). */
  buttonId: string;
  /** Visible button label. */
  title: string;
}

export interface WhatsAppRouteContext {
  pathname: string;
  method: string;
  onInboundText: (msg: WhatsAppInboundText) => Promise<string | null>;
  onInboundAudio?: (msg: WhatsAppInboundAudio) => Promise<string | null>;
  onInboundButton?: (msg: WhatsAppInboundButton) => Promise<string | null>;
  /**
   * Text from any sender, checked before the CEO allowlist. Return a reply to handle the
   * message here, or null to pass it on (non-allowlisted senders are then ignored).
   */
  onAnySenderText?: (msg: WhatsAppInboundText) => Promise<string | null> | string | null;
}

// ---------- dedupe (in-memory LRU) ----------
const SEEN_MAX = 1000;
const seenIds = new Map<string, number>();
function alreadySeen(id: string): boolean {
  if (seenIds.has(id)) return true;
  seenIds.set(id, Date.now());
  if (seenIds.size > SEEN_MAX) {
    const oldest = seenIds.keys().next().value;
    if (oldest !== undefined) seenIds.delete(oldest);
  }
  return false;
}

// ---------- pending async work (lets tests / shutdown await processing) ----------
const pending = new Set<Promise<void>>();
export async function whatsAppWebhookIdle(): Promise<void> {
  while (pending.size > 0) await Promise.allSettled([...pending]);
}

let warnedNoSecret = false;
let warnedNoAllowlist = false;

function readRawBody(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!aborted) resolve(Buffer.concat(chunks));
    });
    req.on('error', () => resolve(null));
  });
}

export function verifyWhatsAppSignature(raw: Buffer, header: string | undefined, secret: string): boolean {
  if (!header || !header.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  const given = header.slice('sha256='.length).trim();
  if (given.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

function send(res: ServerResponse, status: number, body: string, type = 'text/plain; charset=utf-8'): void {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.end(body);
}

/** Returns true if the request was a WhatsApp webhook route and has been handled. */
export async function handleWhatsAppRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: WhatsAppRouteContext
): Promise<boolean> {
  const pathname = ctx.pathname.replace(/\/+$/, '') || '/';
  if (pathname !== WHATSAPP_WEBHOOK_PATH) return false;

  if (ctx.method === 'GET') {
    handleVerification(req, res);
    return true;
  }

  if (ctx.method === 'POST') {
    const raw = await readRawBody(req);
    if (!raw) {
      send(res, 413, 'payload too large');
      return true;
    }

    const secret = (process.env.WHATSAPP_APP_SECRET ?? '').trim();
    if (secret) {
      const sig = req.headers['x-hub-signature-256'];
      if (!verifyWhatsAppSignature(raw, Array.isArray(sig) ? sig[0] : sig, secret)) {
        console.warn('[WHATSAPP] rejected webhook POST: invalid X-Hub-Signature-256');
        send(res, 401, 'invalid signature');
        return true;
      }
    } else if (!warnedNoSecret) {
      warnedNoSecret = true;
      console.warn(
        '[WHATSAPP] !!! WHATSAPP_APP_SECRET is not set: webhook signatures are NOT verified. Anyone who finds the URL can inject messages. Set it before exposing the tunnel. !!!'
      );
    }

    let payload: any;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      send(res, 400, 'invalid json');
      return true;
    }

    // Ack Meta immediately; agent work can take minutes.
    send(res, 200, 'EVENT_RECEIVED');

    const work = processPayload(payload, ctx).catch((err) =>
      console.warn(`[WHATSAPP] processing error: ${(err as Error).message}`)
    );
    pending.add(work);
    void work.finally(() => pending.delete(work));
    return true;
  }

  send(res, 405, 'method not allowed');
  return true;
}

function handleVerification(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge') ?? '';
  const expected = (process.env.WHATSAPP_VERIFY_TOKEN ?? '').trim();

  if (!expected) {
    console.warn('[WHATSAPP] webhook verification attempted but WHATSAPP_VERIFY_TOKEN is not set');
    send(res, 403, 'verify token not configured');
    return;
  }
  if (mode === 'subscribe' && token === expected) {
    console.log('[WHATSAPP] webhook verified by Meta');
    send(res, 200, challenge);
    return;
  }
  console.warn('[WHATSAPP] webhook verification failed (bad mode or token)');
  send(res, 403, 'forbidden');
}

function isAllowed(from: string): boolean {
  const allow = getCeoNumbers();
  if (allow.length === 0) {
    if (!warnedNoAllowlist) {
      warnedNoAllowlist = true;
      console.warn('[WHATSAPP] WHATSAPP_CEO_NUMBER is not set: all inbound messages are ignored');
    }
    return false;
  }
  return allow.includes(normalizeWhatsAppNumber(from));
}

async function processPayload(payload: any, ctx: WhatsAppRouteContext): Promise<void> {
  if (payload?.object !== 'whatsapp_business_account') return;
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue;
      const value = change.value ?? {};
      // Delivery/read status updates arrive in value.statuses: ignore.
      for (const msg of value.messages ?? []) {
        await handleMessage(msg, ctx);
      }
    }
  }
}

async function handleMessage(msg: any, ctx: WhatsAppRouteContext): Promise<void> {
  const from = String(msg?.from ?? '');
  const messageId = String(msg?.id ?? '');
  if (!from || !messageId) return;

  if (alreadySeen(messageId)) return;
  const timestamp = String(msg.timestamp ?? Math.floor(Date.now() / 1000));

  const publicText = ctx.onAnySenderText ? extractText(msg) : null;
  if (publicText !== null && ctx.onAnySenderText) {
    const answer = await ctx.onAnySenderText({ from, text: publicText, messageId, timestamp });
    if (answer !== null) {
      void markWhatsAppRead(messageId);
      console.log(`[WHATSAPP] public reply to ${maskNumber(from)}`);
      await reply(from, answer);
      return;
    }
  }

  if (!isAllowed(from)) {
    console.warn(`[WHATSAPP] ignored message from non-allowlisted sender ${maskNumber(from)}`);
    return;
  }

  void markWhatsAppRead(messageId);

  // Fixed-reply mode: answer every inbound message with WHATSAPP_AUTO_REPLY and skip the agents.
  const autoReply = (process.env.WHATSAPP_AUTO_REPLY ?? '').trim();
  if (autoReply) {
    console.log(`[WHATSAPP] auto-reply to ${maskNumber(from)} (${msg.type ?? 'unknown'} message)`);
    await reply(from, autoReply);
    return;
  }

  const button = extractButton(msg);
  if (button) {
    console.log(`[WHATSAPP] inbound button from ${maskNumber(from)}: id="${button.id.slice(0, 80)}" title="${button.title}"`);
    const onButton = ctx.onInboundButton;
    if (onButton) {
      await replyWithAck(from, () => onButton({ from, messageId, buttonId: button.id, title: button.title }));
    } else {
      const text = button.title || button.id;
      await replyWithAck(from, () => ctx.onInboundText({ from, text, messageId, timestamp }));
    }
    return;
  }

  const text = extractText(msg);
  if (text !== null) {
    console.log(`[WHATSAPP] inbound text from ${maskNumber(from)}: "${text.replace(/\s+/g, ' ').slice(0, 120)}"`);
    await replyWithAck(from, () => ctx.onInboundText({ from, text, messageId, timestamp }));
    return;
  }

  if (msg.type === 'audio') {
    if (!ctx.onInboundAudio) {
      await reply(from, "Voice notes aren't supported yet. Please send your message as text.");
      return;
    }
    const mediaId = msg.audio?.id;
    const media = mediaId ? await downloadWhatsAppMedia(String(mediaId)) : null;
    if (!media) {
      await reply(from, "I couldn't download that voice note. Please try again or send text.");
      return;
    }
    const handler = ctx.onInboundAudio;
    await replyWithAck(from, () =>
      handler({ from, messageId, audio: media.buffer, mimeType: media.mimeType })
    );
    return;
  }

  await reply(from, `Sorry, I can't handle "${msg.type ?? 'unknown'}" messages yet. Please send text.`);
}

/** Reply-button / list / template quick-reply taps. Returns null for anything else. */
function extractButton(msg: any): { id: string; title: string } | null {
  if (msg.type === 'interactive') {
    const i = msg.interactive ?? {};
    const r = i.button_reply ?? i.list_reply;
    if (!r) return null;
    const id = String(r.id ?? '');
    const title = String(r.title ?? '');
    return id || title ? { id: id || title, title } : null;
  }
  if (msg.type === 'button') {
    const id = String(msg.button?.payload ?? '');
    const title = String(msg.button?.text ?? '');
    return id || title ? { id: id || title, title } : null;
  }
  return null;
}

/** Plain text bodies only; button taps are handled by extractButton first. */
function extractText(msg: any): string | null {
  if (msg.type === 'text') return typeof msg.text?.body === 'string' ? msg.text.body : null;
  return null;
}

async function reply(to: string, text: string): Promise<void> {
  const r = await sendWhatsAppText(to, text);
  if (!r.ok) console.warn(`[WHATSAPP] reply to ${maskNumber(to)} not sent: ${r.error}`);
}

/** Runs the agent handler; sends a short ack if it takes longer than WHATSAPP_ACK_DELAY_MS, then the real reply. */
async function replyWithAck(to: string, run: () => Promise<string | null>): Promise<void> {
  const delay = Number(process.env.WHATSAPP_ACK_DELAY_MS ?? 5000);
  const timer = setTimeout(() => {
    void reply(to, 'On it. Warden is working on this, the full reply will follow.');
  }, Number.isFinite(delay) && delay >= 0 ? delay : 5000);
  let answer: string | null;
  try {
    answer = await run();
  } catch (err) {
    console.warn(`[WHATSAPP] handler error: ${(err as Error).message}`);
    answer = 'Something went wrong while processing your message. Check the Commando dashboard.';
  } finally {
    clearTimeout(timer);
  }
  if (answer && answer.trim()) await reply(to, answer);
}
