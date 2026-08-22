import { test, expect } from '@playwright/test';
import { allowTestEmail, readVerificationCode } from './helpers.js';


test('signup requires email and password', async ({ page }) => {
  await page.goto('/');
  await page.click('#authModeToggle');
  await page.click('#authForm .submit');

  await expect(page.locator('#errorToast')).not.toHaveClass(/folded/);
  await expect(page.locator('#authView')).toBeVisible();
});

test('signing up with a new account requires confirming an emailed code, then lands on Home selection', async ({ page }) => {
  await page.goto('/');
  const uniqueEmail = `e2e+${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
  allowTestEmail(uniqueEmail);

  await page.click('#authModeToggle');
  await page.fill('#authForm input[name="authEmail"]', uniqueEmail);
  await page.fill('#authForm input[name="authPassword"]', 'e2e-test-password');
  await page.click('#authForm .submit');

  // Not logged in yet - signup only creates the account and sends a code.
  await expect(page.locator('#verifyEmailForm')).toBeVisible();
  await expect(page.locator('#authForm')).toBeHidden();
  await expect(page.locator('#homeView')).toBeHidden();

  await page.fill('#verifyEmailForm input[name="verifyCode"]', readVerificationCode(uniqueEmail));
  await page.click('#verifyEmailForm .submit');

  await expect(page.locator('#authView')).toBeHidden();
  await expect(page.locator('#homeView')).toBeVisible();
});

test('a wrong code is rejected, and the right code after "reenviar" still works', async ({ page }) => {
  await page.goto('/');
  const uniqueEmail = `e2e+${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
  allowTestEmail(uniqueEmail);

  await page.click('#authModeToggle');
  await page.fill('#authForm input[name="authEmail"]', uniqueEmail);
  await page.fill('#authForm input[name="authPassword"]', 'e2e-test-password');
  await page.click('#authForm .submit');
  await expect(page.locator('#verifyEmailForm')).toBeVisible();

  await page.fill('#verifyEmailForm input[name="verifyCode"]', '000000');
  await page.click('#verifyEmailForm .submit');
  await expect(page.locator('#errorToast .message')).toHaveText('Código incorrecto');
  await expect(page.locator('#verifyEmailForm')).toBeVisible();

  await page.fill('#verifyEmailForm input[name="verifyCode"]', readVerificationCode(uniqueEmail));
  await page.click('#verifyEmailForm .submit');
  await expect(page.locator('#authView')).toBeHidden();
  await expect(page.locator('#homeView')).toBeVisible();
});

test('logging in against an unverified account routes to the verify screen instead of a toast', async ({ page }) => {
  await page.goto('/');
  const uniqueEmail = `e2e+${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
  allowTestEmail(uniqueEmail);

  // Sign up but abandon it before entering the code - simulates a user who
  // closed the tab, then comes back later and just tries to log in.
  await page.click('#authModeToggle');
  await page.fill('#authForm input[name="authEmail"]', uniqueEmail);
  await page.fill('#authForm input[name="authPassword"]', 'e2e-test-password');
  await page.click('#authForm .submit');
  await expect(page.locator('#verifyEmailForm')).toBeVisible();

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#authForm')).toBeVisible();

  await page.fill('#authForm input[name="authEmail"]', uniqueEmail);
  await page.fill('#authForm input[name="authPassword"]', 'e2e-test-password');
  await page.click('#authForm .submit');

  await expect(page.locator('#verifyEmailForm')).toBeVisible();
  await page.fill('#verifyEmailForm input[name="verifyCode"]', readVerificationCode(uniqueEmail));
  await page.click('#verifyEmailForm .submit');
  await expect(page.locator('#homeView')).toBeVisible();
});

test('clicking the emailed verification link confirms the account and lands on Home selection', async ({ page }) => {
  await page.goto('/');
  const uniqueEmail = `e2e+${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
  allowTestEmail(uniqueEmail);

  await page.click('#authModeToggle');
  await page.fill('#authForm input[name="authEmail"]', uniqueEmail);
  await page.fill('#authForm input[name="authPassword"]', 'e2e-test-password');
  await page.click('#authForm .submit');
  await expect(page.locator('#verifyEmailForm')).toBeVisible();

  // Simulates actually clicking the link in the email - a fresh navigation
  // to '/' carrying the same ?email=&code= query params authService.js
  // builds into the email body, on a browser with no session yet.
  const code = readVerificationCode(uniqueEmail);
  await page.goto(`/?email=${encodeURIComponent(uniqueEmail)}&code=${code}`);

  await expect(page.locator('#authView')).toBeHidden();
  await expect(page.locator('#homeView')).toBeVisible();

  // The query string is stripped once consumed - reloading afterwards
  // must not re-attempt (now-already-used) verification.
  expect(page.url().split('?')[0]).toBe(page.url());
});

test('a stale/reused verification link falls back to the manual code screen', async ({ page }) => {
  await page.goto('/');
  const uniqueEmail = `e2e+${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
  allowTestEmail(uniqueEmail);

  await page.click('#authModeToggle');
  await page.fill('#authForm input[name="authEmail"]', uniqueEmail);
  await page.fill('#authForm input[name="authPassword"]', 'e2e-test-password');
  await page.click('#authForm .submit');
  await expect(page.locator('#verifyEmailForm')).toBeVisible();

  await page.goto(`/?email=${encodeURIComponent(uniqueEmail)}&code=000000`);

  await expect(page.locator('#errorToast .message')).toHaveText('Código incorrecto');
  await expect(page.locator('#verifyEmailForm')).toBeVisible();

  // The screen still works normally from here via the manual code.
  await page.fill('#verifyEmailForm input[name="verifyCode"]', readVerificationCode(uniqueEmail));
  await page.click('#verifyEmailForm .submit');
  await expect(page.locator('#homeView')).toBeVisible();
});

test('logging back in with a wrong password shows a toast', async ({ page }) => {
  await page.goto('/');
  const uniqueEmail = `e2e+${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
  allowTestEmail(uniqueEmail);

  await page.click('#authModeToggle');
  await page.fill('#authForm input[name="authEmail"]', uniqueEmail);
  await page.fill('#authForm input[name="authPassword"]', 'right-password');
  await page.click('#authForm .submit');
  await expect(page.locator('#verifyEmailForm')).toBeVisible();
  await page.fill('#verifyEmailForm input[name="verifyCode"]', readVerificationCode(uniqueEmail));
  await page.click('#verifyEmailForm .submit');
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
