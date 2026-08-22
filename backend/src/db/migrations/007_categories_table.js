/**
 * Gives categories a real table instead of a bare string copied onto both
 * `locations.category` and `food_name_history.category` - see
 * docs/plans/categories-table.md for the full rationale (renaming a
 * location's category didn't propagate to its history, since there was no
 * shared entity behind the matching strings). `locations`/`food_name_history`
 * grow a `category_id` column pointing here in migrations 008/009.
 *
 * Every existing `locations.category`/`food_name_history.category` value on
 * disk is the raw lowercase slug ('alimento'/'medicamento'/'otro'), not the
 * display label ('Alimentos'/etc, which only ever existed in the frontend's
 * locationCategory.js) - so this seeds using the raw slugs. Getting that
 * backwards would mean migrations 008/009's backfill JOINs fail to match on
 * every existing row. The cosmetic rename to nice labels happens later, in
 * migration 010, only after 008/009 have already resolved every
 * `category_id` off the raw slug.
 *
 * Seeds the 3 built-ins for every existing Home, then separately seeds any
 * *additional* distinct category string in use by either `locations` or
 * `food_name_history` that isn't one of the 3 built-ins - needed because a
 * `food_name_history` entry can reference a category with zero currently
 * active locations (or a location can be soft-deleted but still needs a
 * resolvable category_id for its own backfill in migration 008).
 */
const sql = `
CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes(id),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

INSERT INTO categories (id, home_id, name, created_at, updated_at, deleted_at)
SELECT lower(hex(randomblob(16))), homes.id, v.name, strftime('%s','now')*1000, strftime('%s','now')*1000, NULL
FROM homes, (SELECT 'alimento' AS name UNION ALL SELECT 'medicamento' UNION ALL SELECT 'otro') v;

INSERT INTO categories (id, home_id, name, created_at, updated_at, deleted_at)
SELECT lower(hex(randomblob(16))), t.home_id, t.category, strftime('%s','now')*1000, strftime('%s','now')*1000, NULL
FROM (
  SELECT home_id, category FROM locations
  UNION
  SELECT home_id, category FROM food_name_history
) t
WHERE t.category NOT IN ('alimento', 'medicamento', 'otro')
  AND NOT EXISTS (SELECT 1 FROM categories c WHERE c.home_id = t.home_id AND c.name = t.category);
`;

export { sql };
