import { test, expect } from '@playwright/test';
import { ensureOnboarded, addItem } from './helpers.js';


test('the Home-wide summary strip reflects items across every location and jumps to the most urgent one', async ({ page }) => {
  await page.goto('/');
  await ensureOnboarded(page); // creates "Heladera Test"

  await expect(page.locator('#homeSummary')).toBeHidden();

  await addItem(page, { name: 'Leche', shelfLifeDays: 10 });
  await expect(page.locator('#homeSummary')).toBeHidden();

  await addItem(page, { name: 'Queso', shelfLifeDays: -2 });
  await expect(page.locator('#homeSummary')).toBeVisible();
  await expect(page.locator('#homeSummary')).toContainText('1 vencido');
  await expect(page.locator('#homeSummary')).toHaveAttribute('data-status', 'expired');

  // A second, empty location should still show the Home-wide summary - it's
  // not scoped to whichever location happens to be active.
  await page.click('.location-chips .add-chip');
  await page.fill('#locationForm input[name="locationName"]', 'Freezer Test');
  await page.click('#locationForm .submit');
  await page.waitForSelector('#locationForm', { state: 'hidden' });
  await expect(page.locator('.list .empty-state')).toBeVisible();
  await expect(page.locator('#homeSummary')).toContainText('1 vencido');

  // Tapping it jumps straight to the expired item, switching location first.
  await page.click('#homeSummary');
  await expect(page.locator('#singleItemView .name')).toHaveText('Queso');
  await expect(page.locator('.location-chip.active .locationName')).toHaveText('Heladera Test');
});
