import { fromYYYYMMDD, toYYYYMMDD, formatReadableDate } from "../lib/date.js";
import { matches, normalize } from "../lib/string.js";
import { $, $form, $getInner, $new, $queryOne, $queryOneInput, makeKeyboardActivatable } from "../lib/dom.js";
import { showUndoToast, showErrorToast } from "../lib/toast.js";
import { attachSwipe } from "../lib/swipe.js";
import { svg_check, svg_trash } from "../svg/svgFn.js";
import { syncUrl } from "../common/router.js";
import { appState, dataState, dbStore, setCurrentView, setStateField } from "../common/state.js";
import {
  createItem, deleteItem, fetchAllItemsForHome, fetchItems, restoreItem, updateItem,
} from "../local-db/item-db.js";
import { adjustDiscardCount, adjustUsedCount, recordItemCreated } from "../local-db/food-name-db.js";
import { computeStatus, formatDueDetail, getSoonestDays } from "../lib/freshnessStatus.js";
import { apiRecipeSuggestions } from "../api-caller/apiCaller.js";
import { pageTitle } from "./ui.js";
import { activateLocation, renderLocationChips } from "./location-ui.js";


/**
 * @typedef {import("../local-db/location-db.js").Location} Location
 * @typedef {import("../local-db/item-db.js").Item} Item
 */

const STATUS_LABELS = { fresh: 'Fresco', 'expiring-soon': 'Por vencer', expired: 'Vencido' };

const itemList = $queryOne('#itemListView .list');
const homeSummary = $('homeSummary');
homeSummary.role = 'button';
homeSummary.tabIndex = 0;
makeKeyboardActivatable(homeSummary);

const recipeSuggestions = $('recipeSuggestions');
recipeSuggestions.role = 'button';
recipeSuggestions.tabIndex = 0;
makeKeyboardActivatable(recipeSuggestions);
const recipeResults = $('recipeResults');

/**
 * The Home-wide most urgent item found by the last renderHomeSummary() call
 * (if any) - what tapping #homeSummary jumps to. Module-level like
 * dataState.currentItem/currentLocation, since there's nowhere else to hang
 * "the thing the summary strip currently points at".
 * @type {{item: Item, location: Location}|null}
 */
let mostUrgentEntry = null;

const singleItemView = $('singleItemView');
const itemName = $getInner(singleItemView, '.name');
const statusBadge = $getInner(singleItemView, '.status-badge');
const dueDetail = $getInner(singleItemView, '.due-detail');
const quantityDetail = $getInner(singleItemView, '.quantity-detail');
const expiryDetail = $getInner(singleItemView, '.expiry-detail');
const notesDetail = $getInner(singleItemView, '.notes-detail');

const itemForm = $form('itemForm');
const itemNameInput = $queryOneInput('#itemForm input[name="itemName"]');
const quantityInput = $queryOneInput('#itemForm input[name="quantity"]');
const addedDateInput = $queryOneInput('#itemForm input[name="addedDate"]');
const useByDateInput = $queryOneInput('#itemForm input[name="useByDate"]');
const shelfLifeDaysInput = $queryOneInput('#itemForm input[name="shelfLifeDays"]');
const itemNotesInput = $queryOneInput('#itemForm textarea[name="itemNotes"]');
const submitItemBtn = $queryOne('#itemForm .submit');
const nameSuggestionsEl = $queryOne('#itemForm .name-suggestions');

// Intercept native form submission (e.g. pressing Enter in a field) so it
// doesn't navigate the browser away with the field as a GET query string.
itemForm.addEventListener('submit', submitItemForm);

/** Name autocomplete, sourced from previously-created items' names */
itemNameInput.addEventListener('input', () => {
  const query = itemNameInput.value.trim();
  if (!query) { return hideNameSuggestions(); }
  const normalizedQuery = normalize(query);
  const suggestions = dbStore.foodNameHistory
    .filter(entry => matches(entry.normalizedName, normalizedQuery))
    .slice(0, 6);
  renderNameSuggestions(suggestions);
});

// Delayed so a click/tap on a suggestion (which also fires mousedown first,
// see below) has a chance to run before the dropdown disappears.
itemNameInput.addEventListener('blur', () => setTimeout(hideNameSuggestions, 150));

/**
 * @param {import("../local-db/food-name-db.js").FoodNameHistory[]} suggestions
 */
