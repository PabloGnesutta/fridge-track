import { $, $form, $getInner, $new, $queryOne, $queryOneInput } from "../lib/dom.js";
import { showErrorToast } from "../lib/toast.js";
import { showConfirmDialog } from "../lib/confirmDialog.js";
import { pen_solid, svg_trash } from "../svg/svgFn.js";
import { dataState, dbStore, setStateField } from "../common/state.js";
import { createCategory, FALLBACK_CATEGORY_NAMES } from "../local-db/category-db.js";
import {
  createLocation, deleteLocationAndItems, resolveCurrentLocation, setLastUsedLocationKey, updateLocation,
} from "../local-db/location-db.js";
import { countItemsByStatus } from "../local-db/item-db.js";
import { fetchAndRenderItems, openItemList } from "./item-ui.js";


/**
 * @typedef {import("../local-db/location-db.js").Location} Location
 */

/** Sentinel <option> value meaning "create a brand-new category". */
const NEW_CATEGORY_VALUE = '__new__';
/** Sentinel <option> value prefix for the hardcoded fallback names shown
 *  while dbStore.categories hasn't loaded yet - see category-db.js's
 *  FALLBACK_CATEGORY_NAMES doc comment. */
const FALLBACK_PREFIX = '__fallback__:';

const locationForm = $form('locationForm');
const locationNameInput = $queryOneInput('#locationForm input[name="locationName"]');
/** @type {HTMLSelectElement} */ // @ts-ignore
const locationCategorySelect = $queryOne('#locationForm select[name="locationCategory"]');
const newCategoryNameInput = $queryOneInput('#locationForm input[name="newCategoryName"]');
const formTitleText = $getInner(locationForm, '.form-title-text');
const deleteLocationBtn = $('deleteLocationBtn');
const submitLocationBtn = $queryOne('#locationForm .submit');

const chipsContainer = $queryOne('#itemListView .location-chips');

/** Location currently being renamed/deleted via the form, if any. */
/** @type {Location|null} */
let locationBeingEdited = null;

// Intercept native form submission (e.g. pressing Enter in a field) so it
// doesn't navigate the browser away with the field as a GET query string.
locationForm.addEventListener('submit', submitLocationForm);

// Reveals the "new category name" text input only while "+ Nueva categoría"
// is the selected option.
locationCategorySelect.addEventListener('change', () => {
  const isNew = locationCategorySelect.value === NEW_CATEGORY_VALUE;
  newCategoryNameInput.classList.toggle('display-none', !isNew);
  if (isNew) {
    newCategoryNameInput.value = '';
    newCategoryNameInput.focus();
  }
});


/**
 * Open the "new/edit location" modal.
 * @param {boolean} [onboarding] - When true, blocks dismissal until a location is created.
 * @param {Location|null} [editTarget] - When given, edits this location instead of creating a new one.
 */
function openLocationForm(onboarding = false, editTarget = null) {
  if (onboarding) {
    setStateField('onboarding', true);
  }

  const submitLabel = $getInner(submitLocationBtn, '.label');
  locationBeingEdited = editTarget;
  renderCategoryOptions();
  newCategoryNameInput.classList.add('display-none');
  newCategoryNameInput.value = '';

  if (editTarget) {
    locationNameInput.value = editTarget.name;
    locationCategorySelect.value = editTarget.categoryId;
    formTitleText.innerText = 'Editar Ubicación';
    submitLabel.innerText = 'Guardar Cambios';
    deleteLocationBtn.classList.remove('display-none');
  } else {
    locationForm.reset();
    // The <select> defaults to its first option (typically the Home's
    // "Alimentos" category, alphabetically first among the built-ins) -
    // there's no datalist-style blank/placeholder state to preserve here
    // like the old free-text field needed.
    formTitleText.innerText = 'Nueva Ubicación';
    submitLabel.innerText = 'Agregar Ubicación';
    deleteLocationBtn.classList.add('display-none');
  }

  setStateField('showLocationForm', true);
  locationNameInput.focus();
  locationNameInput.select();
}

