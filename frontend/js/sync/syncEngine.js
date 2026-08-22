import { getAllWithIndex, getOne, putOne, deleteOne } from "../lib/indexedDb.js";
import { apiSyncPull, apiSyncPush } from "../api-caller/apiCaller.js";
import { remoteWins } from "./lwwMerge.js";
import { _error } from "../lib/logger.js";


/**
 * @param {Date|number|null|undefined} value
 * @returns {number|null}
 */
function toMillis(value) {
  if (value == null) { return null; }
  return value instanceof Date ? value.getTime() : Number(value);
}

/**
 * Reads every categories/locations/items/foodNameHistory record for the Home
 * directly from IndexedDB (including tombstones - unlike fetchLocations/
 * fetchItems/fetchCategories, which filter them out for display) and
 * translates them into the wire format the sync API expects. Also returns
 * the IndexedDB keys of any foodNameHistory records still sitting under a
 * pre-categoryId key (either the original 2-part `[homeId, normalizedName]`
 * key, or the intermediate 3-part `[homeId, categoryString, normalizedName]`
 * key from before categories became a real table) - they're included in the
 * pushed snapshot below (with a `category` string fallback the backend's
 * resolveCategoryId can resolve server-side) but syncHome() needs their
 * *old* key separately, to delete them locally once the round trip lands
 * their data under the new categoryId-keyed key. Without that cleanup they
 * linger forever alongside the new-keyed record synced back down, showing up
 * as a duplicate entry in /historial.
 * @param {number} homeId
 */
async function buildLocalSnapshot(homeId) {
  const categories = await getAllWithIndex('categories', 'homeId', homeId);
  const locations = await getAllWithIndex('locations', 'homeId', homeId);

  const items = [];
  for (const location of locations) {
    items.push(...await getAllWithIndex('items', 'locationKey', location._key));
  }

  const foodNameHistory = await getAllWithIndex('foodNameHistory', 'homeId', homeId);
  const legacyFoodNameHistoryKeys = foodNameHistory
    .filter(entry => !entry.categoryId)
    .map(entry => entry._key);

  const snapshot = {
    categories: categories.map(category => ({
      id: category._key,
      homeId,
      name: category.name,
      createdAt: toMillis(category.createdAt),
      updatedAt: toMillis(category.updatedAt),
      deletedAt: toMillis(category.deletedAt),
    })),
    locations: locations.map(location => ({
      id: location._key,
      homeId,
      name: location.name,
      categoryId: location.categoryId,
      // Legacy fallback for a pre-categoryId local record (predates this
      // sync round entirely) - lets the backend's resolveCategoryId resolve
      // a real categoryId server-side from the old string field. Only
      // meaningful when categoryId is absent above.
      category: location.categoryId ? undefined : (location.category || 'alimento'),
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
      categoryId: entry.categoryId,
      // Same legacy-fallback reasoning as locations.category above - covers
      // both a record written before category-scoping existed at all (no
      // `category` field either, defaults to 'alimento') and one written
      // during the string-category era.
      category: entry.categoryId ? undefined : (entry.category || 'alimento'),
      normalizedName: entry.normalizedName,
      name: entry.name,
      firstCreatedAt: toMillis(entry.firstCreatedAt),
      shelfLifeDays: entry.shelfLifeDays,
      timesDiscarded: entry.timesDiscarded,
      timesUsed: entry.timesUsed || 0,
      updatedAt: toMillis(entry.updatedAt) ?? toMillis(entry.firstCreatedAt),
      deletedAt: toMillis(entry.deletedAt),
    })),
  };

  return { snapshot, legacyFoodNameHistoryKeys };
}

/**
 * @param {any} pulled
 */
async function mergeCategory(pulled) {
  const local = await getOne('categories', pulled.id);
  if (!remoteWins(local, pulled)) { return; }

  await putOne('categories', {
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
async function mergeLocation(pulled) {
  const local = await getOne('locations', pulled.id);
  if (!remoteWins(local, pulled)) { return; }

  await putOne('locations', {
    name: pulled.name,
    homeId: pulled.homeId,
    categoryId: pulled.categoryId,
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
  const key = [pulled.homeId, pulled.categoryId, pulled.normalizedName];
  const local = await getOne('foodNameHistory', key);
  if (!remoteWins(local, pulled)) { return; }

  await putOne('foodNameHistory', {
    name: pulled.name,
    normalizedName: pulled.normalizedName,
    homeId: pulled.homeId,
    categoryId: pulled.categoryId,
    firstCreatedAt: new Date(pulled.firstCreatedAt),
    shelfLifeDays: pulled.shelfLifeDays,
    timesDiscarded: pulled.timesDiscarded,
    timesUsed: pulled.timesUsed || 0,
    updatedAt: new Date(pulled.updatedAt),
    deletedAt: pulled.deletedAt != null ? new Date(pulled.deletedAt) : null,
  }, key);
}

/**
 * Best-effort push-then-pull reconciliation of a Home's categories,
 * locations, items and food-name-history against the server, applying
 * last-write-wins per record. Never throws - mirrors syncHomesFromServer()'s
 * contract, so callers can `try { await syncHome(id) } catch {}` and fall
 * back to the local cache. Does not touch dbStore or trigger any re-render -
 * that's the caller's job.
 *
 * Failures are logged via _error (auto-opens the debug panel) rather than
 * swallowed silently or logged via _warn - this app has no manual "open
 * logs" affordance anymore, so a _warn entry is invisible unless the panel
 * already happens to be open. Previously a failed push/pull left zero trace
 * anywhere, which made "device A's change never reached device B" reports
 * impossible to diagnose after the fact - this was the actual gap behind a
 * real incident where one device's sync was silently, completely broken.
 * @param {number} homeId
 */
async function syncHome(homeId) {
  try {
    const { snapshot, legacyFoodNameHistoryKeys } = await buildLocalSnapshot(homeId);
    const pushResult = await apiSyncPush(homeId, snapshot);
    if (pushResult.error) {
      _error(' - syncHome push failed:', pushResult.error, 'status:', pushResult.status, 'detail:', pushResult.detail);
      return;
    }

    const pullResult = await apiSyncPull(homeId);
    if (pullResult.error || !pullResult.data) {
      _error(' - syncHome pull failed:', pullResult.error, 'status:', pullResult.status, 'detail:', pullResult.detail);
      return;
    }

    // Categories first - locations/foodNameHistory below are identified by
    // categoryId, so merging categories first keeps IndexedDB's view of
    // "what categories exist" ahead of whatever references them, mirroring
    // the same ordering the backend's pushHomeSnapshot uses.
    for (const category of pullResult.data.categories) { await mergeCategory(category); }
    for (const location of pullResult.data.locations) { await mergeLocation(location); }
    for (const item of pullResult.data.items) { await mergeItem(item); }
    for (const entry of pullResult.data.foodNameHistory) { await mergeFoodNameHistory(entry); }

    // Only reached once this record's data has definitely landed under its
    // new categoryId-keyed key (already there locally, or just written by
    // the merge loop above from the pull we just did) - safe to drop the
    // old-keyed duplicate now.
    for (const legacyKey of legacyFoodNameHistoryKeys) { await deleteOne('foodNameHistory', legacyKey); }
  } catch (err) {
    _error(' - syncHome threw (offline or unreachable):', err);
  }
}

export { syncHome };
