import { assertHomeMembership } from './homeService.js';
import { getDaysUntilDue, EXPIRING_SOON_DAYS } from '../lib/itemStatus.js';
import * as defaultEdamamClient from './edamamClient.js';

const SUGGESTION_ITEM_LIMIT = 3;

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{searchRecipes: (query: string, opts?: object) => Promise<object[]>}} [edamamClient]
 */
function createRecipeService(db, edamamClient = defaultEdamamClient) {
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
    const items = await edamamClient.searchRecipes(query, { limit: SUGGESTION_ITEM_LIMIT });
    return { items, query };
  }

  return { getSuggestionsForHome };
}

export { createRecipeService };
