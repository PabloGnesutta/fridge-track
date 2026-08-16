import { test, expect } from '@playwright/test';
import { ensureOnboarded, addItem } from './helpers.js';

/**
 * Reads every record out of BOTH stores in one atomic evaluate call -
 * instead of any app UI, since after a wipe the app is back at the login
 * screen with no data-bearing view to inspect visually.
 *
 * Deliberately a single round-trip (not one call per store): two separate
 * page.evaluate() calls left a real window for a navigation to land between
 * them (observed: "Execution context was destroyed" on the second call,
 * right after the wipe's reload - something in the app's own post-reload
 * boot sequence, not just the reload itself, was still settling). Reading
 * both stores in one script removes that gap entirely.
 *
 * Always closes its own connection before resolving - a lingering open
 * connection here would otherwise block clearAllData()'s
 * indexedDB.deleteDatabase() call (fires onblocked, never completes), the
 * same class of concurrent-connection issue documented elsewhere in this
 * app for the CLI/server case.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{items: number, locations: number}>}
 */
async function countStoreRecords(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('FridgeTrack');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const names = ['items', 'locations'].filter(n => db.objectStoreNames.contains(n));
      if (!names.length) { db.close(); resolve({ items: 0, locations: 0 }); return; }

      const tx = db.transaction(names, 'readonly');
      /** @type {{items: number, locations: number}} */
      const counts = { items: 0, locations: 0 };
      let remaining = names.length;
      names.forEach(name => {
        const countRequest = tx.objectStore(name).count();
        countRequest.onsuccess = () => {
          counts[name] = countRequest.result;
          remaining -= 1;
          if (remaining === 0) { db.close(); resolve(counts); }
        };
        countRequest.onerror = () => { db.close(); reject(countRequest.error); };
      });
    };
  }));
}

test('confirming the wipe dialog clears local IndexedDB data', async ({ page }) => {
  await page.goto('/');
  await ensureOnboarded(page);
  await addItem(page, { name: 'Leche Wipe Test', shelfLifeDays: 5 });

  expect(await countStoreRecords(page)).toEqual({ items: 1, locations: 1 });

  await page.click('#headerMenuBtn .btn');
  await page.click('#logoutBtn .btn');
  await page.click('#confirmOkBtn'); // confirm sign-out
  await expect(page.locator('#authView')).toBeVisible();

  await expect(page.locator('#confirmDialog')).toHaveClass(/open/);
  await page.click('#confirmOkBtn'); // confirm wipe
  await page.waitForLoadState('load'); // the wipe path reloads the page

  await expect(page.locator('#authView')).toBeVisible();
  expect(await countStoreRecords(page)).toEqual({ items: 0, locations: 0 });
});

test('cancelling the wipe dialog leaves local data intact', async ({ page }) => {
  await page.goto('/');
  await ensureOnboarded(page);
  await addItem(page, { name: 'Queso Wipe Test', shelfLifeDays: 5 });

  await page.click('#headerMenuBtn .btn');
  await page.click('#logoutBtn .btn');
  await page.click('#confirmOkBtn'); // confirm sign-out
  await expect(page.locator('#authView')).toBeVisible();

  await expect(page.locator('#confirmDialog')).toHaveClass(/open/);
  await page.click('#confirmCancelBtn'); // cancel the wipe
  await expect(page.locator('#confirmDialog')).not.toHaveClass(/open/);

  expect(await countStoreRecords(page)).toEqual({ items: 1, locations: 1 });
});
