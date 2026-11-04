/**
 * Outbound URL guard for server-side fetches of user-supplied URLs (SEO audit).
 *
 * Blocks SSRF: only http/https, no credentials in the URL, and the hostname
 * must resolve exclusively to public addresses. Redirects are followed by hand
 * so every hop is re-checked.
 *
 * Known limit: the address is checked at lookup time; a DNS record that
 * changes between the check and the fetch (rebinding) is not covered.
 */
import { lookup } from 'node:dns/promises';
import net from 'node:net';

export class BlockedUrlError extends Error {}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const PRIVATE_V4: [string, number][] = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];

function isPrivateV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return PRIVATE_V4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (ipv4ToInt(base) & mask);
  });
}

/** True for loopback, private, link-local, unique-local, multicast, and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateV4(ip);
  if (!net.isIPv6(ip)) return true;
  const v6 = ip.toLowerCase();
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]);
  if (v6 === '::' || v6 === '::1') return true;
  const first = parseInt(v6.split(':')[0] || '0', 16);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (v6.startsWith('64:ff9b:')) return true; // NAT64 can reach internal v4
  return false;
}

type Resolver = (host: string) => Promise<string[]>;

const defaultResolver: Resolver = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((r) => r.address);

/** Throws BlockedUrlError unless the URL is http(s) and resolves only to public addresses. */
export async function assertPublicUrl(raw: string | URL, resolve: Resolver = defaultResolver): Promise<URL> {
  let url: URL;
  try {
    url = new URL(String(raw));
  } catch {
    throw new BlockedUrlError('Not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedUrlError('Only http and https URLs can be audited.');
  }
  if (url.username || url.password) {
    throw new BlockedUrlError('URLs with credentials are not allowed.');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new BlockedUrlError('That host is not publicly reachable.');
  }
  const addresses = net.isIP(host) ? [host] : await resolve(host).catch(() => [] as string[]);
  if (addresses.length === 0) {
    throw new BlockedUrlError(`Could not resolve ${host}.`);
  }
  if (addresses.some(isPrivateAddress)) {
    throw new BlockedUrlError('That host resolves to a private or internal address.');
  }
  return url;
}

/** fetch() for user-supplied URLs: validates the URL and every redirect hop. */
export async function guardedFetch(
  raw: string,
  init: RequestInit = {},
  options: { maxRedirects?: number; resolve?: Resolver } = {}
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 5;
  let current = await assertPublicUrl(raw, options.resolve);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await fetch(current, { ...init, redirect: 'manual' });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      current = await assertPublicUrl(new URL(location, current), options.resolve);
      continue;
    }
    return res;
  }
  throw new BlockedUrlError('Too many redirects.');
}
