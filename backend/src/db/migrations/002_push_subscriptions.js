/**
 * Push notifications: one row per subscribed browser/device (`endpoint` is
 * the dedup key - resubscribing the same device upserts), plus a log used
 * purely to guarantee at most one digest notification per user per Home per
 * calendar day (see backend/src/scheduler/expiryNotifier.js).
 */
const sql = `
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS push_notification_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  home_id INTEGER NOT NULL REFERENCES homes(id),
  sent_date TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, home_id, sent_date)
);
`;

export { sql };
