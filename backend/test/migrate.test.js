import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrate.js';
import { migrations } from '../src/db/migrations/index.js';


test('runMigrations creates every table on a fresh database', () => {
  const db = new DatabaseSync(':memory:');
  runMigrations(db, migrations);

  /** @type {{name: string}[]} */ // @ts-ignore
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all();
  const names = tables.map(t => t.name);
  for (const expected of ['users', 'homes', 'home_members', 'sessions', 'allowed_emails', 'locations', 'items', 'food_name_history']) {
    assert.ok(names.includes(expected), `expected table "${expected}" to exist`);
  }
});

test('runMigrations records every migration as applied', () => {
  const db = new DatabaseSync(':memory:');
  runMigrations(db, migrations);

  /** @type {{version: number}[]} */ // @ts-ignore
  const applied = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
  assert.deepEqual(applied.map(r => r.version), migrations.map(m => m.version));
});

test('running twice does not re-apply already-applied migrations', () => {
  const db = new DatabaseSync(':memory:');
  runMigrations(db, migrations);
  // A second run must be a no-op, not an error (CREATE TABLE IF NOT EXISTS
  // would silently tolerate a re-run anyway, but a future migration using a
  // bare ALTER TABLE would throw "duplicate column" if this weren't
  // actually skipping applied versions).
  assert.doesNotThrow(() => runMigrations(db, migrations));

  /** @type {{count: number}} */ // @ts-ignore
  const { count } = db.prepare('SELECT COUNT(*) as count FROM schema_migrations').get();
  assert.equal(count, migrations.length);
});

test('migrations 007-010 backfill every pre-existing location/food_name_history row with a correctly resolved category_id', () => {
  const db = new DatabaseSync(':memory:');
  // Apply only what predates the categories-table work (migrations 1-6),
  // then hand-seed data in the exact pre-migration shape (raw
  // locations.category / food_name_history.category strings, no categories
  // table at all) - reproducing the real slug/label mismatch this migration
  // series exists to guard against, plus the two trickiest cases: a
  // tombstoned location (still needs a resolvable category_id) and a
  // food_name_history entry referencing a custom category with zero
  // currently-active locations.
  runMigrations(db, migrations.slice(0, 6));

  db.exec(`
    INSERT INTO users (id, email, password_hash, created_at) VALUES (1, 'a@test.local', 'x', 1000);
    INSERT INTO homes (id, name, join_code, created_by, created_at) VALUES (1, 'Casa', 'ABC123', 1, 1000);
    INSERT INTO locations (id, home_id, name, category, created_at, updated_at, deleted_at) VALUES
      ('loc-1', 1, 'Heladera', 'alimento', 1000, 1000, NULL),
      ('loc-2', 1, 'Botiquin', 'medicamento', 1000, 1000, NULL),
      ('loc-3', 1, 'Freezer', 'congelador', 1000, 1000, NULL),
      ('loc-4', 1, 'Vieja Heladera', 'alimento', 1000, 1000, 5000);
    INSERT INTO food_name_history (home_id, category, normalized_name, name, first_created_at, updated_at, deleted_at) VALUES
      (1, 'alimento', 'leche', 'Leche', 1000, 1000, NULL),
      (1, 'otro', 'pilas', 'Pilas', 1000, 1000, NULL);
  `);

  runMigrations(db, migrations);

  /** @type {{id: string, category_id: string}[]} */ // @ts-ignore
  const locationRows = db.prepare('SELECT id, category_id FROM locations ORDER BY id').all();
  assert.equal(locationRows.length, 4, 'every pre-existing location, including the tombstoned one, survives');
  assert.ok(locationRows.every(row => !!row.category_id), 'every location resolved a non-null category_id');

  /** @type {{category_id: string}[]} */ // @ts-ignore
  const foodNameHistoryRows = db.prepare('SELECT category_id FROM food_name_history').all();
  assert.equal(foodNameHistoryRows.length, 2);
  assert.ok(foodNameHistoryRows.every(row => !!row.category_id));

  // No dangling references anywhere - the real risk this migration chain
  // introduced (see 008_locations_category_id.js's header comment).
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);

  /** @type {{id: string, name: string}[]} */ // @ts-ignore
  const categoryById = Object.fromEntries(
    db.prepare('SELECT id, name FROM categories WHERE home_id = 1').all().map(c => [c.id, c.name])
  );
  const nameByLocation = Object.fromEntries(
    locationRows.map(row => [row.id, categoryById[row.category_id]])
  );
  assert.deepEqual(nameByLocation, {
    'loc-1': 'Alimentos',
    'loc-2': 'Medicamentos',
    'loc-3': 'congelador', // custom category - untouched by migration 010's cosmetic builtin-only rename
    'loc-4': 'Alimentos',
  });
});

test('a later run only applies newly-added migrations, not ones already recorded', () => {
  const db = new DatabaseSync(':memory:');
  runMigrations(db, [migrations[0]]);

  const extraMigration = { version: 2, name: 'probe', sql: 'CREATE TABLE probe (id INTEGER PRIMARY KEY);' };
  runMigrations(db, [migrations[0], extraMigration]);

  // Re-running migration 1 would be harmless here (CREATE TABLE IF NOT
  // EXISTS), but the point is only migration 2 actually needed to run -
  // confirmed by the new table existing and both versions being recorded.
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'probe'`).all();
  assert.equal(tables.length, 1);

  /** @type {{version: number}[]} */ // @ts-ignore
  const applied = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
  assert.deepEqual(applied.map(r => r.version), [1, 2]);
});
