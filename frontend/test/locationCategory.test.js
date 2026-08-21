import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCategoryLabel, getKnownCategories } from '../js/lib/locationCategory.js';


test('getCategoryLabel returns the matching label', () => {
  assert.equal(getCategoryLabel('medicamento'), 'Medicamentos');
  assert.equal(getCategoryLabel('otro'), 'Otros');
  assert.equal(getCategoryLabel('alimento'), 'Alimentos');
});

test('getCategoryLabel falls back to Alimentos only for a missing category', () => {
  assert.equal(getCategoryLabel(undefined), 'Alimentos');
  assert.equal(getCategoryLabel(''), 'Alimentos');
});

test('getCategoryLabel returns a custom category as-is - it has no separate label', () => {
  assert.equal(getCategoryLabel('Congelador'), 'Congelador');
});

test('getKnownCategories always includes the 3 built-ins, even with no locations', () => {
  assert.deepEqual(getKnownCategories([]), [
    { value: 'alimento', label: 'Alimentos' },
    { value: 'medicamento', label: 'Medicamentos' },
    { value: 'otro', label: 'Otros' },
  ]);
});

test('getKnownCategories appends custom categories in use, sorted, deduped', () => {
  const locations = [
    { category: 'Congelador' },
    { category: 'alimento' },
    { category: 'Congelador' },
    { category: 'Jardín' },
  ];
  assert.deepEqual(getKnownCategories(locations), [
    { value: 'alimento', label: 'Alimentos' },
    { value: 'medicamento', label: 'Medicamentos' },
    { value: 'otro', label: 'Otros' },
    { value: 'Congelador', label: 'Congelador' },
    { value: 'Jardín', label: 'Jardín' },
  ]);
});

test('getKnownCategories ignores locations with no category', () => {
  assert.deepEqual(getKnownCategories([{}, { category: '' }]), [
    { value: 'alimento', label: 'Alimentos' },
    { value: 'medicamento', label: 'Medicamentos' },
    { value: 'otro', label: 'Otros' },
  ]);
});
