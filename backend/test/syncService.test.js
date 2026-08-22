import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrate.js';
import { migrations } from '../src/db/migrations/index.js';
import { addAllowedEmail } from '../src/db/allowedEmails.js';
import { createAuthService } from '../src/services/authService.js';
import { createHomeService } from '../src/services/homeService.js';
import { createSyncService } from '../src/services/syncService.js';
import { ServiceError } from '../src/services/ServiceError.js';


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

function makeUserAndHome(services, email = 'a@test.local') {
  addAllowedEmail(services.db, email);
  const user = services.authService.createUser(email, 'password123');
  const home = services.homeService.createHome(user.id, 'Casa de Prueba');
  return { user, home };
}

/**
 * homeService.createHome() seeds the 3 built-in categories (Alimentos/
 * Medicamentos/Otros) for every new Home - tests that need a real,
 * already-existing category_id to build a location/food_name_history record
 * around look it up here rather than hardcoding one.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} homeId
 * @param {string} [name]
 * @returns {string}
 */
function getCategoryId(db, homeId, name = 'Alimentos') {
  /** @type {{id: string}} */ // @ts-ignore
  const row = db.prepare('SELECT id FROM categories WHERE home_id = ? AND name = ?').get(homeId, name);
  assert.ok(row, `expected a seeded "${name}" category for home ${homeId}`);
  return row.id;
}

function makeCategory(homeId, overrides = {}) {
  return {
    id: 'cat-custom-1',
    homeId,
    name: 'Congelador',
    createdAt: 1000,
    updatedAt: 1000,
    deletedAt: null,
    ...overrides,
  };
}

function makeLocation(homeId, categoryId, overrides = {}) {
  return {
    id: 'loc-1',
    homeId,
    name: 'Heladera',
    categoryId,
    createdAt: 1000,
    updatedAt: 1000,
    deletedAt: null,
    ...overrides,
  };
}

function makeItem(homeId, locationId, overrides = {}) {
  return {
    id: 'item-1',
    locationId,
    homeId,
    name: 'Leche',
    normalizedName: 'leche',
    quantity: '',
    addedDate: 1000,
    useByDate: null,
    shelfLifeDays: 5,
    notes: '',
    createdAt: 1000,
    updatedAt: 1000,
    deletedAt: null,
    ...overrides,
  };
}

test('push creates new records, pull returns them', () => {
  const services = makeServices();
  const { user, home } = makeUserAndHome(services);
  const categoryId = getCategoryId(services.db, home.id);
  const location = makeLocation(home.id, categoryId);
  const item = makeItem(home.id, location.id);

  services.syncService.pushHomeSnapshot(user.id, home.id, { locations: [location], items: [item] });
  const snapshot = services.syncService.pullHomeSnapshot(user.id, home.id);

  assert.equal(snapshot.locations.length, 1);
  assert.equal(snapshot.locations[0].name, 'Heladera');
  assert.equal(snapshot.items.length, 1);
  assert.equal(snapshot.items[0].name, 'Leche');
});

test('push with a stale updatedAt does not overwrite', () => {
  const services = makeServices();
  const { user, home } = makeUserAndHome(services);
  const categoryId = getCategoryId(services.db, home.id);
  const location = makeLocation(home.id, categoryId, { updatedAt: 2000 });
  services.syncService.pushHomeSnapshot(user.id, home.id, { locations: [location] });

  const stale = makeLocation(home.id, categoryId, { name: 'Freezer', updatedAt: 1000 });
  services.syncService.pushHomeSnapshot(user.id, home.id, { locations: [stale] });

  const snapshot = services.syncService.pullHomeSnapshot(user.id, home.id);
  assert.equal(snapshot.locations[0].name, 'Heladera');
});

test('push with a newer updatedAt does overwrite', () => {
  const services = makeServices();
  const { user, home } = makeUserAndHome(services);
  const categoryId = getCategoryId(services.db, home.id);
  const location = makeLocation(home.id, categoryId, { updatedAt: 1000 });
  services.syncService.pushHomeSnapshot(user.id, home.id, { locations: [location] });

  const newer = makeLocation(home.id, categoryId, { name: 'Freezer', updatedAt: 2000 });
  services.syncService.pushHomeSnapshot(user.id, home.id, { locations: [newer] });

  const snapshot = services.syncService.pullHomeSnapshot(user.id, home.id);
  assert.equal(snapshot.locations[0].name, 'Freezer');
});

