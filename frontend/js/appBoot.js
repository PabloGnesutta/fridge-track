import { apiLogout, isLoggedIn } from "./api-caller/apiCaller.js";
import { dataState, dbStore, setAuthStage, setCurrentView } from "./common/state.js";
import { clearArray } from "./lib/utils.js";
import {
  fetchHomes, resolveCurrentHome, setCurrentHomeId, syncHomesFromServer,
} from "./local-db/home-db.js";
import { fetchLocations, resolveCurrentLocation } from "./local-db/location-db.js";
import { fetchFoodNameHistory } from "./local-db/food-name-db.js";
import { fetchCategories } from "./local-db/category-db.js";
import { syncHome } from "./sync/syncEngine.js";
import { activateLocation, openLocationForm } from "./ui/location-ui.js";
// Deliberate circular import with home-ui.js (which imports afterHome back
// from this file) and auth-ui.js (which imports afterLogin) - safe here for
// the same reason both already document: neither module calls the other's
// export at module top level, only from inside function bodies invoked later.
import { refreshHomeUi, captureJoinLinkCode, consumePendingJoin } from "./ui/home-ui.js";
import { tryAutoVerifyFromLink } from "./ui/auth-ui.js";
import { renderSpecificRoute } from "./common/router.js";
import { initPushNotifications } from "./pushNotifications.js";
import { _error } from "./lib/logger.js";

/**
 * @typedef {import("./common/routeMatch.js").Route} Route
 */

/**
 * Captured once at the top of app.js (before anything touches history) and
 * re-applied once boot finally resolves - which may now be paused for an
 * arbitrarily long login/home-selection step, unlike the old boot sequence
 * that resolved synchronously inside a single IndexedDB callback.
 * @type {Route|null}
 */
let pendingInitialRoute = null;

/**
 * Entry point called from app.js once IndexedDB is ready. Gates the rest of
 * boot behind auth: if there's no cached session, stops at the login
 * screen; otherwise continues straight through Home + location resolution.
 * @param {Route} initialRoute
 */
async function bootApp(initialRoute) {
  pendingInitialRoute = initialRoute;

  // Landing here via the one-click link in a verification email
  // (?email=...&code=...) takes priority over the normal isLoggedIn()
  // check below - a fresh signup on this same device has no session yet
  // for isLoggedIn() to find, and tryAutoVerifyFromLink() already drives
  // the auth stage (and calls afterLogin() itself on success) either way.
  if (await tryAutoVerifyFromLink()) { return; }

  // A Home-invite link (?joinCode=...) needs an authenticated session to
  // actually join - captured now (also stripping the query string so a
  // reload can't re-trigger it), consumed by afterLogin() once auth
  // resolves, which may mean showing the login screen first.
  captureJoinLinkCode();

  if (!isLoggedIn()) {
    setAuthStage('login');
    return;
  }
  await afterLogin();
}

/**
 * Called after a successful login/signup (from auth-ui.js) or on every boot
 * where a session is already cached. Resolves which Home is active, or
 * stops at the Home selection screen if none can be resolved.
 */
async function afterLogin() {
  try {
    await syncHomesFromServer();
  } catch (err) {
    // Offline or server unreachable - fall back to whatever's cached, but
    // log it (this app has no manual "open logs" affordance anymore, so a
    // silent catch here is otherwise completely invisible).
    _error(' - syncHomesFromServer failed:', err);
  }

  // A captured Home-invite link takes priority over the normal "resolve
  // last-used or first Home" logic below - arriving via an invite link
  // means the user wants THAT Home, whether or not they already belong to
  // others. No-ops (returns null) when no link was involved in this boot.
  const joinedHome = await consumePendingJoin();
  if (joinedHome) {
    await afterHome(joinedHome);
    return;
  }

  const homes = await fetchHomes();
  const home = resolveCurrentHome(homes);
  if (!home) {
    setAuthStage('chooseHome');
    return;
  }
  await afterHome(home);
}

/**
 * Called after a Home is created/joined/switched (from home-ui.js) or once
 * afterLogin() resolves one automatically. Loads that Home's locations and
 * food-name history, then resumes the pre-Home boot sequence (resolve
 * current location, open onboarding, or render the deep link).
 * @param {import("./local-db/home-db.js").Home} home
 */
async function afterHome(home) {
  dataState.currentHome = home;
  setCurrentHomeId(home.id);
  setAuthStage('ready');
  refreshHomeUi();

  try {
    await syncHome(home.id);
  } catch (err) {
    // syncHome() itself already never throws (and logs its own failures via
    // _error) - this is just a defensive backstop in case something
    // unexpected still slips through.
    _error(' - afterHome syncHome threw unexpectedly:', err);
  }

  try {
    initPushNotifications();
  } catch {
    // Push not supported/available in this browser - the banner just never shows.
  }

  // Categories fetched first - item-ui.js's page title / autocomplete
  // filtering and location-ui.js's form both read dbStore.categories as soon
  // as fetchLocations below resolves a current location and activates it.
  await fetchCategories(home.id);
  const locations = await fetchLocations(home.id);
  await fetchFoodNameHistory(home.id);
  const currentLocation = resolveCurrentLocation(locations, home.id);

  if (!currentLocation) {
    // Reset away from whatever view was showing before this Home was
    // activated - reachable not just on a genuine first boot (where
    // currentView already defaults to 'ItemList', so this is a no-op) but
    // also via the Home switcher's openHomeManage(), which sets currentView
    // to 'Home' to render the Hogar tab as a full page. Without this,
    // switching to a brand-new, location-less Home left #homeView's
    // visibility (driven by data-current-view === 'Home') stuck on,
    // wedged open underneath the onboarding form this line opens next.
    setCurrentView('ItemList');
    openLocationForm(true);
  } else {
    await activateLocation(currentLocation);
    // Re-applies the URL the page actually loaded with (e.g. a deep link or
    // a refresh on /item/42), now that items are loaded and can be found -
    // activateLocation's default list render already reset the address bar
    // to '/'. Only relevant for the very first boot: afterHome() also runs
    // on every later Home switch, where re-applying a stale initial route
    // (possibly for a different Home's item) would be wrong.
    if (pendingInitialRoute) {
      renderSpecificRoute(pendingInitialRoute);
      pendingInitialRoute = null;
    }
  }
}

/**
 * Logs out and drops back to the login screen. Only the in-memory
 * dataState/dbStore caches are cleared - IndexedDB itself is left alone
 * since its records are already scoped by homeId, so a different user
 * logging in on the same device just won't query into them.
 */
async function logout() {
  await apiLogout();

  dataState.currentHome = null;
  dataState.currentLocation = null;
  dataState.currentItem = null;
  clearArray(dbStore.homes);
  clearArray(dbStore.categories);
  clearArray(dbStore.locations);
  clearArray(dbStore.items);
  clearArray(dbStore.foodNameHistory);

  setAuthStage('login');
}

export { bootApp, afterLogin, afterHome, logout };
