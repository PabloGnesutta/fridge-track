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
`backend/.env` also needs `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` for push notifications
(see "Push notifications" below) — generate a keypair once via `npx web-push generate-vapid-keys`. Missing
keys don't crash the server, just silently no-op the feature (subscribe requests get an empty public key,
and the scheduler's send attempts fail quietly, logged but caught).

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
`:memory:` database instead of touching the real data file.

**Database migrations** (`backend/src/db/migrate.js` + `backend/src/db/migrations/`) run on every boot,
before anything else touches `db`. Each migration is a `NNN_description.js` file exporting a `sql`
string, registered in order in `migrations/index.js` (an explicit array, not directory-scanning); a
`runMigrations(db, migrations)` call tracks which versions have already run in a `schema_migrations`
table and applies only the new ones, each inside its own transaction. This replaced an earlier one-shot
`db.exec(SCHEMA_SQL)` (a single hand-maintained `CREATE TABLE IF NOT EXISTS` blob, no tracking at all) —
that approach only ever worked for brand-new tables, since `CREATE TABLE IF NOT EXISTS` silently no-ops
against a table that already exists on disk even after its column list changes in code. That gap is what
actually broke `food_name_history.times_used` on the live dev database the day it was added: the column
existed in the source but not in the already-created table, and nothing caught it until a query referencing
it failed at runtime. **Never edit an already-shipped migration's `sql`** — add a new migration with the
next version number instead, the same rule as any other migration tool; editing history means anyone
who already applied the old version silently diverges from anyone starting fresh.

**Locations, items, and food-name history
live in IndexedDB on the client, synced to the backend** (`js/lib/indexedDb.js` + `js/local-db/*.js`
locally; `backend/src/services/syncService.js` + `frontend/js/sync/syncEngine.js` remotely — see "Sync
engine" below for the full mechanism, including what's deliberately still *not* real-time). The backend's
accounts/Home API additionally handles *who you are* and *which Home you belong to*.
`frontend/js/api-caller/apiCaller.js` is the real client for the whole API surface above
(`apiSignup`/`apiLogin`/`apiCreateHome`/`apiJoinHome`/`apiListHomes`/`apiSyncPull`/`apiSyncPush`), always
POSTs to `api/<path>` with a `Bearer` token from `localStorage`, and always resolves `{data}` or `{error}`
— network failures resolve `{error}` rather than throwing, so callers can fall back to the local cache
instead of crashing when offline.

**The app is gated behind login + an active Home before any fridge data loads.** `frontend/js/appBoot.js`
owns this: `bootApp()` (called from `app.js`'s `IndexedDbInited` handler, replacing what used to be
direct location-resolution logic there) checks `isLoggedIn()` and stops at the login screen
(`appState.authStage = 'login'`, driving `#authView` via the same CSS-attribute pattern described below)
if there's no cached session; `afterLogin()` resolves which Home is active (syncing from the server when
reachable, falling back to the IndexedDB `homes` cache otherwise) and stops at `#homeView`
(`authStage = 'chooseHome'`) if none can be resolved; `afterHome(home)` is the point where the *old*
boot sequence picks back up — a best-effort `syncHome()` pull (see "Sync engine" below), then fetch that
Home's locations/food-name-history, resolve/open the current location, re-apply the captured deep link.
`afterHome` is also the reentry point for creating/joining/
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
Phase-1 accounts/Homes API above and the client-generated-UUID groundwork it laid (`js/lib/id.js`). The
baseline schema (migration `001_initial_schema`, see "Database migrations" below) gained matching
`locations`/`items`/`food_name_history` tables — `TEXT PRIMARY KEY` UUIDs supplied by the client (a first
for this backend; every other table is `INTEGER PRIMARY KEY AUTOINCREMENT`), plus an `updated_at` column
on every row and a nullable `deleted_at` tombstone column on `locations`/`items` (never on
`food_name_history`, which is only ever upserted, never deleted).
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

**A real production incident traced a sync gap back to `apiCaller.js`'s `fetch()` using a relative
URL** (`'api/' + path`) instead of root-relative (`'/api/' + path`) — from a client-side route like
`/item/42` (exactly where the "Usado" button lives), that resolved to `/item/api/sync/push` instead of
`/api/sync/push`, which the backend's router doesn't recognize as an API path, so it silently served the
SPA-fallback `index.html` (`200 OK`, wrong body) instead of a real response or error. Same class of
relative-vs-root-relative gotcha this file already documents for `<script src>`/`<link href>` tags, just
missed for the API caller itself — fixed now. The investigation is also why `syncHome()`'s push/pull
failures and `scheduleItemSync()`'s "no local location found" case now log via `_error()` (auto-opens the
debug panel) rather than being silently swallowed or logged via `_warn` (invisible with no manual way to
open the panel — see the header menu note below) — a failed sync used to leave zero trace anywhere,
which is exactly what made this bug so hard to pin down on a real device with no devtools access.

