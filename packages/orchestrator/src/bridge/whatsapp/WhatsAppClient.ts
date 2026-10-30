/**
 * WhatsApp Business Cloud API client (official Meta Graph API, not whatsapp-web.js).
 *
 * Env:
 *   WHATSAPP_API_TOKEN        System User / temporary access token (never logged)
 *   WHATSAPP_PHONE_NUMBER_ID  Sender phone number ID from the WhatsApp > API Setup page
 *   WHATSAPP_CEO_NUMBER       Default recipient(s), E.164 digits, comma-separated (first is default)
 *   WHATSAPP_GRAPH_VERSION    Graph API version (default v26.0)
 *   WHATSAPP_REMINDER_TEMPLATE Optional approved template name for out-of-window fallback
 *   WHATSAPP_TEMPLATE_LANG    Optional template language code (default en_US)
 */

const DEFAULT_GRAPH_VERSION = 'v26.0';
export const WHATSAPP_MAX_TEXT = 4096;

/** Graph error code for "message outside the 24h customer service window". */
const RE_ENGAGEMENT_ERROR_CODE = 131047;

export interface WhatsAppSendResult {
  ok: boolean;
  error?: string;
  messageIds?: string[];
  /** True when the failure was the 24h customer-service-window restriction. */
  outsideWindow?: boolean;
}

function env(name: string): string {
  return (process.env[name] ?? '').trim();
}

function graphVersion(): string {
  const v = env('WHATSAPP_GRAPH_VERSION') || DEFAULT_GRAPH_VERSION;
  return v.startsWith('v') ? v : `v${v}`;
}

function graphBase(): string {
  return `https://graph.facebook.com/${graphVersion()}`;
}

/** Strips '+', spaces, dashes, parens so numbers compare as plain digits. */
export function normalizeWhatsAppNumber(n: string): string {
  return n.replace(/[^\d]/g, '');
}

export function getCeoNumbers(): string[] {
  return env('WHATSAPP_CEO_NUMBER')
    .split(',')
    .map((s) => normalizeWhatsAppNumber(s))
    .filter(Boolean);
}

export function isWhatsAppConfigured(): boolean {
  return Boolean(env('WHATSAPP_API_TOKEN') && env('WHATSAPP_PHONE_NUMBER_ID'));
}

/** Light Markdown -> WhatsApp formatting conversion. */
export function toWhatsAppFormat(input: string): string {
  let text = input.replace(/\r\n/g, '\n');

  // Code fences: keep contents, WhatsApp supports ```monospace``` blocks, drop the language tag.
  text = text.replace(/```[a-zA-Z0-9_+-]*\n([\s\S]*?)```/g, (_m, body: string) => '```' + body.replace(/\n+$/, '') + '```');

  // Protect code blocks / inline code from further transforms.
  const protectedChunks: string[] = [];
  text = text.replace(/```[\s\S]*?```|`[^`\n]+`/g, (m) => {
    protectedChunks.push(m);
    return `\u0000${protectedChunks.length - 1}\u0000`;
  });

  // Headers -> bold line.
  text = text.replace(/^#{1,6}\s+(.+?)\s*#*\s*$/gm, (_m, h: string) => `*${h.replace(/\*+/g, '')}*`);
  // Bold **x** / __x__ -> *x*
  text = text.replace(/\*\*(.+?)\*\*/g, '*$1*');
  text = text.replace(/__(.+?)__/g, '*$1*');
  // Strikethrough ~~x~~ -> ~x~
  text = text.replace(/~~(.+?)~~/g, '~$1~');
  // Links [label](url) -> label (url)
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)');
  // Bullets "* " / "+ " -> "- " (avoid accidental bold)
  text = text.replace(/^(\s*)[*+]\s+/gm, '$1- ');
  // Horizontal rules
  text = text.replace(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/gm, '');
  // Collapse 3+ blank lines
  text = text.replace(/\n{3,}/g, '\n\n');

  text = text.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => protectedChunks[Number(i)]);
  return text.trim();
}

/** Splits text into <= max-char chunks, preferring paragraph, then line, then word boundaries. */
export function splitWhatsAppText(text: string, max = WHATSAPP_MAX_TEXT): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = window.lastIndexOf('\n\n');
    if (cut < max * 0.5) cut = window.lastIndexOf('\n');
    if (cut < max * 0.5) cut = window.lastIndexOf(' ');
    if (cut < max * 0.5) cut = max;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

interface GraphErrorBody {
  error?: { message?: string; code?: number; error_subcode?: number; error_data?: { details?: string } };
}

async function postMessage(payload: Record<string, unknown>): Promise<{ ok: boolean; id?: string; error?: string; code?: number }> {
  const token = env('WHATSAPP_API_TOKEN');
  const phoneId = env('WHATSAPP_PHONE_NUMBER_ID');
  try {
    const res = await fetch(`${graphBase()}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
    });
    const body = (await res.json().catch(() => ({}))) as GraphErrorBody & { messages?: { id: string }[] };
    if (!res.ok || body.error) {
      const e = body.error ?? {};
      const details = e.error_data?.details ? ` (${e.error_data.details})` : '';
      return { ok: false, code: e.code, error: `Graph ${res.status} code=${e.code ?? '?'}: ${e.message ?? 'unknown error'}${details}` };
    }
    return { ok: true, id: body.messages?.[0]?.id };
  } catch (err) {
    return { ok: false, error: `Network error: ${(err as Error).message}` };
  }
}

