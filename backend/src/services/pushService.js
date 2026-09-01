/**
 * @param {import('node:sqlite').DatabaseSync} db
 */
function createPushService(db) {
  /**
   * @param {number} userId
   * @param {{endpoint: string, keys: {p256dh: string, auth: string}}} subscription
   */
  function saveSubscription(userId, subscription) {
    const { endpoint, keys } = subscription || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) { return; }

    db.prepare(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id,
         p256dh = excluded.p256dh, auth = excluded.auth`
    ).run(userId, endpoint, keys.p256dh, keys.auth, Date.now());
  }

  /**
   * @param {number} userId
   * @param {string} endpoint
   */
  function removeSubscription(userId, endpoint) {
    db.prepare(
      'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?'
    ).run(userId, endpoint);
  }

  /** @param {string} endpoint */
  function removeSubscriptionByEndpoint(endpoint) {
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  }

  /**
   * Groups every stored subscription by user, for the scheduler to walk -
   * excluding users who've turned push off via notification preferences, so
   * "don't send" is enforced at the source rather than the scheduler having
   * to remember a separate per-user check.
   * @returns {Map<number, {endpoint: string, keys: {p256dh: string, auth: string}}[]>}
   */
  function listAllSubscriptionsGroupedByUser() {
    const rows = db.prepare(
      `SELECT push_subscriptions.* FROM push_subscriptions
       JOIN users ON users.id = push_subscriptions.user_id
       WHERE users.push_enabled = 1`
    ).all();
    /** @type {Map<number, {endpoint: string, keys: {p256dh: string, auth: string}}[]>} */
    const byUser = new Map();
    for (const row of rows) {
      const userId = Number(row.user_id);
      const subscription = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
      if (!byUser.has(userId)) { byUser.set(userId, []); }
      byUser.get(userId).push(subscription);
    }
    return byUser;
  }

  /**
   * The user's preferred digest hour (UTC, 0-23 - see migration
   * 014_notification_hour.js). A plain per-user lookup rather than folding
   * into listAllSubscriptionsGroupedByUser()'s existing return shape, to
   * avoid reshaping that already-tested Map<userId, subscription[]> contract.
   * @param {number} userId
   * @returns {number|null} null if the user doesn't exist
   */
  function getNotificationHour(userId) {
    const row = db.prepare('SELECT notification_hour FROM users WHERE id = ?').get(userId);
    return row ? Number(row.notification_hour) : null;
  }

  /**
   * @param {number} userId
   * @param {number} homeId
   * @param {string} dateStr
   */
  function hasSentToday(userId, homeId, dateStr) {
    return !!db.prepare(
      'SELECT 1 FROM push_notification_log WHERE user_id = ? AND home_id = ? AND sent_date = ?'
    ).get(userId, homeId, dateStr);
  }

  /**
   * @param {number} userId
   * @param {number} homeId
   * @param {string} dateStr
   */
  function recordSent(userId, homeId, dateStr) {
    db.prepare(
      `INSERT INTO push_notification_log (user_id, home_id, sent_date, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, home_id, sent_date) DO NOTHING`
    ).run(userId, homeId, dateStr, Date.now());
  }

  return {
    saveSubscription, removeSubscription, removeSubscriptionByEndpoint,
    listAllSubscriptionsGroupedByUser, getNotificationHour, hasSentToday, recordSent,
  };
}

export { createPushService };
