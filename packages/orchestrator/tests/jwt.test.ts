import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signJwt, verifyJwt } from '../src/auth/jwt.js';

const SECRET = 'test-secret-not-real';

test('a signed token verifies and returns its claims', () => {
  const token = signJwt({ sub: 'user-1', phone: '', ver: 1 }, SECRET, 60);
  const claims = verifyJwt(token, SECRET);
  assert.ok(claims);
  assert.equal((claims as any).sub, 'user-1');
});

test('a token signed with another secret is rejected', () => {
  const token = signJwt({ sub: 'user-1', phone: '', ver: 1 }, 'other-secret', 60);
  assert.equal(verifyJwt(token, SECRET), null);
});

test('a tampered payload is rejected', () => {
  const [h, , s] = signJwt({ sub: 'user-1', phone: '', ver: 1 }, SECRET, 60).split('.');
  const forged = Buffer.from(JSON.stringify({ sub: 'admin', iat: 0, exp: 9_999_999_999 })).toString('base64url');
  assert.equal(verifyJwt(`${h}.${forged}.${s}`, SECRET), null);
});

test('an expired token is rejected', () => {
  const token = signJwt({ sub: 'user-1', phone: '', ver: 1 }, SECRET, -1);
  assert.equal(verifyJwt(token, SECRET), null);
});

test('malformed tokens are rejected', () => {
  for (const t of ['', 'abc', 'a.b', 'a.b.c.d']) assert.equal(verifyJwt(t, SECRET), null, t);
});
