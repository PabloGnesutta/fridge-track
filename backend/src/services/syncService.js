import { assertHomeMembership } from './homeService.js';


/**
 * @param {any} row
 */
function locationFromRow(row) {
  return {
    id: row.id,
    homeId: Number(row.home_id),
    name: row.name,
    category: row.category,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    deletedAt: row.deleted_at == null ? null : Number(row.deleted_at),
  };
}

/**
 * @param {any} row
 */
function itemFromRow(row) {
  return {
    id: row.id,
    locationId: row.location_id,
    homeId: Number(row.home_id),
    name: row.name,
    normalizedName: row.normalized_name,
    quantity: row.quantity,
    addedDate: row.added_date == null ? null : Number(row.added_date),
    useByDate: row.use_by_date == null ? null : Number(row.use_by_date),
    shelfLifeDays: row.shelf_life_days == null ? null : Number(row.shelf_life_days),
    notes: row.notes,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    deletedAt: row.deleted_at == null ? null : Number(row.deleted_at),
  };
}

/**
 * @param {any} row
 */
function foodNameHistoryFromRow(row) {
  return {
    homeId: Number(row.home_id),
    category: row.category,
    normalizedName: row.normalized_name,
    name: row.name,
    firstCreatedAt: Number(row.first_created_at),
    shelfLifeDays: row.shelf_life_days == null ? null : Number(row.shelf_life_days),
    timesDiscarded: Number(row.times_discarded),
    timesUsed: Number(row.times_used),
    updatedAt: Number(row.updated_at),
    deletedAt: row.deleted_at == null ? null : Number(row.deleted_at),
  };
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 */
function createSyncService(db) {
  /**
   * @param {number} userId
   * @param {number} homeId
   */
  function pullHomeSnapshot(userId, homeId) {
    assertHomeMembership(db, homeId, userId);

    const locations = db.prepare('SELECT * FROM locations WHERE home_id = ?')
      .all(homeId).map(locationFromRow);
    const items = db.prepare('SELECT * FROM items WHERE home_id = ?')
      .all(homeId).map(itemFromRow);
    const foodNameHistory = db.prepare('SELECT * FROM food_name_history WHERE home_id = ?')
      .all(homeId).map(foodNameHistoryFromRow);

    return { locations, items, foodNameHistory };
  }

  /**
   * @param {any} location
   */
  function pushLocation(homeId, location) {
    if (Number(location.homeId) !== homeId) { return; }

    const existing = db.prepare('SELECT updated_at FROM locations WHERE id = ?').get(location.id);
    if (existing && Number(existing.updated_at) >= Number(location.updatedAt)) { return; }

    if (existing) {
      db.prepare(
        `UPDATE locations SET name = ?, category = ?, updated_at = ?, deleted_at = ? WHERE id = ?`
      ).run(location.name, location.category ?? 'alimento', location.updatedAt, location.deletedAt ?? null, location.id);
    } else {
      db.prepare(
        `INSERT INTO locations (id, home_id, name, category, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        location.id, homeId, location.name, location.category ?? 'alimento',
        location.createdAt, location.updatedAt, location.deletedAt ?? null
      );
    }
  }

  /**
   * @param {any} item
   */
  function pushItem(homeId, item) {
    if (Number(item.homeId) !== homeId) { return; }

    const existing = db.prepare('SELECT updated_at FROM items WHERE id = ?').get(item.id);
    if (existing && Number(existing.updated_at) >= Number(item.updatedAt)) { return; }

    if (existing) {
      db.prepare(
        `UPDATE items SET location_id = ?, name = ?, normalized_name = ?, quantity = ?,
           added_date = ?, use_by_date = ?, shelf_life_days = ?, notes = ?,
           updated_at = ?, deleted_at = ?
         WHERE id = ?`
      ).run(
        item.locationId, item.name, item.normalizedName, item.quantity ?? '',
        item.addedDate ?? null, item.useByDate ?? null, item.shelfLifeDays ?? null, item.notes ?? '',
        item.updatedAt, item.deletedAt ?? null, item.id
      );
    } else {
      db.prepare(
        `INSERT INTO items (id, location_id, home_id, name, normalized_name, quantity,
           added_date, use_by_date, shelf_life_days, notes, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        item.id, item.locationId, homeId, item.name, item.normalizedName, item.quantity ?? '',
        item.addedDate ?? null, item.useByDate ?? null, item.shelfLifeDays ?? null, item.notes ?? '',
        item.createdAt, item.updatedAt, item.deletedAt ?? null
      );
    }
  }

  /**
   * @param {any} entry
   */
  function pushFoodNameHistory(homeId, entry) {
    if (Number(entry.homeId) !== homeId) { return; }
    // Defaults for a client still running pre-category code (or replaying an
    // old local record - see syncEngine.js's buildLocalSnapshot) - every
    // entry that predates location categories is, in fact, food.
    const category = entry.category || 'alimento';

    const existing = db.prepare(
      'SELECT updated_at FROM food_name_history WHERE home_id = ? AND category = ? AND normalized_name = ?'
    ).get(homeId, category, entry.normalizedName);
    if (existing && Number(existing.updated_at) >= Number(entry.updatedAt)) { return; }

    if (existing) {
      db.prepare(
        `UPDATE food_name_history
           SET name = ?, shelf_life_days = ?, times_discarded = ?, times_used = ?, updated_at = ?, deleted_at = ?
         WHERE home_id = ? AND category = ? AND normalized_name = ?`
      ).run(
        entry.name, entry.shelfLifeDays ?? null, entry.timesDiscarded ?? 0, entry.timesUsed ?? 0,
        entry.updatedAt, entry.deletedAt ?? null, homeId, category, entry.normalizedName
      );
    } else {
      db.prepare(
        `INSERT INTO food_name_history
           (home_id, category, normalized_name, name, first_created_at, shelf_life_days, times_discarded, times_used, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        homeId, category, entry.normalizedName, entry.name, entry.firstCreatedAt, entry.shelfLifeDays ?? null,
        entry.timesDiscarded ?? 0, entry.timesUsed ?? 0, entry.updatedAt, entry.deletedAt ?? null
      );
    }
  }

  /**
   * @param {number} userId
   * @param {number} homeId
   * @param {{locations?: any[], items?: any[], foodNameHistory?: any[]}} snapshot
   */
  function pushHomeSnapshot(userId, homeId, snapshot) {
    assertHomeMembership(db, homeId, userId);

    const locations = snapshot?.locations ?? [];
    const items = snapshot?.items ?? [];
    const foodNameHistory = snapshot?.foodNameHistory ?? [];

    db.exec('BEGIN');
    try {
      for (const location of locations) { pushLocation(homeId, location); }
      for (const item of items) { pushItem(homeId, item); }
      for (const entry of foodNameHistory) { pushFoodNameHistory(homeId, entry); }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    return {
      pushed: {
        locations: locations.length,
        items: items.length,
        foodNameHistory: foodNameHistory.length,
      },
    };
  }

  return { pullHomeSnapshot, pushHomeSnapshot };
}

export { createSyncService };
