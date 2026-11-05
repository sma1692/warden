/**
 * Minimal dependency-free SMTP sender for email OTP codes and branded HTML
 * notifications. Works with any provider that takes a username + app password
 * over TLS (GSuite, Outlook, Resend, Brevo, Zoho included): implicit TLS on 465,
 * STARTTLS upgrade on 587.
 *
 * Env: SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS,
 * SMTP_FROM (default "Warden Automatons <SMTP_USER>"), SMTP_SECURE (true forces implicit TLS).
 */
import net from 'node:net';
import tls from 'node:tls';

export interface EmailRenderOptions {
  badge?: string;
  heading?: string;
  otpCode?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footerNote?: string;
}

export function isEmailConfigured(): boolean {
  return Boolean(
    (process.env.SMTP_HOST || '').trim() &&
      (process.env.SMTP_USER || '').trim() &&
      (process.env.SMTP_PASS || '').trim()
  );
}

function smtpPort(): number {
  const raw = Number(process.env.SMTP_PORT);
  return Number.isFinite(raw) && raw > 0 ? raw : 587;
}

function smtpSecure(port: number): boolean {
  const flag = (process.env.SMTP_SECURE || '').trim().toLowerCase();
  if (flag === 'true' || flag === '1') return true;
  if (flag === 'false' || flag === '0') return false;
  return port === 465;
}

