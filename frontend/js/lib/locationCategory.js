/**
 * What kind of stuff a location can hold - not hard-locked to food. The
 * page title (see item-ui.js) reflects whichever one a location is set to.
 * Kept DOM-free (unlike local-db/location-db.js, which transitively pulls
 * in state.js/indexedDb.js) so it fits the plain-Node unit-test convention.
 */
const LOCATION_CATEGORIES = [
  { value: 'alimento', label: 'Alimentos' },
  { value: 'medicamento', label: 'Medicamentos' },
  { value: 'otro', label: 'Otros' },
];

/**
 * @param {string} [category]
 * @returns {string}
 */
function getCategoryLabel(category) {
  return LOCATION_CATEGORIES.find(c => c.value === category)?.label || 'Alimentos';
}

export { LOCATION_CATEGORIES, getCategoryLabel };
