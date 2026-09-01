import { createHomeService } from '../services/homeService.js';
import { createPushService } from '../services/pushService.js';
import { getWebPush } from '../services/webPushClient.js';
import { computeItemStatus } from '../lib/itemStatus.js';
import { createEmailService } from '../services/emailService.js';
import { error } from '../logger/logger.js';

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

// Hardcoded rather than an env var: this is a diagnostic alert to the single
// operator running this instance, not a per-deployment/multi-tenant setting.
const ADMIN_ALERT_EMAIL = 'pablo.gnesutta@gmail.com';

const { sendEmail } = createEmailService();

/**
 * Best-effort admin alert for push-scheduler failures - sendEmail() never
 * throws (see emailService.js), so no try/catch needed here; if SMTP isn't
 * configured this just logs and no-ops, same as every other silent-failure
 * path in this scheduler.
 * @param {string} context
 * @param {unknown} err
 */
function alertPushFailure(context, err) {
  const message = err instanceof Error ? err.message : String(err);
  return sendEmail({
    to: ADMIN_ALERT_EMAIL,
    subject: 'FridgeTrack: push notification failure',
    text: `${context}\n\n${message}`,
  });
}

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
 * @param {{now?: Date, webPush?: {sendNotification: Function}}} [opts]
 *   Both injectable, same reasoning as authService.js's emailService param -
 *   production gets real current time and the real web-push client (lazily
 *   configured, see webPushClient.js), tests can pin `now` to control the
 *   day/hour gates deterministically and pass a stub webPush that doesn't
 *   need real VAPID keys configured.
 */
async function runNotificationTick(db, { now = new Date(), webPush = getWebPush() } = {}) {
  const homeService = createHomeService(db);
  const pushService = createPushService(db);
  const today = toYYYYMMDD(now);

  const subscriptionsByUser = pushService.listAllSubscriptionsGroupedByUser();

  for (const [userId, subscriptions] of subscriptionsByUser) {
    // >= rather than === so a missed tick (server restart, etc.) still
    // catches up later the same day instead of silently skipping it -
    // same best-effort philosophy as the rest of this scheduler.
    const notificationHour = pushService.getNotificationHour(userId);
    if (now.getUTCHours() < notificationHour) { continue; }

    const homes = homeService.listHomesForUser(userId);

    for (const home of homes) {
      if (pushService.hasSentToday(userId, home.id, today)) { continue; }

      const count = countExpiringItems(db, home.id, now);
      if (count === 0) { continue; }

      const payload = JSON.stringify({
        title: home.name,
        body: `${count} alimento${count === 1 ? '' : 's'} vence${count === 1 ? '' : 'n'} pronto`,
      });

      let sentToAnySubscription = false;

      for (const subscription of subscriptions) {
        try {
          await webPush.sendNotification(subscription, payload);
          sentToAnySubscription = true;
        } catch (err) {
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            pushService.removeSubscriptionByEndpoint(subscription.endpoint);
          } else {
            error('---Error @runNotificationTick sendNotification', err);
            await alertPushFailure(`sendNotification failed for user ${userId}, home ${home.id}`, err);
          }
        }
      }

      // Only dedup the day if something actually got through - a total
      // failure (e.g. bad VAPID keys) should retry next tick, not silently
      // wait until tomorrow while push_notification_log implies it worked.
      if (sentToAnySubscription) {
        pushService.recordSent(userId, home.id, today);
      }
    }
  }
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 */
function startExpiryNotificationScheduler(db) {
  const intervalMs = Number(process.env.NOTIFICATION_CHECK_INTERVAL_MS) || DEFAULT_INTERVAL_MS;

  const tick = () => {
    runNotificationTick(db).catch(err => {
      error('---Error @expiryNotifier tick', err);
      alertPushFailure('expiryNotifier tick failed', err);
    });
  };
  tick();
  setInterval(tick, intervalMs);
}

export { startExpiryNotificationScheduler, runNotificationTick };
