import { _log } from "./logger.js";

/**
 * Returns a random integer between min and max (both inclusive).
 * @param {number} min - The minimum value.
 * @param {number} max - The maximum value.
 * @returns {number} A random integer between min and max.
 */
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Clears the array of items.
 * Use this instead of the assignment operator (arr = [])
 * to keep any references to the array valid.
 * @param {Array<*>} arr
*/
function clearArray(arr) {
  while (arr.length) arr.splice(0);
}

/**
 * Delete all properties in the object, keeping references intact
 * @param {Record<string, *>} obj
 * @param {string[]} omit - Do not delete the exceptions
 */
function clearObj(obj, omit = []) {
  for (const prop in obj) {
    if (!(omit.includes(prop))) {
      delete obj[prop];
    }
  }
}

/**
 * @typedef {'IndexedDbInited'} Events
 * @typedef {(payload: *)=>void} EventBusCallback
 */

const eventBus = {
  /** @type {Record<string, Array<EventBusCallback>>} */
  subs: {},
  /**
   * @param {Events} name 
   * @param {EventBusCallback} cb 
   */
  on(name, cb) {
    if (typeof name !== "string")
      return console.error("Event name must be a string");
    const n_ = name.toLowerCase();
    if (!this.subs[n_]) this.subs[n_] = [];
    this.subs[n_].push(cb);
  },
  /**
   * @param {Events} name 
   * @param {(payload)=>void} cb 
   */
  off(name, cb) {
    if (typeof name !== "string")
      return console.error("Event name must be a string");
    const n_ = name.toLowerCase();
    const callbacks = this.subs[n_];
    if (!callbacks?.length) return _log("[off] No callbacks registered for", name);
    const index = callbacks.findIndex((callback) => callback.name === cb.name);
    if (index !== -1) callbacks.splice(index, 1);
  },
  /**
   * @param {Events} name 
   * @param {*} payload 
   */
  emit(name, payload) {
    if (typeof name !== "string")
      return console.error("Event name must be a string");
    const n_ = name.toLowerCase();
    const callbacks = this.subs[n_];
    if (!callbacks?.length) return _log("[emit] No callbacks registered for", name);
    callbacks.forEach((cb) => {
      cb(payload);
    });
  },
};


export { eventBus, randomInt, clearArray, clearObj };