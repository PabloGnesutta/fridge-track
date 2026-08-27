import { test, expect } from '@playwright/test';
import { ensureOnboarded } from './helpers.js';

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string>}
 */
function footerHeightVar(page) {
  return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--footer-heigt').trim());
}


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

test('hiding the footer via the header menu persists, and its own nav shortcuts still work while it\'s hidden', async ({ page }) => {
  await page.goto('/');
  await ensureOnboarded(page);

  const footerHeight = await footerHeightVar(page);

  await page.click('#headerMenuBtn .btn');
  await expect(page.locator('#footerVisibleToggle')).toBeChecked();
  await page.locator('#footerVisibleToggle').uncheck();
  await expect(page.locator('#mainFooter')).toBeHidden();

  // --footer-heigt collapses to 0 while hidden, so nothing (page padding,
  // toast/banner offsets) keeps reserving space for a footer that's gone.
  await expect.poll(() => footerHeightVar(page)).toBe('0px');

  // Even with the tab bar hidden, the header menu's own Lista/Historial/Hogar
  // shortcuts still navigate - the whole reason they exist.
  await page.click('#menuTabHistoryBtn .btn');
  await expect(page).toHaveURL('/historial');
  await expect(page.locator('#foodHistoryView')).toBeVisible();

  // The preference survives a reload.
  await page.reload();
  await expect(page.locator('#mainFooter')).toBeHidden();
  await expect.poll(() => footerHeightVar(page)).toBe('0px');

  await page.click('#headerMenuBtn .btn');
  await page.locator('#footerVisibleToggle').check();
  await expect(page.locator('#mainFooter')).toBeVisible();
  await expect.poll(() => footerHeightVar(page)).toBe(footerHeight);
});
