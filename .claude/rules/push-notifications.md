---
paths:
  - "backend/src/scheduler/**"
  - "backend/src/services/pushService.js"
  - "backend/src/services/webPushClient.js"
  - "backend/src/lib/itemStatus.js"
  - "backend/src/db/migrations/014_notification_hour.js"
  - "frontend/js/pushNotifications.js"
---

# Push notifications (product feature #1)

A background scheduler on the backend, not a client-side timer, since the whole point is alerting users
who don't have the app open. Follows the sync engine's "best-effort, no outbox" philosophy rather than
building real cron infra: `backend/src/scheduler/expiryNotifier.js`'s `startExpiryNotificationScheduler(db)`
(started from `index.fridge.js`'s `listen()` callback) runs an immediate tick, then a `setInterval` every
`NOTIFICATION_CHECK_INTERVAL_MS` (env, default 1h). **v1 is deliberately one digest notification per user
per Home per day** ("N alimentos vencen pronto"), not per-item tracking — a `push_notification_log` row
keyed by `(user_id, home_id, sent_date)` (migration `002_push_subscriptions`, alongside `push_subscriptions`
itself) is the entire dedup mechanism, which is why an hourly tick that's a no-op most hours is fine
instead of needing precise cron timing.

**Each user picks the hour their digest goes out** (`users.notification_hour`, migration
`014_notification_hour.js`), stored as a UTC hour (0-23) rather than server-local so the value stays
correct regardless of which timezone the backend process runs in — see that migration's header comment
and `frontend/js/lib/date.js`'s `localHourToUtcHour`/`utcHourToLocalHour` for the local↔UTC conversion at
the UI boundary (a snapshot conversion, not truly timezone-aware — it'll drift an hour if the device's UTC
offset itself changes, e.g. DST, until the user resaves; accepted for this app's single-locale Argentina
deployment, which hasn't observed DST since 2009). `runNotificationTick()` gates each user with
`now.getUTCHours() >= notificationHour` (via `pushService.getNotificationHour(userId)`) **before** doing
any home/item lookup — `>=` rather than `===` so a missed tick (server restart, etc.) still catches up
later the same day instead of silently skipping it, same best-effort philosophy as the rest of this
scheduler. `runNotificationTick(db, {now, webPush})` also takes an optional `now`/`webPush` for tests —
both default to the real current time and the real (lazily-VAPID-configured) web-push client in
production, mirroring `authService.js`'s injectable `emailService` param; this is what lets
`expiryNotifier.test.js` control the day/hour gates deterministically without needing real VAPID keys.

Since the sync engine already means `items` live in the backend db too, the scheduler queries `items`
directly (`home_id`, `deleted_at IS NULL`) rather than needing any new sync plumbing. It runs each row
through `backend/src/lib/itemStatus.js`'s `computeItemStatus()` — a **deliberate duplicate** of
`frontend/js/lib/freshnessStatus.js`'s `computeStatus()` decision logic (same `EXPIRING_SOON_DAYS = 2`
threshold, same "expired if either the use-by date or the shelf-life-from-added-date has elapsed" rule),
because the two npm projects share no code; if the threshold/logic ever changes, change both files.

`backend/src/services/pushService.js` (same `create*Service(db)` factory shape as `homeService.js`) owns
`push_subscriptions` (one row per subscribed browser/device, upserted by `endpoint` so resubscribing the
same device doesn't duplicate) and the log table above. `backend/src/services/webPushClient.js` wraps the
`web-push` npm dependency (the backend's first real runtime `dependencies` entry — previously only
`devDependencies` existed) and **configures VAPID lazily** (`getWebPush()`, memoized on first call) rather
than at module top level: this module is statically imported (via `expiryNotifier.js`) from `index.fridge.js`,
and ES module imports are hoisted and evaluated *before* any of `index.fridge.js`'s own body runs — including its
`configEnv()` dotenv call — so reading `process.env.VAPID_*` at import time would always see `undefined`.
VAPID keys live in `backend/.env` (`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`, generated once
via `npx web-push generate-vapid-keys`), loaded the same way `PORT` already is.

**A scheduler failure emails an admin alert**, added after a real incident where the digest silently
stopped for over a day with zero signal anywhere (the droplet's process just wasn't running, and nothing
short of manually diffing `push_notification_log` against expected dates would have caught it).
`expiryNotifier.js`'s `alertPushFailure()` fires `emailService.js`'s `sendEmail()` (see
`.claude/rules/email-sending.md`) to a hardcoded address on two paths: a `sendNotification` failure that
isn't a normal 404/410 "subscription gone" case, and any uncaught error in the tick itself. The address
is a plain module constant, not an env var — this is a diagnostic alert to the one operator running this
instance, not a per-deployment setting. Doesn't catch every failure mode: a Home with zero
`push_subscriptions` rows (a revoked/expired browser subscription, deleted after its first 404/410) just
silently sends nothing, since that's not an error case — check `push_subscriptions` directly if the alert
never fires but notifications still aren't arriving.

**`push_notification_log` is only written on an actual successful send now** - a real incident (VAPID
keys the deployed server no longer had valid credentials for, so every `sendNotification` call failed the
same way, day after day) showed that recording the day as "sent" unconditionally let a total failure hide
behind a log row that looked identical to a real delivery, silently skipping every retry until the next
day rolled over. `runNotificationTick()` now only calls `pushService.recordSent()` if at least one
subscription in the loop actually succeeded - a total failure leaves the day unmarked, so the next hourly
tick retries automatically instead of waiting a full day, and each retry re-fires `alertPushFailure()` too.

Three bearer-auth-gated routes in `apiRouter.js`, following the exact existing POST-only pattern:
`push/vapid-public-key`, `push/subscribe`, `push/unsubscribe` — mirrored on the client as
`apiPushVapidKey`/`apiPushSubscribe`/`apiPushUnsubscribe` in `apiCaller.js`.

On the client, `frontend/js/pushNotifications.js` mirrors `installPrompt.js`'s exact opt-in pattern
(single `localStorage` dismissal key, always-in-DOM `.folded` `#notifBanner`) but with one difference:
`installPrompt.js`'s `initInstallPrompt()` is only ever called once, from `app.js`'s module body, so it
wires its click listeners inline; `initPushNotifications()` is instead called from `appBoot.js`'s
`afterHome()` (see `.claude/rules/app-boot.md`), which re-runs on every Home switch, not just cold boot —
so `pushNotifications.js` wires its listeners once at module load instead, to stay idempotent across
repeated `afterHome()` calls. The banner only ever shows while `Notification.permission === 'default'`;
once granted or denied the browser itself won't re-prompt, so no separate suppression flag is needed.
`cacheServiceWorker.js` gained `push`/`notificationclick` listeners — see
`.claude/rules/service-worker-caching.md`.

Push toggle/preference gating lives in `.claude/rules/notification-preferences.md` — `pushEnabled` is a
separate flag from "has a `push_subscriptions` row."

Missing `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` don't crash the server, just silently
no-op the feature (subscribe requests get an empty public key, and the scheduler's send attempts fail
quietly, logged but caught).
