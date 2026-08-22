import { test, expect } from '@playwright/test';
import { ensureOnboarded, addItem } from './helpers.js';

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 * @param {string} categoryLabel
 */
async function addLocation(page, name, categoryLabel) {
  await page.click('.location-chips .add-chip');
  await page.fill('#locationForm input[name="locationName"]', name);
  await page.selectOption('#locationForm select[name="locationCategory"]', { label: categoryLabel });
  await page.click('#locationForm .submit');
  await page.waitForSelector('#locationForm', { state: 'hidden' });
}

test('food-name history and autocomplete stay separate per location category', async ({ page }) => {
  await page.goto('/');
  await ensureOnboarded(page); // creates "Heladera Test", category 'Alimentos' (the Home's built-in default)

  await addItem(page, { name: 'Leche', shelfLifeDays: 5 });
  await page.click('.list .row', { hasText: 'Leche' });
  await page.click('#usedBtn');
  await page.waitForTimeout(200);

  await addLocation(page, 'Botiquin Test', 'Medicamentos');

  // Autocomplete must not offer "Leche" (an 'alimento'-category name) while
  // adding an item in a 'medicamento' location - this is the exact
  // cross-category pollution the category scoping fixes.
  await page.click('#newItemBtn');
  await page.waitForSelector('#itemForm', { state: 'visible' });
  await page.fill('#itemForm input[name="itemName"]', 'Lec');
  await expect(page.locator('#itemForm .name-suggestions .suggestion')).toHaveCount(0);
  await page.click('#main-modal .close-modal');
  await page.waitForSelector('#itemForm', { state: 'hidden' });

  await addItem(page, { name: 'Loratadina', shelfLifeDays: 365 });
  await page.click('.list .row', { hasText: 'Loratadina' });
  await page.click('#discardedBtn');
  await page.waitForTimeout(200);

  // Currently in the 'medicamento' location - /historial should default to
  // that tab and show only 'medicamento' entries.
  await page.click('#tabHistoryBtn .btn');
  await expect(page).toHaveURL('/historial');
  await expect(page.locator('.history-category-tab.active')).toHaveText('Medicamentos');
  await expect(page.locator('#foodHistoryView .list .row', { hasText: 'Loratadina' })).toContainText('Tirado 1 vez');
  await expect(page.locator('#foodHistoryView .list .row', { hasText: 'Leche' })).toHaveCount(0);

  // Switching to the Alimentos tab shows the food-category entry instead.
  await page.click('.history-category-tab', { hasText: 'Alimentos' });
  await expect(page.locator('.history-category-tab.active')).toHaveText('Alimentos');
  await expect(page.locator('#foodHistoryView .list .row', { hasText: 'Leche' })).toContainText('Usado 1 vez');
  await expect(page.locator('#foodHistoryView .list .row', { hasText: 'Loratadina' })).toHaveCount(0);
});
