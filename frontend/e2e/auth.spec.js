import { test, expect } from '@playwright/test';


test('signup requires email and password', async ({ page }) => {
  await page.goto('/');
  await page.click('#authModeToggle');
  await page.click('#authForm .submit');

  await expect(page.locator('#errorToast')).not.toHaveClass(/folded/);
  await expect(page.locator('#authView')).toBeVisible();
});

test('signing up with a new account lands on the Home selection screen', async ({ page }) => {
  await page.goto('/');
  const uniqueEmail = `e2e+${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;

  await page.click('#authModeToggle');
  await page.fill('#authForm input[name="authEmail"]', uniqueEmail);
  await page.fill('#authForm input[name="authPassword"]', 'e2e-test-password');
  await page.click('#authForm .submit');

  await expect(page.locator('#authView')).toBeHidden();
  await expect(page.locator('#homeView')).toBeVisible();
});

test('logging back in with a wrong password shows a toast', async ({ page }) => {
  await page.goto('/');
  const uniqueEmail = `e2e+${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;

  await page.click('#authModeToggle');
  await page.fill('#authForm input[name="authEmail"]', uniqueEmail);
  await page.fill('#authForm input[name="authPassword"]', 'right-password');
  await page.click('#authForm .submit');
  await expect(page.locator('#homeView')).toBeVisible();

  // Simulate a fresh, logged-out visit and try the same email with a wrong
  // password.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#authView')).toBeVisible();

  await page.fill('#authForm input[name="authEmail"]', uniqueEmail);
  await page.fill('#authForm input[name="authPassword"]', 'wrong-password');
  await page.click('#authForm .submit');

  await expect(page.locator('#errorToast .message')).toHaveText('Email o contraseña incorrectos');
  await expect(page.locator('#authView')).toBeVisible();
});