**Sign-out offers a "fresh start" escape hatch.** After the existing "¿Seguro que querés cerrar sesión?"
confirmation and the actual sign-out, a *second*, separate dialog asks whether to also wipe this
device's entire local IndexedDB cache (`js/lib/indexedDb.js`'s `clearAllData()` — closes the existing
connection first, since `deleteDatabase()` blocks/hangs otherwise, then the caller reloads the page).
It's deliberately a second dialog, not folded into the first: by that point sign-out has already
happened either way, so "cancel" here just means "leave the cache alone," not "undo the sign-out." Not
part of normal logout by default — `logout()` in `appBoot.js` still deliberately leaves IndexedDB alone
on its own, so a device keeps working offline and a repeat login doesn't need a full network round-trip.
This is purely a manual recovery option for a device stuck showing stale data.

## Header hamburger menu + logging

The header's standalone logout icon is now a hamburger menu (`#headerMenuBtn`, built like every other
icon button via `$button()` — there was no existing dropdown/popup component anywhere in this app to
reuse, so this one is built from existing primitives: the `.display-none` toggle convention, and a
click-outside-to-close listener on `#app` in the same spirit as `modalBackdropHandler()`). The panel
holds "Cerrar sesión" (the same `#logoutBtn`, just relocated - unchanged id/logic) and a new "Ver logs"
button that calls `logger.js`'s already-exported-but-previously-unused `openLogs()`. That gap mattered:
the debug panel (`#logger`) has had no manual open affordance since an earlier pass removed its old
"open logs" button, so it only ever opened automatically via `_error()` — genuinely unreachable
on-demand, which was a real problem while debugging the sync issue above on a phone with no devtools.

Backend logging (`backend/src/logger/logger.js`) was a literal `// TODO: Implement logger` stub - raw
`console.debug/log/warn` re-exports, no `error` level at all, no timestamps. It's now a small wrapper
adding an ISO timestamp + level tag to every line and a real `error` export (routed to `console.error`,
not `console.log`) - no logging library, just enough to make server output (wherever it ends up: a nohup
file, `pm2 logs`, `journalctl`) greppable and correlatable against a client-side report. Every existing
`log('---Error @...', err)` call site (`apiRouter.js`'s catch-all, `requestHandler.js`'s asset-serving
error paths, `expiryNotifier.js`'s tick/notification-send catches) now uses `error(...)` instead;
non-error `log`/`debug` calls (e.g. the per-request `debug('urlArray', ...)`, or the expected-404
"file does not exist" case) are unchanged. The frontend's own `logger.js` gained a matching small
improvement: every rendered log entry is now timestamped, so multiple stacked entries from one
debugging session can be told apart by when they fired, not just what they say.

## UI/UX overhaul: navigation, motion, accessibility, gestures

On top of a pure visual pass (dark-themed inputs, `box-shadow` elevation on rows/chips/modal, an
accent-colored FAB, `color-scheme: dark` so native form controls follow the theme, a modernized `body`
font stack — all in `frontend/css/`, no behavior changes), the app got a full interaction/navigation
pass.

**The bottom tab bar replaces the old header-icon pattern.** `#mainFooter` used to be dead markup (a
hardcoded `display-none` div holding only dev-only version labels). It's now the real Lista/Historial/
Hogar tab bar — and since it was already listed in the `#app:not([data-auth-stage='ready']) {
display:none }` gating block alongside `#mainHeader`, it inherited the header's show/hide-during-login-
and-chooseHome behavior for free, with no new CSS-gating logic. The dev version labels
(`#indexedDbVersion`/`#cacheMajorVersion`) moved into the `#logger` debug panel; the old standalone "open
logs" button was dropped (dev-only convenience, superseded by `_error()`'s existing auto-open-on-error).

**Modals fade instead of snapping.** `.modal`/`#confirmDialog` no longer use `display:none` — since that
can't be CSS-transitioned across, they pair `opacity` with a *delayed* `visibility: hidden`
(`transition: opacity 200ms ease-out, visibility 0s linear 200ms` when hiding, `0s` delay when showing) —
the standard trick that keeps both the fade animation and `display:none`'s old side effect of pulling the
modal's form fields out of the tab order while closed. View switches get a matching one-shot `page-enter`
`@keyframes` entrance, applied via `state.js`'s `setCurrentView()` calling `animatePageEnter()` — this
only decorates the already-visible page; it can't (and doesn't try to) animate the underlying
`display:none` toggle itself.

