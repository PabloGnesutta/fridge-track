import { getAllWithIndex, getOne, putOne } from "../lib/indexedDb.js";
import { apiSyncPull, apiSyncPush } from "../api-caller/apiCaller.js";
import { remoteWins } from "./lwwMerge.js";
import { _warn } from "../lib/logger.js";


/**
 * @param {Date|number|null|undefined} value
 * @returns {number|null}
 */
function toMillis(value) {
  if (value == null) { return null; }
  return value instanceof Date ? value.getTime() : Number(value);
}

/**
 * Reads every locations/items/foodNameHistory record for the Home directly
 * from IndexedDB (including tombstones - unlike fetchLocations/fetchItems,
 * which filter them out for display) and translates them into the wire
 * format the sync API expects.
 * @param {number} homeId
 */
async function buildLocalSnapshot(homeId) {
  const locations = await getAllWithIndex('locations', 'homeId', homeId);

  const items = [];
  for (const location of locations) {
    items.push(...await getAllWithIndex('items', 'locationKey', location._key));
  }

  const foodNameHistory = await getAllWithIndex('foodNameHistory', 'homeId', homeId);

  return {
    locations: locations.map(location => ({
      id: location._key,
      homeId,
      name: location.name,
      createdAt: toMillis(location.createdAt),
      updatedAt: toMillis(location.updatedAt),
      deletedAt: toMillis(location.deletedAt),
    })),
    items: items.map(item => ({
      id: item._key,
      locationId: item.locationKey,
      homeId,
      name: item.name,
      normalizedName: item.normalizedName,
      quantity: item.quantity,
      addedDate: toMillis(item.addedDate),
      useByDate: toMillis(item.useByDate),
      shelfLifeDays: item.shelfLifeDays,
      notes: item.notes,
      createdAt: toMillis(item.createdAt),
      updatedAt: toMillis(item.updatedAt),
      deletedAt: toMillis(item.deletedAt),
    })),
    foodNameHistory: foodNameHistory.map(entry => ({
      homeId,
      normalizedName: entry.normalizedName,
      name: entry.name,
      firstCreatedAt: toMillis(entry.firstCreatedAt),
      shelfLifeDays: entry.shelfLifeDays,
      timesDiscarded: entry.timesDiscarded,
      timesUsed: entry.timesUsed || 0,
      updatedAt: toMillis(entry.updatedAt) ?? toMillis(entry.firstCreatedAt),
    })),
  };
}

/**
 * @param {any} pulled
 */
async function mergeLocation(pulled) {
  const local = await getOne('locations', pulled.id);
  if (!remoteWins(local, pulled)) { return; }

  await putOne('locations', {
    name: pulled.name,
    homeId: pulled.homeId,
    createdAt: new Date(pulled.createdAt),
    updatedAt: new Date(pulled.updatedAt),
    deletedAt: pulled.deletedAt != null ? new Date(pulled.deletedAt) : null,
    _key: pulled.id,
  }, pulled.id);
}

/**
 * @param {any} pulled
 */
async function mergeItem(pulled) {
  const local = await getOne('items', pulled.id);
  if (!remoteWins(local, pulled)) { return; }

  await putOne('items', {
    locationKey: pulled.locationId,
    name: pulled.name,
    normalizedName: pulled.normalizedName,
    quantity: pulled.quantity,
    addedDate: pulled.addedDate != null ? new Date(pulled.addedDate) : null,
    useByDate: pulled.useByDate != null ? new Date(pulled.useByDate) : null,
    shelfLifeDays: pulled.shelfLifeDays,
    notes: pulled.notes,
    createdAt: new Date(pulled.createdAt),
    updatedAt: new Date(pulled.updatedAt),
    deletedAt: pulled.deletedAt != null ? new Date(pulled.deletedAt) : null,
    _key: pulled.id,
  }, pulled.id);
}

/**
 * @param {any} pulled
 */
async function mergeFoodNameHistory(pulled) {
  const key = [pulled.homeId, pulled.normalizedName];
  const local = await getOne('foodNameHistory', key);
  if (!remoteWins(local, pulled)) { return; }

  await putOne('foodNameHistory', {
    name: pulled.name,
    normalizedName: pulled.normalizedName,
    homeId: pulled.homeId,
    firstCreatedAt: new Date(pulled.firstCreatedAt),
    shelfLifeDays: pulled.shelfLifeDays,
    timesDiscarded: pulled.timesDiscarded,
    timesUsed: pulled.timesUsed || 0,
    updatedAt: new Date(pulled.updatedAt),
  }, key);
}

/**
 * Best-effort push-then-pull reconciliation of a Home's locations, items and
 * food-name-history against the server, applying last-write-wins per record.
 * Never throws - mirrors syncHomesFromServer()'s contract, so callers can
 * `try { await syncHome(id) } catch {}` and fall back to the local cache.
 * Does not touch dbStore or trigger any re-render - that's the caller's job.
 *
 * Failures are logged via _warn (not _error - this fires on every item/
 * location mutation, so auto-popping the debug panel on a flaky connection
 * would be disruptive) rather than swallowed silently. Previously a failed
 * push/pull left zero trace anywhere, which made "device A's change never
 * reached device B" reports impossible to diagnose after the fact.
 * @param {number} homeId
 */
async function syncHome(homeId) {
  try {
    const snapshot = await buildLocalSnapshot(homeId);
    const pushResult = await apiSyncPush(homeId, snapshot);
    if (pushResult.error) { _warn(' - syncHome push failed:', pushResult.error); return; }

    const pullResult = await apiSyncPull(homeId);
    if (pullResult.error || !pullResult.data) { _warn(' - syncHome pull failed:', pullResult.error); return; }

    for (const location of pullResult.data.locations) { await mergeLocation(location); }
    for (const item of pullResult.data.items) { await mergeItem(item); }
    for (const entry of pullResult.data.foodNameHistory) { await mergeFoodNameHistory(entry); }
  } catch (err) {
    _warn(' - syncHome threw (offline or unreachable):', err);
  }
}

export { syncHome };
