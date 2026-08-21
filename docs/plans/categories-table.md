# Categories as a first-class database table

**Status**: planned, not started. Written after a session that added free-text custom
categories (`frontend/js/lib/locationCategory.js`'s `getKnownCategories`/`<input list>` datalist
in the location form) and then found that renaming a location's category doesn't propagate to
its history - see Context below. Picking this up in a later session should start by re-reading
this file in full before touching code.

## Context

`category` currently lives as a plain `TEXT` string copied onto both `locations.category` and (at
item-creation time) `food_name_history.category` - there's no shared entity behind it, just
coincidentally-matching text. This surfaced as a real problem: editing a location's category does
**not** propagate to its history. `food_name_history` rows stay filed under whatever category
string was in effect when each item was created, so recategorizing a location silently orphans
older entries - `adjustUsedCount`/`adjustDiscardCount` become no-ops for them (the functions only
update existing rows, never create one), and they vanish from autocomplete in that location.

The fix: give categories their own table, with `locations` and `food_name_history` referencing a
`category_id` instead of copying a string. A rename then becomes a single `UPDATE categories`,
propagating everywhere automatically - turning "rename" into the well-defined, safe operation it
isn't today.

This also un-does the free-text `<input list>` category field added earlier in the same session
(a quick fix at the time) in favor of a real picker backed by actual records, and adds a small
"Categorías" management section to the Hogar page (`/hogar`, built earlier in the same session)
as the place to actually trigger a rename or delete.

**Scope note**: this is a genuinely bigger change than most features in this codebase - a new
synced entity end-to-end, two recreate-table migrations, plus a UI surface for managing it.
Proportionate to what was asked, but worth being deliberate rather than rushing every corner.

## Backend: 4 new migrations

