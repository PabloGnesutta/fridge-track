import { test, expect } from '@playwright/test';
import { ensureOnboarded } from './helpers.js';


test('the header menu panel is hidden by default and opens on the hamburger button', async ({ page }) => {
  await page.goto('/');
  await ensureOnboarded(page);

  const panel = page.locator('.header-menu-panel');
  await expect(panel).toHaveClass(/display-none/);

  await page.click('#headerMenuBtn .btn');
  await expect(panel).not.toHaveClass(/display-none/);
  await expect(page.locator('#logoutBtn')).toBeVisible();
  await expect(page.locator('#openLogsBtn')).toBeVisible();
});

test('clicking outside the menu closes it', async ({ page }) => {
  await page.goto('/');
  await ensureOnboarded(page);

  const panel = page.locator('.header-menu-panel');
  await page.click('#headerMenuBtn .btn');
  await expect(panel).not.toHaveClass(/display-none/);

  await page.locator('.page-title').click();
  await expect(panel).toHaveClass(/display-none/);
});

test('opening logs from the menu shows the debug panel and closes the menu', async ({ page }) => {
  await page.goto('/');
  await ensureOnboarded(page);

  await page.click('#headerMenuBtn .btn');
  await page.click('#openLogsBtn .btn');

  await expect(page.locator('#logger')).not.toHaveClass(/display-none/);
  await expect(page.locator('.header-menu-panel')).toHaveClass(/display-none/);

  await page.click('#closeLogsBtn');
  await expect(page.locator('#logger')).toHaveClass(/display-none/);
});
