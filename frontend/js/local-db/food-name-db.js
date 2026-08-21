import { dbStore } from "../common/state.js";
import { normalize } from "../lib/string.js";
import { clearArray } from "../lib/utils.js";
import { getAllWithIndex, getOne, putOne } from "../lib/indexedDb.js";


/**
 * Per-food-name knowledge, learned across every location that shares a
 * category within a Home (e.g. every fridge/freezer, but not a medicine
 * cabinet) so autocomplete suggestions and stats stay relevant to what kind
 * of thing is actually being added, while staying separate between
 * households. Keyed `[homeId, category, normalizedName]` - see CLAUDE.md's
 * "food-name-history category scoping" section for why category was added
 * on top of the original `[homeId, normalizedName]` key.
 * @typedef {object} FoodNameHistory
 * @property {string} name
 * @property {string} normalizedName
 * @property {number} homeId
 * @property {string} [category] Absent on records written before category
 *   scoping existed; treated as 'alimento' everywhere it's read, since every
 *   such record predates location categories entirely.
 * @property {Date} firstCreatedAt
 * @property {number|null} shelfLifeDays Most recently used "days to expire"
 *   value for this name. Only ever set from shelfLifeDays-based items - a
 *   due-date-based item never touches this field, positive or negative.
 * @property {number} timesDiscarded
 * @property {number} [timesUsed] Only incremented by "Usado" specifically -
 *   not the trash-icon delete, which isn't a real "I ate this" signal.
 *   Absent on records written before this field existed; treated as 0.
 * @property {Date} [updatedAt] Absent on records written before sync existed;
 *   treated as older than anything for last-write-wins comparisons.
 * @property {Date|null} [deletedAt] Soft-delete tombstone, same convention as
 *   items/locations - set by deleteFoodNameHistory() (an explicit user
 *   delete) and by updateFoodNameHistory() on the old key of a rename that
 *   changes the normalized name (see below). A tombstoned record is treated
 *   as nonexistent by recordItemCreated() (creating a new item under that
 *   name resurrects it as a fresh entry, not the old stats) and by
 *   adjustDiscardCount()/adjustUsedCount() (no-op rather than silently
 *   reviving a deleted entry).
 */

/**
 * Records that a food item with this name was just created, upserting its
 * history entry: first use creates the record, later uses only refresh
 * shelfLifeDays (and only when one was actually provided this time).
 * @param {number} homeId
 * @param {string} category The item's location's category (locations always
 *   have one, defaulting to 'alimento' - see location-db.js).
 * @param {string} name
 * @param {number|null|undefined} shelfLifeDays
 * @param {Date} date
 * @returns {Promise<FoodNameHistory>}
 */
async function recordItemCreated(homeId, category, name, shelfLifeDays, date) {
  const normalizedName = normalize(name);
  const key = [homeId, category, normalizedName];
  /** @type {FoodNameHistory|null} */ // @ts-ignore
  const existing = await getOne('foodNameHistory', key);

  // A tombstoned entry (explicitly deleted from /historial) is treated as
  // nonexistent here - creating a new item under that name starts a fresh
  // record rather than quietly resurrecting the old counts/shelf-life.
  if (!existing || existing.deletedAt) {
    /** @type {FoodNameHistory} */
    const record = {
      name,
      normalizedName,
      homeId,
      category,
      firstCreatedAt: date,
      shelfLifeDays: shelfLifeDays ?? null,
      timesDiscarded: 0,
      timesUsed: 0,
      updatedAt: date,
      deletedAt: null,
    };
    await putOne('foodNameHistory', record, key);
    upsertCache(record);
    return record;
  }

  if (shelfLifeDays != null) { existing.shelfLifeDays = shelfLifeDays; }
  existing.updatedAt = date;
  await putOne('foodNameHistory', existing, key);
  upsertCache(existing);
  return existing;
}

/**
 * Adjusts the discard count for a name (+1 when marked "Tirado", -1 if that
 * action is undone). No-ops if the name has no history entry.
 * @param {number} homeId
 * @param {string} category
 * @param {string} name
 * @param {number} delta
 * @param {Date} [date]
 */
async function adjustDiscardCount(homeId, category, name, delta, date = new Date()) {
  const normalizedName = normalize(name);
  const key = [homeId, category, normalizedName];
  /** @type {FoodNameHistory|null} */ // @ts-ignore
  const existing = await getOne('foodNameHistory', key);
  if (!existing || existing.deletedAt) { return; }

  existing.timesDiscarded = Math.max(0, existing.timesDiscarded + delta);
  existing.updatedAt = date;
  await putOne('foodNameHistory', existing, key);
  upsertCache(existing);
}

/**
 * Adjusts the used count for a name (+1 when marked "Usado", -1 if that
 * action is undone). Mirrors adjustDiscardCount() - kept as a separate
 * counter rather than folded into it, since "used" and "discarded" are
 * opposite outcomes a stats view needs to tell apart. No-ops if the name has
 * no history entry.
 * @param {number} homeId
 * @param {string} category
 * @param {string} name
 * @param {number} delta
 * @param {Date} [date]
 */
