/**
 * Admin-only helpers for inspecting/deleting Homes directly against the
 * database - not exposed via the API, only through manageHomes.js. Mirrors
 * allowedEmails.js's shape (plain `(db, ...)` functions, no service-layer
 * ceremony) since these are one-off operator tools, not app-facing logic.
 */

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {{
 *   id: number, name: string, joinCode: string, createdByEmail: string|null,
 *   createdAt: number, memberCount: number, locationCount: number, itemCount: number,
 * }[]}
 */
function listHomes(db) {
  /** @type {any[]} */
  const rows = db.prepare(`
    SELECT
      homes.id AS id,
      homes.name AS name,
      homes.join_code AS joinCode,
      homes.created_at AS createdAt,
      users.email AS createdByEmail,
      (SELECT COUNT(*) FROM home_members WHERE home_members.home_id = homes.id) AS memberCount,
      (SELECT COUNT(*) FROM locations WHERE locations.home_id = homes.id AND locations.deleted_at IS NULL) AS locationCount,
      (SELECT COUNT(*) FROM items WHERE items.home_id = homes.id AND items.deleted_at IS NULL) AS itemCount
    FROM homes
    LEFT JOIN users ON users.id = homes.created_by
    ORDER BY homes.id
  `).all();

  return rows.map(row => ({
    id: Number(row.id),
    name: row.name,
    joinCode: row.joinCode,
    createdByEmail: row.createdByEmail,
    createdAt: Number(row.createdAt),
    memberCount: Number(row.memberCount),
    locationCount: Number(row.locationCount),
    itemCount: Number(row.itemCount),
  }));
}

/**
 * Counts every row across every table that references this Home, without
 * deleting anything - used by manageHomes.js to show a preview before the
 * real, `--yes`-gated delete runs.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} homeId
 * @returns {{
 *   home: {id: number, name: string}|null,
 *   items: number, locations: number, foodNameHistory: number, categories: number,
 *   members: number, notificationLog: number,
 * }}
 */
function previewHomeCascade(db, homeId) {
  /** @type {any} */
  const home = db.prepare('SELECT id, name FROM homes WHERE id = ?').get(homeId);
  if (!home) {
    return {
      home: null, items: 0, locations: 0, foodNameHistory: 0, categories: 0, members: 0, notificationLog: 0,
    };
  }

  const count = (table) =>
    /** @type {any} */ (db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE home_id = ?`).get(homeId)).c;

  return {
    home: { id: Number(home.id), name: home.name },
    items: count('items'),
    locations: count('locations'),
    foodNameHistory: count('food_name_history'),
    categories: count('categories'),
    members: count('home_members'),
    notificationLog: count('push_notification_log'),
  };
}

/**
 * Deletes a Home and every row that references it, in the order its foreign
 * keys require (child tables before the tables they reference):
 * `items` (references `locations`) before `locations`/`food_name_history`
 * (both reference `categories`) before `categories`, and `home_members`/
 * `push_notification_log` (leaf tables, nothing references them) anywhere
 * before `homes` itself. Wrapped in a single transaction so a failure midway
 * leaves the Home fully intact rather than partially deleted.
 *
 * Deliberately hard-deletes (not the soft-delete/tombstone convention the
 * app's own sync engine uses for locations/items) - this is an out-of-band
 * admin operation with no client expecting to sync a "Home deleted"
 * tombstone; any device still holding this Home locally simply stops being
 * able to sync/rejoin it.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} homeId
 * @returns {{
 *   home: {id: number, name: string},
 *   items: number, locations: number, foodNameHistory: number, categories: number,
 *   members: number, notificationLog: number,
 * }|null} null if no Home with that id exists.
 */
function deleteHomeCascade(db, homeId) {
  /** @type {any} */
  const home = db.prepare('SELECT id, name FROM homes WHERE id = ?').get(homeId);
  if (!home) { return null; }

  const del = (table) =>
    /** @type {any} */ (db.prepare(`DELETE FROM ${table} WHERE home_id = ?`).run(homeId)).changes;

  db.exec('BEGIN');
  try {
    const items = del('items');
    const locations = del('locations');
    const foodNameHistory = del('food_name_history');
    const categories = del('categories');
    const members = del('home_members');
    const notificationLog = del('push_notification_log');
    db.prepare('DELETE FROM homes WHERE id = ?').run(homeId);
    db.exec('COMMIT');

    return {
      home: { id: Number(home.id), name: home.name },
      items, locations, foodNameHistory, categories, members, notificationLog,
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export { listHomes, previewHomeCascade, deleteHomeCascade };
