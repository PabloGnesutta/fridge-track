import { $button, $form, $getInner, $new, $queryOne, $queryOneInput } from "../lib/dom.js";
import { toYYYYMMDD, timeAgo } from "../lib/date.js";
import { showConfirmDialog } from "../lib/confirmDialog.js";
import { showErrorToast } from "../lib/toast.js";
import { pen_solid, svg_trash } from "../svg/svgFn.js";
import { appState, dataState, dbStore, setCurrentView, setStateField } from "../common/state.js";
import { syncUrl } from "../common/router.js";
import {
  deleteFoodNameHistory, fetchFoodNameHistory, updateFoodNameHistory,
} from "../local-db/food-name-db.js";
import { getKnownCategories } from "../lib/locationCategory.js";
import { pageTitle } from "./ui.js";
import { openItemList } from "./item-ui.js";


/**
 * @typedef {import("../local-db/food-name-db.js").FoodNameHistory} FoodNameHistory
 */

const historyTabs = $queryOne('#foodHistoryView .history-category-tabs');
const historyList = $queryOne('#foodHistoryView .list');
const historyStats = $queryOne('#historyStats');

const foodNameHistoryForm = $form('foodNameHistoryForm');
const foodNameHistoryNameInput = $queryOneInput('#foodNameHistoryForm input[name="foodNameHistoryName"]');
const foodNameHistoryShelfLifeInput = $queryOneInput(
  '#foodNameHistoryForm input[name="foodNameHistoryShelfLifeDays"]'
);

/** The entry currently open in the edit form, if any. */
/** @type {FoodNameHistory|null} */
let entryBeingEdited = null;

// Intercept native form submission (e.g. pressing Enter in a field) so it
// doesn't navigate the browser away with the field as a GET query string.
foodNameHistoryForm.addEventListener('submit', submitFoodNameHistoryForm);

/**
 * Every entry for the current Home, unfiltered - fetched once per
 * openFoodHistory() call, re-filtered locally on every tab switch (no
 * re-fetch needed, same "local cache, no per-mutation round-trip" spirit
 * as the rest of this app's IndexedDB-backed views).
 * @type {FoodNameHistory[]}
 */
let allEntries = [];

/** Which category tab is currently selected. */
let selectedCategory = 'alimento';

/**
 * A record's effective category - defaults to 'alimento' for entries
 * written before category-scoping existed (see food-name-db.js's
 * FoodNameHistory typedef).
 * @param {FoodNameHistory} entry
 */
function entryCategory(entry) {
  return entry.category || 'alimento';
}

/** Opens the food name history view */
async function openFoodHistory() {
  setCurrentView('FoodHistory');
  pageTitle.innerText = 'Historial';
  syncUrl('/historial');

  const homeId = dataState.currentHome?.id;
  allEntries = homeId ? await fetchFoodNameHistory(homeId) : [];
  // Defaults to whichever category the user was just looking at, so opening
  // history from the medicine cabinet doesn't land on the food tab.
  selectedCategory = dataState.currentLocation?.category || 'alimento';

  renderHistoryCategoryTabs();
  renderCurrentCategory();
}

/** Renders the category tab row, highlighting the currently selected one. */
function renderHistoryCategoryTabs() {
  historyTabs.innerHTML = '';
  for (const { value, label } of getKnownCategories(dbStore.locations)) {
    historyTabs.append($new({
      class: 'history-category-tab' + (value === selectedCategory ? ' active' : ''),
      text: label,
      dataset: [['clickAction', 'switchHistoryCategory'], ['category', value]],
    }));
  }
}

/**
 * Switches the selected tab and re-renders from the already-fetched
 * allEntries - called via ui.js's click-delegation switch.
 * @param {string} category
 */
function switchHistoryCategory(category) {
  if (category === selectedCategory) { return; }
  selectedCategory = category;
  renderHistoryCategoryTabs();
  renderCurrentCategory();
}

/** Filters allEntries down to the selected category and (re)renders both the stats line and the list. */
function renderCurrentCategory() {
  const entries = allEntries.filter(entry => entryCategory(entry) === selectedCategory);
  renderHistoryStats(entries);
  renderFoodHistoryList(entries);
}

/**
 * Re-fetches allEntries (refreshing both this view's list and the shared
 * dbStore.foodNameHistory autocomplete cache - fetchFoodNameHistory() writes
 * both) and re-renders. Called after a successful edit or delete.
 */
async function refreshAfterEdit() {
  const homeId = dataState.currentHome?.id;
  allEntries = homeId ? await fetchFoodNameHistory(homeId) : [];
  renderCurrentCategory();
}

/**
 * Opens the rename/shelf-life edit form, prefilled with the entry's current
 * values.
 * @param {FoodNameHistory} entry
 */
function openFoodNameHistoryForm(entry) {
  entryBeingEdited = entry;
  foodNameHistoryNameInput.value = entry.name;
  foodNameHistoryShelfLifeInput.value = entry.shelfLifeDays != null ? String(entry.shelfLifeDays) : '';
  setStateField('showFoodNameHistoryForm', true);
  foodNameHistoryNameInput.focus();
  foodNameHistoryNameInput.select();
}

