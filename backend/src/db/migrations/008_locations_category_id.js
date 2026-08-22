/**
 * Widens `locations.category` (string) into `locations.category_id`
 * (references categories(id), see migration 007), backfilled via a plain
 * JOIN on the still-matching raw-slug strings.
 *
 * Unlike migration 005/009's RENAME-based recreate-table technique, this one
 * can't use `ALTER TABLE locations RENAME TO locations_old` - `items.
 * location_id REFERENCES locations(id)` is a real incoming foreign key, and
 * SQLite's RENAME automatically rewrites *other* tables' FK clauses to
 * follow the new name (confirmed empirically before writing this: `items`'
 * schema silently became `REFERENCES "locations_old"(id)`). That leaves the
 * later `DROP TABLE locations_old` failing with a FOREIGN KEY constraint
 * error, or - if foreign keys are off at that point - a table permanently
 * missing after the drop, since nothing re-points `items` back at the new
 * `locations` table. So this instead builds the new shape under a temporary
 * name, drops the *original* `locations` (never renamed away, so `items`'
 * schema text is never touched), then renames the new table into place -
 * `items`' own FK clause is untouched throughout, since it always just says
 * `REFERENCES locations(id)`.
 *
 * That still requires foreign key *enforcement* off for the duration (SQLite
 * won't allow dropping a table that's an active FK target, even though the
 * schema-text rewrite above is what actually corrupts things) - and
 * `PRAGMA foreign_keys` is a documented no-op mid-transaction, so it has to
 * be toggled outside this migration's own BEGIN/COMMIT. See migrate.js's
 * `disableForeignKeys` migration flag, added specifically for this.
 *
 * Sets `updated_at = strftime('%s','now')*1000` for every backfilled row
 * (deliberately not preserving the original timestamp, unlike migration
 * 005) - this is what lets the existing last-write-wins sync logic
 * (lwwMerge.js's remoteWins, strict `>` comparison) naturally overwrite any
 * client's stale local copy (still missing categoryId) on its next pull,
 * with zero new client-side reconciliation code.
 */
const sql = `
CREATE TABLE locations_new (
  id TEXT PRIMARY KEY,
  home_id INTEGER NOT NULL REFERENCES homes(id),
  name TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

INSERT INTO locations_new (id, home_id, name, category_id, created_at, updated_at, deleted_at)
SELECT locations.id, locations.home_id, locations.name, categories.id,
       locations.created_at, strftime('%s','now')*1000, locations.deleted_at
FROM locations
JOIN categories ON categories.home_id = locations.home_id AND categories.name = locations.category;

DROP TABLE locations;

ALTER TABLE locations_new RENAME TO locations;
`;

export { sql };
