import { _error, _info } from './logger.js';
import { eventBus } from './utils.js';


/**
 * Enums
 * @typedef {'locations'|'items'|'foodNameHistory'|'homes'} ObjectStores
 * @typedef {'locationKey'|'homeId'} Indexes
 *
 * @typedef {IDBValidKey | IDBKeyRange} StoreKey
 * @typedef {{ _key: StoreKey, [field: string]: * }}  DbRecord
 */

const dbName = 'FridgeTrack';
const dbVersion = 4;


/** @type {Record<ObjectStores, ObjectStores>} */
const _stores = {
  locations: 'locations',
  items: 'items',
  foodNameHistory: 'foodNameHistory',
  homes: 'homes',
};

/** @type {IDBOpenDBRequest} */
var openDbRequest;

/** @type {IDBDatabase|null} */ // @ts-ignore
var db = null;

/** */
function initializeIndexedDb() {
  openDbRequest = indexedDB.open(dbName, dbVersion);
  openDbRequest.onupgradeneeded = onDbUpgradeNeeded;
  openDbRequest.onsuccess = onDbOpenSuccess;
  openDbRequest.onerror = onDbOpenError;
}


/**
 * Initialize Object Stores
 */
function onDbUpgradeNeeded() {
  _info(' __ Updating IndexedDB');
  db = openDbRequest.result;

  // Switching locations/items to client-generated UUID keys (needed before
  // sync, so two devices can't mint colliding local ids) - old
  // autoIncrement-keyed data can't be reused as-is, so drop it and start
  // fresh rather than migrating it record by record.
  if (db.objectStoreNames.contains(_stores.locations)) {
    db.deleteObjectStore(_stores.locations);
  }
  if (db.objectStoreNames.contains(_stores.items)) {
    db.deleteObjectStore(_stores.items);
  }

  const locationsStore = db.createObjectStore(_stores.locations);
  locationsStore.createIndex('homeId', 'homeId', { unique: false });

  const itemsStore = db.createObjectStore(_stores.items);
  itemsStore.createIndex('locationKey', 'locationKey', { unique: false });

  /**
   * Keyed by [homeId, normalizedName] (passed explicitly to
   * putOne/getOne/deleteOne) instead of autoIncrement, since there's exactly
   * one record per unique food name per home and we always look it up by
   * that pair, never by an opaque id.
   */
  const foodNameHistoryStore = db.objectStoreNames.contains(_stores.foodNameHistory)
    ? openDbRequest.transaction.objectStore(_stores.foodNameHistory)
    : db.createObjectStore(_stores.foodNameHistory);
  if (!foodNameHistoryStore.indexNames.contains('homeId')) {
    foodNameHistoryStore.createIndex('homeId', 'homeId', { unique: false });
  }

  if (!db.objectStoreNames.contains(_stores.homes)) {
    // Keyed explicitly by the server-issued home id, same style as
    // foodNameHistory above.
    db.createObjectStore(_stores.homes);
  }

  _info(db.objectStoreNames);
}

/** 
 * Database opened successfully 
 */
function onDbOpenSuccess() {
  db = openDbRequest.result;
  _info(' __ Base de datos abierta - Versión ' + db.version);
  eventBus.emit('IndexedDbInited', { version: dbVersion });
}

/** 
 * Used to clean up data by setting a lower DB version
 * @param {*} e
 */
function onDbOpenError(e) {
  if (e.target.error.name === 'VersionError') {
    /**
     * This error triggers when the version in the CODE is LOWER than
     * the version installed on the browser.
     * This should never happen because versions should only go up.
     * We can leverage this feature to wipe all the data whil testing.
     * Just make dbVersion lower and it wil wipe all the data 
     */
    _info(' __ Deleting old IndexedDB');
    const deleteDbRequest = indexedDB.deleteDatabase(dbName);
    deleteDbRequest.onsuccess = () => {
      _info(' __ Base de datos borrada exitosamente, creando una nueva');
      openDbRequest = indexedDB.open(dbName, dbVersion);
      openDbRequest.onupgradeneeded = onDbUpgradeNeeded;
      openDbRequest.onsuccess = onDbOpenSuccess;
    };
    deleteDbRequest.onerror = e => {
      _error(' __ Error al borrar base de datos');
      // @ts-ignore
      _error(e.target.error.message);
    };
  } else {
    _error(' __ Error al abrir base de datos', e);
  }
}

/**
 * Insert or update record.
 * For insertions, key is optional if the store is configured with autoincrement
 * @template T
 * @param {ObjectStores} storeName
 * @param {T} value
 * @param {IDBValidKey} [key]
 * @returns {Promise<IDBValidKey>} Key of the insterted/updated object
 */
async function putOne(storeName, value, key) {
  return new Promise((res, rej) => {
    if (!db) return rej('No database found');
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const putRequest = store.put(value, key);
    putRequest.onsuccess = e => {
      // @ts-ignore
      _info(' __ PutOne: ' + storeName, e.target.result);
      // @ts-ignore
      return res(e.target.result);
    };
    putRequest.onerror = e => {
      _error(' __ Error putting record');
      // @ts-ignore
      _error(e.target.error.message);
      return rej(e);
    };
  });
}

/**
 * Get one record from a store using the key
 * @param {ObjectStores} storeName
 * @param {StoreKey} key
 * @returns {Promise<DbRecord|null>}
 */
