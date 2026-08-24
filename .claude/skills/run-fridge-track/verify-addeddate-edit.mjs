/**
 * Verifies the addedDate edit-persistence fix: create an item, edit it,
 * change "Fecha agregado", save, then reload the page (forcing a fresh
 * IndexedDB read, not just an in-memory reference) and confirm the new
 * addedDate is still shown in the item detail view.
 *
 * Usage: EMAIL=<already-allow-listed-and-signed-up-email> node verify-addeddate-edit.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
// Reuses an already allow-listed + already-verified test account by default
// (created by a prior drive.mjs run) so this script doesn't need to touch
// allowed_emails via a second writable sqlite connection while the dev
// server is running (see SKILL.md's concurrent-db-access gotcha).
const EMAIL = process.env.EMAIL || 'drive-check@test.local';
const PASSWORD = process.env.PASSWORD || 'password123';
const HOME_NAME = process.env.HOME_NAME || 'Casa Run Check';
const LOCATION_NAME = process.env.LOCATION_NAME || 'Heladera';
const ITEM_NAME = process.env.ITEM_NAME || `VerifyAddedDate-${Date.now()}`;
const SHOTS_DIR = process.env.SHOTS_DIR || join(__dirname, 'shots');

mkdirSync(SHOTS_DIR, { recursive: true });

function readVerificationCode(email) {
  const dbPath = join(__dirname, '..', '..', '..', 'backend', 'data', 'fridgetrack.db');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare('SELECT verification_code FROM users WHERE email = ?').get(email);
    return row?.verification_code || null;
  } finally {
    db.close();
  }
}

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => {
  if (m.type() === 'error') { errors.push('console: ' + m.text()); }
  if (m.text().includes('[DEBUG')) { console.log('[browser]', m.text()); }
});

console.log(`[verify] navigating to ${BASE_URL} as ${EMAIL}`);
await page.goto(BASE_URL);
await page.waitForSelector('#authView:not(.display-none)', { timeout: 10000 }).catch(() => {});

// Login mode is the default (no toggle click) - reusing an existing account.
await page.fill('#authForm input[name="authEmail"]', EMAIL);
await page.fill('#authForm input[name="authPassword"]', PASSWORD);
await page.click('#authForm .submit .base-button');

const verifyView = await page.waitForSelector('#verifyEmailForm:not(.display-none)', { timeout: 10000 }).catch(() => null);
if (verifyView) {
  const code = readVerificationCode(EMAIL);
  console.log('[verify] verification code read from db:', code);
  await page.fill('#verifyEmailForm input[name="verifyCode"]', code);
  await page.click('#verifyEmailForm .submit .base-button');
}

await Promise.race([
  page.waitForSelector('#homeView:not(.display-none)', { timeout: 10000 }),
  page.waitForSelector('#itemListView:not(.display-none)', { timeout: 10000 }),
]);

if (await page.locator('#homeView').isVisible().catch(() => false)) {
  await page.fill('input[name="homeName"]', HOME_NAME);
  await page.click('#homeForm .submit .base-button');
  await page.waitForSelector('#itemListView:not(.display-none)', { timeout: 10000 });
}

const locationForm = page.locator('#locationForm');
if (await locationForm.isVisible().catch(() => false)) {
  await page.fill('#locationForm input[name="locationName"]', LOCATION_NAME);
  await page.click('#locationForm .submit .base-button');
}
await page.waitForSelector('.location-chips .location-chip', { timeout: 10000 });

// Create the item with an initial addedDate of today.
await page.click('#newItemBtn');
await page.waitForSelector('#itemForm:not(.display-none)', { timeout: 5000 }).catch(() => {});
await page.fill('#itemForm input[name="itemName"]', ITEM_NAME);
await page.fill('#itemForm input[name="shelfLifeDays"]', '5');
await page.click('#itemForm .submit .base-button');

await page.waitForSelector('.list .row', { timeout: 10000 });

// Open the item's detail view.
await page.click(`.list .row:has-text("${ITEM_NAME}")`);
await page.waitForSelector('#singleItemView:not(.display-none)', { timeout: 10000 });

// Enter edit mode and change the addedDate to a distinctive past date.
const NEW_ADDED_DATE = '2020-03-15';
await page.click('#singleItemView .edit-btn .base-button');
await page.waitForSelector('#itemForm:not(.display-none)', { timeout: 5000 });
const addedDateInputLocator = page.locator('#itemForm input[name="addedDate"]');
console.log('[verify] addedDate value right after opening edit form:', await addedDateInputLocator.inputValue());
await addedDateInputLocator.fill(NEW_ADDED_DATE);
console.log('[verify] addedDate value right after fill:', await addedDateInputLocator.inputValue());
await page.click('#itemForm .submit .base-button');

// #singleItemView was already visible before this save (editing opens a
// modal over it), so waiting on its visibility alone doesn't wait for the
// async submit -> updateItem -> fetchAndRenderItems -> re-render chain to
// actually finish. Wait for the new date to actually show up instead.
await page.waitForFunction(
  (expected) => document.querySelector('#singleItemView')?.textContent?.includes(expected),
  NEW_ADDED_DATE,
  { timeout: 10000 },
);
const detailTextAfterSave = await page.locator('#singleItemView').textContent();
console.log('[verify] detail text right after save:', detailTextAfterSave.replace(/\s+/g, ' ').trim());

// Reload the page - forces a fresh read from IndexedDB rather than the
// in-memory dataState.currentItem reference, which is exactly what the bug
// was masking (the in-memory object looked right, but never made it to disk).
// The URL is still /item/<key> from before the reload, so the router's
// deep-link capture reopens the item detail directly - it does NOT land back
// on the list first.
await page.reload();
await page.waitForSelector('#singleItemView:not(.display-none)', { timeout: 20000 });
await page.waitForFunction(
  () => document.querySelector('#singleItemView')?.textContent?.includes('Dura'),
  { timeout: 10000 },
);

const detailTextAfterReload = await page.locator('#singleItemView').textContent();
const normalized = detailTextAfterReload.replace(/\s+/g, ' ').trim();
console.log('[verify] detail text after reload:', normalized);

const shotPath = join(SHOTS_DIR, 'addeddate-after-reload.png');
await page.screenshot({ path: shotPath });

const persisted = normalized.includes('15/3/2020') || normalized.includes('15-3-2020') || normalized.includes('2020');
console.log('[verify] addedDate change persisted across reload:', persisted);
console.log('[verify] console/page errors:', errors.length ? JSON.stringify(errors, null, 2) : 'none');
console.log('[verify] screenshot:', shotPath);

await browser.close();
process.exit(persisted && errors.length === 0 ? 0 : 1);
