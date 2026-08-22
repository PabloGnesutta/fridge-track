import { test, expect } from '@playwright/test';
import { ensureAuth, ensureHome, ensureLocation, addItem, getJoinCode } from './helpers.js';


test('the hamburger menu (logout, notifications, account email) is already available on the chooseHome screen', async ({ page }) => {
  await page.goto('/');
  const uniqueEmail = `e2e+${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
  await ensureAuth(page, { email: uniqueEmail });
  await expect(page.locator('#homeView')).toBeVisible();

  await expect(page.locator('#mainHeader')).toBeVisible();
  await page.click('#headerMenuBtn .btn');
  await expect(page.locator('#logoutBtn')).toBeVisible();
  await expect(page.locator('#headerMenuUserEmail')).toHaveText(uniqueEmail);
});

test('joining with an invalid code shows an error', async ({ page }) => {
  await page.goto('/');
  await ensureAuth(page);
  await expect(page.locator('#homeView')).toBeVisible();

  await page.click('#homeModeToggle');
  await page.fill('#homeForm input[name="joinCode"]', 'ZZZZZZ');
  await page.click('#homeForm .submit');

  await expect(page.locator('#errorToast .message')).toHaveText('Código inválido');
  await expect(page.locator('#homeView')).toBeVisible();
});

test('creating a Home lands on the item list, ready to onboard a location', async ({ page }) => {
  await page.goto('/');
  await ensureAuth(page);
  await ensureHome(page);

  await expect(page.locator('#homeView')).toBeHidden();
  await expect(page.locator('#locationForm')).toBeVisible();
});

test('the home switcher displays the current Home\'s join code', async ({ page }) => {
  await page.goto('/');
  await ensureAuth(page);
  await ensureHome(page, 'Casa Con Código');

  const joinCode = await getJoinCode(page);
  await expect(page.locator('.home-switcher-code')).toContainText(joinCode);
});

test.describe('copying the join code', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('clicking the join code copies it, without opening the Home switcher', async ({ page }) => {
    await page.goto('/');
    await ensureAuth(page);
    await ensureHome(page, 'Casa Portapapeles');
    await ensureLocation(page, 'Heladera Portapapeles');

    const joinCode = await getJoinCode(page);
    await page.click('.home-switcher-code');

    await expect(page.locator('#infoToast .message')).toHaveText('Código copiado');
    await expect(page.locator('#homeView')).toBeHidden();

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toBe(joinCode);
  });
});

test('two Homes in one browser context keep their locations separate', async ({ page }) => {
  await page.goto('/');
  await ensureAuth(page);

  // First Home: "Casa A", with a location only it should see.
  await ensureHome(page, 'Casa A');
  await ensureLocation(page, 'Cocina A');
  await addItem(page, { name: 'Solo en A', shelfLifeDays: 5 });
  await expect(page.locator('.location-chip .locationName', { hasText: 'Cocina A' })).toBeVisible();

  // Switch to a brand new "Casa B" via the home switcher, with its own
  // differently-named location.
  await page.click('.home-switcher');
  await expect(page.locator('#homeView')).toBeVisible();
  await ensureHome(page, 'Casa B');
  await ensureLocation(page, 'Cocina B');
  await addItem(page, { name: 'Solo en B', shelfLifeDays: 5 });

  await expect(page.locator('.location-chip .locationName', { hasText: 'Cocina B' })).toBeVisible();
  await expect(page.locator('.location-chip .locationName', { hasText: 'Cocina A' })).toHaveCount(0);
  await expect(page.locator('.list .row', { hasText: 'Solo en A' })).toHaveCount(0);

  // Switch back to Casa A via its chip in the Home switcher and confirm its
  // data is intact and Casa B's doesn't leak into it.
  await page.click('.home-switcher');
  await page.locator('.home-chip', { hasText: 'Casa A' }).click();

  await expect(page.locator('.location-chip .locationName', { hasText: 'Cocina A' })).toBeVisible();
  await expect(page.locator('.location-chip .locationName', { hasText: 'Cocina B' })).toHaveCount(0);
  await expect(page.locator('.list .row', { hasText: 'Solo en A' })).toBeVisible();
  await expect(page.locator('.list .row', { hasText: 'Solo en B' })).toHaveCount(0);
});
