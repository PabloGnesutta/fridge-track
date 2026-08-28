import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrate.js';
import { migrations } from '../src/db/migrations/index.js';
import { addAllowedEmail } from '../src/db/allowedEmails.js';
import { createAuthService } from '../src/services/authService.js';
import { createHomeService } from '../src/services/homeService.js';
import { createRecipeService } from '../src/services/recipeService.js';
import { ServiceError } from '../src/services/ServiceError.js';


function makeStubEdamamClient(results = []) {
  const calls = [];
  return {
    calls,
    searchRecipes: async (query, opts) => { calls.push({ query, opts }); return results; },
  };
}

/** In-memory stand-in for recipeCacheService.js, so tests can inspect exactly what key was used. */
function makeStubRecipeCacheService() {
  const store = new Map();
  return {
    store,
    getCached: (key) => (store.has(key) ? store.get(key) : null),
    setCached: (key, results) => { store.set(key, results); },
  };
}

function makeServices(edamamClient, recipeCacheService = makeStubRecipeCacheService()) {
  const db = new DatabaseSync(':memory:');
  runMigrations(db, migrations);
  return {
    authService: createAuthService(db),
    homeService: createHomeService(db),
    recipeService: createRecipeService(db, edamamClient, recipeCacheService),
    db,
  };
}