test('push with an equal updatedAt does not overwrite', () => {
  const services = makeServices();
  const { user, home } = makeUserAndHome(services);
  const categoryId = getCategoryId(services.db, home.id);
  const location = makeLocation(home.id, categoryId, { updatedAt: 1000 });
  services.syncService.pushHomeSnapshot(user.id, home.id, { locations: [location] });

  const tied = makeLocation(home.id, categoryId, { name: 'Freezer', updatedAt: 1000 });
  services.syncService.pushHomeSnapshot(user.id, home.id, { locations: [tied] });

  const snapshot = services.syncService.pullHomeSnapshot(user.id, home.id);
  assert.equal(snapshot.locations[0].name, 'Heladera');
});

test('pull returns tombstoned rows', () => {
  const services = makeServices();
  const { user, home } = makeUserAndHome(services);
  const categoryId = getCategoryId(services.db, home.id);
  const location = makeLocation(home.id, categoryId, { updatedAt: 1000 });
  services.syncService.pushHomeSnapshot(user.id, home.id, { locations: [location] });

  const deleted = makeLocation(home.id, categoryId, { updatedAt: 2000, deletedAt: 2000 });
  services.syncService.pushHomeSnapshot(user.id, home.id, { locations: [deleted] });

  const snapshot = services.syncService.pullHomeSnapshot(user.id, home.id);
  assert.equal(snapshot.locations.length, 1);
  assert.equal(snapshot.locations[0].deletedAt, 2000);
});

test('membership is enforced for pull and push', () => {
  const services = makeServices();
  const { home } = makeUserAndHome(services, 'owner@test.local');
  addAllowedEmail(services.db, 'outsider@test.local');
  const outsider = services.authService.createUser('outsider@test.local', 'password123');

  assert.throws(() => services.syncService.pullHomeSnapshot(outsider.id, home.id), ServiceError);
  assert.throws(
    () => services.syncService.pushHomeSnapshot(outsider.id, home.id, { locations: [] }),
    ServiceError
  );
});

test('cross-Home isolation - a member of both Homes only sees each Home\'s own records', () => {
  const services = makeServices();
  addAllowedEmail(services.db, 'member@test.local');
  const user = services.authService.createUser('member@test.local', 'password123');
  const homeA = services.homeService.createHome(user.id, 'Casa A');
  const homeB = services.homeService.createHome(user.id, 'Casa B');
  const categoryIdA = getCategoryId(services.db, homeA.id);
  const categoryIdB = getCategoryId(services.db, homeB.id);

  services.syncService.pushHomeSnapshot(user.id, homeA.id, {
    locations: [makeLocation(homeA.id, categoryIdA, { id: 'loc-a', name: 'Solo en A' })],
  });
  services.syncService.pushHomeSnapshot(user.id, homeB.id, {
    locations: [makeLocation(homeB.id, categoryIdB, { id: 'loc-b', name: 'Solo en B' })],
  });

  const snapshotA = services.syncService.pullHomeSnapshot(user.id, homeA.id);
  const snapshotB = services.syncService.pullHomeSnapshot(user.id, homeB.id);
  assert.equal(snapshotA.locations.length, 1);
  assert.equal(snapshotA.locations[0].name, 'Solo en A');
  assert.equal(snapshotB.locations.length, 1);
  assert.equal(snapshotB.locations[0].name, 'Solo en B');
});

test('push skips a record whose homeId does not match the route param, without throwing', () => {
  const services = makeServices();
  const { user, home } = makeUserAndHome(services, 'member@test.local');
  const otherHome = services.homeService.createHome(user.id, 'Otra Casa');
  const categoryId = getCategoryId(services.db, otherHome.id);
  const mismatched = makeLocation(otherHome.id, categoryId);

  services.syncService.pushHomeSnapshot(user.id, home.id, { locations: [mismatched] });

  const snapshot = services.syncService.pullHomeSnapshot(user.id, home.id);
  assert.equal(snapshot.locations.length, 0);
});

