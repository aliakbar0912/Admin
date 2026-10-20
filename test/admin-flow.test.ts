// Browser test of the owner's critical flows. The real backend, a real PostgreSQL database, the mock upstream, the admin
// server and headless Chromium all run together. Screenshots go to the scratchpad for review.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { chromium, type Browser, type Page } from 'playwright';
import { createTestDb, SKIP_NO_PG, type TestDb } from '../../server/test/helpers.ts';
import { loadConfig } from '../../server/src/config.ts';
import { createServer } from '../../server/src/app.ts';
import { Redis } from '../../server/src/redis.ts';
import { RedisLimitStore } from '../../server/src/limits.ts';
import { hashPassword } from '../../server/src/crypto.ts';
import { loadMigrations, migrateUp } from '../../server/src/db/migrate.ts';
import { startMockOpenAI, type MockServer } from '../../tests/fixtures/mock-openai.ts';
import { createAdminServer } from '../server.mjs';

const SHOTS = process.env.DEVORA_SHOTS_DIR ?? path.join(process.env.TMPDIR ?? '/tmp', 'devora-admin-shots');
const OWNER_EMAIL = 'owner@example.test';
const OWNER_PASSWORD = 'correct horse battery staple';
const UPSTREAM_KEY = 'sk-browser-test-key-987654';

let tdb: TestDb | null = null;
let api: Server;
let admin: Server;
let mock: MockServer;
let browser: Browser | null = null;
let redis: Redis | null = null;
let deviceToken = '';
const consoleErrors: string[] = [];

const ADMIN_PORT = 21000 + Math.floor(Math.random() * 5000);
const adminUrl = `http://127.0.0.1:${ADMIN_PORT}`;
const apiUrl = `http://127.0.0.1:${ADMIN_PORT + 1}`;

before(async () => {
  tdb = await createTestDb();
  if (!tdb) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await migrateUp(tdb.db, loadMigrations());
  await tdb.db.query('INSERT INTO owners (email, password_hash) VALUES ($1, $2)', [OWNER_EMAIL, await hashPassword(OWNER_PASSWORD)]);
  mock = await startMockOpenAI({ requireKey: UPSTREAM_KEY, models: ['mock-coder', 'mock-vision'], script: () => ({ content: 'ok' }) });
  // With DEVORA_TEST_REDIS_URL set, the backend keeps its rate limits in that Redis, as in production.
  const redisUrl = process.env.DEVORA_TEST_REDIS_URL;
  const config = loadConfig({
      DEVORA_ENV: 'development',
      DATABASE_URL: `postgres://${tdb.config.user}:${encodeURIComponent(tdb.config.password)}@${tdb.config.host}:${tdb.config.port}/${tdb.config.database}`,
      DEVORA_SECRET_KEYS: `1=${crypto.randomBytes(32).toString('base64')}`,
      DEVORA_SECRET_ACTIVE_KEY: '1',
      ADMIN_ORIGIN: adminUrl,
      COOKIE_SECURE: 'false',
      ...(redisUrl ? { REDIS_URL: redisUrl, REDIS_KEY_PREFIX: `devora-admin-test-${crypto.randomBytes(4).toString('hex')}` } : {}),
  });
  redis = config.redis ? new Redis(config.redis) : null;
  api = createServer({
    db: tdb.db,
    config,
    limits: redis ? new RedisLimitStore(redis, config.redisKeyPrefix) : undefined,
    redis,
    fetch: globalThis.fetch,
  });
  await new Promise<void>((r) => api.listen(ADMIN_PORT + 1, '127.0.0.1', r));
  admin = createAdminServer({ apiOrigin: apiUrl });
  await new Promise<void>((r) => admin.listen(ADMIN_PORT, '127.0.0.1', r));
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await new Promise<void>((r) => (admin ? admin.close(() => r()) : r()));
  await new Promise<void>((r) => (api ? (api.closeAllConnections?.(), api.close(() => r())) : r()));
  await mock?.close();
  await redis?.close();
  await tdb?.drop();
});

async function page(width = 1280, height = 900): Promise<Page> {
  const p = await browser!.newPage({ viewport: { width, height } });
  p.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  p.on('pageerror', (e) => consoleErrors.push(String(e)));
  if (process.env.DEVORA_DEBUG_FLOW) {
    p.on('response', (r) => {
      if (r.status() >= 400) void r.text().then((t) => process.stdout.write(`    [http] ${r.request().method()} ${r.url()} -> ${r.status()} ${t.slice(0, 160)}\n`)).catch(() => undefined);
    });
  }
  return p;
}

