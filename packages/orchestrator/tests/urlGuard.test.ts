import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  BlockedUrlError,
  assertPublicUrl,
  guardedFetch,
  isPrivateAddress,
} from '../src/seo/urlGuard.js';

const resolveTo = (map: Record<string, string[]>) => async (host: string) => map[host] ?? [];
const publicDns = resolveTo({ 'example.com': ['93.184.216.34'], 'evil.test': ['10.0.0.5'] });

test('isPrivateAddress covers private, loopback, link-local, and mapped ranges', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test('assertPublicUrl rejects non-http schemes, credentials, and internal hosts', async () => {
  const bad = [
    'file:///etc/passwd',
    'ftp://example.com/',
    'http://user:pass@example.com/',
    'http://localhost:4000/api',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://evil.test/',
    'http://db.internal/',
  ];
  for (const url of bad) {
    await assert.rejects(assertPublicUrl(url, publicDns), BlockedUrlError, url);
  }
});

test('assertPublicUrl allows a public host', async () => {
  const url = await assertPublicUrl('https://example.com/pricing', publicDns);
  assert.equal(url.hostname, 'example.com');
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('guardedFetch re-checks redirects and blocks a hop to an internal address', async () => {
  globalThis.fetch = (async () =>
    new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/' } })) as typeof fetch;
  await assert.rejects(guardedFetch('https://example.com/', {}, { resolve: publicDns }), BlockedUrlError);
});

test('guardedFetch follows a public redirect and returns the final response', async () => {
  const seen: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    seen.push(String(input));
    return seen.length === 1
      ? new Response(null, { status: 301, headers: { location: '/final' } })
      : new Response('ok', { status: 200 });
  }) as typeof fetch;
  const res = await guardedFetch('https://example.com/start', {}, { resolve: publicDns });
  assert.equal(res.status, 200);
  assert.deepEqual(seen, ['https://example.com/start', 'https://example.com/final']);
});
