import { test, expect } from '@playwright/test';
import { ensureOnboarded } from './helpers.js';


test('deleting a location asks for confirmation via the custom dialog, not the native one', async ({ page }) => {
  await page.goto('/');
  await ensureOnboarded(page); // creates "Heladera Test"

  await page.locator('.location-chip', { hasText: 'Heladera Test' }).locator('.icon-btn').click();
  await expect(page.locator('#locationForm')).toBeVisible();

  await page.click('#deleteLocationBtn');
  await expect(page.locator('#confirmDialog')).toHaveClass(/open/);
  await expect(page.locator('#confirmDialog .confirm-message')).toContainText('Heladera Test');

  // Cancel: dialog closes, location survives, edit form is still open.
  await page.click('#confirmCancelBtn');
  await expect(page.locator('#confirmDialog')).not.toHaveClass(/open/);
  await expect(page.locator('#locationForm')).toBeVisible();
  await expect(page.locator('.location-chip', { hasText: 'Heladera Test' })).toBeVisible();

  // Confirm: location is actually deleted, and since it was the only one,
  // onboarding re-opens the location form.
  await page.click('#deleteLocationBtn');
  await page.click('#confirmOkBtn');
  await expect(page.locator('#confirmDialog')).not.toHaveClass(/open/);
  await expect(page.locator('.location-chip', { hasText: 'Heladera Test' })).toHaveCount(0);
});

test('signing out asks for confirmation before actually logging out', async ({ page }) => {
  await page.goto('/');
  await ensureOnboarded(page);

  await page.click('#logoutBtn .btn');
  await expect(page.locator('#confirmDialog')).toHaveClass(/open/);
  await expect(page.locator('#confirmDialog .confirm-message')).toContainText('cerrar sesión');

  // Cancel: still logged in, still on the item list.
  await page.click('#confirmCancelBtn');
  await expect(page.locator('#confirmDialog')).not.toHaveClass(/open/);
  await expect(page.locator('#itemListView')).toBeVisible();

  // Confirm: actually logs out, back to the auth screen. A second dialog
  // then offers to wipe local data - cancel it here, this test is only
  // about the sign-out confirmation itself (see wipe-on-logout.spec.js for
  // that second dialog's own behavior).
  await page.click('#logoutBtn .btn');
  await page.click('#confirmOkBtn');
  await expect(page.locator('#authView')).toBeVisible();
  await expect(page.locator('#confirmDialog')).toHaveClass(/open/);
  await expect(page.locator('#confirmDialog .confirm-message')).toContainText('borrar los datos');
  await page.click('#confirmCancelBtn');
});
