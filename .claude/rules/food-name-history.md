---
paths:
  - "frontend/js/local-db/food-name-db.js"
  - "frontend/js/ui/food-history-ui.js"
  - "backend/src/db/migrations/005*"
  - "backend/src/db/migrations/006*"
---

# food_name_history

**Scoped per-Home, shared across that Home's locations.** `js/local-db/food-name-db.js` is a third
IndexedDB store that back-fills name autocomplete (`item-ui.js`'s `.name-suggestions` dropdown) and the
`/historial` view (`food-history-ui.js`). It's written to in three places: `recordItemCreated()` on item
*creation* (not edit) upserts the name + refreshes `shelfLifeDays` (only ever set from
shelfLifeDays-based items, never touched by due-date-based ones); `adjustDiscardCount()` on
`markItemDiscarded` (±1, reversed on undo) — "Usado" and the trash-icon delete don't count as a discard;
`adjustUsedCount()` bumps a `timesUsed` counter from `removeItem(item, ..., { used: true })`, mirroring
`adjustDiscardCount()`'s `{ discarded: true }` path exactly, undo included. `/historial`'s
`renderHistoryStats()` sums both counters across every entry and shows an all-time "N% aprovechado — X
usado(s), Y tirado(s))" line, hidden while both totals are zero. Adding a new IndexedDB store, or a new
index on an existing one, means bumping `dbVersion` in `indexedDb.js` and creating/altering it in
`onDbUpgradeNeeded`; adding an index to a store that *already exists* can't go through
`createObjectStore` again — pull the store off the in-flight versionchange transaction instead
(`openDbRequest.transaction.objectStore(name)`), guarded by `indexNames.contains`, the same way new
stores are guarded by `objectStoreNames.contains`.

## Scoped by location category, not just by Home

Originally shared across every location in a Home - meaning a `locations.category` of `'medicamento'`
had no effect on autocomplete/shelf-life history at all: adding "Aspirina" in a medicine cabinet would
pollute food autocomplete, and two same-named-but-unrelated items across categories shared one shelf-life
default. Migration `005_food_name_history_category.js` adds a `category` column and widens the primary
key from `(home_id, normalized_name)` to `(home_id, category, normalized_name)` - a real recreate-table
migration (see `.claude/rules/db-migrations.md`), backfilled to `category = 'alimento'` since every row
that existed before this migration predates location categories entirely.

**Every place that used to identify a record by `(homeId, normalizedName)` now needs `category` as a
third component of that identity** - `food-name-db.js`'s `recordItemCreated()`/`adjustDiscardCount()`/
`adjustUsedCount()` (all take a `category` param, building a 3-part IndexedDB key), `sync/syncEngine.js`'s
`mergeFoodNameHistory()` (3-part key) and `buildLocalSnapshot()` (adds `category` to the wire shape), and
`syncService.js`'s `pushFoodNameHistory()` (3-column `WHERE`/`INSERT`) — see `.claude/rules/sync-engine.md`.
`item-ui.js`'s three call sites already had `location.category` in scope - just one more argument
threaded through. The `.name-suggestions` autocomplete filter matches on
`(entry.category || 'alimento') === (dataState.currentLocation?.category || 'alimento')` - the
`|| 'alimento'` default reads a record written before this field existed as food, same assumption as the
SQL backfill, just applied client-side.

**No client-side (IndexedDB) migration was written on purpose** - made explicitly because this app
currently has exactly one real user. Every local record written before this shipped is still keyed
`[homeId, normalizedName]` (2 parts); the new code only ever looks things up by the 3-part key, so those
old records go quietly unreachable rather than being actively re-keyed. They self-heal the next time
`afterHome()`'s `syncHome()` runs (every boot/Home switch already pulls a fresh, correctly-keyed snapshot
from the backend), at the cost of a possible one-session "history looks empty" blip on a device offline
exactly when this shipped - judged not worth a cursor-based IndexedDB re-keying migration for a
single-user app. Revisit this if this app ever gets more than a couple of users.

**`/historial` has one tab per `locationCategory.js`'s `LOCATION_CATEGORIES`** instead of one flat, mixed
list. `food-history-ui.js` fetches the Home's full entry set once per `openFoodHistory()` call
(`allEntries`, module state) and re-filters it locally on every tab switch (`switchHistoryCategory()`,
wired through `ui.js`'s `data-click-action` delegation switch, same pattern `renderLocationChips()`'s
chips already use) - no re-fetch per tab. The default selected tab is whichever category the user's
current location has, not always `'alimento'`. The tabs (`.history-category-tab`) deliberately don't
reuse `.location-chip`'s class even though they copy its exact visual language - see
`.claude/rules/ui-ux-overhaul.md` for why (same reasoning as the confirm dialog's separate-class choice).

## Editing and deleting entries

Added because a typo in a history entry's name would otherwise sit in autocomplete forever - the whole
table was previously write-only from the app's perspective: upserted on item creation, adjusted on
use/discard, never directly edited or removed by a person.

**Delete gives `food_name_history` a tombstone for the first time.** Migration
`006_food_name_history_deleted_at.js` adds `deleted_at` - a plain `ALTER TABLE ADD COLUMN` this time
(unlike migration `005`), since it isn't part of the primary key. `deleteFoodNameHistory()` soft-deletes
exactly like items/locations already do (set `deletedAt`, bump `updatedAt`, keep the row so the tombstone
propagates through sync); `fetchFoodNameHistory()` now filters `deletedAt == null` client-side. Deleting
doesn't touch `dbStore` or trigger sync itself - callers re-fetch afterward, since edit/delete are
infrequent, deliberate user actions on `/historial` rather than a hot path like item creation.

**Renaming moves the record to a new key, it doesn't update in place** - `normalizedName` is *derived*
from `name` and is part of the `[homeId, category, normalizedName]` key, so a real typo fix changes the
record's identity. `updateFoodNameHistory()` checks whether the new name's normalized form actually
differs first: if not, it's a trivial in-place field update; if it does, it tombstones the old key and
creates a new record at the new one, carrying over `firstCreatedAt`/`timesDiscarded`/`timesUsed` -
reusing the tombstone mechanism delete just added. **Collisions are blocked, not merged or silently
overwritten**: if the new key already matches another still-live entry, `updateFoodNameHistory()` returns
`{ok: false, error}` instead of touching anything - combining two names' accumulated history is a bigger,
unrequested decision than a rename should make on its own. None of this needed any sync-engine changes
beyond the `deletedAt` field itself - a rename is just two ordinary pushed records (one tombstoned, one
new), no special "move" handling required.

**A tombstoned entry is "nonexistent" to `recordItemCreated()`, not resurrectable.** Creating a new item
under a name whose history was explicitly deleted starts a genuinely fresh record (reset counts, new
`firstCreatedAt`) rather than quietly reviving the old counts - deleting was a deliberate "forget this"
action. `adjustDiscardCount()`/`adjustUsedCount()` treat a tombstoned entry as absent too (no-op), for the
same reason in the other direction.

**UI**: `/historial` rows get a pencil + trash icon (`food-history-ui.js`'s `buildHistoryRow()`, styled in
`css/btn.css` as `.history-row-actions`) - the trash opens `showConfirmDialog()`; the pencil opens a
small new form (`#foodNameHistoryForm`, name + shelf-life-days) reusing the shared-modal/state-flag
pattern as `locationForm`/`itemForm` (`showFoodNameHistoryForm` in `state.js`). Only name and
shelf-life-days are editable - not the category, since that's a property of *where* an item was added
(the location), not something a history entry should redefine on its own.
