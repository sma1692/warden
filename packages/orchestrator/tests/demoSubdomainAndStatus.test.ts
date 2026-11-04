import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUniqueSubdomain,
  getDemoSubdomainFqdn,
  getDemoSubdomainUrl,
  resolveDemoSubdomain,
  spawnDemoPath,
  deployDemoPath,
  DEMO_BASE_DOMAIN,
} from '../src/server/routes/demoSubdomain.js';
import {
  getDemoMetadata,
  recordDeployment,
  incrementDemoVersion,
  resetDemoMetadata,
} from '../src/handlers/demoStatus.js';

describe('Demo Subdomain & Demo Status', () => {
  beforeEach(() => {
    resetDemoMetadata();
  });

  it('builds unique subdomain adhering to <unique-subdomain>.pages.dev', () => {
    const userId = 'user-12345678-abcd';
    const subdomain = buildUniqueSubdomain(userId, 'demo-arena');
    assert.ok(subdomain.startsWith('uuser1234'));
    assert.ok(subdomain.includes('arena'));

    const fqdn = getDemoSubdomainFqdn(subdomain);
    assert.equal(fqdn, `${subdomain}.pages.dev`);

    const url = getDemoSubdomainUrl(subdomain);
    assert.equal(url, `https://${subdomain}.pages.dev`);

    const resolved = resolveDemoSubdomain(userId);
    assert.equal(resolved.subdomain, subdomain);
    assert.equal(resolved.fqdn, `${subdomain}.pages.dev`);
    assert.equal(resolved.url, `https://${subdomain}.pages.dev`);
  });

  it('handles custom subdomains while enforcing .pages.dev', () => {
    const custom = 'my-custom-game';
    const fqdn = getDemoSubdomainFqdn(custom);
    assert.equal(fqdn, 'my-custom-game.pages.dev');

    const resolved = resolveDemoSubdomain('any-user', 'arena', 'my-custom-game.pages.dev');
    assert.equal(resolved.subdomain, 'my-custom-game');
    assert.equal(resolved.fqdn, 'my-custom-game.pages.dev');
    assert.equal(resolved.url, 'https://my-custom-game.pages.dev');
  });

  it('spawns demo path with unique subdomain', async () => {
    const userId = 'spawn-test-user-1';
    const res = await spawnDemoPath(userId, { gameId: 'arena' });
    assert.equal(res.ok, true);
    assert.ok(res.subdomain.length > 0);
    assert.equal(res.fqdn, `${res.subdomain}.pages.dev`);
    assert.equal(res.url, `https://${res.subdomain}.pages.dev`);
    assert.ok(res.localDir.includes(userId));
    assert.equal(res.metadata.version, 'v1');
    assert.equal(res.metadata.versionNumber, 1);
  });

  it('getDemoMetadata returns incremented version numbers (v1, v2) and update timestamp when deployed', () => {
    const userId = 'deploy-user-99';

    // Initial check before deployment
    const initialMeta = getDemoMetadata(userId);
    assert.equal(initialMeta.version, 'v1');
    assert.equal(initialMeta.versionNumber, 1);
    assert.ok(initialMeta.updatedAt);
    assert.equal(initialMeta.lastDeployedAt, null);

    // Deploy 1 (e.g. initial version deploy)
    const deploy1Time = new Date().toISOString();
    const deployed1 = recordDeployment(userId, {
      deployUrl: 'https://demo-user-1.warden.autos',
      status: 'ACTIVE',
    });
    assert.equal(deployed1.version, 'v1');
    assert.equal(deployed1.versionNumber, 1);
    assert.ok(deployed1.lastDeployedAt);
    assert.ok(deployed1.updatedAt);

    const metaAfter1 = getDemoMetadata(userId);
    assert.equal(metaAfter1.version, 'v1');
    assert.equal(metaAfter1.status, 'ACTIVE');

    // Deploy 2 (new version deployed -> increments v1 to v2)
    const deployed2 = recordDeployment(userId, {
      deployUrl: 'https://demo-user-1.warden.autos',
      status: 'ACTIVE',
    });
    assert.equal(deployed2.version, 'v2');
    assert.equal(deployed2.versionNumber, 2);
    assert.ok(deployed2.updatedAt);
    assert.ok(deployed2.timestamp >= initialMeta.timestamp);

    const metaAfter2 = getDemoMetadata(userId);
    assert.equal(metaAfter2.version, 'v2');
    assert.equal(metaAfter2.versionNumber, 2);

    // Deploy 3 (new version deployed -> increments v2 to v3)
    const deployed3 = recordDeployment(userId);
    assert.equal(deployed3.version, 'v3');
    assert.equal(deployed3.versionNumber, 3);
  });

  it('incrementDemoVersion directly increments version and updates timestamp', () => {
    const userId = 'increment-user-42';
    const initial = getDemoMetadata(userId);
    assert.equal(initial.version, 'v1');

    const next = incrementDemoVersion(userId);
    assert.equal(next.version, 'v2');
    assert.equal(next.versionNumber, 2);
    assert.ok(next.updatedAt);

    const nextMeta = getDemoMetadata(userId);
    assert.equal(nextMeta.version, 'v2');
    assert.equal(nextMeta.updatedAt, next.updatedAt);
  });
});