function makeUserAndHome(services, email = 'a@test.local') {
  addAllowedEmail(services.db, email);
  const user = services.authService.createUser(email, 'password123');
  const home = services.homeService.createHome(user.id, 'Casa de Prueba');
  /** @type {{id: string}} */ // @ts-ignore
  const category = services.db.prepare(
    `SELECT id FROM categories WHERE home_id = ? AND name = 'Alimentos'`
  ).get(home.id);
  services.db.prepare(
    `INSERT INTO locations (id, home_id, name, category_id, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('loc-1', home.id, 'Heladera', category.id, 1000, 1000, null);
  return { user, home };
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 */
function insertItem(db, homeId, overrides = {}) {
  const item = {
    id: 'item-' + Math.random(),
    locationId: 'loc-1',
    homeId,
    name: 'Leche',
    normalizedName: 'leche',
    quantity: '',
    addedDate: 1000,
    useByDate: null,
    shelfLifeDays: null,
    notes: '',
    createdAt: 1000,
    updatedAt: 1000,
    deletedAt: null,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO items (id, location_id, home_id, name, normalized_name, quantity,
       added_date, use_by_date, shelf_life_days, notes, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    item.id, item.locationId, item.homeId, item.name, item.normalizedName, item.quantity,
    item.addedDate, item.useByDate, item.shelfLifeDays, item.notes,
    item.createdAt, item.updatedAt, item.deletedAt
  );
}

test('no urgent items - returns empty result without calling the client', async () => {
  const edamamClient = makeStubEdamamClient();
  const services = makeServices(edamamClient);
  const { user, home } = makeUserAndHome(services);
  const farFuture = new Date(2026, 11, 1).getTime();
  insertItem(services.db, home.id, { name: 'Harina', useByDate: farFuture });

  const result = await services.recipeService.getSuggestionsForHome(user.id, home.id);

  assert.deepEqual(result, { items: [], query: null });
  assert.equal(edamamClient.calls.length, 0);
});

test('urgent items - passes the soonest-first names as the query, in order', async () => {
  const stubResults = [{ title: 'Sopa', url: 'https://example.com/sopa' }];
  const edamamClient = makeStubEdamamClient(stubResults);
  const services = makeServices(edamamClient);
  const { user, home } = makeUserAndHome(services);
  const today = new Date();

  insertItem(services.db, home.id, { id: 'item-a', name: 'Tomate', useByDate: today.getTime() }); // due today
  insertItem(services.db, home.id, { id: 'item-b', name: 'Pollo', useByDate: today.getTime() - 2 * 24 * 60 * 60 * 1000 }); // already expired
  insertItem(services.db, home.id, { id: 'item-c', name: 'Harina', useByDate: new Date(2026, 11, 1).getTime() }); // far future, not urgent

  const result = await services.recipeService.getSuggestionsForHome(user.id, home.id);

  assert.equal(edamamClient.calls.length, 1);
  assert.equal(edamamClient.calls[0].query, 'Pollo Tomate');
  assert.deepEqual(result.items, stubResults);
  assert.equal(result.query, 'Pollo Tomate');
});

test('caps the query at the 3 most urgent items', async () => {
  const edamamClient = makeStubEdamamClient([]);
  const services = makeServices(edamamClient);
  const { user, home } = makeUserAndHome(services);
  const today = new Date();

  const names = ['Uno', 'Dos', 'Tres', 'Cuatro'];
  names.forEach((name, i) => {
    insertItem(services.db, home.id, { id: 'item-' + i, name, useByDate: today.getTime() - i * 24 * 60 * 60 * 1000 });
  });

  await services.recipeService.getSuggestionsForHome(user.id, home.id);

  const queryNames = edamamClient.calls[0].query.split(' ');
  assert.equal(queryNames.length, 3);
  assert.deepEqual(queryNames, ['Cuatro', 'Tres', 'Dos']); // most overdue first
});

test('caching - a repeat call with the same urgent items does not call Edamam again', async () => {
  const stubResults = [{ title: 'Sopa', url: 'https://example.com/sopa' }];
  const edamamClient = makeStubEdamamClient(stubResults);
  const recipeCacheService = makeStubRecipeCacheService();
  const services = makeServices(edamamClient, recipeCacheService);
  const { user, home } = makeUserAndHome(services);
  const today = new Date();
  insertItem(services.db, home.id, { name: 'Tomate', useByDate: today.getTime() });

  const first = await services.recipeService.getSuggestionsForHome(user.id, home.id);
  const second = await services.recipeService.getSuggestionsForHome(user.id, home.id);

  assert.equal(edamamClient.calls.length, 1);
  assert.deepEqual(first.items, stubResults);
  assert.deepEqual(second.items, stubResults);
});

test('caching - the cache key is order-independent across different urgent-item orderings', async () => {
  const edamamClient = makeStubEdamamClient([{ title: 'Sopa', url: 'https://example.com/sopa' }]);
  const recipeCacheService = makeStubRecipeCacheService();
  const services = makeServices(edamamClient, recipeCacheService);
  const { user, home } = makeUserAndHome(services);
  const today = new Date();

  // Pollo more urgent than Tomate (Pollo first in the query/order).
  insertItem(services.db, home.id, { id: 'item-a', name: 'Tomate', useByDate: today.getTime() });
  insertItem(services.db, home.id, { id: 'item-b', name: 'Pollo', useByDate: today.getTime() - 24 * 60 * 60 * 1000 });
  await services.recipeService.getSuggestionsForHome(user.id, home.id);
  assert.equal(edamamClient.calls.length, 1);
  assert.equal(edamamClient.calls[0].query, 'Pollo Tomate');

  // Same two items, urgency now reversed (Tomate first) - same underlying
  // set, so it should hit the cache keyed on the earlier call instead of
  // calling Edamam a second time.
  services.db.prepare('UPDATE items SET use_by_date = ? WHERE id = ?')
    .run(today.getTime() - 24 * 60 * 60 * 1000, 'item-a');
  services.db.prepare('UPDATE items SET use_by_date = ? WHERE id = ?')
    .run(today.getTime(), 'item-b');
  await services.recipeService.getSuggestionsForHome(user.id, home.id);

  assert.equal(edamamClient.calls.length, 1);
  assert.equal(recipeCacheService.store.size, 1);
});

test('membership is enforced', async () => {
  const services = makeServices(makeStubEdamamClient());
  const { home } = makeUserAndHome(services, 'owner@test.local');
  addAllowedEmail(services.db, 'outsider@test.local');
  const outsider = services.authService.createUser('outsider@test.local', 'password123');

  await assert.rejects(
    () => services.recipeService.getSuggestionsForHome(outsider.id, home.id),
    ServiceError
  );
});