/**
 * @param {Event} e
 */
async function submitFoodNameHistoryForm(e) {
  e.preventDefault();
  const entry = entryBeingEdited;
  const homeId = dataState.currentHome?.id;
  if (!entry || !homeId) { return; }

  const formData = new FormData(foodNameHistoryForm);
  const newName = (formData.get('foodNameHistoryName') || '').toString().trim();
  if (!newName) { return showErrorToast('Ingresar nombre'); }
  const rawShelfLife = formData.get('foodNameHistoryShelfLifeDays');
  const newShelfLifeDays = rawShelfLife ? Number(rawShelfLife) : null;

  const result = await updateFoodNameHistory(homeId, entryCategory(entry), entry, newName, newShelfLifeDays);
  if (!result.ok) { return showErrorToast(result.error); }

  entryBeingEdited = null;
  foodNameHistoryForm.reset();
  setStateField('showFoodNameHistoryForm', false);
  await refreshAfterEdit();
}

/**
 * @param {FoodNameHistory} entry
 */
function deleteFoodNameHistoryEntry(entry) {
  showConfirmDialog(`¿Seguro que querés borrar el historial de "${entry.name}"?`, async () => {
    const homeId = dataState.currentHome?.id;
    if (!homeId) { return; }
    await deleteFoodNameHistory(homeId, entryCategory(entry), entry.normalizedName);
    await refreshAfterEdit();
  });
}

/**
 * All-time usage summary across every food name in the Home - a reporting
 * layer on counts already being tracked per-name (timesUsed/timesDiscarded),
 * not a new data source. Hidden entirely until there's at least one used or
 * discarded item to report, so a brand-new Home doesn't show "0% used".
 * @param {FoodNameHistory[]} entries
 */
function renderHistoryStats(entries) {
  const used = entries.reduce((sum, entry) => sum + (entry.timesUsed || 0), 0);
  const discarded = entries.reduce((sum, entry) => sum + (entry.timesDiscarded || 0), 0);
  const total = used + discarded;

  if (!total) {
    historyStats.classList.add('display-none');
    return;
  }

  const rate = Math.round((used / total) * 100);
  historyStats.innerText = `${rate}% aprovechado — ${used} usado${used === 1 ? '' : 's'}, `
    + `${discarded} tirado${discarded === 1 ? '' : 's'}`;
  historyStats.classList.remove('display-none');
}

function closeFoodHistory() {
  if (appState.currentView !== 'FoodHistory') { return; }
  openItemList();
}

/**
 * @param {FoodNameHistory[]} entries
 */
function renderFoodHistoryList(entries) {
  historyList.innerHTML = '';
  if (!entries.length) {
    historyList.append($new({
      class: 'empty-state',
      text: 'Todavía no hay historial. Se va completando a medida que agregás alimentos.',
    }));
    return;
  }

  entries.forEach(entry => historyList.append(buildHistoryRow(entry)));
}

/**
 * @param {FoodNameHistory} entry
 */
function buildHistoryRow(entry) {
  const meta = [`Desde ${toYYYYMMDD(entry.firstCreatedAt)} (${timeAgo(entry.firstCreatedAt)})`];
  if (entry.shelfLifeDays != null) {
    meta.push(`Dura ${entry.shelfLifeDays} día${entry.shelfLifeDays === 1 ? '' : 's'}`);
  }

  /** @type {HTMLDivElement[]} */
  const rightSideChildren = [];
  if (entry.timesUsed) {
    rightSideChildren.push($new({
      class: 'used-count',
      text: `Usado ${entry.timesUsed} ${entry.timesUsed === 1 ? 'vez' : 'veces'}`,
    }));
  }
  if (entry.timesDiscarded > 0) {
    rightSideChildren.push($new({
      class: 'discard-count',
      text: `Tirado ${entry.timesDiscarded} ${entry.timesDiscarded === 1 ? 'vez' : 'veces'}`,
    }));
  }

  const actions = $new({ class: 'history-row-actions' });
  $button({
    appendTo: actions,
    svgFn: pen_solid,
    ariaLabel: 'Editar historial',
    listener: { fn: () => openFoodNameHistoryForm(entry) },
  });
  $button({
    appendTo: actions,
    svgFn: svg_trash,
    ariaLabel: 'Borrar historial',
    listener: { fn: () => deleteFoodNameHistoryEntry(entry) },
  });

  return $new({
    class: 'row',
    children: [
      $new({
        class: 'left-side',
        children: [
          $new({ class: 'itemName', text: entry.name }),
          $new({ class: 'itemMeta', text: meta.join(' · ') }),
        ],
      }),
      $new({ class: 'right-side', children: rightSideChildren }),
      actions,
    ],
  });
}


export { openFoodHistory, closeFoodHistory, switchHistoryCategory, submitFoodNameHistoryForm };
