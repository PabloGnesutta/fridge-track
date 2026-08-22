import { dbStore } from "../common/state.js";
import { clearArray } from "../lib/utils.js";
import { generateId } from "../lib/id.js";
import { getAllWithIndex, putOne } from "../lib/indexedDb.js";
import { scheduleLocationSync } from "./location-db.js";


/**
 * @template T
 * @typedef {import("../common/types.js").ServiceReturn<T>} ServiceReturn<T>
 */

/**
 * A real, synced entity behind what used to be a bare `category` string
 * copied onto both `locations.category` and `food_name_history.category` -
 * see docs/plans/categories-table.md. `locations`/`food_name_history` now
 * reference a category by `categoryId` instead, so renaming one propagates
 * everywhere automatically instead of orphaning already-created records.
 * @typedef {object} Category
 * @property {string} name
 * @property {number} homeId
 * @property {string} [_key]
 * @property {Date} [createdAt]
 * @property {Date} [updatedAt]
 * @property {Date|null} [deletedAt]
 */

/**
 * The 3 built-in categories a brand-new Home is seeded with server-side
 * (see backend/src/services/homeService.js's createHome()). Used only as a
 * display fallback for the location form's category <select> when
 * dbStore.categories is still empty (e.g. onboarding right after Home
 * creation, before the first syncHome() pull has landed) - without this, the
 * select would show nothing but "+ Nueva categoría".
 */
const FALLBACK_CATEGORY_NAMES = ['Alimentos', 'Medicamentos', 'Otros'];

/**
 * Fetch all categories belonging to the given Home. Stores them in dbStore.
 * @param {number} homeId
 * @returns {Promise<Category[]>}
 */
async function fetchCategories(homeId) {
  /** @type {Category[]} */ // @ts-ignore
  const categories = (await getAllWithIndex('categories', 'homeId', homeId))
    .filter(category => category.deletedAt == null);
  categories.sort((a, b) => a.name.localeCompare(b.name));

  clearArray(dbStore.categories);
  dbStore.categories.push(...categories);
  return categories;
}

/**
 * Creates a new category (a built-in name typed again, or a genuinely new
 * one) within a Home. No sync trigger of its own - when called from the
 * location form's submit handler right before createLocation(), the
 * scheduleLocationSync() call createLocation() already makes picks up the
 * new category in the same buildLocalSnapshot() pass, since categories is a
 * 4th store read there. Callers with no such accompanying write (none today)
 * would need to trigger a sync themselves.
 * @param {string} name
 * @param {number} homeId
 * @param {Date} [date]
 * @returns {ServiceReturn<Category>}
 */
async function createCategory(name, homeId, date = new Date()) {
  name = name.trim();
  if (!name) { return { errorMsg: 'Ingresar nombre' }; }

  /** @type {Category} */
  const category = { name, homeId, createdAt: date, updatedAt: date, deletedAt: null };
  const key = generateId();
  category._key = key;
  await putOne('categories', category, key);

  dbStore.categories.push(category);
  return { data: category };
}

/**
 * Renames a category in place - no re-keying needed, unlike food_name_history's
 * old string-keyed rename, since a category's id never changes. This is what
 * makes a rename propagate everywhere that references it by categoryId,
 * fixing the orphaning bug this table exists to solve.
 * @param {Category} category
 * @param {string} newName
 * @param {Date} [date]
 * @returns {ServiceReturn<Category>}
 */
async function renameCategory(category, newName, date = new Date()) {
  newName = newName.trim();
  if (!newName) { return { errorMsg: 'Ingresar nombre' }; }
  if (!category._key) { return { errorMsg: 'Llave no provista' }; }

  category.name = newName;
  category.updatedAt = date;
  await putOne('categories', category, category._key);
  scheduleLocationSync(category.homeId);
  return { data: category };
}

/**
 * Soft-deletes a category - blocked (mirroring updateFoodNameHistory's
 * "blocked, not merged" precedent) if any non-tombstoned location OR
 * food_name_history entry still references it. Checking only locations
 * would reopen the exact orphaning bug this refactor exists to fix, since a
 * food_name_history entry can reference a category with zero active
 * locations.
 * @param {Category} category
 * @param {Date} [date]
 * @returns {Promise<{ok: true}|{ok: false, error: string}>}
 */
async function deleteCategory(category, date = new Date()) {
  if (!category._key) { return { ok: false, error: 'Llave no provista' }; }

  const inUse = dbStore.locations.some(l => l.categoryId === category._key && l.deletedAt == null)
    || dbStore.foodNameHistory.some(e => e.categoryId === category._key && e.deletedAt == null);
  if (inUse) {
    return { ok: false, error: 'No se puede borrar: todavía hay ubicaciones o historial con esta categoría' };
  }

  category.deletedAt = date;
  category.updatedAt = date;
  await putOne('categories', category, category._key);
  scheduleLocationSync(category.homeId);
  return { ok: true };
}

/**
 * @param {string|undefined} categoryId
 * @returns {string}
 */
function getCategoryName(categoryId) {
  return dbStore.categories.find(c => c._key === categoryId)?.name || 'Alimentos';
}

export {
  fetchCategories, createCategory, renameCategory, deleteCategory, getCategoryName,
  FALLBACK_CATEGORY_NAMES,
};
