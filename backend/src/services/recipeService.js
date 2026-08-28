import { assertHomeMembership } from './homeService.js';
import { getDaysUntilDue, EXPIRING_SOON_DAYS } from '../lib/itemStatus.js';
import * as defaultEdamamClient from './edamamClient.js';
import { createRecipeCacheService } from './recipeCacheService.js';

const SUGGESTION_ITEM_LIMIT = 3;

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{searchRecipes: (query: string, opts?: object) => Promise<object[]>}} [edamamClient]
 * @param {{getCached: (key: string, now?: number) => object[]|null, setCached: (key: string, results: object[], now?: number) => void}} [recipeCacheService]
 */
function createRecipeService(db, edamamClient = defaultEdamamClient, recipeCacheService = createRecipeCacheService(db)) {
  /**
   * Picks the SUGGESTION_ITEM_LIMIT most urgent (soonest-due, non-expired-
   * bucket-agnostic - expired items count too) items in a Home and asks
   * Edamam for recipes using their names. Returns immediately without
   * calling Edamam at all when nothing's urgent, to save quota on the
   * common case.
   * @param {number} userId
   * @param {number} homeId
   */
  async function getSuggestionsForHome(userId, homeId) {
    assertHomeMembership(db, homeId, userId);

    const rows = db.prepare('SELECT * FROM items WHERE home_id = ? AND deleted_at IS NULL').all(homeId);
    const now = new Date();

    const urgent = rows
      .map(row => ({
        name: row.name,
        days: getDaysUntilDue({
          useByDate: row.use_by_date == null ? null : Number(row.use_by_date),
          addedDate: row.added_date == null ? null : Number(row.added_date),
          shelfLifeDays: row.shelf_life_days == null ? null : Number(row.shelf_life_days),
        }, now),
      }))
      .filter(entry => entry.days !== null && entry.days <= EXPIRING_SOON_DAYS)
      .sort((a, b) => a.days - b.days)
      .slice(0, SUGGESTION_ITEM_LIMIT);

    if (!urgent.length) { return { items: [], query: null }; }

    const query = urgent.map(entry => entry.name).join(' ');
    // Order-independent, unlike `query` above - lets two Homes (or the same
    // Home on different days, as urgency reorders) hit the same cache row
    // for the same underlying set of ingredients.
    const cacheKey = urgent.map(entry => entry.name.toLowerCase()).sort().join(' ');

    const cached = recipeCacheService.getCached(cacheKey);
    if (cached) { return { items: cached, query }; }

    const items = await edamamClient.searchRecipes(query, { limit: SUGGESTION_ITEM_LIMIT });
    recipeCacheService.setCached(cacheKey, items);
    return { items, query };
  }

  return { getSuggestionsForHome };
}

export { createRecipeService };