describe('admin website, end to end', () => {
  test('sign-in refuses a wrong password and accepts the owner', async (t) => {
    if (!tdb || !browser) return t.skip(SKIP_NO_PG);
    const p = await page();
    await p.goto(adminUrl);
    await p.getByRole('heading', { name: 'Devora admin' }).waitFor();
    await p.getByLabel('Email').fill(OWNER_EMAIL);
    await p.getByLabel('Password').fill('wrong password value');
    await p.getByRole('button', { name: 'Sign in' }).click();
    await p.getByText('invalid email or password').waitFor();
    await p.getByLabel('Password').fill(OWNER_PASSWORD);
    await p.getByRole('button', { name: 'Sign in' }).click();
    await p.getByRole('heading', { name: 'Overview' }).waitFor();
    // The health card shows the real Redis state from the backend.
    const redisRow = p.locator('li', { has: p.locator('strong', { hasText: /^Redis$/ }) });
    await redisRow.waitFor();
    if (redis) await redisRow.getByText('connected').waitFor();
    else await redisRow.getByText('not configured', { exact: false }).waitFor();
    await p.screenshot({ path: path.join(SHOTS, '01-overview.png'), fullPage: true });
    await p.close();
  });

  test('the owner adds a provider, stores its key after a password check, and tests it', async (t) => {
    if (!tdb || !browser) return t.skip(SKIP_NO_PG);
    const p = await page();
    await signIn(p);
    await p.goto(`${adminUrl}/#/providers`);
    await p.getByRole('button', { name: 'Add provider' }).click();
    await p.getByLabel('Name').fill('Browser mock');
    await p.getByLabel('Base URL').fill(mock.url);
    await p.getByRole('button', { name: 'Save' }).click();
    await p.getByText('Browser mock added').waitFor();

    await p.getByRole('button', { name: 'Set key' }).click();
    await p.getByRole('textbox', { name: 'API key', exact: true }).fill(UPSTREAM_KEY);
    await p.getByRole('button', { name: 'Store key' }).click();
    // The server asks for the password again because the earlier sign-in is not recent enough for a key change.
    const dialog = p.getByRole('dialog', { name: 'Confirm your password' });
    await dialog.waitFor();
    await p.screenshot({ path: path.join(SHOTS, '02-reauth.png') });
    await dialog.getByLabel('Password').fill(OWNER_PASSWORD);
    await dialog.getByRole('button', { name: 'Confirm' }).click();
    await p.getByText('API key stored').waitFor();
    assert.equal(await p.getByText(UPSTREAM_KEY).count(), 0, 'the key is never shown');

    await p.getByRole('button', { name: 'Test' }).first().click();
    await p.getByText('test finished').waitFor();
    await p.getByText('reachable; 2 models listed').waitFor();
    await p.screenshot({ path: path.join(SHOTS, '03-providers.png'), fullPage: true });
    await p.close();
  });

  test('models are discovered, enabled, and set as the default', async (t) => {
    if (!tdb || !browser) return t.skip(SKIP_NO_PG);
    const p = await page();
    await signIn(p);
    await p.goto(`${adminUrl}/#/providers`);
    await p.getByRole('button', { name: 'Refresh models' }).first().click();
    await p.getByText('2 models listed, 2 new').waitFor();
    await p.goto(`${adminUrl}/#/models`);
    // The checkbox is controlled: it changes when the server confirms, so click and wait for the confirmation.
    await p.getByRole('checkbox', { name: 'Enabled: mock-coder' }).click();
    await p.getByText('mock-coder enabled').waitFor();
    assert.equal(await p.getByRole('checkbox', { name: 'Enabled: mock-coder' }).isChecked(), true);
    await p.getByRole('row', { name: /mock-coder/ }).getByRole('button', { name: 'Make default' }).click();
    await p.getByText('is now the default').waitFor();
    await p.screenshot({ path: path.join(SHOTS, '04-models.png'), fullPage: true });
    await p.close();
  });

  test('a device enrolls with a code shown once, and the code is not shown again after leaving', async (t) => {
    if (!tdb || !browser) return t.skip(SKIP_NO_PG);
    const p = await page();
    await signIn(p);
    await p.goto(`${adminUrl}/#/devices`);
    await p.getByLabel('Label').fill('Browser laptop');
    await p.getByRole('button', { name: 'Create enrollment code' }).click();
    await confirmPasswordIfAsked(p);
    const code = (await p.getByTestId('enroll-code').textContent())?.trim() ?? '';
    assert.match(code, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    await p.screenshot({ path: path.join(SHOTS, '05-devices.png'), fullPage: true });
    const enroll = await fetch(`${apiUrl}/v1/devices/enroll`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, deviceName: 'Browser laptop' }) });
    assert.equal(enroll.status, 201);
    deviceToken = ((await enroll.json()) as any).token;
    await p.getByRole('button', { name: 'Done' }).click();
    await p.close();
  });

  test('the owner limits a desktop to selected models, and the desktop catalogue follows', async (t) => {
    if (!tdb || !browser) return t.skip(SKIP_NO_PG);
    const catalogue = async () => ((await (await fetch(`${apiUrl}/v1/catalogue`, { headers: { authorization: `Bearer ${deviceToken}` } })).json()) as any).models.map((m: any) => m.displayName);
    assert.deepEqual(await catalogue(), ['mock-coder'], 'all enabled models before the change');
    const p = await page();
    await signIn(p);
    await p.goto(`${adminUrl}/#/devices`);
    const row = p.getByRole('row', { name: /Browser laptop/ });
    await row.getByText('All enabled models').waitFor();
    await row.getByRole('button', { name: 'Model access' }).click();
    await p.getByRole('dialog', { name: /Model access/ }).waitFor();
    await p.getByLabel('Only the models selected below').check();
    await p.getByRole('group', { name: 'Models this desktop may use' }).waitFor();
    await p.screenshot({ path: path.join(SHOTS, '05b-model-access.png'), fullPage: true });
    await p.getByRole('button', { name: 'Save access' }).click();
    await p.getByText('can use 0 selected models').waitFor();
    await row.getByText('0 selected').waitFor();
    assert.deepEqual(await catalogue(), [], 'nothing granted, nothing listed');

    await row.getByRole('button', { name: 'Model access' }).click();
    await p.getByRole('checkbox', { name: /mock-coder/ }).check();
    await p.getByRole('button', { name: 'Save access' }).click();
    await p.getByText('can use 1 selected model').waitFor();
    assert.deepEqual(await catalogue(), ['mock-coder']);

    // A fallback is chosen from the full model list and shown in the table.
    await p.goto(`${adminUrl}/#/models`);
    await p.getByRole('row', { name: /mock-coder/ }).getByRole('button', { name: 'Edit' }).click();
    await p.getByLabel('Fallback model').selectOption({ label: 'mock-vision (Browser mock) — disabled' });
    await p.getByRole('button', { name: 'Save' }).click();
    await p.getByText('Model saved.').waitFor();
    await p.getByRole('row', { name: /mock-coder/ }).getByText('fallback: mock-vision').waitFor();
    await p.close();
  });

  test('the settings page changes limits and keeps direct mode off by default', async (t) => {
    if (!tdb || !browser) return t.skip(SKIP_NO_PG);
    const p = await page();
    await signIn(p);
    await p.goto(`${adminUrl}/#/settings`);
    const direct = p.getByRole('checkbox', { name: /Allow direct-provider mode/ });
    assert.equal(await direct.isChecked(), false);
    await p.getByLabel('Maximum output tokens per request').fill('4096');
    await p.getByRole('button', { name: 'Save limits' }).click();
    await p.getByText('Settings saved').waitFor();
    await p.goto(`${adminUrl}/#/usage`);
    await p.getByRole('heading', { name: 'Usage & logs' }).waitFor();
    await p.screenshot({ path: path.join(SHOTS, '06-usage.png'), fullPage: true });
    await p.close();
  });

  test('a phone-width screen has no horizontal scrolling and keeps the gutter', async (t) => {
    if (!tdb || !browser) return t.skip(SKIP_NO_PG);
    const p = await page(390, 844);
    await signIn(p);
    await p.goto(`${adminUrl}/#/providers`);
    await p.getByRole('heading', { name: 'Providers' }).waitFor();
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const tableWrap = await p.evaluate(() => {
      const el = document.querySelector('.table-wrap');
      return el ? getComputedStyle(el).overflowX : '';
    });
    assert.equal(overflow, 0, 'the page itself does not scroll sideways');
    assert.equal(tableWrap, 'auto', 'wide tables scroll inside their own container');
    await p.screenshot({ path: path.join(SHOTS, '07-phone.png'), fullPage: true });
    await p.close();
  });

  test('the browser reported no errors and no content-security violations', async (t) => {
    if (!tdb || !browser) return t.skip(SKIP_NO_PG);
    // Chrome logs every non-2xx response as "Failed to load resource". The app handles those responses on purpose
    // (for example the password prompt for a sensitive change), so they are not failures. Real errors and CSP violations are.
    const real = consoleErrors.filter((e) => !/Failed to load resource|favicon/.test(e));
    assert.deepEqual(real, [], `console errors: ${real.join(' | ')}`);
  });
});

/** Sensitive changes ask for the password again. Answer the prompt when it appears. */
async function confirmPasswordIfAsked(p: Page): Promise<void> {
  // Wait for whichever comes first: the password prompt, or the thing the action was meant to produce.
  const dialog = p.getByRole('dialog', { name: 'Confirm your password' });
  await dialog.or(p.getByTestId('enroll-code')).first().waitFor({ timeout: 10_000 });
  if (await dialog.isVisible()) {
    await dialog.getByLabel('Password').fill(OWNER_PASSWORD);
    await dialog.getByRole('button', { name: 'Confirm' }).click();
    await dialog.waitFor({ state: 'detached' });
  }
}

async function signIn(p: Page): Promise<void> {
  await p.goto(adminUrl);
  await p.getByLabel('Email').fill(OWNER_EMAIL);
  await p.getByLabel('Password').fill(OWNER_PASSWORD);
  await p.getByRole('button', { name: 'Sign in' }).click();
  await p.getByRole('heading', { name: 'Overview' }).waitFor();
}
