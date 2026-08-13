/**
 * Small migration runner - replaces the old one-shot `db.exec(SCHEMA_SQL)`
 * (which only ever worked for brand-new tables; CREATE TABLE IF NOT EXISTS
 * is a no-op against a table that already exists on disk, even after its
 * column list changes in code, which is exactly the gap that broke
 * `food_name_history.times_used` on an already-running dev database before
 * this existed). Each migration's SQL runs at most once, tracked in
 * `schema_migrations`, in a transaction so a failing migration doesn't
 * leave the schema half-applied.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{version: number, name: string, sql: string}[]} migrations
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
    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, Date.now());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

export { runMigrations };
