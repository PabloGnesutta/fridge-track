import { initializeCache } from "./initializeCache.js";
import { _info, _log } from "./lib/logger.js";
import { initializeIndexedDb } from "./lib/indexedDb.js";
import { dbugBtns, initUi } from "./ui/ui.js";
import { initAppState } from "./common/state.js";
import { eventBus } from "./lib/utils.js";
import { $ } from "./lib/dom.js";
import { fetchLocations, resolveCurrentLocation } from "./local-db/location-db.js";
import { activateLocation, openLocationForm } from "./ui/location-ui.js";
import { seedDb } from "./local-db/seed.js";
import { initRouter, renderSpecificRoute, captureInitialRoute } from "./common/router.js";


_info(' (!) App started');

/**
 * Captured before anything (e.g. activateLocation's default list render)
 * touches history and clobbers the URL the page actually loaded with.
 */ 
const initialRoute = captureInitialRoute();

initializeCache();

initializeIndexedDb();

/** Callback for Indexed DB initialization */
eventBus.on('IndexedDbInited', async ({ version }) => {
    // await seedDb();
    // return;
    _info(' (!) DB Callback');
    $('cacheMajorVersion').innerText = localStorage.getItem('cacheMajorVersion') || '';
    $('indexedDbVersion').innerText = version;

    const locations = await fetchLocations();
    const currentLocation = resolveCurrentLocation(locations);

    if (!currentLocation) {
        openLocationForm(true);
    } else {
        await activateLocation(currentLocation);
        // Re-applies the URL the page actually loaded with (e.g. a deep
        // link or a refresh on /item/42), now that items are loaded and
        // can be found - activateLocation's default list render already
        // reset the address bar to '/'.
        renderSpecificRoute(initialRoute);
    }
});

initAppState();
initUi();
initRouter();
dbugBtns();
