import { dbStore } from "../common/state.js";
import { clearArray } from "../lib/utils.js";
import { generateId } from "../lib/id.js";
import { deleteMany, deleteOne, getAllWithIndex, putOne } from "../lib/indexedDb.js";


/**
 * @template T
 * @typedef {import("../common/types.js").ServiceReturn<T>} ServiceReturn<T>
 */

/**
 * @typedef {object} Location
 * @property {string} name
 * @property {number} homeId
 * @property {string} [_key]
 * @property {Date} [createdAt]
 * @property {Date} [updatedAt]
 */

const LAST_USED_LOCATION_KEY_PREFIX = 'lastUsedLocationKey:';


/**
 * Creates a new storage location (e.g. "Heladera", "Freezer") within a Home.
 * @param {string} name
 * @param {number} homeId
 * @param {Date} [date]
 * @returns {ServiceReturn<Location>}
 */
async function createLocation(name, homeId, date = new Date()) {
  name = name.trim();
  if (!name) { return { errorMsg: 'Ingresar nombre' }; }

  /** @type {Location} */
  const location = { name, homeId, createdAt: date, updatedAt: date };
  const key = generateId();
  location._key = key;
  await putOne('locations', location, key);

  dbStore.locations.push(location);
  setLastUsedLocationKey(homeId, location._key);
  return { data: location };
}

/**
 * Renames a location. Mutates the given location.
 * @param {Location} location
 * @param {string} name
 * @param {Date} [date]
 * @returns {ServiceReturn<Location>}
 */
async function updateLocation(location, name, date = new Date()) {
  if (!location._key) { return { errorMsg: 'Llave no provista' }; }
  name = name.trim();
  if (!name) { return { errorMsg: 'Ingresar nombre' }; }

  location.name = name;
  location.updatedAt = date;
  await putOne('locations', location, location._key);
  return { data: location };
}

/**
 * Deletes a location and all of its items.
 * @param {string} locationKey
 * @returns {Promise<void>}
 */
async function deleteLocationAndItems(locationKey) {
  await deleteOne('locations', locationKey);
  await deleteMany('items', 'locationKey', locationKey);
}

/**
 * Fetch all locations belonging to the given Home. Stores them in dbStore.
 * @param {number} homeId
 * @returns {Promise<Location[]>}
 */
async function fetchLocations(homeId) {
  /** @type {Location[]} */ // @ts-ignore
  const locations = await getAllWithIndex('locations', 'homeId', homeId);
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
