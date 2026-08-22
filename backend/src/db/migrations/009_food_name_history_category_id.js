/**
 * Widens `food_name_history`'s primary key from `(home_id, category,
 * normalized_name)` to `(home_id, category_id, normalized_name)` - same
 * recreate-table technique migration 005 already established (RENAME old
 * table aside, CREATE the new shape, INSERT...SELECT backfill, DROP the
 * renamed original). Safe to use the plain RENAME-based version here, unlike
 * migration 008's `locations` table - nothing holds a foreign key into
 * `food_name_history`, so there's no other table whose schema text could get
 * silently rewritten to follow the rename.
 *
 * Backfills `category_id` via a JOIN on the still-matching raw-slug
 * `category` string (see migration 007's seeding), and bumps `updated_at`
 * to now for every row - same last-write-wins reasoning as migration 008.
 */
const sql = `
ALTER TABLE food_name_history RENAME TO food_name_history_old;

CREATE TABLE food_name_history (
  home_id INTEGER NOT NULL REFERENCES homes(id),
  category_id TEXT NOT NULL REFERENCES categories(id),
  normalized_name TEXT NOT NULL,
  name TEXT NOT NULL,
  first_created_at INTEGER NOT NULL,
  shelf_life_days INTEGER,
  times_discarded INTEGER NOT NULL DEFAULT 0,
  times_used INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (home_id, category_id, normalized_name)
);

INSERT INTO food_name_history
  (home_id, category_id, normalized_name, name, first_created_at, shelf_life_days,
   times_discarded, times_used, updated_at, deleted_at)
SELECT
  food_name_history_old.home_id, categories.id, food_name_history_old.normalized_name,
  food_name_history_old.name, food_name_history_old.first_created_at,
  food_name_history_old.shelf_life_days, food_name_history_old.times_discarded,
  food_name_history_old.times_used, strftime('%s','now')*1000, food_name_history_old.deleted_at
FROM food_name_history_old
JOIN categories
  ON categories.home_id = food_name_history_old.home_id
  AND categories.name = food_name_history_old.category;

DROP TABLE food_name_history_old;
`;

export { sql };
