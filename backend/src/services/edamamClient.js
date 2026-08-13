/**
 * Thin wrapper around Edamam's Spanish-language Recipe Search endpoint
 * (test-es.edamam.com, separate app_id/app_key from Edamam's English recipe
 * API - registered separately at developer.edamam.com). Takes ingredient
 * queries directly in Spanish, matching this app's user-entered food names,
 * so no translation step is needed.
 *
 * Reads process.env.EDAMAM_* lazily inside searchRecipes(), not at module
 * top level - this module is reachable via a static import chain from
 * index.js (through apiRouter.js), and ES module imports are hoisted and
 * evaluated before index.js's own configEnv() dotenv call runs. Reading env
 * vars at import time would always see undefined, the same ESM-ordering
 * quirk webPushClient.js already hit.
 *
 * Response shape is best-effort: Edamam's docs describe a
 * hits[].recipe.{label,image,url,source} shape, but this couldn't be
 * verified against a live response without real credentials, so parsing is
 * tolerant - any missing/unexpected field or request failure degrades to an
 * empty list rather than throwing.
 */

const SEARCH_URL = 'https://test-es.edamam.com/search';

/**
 * @param {string} query
 * @param {{limit?: number}} [opts]
 * @returns {Promise<{title: string, image: string, url: string, source: string}[]>}
 */
async function searchRecipes(query, { limit = 3 } = {}) {
  const appId = process.env.EDAMAM_APP_ID;
  const appKey = process.env.EDAMAM_APP_KEY;
  if (!appId || !appKey || !query) { return []; }

  try {
    const url = `${SEARCH_URL}?q=${encodeURIComponent(query)}&app_id=${appId}&app_key=${appKey}&to=${limit}`;
    const res = await fetch(url);
    if (!res.ok) { return []; }

    const json = await res.json();
    const hits = Array.isArray(json?.hits) ? json.hits : [];
    return hits.slice(0, limit)
      .map(hit => ({
        title: hit?.recipe?.label,
        image: hit?.recipe?.image,
        url: hit?.recipe?.url,
        source: hit?.recipe?.source,
      }))
      .filter(recipe => recipe.title && recipe.url);
  } catch {
    return [];
  }
}

export { searchRecipes };
