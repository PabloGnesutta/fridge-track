import { sql as initialSchema } from './001_initial_schema.js';
import { sql as pushSubscriptions } from './002_push_subscriptions.js';
import { sql as locationCategory } from './003_location_category.js';
import { sql as notificationPreferences } from './004_notification_preferences.js';
import { sql as foodNameHistoryCategory } from './005_food_name_history_category.js';

/**
 * Ordered, explicit registry (no directory-scanning) - add new migrations
 * by creating NNN_description.js (exporting `sql`) and appending it here
 * with the next version number. Never edit an already-applied migration's
 * SQL after it's shipped - add a new one instead, the same rule as any
 * other migration tool.
 * @type {{version: number, name: string, sql: string}[]}
 */
const migrations = [
  { version: 1, name: 'initial_schema', sql: initialSchema },
  { version: 2, name: 'push_subscriptions', sql: pushSubscriptions },
  { version: 3, name: 'location_category', sql: locationCategory },
  { version: 4, name: 'notification_preferences', sql: notificationPreferences },
  { version: 5, name: 'food_name_history_category', sql: foodNameHistoryCategory },
];

export { migrations };
