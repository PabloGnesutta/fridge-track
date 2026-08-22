/**
 * Small migration runner - replaces the old one-shot `db.exec(SCHEMA_SQL)`
 * (which only ever worked for brand-new tables; CREATE TABLE IF NOT EXISTS
 * is a no-op against a table that already exists on disk, even after its
 * column list changes in code, which is exactly the gap that broke
 * `food_name_history.times_used` on an already-running dev database before
 * this existed). Each migration's SQL runs at most once, tracked in
 * `schema_migrations`, in a transaction so a failing migration doesn't
 * leave the schema half-applied.
 *
 * A migration can set `disableForeignKeys: true` when its recreate-table
 * technique rebuilds a table that another table holds a foreign key into
 * (see migration 008's `locations`, referenced by `items.location_id`) -
 * `PRAGMA foreign_keys` is a documented no-op mid-transaction, so it has to
 * be toggled off before BEGIN and back on after COMMIT, around that
 * migration only, not the whole runner.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{version: number, name: string, sql: string, disableForeignKeys?: boolean}[]} migrations
 */
function runMigrations(db, migrations) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  /** @type {Set<number>} */
  const applied = new Set(
    // @ts-ignore
    db.prepare('SELECT version FROM schema_migrations').all().map(row => Number(row.version))
  );

  const pending = migrations
    .filter(m => !applied.has(m.version))
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    if (migration.disableForeignKeys) { db.exec('PRAGMA foreign_keys = OFF;'); }
    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      // Checked before COMMIT (works fine mid-transaction, independently of
      // the enforcement pragma being off) so a violation still rolls back
      // cleanly instead of leaving a committed, silently-broken schema.
      if (migration.disableForeignKeys) {
        /** @type {unknown[]} */ // @ts-ignore
        const violations = db.prepare('PRAGMA foreign_key_check').all();
        if (violations.length) {
          throw new Error(
            `Migration ${migration.version} (${migration.name}) left dangling foreign keys: `
            + JSON.stringify(violations)
          );
        }
      }
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, Date.now());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    } finally {
      if (migration.disableForeignKeys) { db.exec('PRAGMA foreign_keys = ON;'); }
    }
  }
}

export { runMigrations };
