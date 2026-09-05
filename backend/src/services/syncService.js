import { assertHomeMembership } from './homeService.js';


/**
 * @param {any} row
 */
function categoryFromRow(row) {
  return {
    id: row.id,
    homeId: Number(row.home_id),
    name: row.name,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    deletedAt: row.deleted_at == null ? null : Number(row.deleted_at),
  };
}

/**
 * @param {any} row
 */
function locationFromRow(row) {
  return {
    id: row.id,
    homeId: Number(row.home_id),
    name: row.name,
    categoryId: row.category_id,
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
    categoryId: row.category_id,
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
   * Resolves the category_id to write for a pushed location/food_name_history
   * record. If the client already supplied `categoryId` (the normal case,
   * once it's synced categories at least once), it's used as-is. Otherwise
   * falls back to resolving the legacy `category` string field a
   * pre-upgrade client might still be sending (mirrors buildLocalSnapshot's
   * own 'alimento' fallback on the frontend), and if that also fails to
   * match (should be effectively unreachable given migration 007's seeding
   * of every distinct in-use category string, but defensive) falls back to
   * the Home's 'Alimentos' row. This is the only place string->id resolution
   * logic lives - no client-side name-matching needed.
   * @param {number} homeId
   * @param {string|undefined|null} categoryId
   * @param {string|undefined|null} legacyCategoryName
   * @returns {string}
   */
  function resolveCategoryId(homeId, categoryId, legacyCategoryName) {
    if (categoryId) { return categoryId; }

    if (legacyCategoryName) {
      const byName = db.prepare('SELECT id FROM categories WHERE home_id = ? AND name = ?')
        .get(homeId, legacyCategoryName);
      if (byName) { return /** @type {any} */ (byName).id; }
    }

    const fallback = db.prepare(`SELECT id FROM categories WHERE home_id = ? AND name = 'Alimentos'`)
      .get(homeId);
    if (fallback) { return /** @type {any} */ (fallback).id; }

    throw new Error(`No default category found for home ${homeId}`);
  }

  /**
   * @param {number} userId
   * @param {number} homeId
   */
  function pullHomeSnapshot(userId, homeId) {
    assertHomeMembership(db, homeId, userId);

    const categories = db.prepare('SELECT * FROM categories WHERE home_id = ?')
      .all(homeId).map(categoryFromRow);
    const locations = db.prepare('SELECT * FROM locations WHERE home_id = ?')
      .all(homeId).map(locationFromRow);
    const items = db.prepare('SELECT * FROM items WHERE home_id = ?')
      .all(homeId).map(itemFromRow);
    const foodNameHistory = db.prepare('SELECT * FROM food_name_history WHERE home_id = ?')
      .all(homeId).map(foodNameHistoryFromRow);

    return { categories, locations, items, foodNameHistory };
  }

  /**
   * @param {number} homeId
   * @param {any} category
   */
  function pushCategory(homeId, category) {
    if (Number(category.homeId) !== homeId) { return; }

    const existing = /** @type {any} */ (
      db.prepare('SELECT home_id, updated_at FROM categories WHERE id = ?').get(category.id)
    );
    // The id belongs to a different Home (e.g. a foreign UUID sent by a client
    // that only proved membership of `homeId`, not of the row's real Home) -
    // ignore rather than let the UPDATE below touch it.
    if (existing && Number(existing.home_id) !== homeId) { return; }
    if (existing && Number(existing.updated_at) >= Number(category.updatedAt)) { return; }

    if (existing) {
      db.prepare(
        `UPDATE categories SET name = ?, updated_at = ?, deleted_at = ? WHERE id = ? AND home_id = ?`
      ).run(category.name, category.updatedAt, category.deletedAt ?? null, category.id, homeId);
    } else {
      db.prepare(
        `INSERT INTO categories (id, home_id, name, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(category.id, homeId, category.name, category.createdAt, category.updatedAt, category.deletedAt ?? null);
    }
  }

  /**
   * @param {number} homeId
   * @param {any} location
   */
  function pushLocation(homeId, location) {
    if (Number(location.homeId) !== homeId) { return; }

    const existing = /** @type {any} */ (
      db.prepare('SELECT home_id, updated_at FROM locations WHERE id = ?').get(location.id)
    );
    if (existing && Number(existing.home_id) !== homeId) { return; }
    if (existing && Number(existing.updated_at) >= Number(location.updatedAt)) { return; }

    const categoryId = resolveCategoryId(homeId, location.categoryId, location.category);

    if (existing) {
      db.prepare(
        `UPDATE locations SET name = ?, category_id = ?, updated_at = ?, deleted_at = ? WHERE id = ? AND home_id = ?`
      ).run(location.name, categoryId, location.updatedAt, location.deletedAt ?? null, location.id, homeId);
    } else {
      db.prepare(
        `INSERT INTO locations (id, home_id, name, category_id, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        location.id, homeId, location.name, categoryId,
        location.createdAt, location.updatedAt, location.deletedAt ?? null
      );
    }
  }

  /**
   * @param {number} homeId
   * @param {any} item
   */
  function pushItem(homeId, item) {
    if (Number(item.homeId) !== homeId) { return; }

    const existing = /** @type {any} */ (
      db.prepare('SELECT home_id, updated_at FROM items WHERE id = ?').get(item.id)
    );
    if (existing && Number(existing.home_id) !== homeId) { return; }
    if (existing && Number(existing.updated_at) >= Number(item.updatedAt)) { return; }

    if (existing) {
      db.prepare(
        `UPDATE items SET location_id = ?, name = ?, normalized_name = ?, quantity = ?,
           added_date = ?, use_by_date = ?, shelf_life_days = ?, notes = ?,
           updated_at = ?, deleted_at = ?
         WHERE id = ? AND home_id = ?`
      ).run(
        item.locationId, item.name, item.normalizedName, item.quantity ?? '',
        item.addedDate ?? null, item.useByDate ?? null, item.shelfLifeDays ?? null, item.notes ?? '',
        item.updatedAt, item.deletedAt ?? null, item.id, homeId
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
   * @param {number} homeId
   * @param {any} entry
   */
  function pushFoodNameHistory(homeId, entry) {
    if (Number(entry.homeId) !== homeId) { return; }
    const categoryId = resolveCategoryId(homeId, entry.categoryId, entry.category);

    const existing = db.prepare(
      'SELECT updated_at FROM food_name_history WHERE home_id = ? AND category_id = ? AND normalized_name = ?'
    ).get(homeId, categoryId, entry.normalizedName);
    if (existing && Number(/** @type {any} */(existing).updated_at) >= Number(entry.updatedAt)) { return; }

    if (existing) {
      db.prepare(
        `UPDATE food_name_history
           SET name = ?, shelf_life_days = ?, times_discarded = ?, times_used = ?, updated_at = ?, deleted_at = ?
         WHERE home_id = ? AND category_id = ? AND normalized_name = ?`
      ).run(
        entry.name, entry.shelfLifeDays ?? null, entry.timesDiscarded ?? 0, entry.timesUsed ?? 0,
        entry.updatedAt, entry.deletedAt ?? null, homeId, categoryId, entry.normalizedName
      );
    } else {
      db.prepare(
        `INSERT INTO food_name_history
           (home_id, category_id, normalized_name, name, first_created_at, shelf_life_days, times_discarded, times_used, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        homeId, categoryId, entry.normalizedName, entry.name, entry.firstCreatedAt, entry.shelfLifeDays ?? null,
        entry.timesDiscarded ?? 0, entry.timesUsed ?? 0, entry.updatedAt, entry.deletedAt ?? null
      );
    }
  }

  /**
   * @param {number} userId
   * @param {number} homeId
   * @param {{categories?: any[], locations?: any[], items?: any[], foodNameHistory?: any[]}} snapshot
   */
  function pushHomeSnapshot(userId, homeId, snapshot) {
    assertHomeMembership(db, homeId, userId);

    const categories = snapshot?.categories ?? [];
    const locations = snapshot?.locations ?? [];
    const items = snapshot?.items ?? [];
    const foodNameHistory = snapshot?.foodNameHistory ?? [];

    db.exec('BEGIN');
    try {
      // Categories first - locations/foodNameHistory below may reference a
      // category created in this very snapshot (a brand-new custom category
      // picked in the same form submit that created the location using it),
      // and their category_id foreign key needs that row to already exist.
      for (const category of categories) { pushCategory(homeId, category); }
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
        categories: categories.length,
        locations: locations.length,
        items: items.length,
        foodNameHistory: foodNameHistory.length,
      },
    };
  }

  return { pullHomeSnapshot, pushHomeSnapshot };
}

export { createSyncService };
