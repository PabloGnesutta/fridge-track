import { dbStore } from "../common/state.js";
import { clearArray } from "../lib/utils.js";
import { getAll, putOne } from "../lib/indexedDb.js";
import { apiCreateHome, apiJoinHome, apiListHomes } from "../api-caller/apiCaller.js";


/**
 * @template T
 * @typedef {import("../common/types.js").ServiceReturn<T>} ServiceReturn<T>
 */

/**
 * A shared household. The server is the source of truth for membership; the
 * local copy here is a cache so a previously-resolved home can still be used
 * to boot the app offline.
 * @typedef {object} Home
 * @property {number} id
 * @property {string} name
 * @property {string} joinCode
 */

const CURRENT_HOME_ID_KEY = 'currentHomeId';

/**
 * Creates a new Home on the server and caches it locally.
 * @param {string} name
 * @returns {ServiceReturn<Home>}
 */
async function createHome(name) {
  const result = await apiCreateHome(name);
  if (!result.data) { return { errorMsg: result.error }; }
  await cacheHome(result.data);
  setCurrentHomeId(result.data.id);
  return { data: result.data };
}

/**
 * Joins an existing Home via its join-code and caches it locally.
 * @param {string} joinCode
 * @returns {ServiceReturn<Home>}
 */
async function joinHome(joinCode) {
  const result = await apiJoinHome(joinCode);
  if (!result.data) { return { errorMsg: result.error }; }
  await cacheHome(result.data);
  setCurrentHomeId(result.data.id);
  return { data: result.data };
}

/**
 * Refreshes the locally cached Home list from the server. Best-effort - the
 * caller is expected to tolerate this failing (e.g. offline) and fall back
 * to whatever's already cached via fetchHomes().
 * @returns {Promise<void>}
 */
async function syncHomesFromServer() {
  const result = await apiListHomes();
  if (!result.data) { throw new Error(result.error); }
  for (const home of result.data) { await cacheHome(home); }
}

/**
 * Writes a Home to IndexedDB and keeps dbStore.homes in sync with it, so a
 * newly created/joined Home shows up in the switcher without needing a full
 * fetchHomes() re-read.
 * @param {Home} home
 */
async function cacheHome(home) {
  await putOne('homes', home, home.id);
  const idx = dbStore.homes.findIndex(h => h.id === home.id);
  if (idx === -1) {
    dbStore.homes.push(home);
  } else {
    dbStore.homes[idx] = home;
  }
}

/**
 * Reads the locally cached Home list into dbStore.
 * @returns {Promise<Home[]>}
 */
async function fetchHomes() {
  /** @type {Home[]} */ // @ts-ignore
  const homes = await getAll('homes');
  clearArray(dbStore.homes);
  dbStore.homes.push(...homes);
  return homes;
}

/** @param {number} id */
function setCurrentHomeId(id) {
  localStorage.setItem(CURRENT_HOME_ID_KEY, String(id));
}

/** @returns {string|null} */
function getCurrentHomeId() {
  return localStorage.getItem(CURRENT_HOME_ID_KEY);
}

/**
 * Resolves which Home should be active on boot: the last-used one if it's
 * still in the list, otherwise the first one.
 * @param {Home[]} homes
 * @returns {Home|null}
 */
function resolveCurrentHome(homes) {
  if (!homes.length) { return null; }
  const currentId = getCurrentHomeId();
  const current = homes.find(h => String(h.id) === currentId);
  return current || homes[0];
}


export {
  createHome, joinHome, syncHomesFromServer, fetchHomes,
  setCurrentHomeId, getCurrentHomeId, resolveCurrentHome,
};
