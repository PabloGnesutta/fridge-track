import { dbStore } from "../common/state.js";
import { clearArray } from "../lib/utils.js";
import { getAll, putOne, deleteOne } from "../lib/indexedDb.js";
import { apiCreateHome, apiJoinHome, apiListHomes, apiDeleteHome } from "../api-caller/apiCaller.js";


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
 * @property {number} createdBy - id of the member who created the Home; the
 *   only member allowed to send email invites for it (see homeService.js).
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

  const serverIds = new Set(result.data.map(home => home.id));
  for (const home of result.data) { await cacheHome(home); }

  // Prune any locally-cached Home no longer in the server's list - it was
  // deleted (see deleteHome() below, possibly from a different device
  // entirely) or this device's membership was otherwise removed. The server
  // list is authoritative and pulled fresh on every boot/Home switch (see
  // appBoot.js), so anything missing from it is gone for real; leaving it
  // cached would let a stale, unreachable Home linger in the switcher.
  //
  // Diffed against a fresh IndexedDB read, not dbStore.homes - on a fresh
  // boot/reload this runs before fetchHomes() has populated dbStore.homes,
  // so the in-memory array is still empty here and a stale Home sitting
  // only in IndexedDB would never get caught.
  /** @type {Home[]} */ // @ts-ignore
  const locallyCached = await getAll('homes');
  for (const cached of locallyCached) {
    if (!serverIds.has(cached.id)) { await uncacheHome(cached.id); }
  }
}

/**
 * Deletes a Home on the server, for every member - and removes it from this
 * device's local cache. Does not re-resolve which Home should be active
 * afterward if this was the current one; that's the caller's job
 * (appBoot.js's afterLogin() already does exactly that on every boot/Home
 * switch, so callers just re-run that).
 * @param {number} homeId
 * @returns {ServiceReturn<{id: number, name: string}>}
 */
async function deleteHome(homeId) {
  const result = await apiDeleteHome(homeId);
  if (!result.data) { return { errorMsg: result.error }; }
  await uncacheHome(homeId);
  return { data: result.data };
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
 * The inverse of cacheHome() - used both by deleteHome() above (this device
 * did the deleting) and syncHomesFromServer()'s pruning (some other device
 * did, or the membership otherwise disappeared server-side).
 * @param {number} homeId
 */
async function uncacheHome(homeId) {
  await deleteOne('homes', homeId);
  const idx = dbStore.homes.findIndex(h => h.id === homeId);
  if (idx !== -1) { dbStore.homes.splice(idx, 1); }
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
  createHome, joinHome, deleteHome, syncHomesFromServer, fetchHomes,
  setCurrentHomeId, getCurrentHomeId, resolveCurrentHome,
};
