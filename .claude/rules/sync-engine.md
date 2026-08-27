---
paths:
  - "frontend/js/sync/**"
  - "frontend/js/local-db/**"
  - "backend/src/services/syncService.js"
---

# Sync engine (online-persistence Phase 2)

Locations, items, and food-name history sync between IndexedDB and the backend, on top of the Phase-1
accounts/Homes API and the client-generated-UUID groundwork it laid (`js/lib/id.js`). The baseline schema
(migration `001_initial_schema`) gained matching `locations`/`items`/`food_name_history` tables —
`TEXT PRIMARY KEY` UUIDs supplied by the client (a first for this backend; every other table is
`INTEGER PRIMARY KEY AUTOINCREMENT`), plus an `updated_at` column on every row and a nullable
`deleted_at` tombstone column on `locations`/`items` (never on `food_name_history`, which is only ever
upserted, never hard-deleted — see `.claude/rules/food-name-history.md` for its own later-added tombstone).
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
**The only sync trigger is `appBoot.js`'s `afterHome()`** (see `.claude/rules/app-boot.md`), best-effort
(`try {} catch {}`) before the existing `fetchLocations`/`fetchFoodNameHistory` calls — since `afterHome`
runs on both cold boot and every Home switch, this covers both without a second trigger. There is
deliberately **no push-after-every-mutation**: a change made on one device only becomes visible on
another the next time that other device reloads or switches Homes.

Because sync needs tombstones to propagate deletes, `deleteItem`/`deleteLocationAndItems` (in
`js/local-db/item-db.js`/`location-db.js`) no longer hard-delete — they set a `deletedAt`/bump `updatedAt`
and `putOne` the record back, and every read path that lists records (`fetchItems`,
`countItemsByStatus`, `fetchLocations`) filters `deletedAt == null` client-side (no IndexedDB index for
it — cheap enough at household scale, revisit if item counts ever grow large). `restoreItem` (the
undo-toast path) clears `deletedAt` again rather than re-inserting a removed record. `FoodNameHistory`
gained an `updatedAt` field for the same LWW purpose (bumped on every `recordItemCreated`/
`adjustDiscardCount`, not just when a value actually changes).

**Still deliberately deferred** to a follow-up phase:
- A true offline mutation outbox/queue with retry-on-reconnect — this sync is best-effort/fire-once, not
  durable across a failed push (nothing is lost locally, but a failed sync simply waits for the next
  boot/Home-switch to try again).
- A user-facing offline/online mode toggle - real service-worker caching is in place (see
  `.claude/rules/service-worker-caching.md`), but there's still no UI telling a user they're
  offline/what that means for the app.
- Tombstone pruning/GC — deleted rows are kept forever server-side; fine at this scale, not yet an issue.

**A real production incident traced a sync gap back to `apiCaller.js`'s `fetch()` using a relative
URL** (`'api/' + path`) instead of root-relative (`'/api/' + path`) — from a client-side route like
`/item/42` (exactly where the "Usado" button lives), that resolved to `/item/api/sync/push` instead of
`/api/sync/push`, which the backend's router doesn't recognize as an API path, so it silently served the
SPA-fallback `index.html` (`200 OK`, wrong body) instead of a real response or error. Same class of
relative-vs-root-relative gotcha this repo already documents for `<script src>`/`<link href>` tags (see
`.claude/rules/routing.md`), just missed for the API caller itself — fixed now. The investigation is also
why `syncHome()`'s push/pull failures and `scheduleItemSync()`'s "no local location found" case now log
via `_error()` (auto-opens the debug panel) rather than being silently swallowed or logged via `_warn`
(invisible with no manual way to open the panel — see `.claude/rules/header-menu-logging.md`) — a failed
sync used to leave zero trace anywhere, which is exactly what made this bug so hard to pin down on a real
device with no devtools access.

**Sign-out offers a "fresh start" escape hatch.** After the existing "¿Seguro que querés cerrar sesión?"
confirmation and the actual sign-out, a *second*, separate dialog asks whether to also wipe this
device's entire local IndexedDB cache (`js/lib/indexedDb.js`'s `clearAllData()` — closes the existing
connection first, since `deleteDatabase()` blocks/hangs otherwise, then the caller reloads the page).
It's deliberately a second dialog, not folded into the first: by that point sign-out has already
happened either way, so "cancel" here just means "leave the cache alone," not "undo the sign-out." Not
part of normal logout by default — `logout()` in `appBoot.js` still deliberately leaves IndexedDB alone
on its own, so a device keeps working offline and a repeat login doesn't need a full network round-trip.
This is purely a manual recovery option for a device stuck showing stale data.