function resolveRecipient(to: string | undefined): string | null {
  const n = to ? normalizeWhatsAppNumber(to) : getCeoNumbers()[0];
  return n || null;
}

function notConfiguredError(): string {
  const missing = ['WHATSAPP_API_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'].filter((k) => !env(k));
  return `WhatsApp not configured (missing ${missing.join(', ')})`;
}

/**
 * Sends free-form text. Only delivers inside the 24h customer service window
 * (CEO messaged the business number in the last 24h). Outside the window Graph
 * returns code 131047; we report it clearly and, when WHATSAPP_REMINDER_TEMPLATE
 * is set, fall back to that template with the (truncated) text as {{1}}.
 */
export async function sendWhatsAppText(to: string | undefined, text: string): Promise<WhatsAppSendResult> {
  if (!isWhatsAppConfigured()) return { ok: false, error: notConfiguredError() };
  const recipient = resolveRecipient(to);
  if (!recipient) return { ok: false, error: 'No recipient: pass `to` or set WHATSAPP_CEO_NUMBER' };
  const formatted = toWhatsAppFormat(text);
  if (!formatted) return { ok: false, error: 'Empty message' };

  const ids: string[] = [];
  for (const chunk of splitWhatsAppText(formatted)) {
    const r = await postMessage({
      recipient_type: 'individual',
      to: recipient,
      type: 'text',
      text: { preview_url: false, body: chunk },
    });
    if (!r.ok) {
      if (r.code === RE_ENGAGEMENT_ERROR_CODE) {
        const template = env('WHATSAPP_REMINDER_TEMPLATE');
        if (template && ids.length === 0) {
          const t = await sendWhatsAppTemplate(recipient, template, [formatted.replace(/\s+/g, ' ').slice(0, 1000)]);
          return t.ok
            ? { ...t, outsideWindow: true }
            : { ok: false, outsideWindow: true, error: `Outside 24h window; template fallback failed: ${t.error}` };
        }
        return {
          ok: false,
          outsideWindow: true,
          messageIds: ids,
          error:
            'Outside the 24h WhatsApp customer service window: the CEO must message the business number first' +
            (template ? '' : ', or set WHATSAPP_REMINDER_TEMPLATE to an approved template for fallback'),
        };
      }
      console.warn(`[WHATSAPP] send failed to ${maskNumber(recipient)}: ${r.error}`);
      return { ok: false, error: r.error, messageIds: ids };
    }
    if (r.id) ids.push(r.id);
  }
  return { ok: true, messageIds: ids };
}

