import { test, expect } from '@playwright/test';
import { ensureOnboarded, addItem } from './helpers.js';


test('renaming a history entry updates the list and future autocomplete', async ({ page }) => {
  await page.goto('/');
  await ensureOnboarded(page);
  await addItem(page, { name: 'Lehce', shelfLifeDays: 5 });

  await page.click('#tabHistoryBtn .btn');
  const row = page.locator('#foodHistoryView .list .row', { hasText: 'Lehce' });
  await row.locator('.history-row-actions .btn').first().click();

  await expect(page.locator('#foodNameHistoryForm')).toBeVisible();
  await page.fill('#foodNameHistoryForm input[name="foodNameHistoryName"]', 'Leche');
  await page.click('#foodNameHistoryForm .submit');
  await expect(page.locator('#foodNameHistoryForm')).toBeHidden();

  await expect(page.locator('#foodHistoryView .list .row', { hasText: 'Lehce' })).toHaveCount(0);
  await expect(page.locator('#foodHistoryView .list .row', { hasText: 'Leche' })).toBeVisible();

  // Autocomplete now offers the corrected name, not the old typo.
  await page.click('#tabListBtn .btn');
  await page.click('#newItemBtn');
  await page.waitForSelector('#itemForm', { state: 'visible' });
  await page.fill('#itemForm input[name="itemName"]', 'Lec');
  await expect(page.locator('#itemForm .name-suggestions .suggestion', { hasText: 'Leche' })).toBeVisible();
  await expect(page.locator('#itemForm .name-suggestions .suggestion', { hasText: 'Lehce' })).toHaveCount(0);
});

test('renaming to a name that already exists is blocked with a warning', async ({ page }) => {
  await page.goto('/');
  await ensureOnboarded(page);
  await addItem(page, { name: 'Leche', shelfLifeDays: 5 });
  await addItem(page, { name: 'Yogur', shelfLifeDays: 7 });

  await page.click('#tabHistoryBtn .btn');
  const row = page.locator('#foodHistoryView .list .row', { hasText: 'Yogur' });
  await row.locator('.history-row-actions .btn').first().click();

  await page.fill('#foodNameHistoryForm input[name="foodNameHistoryName"]', 'Leche');
  await page.click('#foodNameHistoryForm .submit');

  await expect(page.locator('#errorToast')).not.toHaveClass(/folded/);
  // Blocked - the form stays open and neither entry changed.
  await expect(page.locator('#foodNameHistoryForm')).toBeVisible();
  await page.click('#main-modal .close-modal');
  await expect(page.locator('#foodHistoryView .list .row', { hasText: 'Yogur' })).toBeVisible();
  await expect(page.locator('#foodHistoryView .list .row', { hasText: 'Leche' })).toBeVisible();
});

test('editing shelf-life-days updates the meta line', async ({ page }) => {
  await page.goto('/');
  await ensureOnboarded(page);
  await addItem(page, { name: 'Queso', shelfLifeDays: 5 });

  await page.click('#tabHistoryBtn .btn');
  const row = page.locator('#foodHistoryView .list .row', { hasText: 'Queso' });
  await expect(row).toContainText('Dura 5 días');
  await row.locator('.history-row-actions .btn').first().click();

  await page.fill('#foodNameHistoryForm input[name="foodNameHistoryShelfLifeDays"]', '20');
  await page.click('#foodNameHistoryForm .submit');
  await expect(page.locator('#foodNameHistoryForm')).toBeHidden();

  await expect(page.locator('#foodHistoryView .list .row', { hasText: 'Queso' })).toContainText('Dura 20 días');
});

test('deleting a history entry removes it, and re-adding the same name starts a fresh entry', async ({ page }) => {
  await page.goto('/');
  await ensureOnboarded(page);
  await addItem(page, { name: 'Manzana', shelfLifeDays: 5 });
  await page.click('.list .row', { hasText: 'Manzana' });
  await page.click('#discardedBtn');
  await page.waitForTimeout(200);

  await page.click('#tabHistoryBtn .btn');
  const row = page.locator('#foodHistoryView .list .row', { hasText: 'Manzana' });
  await expect(row).toContainText('Tirado 1 vez');
  await row.locator('.history-row-actions .btn').nth(1).click();

  await expect(page.locator('#confirmDialog')).toHaveClass(/open/);
  await page.click('#confirmOkBtn');
  await expect(page.locator('#foodHistoryView .list .row', { hasText: 'Manzana' })).toHaveCount(0);

  // Re-adding "Manzana" starts a brand new history entry - no stale
  // "Tirado 1 vez" resurrected from the deleted record.
  await page.click('#tabListBtn .btn');
  await addItem(page, { name: 'Manzana', shelfLifeDays: 8 });
  await page.click('#tabHistoryBtn .btn');
  const freshRow = page.locator('#foodHistoryView .list .row', { hasText: 'Manzana' });
  await expect(freshRow).toBeVisible();
  await expect(freshRow).not.toContainText('Tirado');
  await expect(freshRow).toContainText('Dura 8 días');
});