function renderNameSuggestions(suggestions) {
  nameSuggestionsEl.innerHTML = '';
  suggestions.forEach(entry => {
    nameSuggestionsEl.append($new({
      class: 'suggestion',
      text: entry.name,
      listener: {
        event: 'mousedown', // fires before the input's blur, unlike click
        fn: () => selectNameSuggestion(entry),
      },
    }));
  });
}

function hideNameSuggestions() {
  nameSuggestionsEl.innerHTML = '';
}

/**
 * @param {import("../local-db/food-name-db.js").FoodNameHistory} entry
 */
function selectNameSuggestion(entry) {
  itemNameInput.value = entry.name;
  if (entry.shelfLifeDays != null) {
    shelfLifeDaysInput.value = String(entry.shelfLifeDays);
  }
  hideNameSuggestions();
}

/** Search */
const searchInput = $queryOneInput('#searchItem');

/** @param {string} value */
function filterItemList(value) {
  dbStore.items.forEach(item => {
    const row = $queryOne(`[data-item-key="${item._key}"]`);
    if (!row) { return; }
    // The filter target is .row-wrapper (the swipe-action strips live
    // alongside .row inside it) so a filtered-out row doesn't leave its
    // action labels visibly exposed behind nothing.
    const wrapper = row.closest('.row-wrapper') || row;
    wrapper.classList.toggle('display-none', !matches(item.normalizedName || '', value));
  });
}

searchInput.addEventListener('input', e => {
  if (!e.target) { return; }
  /** @type {string} */ // @ts-ignore
  const value = e.target.value;
  filterItemList(value);
});

/** Toggles the collapsed search bar; closing it also clears the filter. */
function toggleSearch() {
  const opening = !appState.showSearch;
  setStateField('showSearch', opening);
  if (opening) {
    searchInput.focus();
  } else {
    searchInput.value = '';
    filterItemList('');
  }
}


/**
 * Fetch all items for the location, sorted by urgency, and render the list.
 * @param {Location} location
 */
async function fetchAndRenderItems(location) {
  const items = await fetchItems(location._key || '', new Date());
  itemList.innerHTML = '';
  if (!items.length) {
    itemList.append($new({
      class: 'empty-state',
      text: 'No hay alimentos acá todavía. Tocá + para agregar uno.',
    }));
  } else {
    items.forEach(item => appendItemRow(item));
  }
  await renderLocationChips();
  await renderHomeSummary(location.homeId);
  // Recipe suggestions (see toggleRecipeSuggestionsVisibility/openRecipeSuggestions
  // below) are deliberately NOT wired live yet - the only real recipe API found
  // with native Spanish ingredient search (Edamam) turned out not to have a
  // genuinely free tier ($9/mo minimum). The backend service/route and this
  // frontend plumbing are kept ready to re-enable (just re-add the call below
  // + a 'openRecipeSuggestions' case in ui.js's click switch) once there's a
  // free recipe source worth wiring up.
}

/**
 * Renders (or hides) the Home-wide "what's expiring" summary strip above
 * the location chips - counts expired/expiring-soon items across every
 * location in the Home, not just the currently active one, so urgency is
 * visible without picking a location first. Tapping it jumps to the single
 * most urgent item (see openMostUrgentItem).
 * @param {number} homeId
 */
async function renderHomeSummary(homeId) {
  const currentDate = new Date();
  const itemsWithLocation = await fetchAllItemsForHome(homeId);

  /** @type {{item: Item, location: Location, soonest: number|null}[]} */
  const expired = [];
  /** @type {{item: Item, location: Location, soonest: number|null}[]} */
  const expiringSoon = [];
  for (const entry of itemsWithLocation) {
    const result = computeStatus(entry.item, currentDate);
    const bucket = result.status === 'expired' ? expired : result.status === 'expiring-soon' ? expiringSoon : null;
    if (bucket) { bucket.push({ ...entry, soonest: getSoonestDays(result) }); }
  }

  if (!expired.length && !expiringSoon.length) {
    mostUrgentEntry = null;
    homeSummary.classList.add('display-none');
    return;
  }

  const mostUrgent = (expired.length ? expired : expiringSoon)
    .sort((a, b) => (a.soonest ?? 0) - (b.soonest ?? 0))[0];
  mostUrgentEntry = { item: mostUrgent.item, location: mostUrgent.location };

  const parts = [];
  if (expired.length) { parts.push(`${expired.length} vencido${expired.length === 1 ? '' : 's'}`); }
  if (expiringSoon.length) { parts.push(`${expiringSoon.length} por vencer`); }
  homeSummary.innerText = `⚠ ${parts.join(', ')}`;
  homeSummary.dataset.status = expired.length ? 'expired' : 'expiring-soon';
  homeSummary.classList.remove('display-none');
}

