import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import test from 'node:test';
import { sendOtpEmail } from '../src/services/brevoService.js';
import { sanitizeLogValue } from '../src/utils/logger.js';

test('bootstrap does not reinstall the known vulnerable WooCommerce 9.5.0 release', () => {
  const installer = readFileSync(new URL('../../../docker/wp-init.sh', import.meta.url), 'utf8');
  const pinned = /wp plugin install woocommerce\s+--version=9\.5\.0(?:\s|$)/.test(installer);
  assert.equal(pinned, false);
});

test('upstream error sanitization removes credential-bearing HTTP header values', () => {
  const marker = 'synthetic-marker';
  const clean = sanitizeLogValue({ headers: { 'api-key': marker } });
  assert.equal(JSON.stringify(clean).includes(marker), false);
});

test('the installer requires an explicitly supplied initial WordPress admin password', () => {
  const installer = readFileSync(new URL('../../../docker/wp-init.sh', import.meta.url), 'utf8');
  const hasLiteralFallback = /\$\{WP_ADMIN_PASSWORD:-[^}\s$]+\}/.test(installer);
  assert.equal(hasLiteralFallback, false);
});

test('mock verification mail logs omit recipient and code fragments', async (t) => {
  t.mock.method(console, 'log', () => {});
  const before = { NODE_ENV: process.env.NODE_ENV, MOCK_EMAIL: process.env.MOCK_EMAIL };
  t.after(() => {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  process.env.NODE_ENV = 'test';
  process.env.MOCK_EMAIL = 'true';
  const toEmail = 'security-fixture@example.invalid';
  const otp = String(randomInt(100000, 1000000));
  const result = await sendOtpEmail({ toEmail, otp });
  assert.equal(result.mock, true);
  const output = console.log.mock.calls.flatMap(call => call.arguments).join(' ');
  assert.equal(output.includes(toEmail), false, 'recipient appeared in logs');
  assert.equal(output.includes(otp) || output.includes(`****${otp.slice(-2)}`), false, 'code material appeared in logs');
});

test('httpAgent enforces TLS certificate verification by default', async () => {
  const { httpsAgent, mediaHttpsAgent } = await import('../src/config/httpAgent.js');
  assert.equal(httpsAgent.options.rejectUnauthorized, true);
  assert.equal(mediaHttpsAgent.options.rejectUnauthorized, true);
});

test('mediaRoutes proxy disables upstream redirects', () => {
  const mediaSource = readFileSync(new URL('../src/routes/mediaRoutes.js', import.meta.url), 'utf8');
  assert.match(mediaSource, /maxRedirects:\s*0/);
});

test('docker-compose defaults to production mode, loopback bindings, and forwards VAPID keys', () => {
  const compose = readFileSync(new URL('../../../docker/docker-compose.yml', import.meta.url), 'utf8');
  assert.equal(/NODE_ENV:\s*development/.test(compose), false);
  assert.equal(/AdminDevPass123!/.test(compose), false);
  assert.match(compose, /VAPID_PUBLIC_KEY:/);
  assert.match(compose, /VAPID_PRIVATE_KEY:/);
  assert.match(compose, /127\.0\.0\.1:5000/);
  assert.match(compose, /127\.0\.0\.1:8085/);
});

test('woocommerce config uses Basic Auth for internal http://wordpress in production instead of broken OAuth', () => {
  const wooSource = readFileSync(new URL('../src/config/woocommerce.js', import.meta.url), 'utf8');
  assert.match(wooSource, /isInternalHttpOrigin/);
  assert.match(wooSource, /allowInternalHttpBasicAuth/);
  assert.match(wooSource, /queryStringAuth:\s*false/);
});
