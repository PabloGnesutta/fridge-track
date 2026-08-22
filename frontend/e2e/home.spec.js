import { test, expect } from '@playwright/test';
import {
  ensureAuth, ensureHome, ensureLocation, addItem, getJoinCode, allowTestEmail, readVerificationCode,
} from './helpers.js';


/**
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 * @returns {import('@playwright/test').Locator}
 */
function homeCard(page, name) {
  return page.locator('.home-card', { has: page.locator('.home-card-name', { hasText: name }) });
}

/**
 * Scoped to `.home-card-actions` rather than the whole card, so a button's
 * label text (e.g. "Borrar") can never collide with a substring of the
 * Home's own name (e.g. a Home literally named "Casa Para Borrar").
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 * @param {string} actionText
 * @returns {import('@playwright/test').Locator}
 */
function homeCardAction(page, name, actionText) {
  return homeCard(page, name).locator('.home-card-actions').getByText(actionText);
}


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

  // Switch back to Casa A via its card in the Home switcher and confirm its
  // data is intact and Casa B's doesn't leak into it. Clicks the card's name
  // specifically, not the card as a whole - the card's own action buttons
  // (Invitar/Copiar enlace) stopPropagation, but a generic click on the card
  // could otherwise land on either of them depending on layout.
  await page.click('.home-switcher');
  await page.locator('.home-card-name', { hasText: 'Casa A' }).click();

  await expect(page.locator('.location-chip .locationName', { hasText: 'Cocina A' })).toBeVisible();
  await expect(page.locator('.location-chip .locationName', { hasText: 'Cocina B' })).toHaveCount(0);
  await expect(page.locator('.list .row', { hasText: 'Solo en A' })).toBeVisible();
  await expect(page.locator('.list .row', { hasText: 'Solo en B' })).toHaveCount(0);
});

test.describe('Home card actions', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('copying a Home card\'s link copies a URL carrying its join code', async ({ page }) => {
    await page.goto('/');
    await ensureAuth(page);
    await ensureHome(page, 'Casa Enlace');
    await ensureLocation(page, 'Heladera Enlace');

    const joinCode = await getJoinCode(page);
    await page.click('.home-switcher');
    await homeCardAction(page, 'Casa Enlace', 'Copiar enlace').click();

    await expect(page.locator('#infoToast .message')).toHaveText('Enlace copiado');
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(new URL(clipboardText).searchParams.get('joinCode')).toBe(joinCode);
  });

  test('inviting an email sends the invite and allow-lists it for signup', async ({ page, browser }) => {
    await page.goto('/');
    await ensureAuth(page);
    await ensureHome(page, 'Casa Invitación');
    await ensureLocation(page, 'Heladera Invitación');

    const inviteeEmail = `e2e+invitee-${Date.now()}@test.local`;
    await page.click('.home-switcher');
    await homeCardAction(page, 'Casa Invitación', 'Invitar').click();
    await page.fill('#inviteHomeForm input[name="inviteEmail"]', inviteeEmail);
    await page.click('#inviteHomeForm .submit');

    await expect(page.locator('#infoToast .message')).toHaveText('Invitación enviada');

    // Unlike every other test's ensureAuth (which always allowTestEmail()s
    // its own address first), inviteeEmail was never allow-listed manually -
    // reaching the verify-email step here (instead of the "no autorizado"
    // rejection) proves inviteToHome() itself is what unlocked signup.
    const inviteeContext = await browser.newContext();
    const inviteePage = await inviteeContext.newPage();
    try {
      await inviteePage.goto('/');
      await inviteePage.click('#authModeToggle');
      await inviteePage.fill('#authForm input[name="authEmail"]', inviteeEmail);
      await inviteePage.fill('#authForm input[name="authPassword"]', 'e2e-test-password');
      await inviteePage.click('#authForm .submit');
      await expect(inviteePage.locator('#verifyEmailForm')).toBeVisible();
    } finally {
      await inviteeContext.close();
    }
  });
});

