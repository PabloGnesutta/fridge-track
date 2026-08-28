import { $, display, fold, undisplay, unfold } from './lib/dom.js';
import { _log, _error, _info } from './lib/logger.js';


/**
 * Registers a bunch of events and will post messages to the caller with updates
 */
function initializeCache() {
  _info(' - initializeCache');
  const installedCache = localStorage.getItem('installedCache');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/cacheServiceWorker.js')
      .then(registration => {
        _info(' - service worker registered');

        // Browsers only check cacheServiceWorker.js's own bytes for changes
        // on a real navigation, and even then at most once per ~24h per
        // registration - an installed PWA that's just resumed from the
        // background (no navigation, no reload) can go a long time without
        // that check ever firing on its own. registration.update() forces
        // the same check on demand, so wire it to the moment a backgrounded
        // PWA becomes foreground again.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            registration.update().catch(e => _error(' - registration.update() failed:', e));
          }
        });

        // Covers the device this app most plausibly runs on long-term (e.g. a tablet left open
        // on a kitchen counter): a session that's never backgrounded/foregrounded gets no
        // visibilitychange at all, so without this it'd depend entirely on the browser's own
        // rare, at-most-once-per-24h check. Polling here means any session open longer than the
        // interval eventually notices an update on its own.
        setInterval(() => {
          registration.update().catch(e => _error(' - registration.update() failed:', e));
        }, 30 * 60 * 1000);

        // Listen for updates
        registration.addEventListener('updatefound', () => {
          _info(' - update found');
          if (!installedCache) {
            _info(' - installing cache for the first time...');
            localStorage.setItem('installedCache', 'INSTALLED');
            // cacheServiceWorker.js's activate handler calls clients.claim(), so this fires once
            // that lands - do one silent reload so THIS visit's own page load actually goes
            // through the service worker (the first load never did, since no SW controlled the
            // page yet) and gets cache-first populated. Without this, offline support would only
            // start working on a later, separate visit.
            navigator.serviceWorker.addEventListener('controllerchange', () => {
              window.location.reload();
            }, { once: true });
          } else {
            _info(' - updating...');
            navigator.serviceWorker.onmessage = e => {
              _log(' - msg received from worker:', e.data.msg);
              deleteOldCaches(e.data.msg.cacheWhitelist);
              localStorage.setItem('cacheMajorVersion', e.data.msg.cacheVersion)
              $('cacheMajorVersion').innerText = e.data.msg.cacheVersion
            };
          }
        });
      })
      .catch(e => _error('  - service worker registration failed:', e));
  }
}


/**
 * @param {string[]} cacheWhitelist
 */
async function deleteOldCaches(cacheWhitelist) {
  try {
    const existingCaches = await caches.keys();
    _log(' - deleting old caches: ' + existingCaches.toString());
    _log(' - cache whitelist: ' + cacheWhitelist.toString());
    for (const cacheName of existingCaches) {
      if (cacheWhitelist.includes(cacheName)) {
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