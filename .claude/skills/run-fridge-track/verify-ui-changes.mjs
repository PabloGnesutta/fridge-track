/**
 * Verifies today's item-form UI changes using an already-allow-listed,
 * already-verified login (drive-check@test.local) instead of a fresh
 * signup - a fresh signup's allow-list write races against the long-running
 * dev server's own sqlite connection and is unreliable (a pre-existing
 * environment issue, not something these UI changes touch).
 *
 * Checks:
 *  - quantity field hidden
 *  - due-divider reads "o en días"
 *  - addedDate field sits after notes in DOM order
 *  - new #newItemVoiceBtn FAB opens the item form, starts dictation
 *    immediately, and does NOT focus itemName
 *  - dictating "Leche vence en tres dias" (using "vence" instead of
 *    "vencimiento") fills the form correctly
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const EMAIL = process.env.EMAIL || 'drive-check@test.local';
const PASSWORD = process.env.PASSWORD || 'password123';
const SHOTS_DIR = process.env.SHOTS_DIR || join(__dirname, 'shots');
mkdirSync(SHOTS_DIR, { recursive: true });

let failures = 0;
function check(label, ok) {
  console.log(ok ? '[PASS]' : '[FAIL]', label);
  if (!ok) failures++;
}

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

// Stub speech recognition before any app script runs - headless Chromium
// has no real mic/network path (same approach as e2e/voice-item.spec.js).
await page.addInitScript(() => {
  class FakeSpeechRecognition {
    constructor() { window.__lastSpeechRecognition = this; }
    start() {}
    stop() { if (this.onend) this.onend(); }
  }
  window.SpeechRecognition = FakeSpeechRecognition;
  window.webkitSpeechRecognition = FakeSpeechRecognition;
});

await page.goto(BASE_URL);
await page.fill('#authForm input[name="authEmail"]', EMAIL);
await page.fill('#authForm input[name="authPassword"]', PASSWORD);
await page.click('#authForm .submit .base-button');
await page.waitForSelector('.location-chips .location-chip', { timeout: 15000 });

// --- Open the form normally first to check field layout ---
await page.click('#newItemBtn');
await page.waitForSelector('#itemForm:not(.display-none)', { timeout: 5000 });

check('quantity field is hidden', !(await page.locator('#itemForm input[name="quantity"]').isVisible()));
check('due-divider reads "o en días"', (await page.locator('#itemForm .due-divider').textContent()).trim() === 'o en días');

const fieldOrder = await page.locator('#itemForm .form-content > .form-control').evaluateAll(
  els => els.map(el => el.querySelector('input,textarea')?.getAttribute('name')),
);
console.log('field order:', fieldOrder);
const notesIdx = fieldOrder.indexOf('itemNotes');
const addedDateIdx = fieldOrder.indexOf('addedDate');
check('addedDate comes after itemNotes', notesIdx !== -1 && addedDateIdx !== -1 && addedDateIdx > notesIdx);

// Close this form via backdrop (top-left corner, above .content) without submitting.
await page.click('#main-modal .backdrop', { position: { x: 5, y: 5 } });
await page.waitForSelector('#itemForm.display-none', { timeout: 5000 }).catch(() => {});

// --- Voice FAB: open + start listening immediately, no focus on itemName ---
await page.waitForSelector('#newItemVoiceBtn .btn', { timeout: 5000 });
const shot1 = join(SHOTS_DIR, 'fabs.png');
await page.screenshot({ path: shot1 });
console.log('[verify] FABs screenshot:', shot1);

await page.click('#newItemVoiceBtn .btn');
await page.waitForSelector('#itemForm:not(.display-none)', { timeout: 5000 });

const activeIsName = await page.evaluate(() =>
  document.activeElement === document.querySelector('#itemForm input[name="itemName"]'));
check('itemName is NOT focused when opened via voice FAB', !activeIsName);

const statusText = await page.locator('#itemForm .voice-status').textContent();
check('voice status shows "Escuchando…" immediately', statusText.trim() === 'Escuchando…');

// --- Fire a fake dictation result using "vence" instead of "vencimiento" ---
await page.evaluate(() => {
  const rec = window.__lastSpeechRecognition;
  rec.onresult({ results: [[{ transcript: 'leche vence en tres dias' }]] });
  rec.onend();
});

await page.waitForFunction(
  () => document.querySelector('#itemForm input[name="itemName"]')?.value === 'Leche',
  { timeout: 5000 },
);
check('name filled via "vence"', (await page.locator('#itemForm input[name="itemName"]').inputValue()) === 'Leche');
check('shelfLifeDays filled via "vence"', (await page.locator('#itemForm input[name="shelfLifeDays"]').inputValue()) === '3');

const shot2 = join(SHOTS_DIR, 'voice-fab-dictation.png');
await page.screenshot({ path: shot2 });
console.log('[verify] dictation screenshot:', shot2);

console.log('[verify] console/page errors:', errors.length ? JSON.stringify(errors, null, 2) : 'none');
console.log(failures === 0 ? `\nALL CHECKS PASSED` : `\n${failures} CHECK(S) FAILED`);

await browser.close();
process.exit(failures === 0 && errors.length === 0 ? 0 : 1);