async function adjustUsedCount(homeId, category, name, delta, date = new Date()) {
  const normalizedName = normalize(name);
  const key = [homeId, category, normalizedName];
  /** @type {FoodNameHistory|null} */ // @ts-ignore
  const existing = await getOne('foodNameHistory', key);
  if (!existing || existing.deletedAt) { return; }

  existing.timesUsed = Math.max(0, (existing.timesUsed || 0) + delta);
  existing.updatedAt = date;
  await putOne('foodNameHistory', existing, key);
  upsertCache(existing);
}

/**
 * Fetch all food name history entries for the given Home, sorted
 * alphabetically. Stores them in dbStore.
 * @param {number} homeId
 * @returns {Promise<FoodNameHistory[]>}
 */
async function fetchFoodNameHistory(homeId) {
  /** @type {FoodNameHistory[]} */ // @ts-ignore
  const entries = (await getAllWithIndex('foodNameHistory', 'homeId', homeId))
    .filter(entry => entry.deletedAt == null);
  entries.sort((a, b) => a.name.localeCompare(b.name));

  clearArray(dbStore.foodNameHistory);
  dbStore.foodNameHistory.push(...entries);
  return entries;
}

/**
 * Soft-deletes a history entry from the /historial view - tombstoned like
 * items/locations already are, not hard-removed, so the deletion propagates
 * through sync. No-op if the entry doesn't exist. Doesn't touch dbStore
 * itself; callers re-fetch (fetchFoodNameHistory) afterward to refresh both
 * the shared autocomplete cache and their own view of the list, the same way
 * every other write in this module keeps dbStore consistent via upsertCache
 * except this one - a plain refetch is simpler and this path is only ever
 * hit from a deliberate, infrequent user action on the history screen, not
 * a hot path like item creation.
 * @param {number} homeId
 * @param {string} category
 * @param {string} normalizedName
 * @param {Date} [date]
 */
async function deleteFoodNameHistory(homeId, category, normalizedName, date = new Date()) {
  const key = [homeId, category, normalizedName];
  /** @type {FoodNameHistory|null} */ // @ts-ignore
  const existing = await getOne('foodNameHistory', key);
  if (!existing) { return; }

  existing.deletedAt = date;
  existing.updatedAt = date;
  await putOne('foodNameHistory', existing, key);
}

/**
 * Edits an existing entry's display name and/or shelfLifeDays, fixing a
 * typo or a wrong learned default. A name change that alters the normalized
 * form moves the record to a new key rather than updating it in place -
 * normalizedName is derived from name and is part of this store's key - so
 * it tombstones the old key and creates a new one carrying over the
 * accumulated firstCreatedAt/timesDiscarded/timesUsed. Blocked (not merged
 * or silently overwritten) if that new key collides with another still-live
 * entry, since combining two different names' histories is a bigger,
 * unrequested decision than a rename should silently make.
 * @param {number} homeId
 * @param {string} category
 * @param {FoodNameHistory} entry The entry being edited (as currently known
 *   to the caller - e.g. from the /historial list).
 * @param {string} newName
 * @param {number|null} newShelfLifeDays
 * @param {Date} [date]
 * @returns {Promise<{ok: true}|{ok: false, error: string}>}
 */
async function updateFoodNameHistory(homeId, category, entry, newName, newShelfLifeDays, date = new Date()) {
  const newNormalizedName = normalize(newName);
  const oldKey = [homeId, category, entry.normalizedName];

  if (newNormalizedName === entry.normalizedName) {
    const updated = { ...entry, name: newName, shelfLifeDays: newShelfLifeDays, updatedAt: date };
    await putOne('foodNameHistory', updated, oldKey);
    return { ok: true };
  }

  const newKey = [homeId, category, newNormalizedName];
  /** @type {FoodNameHistory|null} */ // @ts-ignore
  const collision = await getOne('foodNameHistory', newKey);
  if (collision && !collision.deletedAt) {
    return { ok: false, error: 'Ya existe un historial con ese nombre' };
  }

  await putOne('foodNameHistory', { ...entry, deletedAt: date, updatedAt: date }, oldKey);
  await putOne('foodNameHistory', {
    ...entry,
    name: newName,
    normalizedName: newNormalizedName,
    shelfLifeDays: newShelfLifeDays,
    deletedAt: null,
    updatedAt: date,
  }, newKey);

  return { ok: true };
}

/**
 * Keeps the in-memory cache consistent with a single record we just wrote,
 * without a full re-fetch.
 * @param {FoodNameHistory} record
 */
function upsertCache(record) {
  const idx = dbStore.foodNameHistory.findIndex(
    e => e.normalizedName === record.normalizedName && e.homeId === record.homeId
      && (e.category || 'alimento') === (record.category || 'alimento')
  );
  if (idx === -1) {
    dbStore.foodNameHistory.push(record);
  } else {
    dbStore.foodNameHistory[idx] = record;
  }
}


export {
  recordItemCreated, adjustDiscardCount, adjustUsedCount, fetchFoodNameHistory,
  deleteFoodNameHistory, updateFoodNameHistory,
};
