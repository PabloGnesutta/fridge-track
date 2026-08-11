# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

The repo has two independent npm projects; there is no root-level package.json or build step.

**Backend (`backend/`)** — serves the frontend and holds no other logic:
```
npm run serve          # nodemon on src/index.js, reads PORT from backend/.env (currently 3001)
```

**Frontend (`frontend/`)** — no bundler/build step. Every file is loaded exactly as written, either
natively by the browser (`<script type="module">`, relative `import`s between `js/` files) or served
as-is by the backend, so file paths matter literally.
```
npm test                              # unit tests: node --test (frontend/test/*.test.js)
node --test test/date.test.js         # run a single unit test file
npm run test:e2e                      # Playwright e2e (frontend/e2e/*.spec.js)
npx playwright test e2e/routing.spec.js   # run a single e2e spec
npx playwright test -g "some title"       # run e2e tests matching a title
```
`test:e2e` auto-starts and tears down the backend server itself (see `playwright.config.js`); don't
start it manually first. It's pinned to a single worker — running parallel Chromium instances on this
machine causes spurious navigation timeouts, not real failures.

There is no lint or typecheck CLI command. Type checking is JSDoc annotations + VSCode's implicit
`checkJs` (`.vscode/settings.json`), i.e. editor-only — it isn't scriptable from the terminal.

## Architecture

**The backend has no data API.** `backend/src/http/requestHandler.js` only serves static files
(`/`, `css/*`, `js/*`, `static/*`, `cacheServiceWorker.js`) plus an SPA fallback: any request whose
last path segment has no `.` in it (i.e. not an asset request) is served `index.html`, so client-side
routes like `/item/42` survive a hard refresh. `frontend/js/api-caller/apiCaller.js` (a `/api/*` +
bearer-token client) exists but is unused scaffolding — nothing imports it, and there is no matching
`/api` route on the backend. **All app data lives client-side in IndexedDB**, via the generic wrapper
in `js/lib/indexedDb.js` and per-entity CRUD in `js/local-db/item-db.js` / `location-db.js`. There is
no sync between devices/browsers.

**View state drives the DOM through CSS attribute selectors, not JS show/hide calls.**
`js/common/state.js` holds `appState`/`dataState`/`dbStore` in memory and mirrors fields (e.g.
`currentView`, `showItemForm`) onto `#app`'s `dataset`. `css/style.css` then does the actual
showing/hiding via selectors like `#app[data-show-item-form='true'] .modal`. When adding new UI
state, follow this pattern (`setStateField`/`setCurrentView` in state.js) rather than toggling
classes/display directly.

**Client-side routing** is split across two files for testability:
`js/common/routeMatch.js` is a pure, dependency-free `pathname -> route` mapper; `js/common/router.js`
wires it to `history.pushState`/`popstate` and to the actual view functions (`openItemList`,
`openSingleItem` in `js/ui/item-ui.js`), which call `syncUrl()` themselves so every way of reaching a
view (click, deep link, browser back) keeps the URL in sync. Boot order matters: `app.js` calls
`captureInitialRoute()` *before* `initializeIndexedDb()`/`activateLocation()` run, because
`activateLocation`'s default list render calls `openItemList()`, which resets the URL to `/` — capturing
the route first is what lets a deep link to `/item/42` survive that reset. Because of this, static
asset references (`<script src>`, `<link href>`, `serviceWorker.register(...)`) must be root-relative
(`/js/app.js`), not relative (`js/app.js`) — relative paths resolve incorrectly from a nested URL like
`/item/42`.

**Unit tests only cover DOM-free modules.** `js/lib/dom.js` and `js/lib/logger.js` run DOM queries
(`document.getElementById`, etc.) at module top level, so importing anything that transitively pulls
them in crashes under plain Node. `frontend/test/` therefore only targets modules with no such
dependency (`lib/date.js`, `lib/string.js`, `lib/freshnessStatus.js`, `common/routeMatch.js`) — this is
why `routeMatch.js` was split out of `router.js` in the first place. UI-level behavior is covered by
the Playwright e2e suite instead, where every test gets a fresh browser context (empty IndexedDB), so
specs start from onboarding via the `ensureLocation()` helper in `e2e/helpers.js`.

**Two error-reporting paths, used deliberately for different cases.** `_error()`
(`js/lib/logger.js`) opens the in-app dev-facing debug log panel (`#logger`) — for unexpected/internal
errors (IndexedDB failures, service worker registration failures, uncaught exceptions/rejections).
`showErrorToast()` (`js/lib/toast.js`) shows a self-dismissing toast instead — for user-actionable
messages (validation errors from `local-db/*.js`, "item not found"). Keep this split for new error
paths rather than routing everything through one or the other.

**The service worker is intentionally inert in development.** `INTERCEPT_FETCH_REQUESTS` in
`frontend/cacheServiceWorker.js` must stay `false` locally (per `frontend/js/README.md`) so hot-reload
isn't masked by stale cached responses; it needs to be flipped to `true`, with the cache version
constants bumped, before any release. While it's `false` the app has no real offline support despite
the manifest/install-prompt scaffolding being in place.

All user-facing strings are Spanish (e.g. "Ingresar nombre", "Alimentos").
