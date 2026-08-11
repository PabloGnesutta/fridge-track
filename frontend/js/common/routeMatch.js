/**
 * @typedef {{ view: 'ItemList' } | { view: 'SingleItem', itemKey: string }} Route
 */

/**
 * Maps a URL pathname to the view it represents. Kept free of DOM/app
 * imports (unlike router.js, which wires this into history + the view
 * functions) so the matching logic itself can be unit tested in plain Node.
 * @param {string} pathname
 * @returns {Route}
 */
function parseRoute(pathname) {
  const match = pathname.match(/^\/item\/([^/]+)\/?$/);
  if (match) { return { view: 'SingleItem', itemKey: match[1] }; }
  return { view: 'ItemList' };
}

export { parseRoute };
