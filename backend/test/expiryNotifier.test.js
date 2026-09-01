import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrate.js';
import { migrations } from '../src/db/migrations/index.js';
import { addAllowedEmail } from '../src/db/allowedEmails.js';
import { createAuthService } from '../src/services/authService.js';
import { createHomeService } from '../src/services/homeService.js';
import { createSyncService } from '../src/services/syncService.js';
import { createPushService } from '../src/services/pushService.js';
import { runNotificationTick } from '../src/scheduler/expiryNotifier.js';


function makeServices() {
  const db = new DatabaseSync(':memory:');
  runMigrations(db, migrations);
  return {
    authService: createAuthService(db),
    homeService: createHomeService(db),
    syncService: createSyncService(db),
    pushService: createPushService(db),
    db,
  };
}

/** @param {import('node:sqlite').DatabaseSync} db */
function getCategoryId(db, homeId, name = 'Alimentos') {
  const row = db.prepare('SELECT id FROM categories WHERE home_id = ? AND name = ?').get(homeId, name);
  return row.id;
}

function makeLocation(homeId, categoryId) {
  return {
    id: 'loc-1', homeId, name: 'Heladera', categoryId,
    createdAt: 1000, updatedAt: 1000, deletedAt: null,
  };
}

/**
 * addedDate 1000 (near-epoch) plus a 5-day shelf life is always in the past
 * relative to any realistic test `now` - status computes to 'expired',
 * which counts toward the digest exactly like 'expiring-soon' does.
 */
function makeExpiringItem(homeId, locationId) {
  return {
    id: 'item-1', locationId, homeId, name: 'Leche', normalizedName: 'leche',
    quantity: '', addedDate: 1000, useByDate: null, shelfLifeDays: 5, notes: '',
    createdAt: 1000, updatedAt: 1000, deletedAt: null,
  };
}

function makeSubscription() {
  return { endpoint: 'https://push.example/abc', keys: { p256dh: 'p256dh-key', auth: 'auth-key' } };
}

/**
 * Stub for the injectable `webPush` param (see expiryNotifier.js) so tests
 * never need real VAPID keys configured - unlike the real client, this
 * never throws unless told to.
 */
function makeWebPushStub() {
  const calls = [];
  return { calls, webPush: { async sendNotification(subscription, payload) { calls.push({ subscription, payload }); } } };
}

/** @param {Date} date */
function localYYYYMMDD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function setUpUserWithExpiringItem(services, notificationHour) {
  addAllowedEmail(services.db, 'a@test.local');
  const user = services.authService.createUser('a@test.local', 'password123');
  const home = services.homeService.createHome(user.id, 'Casa');
  const categoryId = getCategoryId(services.db, home.id);
  const location = makeLocation(home.id, categoryId);
  const item = makeExpiringItem(home.id, location.id);
  services.syncService.pushHomeSnapshot(user.id, home.id, { locations: [location], items: [item] });
  services.pushService.saveSubscription(user.id, makeSubscription());
  services.authService.updateNotificationPreferences(user.id, { notificationHour });
  return { user, home };
}

test('runNotificationTick does not send before the user\'s notification hour (UTC)', async () => {
  const services = makeServices();
  const { user, home } = setUpUserWithExpiringItem(services, 15);
  const { webPush, calls } = makeWebPushStub();
  const now = new Date(Date.UTC(2026, 7, 12, 10, 0, 0)); // 10:00 UTC, before hour 15

  await runNotificationTick(services.db, { now, webPush });

  assert.equal(calls.length, 0);
  assert.equal(services.pushService.hasSentToday(user.id, home.id, localYYYYMMDD(now)), false);
});

test('runNotificationTick sends once the current UTC hour reaches the notification hour', async () => {
  const services = makeServices();
  const { user, home } = setUpUserWithExpiringItem(services, 15);
  const { webPush, calls } = makeWebPushStub();
  const now = new Date(Date.UTC(2026, 7, 12, 15, 0, 0)); // exactly 15:00 UTC

  await runNotificationTick(services.db, { now, webPush });

  assert.equal(calls.length, 1);
  assert.equal(services.pushService.hasSentToday(user.id, home.id, localYYYYMMDD(now)), true);
});

test('runNotificationTick still sends when now is well past the notification hour (catch-up)', async () => {
  const services = makeServices();
  const { user, home } = setUpUserWithExpiringItem(services, 9);
  const { webPush, calls } = makeWebPushStub();
  const now = new Date(Date.UTC(2026, 7, 12, 20, 0, 0)); // 20:00 UTC, well past hour 9

  await runNotificationTick(services.db, { now, webPush });

  assert.equal(calls.length, 1);
  assert.equal(services.pushService.hasSentToday(user.id, home.id, localYYYYMMDD(now)), true);
});
