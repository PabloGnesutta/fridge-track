import { sql as initialSchema } from './001_initial_schema.js';
import { sql as pushSubscriptions } from './002_push_subscriptions.js';
import { sql as locationCategory } from './003_location_category.js';

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
];

export { migrations };