/**
 * Jumps to the single most urgent item across the whole Home (see
 * renderHomeSummary), activating its location first if it isn't already the
 * current one.
 */
async function openMostUrgentItem() {
  if (!mostUrgentEntry) { return; }
  const { item, location } = mostUrgentEntry;
  if (dataState.currentLocation?._key !== location._key) {
    await activateLocation(location);
  }
  openSingleItem(item._key || '');
}

/**
 * Shows/hides the recipe-suggestions card based on whether #homeSummary is
 * currently showing anything - reuses that already-computed signal instead
 * of a second fetchAllItemsForHome pass. Cheap and automatic, unlike the
 * actual Edamam API call (see openRecipeSuggestions), which only happens on
 * tap - Edamam's free tier is quota-limited and third-party HTTP shouldn't
 * add latency/flakiness to routine list renders.
 */
function toggleRecipeSuggestionsVisibility() {
  const hasUrgentItems = !homeSummary.classList.contains('display-none');
  recipeSuggestions.classList.toggle('display-none', !hasUrgentItems);
  if (!hasUrgentItems) {
    recipeResults.classList.add('display-none');
    recipeResults.innerHTML = '';
  }
}

/**
 * Fetches (on demand, not automatically) recipe suggestions based on the
 * Home's most urgently-expiring items and renders up to a few result cards.
 */
async function openRecipeSuggestions() {
  const home = dataState.currentHome;
  if (!home) { return; }

  recipeResults.innerHTML = '';
  recipeResults.append($new({ class: 'recipe-empty', text: 'Buscando recetas...' }));
  recipeResults.classList.remove('display-none');

  const { data, error } = await apiRecipeSuggestions(home.id);
  recipeResults.innerHTML = '';

  if (error || !data?.items?.length) {
    recipeResults.append($new({ class: 'recipe-empty', text: 'No se encontraron recetas.' }));
    return;
  }

  data.items.forEach(recipe => {
    const card = $new({
      tag: 'a',
      class: 'recipe-result-card',
      children: [
        ...(recipe.image ? [$new({ tag: 'img' })] : []),
        $new({ class: 'recipe-title', text: recipe.title }),
      ],
    });
    /** @type {HTMLAnchorElement} */ // @ts-ignore
    const link = card;
    link.href = recipe.url;
    link.target = '_blank';
    link.rel = 'noopener';
    if (recipe.image) {
      /** @type {HTMLImageElement} */ // @ts-ignore
      const img = card.querySelector('img');
      img.src = recipe.image;
      img.alt = '';
    }
    recipeResults.append(card);
  });

  recipeResults.append($new({
    tag: 'a', class: 'recipe-credit', text: 'Recetas de Edamam',
  }));
  /** @type {HTMLAnchorElement} */ // @ts-ignore
  const credit = recipeResults.querySelector('.recipe-credit');
  credit.href = 'https://www.edamam.com/';
  credit.target = '_blank';
  credit.rel = 'noopener';
}

/** Open the item list view */
function openItemList() {
  setCurrentView('ItemList');
  pageTitle.innerText = 'Alimentos';
  syncUrl('/', { replace: true });
}

/**
 * @param {Item} item
 */
