import { test, expect } from '@playwright/test';
import { ensureOnboarded } from './helpers.js';

/**
 * Headless Chromium has no real microphone/network path for actual speech
 * recognition. We replace window.SpeechRecognition/webkitSpeechRecognition
 * with a controllable fake before any app script runs, and expose the live
 * instance on window.__lastSpeechRecognition so tests can fire
 * onresult/onerror/onend directly - ported from car-track's
 * tests/e2e/voice-mileage.spec.js, same approach.
 */
async function stubSpeechRecognition(page) {
  await page.addInitScript(() => {
    class FakeSpeechRecognition {
      constructor() {
        // @ts-ignore
        window.__lastSpeechRecognition = this;
      }
      start() { /* no-op; tests trigger the callbacks manually */ }
      stop() { if (this.onend) { this.onend(); } }
    }
    // @ts-ignore
    window.SpeechRecognition = FakeSpeechRecognition;
    // @ts-ignore
    window.webkitSpeechRecognition = FakeSpeechRecognition;
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} transcript
 */
async function fireSpeechResult(page, transcript) {
  await page.evaluate(t => {
    // @ts-ignore
    const rec = window.__lastSpeechRecognition;
    rec.onresult({ results: [[{ transcript: t }]] });
    rec.onend();
  }, transcript);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} errorCode
 */
async function fireSpeechError(page, errorCode) {
  await page.evaluate(code => {
    // @ts-ignore
    const rec = window.__lastSpeechRecognition;
    rec.onerror({ error: code });
    rec.onend();
  }, errorCode);
}

test.beforeEach(async ({ page }) => {
  await stubSpeechRecognition(page);
});

test('mic button is visible when the Web Speech API is available', async ({ page }) => {
  await page.goto('/');
  await ensureOnboarded(page);

  await page.click('#newItemBtn');
  await page.waitForSelector('#itemForm', { state: 'visible' });

  await expect(page.locator('.mic-btn .btn')).toBeVisible();
});

test('dictating the full grammar fills name, quantity, and shelf-life days', async ({ page }) => {
  await page.goto('/');
  await ensureOnboarded(page);

  await page.click('#newItemBtn');
  await page.waitForSelector('#itemForm', { state: 'visible' });

  await page.click('.mic-btn .btn');
  await expect(page.locator('.voice-status')).toHaveText('Escuchando…');

  await fireSpeechResult(page, 'leche cantidad dos litros vencimiento en cinco dias');

  await expect(page.locator('#itemForm input[name="itemName"]')).toHaveValue('Leche');
  await expect(page.locator('#itemForm input[name="quantity"]')).toHaveValue('dos litros');
  await expect(page.locator('#itemForm input[name="shelfLifeDays"]')).toHaveValue('5');
  await expect(page.locator('.voice-status')).toContainText('Leche');
});

test('dictating an absolute date fills the use-by date instead of shelf-life days', async ({ page }) => {
  await page.goto('/');
  await ensureOnboarded(page);

  await page.click('#newItemBtn');
  await page.waitForSelector('#itemForm', { state: 'visible' });

  await page.click('.mic-btn .btn');
  await fireSpeechResult(page, 'yogur vencimiento el veinte de agosto');

  await expect(page.locator('#itemForm input[name="itemName"]')).toHaveValue('Yogur');
  await expect(page.locator('#itemForm input[name="useByDate"]')).not.toHaveValue('');
  await expect(page.locator('#itemForm input[name="shelfLifeDays"]')).toHaveValue('');
});

test('submitting a dictated item actually creates it', async ({ page }) => {
  await page.goto('/');
  await ensureOnboarded(page);

  await page.click('#newItemBtn');
  await page.waitForSelector('#itemForm', { state: 'visible' });

  await page.click('.mic-btn .btn');
  await fireSpeechResult(page, 'manzanas vencimiento en cinco dias');
  await page.click('#itemForm .submit');

  await expect(page.locator('#itemForm')).toBeHidden();
  await expect(page.locator('.list .row', { hasText: 'Manzanas' })).toBeVisible();
});

test('an unrecognized transcript shows an error and leaves fields untouched', async ({ page }) => {
  await page.goto('/');
  await ensureOnboarded(page);

  await page.click('#newItemBtn');
  await page.waitForSelector('#itemForm', { state: 'visible' });

  await page.click('.mic-btn .btn');
  await fireSpeechResult(page, 'cantidad vencimiento');

  await expect(page.locator('#itemForm input[name="itemName"]')).toHaveValue('');
  await expect(page.locator('.voice-status')).toContainText('No se entendió');
});

test('a speech recognition error shows a friendly message', async ({ page }) => {
  await page.goto('/');
  await ensureOnboarded(page);

  await page.click('#newItemBtn');
  await page.waitForSelector('#itemForm', { state: 'visible' });

  await page.click('.mic-btn .btn');
  await fireSpeechError(page, 'no-speech');

  await expect(page.locator('.voice-status')).toHaveText('No se detectó voz. Probá de nuevo.');
});

test('reopening the item form clears a stale status message from a previous attempt', async ({ page }) => {
  await page.goto('/');
  await ensureOnboarded(page);

  await page.click('#newItemBtn');
  await page.waitForSelector('#itemForm', { state: 'visible' });

  await page.click('.mic-btn .btn');
  await fireSpeechError(page, 'no-speech');
  await expect(page.locator('.voice-status')).not.toHaveText('');

  // Close via the header's back button (no submit) and reopen - the item
  // form is its own routed page, not a modal.
  await page.click('#goBack2 .btn');
  await page.waitForSelector('#itemForm', { state: 'hidden' });
  await page.click('#newItemBtn');
  await page.waitForSelector('#itemForm', { state: 'visible' });

  await expect(page.locator('.voice-status')).toHaveText('');
});
