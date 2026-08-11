import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, matches } from '../js/lib/string.js';


test('normalize trims and lowercases', () => {
  assert.equal(normalize('  Leche  '), 'leche');
});

test('matches is case-insensitive', () => {
  assert.equal(matches('Leche Descremada', 'leche'), true);
  assert.equal(matches('Leche Descremada', 'LECHE'), true);
});

test('matches does substring matching, not full-string', () => {
  assert.equal(matches('Leche Descremada', 'crema'), true);
});

test('matches returns false when the pattern is absent', () => {
  assert.equal(matches('Leche Descremada', 'yogur'), false);
});
