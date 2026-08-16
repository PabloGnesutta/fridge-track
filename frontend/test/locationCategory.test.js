import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCategoryLabel } from '../js/lib/locationCategory.js';


test('getCategoryLabel returns the matching label', () => {
  assert.equal(getCategoryLabel('medicamento'), 'Medicamentos');
  assert.equal(getCategoryLabel('otro'), 'Otros');
  assert.equal(getCategoryLabel('alimento'), 'Alimentos');
});

test('getCategoryLabel falls back to Alimentos for unknown or missing categories', () => {
  assert.equal(getCategoryLabel('not-a-real-category'), 'Alimentos');
  assert.equal(getCategoryLabel(undefined), 'Alimentos');
});
