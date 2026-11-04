import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertReadable, resolveInside } from '../src/jail.ts';

let tmp: string;
let ws: string;
let outside: string;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'warden-jail-'));
  ws = path.join(tmp, 'ws');
  outside = path.join(tmp, 'outside');
  fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'nope');
  fs.writeFileSync(path.join(ws, '.env'), 'KEY=1');
  fs.symlinkSync(outside, path.join(ws, 'escape'));
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(ws, 'link.txt'));
  fs.symlinkSync(path.join(ws, '.env'), path.join(ws, 'notes.txt'));
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('paths inside the workspace resolve, including new files', () => {
  assert.ok(resolveInside(ws, 'src/new-file.ts').endsWith(path.join('src', 'new-file.ts')));
});

test('absolute paths and .. traversal are refused', () => {
  assert.throws(() => resolveInside(ws, '/etc/passwd'));
  assert.throws(() => resolveInside(ws, '../outside/secret.txt'));
  assert.throws(() => resolveInside(ws, ''));
});

test('symlinks that point outside the workspace are refused, for reads and writes', () => {
  assert.throws(() => resolveInside(ws, 'link.txt'), /symlink/);
  assert.throws(() => resolveInside(ws, 'escape/secret.txt'), /symlink/);
  assert.throws(() => resolveInside(ws, 'escape/new-file.txt'), /symlink/);
});

test('secret files are refused, including through an innocent-looking symlink', () => {
  assert.throws(() => assertReadable('.env'));
  assert.throws(() => assertReadable('certs/server.pem'));
  assert.doesNotThrow(() => assertReadable('.env.example'));
  const real = resolveInside(ws, 'notes.txt');
  assert.throws(() => assertReadable(path.basename(real)));
});
