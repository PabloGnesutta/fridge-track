import { isLoggedIn } from "./api-caller/apiCaller.js";
import { dataState, setAuthStage } from "./common/state.js";
import {
  fetchHomes, resolveCurrentHome, setCurrentHomeId, syncHomesFromServer,
} from "./local-db/home-db.js";
import { fetchLocations, resolveCurrentLocation } from "./local-db/location-db.js";
import { fetchFoodNameHistory } from "./local-db/food-name-db.js";
import { activateLocation, openLocationForm } from "./ui/location-ui.js";
import { refreshHomeUi } from "./ui/home-ui.js";
import { renderSpecificRoute } from "./common/router.js";

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
  } catch {
    // Offline or server unreachable - fall back to whatever's cached.
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

  const locations = await fetchLocations(home.id);
  await fetchFoodNameHistory(home.id);
  const currentLocation = resolveCurrentLocation(locations, home.id);

  if (!currentLocation) {
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

export { bootApp, afterLogin, afterHome };
