import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute } from '../js/common/routeMatch.js';


test('parseRoute: root path maps to the item list', () => {
  assert.deepEqual(parseRoute('/'), { view: 'ItemList' });
});

test('parseRoute: /item/:key maps to the single item view', () => {
  assert.deepEqual(parseRoute('/item/42'), { view: 'SingleItem', itemKey: '42' });
});

test('parseRoute: trailing slash on /item/:key is tolerated', () => {
  assert.deepEqual(parseRoute('/item/42/'), { view: 'SingleItem', itemKey: '42' });
});

test('parseRoute: unknown or malformed paths fall back to the item list', () => {
  assert.deepEqual(parseRoute('/settings'), { view: 'ItemList' });
  assert.deepEqual(parseRoute('/item/'), { view: 'ItemList' });
});

test('parseRoute: /historial maps to the food name history view', () => {
  assert.deepEqual(parseRoute('/historial'), { view: 'FoodHistory' });
});

test('parseRoute: trailing slash on /historial is tolerated', () => {
  assert.deepEqual(parseRoute('/historial/'), { view: 'FoodHistory' });
});
