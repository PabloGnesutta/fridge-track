import { test, expect } from '@playwright/test';
import { ensureAuth, ensureHome, ensureLocation, joinHome, getJoinCode, addItem } from './helpers.js';


test('locations, items, and deletes propagate between two devices sharing a Home', async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    // Device A creates the shared Home; Device B joins it via the code read
    // straight out of A's IndexedDB (the app has no UI to display it).
    await pageA.goto('/');
    await ensureAuth(pageA);
    await ensureHome(pageA, 'Hogar Sync Test');
    const joinCode = await getJoinCode(pageA);

    await pageB.goto('/');
    await ensureAuth(pageB);
    await joinHome(pageB, joinCode);

    // Device A creates a location, then an item in it. Both writes trigger
    // their own background push (see location-db.js's scheduleLocationSync
    // and item-db.js's scheduleItemSync) - Device B should see both after
    // just reloading, with no reload needed on A first.
    await ensureLocation(pageA, 'Heladera Sync');
    await addItem(pageA, { name: 'Leche Sync', shelfLifeDays: 5 });
    await pageA.waitForTimeout(500);

    await pageB.reload();
    await expect(pageB.locator('.location-chip .locationName', { hasText: 'Heladera Sync' })).toBeVisible();
    await expect(pageB.locator('.list .row', { hasText: 'Leche Sync' })).toBeVisible();

    // Device A deletes the item; the delete itself triggers its own
    // background push too, so Device B should see it gone after just
    // reloading (tombstone propagation, no reload needed on A first).
    await pageA.locator('.list .row', { hasText: 'Leche Sync' }).click();
    await pageA.click('#singleItemView .delete-btn');
    await pageA.waitForSelector('#singleItemView', { state: 'hidden' });
    await pageA.waitForTimeout(500);

    await pageB.reload();
    await expect(pageB.locator('.list .row', { hasText: 'Leche Sync' })).toHaveCount(0);
    await expect(pageB.locator('.location-chip .locationName', { hasText: 'Heladera Sync' })).toBeVisible();

    // Device A deletes the location itself; after resync, Device B should
    // lose the location and its chip too (cascade tombstone propagation).
    pageA.once('dialog', dialog => dialog.accept());
    await pageA.locator('.location-chip', { hasText: 'Heladera Sync' }).locator('.icon-btn').click();
    await pageA.click('#deleteLocationBtn');
    await pageA.waitForTimeout(500);

    await pageB.reload();
    await expect(pageB.locator('.location-chip .locationName', { hasText: 'Heladera Sync' })).toHaveCount(0);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
