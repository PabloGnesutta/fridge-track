import { dbStore } from "../common/state.js";
import { normalize } from "../lib/string.js";
import { clearArray } from "../lib/utils.js";
import { getAllWithIndex, getOne, putOne } from "../lib/indexedDb.js";


/**
 * Per-food-name knowledge, learned across every location within a Home (not
 * scoped to a single fridge/freezer, but scoped to the Home) so autocomplete
 * suggestions and stats stay useful regardless of where an item is being
 * added, while staying separate between households.
 * @typedef {object} FoodNameHistory
 * @property {string} name
 * @property {string} normalizedName
 * @property {number} homeId
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
 */

/**
 * Records that a food item with this name was just created, upserting its
 * history entry: first use creates the record, later uses only refresh
 * shelfLifeDays (and only when one was actually provided this time).
 * @param {number} homeId
 * @param {string} name
 * @param {number|null|undefined} shelfLifeDays
 * @param {Date} date
 * @returns {Promise<FoodNameHistory>}
 */
async function recordItemCreated(homeId, name, shelfLifeDays, date) {
  const normalizedName = normalize(name);
  const key = [homeId, normalizedName];
  /** @type {FoodNameHistory|null} */ // @ts-ignore
  const existing = await getOne('foodNameHistory', key);

  if (!existing) {
    /** @type {FoodNameHistory} */
    const record = {
      name,
      normalizedName,
      homeId,
      firstCreatedAt: date,
      shelfLifeDays: shelfLifeDays ?? null,
      timesDiscarded: 0,
      timesUsed: 0,
      updatedAt: date,
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
 * @param {string} name
 * @param {number} delta
 * @param {Date} [date]
 */
async function adjustDiscardCount(homeId, name, delta, date = new Date()) {
  const normalizedName = normalize(name);
  const key = [homeId, normalizedName];
  /** @type {FoodNameHistory|null} */ // @ts-ignore
  const existing = await getOne('foodNameHistory', key);
  if (!existing) { return; }

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
 * @param {string} name
 * @param {number} delta
 * @param {Date} [date]
 */
async function adjustUsedCount(homeId, name, delta, date = new Date()) {
  const normalizedName = normalize(name);
  const key = [homeId, normalizedName];
  /** @type {FoodNameHistory|null} */ // @ts-ignore
  const existing = await getOne('foodNameHistory', key);
  if (!existing) { return; }

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
  const entries = await getAllWithIndex('foodNameHistory', 'homeId', homeId);
  entries.sort((a, b) => a.name.localeCompare(b.name));

  clearArray(dbStore.foodNameHistory);
  dbStore.foodNameHistory.push(...entries);
  return entries;
}

/**
 * Keeps the in-memory cache consistent with a single record we just wrote,
 * without a full re-fetch.
 * @param {FoodNameHistory} record
 */
function upsertCache(record) {
  const idx = dbStore.foodNameHistory.findIndex(
    e => e.normalizedName === record.normalizedName && e.homeId === record.homeId
  );
  if (idx === -1) {
    dbStore.foodNameHistory.push(record);
  } else {
    dbStore.foodNameHistory[idx] = record;
  }
}


export { recordItemCreated, adjustDiscardCount, adjustUsedCount, fetchFoodNameHistory };
