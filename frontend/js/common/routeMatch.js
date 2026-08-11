/**
 * @typedef {{ view: 'ItemList' } | { view: 'SingleItem', itemKey: string } | { view: 'FoodHistory' }} Route
 */

/**
 * Maps a URL pathname to the view it represents. Kept free of DOM/app
 * imports (unlike router.js, which wires this into history + the view
 * functions) so the matching logic itself can be unit tested in plain Node.
 * @param {string} pathname
 * @returns {Route}
 */
function parseRoute(pathname) {
  const itemMatch = pathname.match(/^\/item\/([^/]+)\/?$/);
  if (itemMatch) { return { view: 'SingleItem', itemKey: itemMatch[1] }; }
  if (pathname.match(/^\/historial\/?$/)) { return { view: 'FoodHistory' }; }
  return { view: 'ItemList' };
}

export { parseRoute };
