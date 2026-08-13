import { test, expect } from '@playwright/test';
import { ensureOnboarded, addItem } from './helpers.js';


test('typing a previously-used name suggests it and autofills the shelf life', async ({ page }) => {
  await page.goto('/');
  await ensureOnboarded(page);
  await addItem(page, { name: 'Leche', shelfLifeDays: 5 });

  // Mark the item used so the list is empty again, then create a second
  // item to exercise the autocomplete dropdown for "Leche".
  await page.click('.list .row');
  await page.click('#usedBtn');
  await page.waitForTimeout(200);

  await page.click('#newItemBtn');
  await page.waitForSelector('#itemForm', { state: 'visible' });
  await page.fill('#itemForm input[name="itemName"]', 'lec');

  const suggestion = page.locator('#itemForm .name-suggestions .suggestion', { hasText: 'Leche' });
  await expect(suggestion).toBeVisible();

  await suggestion.click();
  await expect(page.locator('#itemForm input[name="itemName"]')).toHaveValue('Leche');
  await expect(page.locator('#itemForm input[name="shelfLifeDays"]')).toHaveValue('5');
  await expect(page.locator('#itemForm .name-suggestions')).toBeEmpty();
});

test('discarding an item increments its discard count in the history view, undo decrements it back', async ({ page }) => {
  await page.goto('/');
  await ensureOnboarded(page);
  await addItem(page, { name: 'Yogur', shelfLifeDays: 3 });

  await page.click('.list .row');
  await page.click('#discardedBtn');
  await page.waitForTimeout(200);

  await page.click('#tabHistoryBtn .btn');
  await expect(page).toHaveURL('/historial');
  await expect(page.locator('#foodHistoryView .list .row', { hasText: 'Yogur' })).toContainText('Tirado 1 vez');

  // Undo the discard from the undo toast (still reachable from here - it's
  // a global overlay, not tied to a view) and confirm the count reverts.
  await page.click('#undoBtn');
  await page.waitForTimeout(200);
  await page.click('#goBack2 .btn');
  await page.click('#tabHistoryBtn .btn');
  await expect(page.locator('#foodHistoryView .list .row', { hasText: 'Yogur' })).not.toContainText('Tirado');
});

test('the history view shows an all-time usage-rate summary once something has been used or discarded', async ({ page }) => {
  await page.goto('/');
  await ensureOnboarded(page);

  await page.click('#tabHistoryBtn .btn');
  await expect(page.locator('#historyStats')).toBeHidden();

  await page.click('#tabListBtn .btn');
  await addItem(page, { name: 'Leche', shelfLifeDays: 5 });
  await page.click('.list .row', { hasText: 'Leche' });
  await page.click('#usedBtn');
  await page.waitForTimeout(200);

  await addItem(page, { name: 'Queso', shelfLifeDays: 5 });
  await page.click('.list .row', { hasText: 'Queso' });
  await page.click('#discardedBtn');
  await page.waitForTimeout(200);

  await page.click('#tabHistoryBtn .btn');
  await expect(page.locator('#historyStats')).toBeVisible();
  await expect(page.locator('#historyStats')).toContainText('50% aprovechado');
  await expect(page.locator('#historyStats')).toContainText('1 usado');
  await expect(page.locator('#historyStats')).toContainText('1 tirado');
  await expect(page.locator('.list .row', { hasText: 'Leche' })).toContainText('Usado 1 vez');
});

test('the history tab opens /historial and the back button returns to the list', async ({ page }) => {
  await page.goto('/');
  await ensureOnboarded(page);

  await page.click('#tabHistoryBtn .btn');
  await expect(page).toHaveURL('/historial');
  await expect(page.locator('#foodHistoryView')).toBeVisible();

  await page.click('#goBack2 .btn');
  await expect(page).toHaveURL('/');
  await expect(page.locator('#itemListView')).toBeVisible();
});
