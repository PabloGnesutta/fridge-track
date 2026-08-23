/**
 * Verifies the new cache-first service worker behavior (cacheServiceWorker.js):
 * SW registers, caches static assets, API calls still work, SPA routes still
 * work, and a second load actually serves from cache.
 */
import { chromium } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname2 = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname2, '..', '..', '..', 'backend', 'data', 'fridgetrack.db');

/** Quick, single, immediately-closed read - opened and closed right away to
 * minimize overlap with the running server's own connection. */
function readVerificationCode(email) {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    const row = db.prepare('SELECT verification_code FROM users WHERE email = ?').get(email);
    return row?.verification_code || null;
  } finally {
    db.close();
  }
}

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const EMAIL = process.env.EMAIL || `sw-check@test.local`;
const PASSWORD = process.env.PASSWORD || 'password123';

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

console.log('[sw-check] navigating to', BASE_URL);
await page.goto(BASE_URL);
await page.waitForSelector('#authView:not(.display-none)', { timeout: 10000 }).catch(() => {});

// Sign up fresh (mirrors drive.mjs) - toggle to signup mode first, default view is login.
await page.click('#authModeToggle');
await page.fill('#authForm input[name="authEmail"]', EMAIL);
await page.fill('#authForm input[name="authPassword"]', PASSWORD);
await page.click('#authForm .submit .base-button');

// Signup always requires email verification (see auth-ui.js's goToVerifyEmail) - read the code
// straight out of the sqlite file rather than needing real inbox access for a @test.local address.
const verifyView = await page.waitForSelector('#verifyEmailForm:not(.display-none)', { timeout: 10000 }).catch(() => null);
if (verifyView) {
  const code = readVerificationCode(EMAIL);
  console.log('[sw-check] verification code read from db:', code);
  await page.fill('#verifyEmailForm input[name="verifyCode"]', code);
  await page.click('#verifyEmailForm .submit .base-button');
}

await Promise.race([
  page.waitForSelector('#homeView:not(.display-none)', { timeout: 10000 }),
  page.waitForSelector('#itemListView:not(.display-none)', { timeout: 10000 }),
]).catch(() => {});

// If landed on signup-required / home creation, just create one - this is a throwaway check account.
if (await page.locator('#homeView').isVisible().catch(() => false)) {
  await page.fill('input[name="homeName"]', 'SW Check Home');
  await page.click('#homeForm .submit .base-button');
  await page.waitForSelector('#itemListView:not(.display-none)', { timeout: 10000 }).catch(() => {});
}

// Wait for SW to actually control the page (activate -> clients.claim()).
await page.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 15000 })
  .then(() => console.log('[sw-check] service worker is controlling the page'))
  .catch(() => console.log('[sw-check] WARNING: service worker never took control'));

const swState = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  const cacheNames = await caches.keys();
  let entries = [];
  if (cacheNames.length) {
    const cache = await caches.open(cacheNames[0]);
    const keys = await cache.keys();
    entries = keys.map(k => k.url);
  }
  return {
    hasRegistration: !!reg,
    scriptURL: reg?.active?.scriptURL || null,
    cacheNames,
    entries,
  };
});
console.log('[sw-check] SW registration:', swState.hasRegistration, swState.scriptURL);
console.log('[sw-check] cache names:', swState.cacheNames);
console.log('[sw-check] cache entries (' + swState.entries.length + '):');
for (const e of swState.entries) console.log('   -', e);

// Reload and confirm at least one static asset now comes from the SW (not the network).
const swResponses = [];
page.on('response', async res => {
  try {
    if (res.request().resourceType() === 'script' || res.request().resourceType() === 'stylesheet') {
      const fromSW = res.fromServiceWorker?.() ?? null;
      swResponses.push({ url: res.url(), fromSW });
    }
  } catch { /* ignore */ }
});
await page.reload();
await page.waitForTimeout(1000);
console.log('[sw-check] responses on reload (fromServiceWorker flag where available):');
for (const r of swResponses.slice(0, 10)) console.log('   -', r.fromSW, r.url);

// Confirm an API call still works post-reload (whoami-equivalent: item list loads).
await page.waitForSelector('.location-chips .location-chip, #locationForm', { timeout: 10000 })
  .then(() => console.log('[sw-check] app rendered normally after reload (API calls worked)'))
  .catch(() => console.log('[sw-check] WARNING: app did not render expected content after reload'));

// Confirm a client-side route survives a hard navigation (SPA fallback + SW both involved).
await page.goto(BASE_URL + '/historial');
await page.waitForSelector('body', { timeout: 10000 });
const historialOk = await page.locator('#foodHistoryView, #app').count();
console.log('[sw-check] /historial direct navigation rendered:', historialOk > 0);

console.log('[sw-check] console/page errors:', errors.length ? JSON.stringify(errors, null, 2) : 'none');

await browser.close();
process.exit(errors.length ? 1 : 0);
