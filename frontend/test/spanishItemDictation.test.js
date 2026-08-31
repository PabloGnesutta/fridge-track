import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseItemDictation } from '../js/lib/spanishItemDictation.js';


test('empty transcript returns an all-empty result', () => {
  const result = parseItemDictation('');
  assert.deepEqual(result, { name: '', quantity: '', shelfLifeDays: null, useByDate: null });
});

test('name only, no keywords', () => {
  const result = parseItemDictation('Leche');
  assert.equal(result.name, 'Leche');
  assert.equal(result.quantity, '');
  assert.equal(result.shelfLifeDays, null);
  assert.equal(result.useByDate, null);
});

test('name + cantidad', () => {
  const result = parseItemDictation('Leche cantidad dos litros');
  assert.equal(result.name, 'Leche');
  assert.equal(result.quantity, 'dos litros');
});

test('name + vencimiento en N dias (relative)', () => {
  const result = parseItemDictation('Leche vencimiento en cinco dias');
  assert.equal(result.name, 'Leche');
  assert.equal(result.shelfLifeDays, 5);
  assert.equal(result.useByDate, null);
});

test('full grammar: name + cantidad + vencimiento en dias', () => {
  const result = parseItemDictation('Leche cantidad dos litros vencimiento en cinco dias');
  assert.equal(result.name, 'Leche');
  assert.equal(result.quantity, 'dos litros');
  assert.equal(result.shelfLifeDays, 5);
  assert.equal(result.useByDate, null);
});

test('vencimiento el D de MES (absolute date), no rollover needed', () => {
  const currentDate = new Date(2026, 0, 1); // 2026-01-01
  const result = parseItemDictation('Leche vencimiento el veinte de agosto', currentDate);
  assert.equal(result.name, 'Leche');
  assert.equal(result.shelfLifeDays, null);
  assert.ok(result.useByDate instanceof Date);
  assert.equal(result.useByDate.getFullYear(), 2026);
  assert.equal(result.useByDate.getMonth(), 7); // agosto
  assert.equal(result.useByDate.getDate(), 20);
});

test('vencimiento with a digit day instead of a number word', () => {
  const currentDate = new Date(2026, 0, 1);
  const result = parseItemDictation('Leche vencimiento el 20 de agosto', currentDate);
  assert.equal(result.useByDate.getMonth(), 7);
  assert.equal(result.useByDate.getDate(), 20);
});

test('a date already past this year rolls to next year', () => {
  const currentDate = new Date(2026, 11, 15); // 2026-12-15
  const result = parseItemDictation('Leche vencimiento el tres de enero', currentDate);
  assert.equal(result.useByDate.getFullYear(), 2027);
  assert.equal(result.useByDate.getMonth(), 0); // enero
  assert.equal(result.useByDate.getDate(), 3);
});

test('keywords said out of order still parse correctly', () => {
  const result = parseItemDictation('Leche vencimiento en cinco dias cantidad dos litros');
  assert.equal(result.name, 'Leche');
  assert.equal(result.shelfLifeDays, 5);
  assert.equal(result.quantity, 'dos litros');
});

test('a transcript starting with a keyword yields an empty name', () => {
  const result = parseItemDictation('cantidad dos litros');
  assert.equal(result.name, '');
  assert.equal(result.quantity, 'dos litros');
});

test('"vence" works as a shorter alternative to "vencimiento"', () => {
  const result = parseItemDictation('Leche vence en cinco dias');
  assert.equal(result.name, 'Leche');
  assert.equal(result.shelfLifeDays, 5);
  assert.equal(result.useByDate, null);
});

test('"vencen" (plural) works as a shorter alternative to "vencimiento"', () => {
  const result = parseItemDictation('Huevos vencen en cinco dias');
  assert.equal(result.name, 'Huevos');
  assert.equal(result.shelfLifeDays, 5);
  assert.equal(result.useByDate, null);
});

test('vencimiento with no day or month recognized leaves both due fields null', () => {
  const result = parseItemDictation('Leche vencimiento pronto');
  assert.equal(result.shelfLifeDays, null);
  assert.equal(result.useByDate, null);
});
