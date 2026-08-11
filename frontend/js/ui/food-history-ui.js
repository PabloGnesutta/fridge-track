import { $new, $queryOne } from "../lib/dom.js";
import { toYYYYMMDD, timeAgo } from "../lib/date.js";
import { appState, setCurrentView } from "../common/state.js";
import { syncUrl } from "../common/router.js";
import { fetchFoodNameHistory } from "../local-db/food-name-db.js";
import { pageTitle } from "./ui.js";
import { openItemList } from "./item-ui.js";


/**
 * @typedef {import("../local-db/food-name-db.js").FoodNameHistory} FoodNameHistory
 */

const historyList = $queryOne('#foodHistoryView .list');

/** Opens the food name history view */
async function openFoodHistory() {
  setCurrentView('FoodHistory');
  pageTitle.innerText = 'Historial';
  syncUrl('/historial');

  const entries = await fetchFoodNameHistory();
  renderFoodHistoryList(entries);
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


export { openFoodHistory, closeFoodHistory };
