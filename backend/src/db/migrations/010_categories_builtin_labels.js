/**
 * Purely cosmetic - renames the 3 built-in categories from their raw slugs
 * to display labels, now that migrations 008/009 have already resolved
 * every location/food_name_history row's `category_id` off the raw slug.
 * Must run last: doing this rename any earlier would break the string-match
 * JOINs those two migrations depend on. Going forward, homeService.js's
 * createHome() seeds new Homes' built-in categories with these same nice
 * labels directly - this migration only backfills Homes that existed before
 * this feature shipped.
 */
const sql = `
UPDATE categories SET name = 'Alimentos' WHERE name = 'alimento';
UPDATE categories SET name = 'Medicamentos' WHERE name = 'medicamento';
UPDATE categories SET name = 'Otros' WHERE name = 'otro';
`;

export { sql };
