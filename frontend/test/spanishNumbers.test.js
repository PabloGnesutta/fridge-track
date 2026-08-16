import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpanishNumber } from '../js/lib/spanishNumbers.js';


test('parses a plain digit token', () => {
  assert.equal(parseSpanishNumber('20'), 20);
});

test('parses a single unit word', () => {
  assert.equal(parseSpanishNumber('cinco'), 5);
});

test('parses a compound number word ("treinta y uno" = 31)', () => {
  assert.equal(parseSpanishNumber('treinta y uno'), 31);
});

test('parses a large number with a multiplier word', () => {
  assert.equal(parseSpanishNumber('cincuenta mil trescientos'), 50300);
});

test('parses a thousands-separated digit token', () => {
  assert.equal(parseSpanishNumber('50.300'), 50300);
});

test('ignores filler/unrecognized words around a number', () => {
  assert.equal(parseSpanishNumber('el veinte de agosto'), 20);
});

test('returns null when nothing recognizable is found', () => {
  assert.equal(parseSpanishNumber('no se entendio nada de esto'), null);
});

test('returns null for empty input', () => {
  assert.equal(parseSpanishNumber(''), null);
});