test('food_name_history composite-key upsert respects LWW', () => {
  const services = makeServices();
  const { user, home } = makeUserAndHome(services);
  const categoryId = getCategoryId(services.db, home.id);
  const entry = {
    homeId: home.id,
    categoryId,
    normalizedName: 'leche',
    name: 'Leche',
    firstCreatedAt: 1000,
    shelfLifeDays: 5,
    timesDiscarded: 0,
    updatedAt: 1000,
  };
  services.syncService.pushHomeSnapshot(user.id, home.id, { foodNameHistory: [entry] });

  const newer = { ...entry, timesDiscarded: 1, updatedAt: 2000 };
  services.syncService.pushHomeSnapshot(user.id, home.id, { foodNameHistory: [newer] });

  const stale = { ...entry, timesDiscarded: 99, updatedAt: 1500 };
  services.syncService.pushHomeSnapshot(user.id, home.id, { foodNameHistory: [stale] });

  const snapshot = services.syncService.pullHomeSnapshot(user.id, home.id);
  assert.equal(snapshot.foodNameHistory.length, 1);
  assert.equal(snapshot.foodNameHistory[0].timesDiscarded, 1);
});

test('food_name_history timesUsed round-trips through push/pull', () => {
  const services = makeServices();
  const { user, home } = makeUserAndHome(services);
  const categoryId = getCategoryId(services.db, home.id);
  const entry = {
    homeId: home.id,
    categoryId,
    normalizedName: 'leche',
    name: 'Leche',
    firstCreatedAt: 1000,
    shelfLifeDays: 5,
    timesDiscarded: 0,
    timesUsed: 3,
    updatedAt: 1000,
  };
  services.syncService.pushHomeSnapshot(user.id, home.id, { foodNameHistory: [entry] });

  const snapshot = services.syncService.pullHomeSnapshot(user.id, home.id);
  assert.equal(snapshot.foodNameHistory[0].timesUsed, 3);
});

test('food_name_history entries with the same name but different categories are tracked separately', () => {
  const services = makeServices();
  const { user, home } = makeUserAndHome(services);
  const foodCategoryId = getCategoryId(services.db, home.id, 'Alimentos');
  const medCategoryId = getCategoryId(services.db, home.id, 'Medicamentos');
  const food = {
    homeId: home.id, categoryId: foodCategoryId, normalizedName: 'aspirina', name: 'Aspirina',
    firstCreatedAt: 1000, shelfLifeDays: 30, timesDiscarded: 0, timesUsed: 0, updatedAt: 1000,
  };
  const medicine = { ...food, categoryId: medCategoryId, shelfLifeDays: 365, updatedAt: 1000 };

  services.syncService.pushHomeSnapshot(user.id, home.id, { foodNameHistory: [food, medicine] });

  const snapshot = services.syncService.pullHomeSnapshot(user.id, home.id);
  assert.equal(snapshot.foodNameHistory.length, 2);
  const byCategoryId = Object.fromEntries(snapshot.foodNameHistory.map(e => [e.categoryId, e]));
  assert.equal(byCategoryId[foodCategoryId].shelfLifeDays, 30);
  assert.equal(byCategoryId[medCategoryId].shelfLifeDays, 365);
});

test('food_name_history entry with no categoryId (legacy client) resolves via the category name', () => {
  const services = makeServices();
  const { user, home } = makeUserAndHome(services);
  const foodCategoryId = getCategoryId(services.db, home.id, 'Alimentos');
  const entry = {
    homeId: home.id, category: 'Alimentos', normalizedName: 'leche', name: 'Leche',
    firstCreatedAt: 1000, shelfLifeDays: 5, timesDiscarded: 0, updatedAt: 1000,
  };

  services.syncService.pushHomeSnapshot(user.id, home.id, { foodNameHistory: [entry] });

  const snapshot = services.syncService.pullHomeSnapshot(user.id, home.id);
  assert.equal(snapshot.foodNameHistory.length, 1);
  assert.equal(snapshot.foodNameHistory[0].categoryId, foodCategoryId);
});

test('food_name_history entry with neither categoryId nor a matching legacy name falls back to Alimentos', () => {
  const services = makeServices();
  const { user, home } = makeUserAndHome(services);
  const foodCategoryId = getCategoryId(services.db, home.id, 'Alimentos');
  const entry = {
    // Simulates a stale pre-category-table client still sending the raw
    // lowercase slug, which no longer matches any category name post-
    // migration-010 - must fall back to the Home's Alimentos row rather than
    // throwing or silently dropping the record.
    homeId: home.id, category: 'alimento', normalizedName: 'leche', name: 'Leche',
    firstCreatedAt: 1000, shelfLifeDays: 5, timesDiscarded: 0, updatedAt: 1000,
  };

  services.syncService.pushHomeSnapshot(user.id, home.id, { foodNameHistory: [entry] });

  const snapshot = services.syncService.pullHomeSnapshot(user.id, home.id);
  assert.equal(snapshot.foodNameHistory.length, 1);
  assert.equal(snapshot.foodNameHistory[0].categoryId, foodCategoryId);
});

