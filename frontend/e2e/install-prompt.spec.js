import { test, expect } from '@playwright/test';
import { ensureOnboarded } from './helpers.js';


test('Chrome/Android: beforeinstallprompt shows a one-tap Instalar button', async ({ page }) => {
  await page.goto('/');
  await ensureOnboarded(page);

  await expect(page.locator('#installBanner')).toHaveClass(/folded/);

  // Headless Chromium doesn't fire beforeinstallprompt on its own (it
  // requires installability heuristics real Chrome applies) - synthesize
  // the event real Chrome/Edge would dispatch, to exercise our own wiring.
  await page.evaluate(() => {
    const fakeEvent = new Event('beforeinstallprompt', { cancelable: true });
    // @ts-ignore
    fakeEvent.prompt = () => {};
    // @ts-ignore
    fakeEvent.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(fakeEvent);
  });

  await expect(page.locator('#installBanner')).not.toHaveClass(/folded/);
  await expect(page.locator('#installBanner .message')).toHaveText('Instalá la app para un acceso más rápido');
  await expect(page.locator('#installBtn')).toBeVisible();

  await page.click('#installBtn');
  await expect(page.locator('#installBanner')).toHaveClass(/folded/);
});

test.describe('iOS Safari', () => {
  test.use({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 '
      + '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });

  test('shows manual Share-sheet instructions instead of an install button', async ({ page }) => {
    await page.goto('/');
    await ensureOnboarded(page);

    await expect(page.locator('#installBanner')).not.toHaveClass(/folded/);
    await expect(page.locator('#installBanner .message'))
      .toHaveText('Instalá la app: tocá Compartir y luego "Agregar a inicio"');
    await expect(page.locator('#installBtn')).toBeHidden();

    await page.click('#dismissInstallBtn');
    await expect(page.locator('#installBanner')).toHaveClass(/folded/);

    // Dismissal is remembered across reloads
    await page.reload();
    await expect(page.locator('#installBanner')).toHaveClass(/folded/);
  });
});
