/**
 * Drives fridge-track end to end: signup (or login) -> create/select a Home
 * -> create a location if onboarding -> add an item -> screenshot the list.
 * Verified working shape - see SKILL.md for the gotchas that make each step
 * non-obvious (allowlist requirement, field names, mode toggle, etc).
 *
 * Usage (from anywhere - this script's own node_modules has @playwright/test):
 *   node .claude/skills/run-fridge-track/drive.mjs
 *
 * Env vars (all optional):
 *   BASE_URL     default http://localhost:3001
 *   EMAIL        default a timestamped run-check@test.local address
 *   PASSWORD     default "password123"
 *   HOME_NAME    default "Casa Run Check"
 *   LOCATION_NAME default "Heladera"
 *   ITEM_NAME    default "Leche"
 *   SHOTS_DIR    default ./shots next to this script
 *
 * IMPORTANT: the email must already be allow-listed (see SKILL.md's
 * "Auth is invite-only" gotcha) - run manageAllowedEmails.js BEFORE calling
 * this script, and BEFORE starting the server if it isn't already running.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const EMAIL = process.env.EMAIL || `run-check-${Date.now()}@test.local`;
const PASSWORD = process.env.PASSWORD || 'password123';
const HOME_NAME = process.env.HOME_NAME || 'Casa Run Check';
const LOCATION_NAME = process.env.LOCATION_NAME || 'Heladera';
const ITEM_NAME = process.env.ITEM_NAME || 'Leche';
const SHOTS_DIR = process.env.SHOTS_DIR || join(__dirname, 'shots');

mkdirSync(SHOTS_DIR, { recursive: true });

/**
 * A fresh signup always comes back with requiresVerification: true (see
 * apiRouter.js's 'signup' route) - read the code straight out of the sqlite
 * file rather than needing real inbox access for a @test.local address.
 * Single quick read, opened and closed immediately to minimize overlap with
 * the running server's own connection (see the concurrent-db-access gotcha
 * in SKILL.md).
 * @param {string} email
 */
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
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

console.log(`[drive] navigating to ${BASE_URL} as ${EMAIL}`);
await page.goto(BASE_URL);
await page.waitForSelector('#authView:not(.display-none)', { timeout: 10000 }).catch(() => {});

// Signup mode is a toggle away from the default (login) view - field names
// are authEmail/authPassword, not email/password. See SKILL.md.
await page.click('#authModeToggle');
await page.fill('#authForm input[name="authEmail"]', EMAIL);
await page.fill('#authForm input[name="authPassword"]', PASSWORD);
await page.click('#authForm .submit .base-button');

// A fresh signup always requires email verification first - handle that
// screen if it shows up (an existing/already-verified EMAIL skips straight
// past it, logging in directly instead).
const verifyView = await page.waitForSelector('#verifyEmailForm:not(.display-none)', { timeout: 10000 }).catch(() => null);
if (verifyView) {
  const code = readVerificationCode(EMAIL);
  console.log('[drive] verification code read from db:', code);
  await page.fill('#verifyEmailForm input[name="verifyCode"]', code);
  await page.click('#verifyEmailForm .submit .base-button');
}

// Either a fresh signup lands on Home creation, or (if EMAIL already has a
// Home) it goes straight to the item list - handle both.
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

await page.click('#newItemBtn');
await page.waitForSelector('#itemForm:not(.display-none)', { timeout: 5000 }).catch(() => {});
await page.fill('#itemForm input[name="itemName"]', ITEM_NAME);
await page.fill('#itemForm input[name="shelfLifeDays"]', '5');
await page.click('#itemForm .submit .base-button');

await page.waitForSelector('.list .row', { timeout: 10000 });
const itemText = await page.locator('.list .row .itemName').first().textContent();

const shotPath = join(SHOTS_DIR, 'item-list.png');
await page.screenshot({ path: shotPath });

console.log('[drive] item in list:', itemText);
console.log('[drive] console/page errors:', errors.length ? JSON.stringify(errors, null, 2) : 'none');
console.log('[drive] screenshot:', shotPath);

await browser.close();
process.exit(errors.length ? 1 : 0);
