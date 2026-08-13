import { test, expect } from '@playwright/test';
import { ensureOnboarded, addItem, dragRow } from './helpers.js';


test('swiping a row right past the threshold marks it Usado and removes it', async ({ page }) => {
  await page.goto('/');
  await ensureOnboarded(page);
  await addItem(page, { name: 'Leche', shelfLifeDays: 5 });

  await dragRow(page, 'Leche', 0.5);
  await page.mouse.up();

  await expect(page.locator('.row', { hasText: 'Leche' })).toHaveCount(0);
  await expect(page.locator('#undoToast .message')).toHaveText('"Leche" usado');
});

test('swiping a row left past the threshold marks it Tirado and removes it', async ({ page }) => {
  await page.goto('/');
  await ensureOnboarded(page);
  await addItem(page, { name: 'Queso', shelfLifeDays: 5 });

  await dragRow(page, 'Queso', -0.5);
  await page.mouse.up();

  await expect(page.locator('.row', { hasText: 'Queso' })).toHaveCount(0);
  await expect(page.locator('#undoToast .message')).toHaveText('"Queso" tirado');
});

test('a drag that does not cross the threshold snaps back instead of committing', async ({ page }) => {
  await page.goto('/');
  await ensureOnboarded(page);
  await addItem(page, { name: 'Yogur', shelfLifeDays: 5 });

  await dragRow(page, 'Yogur', 0.15);
  await page.mouse.up();
  await page.waitForTimeout(300); // let the snap-back transition settle

  await expect(page.locator('.row', { hasText: 'Yogur' })).toBeVisible();
  // Toasts hide via a CSS transform (the .folded class), not display/
  // visibility, so toBeHidden() wouldn't recognize this state - assert the
  // actual mechanism instead.
  await expect(page.locator('#undoToast')).toHaveClass(/folded/);
});

test('a plain tap (no drag) still opens the item, unaffected by the swipe wiring', async ({ page }) => {
  await page.goto('/');
  await ensureOnboarded(page);
  await addItem(page, { name: 'Manteca', shelfLifeDays: 5 });

  await page.click('.row', { hasText: 'Manteca' });

  await expect(page.locator('#singleItemView')).toBeVisible();
  await expect(page.locator('#singleItemView .name')).toHaveText('Manteca');
});
