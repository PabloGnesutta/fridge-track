import { $ } from "../lib/dom.js";
import { _log } from "../lib/logger.js";


/**
 * @typedef {import("../local-db/location-db.js").Location} Location
 * @typedef {import("../local-db/item-db.js").Item} Item
 */

/**
 * Main state of the application
 * @typedef {object} AppState
 * @property {boolean} onboarding Forces the location form open and blocks dismissal until a first location exists
 * @property {boolean} editingItem
 * @property {boolean} showLocationForm
 * @property {boolean} showItemForm
 * @property {boolean} showSearch
 * @property {Views} currentView
 *
 * @typedef {'ItemList'|'SingleItem'|'FoodHistory'} Views
 *
 * @typedef {object} DataState
 * @property {Location|null} currentLocation
 * @property {Item|null} currentItem
 */

/**
 * Cached records from the db
 * @typedef {object} DBStore
 * @property {Location[]} locations
 * @property {Item[]} items
 * @property {import("../local-db/food-name-db.js").FoodNameHistory[]} foodNameHistory
 */

/**
 * Note: appState will be overwritten by initAppState
 * @type {AppState} State of which features are active
 */
const appState = {
    onboarding: false,
    editingItem: false,
    showLocationForm: false,
    showItemForm: false,
    showSearch: false,
    currentView: 'ItemList',
};

/**
 * State of data stored in memory
 * @type {DataState}
 */
const dataState = {
    currentLocation: null,
    currentItem: null,
};

/**
 * Cached records from the db
 * @type {DBStore}
 */
const dbStore = {
    locations: [],
    items: [],
    foodNameHistory: [],
};

const $app = $('app');

/**
 * @param {keyof AppState} field
 * @param {*} value
 */
function setStateField(field, value) {
    // @ts-ignore // TODO: check this
    appState[field] = value;
    $app.dataset[field] = value;
}

/**
 * @param {Views} view
 */
function setCurrentView(view) {
    appState.currentView = view;
    $app.dataset.currentView = view;
}

function initAppState() {
    setStateField('onboarding', false);
    setStateField('editingItem', false);
    setStateField('showLocationForm', false);
    setStateField('showItemForm', false);
    setStateField('showSearch', false);
    setCurrentView('ItemList');
}

export { appState, dataState, dbStore, initAppState, setStateField, setCurrentView };
