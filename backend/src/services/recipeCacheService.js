/**
 * Fronts edamamClient.js so the same ingredient combo (across Homes and
 * days, not just repeat taps within one session) isn't re-fetched from
 * Edamam every time - see recipeService.js for how the cache key is built.
 * Same create*Service(db) factory shape as homeService.js/pushService.js so
 * tests can inject an isolated :memory: database.
 */

/**
 * Placeholder TTL - Edamam's terms of service around how long recipe
 * results may be cached should be confirmed and this adjusted accordingly.
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * @param {import('node:sqlite').DatabaseSync} db
 */
function createRecipeCacheService(db) {
  /**
   * @param {string} cacheKey
   * @param {number} [now]
   * @returns {object[]|null}
   */
  function getCached(cacheKey, now = Date.now()) {
    /** @type {{results_json: string, fetched_at: number}|undefined} */
    const row = db.prepare(
      'SELECT results_json, fetched_at FROM recipe_search_cache WHERE query_key = ?'
    ).get(cacheKey);
    if (!row || now - row.fetched_at >= CACHE_TTL_MS) { return null; }
    return JSON.parse(row.results_json);
  }

  /**
   * @param {string} cacheKey
   * @param {object[]} results
   * @param {number} [now]
   */
  function setCached(cacheKey, results, now = Date.now()) {
    db.prepare(
      'INSERT OR REPLACE INTO recipe_search_cache (query_key, results_json, fetched_at) VALUES (?, ?, ?)'
    ).run(cacheKey, JSON.stringify(results), now);
  }

  return { getCached, setCached };
}

export { createRecipeCacheService, CACHE_TTL_MS };