**Swipe-to-act on item rows** (`js/lib/swipe.js`, wired in `item-ui.js`'s `appendItemRow`) is built on
Pointer Events, not Touch Events, specifically so Playwright's ordinary `page.mouse` drag sequence
exercises the real listeners in e2e tests with no synthetic Touch-object plumbing. The pure
threshold-decision logic (`pickSwipeOutcome`) is split out from the DOM-touching gesture wiring
(`attachSwipe`) so it's unit-testable per the DOM-free-module convention above. Each row is wrapped in a
`.row-wrapper` (a swipe-action reveal layer behind `.row` itself) — **the reveal layer must not out-stack
`.row`**: since it's `position: absolute` and `.row` was originally unpositioned (`static`), it silently
intercepted every click on the row regardless of DOM order until `.row` got its own
`position: relative; z-index: 1`. `markItemUsed`/`markItemDiscarded`/`tryDeleteItem`/`removeItem`
(`item-ui.js`) now take an *optional* `item` param (defaulting to `dataState.currentItem`) so a swipe can
act on that row's item directly — their button call sites in `ui.js` had to be rewrapped in no-arg
closures (`() => markItemUsed()`), since `$button()`'s listener otherwise passes the raw DOM click event
as the first argument, which would've landed in the new `item` param instead of falling through to the
default.

**`makeKeyboardActivatable()` (`js/lib/dom.js`) closes a real gap**: `$button()` already set
`role="button"`/`tabIndex=0` on every icon button, but browsers only auto-fire a click on Enter/Space for
*native* interactive elements (`<button>`/`<a>`), not `role="button"` divs — every icon button was
focusable-but-not-operable via keyboard before this. `$button()` calls it internally now; anywhere else a
raw `role="button"` div is wired by hand (mode-toggle links, the confirm dialog's buttons) has to call it
explicitly too.

**The cross-location "what's expiring" summary** (`fetchAllItemsForHome` in `item-db.js`) is deliberately
separate from `fetchItems`/`countItemsByStatus`, which are hard-scoped to one `locationKey` via the
`items` store's IndexedDB index (there's no `homeId` index on `items`). It loops every location for the
Home the same way `sync/syncEngine.js`'s `buildLocalSnapshot` already does, and does **not** touch
`dbStore.items` (reserved for the single active location's list) — it's rendered by `item-ui.js`'s
`renderHomeSummary()`, hooked into the same call site `renderLocationChips()` already uses so it
recomputes for free on every add/edit/remove.

**The confirm dialog** (`js/lib/confirmDialog.js` + `css/confirm-dialog.css`) replaces the app's one
remaining native `confirm()` (location deletion). It deliberately does **not** share the `.modal` class
with the form modal, even though it reuses the same fade/rise CSS technique — deleting a location happens
*from inside* the already-open location-edit modal, so the confirm dialog has to layer on top of it
(`z-index: 20` vs the form modal's `10`) and open/close completely independently; sharing a class would
risk one modal's `data-show-*` trigger rules accidentally matching the other.

Still deliberately not done: a light theme (the whole palette is dark-only), per-item category icons, and
toast queuing (rapid swipes supersede each other's undo option — `showUndoToast`'s "one active toast"
behavior was always intentional, just more reachable now that swiping lowers the friction to act on
several items quickly).

## Waste/usage stats (product feature #2)

`food_name_history` (see above) gained a `timesUsed` counter alongside its existing `timesDiscarded`,
synced through `syncService.js`/`syncEngine.js` the same way as every other field on that table.
`adjustUsedCount()` (`local-db/food-name-db.js`) bumps it from `item-ui.js`'s `removeItem(item, ...,
{ used: true })` path — mirroring `adjustDiscardCount()`'s existing `{ discarded: true }` path exactly,
undo included. `/historial`'s `renderHistoryStats()` (`food-history-ui.js`) sums both counters across
every entry and shows a single all-time "N% aprovechado — X usado(s), Y tirado(s)" line, hidden while
both totals are zero.

## food_name_history scoped by location category, not just by Home

Originally `food_name_history` was shared across every location in a Home (see above) - meaning a
`locations.category` of `'medicamento'` (added earlier for "what kind of stuff a location holds", see
migration `003`) had no effect on autocomplete/shelf-life history at all: adding "Aspirina" in a medicine
cabinet would pollute food autocomplete, and two same-named-but-unrelated items across categories shared
one shelf-life default. Migration `005_food_name_history_category.js` adds a `category` column and widens
the primary key from `(home_id, normalized_name)` to `(home_id, category, normalized_name)` - a real
**recreate-table** migration (rename old table aside, create the new one, `INSERT ... SELECT` across with
every existing row backfilled to `category = 'alimento'`, drop the renamed original), not a plain
`ALTER TABLE ADD COLUMN` like `003`/`004`, since SQLite can't widen a PRIMARY KEY in place. The backfill is
safe unconditionally: every row that existed before this migration predates location categories entirely,
so all of it is, in fact, food.

**Every place that used to identify a `food_name_history` record by `(homeId, normalizedName)` now needs
`category` as a third component of that same identity** - `local-db/food-name-db.js`'s
`recordItemCreated()`/`adjustDiscardCount()`/`adjustUsedCount()` (now all take a `category` param, building
a 3-part IndexedDB key), `sync/syncEngine.js`'s `mergeFoodNameHistory()` (3-part key) and
`buildLocalSnapshot()` (adds `category` to the wire shape), and `syncService.js`'s `pushFoodNameHistory()`
(3-column `WHERE`/`INSERT`). `item-ui.js`'s three call sites (`submitItemForm`, `removeItem`'s two branches
plus their undo mirrors) already had `location.category` in scope - no new lookup needed, just one more
argument threaded through. The `.name-suggestions` autocomplete filter in the same file now also matches
on `(entry.category || 'alimento') === (dataState.currentLocation?.category || 'alimento')` - the
`|| 'alimento'` default reads a record written before this field existed as food, same assumption as the
SQL backfill above, just applied client-side.

**No client-side (IndexedDB) migration was written on purpose** - a deliberate choice, not an oversight,
made explicitly because this app currently has exactly one real user. Every local record written before
this shipped is still keyed `[homeId, normalizedName]` (2 parts); the new code only ever looks things up
by the 3-part key, so those old records go quietly unreachable rather than being actively re-keyed. They
self-heal the next time `afterHome()`'s `syncHome()` runs (every boot/Home switch already pulls a fresh,
correctly-keyed snapshot from the backend, which by then has already backfilled `category`), at the cost
of a possible one-session "history looks empty" blip on a device that's offline exactly when this ships -
judged not worth a cursor-based IndexedDB re-keying migration (reading every old record during
`onDbUpgradeNeeded`, deleting it, re-`put`-ing it under the new key) for a single-user app. Revisit this
if this app ever gets more than a couple of users, since a wider rollout makes that blip land on people
who can't be talked through it in person.

**`/historial` now has one tab per `locationCategory.js`'s `LOCATION_CATEGORIES`** instead of one flat,
mixed list. `food-history-ui.js` fetches the Home's full entry set once per `openFoodHistory()` call
(`allEntries`, module state) and re-filters it locally on every tab switch (`switchHistoryCategory()`,
wired through `ui.js`'s existing `data-click-action` delegation switch, same pattern
`renderLocationChips()`'s chips already use) - no re-fetch per tab, mirroring how this app already treats
IndexedDB reads as a cheap local cache everywhere else. The default selected tab is whichever category the
user's current location has, not always `'alimento'`, so opening history from the medicine cabinet doesn't
land you on the food tab first. The tabs (`.history-category-tab`, new in `css/style.css`) deliberately
don't reuse `.location-chip`'s class even though they copy its exact visual language (pill shape, `.active`
border/background) - same reasoning as the confirm dialog's own separate-class choice elsewhere in this
file: a different concern (category filter vs. location switching) shouldn't risk one component's future
CSS changes silently leaking into the other's.

## Editing and deleting food_name_history entries

Added because a typo in a history entry's name would otherwise sit in autocomplete forever - fixing it
needed both a rename and a delete path, neither of which existed before (the whole table was previously
write-only from the app's perspective: upserted on item creation, adjusted on use/discard, never directly
edited or removed by a person).

**Delete gives `food_name_history` a tombstone for the first time.** Migration
`006_food_name_history_deleted_at.js` adds `deleted_at` - a plain `ALTER TABLE ADD COLUMN` this time
(unlike migration `005`), since it isn't part of the primary key. `local-db/food-name-db.js`'s
`deleteFoodNameHistory()` soft-deletes exactly like items/locations already do (set `deletedAt`, bump
`updatedAt`, keep the row so the tombstone propagates through sync); `fetchFoodNameHistory()` now filters
`deletedAt == null` client-side, the same pattern `fetchItems`/`fetchLocations` already use for their own
tombstones. Deleting doesn't touch `dbStore` or trigger sync itself - callers re-fetch afterward, same as
after any other write in this module, since edit/delete are infrequent, deliberate user actions on the
`/historial` screen rather than a hot path like item creation that needs `upsertCache()`'s per-write cache
patching to avoid a refetch.

**Renaming moves the record to a new key, it doesn't update in place** - `normalizedName` is *derived*
from `name` and is part of this store's `[homeId, category, normalizedName]` key (see the category-scoping
section above), so a real typo fix (not just a capitalization tweak) changes the record's identity.
`updateFoodNameHistory()` checks whether the new name's normalized form actually differs first: if not,
it's a trivial in-place field update; if it does, it tombstones the old key and creates a new record at the
new one, carrying over `firstCreatedAt`/`timesDiscarded`/`timesUsed` - reusing the exact same tombstone
mechanism delete just added, not a separate "rename" concept. **Collisions are blocked, not merged or
silently overwritten**: if the new key already matches another still-live entry, `updateFoodNameHistory()`
returns `{ok: false, error}` instead of touching anything - combining two different names' accumulated
history is a bigger, unrequested decision than a rename should make on its own. None of this needed any
sync-engine changes beyond the `deletedAt` field itself - from `syncService.js`/`syncEngine.js`'s
perspective a rename is just two ordinary pushed records (one now-tombstoned, one new), no special "move"
handling required.

**A tombstoned entry is "nonexistent" to `recordItemCreated()`, not resurrectable.** Creating a new item
under a name whose history was explicitly deleted starts a genuinely fresh record (reset counts, new
`firstCreatedAt`) rather than quietly reviving the old `timesUsed`/`timesDiscarded` - deleting was a
deliberate "forget this" action, so bringing the old stats back without telling anyone would defeat the
point. `adjustDiscardCount()`/`adjustUsedCount()` treat a tombstoned entry as absent too (no-op), for the
same reason in the other direction - they shouldn't silently revive a deleted entry just because an
already-in-flight discard/use happens to land after its deletion.

**UI**: `/historial` rows get a pencil + trash icon (`food-history-ui.js`'s `buildHistoryRow()`, styled in
`css/btn.css` as `.history-row-actions`) - the trash opens the existing `showConfirmDialog()`; the pencil
opens a small new form (`#foodNameHistoryForm`, name + shelf-life-days) reusing the same shared-modal/
state-flag pattern as `locationForm`/`itemForm` (`showFoodNameHistoryForm` in `state.js`, gated in
`style.css` and `ui.js`'s `modalBackdropHandler()` exactly like the other two forms). Only the name and
shelf-life-days are editable - not the category, since that's a property of *where* an item was added
(the location), not something a history entry should redefine on its own.

## Push notifications (product feature #1)

A background scheduler on the backend, not a client-side timer, since the whole point is alerting users
who don't have the app open. Follows the sync engine's "best-effort, no outbox" philosophy rather than
building real cron infra: `backend/src/scheduler/expiryNotifier.js`'s `startExpiryNotificationScheduler(db)`
(started from `index.js`'s `listen()` callback) runs an immediate tick, then a `setInterval` every
`NOTIFICATION_CHECK_INTERVAL_MS` (env, default 1h). **v1 is deliberately one digest notification per user
per Home per day** ("N alimentos vencen pronto"), not per-item tracking — a `push_notification_log` row
keyed by `(user_id, home_id, sent_date)` (migration `002_push_subscriptions`, alongside `push_subscriptions`
itself) is the entire dedup mechanism, which is why an hourly tick that's a no-op most hours is fine
instead of needing precise cron timing.

Since the sync engine (above) already means `items` live in the backend db too, the scheduler queries
`items` directly (`home_id`, `deleted_at IS NULL`) rather than needing any new sync plumbing. It runs each
row through `backend/src/lib/itemStatus.js`'s `computeItemStatus()` — a **deliberate duplicate** of
`frontend/js/lib/freshnessStatus.js`'s `computeStatus()` decision logic (same `EXPIRING_SOON_DAYS = 2`
threshold, same "expired if either the use-by date or the shelf-life-from-added-date has elapsed" rule),
because the two npm projects share no code; if the threshold/logic ever changes, change both files.

`backend/src/services/pushService.js` (same `create*Service(db)` factory shape as `homeService.js`) owns
`push_subscriptions` (one row per subscribed browser/device, upserted by `endpoint` so resubscribing the
same device doesn't duplicate) and the log table above. `backend/src/services/webPushClient.js` wraps the
new `web-push` npm dependency (the backend's **first real runtime `dependencies` entry** — previously only
`devDependencies` existed) and **configures VAPID lazily** (`getWebPush()`, memoized on first call) rather
than at module top level: this module is statically imported (via `expiryNotifier.js`) from `index.js`,
and ES module imports are hoisted and evaluated *before* any of `index.js`'s own body runs — including its
`configEnv()` dotenv call — so reading `process.env.VAPID_*` at import time would always see `undefined`.
This is the same ESM-ordering quirk `index.js`'s own header comment already warns about, just tripped in a
new way. VAPID keys live in `backend/.env` (`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`,
generated once via `npx web-push generate-vapid-keys`), loaded the same way `PORT` already is.

Three new bearer-auth-gated routes in `apiRouter.js`, following the exact existing POST-only pattern:
`push/vapid-public-key`, `push/subscribe`, `push/unsubscribe` — mirrored on the client as
`apiPushVapidKey`/`apiPushSubscribe`/`apiPushUnsubscribe` in `apiCaller.js`.

On the client, `frontend/js/pushNotifications.js` mirrors `installPrompt.js`'s exact opt-in pattern
(single `localStorage` dismissal key, always-in-DOM `.folded` `#notifBanner`) but with one difference:
`installPrompt.js`'s `initInstallPrompt()` is only ever called once, from `app.js`'s module body, so it
wires its click listeners inline; `initPushNotifications()` is instead called from `appBoot.js`'s
`afterHome()` (best-effort, alongside `syncHome()` — needs a logged-in user and a resolved Home, since the
digest is per-Home), which re-runs on every Home switch, not just cold boot — so `pushNotifications.js`
wires its listeners once at module load instead, to stay idempotent across repeated `afterHome()` calls.
The banner only ever shows while `Notification.permission === 'default'`; once granted or denied the
browser itself won't re-prompt, so no separate suppression flag is needed. `cacheServiceWorker.js` gained
`push`/`notificationclick` listeners — both unaffected by `INTERCEPT_FETCH_REQUESTS` (that flag only gates
the existing `fetch` listener), so they work even with the service worker otherwise inert in development.

## Recipe suggestions — scaffolded, deliberately NOT wired live (paused)

Backend groundwork exists but is dormant: `backend/src/lib/itemStatus.js`'s `getDaysUntilDue()` (numeric
urgency, mirrors the frontend's `getSoonestDays()`), `backend/src/services/edamamClient.js` (a wrapper
around Edamam's Spanish-language recipe search — the one recipe API found with native Spanish ingredient
matching, so no translation step needed), `backend/src/services/recipeService.js` (picks the Home's top-3
most urgent item names and asks the client for recipes, injectable client param for test stubbing), and
the `recipes/suggestions` route in `apiRouter.js`. All of this is safe to leave in place — with no
`EDAMAM_APP_ID`/`EDAMAM_APP_KEY` set, `edamamClient.searchRecipes()` just returns `[]`, same
"missing-keys-means-silent-no-op" pattern as the VAPID push keys.

**Why it's paused**: Edamam's Recipe Search API turned out not to have a genuinely free tier ($9/mo
minimum after a 10-day trial) — this wasn't caught until after the backend was built, so the code stayed
(it's a reasonable general shape regardless of which recipe API eventually gets wired up) but the
feature was deliberately **not connected to the UI**. `frontend/js/ui/item-ui.js` has the dormant halves
(`toggleRecipeSuggestionsVisibility()`, `openRecipeSuggestions()`, the `#recipeSuggestions`/
`#recipeResults` DOM refs) and `frontend/index.html`/`frontend/css/location-chips.css` have the markup/
styling — but `fetchAndRenderItems()` does NOT call `toggleRecipeSuggestionsVisibility()` (commented out
with an explanation) and `ui.js`'s click-delegation switch has no `openRecipeSuggestions` case, so the
card can never actually become visible or reachable. To re-enable: pick a recipe source (pay for Edamam,
or swap in a free English-only one like TheMealDB — would need a translation step for Spanish item names
first), re-add the `toggleRecipeSuggestionsVisibility()` call, and add the missing `ui.js` case.

## Email sending — scaffolding only, not wired to any feature yet

Generic outbound-email capability, added ahead of any specific feature needing it (a "vencimiento hoy"
digest, a password-reset flow, etc. would all consume it later) and deliberately built to be portable —
copy the three files below into another project and they work unchanged, no fridge-track-specific
coupling. Same `create*Service`-factory/injectable-client shape as `recipeService.js`+`edamamClient.js`,
split three ways:

- `backend/src/lib/emailTemplate.js` — pure, dependency-free `renderEmailHtml({title, bodyText, appName})`.
  Turns a plain-text body into a self-contained HTML document (inline CSS only, no `<style>` block or
  external asset, since some mail clients strip/block both) with basic styling — a dark header bar, a
  white card, blank-line-separated paragraphs, single newlines as `<br>`. No template engine; unit-tested
  like the other DOM-free `lib/` modules.
- `backend/src/services/mailClient.js` — wraps `nodemailer`'s SMTP transport (not a provider-specific API
  like SES/SendGrid, so switching providers later is just env vars) behind `getMailTransport()`, memoized
  and configured lazily on first call for the same ESM-import-hoisting reason `webPushClient.js`/
  `edamamClient.js` already document — reading `process.env.SMTP_*` at module top level would always see
  `undefined`, since this module loads before `index.js`'s `configEnv()` dotenv call runs.
- `backend/src/services/emailService.js` — `createEmailService(mailClient = {getMailTransport})` exposes
  `sendEmail({to, subject, text, html?, appName?})`, auto-generating the HTML via `emailTemplate.js` unless
  the caller already supplies `html`. Unlike the push scheduler's fire-and-forget/log-and-continue calls,
  `sendEmail()` is always caller-invoked (nothing triggers it automatically yet), so it deliberately
  **rejects** on missing SMTP config or a transport failure instead of swallowing the error — the caller
  is in the best position to decide whether that should surface, retry, or be ignored.

Config lives in `backend/.env` (`SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`/`SMTP_USER`/`SMTP_PASS`/`MAIL_FROM`/
`MAIL_APP_NAME`, all optional/blank in `.env.example`) the same way `PORT`/`VAPID_*` already are. Not
wired to any route or trigger — no allocated use case yet, so nothing calls `sendEmail()` in the app. To
use it: `import { createEmailService } from './services/emailService.js'; const { sendEmail } =
createEmailService(); await sendEmail({to, subject, text})`.

## Voice dictation for adding items

A mic button on the item form ("Nombre" field) lets you dictate "Leche cantidad dos litros
vencimiento en cinco días" instead of typing — it only fills the form fields, never auto-submits,
so the user always reviews before saving. Ported from the sibling `car-track` project, which has
the identical shape of feature for its mileage form: `frontend/js/lib/speechRecognition.js`
(feature-detected Web Speech API wrapper, `isSpeechRecognitionSupported()`/`listenOnce({lang,
onResult, onError, onEnd})`, ported verbatim) and `frontend/js/lib/haptics.js` (best-effort
Vibration API tick, ported verbatim) came across unchanged. `frontend/js/lib/spanishNumbers.js`
(word/digit Spanish number parser, e.g. "veinte" or "20" → 20) was ported too, trimmed of
car-track's odometer-specific skip words — its dual digit/word handling is exactly what a
day-of-month parser needs, so it's reused as-is rather than reimplemented.

The one genuinely new piece is `frontend/js/lib/spanishItemDictation.js`'s `parseItemDictation()`:
unlike car-track's single-number mileage field, this dictates multiple fields from one utterance.
**Speech recognition produces words, not punctuation** — so segments are found by the *spoken
keywords* "cantidad"/"vencimiento" (searched by position, independently optional, order-tolerant),
not by literal semicolons/colons someone can't actually say aloud. "vencimiento en N días" fills
`shelfLifeDaysInput`; "vencimiento el D de MES" parses an absolute date (day via
`parseSpanishNumber`, month via a reverse lookup against `lib/date.js`'s exported `MONTHS` array —
reused, not duplicated) and rolls to next year if that date's already passed this year. Pure and
DOM-free, so it's unit-tested directly (`frontend/test/spanishItemDictation.test.js`) without a
browser.

`frontend/js/ui/voice-item-ui.js` mirrors car-track's `voice-mileage-ui.js` controller structure
(status states "Escuchando…"/success/error via a `data-type` attribute, haptic on listen-start,
click-to-stop while listening), but the mic button itself is built via this app's own `$button()`
helper (`lib/dom.js`) into an empty `.mic-btn` container — **not** a raw HTML div with
manually-injected SVG like car-track's `#voiceMileageBtn`, since that's the idiomatic pattern
every other icon button in this app already follows. `resetVoiceStatus()` is called from
`item-ui.js`'s `openItemForm()` (next to the existing `hideNameSuggestions()` call) so a stale
status message doesn't linger across form (re)opens.

**Testing real speech recognition in headless Chromium doesn't work** (no real
microphone/audio path) — `frontend/e2e/voice-item.spec.js` ports car-track's exact mocking
strategy instead: `page.addInitScript` replaces `window.SpeechRecognition`/`webkitSpeechRecognition`
with a `FakeSpeechRecognition` stub exposing `window.__lastSpeechRecognition`, and tests fire
`.onresult`/`.onerror`/`.onend` on it directly via `page.evaluate`.

## Per-user notification preferences (push toggle wired, email toggle not)

Two switches in the header hamburger menu (`#pushNotifToggle`/`#emailNotifToggle`, styled by the new
`css/toggle-switch.css`) let a user opt out of a channel without uninstalling anything. Before this,
"is push on" was purely implicit - the presence of a `push_subscriptions` row - with no way to say "stop
sending to me" short of the client unsubscribing outright. Migration `004_notification_preferences.js`
adds `push_enabled`/`email_enabled` columns directly on `users` (`ALTER TABLE`, same shape as migration
`003`'s `locations.category` - a simple per-row flag, not worth a separate table), both `DEFAULT 1` so
every already-push-subscribed user keeps getting notified after this ships without having to
re-opt-in. `authService.js`'s `updateNotificationPreferences(userId, {pushEnabled?, emailEnabled?})`
updates only the field(s) given; `getUserBySessionToken()`/`signup`/`login` all now return
`pushEnabled`/`emailEnabled` alongside the rest of the user shape, and `apiRouter.js` gained a matching
`notifications/preferences` route.

**Push is actually gated by this flag; email has nowhere to plug into yet.** `pushService.js`'s
`listAllSubscriptionsGroupedByUser()` - the scheduler's only entry point into "who to notify" - now
joins against `users` and filters `WHERE users.push_enabled = 1`, so a disabled user is excluded at the
source; `expiryNotifier.js` itself needed no changes. The email toggle has no such consumer to gate -
same "scaffolded, not wired" state as `emailService.js` itself - so right now it only ever persists a
preference nobody reads yet; wiring an actual email trigger later just needs to check it.

**Disabling push does not unsubscribe the browser.** Turning the toggle off only flips the backend flag;
the client keeps whatever `push_subscriptions` row it already has, so re-enabling later doesn't need to
re-request permission or generate a new endpoint (`Notification.requestPermission()`/
`pushManager.subscribe()` are both idempotent no-ops when permission/subscription already exist).
Enabling routes through the exact same flow as the existing opt-in banner -
`pushNotifications.js`'s `subscribe()` (now also exported as `subscribeToPush`, and changed to return a
`boolean` instead of assuming a banner is always the caller) - so a previously-denied browser permission
correctly fails closed: the toggle snaps back off and a toast explains why, without ever calling the
preferences API (nothing to persist if the subscribe attempt didn't actually succeed).

**The push checkbox's displayed state is deliberately NOT just the stored `pushEnabled` preference.**
A fresh signup defaults `pushEnabled` to `true` (matches the column's own `DEFAULT 1`) despite having no
subscription yet, and a denied/revoked browser permission doesn't touch that stored value either - so
reading the preference alone would show the toggle ON for a user who will never actually receive
anything. `pushNotifications.js`'s `hasActiveSubscription()` (checks `Notification.permission` plus an
actual `pushManager.getSubscription()`) supplies the other half; `ui.js`'s
`computePushToggleChecked()` is `pushEnabled && hasActiveSubscription()`, and `refreshPushToggleState()`
re-runs it every time the header menu opens (`toggleHeaderMenu()`), not just once at boot - browser
permission can change underneath the app (revoked/granted via browser site settings) with no event to
notify the page when it does. The email toggle has no such split - no subscription concept applies to it
- so it renders straight from the stored preference (`apiCaller.js`'s `getNotificationPreferences()`,
cached in `localStorage` alongside the rest of the session, defaulting true if absent so a session
cached before this feature shipped still renders as "on").

`frontend/e2e/notification-toggles.spec.js` covers: email's default-on and reload-persistence; push
defaulting OFF for a fresh signup (no subscription yet, despite `pushEnabled` being `true`
server-side); the permission-denied revert path; and a full successful-subscribe path that stays
checked across a menu close/reopen. All push scenarios mock `Notification.requestPermission` *and* the
separate `Notification.permission` read-only property (the same class of substitution
`voice-item.spec.js` uses for Web Speech), plus `registration.pushManager.subscribe`/`getSubscription`
directly on the real service-worker registration this app already registers - `getSubscription()` only
starts returning a fake subscription after the mocked `subscribe()` has actually been called, so the
"before" state in each test is a genuinely-unsubscribed device, not a pre-faked one. Two mistakes worth
not repeating: Playwright's `.check()` silently no-ops if the box is already checked, and separately
*throws* if a click doesn't leave the box checked - so proving a checked box reverts to unchecked needs
a plain `.click()`, not `.check()`. Also, `frontend/e2e/globalTeardown.js` needed `push_subscriptions`/
`push_notification_log` added to its per-run cleanup once a test started creating real subscription rows
for the first time - without that, deleting a swept-up test `users` row hit a FOREIGN KEY constraint.

## Product feature ideas (not yet scoped)

Raised during a "what would make this more useful/sellable" discussion; expiry push notifications and
waste stats (both above) were picked to build first. Recipe suggestions (also above) got as far as a
paused/scaffolded backend before hitting a cost blocker. Still just a recorded idea, not designed:

- **Shopping list**, seeded from items marked discarded/used-up — closes the loop between "this went bad"
  and "don't over-buy it again," which the app doesn't do anything with today.
- **Barcode scanning** for quick-add (camera + a barcode→product lookup) — the most "modern app" feeling
  feature, but a real lift (camera API + an external product database) and more differentiating than
  essential.
