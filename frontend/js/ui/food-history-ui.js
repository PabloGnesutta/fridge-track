import { $new, $queryOne } from "../lib/dom.js";
import { toYYYYMMDD, timeAgo } from "../lib/date.js";
import { appState, dataState, setCurrentView } from "../common/state.js";
import { syncUrl } from "../common/router.js";
import { fetchFoodNameHistory } from "../local-db/food-name-db.js";
import { LOCATION_CATEGORIES } from "../lib/locationCategory.js";
import { pageTitle } from "./ui.js";
import { openItemList } from "./item-ui.js";


/**
 * @typedef {import("../local-db/food-name-db.js").FoodNameHistory} FoodNameHistory
 */

const historyTabs = $queryOne('#foodHistoryView .history-category-tabs');
const historyList = $queryOne('#foodHistoryView .list');
const historyStats = $queryOne('#historyStats');

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
  for (const { value, label } of LOCATION_CATEGORIES) {
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
    ],
  });
}


export { openFoodHistory, closeFoodHistory, switchHistoryCategory };