test('food_name_history deletedAt round-trips through push/pull, tombstones still returned', () => {
  const services = makeServices();
  const { user, home } = makeUserAndHome(services);
  const categoryId = getCategoryId(services.db, home.id);
  const entry = {
    homeId: home.id, categoryId, normalizedName: 'leche', name: 'Leche',
    firstCreatedAt: 1000, shelfLifeDays: 5, timesDiscarded: 0, timesUsed: 0, updatedAt: 1000,
  };
  services.syncService.pushHomeSnapshot(user.id, home.id, { foodNameHistory: [entry] });

  const deleted = { ...entry, deletedAt: 2000, updatedAt: 2000 };
  services.syncService.pushHomeSnapshot(user.id, home.id, { foodNameHistory: [deleted] });

  const snapshot = services.syncService.pullHomeSnapshot(user.id, home.id);
  assert.equal(snapshot.foodNameHistory.length, 1);
  assert.equal(snapshot.foodNameHistory[0].deletedAt, 2000);
});

test('location categoryId round-trips through push/pull', () => {
  const services = makeServices();
  const { user, home } = makeUserAndHome(services);
  const medCategoryId = getCategoryId(services.db, home.id, 'Medicamentos');
  const location = makeLocation(home.id, medCategoryId);

  services.syncService.pushHomeSnapshot(user.id, home.id, { locations: [location] });

  const snapshot = services.syncService.pullHomeSnapshot(user.id, home.id);
  assert.equal(snapshot.locations[0].categoryId, medCategoryId);
});

test('location with no categoryId (legacy client) resolves via the legacy category name', () => {
  const services = makeServices();
  const { user, home } = makeUserAndHome(services);
  const medCategoryId = getCategoryId(services.db, home.id, 'Medicamentos');
  const location = makeLocation(home.id, undefined, { category: 'Medicamentos' });
  delete location.categoryId;

  services.syncService.pushHomeSnapshot(user.id, home.id, { locations: [location] });

  const snapshot = services.syncService.pullHomeSnapshot(user.id, home.id);
  assert.equal(snapshot.locations[0].categoryId, medCategoryId);
});

test('a brand-new category pushed in the same snapshot as a location using it resolves correctly', () => {
  const services = makeServices();
  const { user, home } = makeUserAndHome(services);
  const category = makeCategory(home.id, { id: 'cat-freezer', name: 'Freezer' });
  const location = makeLocation(home.id, 'cat-freezer', { id: 'loc-freezer' });

  services.syncService.pushHomeSnapshot(user.id, home.id, { categories: [category], locations: [location] });

  const snapshot = services.syncService.pullHomeSnapshot(user.id, home.id);
  assert.equal(snapshot.locations[0].categoryId, 'cat-freezer');
  assert.ok(snapshot.categories.some(c => c.id === 'cat-freezer' && c.name === 'Freezer'));
});

test('renaming a category (push with a newer updatedAt) round-trips and is what locations resolve against', () => {
  const services = makeServices();
  const { user, home } = makeUserAndHome(services);
  const category = makeCategory(home.id, { id: 'cat-freezer', name: 'Freezer', updatedAt: 1000 });
  services.syncService.pushHomeSnapshot(user.id, home.id, { categories: [category] });

  const renamed = { ...category, name: 'Freezer Grande', updatedAt: 2000 };
  services.syncService.pushHomeSnapshot(user.id, home.id, { categories: [renamed] });

  const snapshot = services.syncService.pullHomeSnapshot(user.id, home.id);
  const pulled = snapshot.categories.find(c => c.id === 'cat-freezer');
  assert.equal(pulled.name, 'Freezer Grande');
});

test('categories tombstones round-trip through push/pull', () => {
  const services = makeServices();
  const { user, home } = makeUserAndHome(services);
  const category = makeCategory(home.id, { id: 'cat-freezer', updatedAt: 1000 });
  services.syncService.pushHomeSnapshot(user.id, home.id, { categories: [category] });

  const deleted = { ...category, deletedAt: 2000, updatedAt: 2000 };
  services.syncService.pushHomeSnapshot(user.id, home.id, { categories: [deleted] });

  const snapshot = services.syncService.pullHomeSnapshot(user.id, home.id);
  const pulled = snapshot.categories.find(c => c.id === 'cat-freezer');
  assert.equal(pulled.deletedAt, 2000);
});