function appendItemRow(item) {
  const key = (item._key || '').toString();
  const { status, daysUntilUseBy, daysUntilShelfLifeEnd } = computeStatus(item, new Date());
  const dueText = formatDueDetail({ status, daysUntilUseBy, daysUntilShelfLifeEnd });

  const nameChildren = [$new({ class: 'itemName', text: item.name })];
  const meta = [item.quantity, item.notes].filter(Boolean).join(' · ');
  if (meta) {
    nameChildren.push($new({ class: 'itemMeta', text: meta }));
  }

  const row = $new({
    class: 'row',
    dataset: [
      ['clickAction', 'openSingleItem'],
      ['itemKey', key],
      ['status', status],
    ],
    children: [
      $new({ class: 'left-side', children: nameChildren }),
      // Just the due-detail text now - it already says everything the
      // dropped status-badge used to say ("Vencido" + "vencido hace 1 día"
      // was the same fact twice), the colored left-border still gives the
      // at-a-glance status cue.
      $new({
        class: 'right-side',
        children: [
          $new({ class: 'due-detail', text: dueText }),
          $new({ class: 'added-date', text: `Agregado ${formatReadableDate(item.addedDate)}` }),
        ],
      }),
    ],
  });

  row.role = 'button';
  row.tabIndex = 0;
  row.setAttribute('aria-label', `${item.name}, ${dueText}`);
  makeKeyboardActivatable(row);

  // Swipe-to-act: two edge-pinned labels (only one visible at a time,
  // toggled by drag direction) sit behind .row, revealed as .row itself
  // translates - see attachSwipe() below and swipe-action CSS in style.css.
  const swipeAction = $new({
    class: 'swipe-action',
    children: [
      $new({
        class: 'swipe-action-used',
        children: [$new({ class: 'icon', html: svg_check() }), $new({ class: 'label', text: 'Usado' })],
      }),
      $new({
        class: 'swipe-action-discarded',
        children: [$new({ class: 'icon', html: svg_trash() }), $new({ class: 'label', text: 'Tirado' })],
      }),
    ],
  });

  const rowWrapper = $new({ class: 'row-wrapper', children: [swipeAction, row] });

  attachSwipe(row, {
    onDragStart: () => row.classList.add('dragging'),
    onDrag: dx => {
      row.style.transform = `translateX(${dx}px)`;
      swipeAction.classList.toggle('used', dx > 0);
      swipeAction.classList.toggle('discarded', dx < 0);
    },
    onDragEnd: () => row.classList.remove('dragging'),
    onCommitRight: () => markItemUsed(item),
    onCommitLeft: () => markItemDiscarded(item),
  });

  itemList.append(rowWrapper);
}

/**
 * Open create/edit item modal.
 * @param {boolean} isEdit
 */
function openItemForm(isEdit) {
  const submitLabel = $getInner(submitItemBtn, '.label');
  const formTitle = $getInner(itemForm, '.form-title');
  const location = dataState.currentLocation;
  if (!location) { return; }

  if (isEdit === true) {
    setStateField('editingItem', true);
    const item = dataState.currentItem;
    if (!item) { return; }
    itemNameInput.value = item.name;
    quantityInput.value = item.quantity || '';
    addedDateInput.value = toYYYYMMDD(item.addedDate);
    useByDateInput.value = item.useByDate ? toYYYYMMDD(item.useByDate) : '';
    shelfLifeDaysInput.value = item.shelfLifeDays != null ? item.shelfLifeDays.toString() : '';
    itemNotesInput.value = item.notes || '';
    submitLabel.innerText = 'Guardar Cambios';
    formTitle.innerText = 'Editar Alimento';
  } else {
    setStateField('editingItem', false);
    itemForm.reset();
    addedDateInput.value = toYYYYMMDD(new Date());
    submitLabel.innerText = 'Ingresar Alimento';
    formTitle.innerText = 'Nuevo Alimento';
  }

  hideNameSuggestions();
  setStateField('showItemForm', true);
  itemNameInput.focus();
  itemNameInput.select();
}

/**
 * @param {Event} e
 */
async function submitItemForm(e) {
  e.preventDefault();
  const location = dataState.currentLocation;
  if (!location) { return; }

  const formData = new FormData(itemForm);
  const name = formData.get('itemName') || '';
  if (typeof name !== 'string') { return; }

  const quantity = formData.get('quantity')?.toString() || '';
  const addedDateStr = formData.get('addedDate')?.toString();
  const addedDate = addedDateStr ? fromYYYYMMDD(addedDateStr) : new Date();
  const useByDateStr = formData.get('useByDate')?.toString();
  const useByDate = useByDateStr ? fromYYYYMMDD(useByDateStr) : null;
  const shelfLifeDays = formData.get('shelfLifeDays') ? Number(formData.get('shelfLifeDays')) : null;
  const notes = formData.get('itemNotes')?.toString() || '';

  if (appState.editingItem === true && dataState.currentItem) {
    const result = await updateItem(dataState.currentItem, { name, quantity, useByDate, shelfLifeDays, notes });
    if (!result.data) { return showErrorToast(result.errorMsg); }
    dataState.currentItem.addedDate = addedDate;
    setStateField('editingItem', false);
  } else {
    const result = await createItem(location._key || '', name, { quantity, addedDate, useByDate, shelfLifeDays, notes });
    if (!result.data) { return showErrorToast(result.errorMsg); }
    await recordItemCreated(location.homeId, result.data.name, shelfLifeDays, addedDate);
  }

  itemForm.reset();
  hideNameSuggestions();
  setStateField('showItemForm', false);

  await fetchAndRenderItems(location);
  if (appState.currentView === 'SingleItem' && dataState.currentItem) {
    renderItemDetail(dataState.currentItem);
  }
}

