// Browser test of the owner's critical flows. The real backend, a real PostgreSQL database, the mock upstream, the admin
// server and headless Chromium all run together. Screenshots go to the scratchpad for review.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { chromium, type Browser, type Locator, type Page } from 'playwright';
import { createTestDb, SKIP_NO_PG, type TestDb } from '../../server/test/helpers.ts';
import { loadConfig } from '../../server/src/config.ts';
import { createServer } from '../../server/src/app.ts';
import { Redis } from '../../server/src/redis.ts';
import { RedisLimitStore } from '../../server/src/limits.ts';
import { hashPassword } from '../../server/src/crypto.ts';
import { loadMigrations, migrateUp } from '../../server/src/db/migrate.ts';
import { startMockOpenAI, type MockServer } from '../../tests/fixtures/mock-openai.ts';
import { createAdminServer } from '../server.mjs';
import { startPocketBase, type TestPocketBase } from '../../server/test/pocketbase-helper.ts';

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
let pbt: TestPocketBase | null = null;
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
  // A real throwaway PocketBase for the Users page, when the test binary is available.
  pbt = await startPocketBase();
  const config = loadConfig({
      ...(pbt ? { POCKETBASE_URL: pbt.url, POCKETBASE_ADMIN_EMAIL: pbt.adminEmail, POCKETBASE_ADMIN_PASSWORD: pbt.adminPassword, PUBLIC_API_ORIGIN: apiUrl } : {}),
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
    // Search providers are public APIs: answer the Brave search API locally, pass everything else through.
    fetch: (async (input: any, init: any) => {
      const u = new URL(String(input instanceof Request ? input.url : input));
      if (u.hostname === 'api.search.brave.com') {
        if ((init?.headers as any)?.['x-subscription-token'] !== 'brave-test-key-123') return new Response('{}', { status: 401 });
        return new Response(JSON.stringify({ web: { results: [{ title: 'Node.js releases', url: 'https://nodejs.org/en/about/previous-releases', description: 'Node.js release schedule' }] } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return fetch(input, init);
    }) as typeof fetch,
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
  await pbt?.stop();
  await redis?.close();
  await tdb?.drop();
});

/** Sensitive changes ask for the password unless it was confirmed recently. */
async function confirmIfAsked(p: Page, successText: string): Promise<void> {
  const dialog = p.getByRole('dialog', { name: 'Confirm your password' });
  const ok = p.getByText(successText);
  await Promise.race([dialog.waitFor(), ok.waitFor()]);
  if (await dialog.isVisible()) {
    await dialog.getByLabel('Password').fill(OWNER_PASSWORD);
    await dialog.getByRole('button', { name: 'Confirm' }).click();
  }
  await ok.waitFor();
}

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

  test('a desktop connects on its own and shows up under Devices; the owner can block and unblock it', async (t) => {
    if (!tdb || !browser) return t.skip(SKIP_NO_PG);
    const register = () =>
      fetch(`${apiUrl}/v1/devices/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ installId: 'browser-laptop-install-01', deviceName: 'Browser laptop' }) });
    const first = await register();
    assert.equal(first.status, 201);
    const p = await page();
    await signIn(p);
    await p.goto(`${adminUrl}/#/devices`);
    const row = p.getByRole('row', { name: /Browser laptop/ });
    await row.getByText('active').waitFor();
    assert.equal(await p.getByText('enrollment code', { exact: false }).count(), 0, 'no enrollment codes anywhere');
    await p.screenshot({ path: path.join(SHOTS, '05-devices.png'), fullPage: true });

    await row.getByRole('button', { name: 'Block' }).click();
    const dialog = p.getByRole('dialog', { name: /Block Browser laptop/ });
    await dialog.getByLabel('Type "Browser laptop" to confirm').fill('Browser laptop');
    await dialog.getByRole('button', { name: 'Block computer' }).click();
    await confirmPasswordIfAsked(p, p.getByText('Browser laptop was blocked.'));
    await p.getByText('Browser laptop was blocked.').waitFor();
    await row.getByText('blocked').waitFor();
    assert.equal((await register()).status, 403, 'a blocked installation cannot connect again');

    await row.getByRole('button', { name: 'Unblock' }).click();
    await confirmPasswordIfAsked(p, p.getByText(/Browser laptop is allowed again/));
    await p.getByText(/Browser laptop is allowed again/).waitFor();
    const again = await register();
    assert.equal(again.status, 200);
    deviceToken = ((await again.json()) as any).token;
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

  test('the owner uploads and publishes a desktop update; the overview shows it', async (t) => {
    if (!tdb || !browser) return t.skip(SKIP_NO_PG);
    const p = await page();
    await signIn(p);
    await p.getByRole('button', { name: 'Updates' }).click();
    await p.getByRole('heading', { name: 'Updates', exact: true }).waitFor();
    await p.getByText('No releases yet.', { exact: false }).waitFor();
    await p.getByRole('button', { name: 'New release' }).click();
    const dialog = p.getByRole('dialog', { name: 'New release' });
    await dialog.getByLabel('Version').fill('0.2.0');
    await dialog.getByLabel("What's new").fill('- Faster agent');
    // A small fake installer that spans two upload pieces (4 MB each).
    const exe = Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(5 * 1024 * 1024)]);
    await dialog.getByLabel('Installer (.exe)').setInputFiles({ name: 'Devora-Setup-0.2.0.exe', mimeType: 'application/octet-stream', buffer: exe });
    await dialog.getByRole('button', { name: 'Create and publish' }).click();
    await confirmPasswordIfAsked(p, p.getByText('0.2.0 is published', { exact: false }));
    await p.getByText('0.2.0 is published', { exact: false }).waitFor({ timeout: 30_000 });
    const row = p.getByRole('row', { name: /0\.2\.0/ });
    await row.getByText('published').waitFor();
    await row.getByText('5.0 MB').waitFor();
    await p.screenshot({ path: path.join(SHOTS, '08-updates.png'), fullPage: true });
    // The desktop side sees it.
    const check = await fetch(`${apiUrl}/v1/updates/check?current=0.1.0`, { headers: { authorization: `Bearer ${deviceToken}` } });
    assert.equal(((await check.json()) as any).update.version, '0.2.0');
    await p.getByRole('button', { name: 'Overview' }).click();
    await p.locator('li', { has: p.locator('strong', { hasText: /^Latest version$/ }) }).getByText('0.2.0').waitFor();
    await p.screenshot({ path: path.join(SHOTS, '09-overview.png'), fullPage: true });
    await p.close();
  });

  test('the owner sees Devora users, blocks one, and can require sign-in for Devora AI', async (t) => {
    if (!tdb || !browser) return t.skip(SKIP_NO_PG);
    if (!pbt) return t.skip('no PocketBase test binary');
    await pbt.createUser('ayesha@example.test', 'ayesha-pass-1', { name: 'Ayesha' });
    const pbToken = await pbt.passwordToken('ayesha@example.test', 'ayesha-pass-1');
    const signedIn = await fetch(`${apiUrl}/v1/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pbToken, installId: crypto.randomBytes(18).toString('base64url'), deviceName: 'Ayesha laptop' }),
    });
    assert.equal(signedIn.status, 200);
    const userToken = ((await signedIn.json()) as any).token as string;

    const p = await page();
    await signIn(p);
    await p.goto(`${adminUrl}/#/users`);
    await p.getByRole('heading', { name: 'Users' }).waitFor();
    const row = p.locator('tr', { hasText: 'ayesha@example.test' });
    await row.waitFor();
    await row.getByText('verified', { exact: true }).waitFor();
    await p.screenshot({ path: path.join(SHOTS, '08-users.png'), fullPage: true });
    await row.getByRole('button', { name: 'Manage' }).click();
    const dialog = p.getByRole('dialog', { name: 'Ayesha' });
    await dialog.getByText('Ayesha laptop').waitFor();
    await dialog.getByRole('button', { name: 'Block account' }).click();
    await confirmIfAsked(p, 'is blocked and signed out everywhere');
    await p.locator('tr', { hasText: 'ayesha@example.test' }).getByText('blocked', { exact: true }).waitFor();
    assert.equal((await fetch(`${apiUrl}/v1/catalogue`, { headers: { authorization: `Bearer ${userToken}` } })).status, 401);

    await p.goto(`${adminUrl}/#/settings`);
    const box = p.getByLabel('Require sign-in for Devora AI');
    await box.waitFor();
    assert.equal(await box.isChecked(), false, 'off by default');
    await box.click();
    await confirmIfAsked(p, 'Sign-in is now required for Devora AI');
    const reg = await fetch(`${apiUrl}/v1/devices/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ installId: crypto.randomBytes(18).toString('base64url'), deviceName: 'No account PC' }) });
    const legacyToken = ((await reg.json()) as any).token as string;
    const legacy = await fetch(`${apiUrl}/v1/catalogue`, { headers: { authorization: `Bearer ${legacyToken}` } });
    assert.equal(legacy.status, 403);
    await p.screenshot({ path: path.join(SHOTS, '09a-settings-required.png'), fullPage: true });
    await p.getByLabel('Require sign-in for Devora AI').click({ timeout: 5000 });
    await confirmIfAsked(p, 'works without an account again');
    await p.screenshot({ path: path.join(SHOTS, '09-settings-accounts.png'), fullPage: true });
    await p.close();
  });

  test('the owner sets up web search: provider, key with password check, live test, and desktops see it', async (t) => {
    if (!tdb || !browser) return t.skip(SKIP_NO_PG);
    const p = await page();
    await signIn(p);
    await p.goto(`${adminUrl}/#/search`);
    await p.getByRole('heading', { name: 'Web search' }).waitFor();
    await p.getByText('Web search is off for desktops').waitFor();
    await p.getByRole('button', { name: 'Add search provider' }).click();
    const dlg = p.getByRole('dialog', { name: 'Add search provider' });
    await dlg.getByLabel('Type').selectOption('brave');
    await dlg.getByRole('button', { name: 'Add', exact: true }).click();
    await p.getByText('Now set its API key').waitFor();
    const row = p.locator('tr', { hasText: 'Brave Search API' });
    await row.getByRole('button', { name: 'Set key' }).click();
    await p.getByRole('dialog').getByLabel('API key').fill('brave-test-key-123');
    await p.getByRole('dialog').getByRole('button', { name: 'Store key' }).click();
    await confirmIfAsked(p, 'API key stored');
    assert.equal(await p.getByText('brave-test-key-123').count(), 0, 'the key is never shown');
    await row.getByRole('button', { name: 'Test' }).click();
    await p.getByRole('dialog').getByRole('button', { name: 'Search' }).click();
    await p.getByText('working; 1 result').waitFor();
    await p.getByText('Node.js releases').waitFor();
    await p.screenshot({ path: path.join(SHOTS, '10-web-search-test.png'), fullPage: true });
    await p.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await row.getByText('ready').waitFor();
    await p.screenshot({ path: path.join(SHOTS, '11-web-search.png'), fullPage: true });
    // Desktops: the catalogue says web search is on, and /v1/search answers.
    const reg = await fetch(`${apiUrl}/v1/devices/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ installId: crypto.randomBytes(18).toString('base64url'), deviceName: 'Search PC' }) });
    const tok = ((await reg.json()) as any).token as string;
    const cat = (await (await fetch(`${apiUrl}/v1/catalogue`, { headers: { authorization: `Bearer ${tok}` } })).json()) as any;
    assert.equal(cat.policy.webSearch, true);
    const res = (await (await fetch(`${apiUrl}/v1/search`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify({ query: 'node releases' }) })).json()) as any;
    assert.equal(res.results[0].url, 'https://nodejs.org/en/about/previous-releases');
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
async function confirmPasswordIfAsked(p: Page, result: Locator): Promise<void> {
  // Wait for whichever comes first: the password prompt, or the thing the action was meant to produce.
  const dialog = p.getByRole('dialog', { name: 'Confirm your password' });
  await dialog.or(result).first().waitFor({ timeout: 10_000 });
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
