import { createHomeService } from '../services/homeService.js';
import { createPushService } from '../services/pushService.js';
import { getWebPush } from '../services/webPushClient.js';
import { computeItemStatus } from '../lib/itemStatus.js';
import { error } from '../logger/logger.js';

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

/** @param {Date} date */
function toYYYYMMDD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} homeId
 * @param {Date} currentDate
 */
function countExpiringItems(db, homeId, currentDate) {
  const items = db.prepare('SELECT * FROM items WHERE home_id = ? AND deleted_at IS NULL').all(homeId);
  let count = 0;
  for (const row of items) {
    const status = computeItemStatus({
      useByDate: row.use_by_date == null ? null : Number(row.use_by_date),
      addedDate: row.added_date == null ? null : Number(row.added_date),
      shelfLifeDays: row.shelf_life_days == null ? null : Number(row.shelf_life_days),
    }, currentDate);
    if (status === 'expired' || status === 'expiring-soon') { count++; }
  }
  return count;
}

/**
 * One digest push per user per Home per day, deduped via push_notification_log.
 * @param {import('node:sqlite').DatabaseSync} db
 */
async function runNotificationTick(db) {
  const homeService = createHomeService(db);
  const pushService = createPushService(db);
  const today = toYYYYMMDD(new Date());
  const now = new Date();

  const subscriptionsByUser = pushService.listAllSubscriptionsGroupedByUser();

  for (const [userId, subscriptions] of subscriptionsByUser) {
    const homes = homeService.listHomesForUser(userId);

    for (const home of homes) {
      if (pushService.hasSentToday(userId, home.id, today)) { continue; }

      const count = countExpiringItems(db, home.id, now);
      if (count === 0) { continue; }

      const payload = JSON.stringify({
        title: home.name,
        body: `${count} alimento${count === 1 ? '' : 's'} vence${count === 1 ? '' : 'n'} pronto`,
      });

      for (const subscription of subscriptions) {
        try {
          await getWebPush().sendNotification(subscription, payload);
        } catch (err) {
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            pushService.removeSubscriptionByEndpoint(subscription.endpoint);
          } else {
            error('---Error @runNotificationTick sendNotification', err);
          }
        }
      }

      pushService.recordSent(userId, home.id, today);
    }
  }
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 */
function startExpiryNotificationScheduler(db) {
  const intervalMs = Number(process.env.NOTIFICATION_CHECK_INTERVAL_MS) || DEFAULT_INTERVAL_MS;

  const tick = () => { runNotificationTick(db).catch(err => error('---Error @expiryNotifier tick', err)); };
  tick();
  setInterval(tick, intervalMs);
}

export { startExpiryNotificationScheduler, runNotificationTick };
