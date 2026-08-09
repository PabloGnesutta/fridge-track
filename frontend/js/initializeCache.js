import { $, display, fold, undisplay, unfold } from './lib/dom.js';
import { _log, _error, _info } from './lib/logger.js';


/**
 * Registers a bunch of events and will post messages to the caller with updates
 */
function initializeCache() {
  _info(' - initializeCache');
  const installedCache = localStorage.getItem('installedCache');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('cacheServiceWorker.js')
      .then(registration => {
        _info(' - service worker registered');

        // Listen for updates
        registration.addEventListener('updatefound', () => {
          _info(' - update found');
          if (!installedCache) {
            _info(' - installing cache for the first time...');
            localStorage.setItem('installedCache', 'INSTALLED');
          } else {
            _info(' - updating...');
            navigator.serviceWorker.onmessage = e => {
              _log(' - msg received from worker:', e.data.msg);
              deleteOldCaches(e.data.msg.CACHE_WHITELIST);
              localStorage.setItem('cacheMajorVersion', e.data.msg.MAJOR_VERSION)
              $('cacheMajorVersion').innerText = e.data.msg.MAJOR_VERSION
            };
          }
        });
      })
      .catch(e => _error('  - service worker registration failed:', e));
  }
}


/**
 * @param {string} CACHE_WHITELIST
 */
async function deleteOldCaches(CACHE_WHITELIST) {
  try {
    const existingCaches = await caches.keys();
    _log(' - deleting old caches: ' + existingCaches.toString());
    _log(' - cache whitelist: ' + CACHE_WHITELIST.toString());
    for (const cacheName of existingCaches) {
      if (CACHE_WHITELIST.includes(cacheName)) {
        continue;
      }
      const success = await caches.delete(cacheName);
      if (success) {
        _info(' - deleted cache: ' + cacheName);
      } else {
        _error(' - error deleting cache: ' + cacheName);
      }
    }
    _info(' - old caches deleted');
    showUpdateBanner();
  } catch (e) {
    _error(' - error deleting old caches:', e);
  }
}

/**
 * Unfolds what should be an update banner with:
 * "New version available, please Refresh de page".
 * After a few moments, it folds it back, and then removes it from the DOM.
 */
function showUpdateBanner() {
  $('refreshPageBtn').addEventListener('pointerup', () => window.location.reload());
  const banner = $('updateBanner');
  display(banner);
  requestAnimationFrame(() => {
    unfold(banner);
    setTimeout(() => {
      fold(banner);
      setTimeout(() => {
        undisplay(banner);
        setTimeout(() => {
          document.body.removeChild(banner);
        }, 5 * 1000);
      }, 2 * 1000);
    }, 5 * 1000);
  });
}


export { initializeCache };