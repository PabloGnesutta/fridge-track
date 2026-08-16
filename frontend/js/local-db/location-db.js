import { dbStore } from "../common/state.js";
import { clearArray } from "../lib/utils.js";
import { generateId } from "../lib/id.js";
import { getAllWithIndex, getOne, putOne } from "../lib/indexedDb.js";
import { syncHome } from "../sync/syncEngine.js";


/**
 * @template T
 * @typedef {import("../common/types.js").ServiceReturn<T>} ServiceReturn<T>
 */

/**
 * @typedef {object} Location
 * @property {string} name
 * @property {number} homeId
 * @property {string} [category]
 * @property {string} [_key]
 * @property {Date} [createdAt]
 * @property {Date} [updatedAt]
 * @property {Date|null} [deletedAt]
 */

const LAST_USED_LOCATION_KEY_PREFIX = 'lastUsedLocationKey:';

/**
 * Fires a best-effort push+pull sync in the background (not awaited by
 * callers) right after a location-level write, so a newly created/renamed/
 * deleted location doesn't sit unsynced until the next boot/Home-switch -
 * the scenario that otherwise leaves a Home looking empty to someone who
 * joins before the creating device happens to reload. Items and food-name-
 * history still only sync via that boot/Home-switch trigger.
 * @param {number} homeId
 */
function scheduleLocationSync(homeId) {
  syncHome(homeId);
}


/**
 * Creates a new storage location (e.g. "Heladera", "Freezer") within a Home.
 * @param {string} name
 * @param {number} homeId
 * @param {Date} [date]
 * @param {string} [category]
 * @returns {ServiceReturn<Location>}
 */
async function createLocation(name, homeId, date = new Date(), category = 'alimento') {
  name = name.trim();
  if (!name) { return { errorMsg: 'Ingresar nombre' }; }

  /** @type {Location} */
  const location = { name, homeId, category, createdAt: date, updatedAt: date, deletedAt: null };
  const key = generateId();
  location._key = key;
  await putOne('locations', location, key);

  dbStore.locations.push(location);
  setLastUsedLocationKey(homeId, location._key);
  scheduleLocationSync(homeId);
  return { data: location };
}

/**
 * Renames/recategorizes a location. Mutates the given location.
 * @param {Location} location
 * @param {string} name
 * @param {Date} [date]
 * @param {string} [category]
 * @returns {ServiceReturn<Location>}
 */
async function updateLocation(location, name, date = new Date(), category = 'alimento') {
  if (!location._key) { return { errorMsg: 'Llave no provista' }; }
  name = name.trim();
  if (!name) { return { errorMsg: 'Ingresar nombre' }; }

  location.name = name;
  location.category = category;
  location.updatedAt = date;
  await putOne('locations', location, location._key);
  scheduleLocationSync(location.homeId);
  return { data: location };
}

/**
 * Soft-deletes a location and all of its items: marks them deleted instead
 * of removing the records, so the deletion can propagate to other devices as
 * a tombstone during sync. Not atomic across the two stores (same as the
 * prior hard-delete version).
 * @param {string} locationKey
 * @returns {Promise<void>}
 */
async function deleteLocationAndItems(locationKey) {
  const date = new Date();

  const location = await getOne('locations', locationKey);
  if (location) {
    location.deletedAt = date;
    location.updatedAt = date;
    await putOne('locations', location, locationKey);
  }

  const items = await getAllWithIndex('items', 'locationKey', locationKey);
  for (const item of items) {
    item.deletedAt = date;
    item.updatedAt = date;
    await putOne('items', item, item._key);
  }

  if (location) { scheduleLocationSync(location.homeId); }
}

/**
 * Fetch all locations belonging to the given Home. Stores them in dbStore.
 * @param {number} homeId
 * @returns {Promise<Location[]>}
 */
async function fetchLocations(homeId) {
  /** @type {Location[]} */ // @ts-ignore
  const locations = (await getAllWithIndex('locations', 'homeId', homeId))
    .filter(location => location.deletedAt == null);
  clearArray(dbStore.locations);
  dbStore.locations.push(...locations);
  return locations;
}

/**
 * @param {number} homeId
 * @param {string} key
 */
function setLastUsedLocationKey(homeId, key) {
  localStorage.setItem(LAST_USED_LOCATION_KEY_PREFIX + homeId, String(key));
}

/**
 * @param {number} homeId
 * @returns {string|null}
 */
function getLastUsedLocationKey(homeId) {
  return localStorage.getItem(LAST_USED_LOCATION_KEY_PREFIX + homeId);
}

/**
 * Resolves which location should be active on boot: the last-used one (for
 * this Home) if it still exists, otherwise the most recently updated one.
 * @param {Location[]} locations
 * @param {number} homeId
 * @returns {Location|null}
 */
function resolveCurrentLocation(locations, homeId) {
  if (!locations.length) { return null; }
  const lastUsedKey = getLastUsedLocationKey(homeId);
  const lastUsed = locations.find(l => String(l._key) === lastUsedKey);
  if (lastUsed) { return lastUsed; }

  return locations.slice().sort((a, b) => {
    if (!a.updatedAt || !b.updatedAt) { return 0; }
    return a.updatedAt <= b.updatedAt ? 1 : -1;
  })[0];
}


export {
  createLocation, updateLocation, deleteLocationAndItems, fetchLocations,
  setLastUsedLocationKey, getLastUsedLocationKey, resolveCurrentLocation,
};
