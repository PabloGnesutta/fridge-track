import { $, $form, $getInner, $new, $queryOneInput } from "../lib/dom.js";
import { _error } from "../lib/logger.js";
import { dataState, dbStore, setStateField } from "../common/state.js";
import { createLocation, setLastUsedLocationKey } from "../local-db/location-db.js";
import { fetchAndRenderItems, openItemList } from "./item-ui.js";


/**
 * @typedef {import("../local-db/location-db.js").Location} Location
 */

const locationForm = $form('locationForm');
const locationNameInput = $queryOneInput('#locationForm input[name="locationName"]');

const locationSwitcher = $('locationSwitcher');
const locationList = $getInner(locationSwitcher, '.location-list');
const locationSwitcherBtn = $('locationSwitcherBtn');

// Intercept native form submission (e.g. pressing Enter in a field) so it
// doesn't navigate the browser away with the field as a GET query string.
locationForm.addEventListener('submit', submitLocationForm);


/**
 * Open the "new location" modal.
 * @param {boolean} onboarding - When true, blocks dismissal until a location is created.
 */
function openLocationForm(onboarding = false) {
  setStateField('showLocationSwitcher', false);
  if (onboarding) {
    setStateField('onboarding', true);
  }
  setStateField('showLocationForm', true);
  locationNameInput.focus();
}

/**
 * Creates the location and activates it as current.
 * @param {Event} e
 */
async function submitLocationForm(e) {
  e.preventDefault();
  const formData = new FormData(locationForm);
  const name = formData.get('locationName') || '';
  if (typeof name !== 'string') { return; }

  const result = await createLocation(name);
  if (!result.data) {
    return _error(result.errorMsg);
  }

  locationForm.reset();
  setStateField('showLocationForm', false);
  setStateField('onboarding', false);

  await activateLocation(result.data);
}

/**
 * Sets the given location as current, updates the header,
 * and fetches+renders its items.
 * @param {Location} location
 */
async function activateLocation(location) {
  dataState.currentLocation = location;
  setLastUsedLocationKey(location._key || '');

  updateLocationHeader(location);

  await fetchAndRenderItems(location);
  openItemList();
}

/** @param {Location} location */
function updateLocationHeader(location) {
  locationSwitcherBtn.innerText = location.name;
}

/**
 * Opens the location switcher modal, listing all locations.
 */
function openLocationSwitcher() {
  renderLocationSwitcherList();
  setStateField('showLocationSwitcher', true);
}

function renderLocationSwitcherList() {
  locationList.innerHTML = '';
  const currentKey = dataState.currentLocation?._key;
  dbStore.locations.forEach(location => {
    const row = $new({
      class: 'row' + (location._key === currentKey ? ' selected' : ''),
      dataset: [
        ['clickAction', 'switchLocation'],
        ['locationKey', (location._key || '').toString()],
      ],
      children: [
        $new({ class: 'locationName', text: location.name }),
      ],
    });
    locationList.append(row);
  });
}

/**
 * @param {string} locationKey
 */
async function switchLocation(locationKey) {
  const key = +locationKey;
  if (key === dataState.currentLocation?._key) {
    setStateField('showLocationSwitcher', false);
    return;
  }
  const location = dbStore.locations.find(l => l._key === key);
  if (!location) { return; }

  setStateField('showLocationSwitcher', false);
  await activateLocation(location);
}

function openAddLocationFromSwitcher() {
  openLocationForm(false);
}


export {
  openLocationForm, submitLocationForm, activateLocation,
  openLocationSwitcher, switchLocation, openAddLocationFromSwitcher,
};