function resolveFromAddress(rawFrom: string, user: string): { headerFrom: string; envelopeFrom: string } {
  const cleaned = (rawFrom || user).replace(/[\r\n]+/g, ' ').trim();
  const angleMatch = cleaned.match(/<([^>]+)>/);
  if (angleMatch) {
    return {
      headerFrom: cleaned,
      envelopeFrom: angleMatch[1].trim(),
    };
  }
  return {
    headerFrom: `Warden Automatons <${cleaned}>`,
    envelopeFrom: cleaned,
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatInlineHtml(text: string): string {
  let out = escapeHtml(text);
  // Highlight @agent handles
  out = out.replace(
    /(^|[\s(])(@[a-zA-Z0-9_]+)/g,
    '$1<span style="color:#22d3ee;font-weight:600;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;">$2</span>'
  );
  // Inline `code`
  out = out.replace(
    /`([^`]+)`/g,
    '<code style="background:#0f172a;border:1px solid #1e293b;color:#67e8f9;padding:2px 6px;border-radius:4px;font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;">$1</code>'
  );
  // Bold **text**
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong style="color:#f8fafc;font-weight:600;">$1</strong>');
  // Auto-link https:// URLs
  out = out.replace(
    /(https?:\/\/[^\s<)]+)/g,
    '<a href="$1" style="color:#22d3ee;text-decoration:underline;">$1</a>'
  );
  return out;
}

export function renderBrandedEmailHtml(
  subject: string,
  bodyText: string,
  options?: EmailRenderOptions
): string {
  const appUrl = (process.env.PUBLIC_APP_URL || 'https://warden.autos').replace(/\/+$/, '');
  const logoUrl = `${appUrl}/warden-icon-192.png`;
  const heading = options?.heading || subject.replace(/^\[Warden\]\s*/i, '');
  const badge = options?.badge || (options?.otpCode ? 'SECURITY · SIGN-IN' : 'WARDEN AUTOMATONS');
  const ctaLabel = options?.ctaLabel || (options?.otpCode ? undefined : 'Open Warden Command Center');
  const ctaUrl = options?.ctaUrl || appUrl;

  const paragraphs = bodyText
    .trim()
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block
        .split(/\r?\n/)
        .map((line) => formatInlineHtml(line.trim()))
        .join('<br/>');
      return `<p style="margin:0 0 16px 0;color:#cbd5e1;font-size:15px;line-height:1.65;">${lines}</p>`;
    })
    .join('');

  const otpBlock = options?.otpCode
    ? `<div style="margin:24px 0;padding:22px 16px;background:#060911;border:1px solid #164e63;border-radius:12px;text-align:center;">
         <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#67e8f9;margin-bottom:8px;font-weight:600;">One-Time Verification Code</div>
         <div style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:34px;font-weight:700;letter-spacing:0.28em;color:#f8fafc;padding-left:0.28em;">${escapeHtml(options.otpCode)}</div>
         <div style="font-size:12px;color:#64748b;margin-top:10px;">Expires in 5 minutes · Do not share this code</div>
       </div>`
    : '';

  const ctaBlock = ctaLabel
    ? `<div style="margin:26px 0 8px 0;">
         <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:linear-gradient(135deg,#06b6d4 0%,#10b981 100%);color:#060911;font-weight:700;font-size:14px;text-decoration:none;padding:12px 22px;border-radius:10px;letter-spacing:0.02em;">
           ${escapeHtml(ctaLabel)} &rarr;
         </a>
       </div>`
    : '';

  const footerNote =
    options?.footerNote ||
    'Autonomous AI Workforce OS · Copilots for humans, agent hierarchies for teams.';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#060911;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#f1f5f9;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#060911;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background-color:#0b1120;border:1px solid #1e293b;border-radius:16px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,0.6);">
          <!-- Top accent gradient bar -->
          <tr>
            <td style="height:4px;background:linear-gradient(90deg,#06b6d4 0%,#6366f1 50%,#10b981 100%);font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <!-- Brand Header -->
          <tr>
            <td style="padding:28px 32px 20px 32px;border-bottom:1px solid #1e293b;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td width="44" valign="middle">
                    <a href="${escapeHtml(appUrl)}" style="text-decoration:none;display:inline-block;">
                      <img src="${escapeHtml(logoUrl)}" alt="Warden" width="38" height="38" style="display:block;border-radius:10px;border:1px solid #164e63;background:#060911;" />
                    </a>
                  </td>
                  <td valign="middle" style="padding-left:12px;">
                    <div style="font-size:16px;font-weight:700;letter-spacing:0.04em;color:#f8fafc;">WARDEN AUTOMATONS</div>
                    <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#22d3ee;margin-top:2px;">AI Workforce Command Center</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Main Content -->
          <tr>
            <td style="padding:28px 32px 32px 32px;">
              <div style="display:inline-block;padding:4px 10px;background:#083344;border:1px solid #155e75;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#67e8f9;margin-bottom:14px;">
                ${escapeHtml(badge)}
              </div>
              <h1 style="margin:0 0 18px 0;font-size:21px;line-height:1.35;font-weight:700;color:#f8fafc;">
                ${escapeHtml(heading)}
              </h1>
              ${paragraphs}
              ${otpBlock}
              ${ctaBlock}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;background-color:#060911;border-top:1px solid #1e293b;">
              <p style="margin:0 0 6px 0;font-size:12px;color:#64748b;line-height:1.5;">
                ${escapeHtml(footerNote)}
              </p>
              <p style="margin:0;font-size:12px;color:#475569;">
                <a href="${escapeHtml(appUrl)}" style="color:#22d3ee;text-decoration:none;font-weight:500;">warden.autos</a>
                &nbsp;&middot;&nbsp; Sent by @warden Executive OS
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Dot-stuffs lines starting with `.` per RFC 5321 Section 4.5.2. */
function dotStuff(raw: string): string {
  return raw
    .replace(/\r?\n/g, '\r\n')
    .replace(/^\./gm, '..');
}

function buildMimePayload(params: {
  headerFrom: string;
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
}): string {
  const boundary = `warden_mime_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const textB64 = Buffer.from(params.bodyText.replace(/\r?\n/g, '\r\n'), 'utf8')
    .toString('base64')
    .replace(/(.{76})/g, '$1\r\n');
  const htmlB64 = Buffer.from(params.bodyHtml, 'utf8')
    .toString('base64')
    .replace(/(.{76})/g, '$1\r\n');

  const lines = [
    `From: ${params.headerFrom}`,
    `To: ${params.to}`,
    `Subject: =?UTF-8?B?${Buffer.from(params.subject, 'utf8').toString('base64')}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    textB64,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    htmlB64,
    ``,
    `--${boundary}--`,
    ``,
  ];

  return dotStuff(lines.join('\r\n'));
}

interface LineSocket {
  send(line: string): Promise<void>;
  read(): Promise<string>;
  close(): void;
}

function wrapSocket(socket: net.Socket): LineSocket {
  let buffer = '';
  const waiters: Array<(line: string) => void> = [];
  const lines: string[] = [];
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    let idx = buffer.indexOf('\r\n');
    while (idx >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const waiter = waiters.shift();
      if (waiter) waiter(line);
      else lines.push(line);
      idx = buffer.indexOf('\r\n');
    }
  });
  return {
    send: (line: string) => new Promise((resolve, reject) => socket.write(`${line}\r\n`, (err) => (err ? reject(err) : resolve()))),
    read: () =>
      new Promise((resolve, reject) => {
        const queued = lines.shift();
        if (queued !== undefined) {
          resolve(queued);
          return;
        }
        const timer = setTimeout(() => reject(new Error('SMTP read timeout')), 15000);
        waiters.push((line) => {
          clearTimeout(timer);
          resolve(line);
        });
      }),
    close: () => socket.destroy(),
  };
}

/** Reads a full SMTP reply, following `250-...` continuations to the final line. */
async function readReply(conn: LineSocket): Promise<{ code: number; text: string }> {
  let text = '';
  for (;;) {
    const line = await conn.read();
    text += `${line}\n`;
    if (/^\d{3} /.test(line)) return { code: Number(line.slice(0, 3)), text };
    if (!/^\d{3}-/.test(line)) return { code: Number(line.slice(0, 3)) || 0, text };
  }
}

async function expectOk(conn: LineSocket, command: string): Promise<string> {
  await conn.send(command);
  const reply = await readReply(conn);
  if (reply.code < 200 || reply.code >= 400) throw new Error(`SMTP ${command.split(' ')[0]} failed (${reply.code})`);
  return reply.text;
}

export async function sendEmailMessage(
  to: string,
  subject: string,
  bodyText: string,
  options?: EmailRenderOptions
): Promise<{ ok: true } | { ok: false; error: string }> {
  const host = (process.env.SMTP_HOST || '').trim();
  const user = (process.env.SMTP_USER || '').trim();
  const pass = process.env.SMTP_PASS || '';
  const { headerFrom, envelopeFrom } = resolveFromAddress(process.env.SMTP_FROM || '', user);
  if (!host || !user || !pass) {
    console.log(`[EMAIL NOTIFY (dev log)] To=${to} | Subject="${subject}" | Body="${bodyText.replace(/\r?\n/g, ' ').slice(0, 140)}"`);
    return { ok: false, error: 'SMTP is not configured (SMTP_HOST/SMTP_USER/SMTP_PASS).' };
  }

  const port = smtpPort();
  const secure = smtpSecure(port);
  let raw: net.Socket;
  try {
    raw = secure
      ? tls.connect({ host, port, timeout: 15000 })
      : await new Promise<net.Socket>((resolve, reject) => {
          const s = net.connect({ host, port, timeout: 15000 }, () => resolve(s));
          s.once('error', reject);
          s.once('timeout', () => reject(new Error('SMTP connect timeout')));
        });
  } catch (err) {
    return { ok: false, error: `Could not reach SMTP ${host}:${port}.` };
  }

  const safeSubject = subject.replace(/[\r\n]+/g, ' ').trim();
  const htmlBody = renderBrandedEmailHtml(safeSubject, bodyText, options);
  const mimePayload = buildMimePayload({
    headerFrom,
    to,
    subject: safeSubject,
    bodyText,
    bodyHtml: htmlBody,
  });

  const conn = wrapSocket(raw);
  try {
    const greeting = await readReply(conn);
    if (greeting.code !== 220) throw new Error(`SMTP greeting failed (${greeting.code})`);
    const ehlo = await expectOk(conn, `EHLO warden.autos`);
    if (!secure && /STARTTLS/i.test(ehlo)) {
      await expectOk(conn, 'STARTTLS');
      const upgraded = tls.connect({ socket: raw, host, timeout: 15000 });
      await new Promise<void>((resolve, reject) => {
        upgraded.once('secureConnect', () => resolve());
        upgraded.once('error', reject);
      });
      const tlsConn = wrapSocket(upgraded);
      await expectOk(tlsConn, 'EHLO warden.autos');
      await expectOk(tlsConn, 'AUTH LOGIN');
      await expectOk(tlsConn, Buffer.from(user, 'utf8').toString('base64'));
      await expectOk(tlsConn, Buffer.from(pass, 'utf8').toString('base64'));
      await expectOk(tlsConn, `MAIL FROM:<${envelopeFrom}>`);
      await expectOk(tlsConn, `RCPT TO:<${to}>`);
      await expectOk(tlsConn, 'DATA');
      await tlsConn.send(`${mimePayload}\r\n.`);
      await readReply(tlsConn).then((r) => {
        if (r.code !== 250) throw new Error(`SMTP DATA failed (${r.code})`);
      });
      await tlsConn.send('QUIT').catch(() => undefined);
      tlsConn.close();
      return { ok: true };
    }
    if (!secure) throw new Error('SMTP server refused STARTTLS; set SMTP_SECURE=true with port 465 instead.');
    await expectOk(conn, 'AUTH LOGIN');
    await expectOk(conn, Buffer.from(user, 'utf8').toString('base64'));
    await expectOk(conn, Buffer.from(pass, 'utf8').toString('base64'));
    await expectOk(conn, `MAIL FROM:<${envelopeFrom}>`);
    await expectOk(conn, `RCPT TO:<${to}>`);
    await expectOk(conn, 'DATA');
    await conn.send(`${mimePayload}\r\n.`);
    const dataReply = await readReply(conn);
    if (dataReply.code !== 250) throw new Error(`SMTP DATA failed (${dataReply.code})`);
    await conn.send('QUIT').catch(() => undefined);
    conn.close();
    return { ok: true };
  } catch (err) {
    conn.close();
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

export async function sendEmailCode(to: string, code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return sendEmailMessage(
    to,
    'Your Warden Automatons sign-in code',
    `Enter the verification code below to sign in to your Warden Automatons workspace.\n\nIf you didn't request this code, you can safely ignore this email.`,
    {
      badge: 'SECURITY · SIGN-IN OTP',
      heading: 'Sign in to Warden Automatons',
      otpCode: code,
    }
  );
}
