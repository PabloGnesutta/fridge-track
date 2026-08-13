import { dbStore } from "../common/state.js";
import { normalize } from "../lib/string.js";
import { clearArray } from "../lib/utils.js";
import { generateId } from "../lib/id.js";
import { computeStatus, getSoonestDays } from "../lib/freshnessStatus.js";
import { getAllWithIndex, getOne, putOne } from "../lib/indexedDb.js";
import { syncHome } from "../sync/syncEngine.js";
import { fetchLocations } from "./location-db.js";


/**
 * @template T
 * @typedef {import("../common/types.js").ServiceReturn<T>} ServiceReturn<T>
 */

/**
 * @typedef {import("../lib/indexedDb.js").StoreKey} StoreKey
 */

/**
 * @typedef {object} Item
 * @property {string} locationKey
 * @property {string} name
 * @property {string} [normalizedName]
 * @property {string} [quantity]
 * @property {Date} addedDate
 * @property {Date|null} useByDate
 * @property {number|null} shelfLifeDays
 * @property {string} [notes]
 * @property {string} [_key]
 * @property {Date} [createdAt]
 * @property {Date} [updatedAt]
 * @property {Date|null} [deletedAt]
 */

/**
 * @typedef {object} ItemInput
 * @property {string} [quantity]
 * @property {Date} [addedDate]
 * @property {Date|null} [useByDate]
 * @property {number|null} [shelfLifeDays]
 * @property {string} [notes]
 */


/**
 * Resolves the item's Home via its location and fires a best-effort
 * background sync (not awaited by callers), mirroring location-db.js's
 * scheduleLocationSync - so a newly created/edited/deleted item doesn't sit
 * unsynced until the next boot/Home-switch.
 * @param {string} locationKey
 */
async function scheduleItemSync(locationKey) {
  const location = await getOne('locations', locationKey);
  if (location) { syncHome(location.homeId); }
}

/**
 * Creates a food item for the given storage location.
 * @param {string} locationKey
 * @param {string} name
 * @param {ItemInput} data
 * @param {Date} [date]
 * @returns {ServiceReturn<Item>}
 */
async function createItem(locationKey, name, data, date = new Date()) {
  name = name.trim();
  if (!name) { return { errorMsg: 'Ingresar nombre' }; }
  if (!data.useByDate && !data.shelfLifeDays) {
    return { errorMsg: 'Ingresar una fecha de vencimiento o una duración en días' };
  }

  /** @type {Item} */
  const item = {
    locationKey,
    name,
    normalizedName: normalize(name),
    quantity: data.quantity || '',
    addedDate: data.addedDate || date,
    useByDate: data.useByDate || null,
    shelfLifeDays: data.shelfLifeDays || null,
    notes: data.notes || '',
    createdAt: date,
    updatedAt: date,
    deletedAt: null,
  };
  const key = generateId();
  item._key = key;
  await putOne('items', item, key);

  dbStore.items.push(item);
  scheduleItemSync(locationKey);
  return { data: item };
}

/**
 * Updates an item's editable fields. Mutates the given item.
 * @param {Item} item
 * @param {{name?: string, quantity?: string, useByDate?: Date|null, shelfLifeDays?: number|null, notes?: string}} data
 * @param {Date} [date]
 * @returns {ServiceReturn<Item>}
 */
async function updateItem(item, data, date = new Date()) {
  if (!item._key) { return { errorMsg: 'Llave no provista' }; }
  if (data.name) {
    item.name = data.name;
    item.normalizedName = normalize(data.name);
  }
  if ('quantity' in data) { item.quantity = data.quantity || ''; }
  if ('useByDate' in data) { item.useByDate = data.useByDate || null; }
  if ('shelfLifeDays' in data) { item.shelfLifeDays = data.shelfLifeDays || null; }
  if ('notes' in data) { item.notes = data.notes || ''; }
  if (!item.useByDate && !item.shelfLifeDays) {
    return { errorMsg: 'Ingresar una fecha de vencimiento o una duración en días' };
  }
  item.updatedAt = date;

  await putOne('items', item, item._key);
  scheduleItemSync(item.locationKey);
  return { data: item };
}

