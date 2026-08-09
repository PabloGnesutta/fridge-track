import { dbStore } from "../common/state.js";
import { clearArray } from "../lib/utils.js";
import { deleteMany, deleteOne, getAll, putOne } from "../lib/indexedDb.js";


/**
 * @template T
 * @typedef {import("../common/types.js").ServiceReturn<T>} ServiceReturn<T>
 */

/**
 * @typedef {object} Location
 * @property {string} name
 * @property {IDBValidKey} [_key]
 * @property {Date} [createdAt]
 * @property {Date} [updatedAt]
 */

const LAST_USED_LOCATION_KEY = 'lastUsedLocationKey';


/**
 * Creates a new storage location (e.g. "Heladera", "Freezer").
 * @param {string} name
 * @param {Date} [date]
 * @returns {ServiceReturn<Location>}
 */
async function createLocation(name, date = new Date()) {
  name = name.trim();
  if (!name) { return { errorMsg: 'Ingresar nombre' }; }

  /** @type {Location} */
  const location = { name, createdAt: date, updatedAt: date };
  location._key = await putOne('locations', location);

  dbStore.locations.push(location);
  setLastUsedLocationKey(location._key);
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
 * @param {IDBValidKey} locationKey
 * @returns {Promise<void>}
 */
async function deleteLocationAndItems(locationKey) {
  await deleteOne('locations', locationKey);
  await deleteMany('items', 'locationKey', locationKey);
}

/**
 * Fetch all locations. Stores them in dbStore.
 * @returns {Promise<Location[]>}
 */
async function fetchLocations() {
  /** @type {Location[]} */ // @ts-ignore
  const locations = await getAll('locations');
  clearArray(dbStore.locations);
  dbStore.locations.push(...locations);
  return locations;
}

/** @param {IDBValidKey} key */
function setLastUsedLocationKey(key) {
  localStorage.setItem(LAST_USED_LOCATION_KEY, String(key));
}

/** @returns {string|null} */
function getLastUsedLocationKey() {
  return localStorage.getItem(LAST_USED_LOCATION_KEY);
}

/**
 * Resolves which location should be active on boot: the last-used one if it
 * still exists, otherwise the most recently updated one.
 * @param {Location[]} locations
 * @returns {Location|null}
 */
function resolveCurrentLocation(locations) {
  if (!locations.length) { return null; }
  const lastUsedKey = getLastUsedLocationKey();
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
