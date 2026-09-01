import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrate.js';
import { migrations } from '../src/db/migrations/index.js';
import { addAllowedEmail } from '../src/db/allowedEmails.js';
import { createAuthService } from '../src/services/authService.js';
import { createHomeService } from '../src/services/homeService.js';
import { createPushService } from '../src/services/pushService.js';


function makeServices() {
  const db = new DatabaseSync(':memory:');
  runMigrations(db, migrations);
  return {
    authService: createAuthService(db),
    homeService: createHomeService(db),
    pushService: createPushService(db),
    db,
  };
}

function makeSubscription(overrides = {}) {
  return {
    endpoint: 'https://push.example/abc',
    keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
    ...overrides,
  };
}

test('saveSubscription stores a subscription retrievable by user', () => {
  const services = makeServices();
  addAllowedEmail(services.db, 'a@test.local');
  const user = services.authService.createUser('a@test.local', 'password123');

  services.pushService.saveSubscription(user.id, makeSubscription());

  const byUser = services.pushService.listAllSubscriptionsGroupedByUser();
  assert.deepEqual(byUser.get(user.id), [{ endpoint: 'https://push.example/abc', keys: { p256dh: 'p256dh-key', auth: 'auth-key' } }]);
});

test('saveSubscription upserts by endpoint rather than duplicating', () => {
  const services = makeServices();
  addAllowedEmail(services.db, 'a@test.local');
  const user = services.authService.createUser('a@test.local', 'password123');

  services.pushService.saveSubscription(user.id, makeSubscription());
  services.pushService.saveSubscription(user.id, makeSubscription({ keys: { p256dh: 'new-p256dh', auth: 'new-auth' } }));

  const byUser = services.pushService.listAllSubscriptionsGroupedByUser();
  const subs = byUser.get(user.id);
  assert.equal(subs.length, 1);
  assert.equal(subs[0].keys.p256dh, 'new-p256dh');
});

test('removeSubscription deletes it', () => {
  const services = makeServices();
  addAllowedEmail(services.db, 'a@test.local');
  const user = services.authService.createUser('a@test.local', 'password123');
  services.pushService.saveSubscription(user.id, makeSubscription());

  services.pushService.removeSubscription(user.id, 'https://push.example/abc');

  const byUser = services.pushService.listAllSubscriptionsGroupedByUser();
  assert.equal(byUser.has(user.id), false);
});

test('removeSubscriptionByEndpoint deletes regardless of user', () => {
  const services = makeServices();
  addAllowedEmail(services.db, 'a@test.local');
  const user = services.authService.createUser('a@test.local', 'password123');
  services.pushService.saveSubscription(user.id, makeSubscription());

  services.pushService.removeSubscriptionByEndpoint('https://push.example/abc');

  const byUser = services.pushService.listAllSubscriptionsGroupedByUser();
  assert.equal(byUser.has(user.id), false);
});

test('hasSentToday/recordSent dedup by (user, home, date)', () => {
  const services = makeServices();
  addAllowedEmail(services.db, 'a@test.local');
  const user = services.authService.createUser('a@test.local', 'password123');
  const home = services.homeService.createHome(user.id, 'Casa');

  assert.equal(services.pushService.hasSentToday(user.id, home.id, '2026-08-12'), false);
  services.pushService.recordSent(user.id, home.id, '2026-08-12');
  assert.equal(services.pushService.hasSentToday(user.id, home.id, '2026-08-12'), true);
  // A different day is independent.
  assert.equal(services.pushService.hasSentToday(user.id, home.id, '2026-08-13'), false);
});

test('recordSent does not throw when called twice for the same (user, home, date)', () => {
  const services = makeServices();
  addAllowedEmail(services.db, 'a@test.local');
  const user = services.authService.createUser('a@test.local', 'password123');
  const home = services.homeService.createHome(user.id, 'Casa');

  services.pushService.recordSent(user.id, home.id, '2026-08-12');
  assert.doesNotThrow(() => services.pushService.recordSent(user.id, home.id, '2026-08-12'));
});

test('listAllSubscriptionsGroupedByUser excludes a user who has turned push off', () => {
  const services = makeServices();
  addAllowedEmail(services.db, 'a@test.local');
  const user = services.authService.createUser('a@test.local', 'password123');
  services.pushService.saveSubscription(user.id, makeSubscription());

  services.authService.updateNotificationPreferences(user.id, { pushEnabled: false });

  const byUser = services.pushService.listAllSubscriptionsGroupedByUser();
  assert.equal(byUser.has(user.id), false);
});

test('getNotificationHour returns the column default, then the updated value', () => {
  const services = makeServices();
  addAllowedEmail(services.db, 'a@test.local');
  const user = services.authService.createUser('a@test.local', 'password123');

  assert.equal(services.pushService.getNotificationHour(user.id), 12);

  services.authService.updateNotificationPreferences(user.id, { notificationHour: 3 });
  assert.equal(services.pushService.getNotificationHour(user.id), 3);
});

test('getNotificationHour returns null for a nonexistent user', () => {
  const services = makeServices();
  assert.equal(services.pushService.getNotificationHour(999999), null);
});

test('listAllSubscriptionsGroupedByUser includes the user again once push is re-enabled', () => {
  const services = makeServices();
  addAllowedEmail(services.db, 'a@test.local');
  const user = services.authService.createUser('a@test.local', 'password123');
  services.pushService.saveSubscription(user.id, makeSubscription());

  services.authService.updateNotificationPreferences(user.id, { pushEnabled: false });
  services.authService.updateNotificationPreferences(user.id, { pushEnabled: true });

  const byUser = services.pushService.listAllSubscriptionsGroupedByUser();
  assert.equal(byUser.has(user.id), true);
});
