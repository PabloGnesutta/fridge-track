# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
Feature-specific detail has been split into `.claude/rules/*.md`, each scoped via `paths:` frontmatter so
it only loads when you're actually touching the files it covers — see the index at the bottom of this file.

## Commands

The repo has two independent npm projects; there is no root-level package.json or build step.

**Requires Node ≥24** (`backend/package.json`'s `engines`) — the backend's auth/Home API is built on the
built-in `node:sqlite` module, unflagged from Node 24 on. Use `nvm install 24 && nvm use 24` (this repo
was built against 24.19.0 via `nvm4w` on Windows) if your global Node is older.

**Backend (`backend/`)** — serves the frontend and hosts the accounts/Home API (see Architecture below):
```
npm run serve          # nodemon on src/index.fridge.js, reads PORT from backend/.env (currently 3001)
npm test                # unit tests: node --test (backend/test/*.test.js) - service-layer logic only
```
`backend/.env` also needs `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` for push notifications
(see `.claude/rules/push-notifications.md`) — generate a keypair once via `npx web-push generate-vapid-keys`.

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
`backend/src/http/requestHandler.js` routes `/api/*` to `backend/src/http/apiRouter.js`, and otherwise
serves static files (`/`, `css/*`, `js/*`, `static/*`, `cacheServiceWorker.js`) plus an SPA fallback: any
request whose last path segment has no `.` in it is served `index.html`, so client-side routes like
`/item/42` survive a hard refresh (see `.claude/rules/routing.md`). Data (`users`/`homes`/`home_members`/
`sessions`/`locations`/`items`/`food_name_history`/...) lives in a `node:sqlite` file at
`backend/data/fridgetrack.db` (gitignored, created on first run) via `backend/src/db/db.js`;
`backend/src/services/authService.js` and `homeService.js` hold the actual logic (password hashing via
`node:crypto` `scrypt`, opaque bearer session tokens, join-code generation/lookup) and are structured as
`create*Service(db)` factories specifically so tests can inject an isolated `:memory:` database instead
of touching the real data file. Schema changes go through migrations — see `.claude/rules/db-migrations.md`.

**Locations, items, and food-name history live in IndexedDB on the client, synced to the backend**
(`js/lib/indexedDb.js` + `js/local-db/*.js` locally; `backend/src/services/syncService.js` +
`frontend/js/sync/syncEngine.js` remotely — see `.claude/rules/sync-engine.md` for the full mechanism).
The backend's accounts/Home API additionally handles *who you are* and *which Home you belong to*
(see `.claude/rules/app-boot.md` for the login/Home-gating boot sequence).
`frontend/js/api-caller/apiCaller.js` is the real client for the whole API surface
(`apiSignup`/`apiLogin`/`apiCreateHome`/`apiJoinHome`/`apiListHomes`/`apiSyncPull`/`apiSyncPush`/...),
always POSTs to `api/<path>` with a `Bearer` token from `localStorage`, and always resolves `{data}` or
`{error}` — network failures resolve `{error}` rather than throwing, so callers can fall back to the
local cache instead of crashing when offline.

**View state drives the DOM through CSS attribute selectors, not JS show/hide calls.**
`js/common/state.js` holds `appState`/`dataState`/`dbStore` in memory and mirrors fields (e.g.
`currentView`, `showItemForm`) onto `#app`'s `dataset`. `css/style.css` then does the actual
showing/hiding via selectors like `#app[data-show-item-form='true'] .modal`. When adding new UI
state, follow this pattern (`setStateField`/`setCurrentView` in state.js) rather than toggling
classes/display directly.

**Unit tests only cover DOM-free modules.** `js/lib/dom.js` and `js/lib/logger.js` run DOM queries
(`document.getElementById`, etc.) at module top level, so importing anything that transitively pulls
them in crashes under plain Node. `frontend/test/` therefore only targets modules with no such
dependency (`lib/date.js`, `lib/string.js`, `lib/freshnessStatus.js`, `common/routeMatch.js`, etc.).
UI-level behavior is covered by the Playwright e2e suite instead, where every test gets a fresh browser
context (empty IndexedDB, no cached session) but **not** a fresh backend — the sqlite file persists
across test runs, so `e2e/helpers.js`'s `ensureAuth()` always signs up a freshly-generated unique email
rather than relying on a clean DB for isolation, and `ensureHome()` always creates a new Home (the real
isolation boundary for locations/items now). `ensureOnboarded()` chains `ensureAuth` + `ensureHome` +
`ensureLocation` for specs that don't care about the auth/Home screens themselves.

**Two error-reporting paths, used deliberately for different cases.** `_error()`
(`js/lib/logger.js`) opens the in-app dev-facing debug log panel (`#logger`) — for unexpected/internal
errors (IndexedDB failures, service worker registration failures, uncaught exceptions/rejections).
`showErrorToast()` (`js/lib/toast.js`) shows a self-dismissing toast instead — for user-actionable
messages (validation errors from `local-db/*.js`, "item not found"). Keep this split for new error
paths rather than routing everything through one or the other.

All user-facing strings are Spanish (e.g. "Ingresar nombre", "Alimentos").

## Product feature ideas (not yet scoped)

Raised during a "what would make this more useful/sellable" discussion; expiry push notifications and
waste stats were picked to build first (see `.claude/rules/push-notifications.md` and
`.claude/rules/food-name-history.md`). Recipe suggestions got as far as a paused/scaffolded backend
before hitting a cost blocker (`.claude/rules/recipe-suggestions.md`). Still just recorded ideas, not
designed:

- **Shopping list**, seeded from items marked discarded/used-up — closes the loop between "this went bad"
  and "don't over-buy it again," which the app doesn't do anything with today.
- **Barcode scanning** for quick-add (camera + a barcode→product lookup) — the most "modern app" feeling
  feature, but a real lift (camera API + an external product database) and more differentiating than
  essential.

## Rules index (`.claude/rules/`)

Each file below loads only when you're reading/editing a file under its `paths:` glob:

- `db-migrations.md` — migration system, "never edit a shipped migration," recreate-table pattern
- `sync-engine.md` — IndexedDB↔backend sync, LWW merge, tombstones, sign-out "fresh start"
- `app-boot.md` — login/Home gating boot sequence, the appBoot.js↔home-ui.js circular import
- `routing.md` — client-side routing, boot-order/URL-capture, root-relative asset paths
- `service-worker-caching.md` — cache-first PWA caching, cacheVersion pre-commit hook, update banner
- `header-menu-logging.md` — hamburger menu, backend/frontend logger design
- `ui-ux-overhaul.md` — tab bar, modal fade, swipe-to-act, keyboard-activatable buttons, confirm dialog
- `food-name-history.md` — category scoping, editing/renaming/deleting entries, waste/usage stats
- `push-notifications.md` — expiry digest scheduler, VAPID, admin failure alerts
- `recipe-suggestions.md` — paused/scaffolded Edamam integration
- `email-sending.md` — scaffolded SMTP email capability, not yet wired to a feature
- `voice-dictation.md` — mic-button item dictation, Spanish parsing, e2e mocking strategy
- `notification-preferences.md` — per-user push/email opt-out toggles
