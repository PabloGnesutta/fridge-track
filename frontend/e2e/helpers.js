/**
 * Signs up (never logs in) if the app is showing the auth screen. Every test
 * starts from a fresh browser context (empty IndexedDB, no cached session),
 * so this always runs on the very first navigation. Always creates a brand
 * new account with a unique email - the backend's sqlite file is NOT reset
 * between test runs the way a fresh context resets IndexedDB, so test
 * isolation has to come from the email being unique, not from a clean DB.
 * @param {import('@playwright/test').Page} page
 * @param {{ email?: string, password?: string }} [opts]
 */
export async function ensureAuth(page, { email, password = 'e2e-test-password' } = {}) {
  const emailInput = page.locator('#authForm input[name="authEmail"]');
  if (!(await emailInput.isVisible().catch(() => false))) { return; }

  const uniqueEmail = email || `e2e+${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;

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
 * @param {import('@playwright/test').Page} page
 * @param {string} [name]
 */
export async function ensureHome(page, name = 'Hogar Test') {
  const nameInput = page.locator('#homeCreateForm input[name="homeName"]');
  if (!(await nameInput.isVisible().catch(() => false))) { return; }

  await nameInput.fill(name);
  await page.click('#homeCreateForm .submit');
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
 * @param {import('@playwright/test').Page} page
 * @param {string} [name]
 */
export async function ensureLocation(page, name = 'Heladera Test') {
  const locationInput = page.locator('#locationForm input[name="locationName"]');
  if (await locationInput.isVisible().catch(() => false)) {
    await locationInput.fill(name);
    await page.click('#locationForm .submit');
    await page.waitForSelector('#locationForm', { state: 'hidden' });
  }
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
