// Admin site settings: the API origin is validated, production refuses local or placeholder addresses, and /config.js
// exposes only the public API origin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createAdminServer, loadAdminConfig } from '../server.mjs';

test('development accepts a local API and defaults to no HSTS', () => {
  const c = loadAdminConfig({ ADMIN_API_ORIGIN: 'http://localhost:8080' });
  assert.equal(c.apiOrigin, 'http://localhost:8080');
  assert.equal(c.production, false);
  assert.equal(c.hsts, false);
  assert.equal(c.port, 8081);
});

test('production needs a public https API origin and turns HSTS on', () => {
  const env = { NODE_ENV: 'production' };
  assert.throws(() => loadAdminConfig(env), /set ADMIN_API_ORIGIN/);
  assert.throws(() => loadAdminConfig({ ...env, ADMIN_API_ORIGIN: 'http://localhost:8080' }), /not a local address/);
  assert.throws(() => loadAdminConfig({ ...env, ADMIN_API_ORIGIN: 'https://api.YOUR_DOMAIN' }), /placeholder/);
  assert.throws(() => loadAdminConfig({ ...env, ADMIN_API_ORIGIN: 'http://api.example.test' }), /https/);
  const c = loadAdminConfig({ ...env, ADMIN_API_ORIGIN: 'https://API.example.test/' });
  assert.equal(c.apiOrigin, 'https://api.example.test');
  assert.equal(c.hsts, true);
  assert.equal(loadAdminConfig({ ...env, ADMIN_API_ORIGIN: 'https://api.example.test', ADMIN_HSTS: 'false' }).hsts, false);
});

test('invalid values fail with a clear message', () => {
  assert.throws(() => loadAdminConfig({ ADMIN_API_ORIGIN: 'https://api.example.test/v1' }), /without a path/);
  assert.throws(() => loadAdminConfig({ ADMIN_API_ORIGIN: 'https://user:pw@api.example.test' }), /credentials/);
  assert.throws(() => loadAdminConfig({ ADMIN_API_ORIGIN: 'https://api.example.test', PORT: 'x' }), /PORT/);
  assert.throws(() => loadAdminConfig({ ADMIN_API_ORIGIN: 'https://api.example.test', ADMIN_HSTS: 'yes' }), /ADMIN_HSTS/);
});

test('the browser gets the configured API origin at runtime, and the CSP allows only that origin', async () => {
  const server = createAdminServer({ apiOrigin: 'https://api.example.test' });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const res = await fetch(`${base}/config.js`);
    const body = await res.text();
    assert.equal(body, 'window.__DEVORA_ADMIN_CONFIG__ = {"apiOrigin":"https://api.example.test"};\n');
    assert.match(res.headers.get('content-security-policy') ?? '', /connect-src 'self' https:\/\/api\.example\.test;/);
  } finally {
    server.close();
  }
});