export interface WhatsAppButton {
  /** Reply ID echoed back in the webhook (max 256 chars). */
  id: string;
  /** Button label (max 20 chars, truncated). */
  title: string;
}

/** Truncates to `max` chars, ending with an ellipsis when cut. */
function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}\u2026`;
}

/**
 * Sends an interactive reply-button message (1..3 buttons, extras dropped).
 * Same 24h-window rule as free-form text; outside it we report outsideWindow
 * (no template fallback: templates cannot carry ad-hoc reply buttons).
 */
export async function sendWhatsAppButtons(
  to: string | undefined,
  body: string,
  buttons: WhatsAppButton[],
  opts: { header?: string; footer?: string } = {}
): Promise<WhatsAppSendResult> {
  if (!isWhatsAppConfigured()) return { ok: false, error: notConfiguredError() };
  const recipient = resolveRecipient(to);
  if (!recipient) return { ok: false, error: 'No recipient: pass `to` or set WHATSAPP_CEO_NUMBER' };
  const formatted = toWhatsAppFormat(body);
  if (!formatted) return { ok: false, error: 'Empty message' };
  const valid = buttons
    .filter((b) => b && b.id && b.title)
    .slice(0, 3)
    .map((b) => ({ type: 'reply', reply: { id: b.id.slice(0, 256), title: clip(b.title.trim(), 20) } }));
  if (valid.length === 0) return { ok: false, error: 'At least one button (id + title) is required' };

  const interactive: Record<string, unknown> = {
    type: 'button',
    body: { text: clip(formatted, 1024) },
    action: { buttons: valid },
  };
  const header = opts.header?.trim();
  if (header) interactive.header = { type: 'text', text: clip(header, 60) };
  const footer = opts.footer?.trim();
  if (footer) interactive.footer = { text: clip(footer, 60) };

  const r = await postMessage({ recipient_type: 'individual', to: recipient, type: 'interactive', interactive });
  if (!r.ok) {
    if (r.code === RE_ENGAGEMENT_ERROR_CODE) {
      return {
        ok: false,
        outsideWindow: true,
        error: 'Outside the 24h WhatsApp customer service window: the CEO must message the business number first',
      };
    }
    console.warn(`[WHATSAPP] buttons send failed to ${maskNumber(recipient)}: ${r.error}`);
    return { ok: false, error: r.error };
  }
  return { ok: true, messageIds: r.id ? [r.id] : [] };
}

/**
 * Sends an approved message template (works outside the 24h window).
 * `params` fill body placeholders {{1}}, {{2}}, ... in order.
 */
export async function sendWhatsAppTemplate(
  to: string | undefined,
  templateName: string,
  params: string[] = [],
  languageCode: string = env('WHATSAPP_TEMPLATE_LANG') || 'en_US'
): Promise<WhatsAppSendResult> {
  if (!isWhatsAppConfigured()) return { ok: false, error: notConfiguredError() };
  const recipient = resolveRecipient(to);
  if (!recipient) return { ok: false, error: 'No recipient: pass `to` or set WHATSAPP_CEO_NUMBER' };
  const template: Record<string, unknown> = { name: templateName, language: { code: languageCode } };
  if (params.length > 0) {
    template.components = [
      {
        type: 'body',
        // Template params cannot contain newlines/tabs or 4+ consecutive spaces.
        parameters: params.map((p) => ({ type: 'text', text: p.replace(/[\n\t]+/g, ' ').replace(/ {4,}/g, '   ') })),
      },
    ];
  }
  const r = await postMessage({ to: recipient, type: 'template', template });
  if (!r.ok) {
    console.warn(`[WHATSAPP] template "${templateName}" failed to ${maskNumber(recipient)}: ${r.error}`);
    return { ok: false, error: r.error };
  }
  return { ok: true, messageIds: r.id ? [r.id] : [] };
}

/**
 * Sends a one-time code. With an approved AUTHENTICATION template (copy-code
 * button) it reaches any number; without one it falls back to free-form text,
 * which only delivers inside the recipient's 24h customer service window.
 */
export async function sendWhatsAppAuthCode(
  to: string,
  code: string,
  templateName: string = env('WHATSAPP_OTP_TEMPLATE'),
  languageCode: string = env('WHATSAPP_OTP_TEMPLATE_LANG') || env('WHATSAPP_TEMPLATE_LANG') || 'en_US'
): Promise<WhatsAppSendResult> {
  if (!isWhatsAppConfigured()) return { ok: false, error: notConfiguredError() };
  const recipient = normalizeWhatsAppNumber(to);
  if (!recipient) return { ok: false, error: 'No recipient' };

  if (!templateName) {
    return sendWhatsAppText(recipient, `Your Warden sign-in code is *${code}*. It expires in 5 minutes. Do not share it.`);
  }

  const r = await postMessage({
    to: recipient,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: code }] },
        // Authentication templates require the code again for the copy-code button.
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
      ],
    },
  });
  if (!r.ok) {
    console.warn(`[WHATSAPP] auth template "${templateName}" failed to ${maskNumber(recipient)}: ${r.error}`);
    return { ok: false, error: r.error };
  }
  return { ok: true, messageIds: r.id ? [r.id] : [] };
}

let cachedBusinessNumber: string | null = null;

/**
 * The business number users message (digits, for wa.me links): WHATSAPP_BUSINESS_NUMBER,
 * else the display number of WHATSAPP_PHONE_NUMBER_ID from the Graph API (cached).
 */
export async function getWhatsAppBusinessNumber(): Promise<string | null> {
  const fromEnv = normalizeWhatsAppNumber(env('WHATSAPP_BUSINESS_NUMBER'));
  if (fromEnv) return fromEnv;
  if (cachedBusinessNumber) return cachedBusinessNumber;
  if (!isWhatsAppConfigured()) return null;
  try {
    const res = await fetch(`${graphBase()}/${env('WHATSAPP_PHONE_NUMBER_ID')}?fields=display_phone_number`, {
      headers: { Authorization: `Bearer ${env('WHATSAPP_API_TOKEN')}` },
    });
    const body = (await res.json().catch(() => ({}))) as { display_phone_number?: string } & GraphErrorBody;
    if (!res.ok || !body.display_phone_number) {
      console.warn(`[WHATSAPP] could not look up the business number: ${body.error?.message ?? res.status}`);
      return null;
    }
    cachedBusinessNumber = normalizeWhatsAppNumber(body.display_phone_number);
    return cachedBusinessNumber;
  } catch (err) {
    console.warn(`[WHATSAPP] business number lookup failed: ${(err as Error).message}`);
    return null;
  }
}

/** Marks an inbound message as read (blue ticks). Best effort. */
export async function markWhatsAppRead(messageId: string): Promise<{ ok: boolean; error?: string }> {
  if (!isWhatsAppConfigured()) return { ok: false, error: notConfiguredError() };
  const r = await postMessage({ status: 'read', message_id: messageId });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/** Resolves a media ID to its short-lived URL and downloads it (auth required on both calls). */
export async function downloadWhatsAppMedia(mediaId: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  if (!isWhatsAppConfigured()) return null;
  const token = env('WHATSAPP_API_TOKEN');
  try {
    const metaRes = await fetch(`${graphBase()}/${encodeURIComponent(mediaId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!metaRes.ok) {
      console.warn(`[WHATSAPP] media lookup failed (${metaRes.status}) for ${mediaId}`);
      return null;
    }
    const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
    if (!meta.url) return null;
    const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
    if (!fileRes.ok) {
      console.warn(`[WHATSAPP] media download failed (${fileRes.status}) for ${mediaId}`);
      return null;
    }
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    return { buffer, mimeType: meta.mime_type || fileRes.headers.get('content-type') || 'application/octet-stream' };
  } catch (err) {
    console.warn(`[WHATSAPP] media download error for ${mediaId}: ${(err as Error).message}`);
    return null;
  }
}

export function maskNumber(n: string): string {
  const d = normalizeWhatsAppNumber(n);
  return d.length <= 4 ? '****' : `${'*'.repeat(d.length - 4)}${d.slice(-4)}`;
}