/**
 * (Re)fills the category <select> from dbStore.categories, plus a trailing
 * "+ Nueva categoría" option. Called each time the form opens rather than
 * kept continuously in sync, same as renderHomeChips()/renderLocationChips()
 * elsewhere in this app.
 *
 * Falls back to the 3 hardcoded built-in names (see category-db.js's
 * FALLBACK_CATEGORY_NAMES) when dbStore.categories is still empty - e.g.
 * onboarding right after Home creation, before the first syncHome() pull
 * has landed - so the select never shows nothing but "+ Nueva categoría".
 * Picking a fallback option materializes a real Category record on submit
 * (see resolveSelectedCategoryId), exactly like picking "+ Nueva categoría"
 * itself does.
 */
function renderCategoryOptions() {
  locationCategorySelect.innerHTML = '';

  const options = dbStore.categories.length
    ? dbStore.categories.map(c => ({ value: c._key || '', label: c.name }))
    : FALLBACK_CATEGORY_NAMES.map(name => ({ value: FALLBACK_PREFIX + name, label: name }));

  for (const { value, label } of options) {
    locationCategorySelect.append($new({ tag: 'option', value, text: label }));
  }
  locationCategorySelect.append($new({ tag: 'option', value: NEW_CATEGORY_VALUE, text: '+ Nueva categoría' }));
}

/**
 * Resolves the category <select>'s current value into a real categoryId,
 * creating a new Category record first if "+ Nueva categoría" (or one of
 * the hardcoded fallback names) was picked - both cases need a real record
 * to exist before a location can reference it. Shows an error toast and
 * returns null if that creation fails (e.g. an empty typed name).
 * @param {number} homeId
 * @returns {Promise<string|null>}
 */
async function resolveSelectedCategoryId(homeId) {
  const selected = locationCategorySelect.value;

  if (selected === NEW_CATEGORY_VALUE) {
    const result = await createCategory(newCategoryNameInput.value, homeId);
    if (!result.data) { showErrorToast(result.errorMsg); return null; }
    return result.data._key || null;
  }

  if (selected.startsWith(FALLBACK_PREFIX)) {
    const result = await createCategory(selected.slice(FALLBACK_PREFIX.length), homeId);
    if (!result.data) { showErrorToast(result.errorMsg); return null; }
    return result.data._key || null;
  }

  return selected || null;
}

/**
 * Creates or renames the location, depending on whether it was opened for
 * editing.
 * @param {Event} e
 */
async function submitLocationForm(e) {
  e.preventDefault();
  const formData = new FormData(locationForm);
  const name = formData.get('locationName') || '';
  if (typeof name !== 'string') { return; }

  const homeId = dataState.currentHome?.id;
  if (!homeId) { return; }

  // Resolved up front (not just for the create path) - editing a location
  // can also pick "+ Nueva categoría"/a fallback name, which needs the same
  // create-then-reference treatment as a brand-new location does.
  const categoryId = await resolveSelectedCategoryId(homeId);
  if (!categoryId) { return; }

  if (locationBeingEdited) {
    const result = await updateLocation(locationBeingEdited, name, categoryId, new Date());
    if (!result.data) { return showErrorToast(result.errorMsg); }
    locationBeingEdited = null;
    locationForm.reset();
    setStateField('showLocationForm', false);
    await renderLocationChips();
    return;
  }

  const result = await createLocation(name, homeId, categoryId, new Date());
  if (!result.data) {
    return showErrorToast(result.errorMsg);
  }

  locationForm.reset();
  setStateField('showLocationForm', false);
  setStateField('onboarding', false);

  await activateLocation(result.data);
}

/**
 * Deletes the location currently open in the edit form.
 */
