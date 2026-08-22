import { sql as initialSchema } from './001_initial_schema.js';
import { sql as pushSubscriptions } from './002_push_subscriptions.js';
import { sql as locationCategory } from './003_location_category.js';
import { sql as notificationPreferences } from './004_notification_preferences.js';
import { sql as foodNameHistoryCategory } from './005_food_name_history_category.js';
import { sql as foodNameHistoryDeletedAt } from './006_food_name_history_deleted_at.js';
import { sql as categoriesTable } from './007_categories_table.js';
import { sql as locationsCategoryId } from './008_locations_category_id.js';
import { sql as foodNameHistoryCategoryId } from './009_food_name_history_category_id.js';
import { sql as categoriesBuiltinLabels } from './010_categories_builtin_labels.js';

/**
 * Ordered, explicit registry (no directory-scanning) - add new migrations
 * by creating NNN_description.js (exporting `sql`) and appending it here
 * with the next version number. Never edit an already-applied migration's
 * SQL after it's shipped - add a new one instead, the same rule as any
 * other migration tool.
 * @type {{version: number, name: string, sql: string, disableForeignKeys?: boolean}[]}
 */
const migrations = [
  { version: 1, name: 'initial_schema', sql: initialSchema },
  { version: 2, name: 'push_subscriptions', sql: pushSubscriptions },
  { version: 3, name: 'location_category', sql: locationCategory },
  { version: 4, name: 'notification_preferences', sql: notificationPreferences },
  { version: 5, name: 'food_name_history_category', sql: foodNameHistoryCategory },
  { version: 6, name: 'food_name_history_deleted_at', sql: foodNameHistoryDeletedAt },
  { version: 7, name: 'categories_table', sql: categoriesTable },
  // items.location_id holds a real foreign key into locations - see
  // 008_locations_category_id.js's header comment for why this recreate-
  // table migration needs foreign key enforcement off around it.
  { version: 8, name: 'locations_category_id', sql: locationsCategoryId, disableForeignKeys: true },
  { version: 9, name: 'food_name_history_category_id', sql: foodNameHistoryCategoryId },
  { version: 10, name: 'categories_builtin_labels', sql: categoriesBuiltinLabels },
];

export { migrations };
