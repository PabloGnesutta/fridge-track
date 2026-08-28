import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrate.js';
import { migrations } from '../src/db/migrations/index.js';
import { createRecipeCacheService, CACHE_TTL_MS } from '../src/services/recipeCacheService.js';

function makeCacheService() {
  const db = new DatabaseSync(':memory:');
  runMigrations(db, migrations);
  return createRecipeCacheService(db);
}

test('returns null for a key that was never cached', () => {
  const cache = makeCacheService();
  assert.equal(cache.getCached('pollo tomate'), null);
});

test('returns the cached results within the TTL window', () => {
  const cache = makeCacheService();
  const results = [{ title: 'Sopa', url: 'https://example.com/sopa' }];
  const now = 1_000_000;
  cache.setCached('pollo tomate', results, now);

  assert.deepEqual(cache.getCached('pollo tomate', now + CACHE_TTL_MS - 1), results);
});

test('treats a stale entry (past the TTL) as a miss', () => {
  const cache = makeCacheService();
  const now = 1_000_000;
  cache.setCached('pollo tomate', [{ title: 'Sopa', url: 'https://example.com/sopa' }], now);

  assert.equal(cache.getCached('pollo tomate', now + CACHE_TTL_MS), null);
});

test('setCached overwrites a previous entry for the same key', () => {
  const cache = makeCacheService();
  const now = 1_000_000;
  cache.setCached('pollo tomate', [{ title: 'Viejo', url: 'https://example.com/viejo' }], now);
  cache.setCached('pollo tomate', [{ title: 'Nuevo', url: 'https://example.com/nuevo' }], now);

  assert.deepEqual(cache.getCached('pollo tomate', now), [{ title: 'Nuevo', url: 'https://example.com/nuevo' }]);
});
