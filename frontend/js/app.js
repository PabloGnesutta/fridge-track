import { initializeCache } from "./initializeCache.js";
import { _info, _log } from "./lib/logger.js";
import { initializeIndexedDb } from "./lib/indexedDb.js";
import { initUi } from "./ui/ui.js";
import { initAppState } from "./common/state.js";
import { eventBus } from "./lib/utils.js";
import { $ } from "./lib/dom.js";
import { seedDb } from "./local-db/seed.js";
import { initRouter, captureInitialRoute } from "./common/router.js";
import { initInstallPrompt } from "./installPrompt.js";
import { bootApp } from "./appBoot.js";
import { initAuthUi } from "./ui/auth-ui.js";
import { initHomeUi } from "./ui/home-ui.js";
import { initVoiceItemUi } from "./ui/voice-item-ui.js";


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

    await bootApp(initialRoute);
});

initAppState();
initUi();
initAuthUi();
initHomeUi();
initRouter();
initInstallPrompt();
initVoiceItemUi();
