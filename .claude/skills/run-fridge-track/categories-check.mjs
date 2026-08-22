/**
 * Manual smoke test for the categories-table feature: signup (handling the
 * email-verification step the way e2e/helpers.js does - reads the code
 * straight out of the sqlite file since there's no real inbox here) ->
 * create a Home -> location form's category <select> -> "+ Nueva categoría"
 * -> Hogar tab's Categorías management list -> rename a category -> confirm
 * it propagates to /historial's tabs.
 *
 * Usage: node .claude/skills/run-fridge-track/categories-check.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const EMAIL = `cat-check-${Date.now()}@test.local`;
const PASSWORD = 'password123';
const HOME_NAME = 'Casa Categorias Check';
const SHOTS_DIR = join(__dirname, 'shots');
const DB_PATH = join(__dirname, '../../../backend/data/fridgetrack.db');

mkdirSync(SHOTS_DIR, { recursive: true });

function allowEmail(email) {
  const db = new DatabaseSync(DB_PATH);
  try {
    db.prepare('INSERT OR IGNORE INTO allowed_emails (email, added_at) VALUES (?, ?)').run(email, Date.now());
  } finally {
    db.close();
  }
}

function readVerificationCode(email) {
  const db = new DatabaseSync(DB_PATH);
  try {
    const row = db.prepare('SELECT verification_code FROM users WHERE email = ?').get(email);
    return row?.verification_code;
  } finally {
    db.close();
  }
}

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

console.log(`[check] signing up as ${EMAIL}`);
allowEmail(EMAIL);
await page.goto(BASE_URL);
await page.waitForSelector('#authView:not(.display-none)', { timeout: 10000 });

await page.click('#authModeToggle');
await page.fill('#authForm input[name="authEmail"]', EMAIL);
await page.fill('#authForm input[name="authPassword"]', PASSWORD);
await page.click('#authForm .submit .base-button');

const codeInput = page.locator('#verifyEmailForm input[name="verifyCode"]');
await codeInput.waitFor({ state: 'visible', timeout: 10000 });
await codeInput.fill(readVerificationCode(EMAIL));
await page.click('#verifyEmailForm .submit .base-button');

await page.waitForSelector('#homeView:not(.display-none)', { timeout: 10000 });
await page.fill('input[name="homeName"]', HOME_NAME);
await page.click('#homeForm .submit .base-button');

// Should land on the location form (onboarding, no locations yet).
await page.waitForSelector('#locationForm:not([style*="display: none"])', { timeout: 10000 }).catch(() => {});
await page.waitForSelector('#app[data-show-location-form="true"]', { timeout: 10000 });

console.log('[check] location form open - inspecting the category <select>');
const select = page.locator('#locationForm select[name="locationCategory"]');
await select.waitFor({ state: 'visible', timeout: 5000 });
const optionTexts = await select.locator('option').allTextContents();
console.log('[check] category select options:', optionTexts);

await page.screenshot({ path: join(SHOTS_DIR, '1-location-form-select.png') });

await page.fill('#locationForm input[name="locationName"]', 'Heladera');
await select.selectOption({ label: '+ Nueva categoría' });
const newCategoryInput = page.locator('#locationForm input[name="newCategoryName"]');
await newCategoryInput.waitFor({ state: 'visible', timeout: 3000 });
await newCategoryInput.fill('Congelador');
await page.screenshot({ path: join(SHOTS_DIR, '2-new-category-reveal.png') });

await page.click('#locationForm .submit .base-button');
await page.waitForSelector('.location-chips .location-chip', { timeout: 10000 });
console.log('[check] location created with new custom category "Congelador"');

console.log('[check] opening Hogar tab to check categories management');
await page.click('#tabHomeBtn .btn');
await page.waitForSelector('#homeView:not(.display-none)', { timeout: 5000 });

const categoryRows = page.locator('.categories-list .row .itemName');
const categoryNames = await categoryRows.allTextContents();
console.log('[check] categories listed on Hogar tab:', categoryNames);
await page.screenshot({ path: join(SHOTS_DIR, '3-hogar-categories-list.png') });

console.log('[check] renaming "Congelador" to "Freezer Grande"');
const congeladorRow = page.locator('.categories-list .row', { hasText: 'Congelador' });
await congeladorRow.locator('[aria-label="Editar categoría"]').click();
await page.waitForSelector('#app[data-show-category-form="true"]', { timeout: 5000 });
await page.fill('#categoryForm input[name="categoryName"]', 'Freezer Grande');
await page.screenshot({ path: join(SHOTS_DIR, '4-category-rename-form.png') });
await page.click('#categoryForm .submit .base-button');
await page.waitForSelector('#app[data-show-category-form="false"]', { timeout: 5000 });

const renamedNames = await page.locator('.categories-list .row .itemName').allTextContents();
console.log('[check] categories after rename:', renamedNames);
await page.screenshot({ path: join(SHOTS_DIR, '5-hogar-after-rename.png') });

console.log('[check] confirming the location form select reflects the rename');
await page.click('#tabListBtn .btn');
await page.waitForSelector('#itemListView:not(.display-none)', { timeout: 5000 });
await page.click('.location-chips .location-chip .icon-btn');
await page.waitForSelector('#app[data-show-location-form="true"]', { timeout: 5000 });
const optionsAfterRename = await page.locator('#locationForm select[name="locationCategory"] option').allTextContents();
console.log('[check] location form select options after rename:', optionsAfterRename);
await page.screenshot({ path: join(SHOTS_DIR, '6-location-form-after-rename.png') });
await page.click('#main-modal .close-modal');

console.log('[check] confirming /historial tabs reflect the rename');
await page.click('#tabHistoryBtn .btn');
// Page-level views (unlike modals) are gated via the data-current-view
// attribute selector, not a .display-none class toggle - waiting on that
// attribute instead of a class that's never actually applied here.
await page.waitForSelector("#app[data-current-view='FoodHistory']", { timeout: 5000 });
await page.waitForFunction(() => document.querySelectorAll('.history-category-tab').length > 0, { timeout: 5000 });
const historyTabs = await page.locator('.history-category-tab').allTextContents();
console.log('[check] /historial tabs:', historyTabs);
await page.screenshot({ path: join(SHOTS_DIR, '7-historial-tabs.png') });

console.log('[check] console/page errors:', errors.length ? JSON.stringify(errors, null, 2) : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
