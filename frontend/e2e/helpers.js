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
