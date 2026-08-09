/**
 * @typedef {{
 *  postMessage: (message: *, transfer?: Transferable[]) => void
 * }} Client
 */


/**
 * false for hot reloading, could use environment variable
 */
const INTERCEPT_FETCH_REQUESTS = false;


const MAJOR_VERSION = 'v0.0.1';
const JS_CACHE = 'js_' + MAJOR_VERSION + '--0.0.1';
const CSS_CACHE = 'css_' + MAJOR_VERSION + '--0.0.1';
const MISC_CACHE = 'misc_' + MAJOR_VERSION + '--0.0.1';

/** 
 * (*) Using only one cache for easier development. 
 * Probably a good idea to use different ones:
 * @example const CACHE_WHITELIST = [JS_CACHE, CSS_CACHE, SVG_CACHE] 
 */
const CACHE_WHITELIST = [MISC_CACHE];

if (INTERCEPT_FETCH_REQUESTS) {
  // NOTE: We should not try to cache API calls
  /** Fetch event listener */
  self.addEventListener('fetch', e =>
    // @ts-ignore
    e.respondWith(returnCachedFileOrFetchIt(e))
  );
} else {
  console.warn(' ** Cache not enabled. Enable it or remove this comment before release');
}


/**
 * Send message to clients
 * @param {*} msg
 * @param {Transferable[]} [transfer]
 */
function sendToClients(msg, transfer) {
  // @ts-ignore
  self.clients.matchAll()
    .then(
      /** @param {Client[]} clients */
      clients => {
        if (!clients || !clients.length) { console.info(' ** no clients'); }
        clients.forEach(c => c.postMessage({ msg, transfer }));
      })
    .catch(
      /** @param {Event} e */
      e => console.error(' ** @sendToClients', e)
    );
}

/** Install */
self.addEventListener('install', e => {
  console.info(' ** Install cache. Versions:', CACHE_WHITELIST);
  // @ts-ignore
  self.skipWaiting();
  // Prefetching files on service worker install
  // @ts-ignore
  // e.waitUntil(Promise.all([
  // openAndFillCache(JS_CACHE, [
  //    ...specific files
  // ]),
  // ]));
});

/** Activate */
self.addEventListener('activate', () => {
  console.info(' ** Activate cache. Versions:', CACHE_WHITELIST);
  sendToClients({
    status: 'ACTIVATING',
    CACHE_WHITELIST,
    MAJOR_VERSION,
  });
});


/**
 * @param {string} cacheName
 * @param {string[]} filePaths
 */
async function openAndFillCache(cacheName, filePaths) {
  try {
    const cache = await caches.open(cacheName);
    return cache.addAll(filePaths);
  } catch (e) {
    console.error(' ** Error caching files:', e);
  }
}


/**
 * @param {Event} event
 */
async function returnCachedFileOrFetchIt(event) {
  try {
    // @ts-ignore
    const cachedResponse = await caches.match(event.request);
    if (cachedResponse) {
      return cachedResponse;
    }
    // @ts-ignore
    if (event.request.url.startsWith('chrome-extension://')) {
      // @ts-ignore // non-cachable stuff
      return fetch(event.request);
    }

    // File not cached. Fetching file and caching afterward
    // @ts-ignore
    const fetchResponse = await fetch(event.request);
    /** @type {string[]} */ // @ts-ignore
    const dotParts = event.request?.url?.split('.');
    const extension = dotParts[dotParts.length - 1];

    /** @type {string} */
    let cacheToOpen;
    switch (extension) {
      // (*) Using only one cache for easier development
      // case 'js': cacheToOpen = JS_CACHE; break;
      // case 'css': cacheToOpen = CSS_CACHE; break;
      default: cacheToOpen = MISC_CACHE; break;
    }

    // return fetchResponse
    const cache = await caches.open(cacheToOpen);
    if (!cache) {
      console.warn(' ** Cache not found while putting:', cacheToOpen);
    }
    cache.put(
      // @ts-ignore
      event.request,
      fetchResponse.clone(),
    );

    return fetchResponse;
  } catch (e) {
    console.error(' ** Error returning cached response:', e);
  }
}
