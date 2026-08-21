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

function makeLocation(homeId, overrides = {}) {
  return {
    id: 'loc-1',
    homeId,
    name: 'Heladera',
    category: 'alimento',
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
  const location = makeLocation(home.id);
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
  const location = makeLocation(home.id, { updatedAt: 2000 });
  services.syncService.pushHomeSnapshot(user.id, home.id, { locations: [location] });

  const stale = makeLocation(home.id, { name: 'Freezer', updatedAt: 1000 });
  services.syncService.pushHomeSnapshot(user.id, home.id, { locations: [stale] });

  const snapshot = services.syncService.pullHomeSnapshot(user.id, home.id);
  assert.equal(snapshot.locations[0].name, 'Heladera');
});

test('push with a newer updatedAt does overwrite', () => {
  const services = makeServices();
  const { user, home } = makeUserAndHome(services);
  const location = makeLocation(home.id, { updatedAt: 1000 });
  services.syncService.pushHomeSnapshot(user.id, home.id, { locations: [location] });

  const newer = makeLocation(home.id, { name: 'Freezer', updatedAt: 2000 });
  services.syncService.pushHomeSnapshot(user.id, home.id, { locations: [newer] });

  const snapshot = services.syncService.pullHomeSnapshot(user.id, home.id);
  assert.equal(snapshot.locations[0].name, 'Freezer');
});

test('push with an equal updatedAt does not overwrite', () => {
  const services = makeServices();
  const { user, home } = makeUserAndHome(services);
  const location = makeLocation(home.id, { updatedAt: 1000 });
  services.syncService.pushHomeSnapshot(user.id, home.id, { locations: [location] });

  const tied = makeLocation(home.id, { name: 'Freezer', updatedAt: 1000 });
  services.syncService.pushHomeSnapshot(user.id, home.id, { locations: [tied] });

  const snapshot = services.syncService.pullHomeSnapshot(user.id, home.id);
  assert.equal(snapshot.locations[0].name, 'Heladera');
});

test('pull returns tombstoned rows', () => {
  const services = makeServices();
  const { user, home } = makeUserAndHome(services);
  const location = makeLocation(home.id, { updatedAt: 1000 });
  services.syncService.pushHomeSnapshot(user.id, home.id, { locations: [location] });

  const deleted = makeLocation(home.id, { updatedAt: 2000, deletedAt: 2000 });
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

  services.syncService.pushHomeSnapshot(user.id, homeA.id, {
    locations: [makeLocation(homeA.id, { id: 'loc-a', name: 'Solo en A' })],
  });
  services.syncService.pushHomeSnapshot(user.id, homeB.id, {
    locations: [makeLocation(homeB.id, { id: 'loc-b', name: 'Solo en B' })],
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
  const mismatched = makeLocation(otherHome.id);

  services.syncService.pushHomeSnapshot(user.id, home.id, { locations: [mismatched] });

  const snapshot = services.syncService.pullHomeSnapshot(user.id, home.id);
  assert.equal(snapshot.locations.length, 0);
});

test('food_name_history composite-key upsert respects LWW', () => {
  const services = makeServices();
  const { user, home } = makeUserAndHome(services);
  const entry = {
    homeId: home.id,
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
  const entry = {
    homeId: home.id,
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
  const food = {
    homeId: home.id, category: 'alimento', normalizedName: 'aspirina', name: 'Aspirina',
    firstCreatedAt: 1000, shelfLifeDays: 30, timesDiscarded: 0, timesUsed: 0, updatedAt: 1000,
  };
  const medicine = { ...food, category: 'medicamento', shelfLifeDays: 365, updatedAt: 1000 };

  services.syncService.pushHomeSnapshot(user.id, home.id, { foodNameHistory: [food, medicine] });

  const snapshot = services.syncService.pullHomeSnapshot(user.id, home.id);
  assert.equal(snapshot.foodNameHistory.length, 2);
  const byCategory = Object.fromEntries(snapshot.foodNameHistory.map(e => [e.category, e]));
  assert.equal(byCategory.alimento.shelfLifeDays, 30);
  assert.equal(byCategory.medicamento.shelfLifeDays, 365);
});

test('food_name_history entry with no category defaults to alimento', () => {
  const services = makeServices();
  const { user, home } = makeUserAndHome(services);
  const entry = {
    homeId: home.id, normalizedName: 'leche', name: 'Leche',
    firstCreatedAt: 1000, shelfLifeDays: 5, timesDiscarded: 0, updatedAt: 1000,
  };

  services.syncService.pushHomeSnapshot(user.id, home.id, { foodNameHistory: [entry] });

  const snapshot = services.syncService.pullHomeSnapshot(user.id, home.id);
  assert.equal(snapshot.foodNameHistory.length, 1);
  assert.equal(snapshot.foodNameHistory[0].category, 'alimento');
});

test('location category round-trips through push/pull', () => {
  const services = makeServices();
  const { user, home } = makeUserAndHome(services);
  const location = makeLocation(home.id, { category: 'medicamento' });

  services.syncService.pushHomeSnapshot(user.id, home.id, { locations: [location] });

  const snapshot = services.syncService.pullHomeSnapshot(user.id, home.id);
  assert.equal(snapshot.locations[0].category, 'medicamento');
});
