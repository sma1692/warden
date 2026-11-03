/**
 * Minimal dependency-free SMTP sender for email OTP codes. Works with any
 * provider that takes a username + app password over TLS (GSuite and Outlook
 * included): implicit TLS on 465, STARTTLS upgrade on 587.
 *
 * Env: SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS,
 * SMTP_FROM (default SMTP_USER), SMTP_SECURE (true forces implicit TLS).
 */
import net from 'node:net';
import tls from 'node:tls';

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

export async function sendEmailCode(to: string, code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const host = (process.env.SMTP_HOST || '').trim();
  const user = (process.env.SMTP_USER || '').trim();
  const pass = process.env.SMTP_PASS || '';
  const from = (process.env.SMTP_FROM || user).trim();
  if (!host || !user || !pass) return { ok: false, error: 'SMTP is not configured (SMTP_HOST/SMTP_USER/SMTP_PASS).' };

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

  const conn = wrapSocket(raw);
  try {
    const greeting = await readReply(conn);
    if (greeting.code !== 220) throw new Error(`SMTP greeting failed (${greeting.code})`);
    let ehlo = await expectOk(conn, `EHLO warden`);
    if (!secure && /STARTTLS/i.test(ehlo)) {
      await expectOk(conn, 'STARTTLS');
      const upgraded = tls.connect({ socket: raw, host, timeout: 15000 });
      await new Promise<void>((resolve, reject) => {
        upgraded.once('secureConnect', () => resolve());
        upgraded.once('error', reject);
      });
      const tlsConn = wrapSocket(upgraded);
      await expectOk(tlsConn, 'EHLO warden');
      await expectOk(tlsConn, 'AUTH LOGIN');
      await expectOk(tlsConn, Buffer.from(user, 'utf8').toString('base64'));
      await expectOk(tlsConn, Buffer.from(pass, 'utf8').toString('base64'));
      await expectOk(tlsConn, `MAIL FROM:<${from}>`);
      await expectOk(tlsConn, `RCPT TO:<${to}>`);
      await expectOk(tlsConn, 'DATA');
      const body =
        `From: ${from}\r\nTo: ${to}\r\nSubject: Your Warden sign-in code\r\n` +
        `Content-Type: text/plain; charset=utf-8\r\n\r\n` +
        `Your Warden sign-in code is: ${code}\r\nIt expires in 5 minutes.\r\n`;
      await tlsConn.send(body + '\r\n.');
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
    await expectOk(conn, `MAIL FROM:<${from}>`);
    await expectOk(conn, `RCPT TO:<${to}>`);
    await expectOk(conn, 'DATA');
    const body =
      `From: ${from}\r\nTo: ${to}\r\nSubject: Your Warden sign-in code\r\n` +
      `Content-Type: text/plain; charset=utf-8\r\n\r\n` +
      `Your Warden sign-in code is: ${code}\r\nIt expires in 5 minutes.\r\n`;
    await conn.send(body + '\r\n.');
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
