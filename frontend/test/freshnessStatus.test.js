import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStatus, formatDueDetail, getSoonestDays } from '../js/lib/freshnessStatus.js';


const today = new Date(2026, 7, 10); // 2026-08-10

test('computeStatus: fresh when the use-by date is far away', () => {
  const item = { useByDate: new Date(2026, 7, 20), addedDate: null, shelfLifeDays: null };
  const result = computeStatus(item, today);
  assert.equal(result.status, 'fresh');
  assert.equal(result.daysUntilUseBy, 10);
});

test('computeStatus: expiring-soon right at the threshold (2 days out)', () => {
  const item = { useByDate: new Date(2026, 7, 12), addedDate: null, shelfLifeDays: null };
  assert.equal(computeStatus(item, today).status, 'expiring-soon');
});

test('computeStatus: fresh just outside the threshold (3 days out)', () => {
  const item = { useByDate: new Date(2026, 7, 13), addedDate: null, shelfLifeDays: null };
  assert.equal(computeStatus(item, today).status, 'fresh');
});

test('computeStatus: expired on the use-by date itself', () => {
  const item = { useByDate: new Date(2026, 7, 10), addedDate: null, shelfLifeDays: null };
  assert.equal(computeStatus(item, today).status, 'expired');
});

test('computeStatus: expired when past the use-by date', () => {
  const item = { useByDate: new Date(2026, 7, 1), addedDate: null, shelfLifeDays: null };
  const result = computeStatus(item, today);
  assert.equal(result.status, 'expired');
  assert.equal(result.daysUntilUseBy, -9);
});

test('computeStatus: expired when EITHER signal has elapsed, even if the other has not', () => {
  const item = {
    useByDate: new Date(2026, 7, 20), // 10 days away on its own
    addedDate: new Date(2026, 7, 1),
    shelfLifeDays: 5, // shelf life ended 4 days ago
  };
  assert.equal(computeStatus(item, today).status, 'expired');
});

test('computeStatus: no due signals at all is treated as fresh', () => {
  const item = { useByDate: null, addedDate: null, shelfLifeDays: null };
  const result = computeStatus(item, today);
  assert.equal(result.status, 'fresh');
  assert.equal(result.daysUntilUseBy, null);
  assert.equal(result.daysUntilShelfLifeEnd, null);
});

test('getSoonestDays picks the smaller of the two signals', () => {
  assert.equal(getSoonestDays({ daysUntilUseBy: 5, daysUntilShelfLifeEnd: 2 }), 2);
  assert.equal(getSoonestDays({ daysUntilUseBy: null, daysUntilShelfLifeEnd: 7 }), 7);
  assert.equal(getSoonestDays({ daysUntilUseBy: null, daysUntilShelfLifeEnd: null }), null);
});

test('formatDueDetail: future, today, and overdue phrasing', () => {
  assert.equal(formatDueDetail({ daysUntilUseBy: 1, daysUntilShelfLifeEnd: null }), 'vence en 1 día');
  assert.equal(formatDueDetail({ daysUntilUseBy: 3, daysUntilShelfLifeEnd: null }), 'vence en 3 días');
  assert.equal(formatDueDetail({ daysUntilUseBy: 0, daysUntilShelfLifeEnd: null }), 'vence hoy');
  assert.equal(formatDueDetail({ daysUntilUseBy: -1, daysUntilShelfLifeEnd: null }), 'vencido hace 1 día');
  assert.equal(formatDueDetail({ daysUntilUseBy: -5, daysUntilShelfLifeEnd: null }), 'vencido hace 5 días');
  assert.equal(formatDueDetail({ daysUntilUseBy: null, daysUntilShelfLifeEnd: null }), 'Sin datos');
});