Following the existing `NNN_description.js` pattern (`backend/src/db/migrations/`, registered in
`migrations/index.js`'s explicit array) and the recreate-table technique migration
`005_food_name_history_category.js` already established (`RENAME TO x_old` → `CREATE TABLE` new
shape → `INSERT ... SELECT` backfill → `DROP TABLE x_old`).

**Critical correctness point**: every existing `locations.category`/`food_name_history.category`
value on disk is the raw lowercase slug (`'alimento'`/`'medicamento'`/`'otro'`), not the display
label (`'Alimentos'`/etc. - those only exist in `frontend/js/lib/locationCategory.js`'s
`LOCATION_CATEGORIES`). The seed step **must** insert categories using the raw slugs, or the
backfill JOINs in migrations 2-3 will fail to match on every single existing row (silent data loss
via `INNER JOIN`, or a boot-crashing constraint violation via a `NOT NULL` column with no match).
The cosmetic rename to nice labels happens in a **separate, later** migration, after the
slug-based backfill has already resolved every `category_id`.

1. **`007_categories_table.js`**
   ```sql
   CREATE TABLE categories (
     id TEXT PRIMARY KEY,
     home_id INTEGER NOT NULL REFERENCES homes(id),
     name TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     deleted_at INTEGER
   );
   ```
   Seed the 3 built-ins **using the raw slugs** (`'alimento'`, `'medicamento'`, `'otro'`) for every
   existing home, id via `lower(hex(randomblob(16)))` (a valid unique opaque string - not
   RFC4122-dashed like `crypto.randomUUID()`, but nothing in the codebase validates UUID shape, so
   this cosmetic mismatch is fine). Then seed any *additional* distinct `(home_id, category)`
   pairs currently in use by either `locations` or `food_name_history` that aren't one of the 3
   built-ins (a `NOT EXISTS`-guarded insert from a `UNION` of both tables' distinct category
   strings) - needed because a `food_name_history` entry can reference a category string with zero
   currently-active locations.

2. **`008_locations_category_id.js`** - recreate-table widening `locations.category` (string) →
   `locations.category_id` (`TEXT NOT NULL REFERENCES categories(id)`), backfilled via a plain
   `JOIN categories ON categories.home_id = locations.home_id AND categories.name =
   locations.category` (safe now - comparing identical raw-slug strings). **Set `updated_at =
   strftime('%s','now')*1000` for every backfilled row** (deliberately not preserving the original
   timestamp, unlike migration 005) - this is what lets the existing last-write-wins sync logic
   (`lwwMerge.js`'s `remoteWins`, strict `>` comparison) naturally overwrite any client's stale
   local copy on its next pull, with zero new client-side reconciliation code. Document this
   deviation inline, same convention as the rest of this migration series explaining *why*.

3. **`009_food_name_history_category_id.js`** - same recreate-table pattern, widening
   `food_name_history`'s primary key from `(home_id, category, normalized_name)` to `(home_id,
   category_id, normalized_name)`, backfilled the same way.

4. **`010_categories_builtin_labels.js`** - purely cosmetic, runs last: `UPDATE categories SET
   name = 'Alimentos' WHERE name = 'alimento'` (×3 for the built-ins). Safe only because it runs
   after 008/009 have already resolved every `category_id` off the raw slug.

Going forward, `homeService.js`'s `createHome()` seeds the 3 built-in rows directly with the nice
labels (using `node:crypto`'s `randomUUID()`, real JS this time) - migrations 007/010 only
backfill homes that existed before this shipped.

## Backend: `syncService.js`

No new service file - mirror how `locations`/`items`/`food_name_history` already have their
row-mapping functions living directly in this file (`locationFromRow`, `pushLocation`, etc.), not
a separate `*Service.js`. Add:
- `categoryFromRow`/`pushCategory`, same shape as `locationFromRow`/`pushLocation`.
- `categories` added to `pullHomeSnapshot`'s return shape and `pushHomeSnapshot`'s handling
  (`apiRouter.js` needs no changes - `sync/push`/`sync/pull` already pass `body.snapshot` through
  with no field allow-listing).
- **A shared `resolveCategoryId(db, homeId, categoryId, legacyCategoryName)` helper**, used by
  both `pushLocation` and `pushFoodNameHistory`: if `categoryId` is present, use it; otherwise
  resolve `legacyCategoryName` via `SELECT id FROM categories WHERE home_id = ? AND name = ?`; if
  that also fails to match (should be effectively unreachable given migration 007's seeding, but
  defensive), fall back to that home's `'Alimentos'` row. This is the **only** place string→id
  resolution logic lives - no client-side name-matching needed (see sync engine section below for
  why).

## Frontend: `dbStore` + IndexedDB

- `frontend/js/common/state.js`: add `categories: []` to `dbStore`.
- `frontend/js/lib/indexedDb.js`: new `categories` object store (client-UUID keyed like
  `locations`, `homeId` index - same guarded-creation idiom already used for `foodNameHistory`:
  check `objectStoreNames.contains` before create, `indexNames.contains('homeId')` before
  `createIndex`). Bump `dbVersion` 4 → 5.

## Frontend: new `local-db/category-db.js`

Mirrors `location-db.js`'s shape:
- `fetchCategories(homeId)` - like `fetchLocations`, filters `deletedAt == null`, populates
  `dbStore.categories`.
- `createCategory(name, homeId, date)` - `generateId()` (`lib/id.js`), `putOne`, push to
  `dbStore.categories`. No separate sync trigger needed: when called from the location form's
  submit handler *before* `createLocation()`, the existing `scheduleLocationSync()` fire-and-forget
  call (already triggered by `createLocation`) picks up the new category in the same
  `buildLocalSnapshot()` pass, since `categories` becomes a 4th store read there.
- `renameCategory(category, newName, date)` - updates `name`/`updatedAt` in place (no re-keying
  needed, since the category's `_key`/id never changes - unlike the old `food_name_history`
  string-keyed rename, this is now just an ordinary field edit). Triggers `scheduleLocationSync`
  (reuse, no new sync trigger function).
- `deleteCategory(category)` - soft-delete (tombstone), but **blocked** (error toast, mirroring
  `updateFoodNameHistory`'s existing "blocked, not merged" precedent) if any non-tombstoned
  `dbStore.locations` **or** `dbStore.foodNameHistory` entry still references that `categoryId` -
  checking only locations would reopen the exact orphaning bug this refactor exists to fix, since
  food-name-history can reference a category with zero active locations.
- `getCategoryName(categoryId)` - small helper (`dbStore.categories.find(c => c._key ===
  categoryId)?.name || 'Alimentos'`), replaces `locationCategory.js`'s `getCategoryLabel` at its 2
  remaining call sites (`item-ui.js:309` and `:478`, both `pageTitle.innerText =
  getCategoryLabel(...)`).

`frontend/js/lib/locationCategory.js` (`LOCATION_CATEGORIES`, `getCategoryLabel`,
`getKnownCategories`) gets deleted - `LOCATION_CATEGORIES`'s only remaining purpose (the 3
built-in seed names) moves to being implicit in the migration/`homeService.js` seed logic.
`frontend/test/locationCategory.test.js` gets deleted with it.

## Frontend: location form UI

`Location.category` (string) → `Location.categoryId`. `createLocation`/`updateLocation`
(`location-db.js`) take `categoryId` as a required param - no default fallback string, since the
UI always resolves a real id now.

The free-text `<input list>` datalist (added earlier this session) is replaced with a real
`<select name="locationCategory">` populated from `dbStore.categories`, plus a trailing `+ Nueva
categoría` option that reveals a small text input for typing a brand-new name - this is genuinely
new UI (there's no exact existing template to copy; `home-ui.js`'s create/join toggle is a full
two-section mode switch, not a select-with-reveal, though it's the closest thing in spirit). On
submit: if "new category" was chosen, call `createCategory()` first and use its id; otherwise use
the selected option's value directly.

**Edge case to guard**: if a device's very first `syncHome()` pull after Home creation hasn't
landed yet (e.g. a network drop right after the online-required `createHome()` call),
`dbStore.categories` could be empty when onboarding's `openLocationForm(true)` needs it - unlike
today's `LOCATION_CATEGORIES`, which is always available as a hardcoded fallback. Keep a small
hardcoded 3-entry fallback list (just for populating the `<select>` when `dbStore.categories` is
empty) so onboarding never shows nothing but "+ Nueva categoría".

## Frontend: `food-name-db.js` + call sites

- Every function's `category` string param becomes `categoryId`; the compound IndexedDB key
  becomes `[homeId, categoryId, normalizedName]`.
- `item-ui.js`'s 5 write-threading call sites (`recordItemCreated`, `adjustDiscardCount`×2,
  `adjustUsedCount`×2) pass `location.categoryId` instead of `location.category`.
- `food-history-ui.js`: category tabs currently derived from `getKnownCategories(dbStore.locations)`
  (this session's helper, now deleted) become a direct read of `dbStore.categories` (fetched via
  `fetchCategories(homeId)`, added to `appBoot.js`'s `afterHome()` alongside the existing
  `fetchLocations`/`fetchFoodNameHistory` calls). `entryCategory(entry)` returns `entry.categoryId`;
  tab click state becomes `selectedCategoryId`.

## Frontend: `sync/syncEngine.js`

- Add `categories` as a 4th synced entity: `buildLocalSnapshot` reads `getAllWithIndex('categories',
  'homeId', homeId)` and maps it (mirroring `locations`'s exact shape); a new `mergeCategory(pulled)`
  mirrors `mergeLocation` exactly (`remoteWins` + `putOne`) - genuinely boring, no special-casing.
- `locations`: **no legacy-cleanup logic needed**. A pre-existing local location just has a stale
  `category` field and missing `categoryId` - since migration 008 bumps `updated_at` on every
  backfilled row, the next pull's `remoteWins` check naturally wins the tie and overwrites the
  local copy via the existing, unmodified `mergeLocation`. If a location somehow reaches
  `pushLocation` with only the legacy string (never-synced-before device), the backend's
  `resolveCategoryId` fallback handles it server-side.
- `food_name_history`: **does** need cleanup, extending the *already-built* legacy-key mechanism
  from earlier this session (currently: local records missing `category` entirely get pushed with
  a defaulted value, then deleted from IndexedDB once their data round-trips under the new key).
  Widen that same filter/cleanup pass to also catch records that have a `category` string but no
  `categoryId` yet: include them in the push (send `category` string as a fallback field when
  `categoryId` is absent, letting the backend's `resolveCategoryId` resolve it - no client-side
  name matching), collect their old string-based key alongside the existing legacy-key list, and
  delete them locally once the pull confirms the new `categoryId`-keyed twin exists. One unified
  mechanism handling both historical key-shape transitions, not two parallel ones.

## Frontend: Hogar page - categories management

Add a small "Categorías" section to `#homeView` (the Hogar page built earlier this session),
listing each of the current Home's categories with pencil/trash row-action icons - mirroring
`food-history-ui.js`'s `buildHistoryRow()` pattern exactly (`pen_solid`/`svg_trash`,
`showConfirmDialog` for delete, a tiny rename-only form reusing the shared-modal/state-flag
convention like `showFoodNameHistoryForm`). This is the actual surface a user renames or deletes a
category from - without it, the whole point of this refactor (rename propagates) has no way to be
triggered.

