/**
 * Minimal HS256 JWT (RFC 7519) with node:crypto, no dependency.
 */
import crypto from 'node:crypto';

export interface JwtClaims {
  /** User id. */
  sub: string;
  phone: string;
  /** Token version; bumping the user's version revokes older tokens. */
  ver: number;
  iat: number;
  exp: number;
}

const b64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');
const HEADER = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

function signature(data: string, secret: string): Buffer {
  return crypto.createHmac('sha256', secret).update(data).digest();
}

export function signJwt(claims: Omit<JwtClaims, 'iat' | 'exp'>, secret: string, ttlSec: number): string {
  const iat = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ ...claims, iat, exp: iat + ttlSec }));
  const data = `${HEADER}.${payload}`;
  return `${data}.${b64url(signature(data, secret))}`;
}

/** Returns the claims when the signature, header and expiry are valid; otherwise null. */
export function verifyJwt(token: string, secret: string): JwtClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== HEADER) return null;
  const expected = signature(`${parts[0]}.${parts[1]}`, secret);
  const given = Buffer.from(parts[2], 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as JwtClaims;
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) return null;
    if (typeof claims.sub !== 'string' || typeof claims.ver !== 'number') return null;
    return claims;
  } catch {
    return null;
  }
}
