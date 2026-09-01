/**
 * Per-user preferred hour for the daily expiry digest (see
 * .claude/rules/push-notifications.md) - previously the scheduler just sent
 * as soon as it noticed expiring items, whenever in the day that happened
 * to be. Stored as a UTC hour (0-23), not server-local, so the value stays
 * correct regardless of which timezone the backend process happens to run
 * in - the frontend converts to/from the user's local wall-clock hour at
 * the UI boundary (see frontend/js/lib/date.js's localHourToUtcHour/
 * utcHourToLocalHour). DEFAULT 12 is UTC noon, i.e. ~9am in Argentina
 * (UTC-3) - this app's only deployment locale today - so existing users
 * keep getting a morning-ish digest after this ships without configuring
 * anything.
 */
const sql = `
ALTER TABLE users ADD COLUMN notification_hour INTEGER NOT NULL DEFAULT 12;
`;

export { sql };
