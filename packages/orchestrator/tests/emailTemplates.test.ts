import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderBrandedEmailHtml,
  buildMimePayload,
  getWardenLogoPngBuffer,
  WARDEN_SURFACE_B,
} from '../src/auth/EmailSender.js';
import {
  renderNightlyAnalyticsEmailHtml,
} from '../src/cron/sesSender.ts';
import { collectNightlyMetrics } from '../src/cron/nightlyAnalytics.js';

describe('Warden Email Design System & Inline Logo (Shard 4)', () => {
  it('exports Dark Mode Surface B design system colors', () => {
    assert.equal(WARDEN_SURFACE_B.surfaceBg, '#0B121C');
    assert.equal(WARDEN_SURFACE_B.surfacePanel, '#0F1824');
    assert.equal(WARDEN_SURFACE_B.surfaceCard, '#0F1824');
    assert.equal(WARDEN_SURFACE_B.surfaceText, '#F5F0E6');
    assert.equal(WARDEN_SURFACE_B.surfaceAccent, '#C6A664');
  });

  it('provides a valid high-DPI Warden Logo PNG buffer', () => {
    const buf = getWardenLogoPngBuffer();
    assert.ok(Buffer.isBuffer(buf), 'Must return a Buffer');
    assert.ok(buf.length > 1000, 'Logo buffer should contain image data');
    // PNG magic numbers: 0x89 0x50 0x4E 0x47
    assert.equal(buf[0], 0x89);
    assert.equal(buf[1], 0x50);
    assert.equal(buf[2], 0x4e);
    assert.equal(buf[3], 0x47);
  });

  it('renders OTP/notification email with Surface B colors and cid:warden-logo', () => {
    const html = renderBrandedEmailHtml('Verification Code', 'Your OTP is 123456.', {
      otpCode: '123456',
    });

    assert.ok(html.includes('#0B121C'), 'Contains surface-bg');
    assert.ok(html.includes('#0F1824'), 'Contains surface-panel / surface-card');
    assert.ok(html.includes('#F5F0E6'), 'Contains surface-text');
    assert.ok(html.includes('#C6A664'), 'Contains surface-accent');
    assert.ok(html.includes('src="cid:warden-logo"'), 'Uses cid:warden-logo instead of external URL');
    assert.ok(!html.includes('warden-icon-192.png'), 'Does not use external icon URL');
  });

  it('renders nightly analytics email with Surface B colors and cid:warden-logo', async () => {
    const metrics = await collectNightlyMetrics();
    const html = renderNightlyAnalyticsEmailHtml(metrics);

    assert.ok(html.includes('#0B121C'), 'Contains surface-bg');
    assert.ok(html.includes('#0F1824'), 'Contains surface-panel');
    assert.ok(html.includes('#F5F0E6'), 'Contains surface-text');
    assert.ok(html.includes('#C6A664'), 'Contains surface-accent');
    assert.ok(html.includes('src="cid:warden-logo"'), 'Uses cid:warden-logo instead of external URL');
    assert.ok(!html.includes('warden-icon-192.png'), 'Does not use external icon URL');
  });

  it('builds multipart/related MIME with cid:warden-logo and multipart/alternative parts', () => {
    const mime = buildMimePayload({
      headerFrom: 'Warden <owner@warden.autos>',
      to: 'ceo@example.com',
      subject: 'Security Alert',
      bodyText: 'Plain text version',
      bodyHtml: '<h1>HTML version</h1><img src="cid:warden-logo"/>',
    });

    assert.ok(mime.includes('Content-Type: multipart/related'), 'Outer type is multipart/related');
    assert.ok(mime.includes('Content-Type: multipart/alternative'), 'Contains nested multipart/alternative');
    assert.ok(mime.includes('Content-ID: <warden-logo>'), 'Contains Content-ID: <warden-logo>');
    assert.ok(mime.includes('Content-Type: image/png; name="warden-logo.png"'), 'Contains image/png attachment');
    assert.ok(mime.includes('Content-Disposition: inline; filename="warden-logo.png"'), 'Contains inline disposition');
  });
});
