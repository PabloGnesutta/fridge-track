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
  if (!category) { return 'Alimentos'; }
  // A category outside the 3 built-ins is a user-typed custom one (see
  // getKnownCategories below) - it has no separate slug/label split, the
  // value the user typed *is* the label.
  return LOCATION_CATEGORIES.find(c => c.value === category)?.label || category;
}

/**
 * The full set of categories usable in a Home right now: the 3 built-ins
 * (always offered, even with zero locations yet) plus any custom category a
 * location already uses, so a user who typed "Congelador" once gets it
 * offered again on the next location - both in the location form's
 * suggestions and as a /historial tab - instead of having to retype it
 * verbatim (and risk a near-duplicate like "congelador"). Custom entries
 * have no separate label, same reasoning as getCategoryLabel above.
 * @param {{category?: string}[]} locations
 * @returns {{value: string, label: string}[]}
 */
function getKnownCategories(locations) {
  const extra = new Set();
  for (const location of locations) {
    const value = location.category;
    if (value && !LOCATION_CATEGORIES.some(c => c.value === value)) { extra.add(value); }
  }
  return [
    ...LOCATION_CATEGORIES,
    ...[...extra].sort().map(value => ({ value, label: value })),
  ];
}

export { LOCATION_CATEGORIES, getCategoryLabel, getKnownCategories };
