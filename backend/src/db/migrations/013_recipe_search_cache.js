/**
 * Fronts edamamClient.js's calls so the same ingredient combo (across Homes
 * and days) isn't re-fetched every time - see recipeCacheService.js for the
 * TTL/cache-key logic. query_key is the cache key (sorted, lowercased urgent
 * item names), not the literal query text sent to Edamam.
 */
const sql = `
CREATE TABLE IF NOT EXISTS recipe_search_cache (
  query_key TEXT PRIMARY KEY,
  results_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
`;

export { sql };
