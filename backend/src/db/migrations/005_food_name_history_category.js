/**
 * Scopes food_name_history by location category (alimento/medicamento/otro)
 * in addition to Home - so "Leche" learned in a fridge no longer shares its
 * shelf-life default or autocomplete slot with an unrelated "Leche"-shaped
 * name in a medicine cabinet. SQLite can't widen a PRIMARY KEY in place, so
 * this recreates the table rather than a plain ALTER TABLE ADD COLUMN:
 * rename the old table aside, create the new 3-column-key one, copy every
 * row across with category backfilled to 'alimento' (safe - every existing
 * row predates location categories entirely, so all of them are, in fact,
 * food), then drop the renamed original.
 */
const sql = `
ALTER TABLE food_name_history RENAME TO food_name_history_old;

CREATE TABLE food_name_history (
  home_id INTEGER NOT NULL REFERENCES homes(id),
  category TEXT NOT NULL DEFAULT 'alimento',
  normalized_name TEXT NOT NULL,
  name TEXT NOT NULL,
  first_created_at INTEGER NOT NULL,
  shelf_life_days INTEGER,
  times_discarded INTEGER NOT NULL DEFAULT 0,
  times_used INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (home_id, category, normalized_name)
);

INSERT INTO food_name_history
  (home_id, category, normalized_name, name, first_created_at, shelf_life_days, times_discarded, times_used, updated_at)
SELECT
  home_id, 'alimento', normalized_name, name, first_created_at, shelf_life_days, times_discarded, times_used, updated_at
FROM food_name_history_old;

DROP TABLE food_name_history_old;
`;

export { sql };
