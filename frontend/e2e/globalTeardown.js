import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '../../backend/data/fridgetrack.db');

// Matches the unique-email format e2e/helpers.js's ensureAuth() generates -
// this is what lets teardown find every account/Home/session a test run
// created without touching anything a real user created.
const TEST_EMAIL_PATTERN = 'e2e+%@test.local';

/**
 * Runs once after the whole e2e suite finishes (see playwright.config.js's
 * globalTeardown). The backend's sqlite file is real/persistent (not reset
 * per test the way IndexedDB is), so every account ensureAuth() signs up
 * would otherwise accumulate there forever - this sweeps them back out.
 */
export default async function globalTeardown() {
  const db = new DatabaseSync(DB_PATH);
  try {
    /** @type {{id: number}[]} */ // @ts-ignore
    const testUsers = db.prepare('SELECT id FROM users WHERE email LIKE ?').all(TEST_EMAIL_PATTERN);
    db.prepare('DELETE FROM allowed_emails WHERE email LIKE ?').run(TEST_EMAIL_PATTERN);
    if (!testUsers.length) { return; }

    const userIds = testUsers.map(u => u.id);
    const placeholders = userIds.map(() => '?').join(',');

    /** @type {{id: number}[]} */ // @ts-ignore
    const testHomes = db.prepare(`SELECT id FROM homes WHERE created_by IN (${placeholders})`).all(...userIds);
    const homeIds = testHomes.map(h => h.id);
    const homePlaceholders = homeIds.map(() => '?').join(',');

    if (homeIds.length) {
      db.prepare(`DELETE FROM items WHERE home_id IN (${homePlaceholders})`).run(...homeIds);
      db.prepare(`DELETE FROM locations WHERE home_id IN (${homePlaceholders})`).run(...homeIds);
      db.prepare(`DELETE FROM food_name_history WHERE home_id IN (${homePlaceholders})`).run(...homeIds);
    }
    db.prepare(`DELETE FROM sessions WHERE user_id IN (${placeholders})`).run(...userIds);
    db.prepare(`DELETE FROM home_members WHERE user_id IN (${placeholders})`).run(...userIds);
    db.prepare(`DELETE FROM homes WHERE created_by IN (${placeholders})`).run(...userIds);
    db.prepare(`DELETE FROM users WHERE id IN (${placeholders})`).run(...userIds);
  } finally {
    db.close();
  }
}
