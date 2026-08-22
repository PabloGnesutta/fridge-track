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
 * app's own sync engine uses for locations/items) - there's no client
 * expecting to sync a "Home deleted" tombstone; any device still holding
 * this Home locally simply stops seeing it in its next homes/list sync (see
 * home-db.js's syncHomesFromServer, which prunes anything missing from that
 * list) and can no longer sync/rejoin it.
 *
 * Pure db-layer logic with no permission check of its own - shared between
 * homeService.js (the in-app "Borrar Hogar" feature, gated by
 * assertHomeMembership before this ever runs) and db/admin/homesAdmin.js
 * (operator CLI tooling, no membership to check). Kept out of both of those
 * specifically so the app-facing service layer doesn't have to depend on
 * admin-only tooling to reuse this.
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

export { deleteHomeCascade };
