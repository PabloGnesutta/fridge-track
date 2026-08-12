import { test, expect } from '@playwright/test';
import { ensureOnboarded, addItem } from './helpers.js';


test('opening an item updates the URL, and browser back returns to the list', async ({ page }) => {
  await page.goto('/');
  await ensureOnboarded(page);
  await addItem(page, { name: 'Leche de prueba', shelfLifeDays: 5 });

  await page.click('.list .row');
  await expect(page).toHaveURL(/\/item\/\d+$/);
  await expect(page.locator('#singleItemView .name')).toHaveText('Leche de prueba');

  await page.goBack();
  await expect(page).toHaveURL('/');
  await expect(page.locator('#itemListView')).toBeVisible();
});

test('a hard refresh on /item/:key re-renders the same item, not a 404', async ({ page }) => {
  await page.goto('/');
  await ensureOnboarded(page);
  await addItem(page, { name: 'Leche de prueba', shelfLifeDays: 5 });

  await page.click('.list .row');
  await expect(page).toHaveURL(/\/item\/\d+$/);
  const itemUrl = page.url();

  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') { consoleErrors.push(msg.text()); } });

  await page.reload();

  await expect(page).toHaveURL(itemUrl);
  await expect(page.locator('#singleItemView .name')).toHaveText('Leche de prueba');
  expect(consoleErrors).toEqual([]);
});
