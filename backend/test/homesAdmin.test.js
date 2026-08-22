import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrate.js';
import { migrations } from '../src/db/migrations/index.js';
import { addAllowedEmail } from '../src/db/allowedEmails.js';
import { createAuthService } from '../src/services/authService.js';
import { createHomeService } from '../src/services/homeService.js';
import { createSyncService } from '../src/services/syncService.js';
import { listHomes, previewHomeCascade, deleteHomeCascade } from '../src/db/homesAdmin.js';


function makeServices() {
  const db = new DatabaseSync(':memory:');
  runMigrations(db, migrations);
  return {
    authService: createAuthService(db),
    homeService: createHomeService(db),
    syncService: createSyncService(db),
    db,
  };
}

function makeUserAndHome(services, email = 'a@test.local', homeName = 'Casa de Prueba') {
  addAllowedEmail(services.db, email);
  const user = services.authService.createUser(email, 'password123');
  const home = services.homeService.createHome(user.id, homeName);
  return { user, home };
}

function getCategoryId(db, homeId, name = 'Alimentos') {
  /** @type {{id: string}} */ // @ts-ignore
  const row = db.prepare('SELECT id FROM categories WHERE home_id = ? AND name = ?').get(homeId, name);
  return row.id;
}

test('listHomes returns every Home with member/location/item counts and the creator email', () => {
  const services = makeServices();
  const { user, home } = makeUserAndHome(services, 'owner@test.local', 'Casa Listada');
  const categoryId = getCategoryId(services.db, home.id);

  services.syncService.pushHomeSnapshot(user.id, home.id, {
    locations: [{
      id: 'loc-1', homeId: home.id, name: 'Heladera', categoryId, createdAt: 1000, updatedAt: 1000, deletedAt: null,
    }],
    items: [{
      id: 'item-1', locationId: 'loc-1', homeId: home.id, name: 'Leche', normalizedName: 'leche',
      addedDate: 1000, createdAt: 1000, updatedAt: 1000, deletedAt: null,
    }],
  });

  const homes = listHomes(services.db);
  const listed = homes.find(h => h.id === home.id);
  assert.ok(listed);
  assert.equal(listed.name, 'Casa Listada');
  assert.equal(listed.createdByEmail, 'owner@test.local');
  assert.equal(listed.memberCount, 1);
  assert.equal(listed.locationCount, 1);
  assert.equal(listed.itemCount, 1);
});

test('previewHomeCascade counts match what deleteHomeCascade actually removes, and does not delete anything itself', () => {
  const services = makeServices();
  const { user, home } = makeUserAndHome(services);
  const categoryId = getCategoryId(services.db, home.id);

  services.syncService.pushHomeSnapshot(user.id, home.id, {
    locations: [{
      id: 'loc-1', homeId: home.id, name: 'Heladera', categoryId, createdAt: 1000, updatedAt: 1000, deletedAt: null,
    }],
    items: [{
      id: 'item-1', locationId: 'loc-1', homeId: home.id, name: 'Leche', normalizedName: 'leche',
      addedDate: 1000, createdAt: 1000, updatedAt: 1000, deletedAt: null,
    }],
    foodNameHistory: [{
      homeId: home.id, categoryId, normalizedName: 'leche', name: 'Leche',
      firstCreatedAt: 1000, timesDiscarded: 0, timesUsed: 0, updatedAt: 1000,
    }],
  });

  const preview = previewHomeCascade(services.db, home.id);
  assert.equal(preview.home?.id, home.id);
  assert.equal(preview.items, 1);
  assert.equal(preview.locations, 1);
  assert.equal(preview.foodNameHistory, 1);
  assert.equal(preview.categories, 3); // the 3 built-ins
  assert.equal(preview.members, 1);

  // A preview must not have deleted anything - the Home is still fully there.
  assert.equal(services.db.prepare('SELECT COUNT(*) c FROM homes WHERE id = ?').get(home.id).c, 1);

  const result = deleteHomeCascade(services.db, home.id);
  assert.deepEqual(result, {
    home: { id: home.id, name: 'Casa de Prueba' },
    items: preview.items,
    locations: preview.locations,
    foodNameHistory: preview.foodNameHistory,
    categories: preview.categories,
    members: preview.members,
    notificationLog: preview.notificationLog,
  });
});

test('deleteHomeCascade removes every referencing row with no dangling foreign keys left behind', () => {
  const services = makeServices();
  const { user, home } = makeUserAndHome(services);
  const categoryId = getCategoryId(services.db, home.id);

  services.syncService.pushHomeSnapshot(user.id, home.id, {
    locations: [{
      id: 'loc-1', homeId: home.id, name: 'Heladera', categoryId, createdAt: 1000, updatedAt: 1000, deletedAt: null,
    }],
    items: [{
      id: 'item-1', locationId: 'loc-1', homeId: home.id, name: 'Leche', normalizedName: 'leche',
      addedDate: 1000, createdAt: 1000, updatedAt: 1000, deletedAt: null,
    }],
    foodNameHistory: [{
      homeId: home.id, categoryId, normalizedName: 'leche', name: 'Leche',
      firstCreatedAt: 1000, timesDiscarded: 0, timesUsed: 0, updatedAt: 1000,
    }],
  });

  deleteHomeCascade(services.db, home.id);

  assert.equal(services.db.prepare('SELECT COUNT(*) c FROM homes WHERE id = ?').get(home.id).c, 0);
  assert.equal(services.db.prepare('SELECT COUNT(*) c FROM home_members WHERE home_id = ?').get(home.id).c, 0);
  assert.equal(services.db.prepare('SELECT COUNT(*) c FROM locations WHERE home_id = ?').get(home.id).c, 0);
  assert.equal(services.db.prepare('SELECT COUNT(*) c FROM items WHERE home_id = ?').get(home.id).c, 0);
  assert.equal(services.db.prepare('SELECT COUNT(*) c FROM food_name_history WHERE home_id = ?').get(home.id).c, 0);
  assert.equal(services.db.prepare('SELECT COUNT(*) c FROM categories WHERE home_id = ?').get(home.id).c, 0);
  assert.deepEqual(services.db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('deleteHomeCascade leaves another Home (and a shared user\'s membership in it) untouched', () => {
  const services = makeServices();
  addAllowedEmail(services.db, 'member@test.local');
  const user = services.authService.createUser('member@test.local', 'password123');
  const homeA = services.homeService.createHome(user.id, 'Casa A');
  const homeB = services.homeService.createHome(user.id, 'Casa B');

  deleteHomeCascade(services.db, homeA.id);

  assert.equal(services.db.prepare('SELECT COUNT(*) c FROM homes WHERE id = ?').get(homeB.id).c, 1);
  assert.equal(services.db.prepare('SELECT COUNT(*) c FROM home_members WHERE home_id = ?').get(homeB.id).c, 1);
  assert.equal(services.db.prepare('SELECT COUNT(*) c FROM categories WHERE home_id = ?').get(homeB.id).c, 3);
  // The user itself (a member of both) survives - only membership in the deleted Home is gone.
  assert.equal(services.db.prepare('SELECT COUNT(*) c FROM users WHERE id = ?').get(user.id).c, 1);
});

test('deleteHomeCascade returns null for a nonexistent Home id, without throwing', () => {
  const services = makeServices();
  assert.equal(deleteHomeCascade(services.db, 999999), null);
});

test('previewHomeCascade returns a null home for a nonexistent Home id', () => {
  const services = makeServices();
  const preview = previewHomeCascade(services.db, 999999);
  assert.equal(preview.home, null);
  assert.equal(preview.items, 0);
});