test.describe('deleting a Home', () => {
  test('cancelling the confirm dialog leaves the Home intact', async ({ page }) => {
    await page.goto('/');
    await ensureAuth(page);
    await ensureHome(page, 'Casa a Conservar');
    await ensureLocation(page, 'Heladera a Conservar');

    await page.click('.home-switcher');
    await homeCardAction(page, 'Casa a Conservar', 'Borrar').click();
    await expect(page.locator('#confirmDialog')).toHaveClass(/open/);
    await expect(page.locator('#confirmOkBtn')).toHaveClass(/danger/);
    await page.click('#confirmCancelBtn');

    await expect(page.locator('#confirmDialog')).not.toHaveClass(/open/);
    await expect(homeCard(page, 'Casa a Conservar')).toBeVisible();
  });

  test('deleting the only Home lands back on the chooseHome screen', async ({ page }) => {
    await page.goto('/');
    await ensureAuth(page);
    await ensureHome(page, 'Casa Única');
    await ensureLocation(page, 'Heladera Única');

    await page.click('.home-switcher');
    await homeCardAction(page, 'Casa Única', 'Borrar').click();
    await page.click('#confirmOkBtn');

    await expect(page.locator('#infoToast .message')).toHaveText('Hogar borrado');
    await expect(page.locator('#homeForm')).toBeVisible();
  });

  test('deleting the active Home while another exists switches to the remaining one', async ({ page }) => {
    await page.goto('/');
    await ensureAuth(page);
    await ensureHome(page, 'Casa Para Borrar');
    await ensureLocation(page, 'Heladera Para Borrar');
    await page.click('.home-switcher');
    await ensureHome(page, 'Casa Que Queda');
    await ensureLocation(page, 'Heladera Que Queda');

    // "Casa Que Queda" is active now - delete the OTHER one from its card.
    await page.click('.home-switcher');
    await homeCardAction(page, 'Casa Para Borrar', 'Borrar').click();
    await page.click('#confirmOkBtn');

    await expect(page.locator('#infoToast .message')).toHaveText('Hogar borrado');
    await expect(page.locator('.home-switcher-name')).toHaveText('Casa Que Queda');
  });

  test('deleting a Home shared with another device removes it there too on next sync', async ({ browser }) => {
    const ownerContext = await browser.newContext();
    const joinerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const joinerPage = await joinerContext.newPage();

    try {
      await ownerPage.goto('/');
      await ensureAuth(ownerPage);
      await ensureHome(ownerPage, 'Casa Compartida A Borrar');
      await ensureLocation(ownerPage, 'Heladera Compartida A Borrar');
      const joinCode = await getJoinCode(ownerPage);

      await joinerPage.goto('/');
      await ensureAuth(joinerPage);
      await ensureHome(joinerPage, 'Casa Del Joiner'); // so the joiner has a fallback Home too
      await joinerPage.goto(`/?joinCode=${joinCode}`);
      await expect(joinerPage.locator('.home-switcher-name')).toHaveText('Casa Compartida A Borrar');

      await ownerPage.click('.home-switcher');
      await homeCardAction(ownerPage, 'Casa Compartida A Borrar', 'Borrar').click();
      await ownerPage.click('#confirmOkBtn');
      await expect(ownerPage.locator('#infoToast .message')).toHaveText('Hogar borrado');

      // The joiner has no way to know in real time (no push sync) - only
      // reflected once their own device re-syncs, e.g. on reload.
      await joinerPage.reload();
      await expect(joinerPage.locator('.home-switcher-name')).toHaveText('Casa Del Joiner');
    } finally {
      await ownerContext.close();
      await joinerContext.close();
    }
  });
});

test('opening a Home-invite link joins that Home directly for an already-logged-in user', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const joinerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const joinerPage = await joinerContext.newPage();

  try {
    await ownerPage.goto('/');
    await ensureAuth(ownerPage);
    await ensureHome(ownerPage, 'Casa Por Enlace');
    const joinCode = await getJoinCode(ownerPage);

    // The joiner already has their own, unrelated Home - the link should
    // still switch them straight to the invited one, not just add it
    // silently in the background.
    await joinerPage.goto('/');
    await ensureAuth(joinerPage);
    await ensureHome(joinerPage, 'Otra Casa');

    await joinerPage.goto(`/?joinCode=${joinCode}`);
    await expect(joinerPage.locator('.home-switcher-name')).toHaveText('Casa Por Enlace');
  } finally {
    await ownerContext.close();
    await joinerContext.close();
  }
});

test('opening a Home-invite link on a logged-out browser joins right after signup', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const joinerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const joinerPage = await joinerContext.newPage();

  try {
    await ownerPage.goto('/');
    await ensureAuth(ownerPage);
    await ensureHome(ownerPage, 'Casa Invitado Nuevo');
    const joinCode = await getJoinCode(ownerPage);

    // Stands in for having received (and clicked) a real invite email -
    // allow-listing is inviteToHome()'s own job, covered separately above.
    const inviteeEmail = `e2e+linkjoiner-${Date.now()}@test.local`;
    allowTestEmail(inviteeEmail);

    await joinerPage.goto(`/?joinCode=${joinCode}`);
    await expect(joinerPage.locator('#authForm')).toBeVisible();

    // The captured join code has to survive the full login screen -> signup
    // -> email verification round trip before afterLogin() finally consumes
    // it - this is the whole point of the test, not just reaching afterLogin.
    await joinerPage.click('#authModeToggle');
    await joinerPage.fill('#authForm input[name="authEmail"]', inviteeEmail);
    await joinerPage.fill('#authForm input[name="authPassword"]', 'e2e-test-password');
    await joinerPage.click('#authForm .submit');
    await joinerPage.waitForSelector('#verifyEmailForm', { state: 'visible' });
    await joinerPage.fill('#verifyEmailForm input[name="verifyCode"]', readVerificationCode(inviteeEmail));
    await joinerPage.click('#verifyEmailForm .submit');

    await expect(joinerPage.locator('.home-switcher-name')).toHaveText('Casa Invitado Nuevo');
  } finally {
    await ownerContext.close();
    await joinerContext.close();
  }
});
