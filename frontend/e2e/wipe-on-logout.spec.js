import { test, expect } from '@playwright/test';
import { ensureOnboarded, addItem } from './helpers.js';

/**
 * Reads every record out of the given IndexedDB store directly - used here
 * instead of any app UI, since after a wipe the app is back at the login
 * screen with no data-bearing view to inspect visually.
 *
 * Always closes its own connection before resolving - a lingering open
 * connection here would otherwise block clearAllData()'s
 * indexedDB.deleteDatabase() call (fires onblocked, never completes), the
 * same class of concurrent-connection issue documented elsewhere in this
 * app for the CLI/server case.
 * @param {import('@playwright/test').Page} page
 * @param {string} storeName
 * @returns {Promise<number>}
 */
async function countStoreRecords(page, storeName) {
  return page.evaluate(name => new Promise((resolve, reject) => {
    const request = indexedDB.open('FridgeTrack');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(name)) { db.close(); resolve(0); return; }
      const tx = db.transaction(name, 'readonly');
      const countRequest = tx.objectStore(name).count();
      countRequest.onsuccess = () => { db.close(); resolve(countRequest.result); };
      countRequest.onerror = () => { db.close(); reject(countRequest.error); };
    };
  }), storeName);
}

test('confirming the wipe dialog clears local IndexedDB data', async ({ page }) => {
  await page.goto('/');
  await ensureOnboarded(page);
  await addItem(page, { name: 'Leche Wipe Test', shelfLifeDays: 5 });

  expect(await countStoreRecords(page, 'items')).toBeGreaterThan(0);
  expect(await countStoreRecords(page, 'locations')).toBeGreaterThan(0);

  await page.click('#logoutBtn .btn');
  await page.click('#confirmOkBtn'); // confirm sign-out
  await expect(page.locator('#authView')).toBeVisible();

  await expect(page.locator('#confirmDialog')).toHaveClass(/open/);
  await page.click('#confirmOkBtn'); // confirm wipe
  await page.waitForLoadState('load'); // the wipe path reloads the page

  await expect(page.locator('#authView')).toBeVisible();
  expect(await countStoreRecords(page, 'items')).toBe(0);
  expect(await countStoreRecords(page, 'locations')).toBe(0);
});

test('cancelling the wipe dialog leaves local data intact', async ({ page }) => {
  await page.goto('/');
  await ensureOnboarded(page);
  await addItem(page, { name: 'Queso Wipe Test', shelfLifeDays: 5 });

  await page.click('#logoutBtn .btn');
  await page.click('#confirmOkBtn'); // confirm sign-out
  await expect(page.locator('#authView')).toBeVisible();

  await expect(page.locator('#confirmDialog')).toHaveClass(/open/);
  await page.click('#confirmCancelBtn'); // cancel the wipe
  await expect(page.locator('#confirmDialog')).not.toHaveClass(/open/);

  expect(await countStoreRecords(page, 'items')).toBeGreaterThan(0);
  expect(await countStoreRecords(page, 'locations')).toBeGreaterThan(0);
});
