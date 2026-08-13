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
