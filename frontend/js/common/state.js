import { $ } from "../lib/dom.js";
import { _log } from "../lib/logger.js";


/**
 * @typedef {import("../local-db/location-db.js").Location} Location
 * @typedef {import("../local-db/item-db.js").Item} Item
 * @typedef {import("../local-db/home-db.js").Home} Home
 */

/**
 * Main state of the application
 * @typedef {object} AppState
 * @property {boolean} onboarding Forces the location form open and blocks dismissal until a first location exists
 * @property {boolean} editingItem
 * @property {boolean} showLocationForm
 * @property {boolean} showItemForm
 * @property {boolean} showFoodNameHistoryForm
 * @property {boolean} showSearch
 * @property {Views} currentView
 * @property {AuthStage} authStage
 *
 * @typedef {'ItemList'|'SingleItem'|'FoodHistory'|'Home'} Views
 * @typedef {'checking'|'login'|'chooseHome'|'ready'} AuthStage
 *
 * @typedef {object} DataState
 * @property {Home|null} currentHome
 * @property {Location|null} currentLocation
 * @property {Item|null} currentItem
 */

/**
 * Cached records from the db
 * @typedef {object} DBStore
 * @property {Home[]} homes
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
    showFoodNameHistoryForm: false,
    showSearch: false,
    currentView: 'ItemList',
    authStage: 'checking',
};

/**
 * State of data stored in memory
 * @type {DataState}
 */
const dataState = {
    currentHome: null,
    currentLocation: null,
    currentItem: null,
};

/**
 * Cached records from the db
 * @type {DBStore}
 */
const dbStore = {
    homes: [],
    locations: [],
    items: [],
    foodNameHistory: [],
};

const $app = $('app');

/** @type {Record<Views, string>} */
const VIEW_ELEMENT_IDS = {
    ItemList: 'itemListView',
    SingleItem: 'singleItemView',
    FoodHistory: 'foodHistoryView',
    Home: 'homeView',
};

/**
 * Plays the page-enter animation (see style.css's @keyframes pageEnter) on
 * the view that just became visible. Purely decorative - the element is
 * already display:block by the time this runs (the data-current-view
 * attribute selector already flipped), this just adds a one-shot entrance.
 * @param {Views} view
 */
function animatePageEnter(view) {
    const el = $(VIEW_ELEMENT_IDS[view]);
    if (!el) { return; }
    el.classList.remove('page-enter');
    void el.offsetWidth; // force reflow so re-adding the class restarts the animation
    el.classList.add('page-enter');
    el.addEventListener('animationend', () => el.classList.remove('page-enter'), { once: true });
}

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
    animatePageEnter(view);
}

/**
 * @param {AuthStage} stage
 */
function setAuthStage(stage) {
    appState.authStage = stage;
    $app.dataset.authStage = stage;
}

function initAppState() {
    setStateField('onboarding', false);
    setStateField('editingItem', false);
    setStateField('showLocationForm', false);
    setStateField('showItemForm', false);
    setStateField('showFoodNameHistoryForm', false);
    setStateField('showSearch', false);
    setCurrentView('ItemList');
    setAuthStage('checking');
}

export { appState, dataState, dbStore, initAppState, setStateField, setCurrentView, setAuthStage };
