---
paths:
  - "backend/src/db/**"
---

# Database migrations

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

**Widening a primary key or otherwise changing a table's shape needs a real recreate-table migration**,
not a plain `ALTER TABLE ADD COLUMN` — SQLite can't widen a `PRIMARY KEY` in place. See migration
`005_food_name_history_category.js` for the pattern: rename the old table aside, create the new one,
`INSERT ... SELECT` across with a backfill default for the new column, drop the renamed original. A
simple new nullable/defaulted column (migrations `003`, `004`, `006`) is a plain `ALTER TABLE ADD COLUMN`
instead.

Migrations in this repo so far: `001_initial_schema` (baseline: users/homes/home_members/sessions plus
`locations`/`items`/`food_name_history` with client-generated UUID primary keys), `002_push_subscriptions`
(push_subscriptions + push_notification_log), `003` (locations.category), `004_notification_preferences`
(users.push_enabled/email_enabled), `005_food_name_history_category` (recreate-table, widens the PK),
`006_food_name_history_deleted_at` (adds the tombstone column).