/**
 * @param {string} itemKey
 */
async function openSingleItem(itemKey) {
  let item = dataState.currentItem || undefined;
  if (itemKey !== item?._key) {
    item = dbStore.items.find(i => i._key === itemKey);
  }
  if (!item) { return showErrorToast('Alimento no encontrado'); }

  setCurrentView('SingleItem');
  pageTitle.innerText = 'Alimentos';
  dataState.currentItem = item;

  renderItemDetail(item);
  syncUrl(`/item/${item._key}`);
}

/**
 * @param {Item} item
 */
function renderItemDetail(item) {
  const { status, daysUntilUseBy, daysUntilShelfLifeEnd } = computeStatus(item, new Date());
  itemName.innerText = item.name;
  statusBadge.innerText = STATUS_LABELS[status];
  statusBadge.dataset.status = status;
  dueDetail.dataset.status = status;
  dueDetail.innerText = formatDueDetail({ status, daysUntilUseBy, daysUntilShelfLifeEnd });
  quantityDetail.innerText = item.quantity ? `Cantidad: ${item.quantity}` : '';

  const expiryParts = [];
  if (item.useByDate) { expiryParts.push(`Vence el: ${toYYYYMMDD(item.useByDate)}`); }
  if (item.shelfLifeDays) { expiryParts.push(`Dura ${item.shelfLifeDays} días desde agregado (${toYYYYMMDD(item.addedDate)})`); }
  expiryDetail.innerText = expiryParts.join(' — ');

  notesDetail.innerText = item.notes || '';
}

function closeSingleItem() {
  if (appState.currentView !== 'SingleItem') { return; }
  setCurrentView('ItemList');
  openItemList();
}

/**
 * Removes an item from the list immediately (used for delete, "Usado" and
 * "Tirado" alike — there's no history to distinguish them, just the toast
 * wording) and offers a few seconds to undo instead of a blocking confirm.
 * Takes the item explicitly (rather than always reading
 * dataState.currentItem) so a row swipe in the list can act on that row's
 * item directly, without first navigating into the single-item view.
 * @param {Item} item
 * @param {string} toastMessage
 * @param {{ discarded?: boolean, used?: boolean }} [opts] When true,
 *   adjusts that food name's discard/used count (and undoes the adjustment
 *   if the removal itself is undone). Mutually exclusive in practice - the
 *   trash-icon delete sets neither.
 */
async function removeItem(item, toastMessage, { discarded = false, used = false } = {}) {
  const location = dataState.currentLocation;
  if (!item || !location) { return; }
  const itemKey = item._key;
  if (!itemKey) { return; }

  await deleteItem(item);
  if (discarded) { await adjustDiscardCount(location.homeId, item.name, 1); }
  if (used) { await adjustUsedCount(location.homeId, item.name, 1); }

  closeSingleItem();

  const idx = dbStore.items.findIndex(i => i._key === itemKey);
  if (idx !== -1) { dbStore.items.splice(idx, 1); }

  if (dataState.currentItem?._key === itemKey) { dataState.currentItem = null; }
  await fetchAndRenderItems(location);

  showUndoToast(toastMessage, async () => {
    await restoreItem(item);
    if (discarded) { await adjustDiscardCount(location.homeId, item.name, -1); }
    if (used) { await adjustUsedCount(location.homeId, item.name, -1); }
    await fetchAndRenderItems(location);
  });
}

/**
 * Each of these defaults to dataState.currentItem (the single-item detail
 * view's buttons call these with no argument) but also accepts an explicit
 * item so a list-row swipe can act on that specific row.
 * @param {Item} [item]
 */
function tryDeleteItem(item = dataState.currentItem) {
  if (!item) { return; }
  return removeItem(item, `"${item.name}" eliminado`);
}

/** @param {Item} [item] */
function markItemUsed(item = dataState.currentItem) {
  if (!item) { return; }
  return removeItem(item, `"${item.name}" usado`, { used: true });
}

/** @param {Item} [item] */
function markItemDiscarded(item = dataState.currentItem) {
  if (!item) { return; }
  return removeItem(item, `"${item.name}" tirado`, { discarded: true });
}


export {
  fetchAndRenderItems, openItemList, openItemForm, submitItemForm,
  openSingleItem, closeSingleItem, tryDeleteItem, markItemUsed, markItemDiscarded, submitItemBtn,
  toggleSearch, openMostUrgentItem,
};
