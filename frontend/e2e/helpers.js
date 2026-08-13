import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { addAllowedEmail } from '../../backend/src/db/allowedEmails.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '../../backend/data/fridgetrack.db');

/**
 * Whitelists a test email so the backend's signup allow-list doesn't reject
 * it. Opens its own short-lived connection rather than the backend's
 * src/db/db.js singleton, since that module is meant to live for the
 * server process's lifetime, not the test runner's.
 * @param {string} email
 */
export function allowTestEmail(email) {
  const db = new DatabaseSync(DB_PATH);
  try {
    addAllowedEmail(db, email);
  } finally {
    db.close();
  }
}

/**
 * Signs up (never logs in) if the app is showing the auth screen. Every test
 * starts from a fresh browser context (empty IndexedDB, no cached session),
 * so this always runs on the very first navigation. Always creates a brand
 * new account with a unique email - the backend's sqlite file is NOT reset
 * between test runs the way a fresh context resets IndexedDB, so test
 * isolation has to come from the email being unique, not from a clean DB.
 * (globalTeardown.js sweeps every e2e+...@test.local account out again once
 * the whole suite finishes.)
 * @param {import('@playwright/test').Page} page
 * @param {{ email?: string, password?: string }} [opts]
 */
export async function ensureAuth(page, { email, password = 'e2e-test-password' } = {}) {
  const emailInput = page.locator('#authForm input[name="authEmail"]');
  if (!(await emailInput.isVisible().catch(() => false))) { return; }

  const uniqueEmail = email || `e2e+${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
  allowTestEmail(uniqueEmail);

  // The form opens in login mode (no name field) - switch to signup first.
  await page.click('#authModeToggle');
  await emailInput.fill(uniqueEmail);
  await page.fill('#authForm input[name="authPassword"]', password);
  await page.click('#authForm .submit');
  await page.waitForSelector('#authForm', { state: 'hidden' });
}

/**
 * Creates a Home if the app is showing the Home selection screen. Always
 * creates a new one (never joins) - this is what gives each test its own
 * isolated set of locations/items now that they're scoped to a Home, the
 * same role a fresh IndexedDB used to play before Homes existed.
 *
 * Waits (bounded) for the Home form rather than doing a one-shot visibility
 * check - afterLogin()/afterHome() both await a network round-trip
 * (syncHomesFromServer/syncHome) before the next screen renders, so an
 * instant check can false-negative under load and silently skip this step.
 * @param {import('@playwright/test').Page} page
 * @param {string} [name]
 */
export async function ensureHome(page, name = 'Hogar Test') {
  // The Home form defaults to "create" mode (its name field visible) every
  // time #homeView is (re)entered - see home-ui.js's setMode()/
  // openHomeSwitcher().
  const nameInput = page.locator('#homeForm input[name="homeName"]');
  const appeared = await nameInput.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
  if (!appeared) { return; }

  await nameInput.fill(name);
  await page.click('#homeForm .submit');
  await page.waitForSelector('#homeView', { state: 'hidden' });
}

/**
 * Full onboarding: auth, then Home, then location. Covers most specs, which
 * don't care about the auth/Home screens themselves - only
 * auth.spec.js/home.spec.js exercise ensureAuth/ensureHome directly.
 * @param {import('@playwright/test').Page} page
 */
export async function ensureOnboarded(page) {
  await ensureAuth(page);
  await ensureHome(page);
  await ensureLocation(page);
}

/**
 * Creates a location if the app is showing the onboarding form (every test
 * starts from a fresh IndexedDB via a fresh browser context, so this always
 * runs on the very first navigation).
 *
 * Waits (bounded) for the form rather than doing a one-shot visibility check
 * - afterHome() awaits a syncHome() network round-trip before deciding
 * whether to open this form, so an instant check right after ensureHome()
 * returns can false-negative under load and silently skip this step,
 * leaving the modal to pop open later and block whatever the test does next
 * (e.g. clicking #newItemBtn, which sits behind the modal's backdrop).
 * @param {import('@playwright/test').Page} page
 * @param {string} [name]
 */
export async function ensureLocation(page, name = 'Heladera Test') {
  const locationInput = page.locator('#locationForm input[name="locationName"]');
  const appeared = await locationInput.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
  if (appeared) {
    await locationInput.fill(name);
    await page.click('#locationForm .submit');
    await page.waitForSelector('#locationForm', { state: 'hidden' });
  }
}

/**
 * Reads the join code of the currently active Home straight out of
 * IndexedDB's `homes` store. There's no UI locator for this - the app never
 * displays a created Home's join code anywhere, only a form to paste one in.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string>}
 */
export async function getJoinCode(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('FridgeTrack');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('homes', 'readonly');
      const currentId = Number(localStorage.getItem('currentHomeId'));
      const getRequest = tx.objectStore('homes').get(currentId);
      getRequest.onerror = () => reject(getRequest.error);
      getRequest.onsuccess = () => resolve(getRequest.result?.joinCode);
    };
  }));
}

/**
 * Joins an existing Home via its join-code, if the app is showing the Home
 * selection screen. The form defaults to "create" mode, so this switches it
 * to "join" first via the mode toggle. Mirrors ensureHome().
 * @param {import('@playwright/test').Page} page
 * @param {string} joinCode
 */
export async function joinHome(page, joinCode) {
  const homeView = page.locator('#homeView');
  if (!(await homeView.isVisible().catch(() => false))) { return; }

  await page.click('#homeModeToggle');
  await page.fill('#homeForm input[name="joinCode"]', joinCode);
  await page.click('#homeForm .submit');
  await page.waitForSelector('#homeView', { state: 'hidden' });
}

/**
 * Adds an item via the "+" button and item form. `dueBy` must be given as
 * either a shelf-life in days or an ISO use-by date - the form requires one
 * of the two.
 * @param {import('@playwright/test').Page} page
 * @param {{ name: string, shelfLifeDays?: number, useByDate?: string }} opts
 */
export async function addItem(page, { name, shelfLifeDays, useByDate }) {
  await page.click('#newItemBtn');
  await page.waitForSelector('#itemForm', { state: 'visible' });
  await page.fill('#itemForm input[name="itemName"]', name);
  if (shelfLifeDays != null) {
    await page.fill('#itemForm input[name="shelfLifeDays"]', String(shelfLifeDays));
  }
  if (useByDate) {
    await page.fill('#itemForm input[name="useByDate"]', useByDate);
  }
  await page.click('#itemForm .submit');
  await page.waitForSelector('#itemForm', { state: 'hidden' });
}
