import { fromYYYYMMDD, toYYYYMMDD } from "../lib/date.js";
import { matches, normalize } from "../lib/string.js";
import { $, $form, $getInner, $new, $queryOne, $queryOneInput } from "../lib/dom.js";
import { showUndoToast, showErrorToast } from "../lib/toast.js";
import { syncUrl } from "../common/router.js";
import { appState, dataState, dbStore, setCurrentView, setStateField } from "../common/state.js";
import { createItem, deleteItem, fetchItems, restoreItem, updateItem } from "../local-db/item-db.js";
import { adjustDiscardCount, recordItemCreated } from "../local-db/food-name-db.js";
import { computeStatus, formatDueDetail } from "../lib/freshnessStatus.js";
import { pageTitle } from "./ui.js";
import { renderLocationChips } from "./location-ui.js";


/**
 * @typedef {import("../local-db/location-db.js").Location} Location
 * @typedef {import("../local-db/item-db.js").Item} Item
 */

const STATUS_LABELS = { fresh: 'Fresco', 'expiring-soon': 'Por vencer', expired: 'Vencido' };

const itemList = $queryOne('#itemListView .list');

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
searchInput.addEventListener('input', e => {
  if (!e.target) { return; }
  /** @type {string} */ // @ts-ignore
  const value = e.target.value;
  dbStore.items.forEach(item => {
    const row = $queryOne(`[data-item-key="${item._key}"]`);
    if (!row) { return; }
    if (matches(item.normalizedName || '', value)) {
      row.classList.remove('display-none');
    } else {
      row.classList.add('display-none');
    }
  });
});


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
      $new({
        class: 'right-side',
        children: [
          $new({ class: 'status-badge', text: STATUS_LABELS[status] }),
          $new({ class: 'due-detail', text: formatDueDetail({ status, daysUntilUseBy, daysUntilShelfLifeEnd }) }),
        ],
      }),
    ],
  });

  itemList.append(row);
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
    await recordItemCreated(result.data.name, shelfLifeDays, addedDate);
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
  const key = +itemKey;
  let item = dataState.currentItem || undefined;
  if (key !== item?._key) {
    item = dbStore.items.find(i => i._key === key);
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
 * @param {string} toastMessage
 * @param {{ discarded?: boolean }} [opts] When true, adjusts that food
 *   name's discard count (and undoes the adjustment if the removal itself
 *   is undone).
 */
async function removeItem(toastMessage, { discarded = false } = {}) {
  const item = dataState.currentItem;
  const location = dataState.currentLocation;
  if (!item || !location) { return; }
  const itemKey = item._key;
  if (!itemKey) { return; }

  await deleteItem(itemKey);
  if (discarded) { await adjustDiscardCount(item.name, 1); }

  closeSingleItem();

  const idx = dbStore.items.findIndex(i => i._key === itemKey);
  if (idx !== -1) { dbStore.items.splice(idx, 1); }

  dataState.currentItem = null;
  await fetchAndRenderItems(location);

  showUndoToast(toastMessage, async () => {
    await restoreItem(item);
    if (discarded) { await adjustDiscardCount(item.name, -1); }
    await fetchAndRenderItems(location);
  });
}

function tryDeleteItem() {
  const item = dataState.currentItem;
  if (!item) { return; }
  return removeItem(`"${item.name}" eliminado`);
}

function markItemUsed() {
  const item = dataState.currentItem;
  if (!item) { return; }
  return removeItem(`"${item.name}" usado`);
}

function markItemDiscarded() {
  const item = dataState.currentItem;
  if (!item) { return; }
  return removeItem(`"${item.name}" tirado`, { discarded: true });
}


export {
  fetchAndRenderItems, openItemList, openItemForm, submitItemForm,
  openSingleItem, closeSingleItem, tryDeleteItem, markItemUsed, markItemDiscarded, submitItemBtn,
};
