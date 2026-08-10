import { openItemList, openSingleItem } from "../ui/item-ui.js";


/**
 * @typedef {{ view: 'ItemList' } | { view: 'SingleItem', itemKey: string }} Route
 */

/**
 * @param {string} pathname
 * @returns {Route}
 */
function parseRoute(pathname) {
  const match = pathname.match(/^\/item\/([^/]+)\/?$/);
  if (match) { return { view: 'SingleItem', itemKey: match[1] }; }
  return { view: 'ItemList' };
}

/**
 * Pushes (or replaces) `path` onto the history stack if it isn't already the
 * current URL. Meant to be called from the view-opening functions themselves
 * (openItemList, openSingleItem) so every way of reaching a view - a click, a
 * deep link, a location switch, the browser's own back/forward - keeps the
 * address bar in sync without each call site having to know about history.
 * @param {string} path
 * @param {{ replace?: boolean }} [opts]
 */
function syncUrl(path, { replace = false } = {}) {
  if (location.pathname === path) { return; }
  if (replace) {
    history.replaceState({}, '', path);
  } else {
    history.pushState({}, '', path);
  }
}

/**
 * @param {Route} route
 */
function renderSpecificRoute(route) {
  if (route.view === 'SingleItem') {
    openSingleItem(route.itemKey);
  } else {
    openItemList();
  }
}

/** Renders whatever view the current URL maps to. */
function renderRoute() {
  renderSpecificRoute(parseRoute(location.pathname));
}

/**
 * Wires the browser's back/forward buttons to re-render the matching view.
 * Call once at startup. The initial URL still needs to be resolved
 * separately via `renderRoute()` once app data has loaded (see app.js) -
 * a deep link to /item/42 can't be rendered before items are fetched.
 */
function initRouter() {
  window.addEventListener('popstate', renderRoute);
}

/**
 * Captures the route the page was loaded with, before anything else (e.g.
 * activateLocation's default openItemList()) has a chance to touch
 * history.pushState/replaceState and clobber it. Call this once, at the top
 * of app.js, before initializeIndexedDb() runs.
 * @returns {Route}
 */
function captureInitialRoute() {
  return parseRoute(location.pathname);
}

export { syncUrl, renderRoute, renderSpecificRoute, initRouter, captureInitialRoute };