/**
 * Soft-deletes an item: marks it deleted instead of removing the record, so
 * the deletion can propagate to other devices as a tombstone during sync.
 * Mutates the given item.
 * @param {Item} item
 * @param {Date} [date]
 * @returns {ServiceReturn<Item>}
 */
async function deleteItem(item, date = new Date()) {
  if (!item._key) { return { errorMsg: 'Ítem sin llave' }; }
  item.deletedAt = date;
  item.updatedAt = date;
  await putOne('items', item, item._key);
  scheduleItemSync(item.locationKey);
  return { data: item };
}

/**
 * Re-inserts a previously deleted item under its original key. Used to
 * support "undo" right after a delete/"Usado"/"Tirado" action.
 * @param {Item} item
 * @param {Date} [date]
 * @returns {ServiceReturn<Item>}
 */
async function restoreItem(item, date = new Date()) {
  if (!item._key) { return { errorMsg: 'Ítem sin llave' }; }
  item.deletedAt = null;
  item.updatedAt = date;
  await putOne('items', item, item._key);
  dbStore.items.push(item);
  scheduleItemSync(item.locationKey);
  return { data: item };
}

/**
 * Fetch all items for the given location, sorted by how soon they're due
 * (most overdue/closest to expiring first), then name. Stores them in dbStore.
 * @param {string} locationKey
 * @param {Date} currentDate
 * @returns {Promise<Item[]>}
 */
async function fetchItems(locationKey, currentDate) {
  /** @type {Item[]} */ // @ts-ignore
  const items = (await getAllWithIndex('items', 'locationKey', locationKey))
    .filter(item => item.deletedAt == null);

  items.sort((a, b) => {
    const soonestA = getSoonestDays(computeStatus(a, currentDate));
    const soonestB = getSoonestDays(computeStatus(b, currentDate));
    if (soonestA !== soonestB) { return soonestA - soonestB; }
    return a.name.localeCompare(b.name);
  });

  clearArray(dbStore.items);
  dbStore.items.push(...items);
  return items;
}

/**
 * Counts expired/expiring-soon items for the given location, independent of
 * dbStore's cache (which only holds the currently active location's items).
 * Used for the location switcher's badges.
 * @param {string} locationKey
 * @param {Date} currentDate
 * @returns {Promise<{expired: number, expiringSoon: number}>}
 */
async function countItemsByStatus(locationKey, currentDate) {
  /** @type {Item[]} */ // @ts-ignore
  const items = (await getAllWithIndex('items', 'locationKey', locationKey))
    .filter(item => item.deletedAt == null);
  let expired = 0;
  let expiringSoon = 0;
  items.forEach(item => {
    const { status } = computeStatus(item, currentDate);
    if (status === 'expired') { expired++; }
    else if (status === 'expiring-soon') { expiringSoon++; }
  });
  return { expired, expiringSoon };
}


/**
 * Fetches every non-deleted item across every location in the Home, each
 * paired with its owning location (needed for tap-through: activating the
 * right location before opening the item). Does NOT touch dbStore.items -
 * that's reserved for the single active location's list (see fetchItems).
 * Mirrors the loop-over-locations pattern already established in
 * sync/syncEngine.js's buildLocalSnapshot.
 * @param {number} homeId
 * @returns {Promise<{item: Item, location: import("./location-db.js").Location}[]>}
 */
async function fetchAllItemsForHome(homeId) {
  const locations = await fetchLocations(homeId);

  /** @type {{item: Item, location: import("./location-db.js").Location}[]} */
  const itemsWithLocation = [];
  for (const location of locations) {
    /** @type {Item[]} */ // @ts-ignore
    const items = (await getAllWithIndex('items', 'locationKey', location._key || ''))
      .filter(item => item.deletedAt == null);
    itemsWithLocation.push(...items.map(item => ({ item, location })));
  }
  return itemsWithLocation;
}


export {
  createItem, updateItem, deleteItem, restoreItem, fetchItems, countItemsByStatus, fetchAllItemsForHome,
};
