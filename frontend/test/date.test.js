import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toYYYYMMDD, fromYYYYMMDD, formatReadableDate, localHourToUtcHour, utcHourToLocalHour } from '../js/lib/date.js';


test('toYYYYMMDD pads single-digit month and day', () => {
  assert.equal(toYYYYMMDD(new Date(2026, 0, 5)), '2026-01-05');
});

test('toYYYYMMDD leaves double-digit month and day unpadded', () => {
  assert.equal(toYYYYMMDD(new Date(2026, 10, 23)), '2026-11-23');
});

test('fromYYYYMMDD parses as local midnight, not UTC', () => {
  const date = fromYYYYMMDD('2026-03-15');
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 2); // 0-indexed: March
  assert.equal(date.getDate(), 15);
  assert.equal(date.getHours(), 0);
});

test('toYYYYMMDD and fromYYYYMMDD round-trip', () => {
  const str = '2026-12-01';
  assert.equal(toYYYYMMDD(fromYYYYMMDD(str)), str);
});

test('formatReadableDate spells out the weekday and month in Spanish', () => {
  assert.equal(formatReadableDate(new Date(2026, 7, 4)), 'martes 4 de agosto');
});

test('formatReadableDate does not zero-pad the day', () => {
  assert.equal(formatReadableDate(new Date(2026, 0, 1)), 'jueves 1 de enero');
});

// Deliberately timezone-agnostic - these round-trip against whatever offset
// the machine running the test happens to be in, rather than asserting a
// hardcoded expected hour that would only hold in one specific timezone.
test('localHourToUtcHour and utcHourToLocalHour round-trip for every hour of the day', () => {
  for (let hour = 0; hour < 24; hour++) {
    assert.equal(utcHourToLocalHour(localHourToUtcHour(hour)), hour);
  }
});

test('localHourToUtcHour and utcHourToLocalHour always return an hour in 0-23', () => {
  for (let hour = 0; hour < 24; hour++) {
    const utc = localHourToUtcHour(hour);
    assert.ok(utc >= 0 && utc <= 23);
    const local = utcHourToLocalHour(hour);
    assert.ok(local >= 0 && local <= 23);
  }
});
