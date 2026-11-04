// ============================================================================
// Local dev HTTPS helpers — shared by the API server and the Vite dev server.
// Generates (once) and loads a self-signed cert with localhost + LAN SANs so a
// phone on the same Wi-Fi can open the dashboard over HTTPS. Dev only: certs
// live in gitignored `.state/certs/`.
// Keep this module dependency-free (node builtins only): it is also imported
// by `packages/web/vite.config.ts`.
// ============================================================================

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface DevTlsCredentials {
  key: Buffer;
  cert: Buffer;
  keyPath: string;
  certPath: string;
}

/** First non-internal IPv4 address (the URL a phone on the same Wi-Fi uses). */
export function getLanIp(): string | null {
  const nets = os.networkInterfaces();
  for (const addrs of Object.values(nets)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      const rawFamily = (addr as { family: string | number }).family;
      const family =
        typeof rawFamily === 'string' ? rawFamily : `IPv${rawFamily}`;
      if (family === 'IPv4' && !addr.internal && addr.address) {
        return addr.address;
      }
    }
  }
  return null;
}

/** HTTPS is enabled by default in local dev; production `start` stays plain HTTP unless opted in. */
export function isHttpsEnabled(): boolean {
  const raw = (process.env.WARDEN_HTTPS ?? '').trim().toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'no') return false;
  if (raw === 'true' || raw === '1' || raw === 'yes') return true;
  return process.env.NODE_ENV !== 'production' && process.env.WARDEN_CLOUD !== 'true';
}

/** Walk up from `startDir` to the monorepo root (owns `.state/certs/`). */
export function resolveWardenRoot(startDir?: string): string {
  let cur = startDir ?? process.cwd();
  for (let i = 0; i < 8; i++) {
    if (
      fs.existsSync(path.join(cur, 'packages', 'orchestrator', 'package.json')) &&
      fs.existsSync(path.join(cur, 'packages', 'web', 'package.json'))
    ) {
      return cur;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return startDir ?? process.cwd();
}

/**
 * Load the shared local dev cert, generating it with openssl on first run.
 * SANs cover localhost, 127.0.0.1, the machine hostname, and the current LAN IP.
 * Returns null when openssl is unavailable (callers fall back to HTTP).
 */
export function ensureDevCerts(startDir?: string): DevTlsCredentials | null {
  const root = resolveWardenRoot(startDir);
  const dir = path.join(root, '.state', 'certs');
  const keyPath = path.join(dir, 'local-key.pem');
  const certPath = path.join(dir, 'local-cert.pem');
  try {
    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
      return {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
        keyPath,
        certPath,
      };
    }
    fs.mkdirSync(dir, { recursive: true });

    // Best-effort cross-process lock: API and web boot together and both call
    // this on a cold `.state/certs/`; only one should run openssl.
    const lockPath = path.join(dir, '.generating.lock');
    let haveLock = false;
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      haveLock = true;
    } catch {
      for (let i = 0; i < 50; i++) {
        if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
          try {
            return {
              key: fs.readFileSync(keyPath),
              cert: fs.readFileSync(certPath),
              keyPath,
              certPath,
            };
          } catch {
            // Partial write: keep waiting.
          }
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
      }
      // Timed out (stale lock): break it and generate ourselves.
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // ignore
      }
      try {
        fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
        haveLock = true;
      } catch {
        return null;
      }
    }

    try {
      const lanIp = getLanIp();
      const shortHost = (os.hostname() || 'localhost').split('.')[0];
      const sans = ['DNS:localhost', 'DNS:warden.local', 'IP:127.0.0.1'];
      if (shortHost && shortHost !== 'localhost') sans.push(`DNS:${shortHost}`);
      if (lanIp) sans.push(`IP:${lanIp}`);
      // Config-file SANs work on both OpenSSL and macOS LibreSSL (no -addext needed).
      const cnfPath = path.join(dir, 'openssl-local.cnf');
      fs.writeFileSync(
        cnfPath,
        `[req]\ndistinguished_name=dn\nreq_extensions=v3_req\nprompt=no\n[dn]\nCN=warden.local\n[v3_req]\nsubjectAltName=${sans.join(',')}\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n`
      );
      const result = spawnSync(
        'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-keyout',
          keyPath,
          '-out',
          certPath,
          '-days',
          '825',
          '-nodes',
          '-config',
          cnfPath,
          '-extensions',
          'v3_req',
        ],
        { stdio: 'pipe' }
      );
      try {
        fs.unlinkSync(cnfPath);
      } catch {
        // ignore cleanup errors
      }
      if (result.status !== 0 || !fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
        const detail =
          result.stderr?.toString().trim() ||
          result.error?.message ||
          'unknown error';
        console.warn(
          `[DEV TLS] openssl cert generation failed (${detail}); HTTPS disabled for this run.`
        );
        return null;
      }
      try {
        fs.chmodSync(keyPath, 0o600);
      } catch {
        // ignore on filesystems without posix perms
      }
      console.log(
        `[DEV TLS] Generated shared dev cert (${sans.join(', ')}) at ${certPath}`
      );
      return {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
        keyPath,
        certPath,
      };
    } finally {
      if (haveLock) {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // ignore
        }
      }
    }
  } catch (err) {
    console.warn(
      '[DEV TLS] Could not load or generate dev certs; HTTPS disabled for this run.',
      err
    );
    return null;
  }
}
