import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionGuard } from '../src/PermissionGuard.ts';

const check = (command: string) =>
  PermissionGuard.validateCommand({
    agentSlug: '@backend_dev',
    repoSlug: 'demo-repo',
    allowedRepos: ['demo-repo'],
    command,
    permissionTier: 'standard_autonomous',
  });

test('destructive and secret-dumping commands are blocked', () => {
  for (const cmd of ['rm -rf /', 'rm -rf ~', 'cat .env', 'head -n 5 .env.local', 'cat ~/.ssh/id_rsa', 'printenv', 'env | grep KEY', 'git push --force', ':(){ :|:& };:', 'mkfs.ext4 /dev/sda']) {
    assert.equal(check(cmd).allowed, false, cmd);
  }
});

test('routine build and test commands are allowed', () => {
  for (const cmd of ['npm run build', 'npm test', 'git status', 'ls -la src']) {
    assert.equal(check(cmd).allowed, true, cmd);
  }
});

test('commands against a repo outside the allowlist are refused', () => {
  const res = PermissionGuard.validateCommand({
    agentSlug: '@backend_dev',
    repoSlug: 'someone-elses-repo',
    allowedRepos: ['demo-repo'],
    command: 'npm run build',
  });
  assert.equal(res.allowed, false);
});

test('rm -rf variants against root or home are blocked, normal deletes are not', () => {
  for (const cmd of ['rm -rf /', 'rm -fr /', 'rm -rf / ', 'rm -r -f /', 'rm -rf ~/', 'rm -rf $HOME', 'rm -rf /*', 'rm -rf / && echo done']) {
    assert.equal(check(cmd).allowed, false, cmd);
  }
  for (const cmd of ['rm -rf dist', 'rm -rf ./build', 'rm -f /tmp/warden-cache.json']) {
    assert.equal(check(cmd).allowed, true, cmd);
  }
});

test('secret files are blocked across common readers, templates are not', () => {
  for (const cmd of ['cat .env', 'head -n 5 .env.local', 'tail config/.env.production', 'base64 .env', 'cp .env /tmp/x', 'grep KEY "./.env"', 'cat certs/server.pem']) {
    assert.equal(check(cmd).allowed, false, cmd);
  }
  for (const cmd of ['cat .env.example', 'cat README.md', 'grep -r environment src']) {
    assert.equal(check(cmd).allowed, true, cmd);
  }
});
