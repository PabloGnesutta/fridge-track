import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrate.js';
import { migrations } from '../src/db/migrations/index.js';
import { addAllowedEmail } from '../src/db/allowedEmails.js';
import { createAuthService } from '../src/services/authService.js';
import { createHomeService } from '../src/services/homeService.js';
import { createPushService } from '../src/services/pushService.js';
import { findUserByEmail, previewUserCascade, deleteUserCascade } from '../src/db/admin/usersAdmin.js';


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

function makeUser(services, email = 'a@test.local') {
  addAllowedEmail(services.db, email);
  return services.authService.createUser(email, 'password123');
}

test('findUserByEmail is case-insensitive, mirroring allowedEmails.js', () => {
  const services = makeServices();
  const user = makeUser(services, 'a@test.local');
  const found = findUserByEmail(services.db, 'A@Test.Local');
  assert.equal(found.id, user.id);
});

test('previewUserCascade returns a null user for a nonexistent email', () => {
  const services = makeServices();
  const preview = previewUserCascade(services.db, 'nobody@test.local');
  assert.equal(preview.user, null);
  assert.equal(preview.sessions, 0);
  assert.deepEqual(preview.homesCreated, []);
});

test('previewUserCascade counts sessions, push subscriptions, notification log, memberships, and Homes created', () => {
  const services = makeServices();
  const user = makeUser(services, 'owner@test.local');
  const home = services.homeService.createHome(user.id, 'Casa de Prueba');
  services.authService.createSession(user.id);
  services.pushService.saveSubscription(user.id, { endpoint: 'https://push.example/1', keys: { p256dh: 'k', auth: 'a' } });
  services.pushService.recordSent(user.id, home.id, '2026-01-01');

  const preview = previewUserCascade(services.db, 'owner@test.local');
  assert.equal(preview.user?.email, 'owner@test.local');
  assert.equal(preview.sessions, 1);
  assert.equal(preview.pushSubscriptions, 1);
  assert.equal(preview.notificationLog, 1);
  assert.equal(preview.memberships, 1); // creating a Home also makes you its first member
  assert.equal(preview.homesCreated.length, 1);
  assert.equal(preview.homesCreated[0].name, 'Casa de Prueba');
  assert.equal(preview.homesCreated[0].memberCount, 1);

  // A preview must not have deleted anything.
  assert.equal(services.db.prepare('SELECT COUNT(*) c FROM users WHERE id = ?').get(user.id).c, 1);
});

test('previewUserCascade flags a Home with other members, so an operator can see the blast radius before deleting', () => {
  const services = makeServices();
  const owner = makeUser(services, 'owner@test.local');
  const joiner = makeUser(services, 'joiner@test.local');
  const home = services.homeService.createHome(owner.id, 'Casa Compartida');
  services.homeService.joinHome(joiner.id, home.joinCode);

  const preview = previewUserCascade(services.db, 'owner@test.local');
  assert.equal(preview.homesCreated[0].memberCount, 2);
});

test('deleteUserCascade removes the user, their sessions/subscriptions/log/memberships, and every Home they created', () => {
  const services = makeServices();
  const user = makeUser(services, 'owner@test.local');
  const otherOwner = makeUser(services, 'other-owner@test.local');
  const home = services.homeService.createHome(user.id, 'Casa de Prueba');
  // A second Home the user belongs to but didn't create - its own
  // notification-log row is only removable via deleteUserCascade's leaf
  // cleanup, not via a per-home cascade (that only fires for Homes this
  // user actually created), so this is what actually exercises that path.
  const otherHome = services.homeService.createHome(otherOwner.id, 'Otra Casa');
  services.homeService.joinHome(user.id, otherHome.joinCode);

  services.authService.createSession(user.id);
  services.pushService.saveSubscription(user.id, { endpoint: 'https://push.example/1', keys: { p256dh: 'k', auth: 'a' } });
  services.pushService.recordSent(user.id, otherHome.id, '2026-01-01');

  const result = deleteUserCascade(services.db, 'owner@test.local');

  assert.equal(result.user.email, 'owner@test.local');
  assert.equal(result.sessions, 1);
  assert.equal(result.pushSubscriptions, 1);
  assert.equal(result.notificationLog, 1);
  assert.deepEqual(result.deletedHomes, [{ id: home.id, name: 'Casa de Prueba' }]);

  assert.equal(services.db.prepare('SELECT COUNT(*) c FROM users WHERE id = ?').get(user.id).c, 0);
  assert.equal(services.db.prepare('SELECT COUNT(*) c FROM sessions WHERE user_id = ?').get(user.id).c, 0);
  assert.equal(services.db.prepare('SELECT COUNT(*) c FROM homes WHERE id = ?').get(home.id).c, 0);
  // otherHome wasn't created by this user, so it survives - only their own
  // membership/notification-log row in it is gone.
  assert.equal(services.db.prepare('SELECT COUNT(*) c FROM homes WHERE id = ?').get(otherHome.id).c, 1);
  assert.deepEqual(services.db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('deleting a user who only joined (never created) a Home leaves that Home and its other members untouched', () => {
  const services = makeServices();
  const owner = makeUser(services, 'owner@test.local');
  const joiner = makeUser(services, 'joiner@test.local');
  const home = services.homeService.createHome(owner.id, 'Casa Compartida');
  services.homeService.joinHome(joiner.id, home.joinCode);

  const result = deleteUserCascade(services.db, 'joiner@test.local');

  assert.deepEqual(result.deletedHomes, []); // joiner didn't create it, so it isn't cascade-deleted
  assert.equal(services.db.prepare('SELECT COUNT(*) c FROM users WHERE id = ?').get(joiner.id).c, 0);
  assert.equal(services.db.prepare('SELECT COUNT(*) c FROM homes WHERE id = ?').get(home.id).c, 1);
  assert.equal(services.db.prepare('SELECT COUNT(*) c FROM users WHERE id = ?').get(owner.id).c, 1);
  assert.equal(services.db.prepare('SELECT COUNT(*) c FROM home_members WHERE home_id = ?').get(home.id).c, 1);
  assert.deepEqual(services.db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('deleting a Home\'s creator also removes it for every other member, with no dangling foreign keys', () => {
  const services = makeServices();
  const owner = makeUser(services, 'owner@test.local');
  const joiner = makeUser(services, 'joiner@test.local');
  const home = services.homeService.createHome(owner.id, 'Casa Compartida');
  services.homeService.joinHome(joiner.id, home.joinCode);

  deleteUserCascade(services.db, 'owner@test.local');

  assert.equal(services.db.prepare('SELECT COUNT(*) c FROM homes WHERE id = ?').get(home.id).c, 0);
  assert.equal(services.db.prepare('SELECT COUNT(*) c FROM home_members WHERE home_id = ?').get(home.id).c, 0);
  // The other member's account itself survives - only that Home is gone.
  assert.equal(services.db.prepare('SELECT COUNT(*) c FROM users WHERE id = ?').get(joiner.id).c, 1);
  assert.deepEqual(services.db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('deleteUserCascade returns null for a nonexistent email, without throwing', () => {
  const services = makeServices();
  assert.equal(deleteUserCascade(services.db, 'nobody@test.local'), null);
});
