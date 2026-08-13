# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

The repo has two independent npm projects; there is no root-level package.json or build step.

**Requires Node ≥24** (`backend/package.json`'s `engines`) — the backend's auth/Home API is built on the
built-in `node:sqlite` module, unflagged from Node 24 on. Use `nvm install 24 && nvm use 24` (this repo
was built against 24.19.0 via `nvm4w` on Windows) if your global Node is older.

**Backend (`backend/`)** — serves the frontend and hosts the accounts/Home API (see Architecture below):
```
npm run serve          # nodemon on src/index.js, reads PORT from backend/.env (currently 3001)
npm test                # unit tests: node --test (backend/test/*.test.js) - service-layer logic only
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

**The backend hosts a small accounts/Home API; everything else is still static file serving.**
`backend/src/http/requestHandler.js` routes `/api/*` to `backend/src/http/apiRouter.js` (see below),
and otherwise serves static files (`/`, `css/*`, `js/*`, `static/*`, `cacheServiceWorker.js`) plus an SPA
fallback: any request whose last path segment has no `.` in it is served `index.html`, so client-side
routes like `/item/42` survive a hard refresh. Data (`users`/`homes`/`home_members`/`sessions`) lives in
a `node:sqlite` file at `backend/data/fridgetrack.db` (gitignored, created on first run) via
`backend/src/db/db.js`; `backend/src/services/authService.js` and `homeService.js` hold the actual logic
(password hashing via `node:crypto` `scrypt`, opaque bearer session tokens, join-code generation/lookup)
and are structured as `create*Service(db)` factories specifically so tests can inject an isolated
`:memory:` database instead of touching the real data file. **Locations, items, and food-name history
still live entirely client-side in IndexedDB** (`js/lib/indexedDb.js` + `js/local-db/*.js`) — the backend
API only handles *who you are* and *which Home you belong to*; there is still no sync of the actual
fridge data between devices/browsers. `frontend/js/api-caller/apiCaller.js` is the real client for the
API above (`apiSignup`/`apiLogin`/`apiCreateHome`/`apiJoinHome`/`apiListHomes`), always POSTs to
`api/<path>` with a `Bearer` token from `localStorage`, and always resolves `{data}` or `{error}` —
network failures resolve `{error}` rather than throwing, so callers can fall back to the local cache
instead of crashing when offline.

**The app is gated behind login + an active Home before any fridge data loads.** `frontend/js/appBoot.js`
owns this: `bootApp()` (called from `app.js`'s `IndexedDbInited` handler, replacing what used to be
direct location-resolution logic there) checks `isLoggedIn()` and stops at the login screen
(`appState.authStage = 'login'`, driving `#authView` via the same CSS-attribute pattern described below)
if there's no cached session; `afterLogin()` resolves which Home is active (syncing from the server when
reachable, falling back to the IndexedDB `homes` cache otherwise) and stops at `#homeView`
(`authStage = 'chooseHome'`) if none can be resolved; `afterHome(home)` is the point where the *old*
boot sequence picks back up — fetch that Home's locations/food-name-history, resolve/open the current
location, re-apply the captured deep link. `afterHome` is also the reentry point for creating/joining/
switching Homes later, not just cold boot: `appBoot.js` imports `refreshHomeUi` from `js/ui/home-ui.js`
(to keep the Home chip list/label in sync after every activation) while `home-ui.js` imports `afterHome`
back from `appBoot.js` — a deliberate circular import between the two, safe here only because neither
module touches the other's export at module top level, just inside function bodies called later. Worth
knowing about before "fixing" it.

**Locations and food-name history are now scoped per-Home, not just per-browser.** Every `locations`
record carries a `homeId` field and the store has a `homeId` index (`getAllWithIndex('locations',
'homeId', ...)`); `items` need no such change since they're already scoped via `locationKey` and
locations are home-scoped. `foodNameHistory` is keyed by the compound array `[homeId, normalizedName]`
instead of `normalizedName` alone, so two Homes can each have their own "Leche" history. A user who
belongs to more than one Home (join via a 6-character join-code, no email invites) can switch between
them via the `.home-switcher` label in `#itemListView` (`openHomeSwitcher()` in `home-ui.js`), which
re-enters the Home-selection screen without logging out.

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
`captureInitialRoute()` *before* `initializeIndexedDb()`/`appBoot.js#bootApp()` run, because
`activateLocation`'s default list render calls `openItemList()`, which resets the URL to `/` — capturing
the route first is what lets a deep link to `/item/42` survive that reset. Since boot may now pause for
an arbitrarily long login/Home-selection step (see below), the captured route is held as module state in
`appBoot.js` (not a local `const` in `app.js` as before) and only re-applied once on the very first
`afterHome()` resolution — a later Home switch calling `afterHome()` again must *not* re-apply a stale
initial route from a different Home. Because of this route-capture requirement, static asset references
(`<script src>`, `<link href>`, `serviceWorker.register(...)`) must be root-relative (`/js/app.js`), not
relative (`js/app.js`) — relative paths resolve incorrectly from a nested URL like `/item/42`.

**Unit tests only cover DOM-free modules.** `js/lib/dom.js` and `js/lib/logger.js` run DOM queries
(`document.getElementById`, etc.) at module top level, so importing anything that transitively pulls
them in crashes under plain Node. `frontend/test/` therefore only targets modules with no such
dependency (`lib/date.js`, `lib/string.js`, `lib/freshnessStatus.js`, `common/routeMatch.js`) — this is
why `routeMatch.js` was split out of `router.js` in the first place. UI-level behavior is covered by
the Playwright e2e suite instead, where every test gets a fresh browser context (empty IndexedDB, no
cached session) but **not** a fresh backend — the sqlite file persists across test runs, so
`e2e/helpers.js`'s `ensureAuth()` always signs up a freshly-generated unique email rather than relying on
a clean DB for isolation, and `ensureHome()` always creates a new Home (the real isolation boundary for
locations/items now). `ensureOnboarded()` chains `ensureAuth` + `ensureHome` + `ensureLocation` for specs
that don't care about the auth/Home screens themselves; `auth.spec.js`/`home.spec.js` exercise those
screens directly, including a multi-Home data-isolation regression test.

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

**Food name history (`js/local-db/food-name-db.js`) is scoped per-Home, shared across that Home's
locations** (see the compound-key note above). It's a third IndexedDB store that back-fills name
autocomplete (`item-ui.js`'s `.name-suggestions` dropdown) and the `/historial` view
(`food-history-ui.js`). It's written to in two places only: `recordItemCreated()` on item *creation*
(not edit) upserts the name + refreshes `shelfLifeDays` (only ever set from shelfLifeDays-based items,
never touched by due-date-based ones), and `adjustDiscardCount()` on `markItemDiscarded` (±1, reversed
on undo) — "Usado" and the trash-icon delete don't count as a discard. Adding a new IndexedDB store, or
a new index on an existing one, means bumping `dbVersion` in `indexedDb.js` and creating/altering it in
`onDbUpgradeNeeded`; adding an index to a store that *already exists* (as opposed to a brand-new store)
can't go through `createObjectStore` again — pull the store off the in-flight versionchange transaction
instead (`openDbRequest.transaction.objectStore(name)`), guarded by `indexNames.contains`, the same way
new stores are guarded by `objectStoreNames.contains`.

All user-facing strings are Spanish (e.g. "Ingresar nombre", "Alimentos").

## Sync engine (online-persistence Phase 2)

Locations, items, and food-name history now sync between IndexedDB and the backend, on top of the
Phase-1 accounts/Homes API above and the client-generated-UUID groundwork it laid (`js/lib/id.js`).
`backend/src/db/schema.js` gained matching `locations`/`items`/`food_name_history` tables — `TEXT PRIMARY
KEY` UUIDs supplied by the client (a first for this backend; every other table is `INTEGER PRIMARY KEY
AUTOINCREMENT`), plus an `updated_at` column on every row and a nullable `deleted_at` tombstone column on
`locations`/`items` (never on `food_name_history`, which is only ever upserted, never deleted).
`backend/src/services/syncService.js` (`createSyncService(db)`, same factory shape as `homeService.js`,
reusing its exported `assertHomeMembership` helper) exposes `pullHomeSnapshot`/`pushHomeSnapshot`, wired
to `sync/pull`/`sync/push` in `apiRouter.js`. Push applies **last-write-wins per record**: an incoming
row only overwrites the stored one if its `updatedAt` is strictly greater (ties keep the existing row);
pull always includes tombstoned rows so the client knows what to soft-delete locally.

On the client, `frontend/js/sync/syncEngine.js`'s `syncHome(homeId)` reads a Home's full current
IndexedDB state (locations/items/foodNameHistory, tombstones included), pushes it, pulls the server's
current state back, and merges per-record via `frontend/js/sync/lwwMerge.js`'s `pickWinner`/`remoteWins`
(pure, DOM-free, unit-tested like `lib/date.js`). It never throws — mirroring `syncHomesFromServer()`'s
contract — and never touches `dbStore` or triggers a re-render itself; that's left to the caller.
**The only sync trigger is `appBoot.js`'s `afterHome()`**, best-effort (`try {} catch {}`) before the
existing `fetchLocations`/`fetchFoodNameHistory` calls — since `afterHome` runs on both cold boot and
every Home switch, this covers both without a second trigger. There is deliberately **no push-after-
every-mutation**: a change made on one device only becomes visible on another the next time that other
device reloads or switches Homes.

Because sync needs tombstones to propagate deletes, `deleteItem`/`deleteLocationAndItems` (in
`js/local-db/item-db.js`/`location-db.js`) no longer hard-delete — they set a `deletedAt`/bump `updatedAt`
and `putOne` the record back, and every read path that lists records (`fetchItems`,
`countItemsByStatus`, `fetchLocations`) filters `deletedAt == null` client-side (no IndexedDB index for
it — cheap enough at household scale, revisit if item counts ever grow large). `restoreItem` (the
undo-toast path) clears `deletedAt` again rather than re-inserting a removed record. `FoodNameHistory`
gained an `updatedAt` field for the same LWW purpose (bumped on every `recordItemCreated`/
`adjustDiscardCount`, not just when a value actually changes) but no tombstone concept, since it's never
deleted.

**Still deliberately deferred** to a follow-up phase:
- A true offline mutation outbox/queue with retry-on-reconnect — this sync is best-effort/fire-once, not
  durable across a failed push (nothing is lost locally, but a failed sync simply waits for the next
  boot/Home-switch to try again).
- A user-facing offline/online mode toggle, and finally flipping `INTERCEPT_FETCH_REQUESTS` to `true`
  for real service-worker offline support (see above).
- Tombstone pruning/GC — deleted rows are kept forever server-side; fine at this scale, not yet an issue.
