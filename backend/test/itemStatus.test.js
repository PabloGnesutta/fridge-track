import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeItemStatus, getDaysUntilDue } from '../src/lib/itemStatus.js';

// Mirrors frontend/test/freshnessStatus.test.js's cases - the two are
// deliberately-duplicated ports of the same logic (see itemStatus.js), so
// keep this file in sync with that one.

const today = new Date(2026, 7, 10); // 2026-08-10

test('fresh when the use-by date is far away', () => {
  const item = { useByDate: new Date(2026, 7, 20).getTime(), addedDate: null, shelfLifeDays: null };
  assert.equal(computeItemStatus(item, today), 'fresh');
});

test('expiring-soon right at the threshold (2 days out)', () => {
  const item = { useByDate: new Date(2026, 7, 12).getTime(), addedDate: null, shelfLifeDays: null };
  assert.equal(computeItemStatus(item, today), 'expiring-soon');
});

test('fresh just outside the threshold (3 days out)', () => {
  const item = { useByDate: new Date(2026, 7, 13).getTime(), addedDate: null, shelfLifeDays: null };
  assert.equal(computeItemStatus(item, today), 'fresh');
});

test('expired on the use-by date itself', () => {
  const item = { useByDate: new Date(2026, 7, 10).getTime(), addedDate: null, shelfLifeDays: null };
  assert.equal(computeItemStatus(item, today), 'expired');
});

test('expired when past the use-by date', () => {
  const item = { useByDate: new Date(2026, 7, 1).getTime(), addedDate: null, shelfLifeDays: null };
  assert.equal(computeItemStatus(item, today), 'expired');
});

test('expired when EITHER signal has elapsed, even if the other has not', () => {
  const item = {
    useByDate: new Date(2026, 7, 20).getTime(), // 10 days away on its own
    addedDate: new Date(2026, 7, 1).getTime(),
    shelfLifeDays: 5, // shelf life ended 4 days ago
  };
  assert.equal(computeItemStatus(item, today), 'expired');
});

test('no due signals at all is treated as fresh', () => {
  const item = { useByDate: null, addedDate: null, shelfLifeDays: null };
  assert.equal(computeItemStatus(item, today), 'fresh');
});

test('expiring-soon via shelf life alone', () => {
  const item = { useByDate: null, addedDate: new Date(2026, 7, 8).getTime(), shelfLifeDays: 3 };
  assert.equal(computeItemStatus(item, today), 'expiring-soon');
});

test('getDaysUntilDue: positive days for a future use-by date', () => {
  const item = { useByDate: new Date(2026, 7, 20).getTime(), addedDate: null, shelfLifeDays: null };
  assert.equal(getDaysUntilDue(item, today), 10);
});

test('getDaysUntilDue: negative days for a past use-by date', () => {
  const item = { useByDate: new Date(2026, 7, 1).getTime(), addedDate: null, shelfLifeDays: null };
  assert.equal(getDaysUntilDue(item, today), -9);
});

test('getDaysUntilDue: picks the soonest of the two signals', () => {
  const item = {
    useByDate: new Date(2026, 7, 20).getTime(), // 10 days away
    addedDate: new Date(2026, 7, 1).getTime(),
    shelfLifeDays: 5, // ended 4 days ago
  };
  assert.equal(getDaysUntilDue(item, today), -4);
});

test('getDaysUntilDue: null when the item has neither signal', () => {
  const item = { useByDate: null, addedDate: null, shelfLifeDays: null };
  assert.equal(getDaysUntilDue(item, today), null);
});
