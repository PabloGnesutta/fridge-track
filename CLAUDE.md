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

## Product feature ideas (not yet scoped)

Raised during a "what would make this more useful/sellable" discussion; expiry push notifications and
waste stats (both above) were picked to build first. Still just recorded ideas, not designed:

- **Shopping list**, seeded from items marked discarded/used-up — closes the loop between "this went bad"
  and "don't over-buy it again," which the app doesn't do anything with today.
- **Barcode scanning** for quick-add (camera + a barcode→product lookup) — the most "modern app" feeling
  feature, but a real lift (camera API + an external product database) and more differentiating than
  essential.
- **Recipe suggestions** from what's expiring soon (e.g. "chicken + spinach expiring — here's a recipe"),
  via a third-party recipe API. High delight, but a stretch feature, not core.
