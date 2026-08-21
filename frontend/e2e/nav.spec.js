import { test, expect } from '@playwright/test';
import { ensureOnboarded } from './helpers.js';


test('the bottom tab bar is hidden until a Home is ready, then navigates between Lista/Historial/Hogar', async ({ page }) => {
  await page.goto('/');

  // Not logged in yet - no tab bar.
  await expect(page.locator('#mainFooter')).toBeHidden();

  await ensureOnboarded(page);

  // Ready - tab bar visible, "Lista" is the active tab by default.
  await expect(page.locator('#mainFooter')).toBeVisible();
  await expect(page.locator('#itemListView')).toBeVisible();

  // Historial tab navigates and updates the URL.
  await page.click('#tabHistoryBtn .btn');
  await expect(page).toHaveURL('/historial');
  await expect(page.locator('#foodHistoryView')).toBeVisible();
  await expect(page.locator('[data-tab="history"]')).toHaveCSS('color', 'rgb(255, 111, 163)');

  // Lista tab navigates back.
  await page.click('#tabListBtn .btn');
  await expect(page).toHaveURL('/');
  await expect(page.locator('#itemListView')).toBeVisible();
  await expect(page.locator('[data-tab="list"]')).toHaveCSS('color', 'rgb(255, 111, 163)');

  // Hogar tab navigates and updates the URL, same as every other tab - a
  // real page with the header/footer still visible, not the full-screen
  // pre-ready chooseHome screen (that one's still auth-stage gated, see
  // style.css).
  await page.click('#tabHomeBtn .btn');
  await expect(page).toHaveURL('/hogar');
  await expect(page.locator('#homeView')).toBeVisible();
  await expect(page.locator('#mainFooter')).toBeVisible();
  await expect(page.locator('#mainHeader')).toBeVisible();
  await expect(page.locator('[data-tab="home"]')).toHaveCSS('color', 'rgb(255, 111, 163)');
});
