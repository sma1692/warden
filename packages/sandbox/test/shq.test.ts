import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { shq } from '../src/SandboxManager.ts';

const echo = (v: string) => execFileSync('bash', ['-c', `printf %s ${shq(v)}`]).toString();

test('shq round-trips hostile values without executing them', () => {
  for (const v of ["main; rm -rf /", "a'b", '$(id)', '`id`', 'x && echo pwned', 'with space']) {
    assert.equal(echo(v), v);
  }
});
