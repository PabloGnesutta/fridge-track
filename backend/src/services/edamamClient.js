/**
 * Thin wrapper around Edamam's Recipe Search API v2
 * (api.edamam.com/api/recipes/v2, free Developer plan - 10,000 calls/month,
 * registered at developer.edamam.com). Edamam has no dedicated Spanish
 * search - this just sends the raw Spanish item names as the query text, so
 * it only matches recipes whose (largely English) titles/ingredients happen
 * to share that word (loanwords like "cebolla"/"dulce de leche" match
 * reasonably; plain grocery nouns with no English-recipe-title presence may
 * not). No translation step is applied - see recipeService.js's
 * recipeCacheService for why that's an acceptable tradeoff here (a cache
 * miss just means an empty result, not wasted quota on repeat tries).
 *
 * Reads process.env.EDAMAM_* lazily inside searchRecipes(), not at module
 * top level - this module is reachable via a static import chain from
 * index.js (through apiRouter.js), and ES module imports are hoisted and
 * evaluated before index.js's own configEnv() dotenv call runs. Reading env
 * vars at import time would always see undefined, the same ESM-ordering
 * quirk webPushClient.js already hit.
 *
 * Response shape (hits[].recipe.{label,image,url,source}) and the
 * `type=public` param are confirmed against a live request with real
 * credentials - see api.edamam.com/doc/open-api/recipe-search-v2.yaml.
 */

const SEARCH_URL = 'https://api.edamam.com/api/recipes/v2';

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
    const url = `${SEARCH_URL}?type=public&q=${encodeURIComponent(query)}&app_id=${appId}&app_key=${appKey}`;
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