## Tests

- **Backend**: `backend/test/syncService.test.js`'s existing category round-trip assertions
  (`location category round-trips through push/pull`, `food_name_history entry with no category
  defaults to alimento`) need rewriting for `categoryId`. Add coverage for
  `homeService.test.js`'s `createHome()` built-in-category seeding. **Add a dedicated migration
  test** that seeds a pre-migration-shaped DB (raw `locations.category` strings, no `categories`
  table - reproducing the exact slug/label mismatch caught during planning) and asserts every row
  survives migrations 007→010 with a correctly resolved `category_id` - this is exactly the kind
  of test that would have caught that bug before it shipped.
- **Frontend**: `frontend/e2e/food-history-category.spec.js` (already updated once this session
  for the free-text input) needs updating again to use `page.selectOption` against the new real
  `<select>`. No new DOM-free unit tests expected - category CRUD is IndexedDB-coupled like
  `location-db.js` already is, outside this codebase's "DOM-free modules only" unit-test
  convention.

## Verification

1. `cd backend && npm test` / `cd frontend && npm test` - all existing + new/updated tests pass.
2. Run the migration chain against a copy of the real dev DB (not just the empty in-memory DB
   `migrate.test.js` already covers) to confirm the slug-backfill actually resolves every existing
   row, including any custom categories created during this session's testing (e.g. the
   "Congelador" test categories).
3. `npx playwright test e2e/food-history-category.spec.js e2e/home.spec.js` plus a manual pass via
   the `run-fridge-track` skill: create a location with a new custom category, rename it from the
   Hogar page, confirm the location's list view and `/historial` tab both reflect the new name
   immediately (no separate re-save needed) - this is the actual behavior being fixed.
4. Two-context sync check (same technique used earlier this session for the location-category sync
   bug): device A creates/renames a category, device B (fresh IndexedDB, same login) pulls and sees
   the renamed category and correctly-tagged locations/history - proving the propagation actually
   works across devices, not just within one device's cache.