function deleteLocationFromForm() {
  const location = locationBeingEdited;
  if (!location) { return; }

  showConfirmDialog(`¿Seguro que querés borrar "${location.name}" y todos sus alimentos?`, async () => {
    locationBeingEdited = null;
    locationForm.reset();
    setStateField('showLocationForm', false);

    await deleteLocation(location._key || '');
  });
}

/**
 * Sets the given location as current, fetches+renders its items
 * (which also refreshes the chips), and opens the list view.
 * @param {Location} location
 */
async function activateLocation(location) {
  dataState.currentLocation = location;
  setLastUsedLocationKey(location.homeId, location._key || '');

  await fetchAndRenderItems(location);
  openItemList();
}

/**
 * Renders the location chip row: one chip per location (name + status
 * badges + rename icon), the active one highlighted, plus a trailing "+"
 * chip to add another. Called whenever locations or items change.
 */
async function renderLocationChips() {
  chipsContainer.innerHTML = '';
  const currentKey = dataState.currentLocation?._key;
  const today = new Date();

  for (const location of dbStore.locations) {
    const key = (location._key || '').toString();
    const { expired, expiringSoon } = await countItemsByStatus(location._key || '', today);

    /** @type {HTMLElement[]} */
    const badges = [];
    if (expired > 0) {
      badges.push($new({ class: 'location-badge expired', text: String(expired) }));
    }
    if (expiringSoon > 0) {
      badges.push($new({ class: 'location-badge expiring-soon', text: String(expiringSoon) }));
    }

    const chip = $new({
      class: 'location-chip' + (location._key === currentKey ? ' active' : ''),
      dataset: [
        ['clickAction', 'switchLocation'],
        ['locationKey', key],
      ],
      children: [
        $new({ class: 'locationName', text: location.name }),
        ...badges,
        $new({
          class: 'icon-btn',
          html: pen_solid(),
          dataset: [['clickAction', 'editLocation'], ['locationKey', key]],
        }),
      ],
    });
    chipsContainer.append(chip);
  }

  chipsContainer.append($new({
    class: 'location-chip add-chip',
    text: '+',
    dataset: [['clickAction', 'openAddLocation']],
  }));
}

/**
 * @param {string} locationKey
 */
async function switchLocation(locationKey) {
  if (locationKey === dataState.currentLocation?._key) { return; }
  const location = dbStore.locations.find(l => l._key === locationKey);
  if (!location) { return; }

  await activateLocation(location);
}

function openAddLocation() {
  openLocationForm(false);
}

/**
 * @param {string} locationKey
 */
function editLocation(locationKey) {
  const location = dbStore.locations.find(l => l._key === locationKey);
  if (!location) { return; }
  openLocationForm(false, location);
}

/**
 * Deletes a location and all of its items. If it was the active one,
 * activates another remaining location (or re-triggers onboarding if none
 * are left).
 * @param {IDBValidKey} locationKey
 */
async function deleteLocation(locationKey) {
  await deleteLocationAndItems(locationKey);

  const idx = dbStore.locations.findIndex(l => l._key === locationKey);
  if (idx !== -1) { dbStore.locations.splice(idx, 1); }

  if (dataState.currentLocation?._key === locationKey) {
    const homeId = dataState.currentHome?.id;
    const next = homeId ? resolveCurrentLocation(dbStore.locations, homeId) : null;
    if (next) {
      await activateLocation(next);
    } else {
      dataState.currentLocation = null;
      // Deleted the last location - re-trigger onboarding, but still
      // re-render the (now empty) chip row first so the deleted location's
      // chip doesn't linger behind the onboarding modal.
      await renderLocationChips();
      openLocationForm(true);
      return;
    }
  }

  await renderLocationChips();
}


export {
  openLocationForm, submitLocationForm, deleteLocationFromForm, activateLocation,
  renderLocationChips, switchLocation, openAddLocation, editLocation,
};