async function getOne(storeName, key) {
  return new Promise((res, rej) => {
    if (!db) return rej('No database found');
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);

    const getRequest = store.get(key);
    getRequest.onsuccess = e => {
      /** @type {DbRecord} */ // @ts-ignore
      const record = e.target.result;
      if (!record) {
        _info(` __ Item with key: ${key} not found in store ${storeName}`);
        return res(null);
      }
      record.id = key;
      _info(' __ GetOne: ' + storeName, record);
      return res(record);
    };
    getRequest.onerror = e => {
      _error(' __ Error getting record from IndexedDB');
      // @ts-ignore
      _error(e.target.error.message);
      return rej(e);
    };
  });
}


/**
 * @param {ObjectStores} storeName 
 * @param {Indexes} indexName 
 * @param {StoreKey} indexValue 
 */
async function getOneWithIndex(storeName, indexName, indexValue) {
  return new Promise((res, rej) => {
    if (!db) return rej('No database found');
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const index = store.index(indexName);

    const getRequest = index.get(indexValue);
    getRequest.onsuccess = e => {
      // @ts-ignore
      const record = e.target.result;
      if (!record) {
        _info(` __ Item with index key: "${indexValue}" not found in store "${storeName}"`);
        return res(null);
      }
      _info(' __ GetOneWithIndex: ' + storeName, record);
      return res(record);
    };

    getRequest.onerror = e => {
      _error(' __ Error geting record from IndexedDB using index');
      // @ts-ignore
      _error(e.target.error.message);
      return rej(e);
    };
  });
}

/**
 * Gets all the records for a given store
 * @param {ObjectStores} storeName
 * @param {Function} [cb] Callback to be executed for each record in the cursor.
 *   The record will be passed as an argument to the function.
 * @returns {Promise<DbRecord[]>}
 */
async function getAll(storeName, cb) {
  return new Promise((res, rej) => {
    if (!db) { return rej('IndexedDB not initialized'); }
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    /** 
     * using direction: 'prev' so latest records comes first
     * (starting from the end)
     */
    const getAllCursor = store.openCursor(null);

    /** @type {Array<DbRecord>} */
    const records = [];
    getAllCursor.onsuccess = e => {
      const cursor = getAllCursor.result;
      if (cursor) {
        const record = cursor.value;
        record._key = cursor.primaryKey;
        records.push(record);
        if (cb) {
          cb(record);
        }
        cursor.continue();
      } else {
        _info(' __ GetAll: ' + storeName, records);
        return res(records);
      }
    };
    getAllCursor.onerror = e => {
      _error(' __ Error geting IndexedDB entries');
      // @ts-ignore
      _error(e.target.error.message);
      return rej(e);
    };
  });
}

/**
 * @param {ObjectStores} storeName 
 * @param {Indexes} indexName 
 * @param {StoreKey} indexValue
 * @param {Function[]} [cbs] Callback to be executed for each record in the cursor.
 *   The record will be passed as an argument to the function.
 * @returns {Promise<DbRecord[]>}
 */
async function getAllWithIndex(storeName, indexName, indexValue, cbs) {
  return new Promise((res, rej) => {
    if (!db) { return rej('IndexedDB not initialized'); }
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const index = store.index(indexName);
    /** 
     * using direction: 'prev' so latest records comes first
     * (starting from the end)
     */
    const getAllCursor = index.openCursor(indexValue, 'prev');

    /** @type {Array<DbRecord>} */
    const records = [];
    getAllCursor.onsuccess = e => {
      const cursor = getAllCursor.result;
      if (cursor) {
        const record = cursor.value;
        record._key = cursor.primaryKey;
        records.push(record);
        if (cbs) {
          cbs.forEach(cb => cb(record));
        }
        cursor.continue();
      } else {
        _info(' __ GetAllWithIndex: ' + storeName, records);
        return res(records);
      }
    };
    getAllCursor.onerror = e => {
      _error(' __ Error geting IndexedDB entries');
      // @ts-ignore
      _error(e.target.error.message);
      return rej(e);
    };
  });
}

/**
 * Delete one record from a store using the key
 * @param {ObjectStores} storeName
 * @param {StoreKey} key
 * @returns {Promise<StoreKey>}
 */
async function deleteOne(storeName, key) {
  return new Promise((res, rej) => {
    if (!db) return rej('No database found');
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);

    const deleteRequest = store.delete(key);
    deleteRequest.onsuccess = e => {
      _info(' __ DeleteOne: ' + storeName, key);
      return res(key);
    };
    deleteRequest.onerror = e => {
      _error(' __ Error deleting record from IndexedDB');
      // @ts-ignore
      _error(e.target.error.message);
      return rej(e);
    };
  });
}

/**
 * Deletes all entries for the given store, index name and index value
 * @param {ObjectStores} storeName 
 * @param {Indexes} indexName 
 * @param {StoreKey} indexValue 
 * @returns {Promise<boolean>}
 */
async function deleteMany(storeName, indexName, indexValue) {
  return new Promise((res, rej) => {
    if (!db) return rej('No database found');
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const index = store.index(indexName);

    const getAllCursor = index.openCursor(indexValue);
    getAllCursor.onsuccess = e => {
      const cursor = getAllCursor.result;
      if (cursor) {
        const request = cursor.delete();
        request.onsuccess = () => {
          console.log('Record deleted');
        };
        cursor.continue();
      } else {
        _info(' __ Deletion process ended: ' + storeName, indexName, indexValue);
        return res(true);
      }
    };
    getAllCursor.onerror = e => {
      _error(' __ Error geting IndexedDB entries');
      // @ts-ignore
      _error(e.target.error.message);
      return rej(e);
    };
  });
}


export { initializeIndexedDb, putOne, getOne, getAll, getOneWithIndex, getAllWithIndex, deleteOne, deleteMany };
