---
paths:
  - "backend/src/services/authService.js"
  - "backend/src/db/migrations/004*"
  - "frontend/css/toggle-switch.css"
---

# Per-user notification preferences (push toggle wired, email toggle not)

Two switches in the header hamburger menu (`#pushNotifToggle`/`#emailNotifToggle`, styled by
`css/toggle-switch.css`, see `.claude/rules/header-menu-logging.md` for the menu itself) let a user opt
out of a channel without uninstalling anything. Before this, "is push on" was purely implicit - the
presence of a `push_subscriptions` row - with no way to say "stop sending to me" short of the client
unsubscribing outright. Migration `004_notification_preferences.js` adds `push_enabled`/`email_enabled`
columns directly on `users` (`ALTER TABLE`, same shape as migration `003`'s `locations.category` - a
simple per-row flag, not worth a separate table), both `DEFAULT 1` so every already-push-subscribed user
keeps getting notified after this ships without having to re-opt-in. `authService.js`'s
`updateNotificationPreferences(userId, {pushEnabled?, emailEnabled?})` updates only the field(s) given;
`getUserBySessionToken()`/`signup`/`login` all now return `pushEnabled`/`emailEnabled` alongside the rest
of the user shape, and `apiRouter.js` gained a matching `notifications/preferences` route.

**Push is actually gated by this flag; email has nowhere to plug into yet.** `pushService.js`'s
`listAllSubscriptionsGroupedByUser()` - the scheduler's only entry point into "who to notify" (see
`.claude/rules/push-notifications.md`) - now joins against `users` and filters
`WHERE users.push_enabled = 1`, so a disabled user is excluded at the source; `expiryNotifier.js` itself
needed no changes. The email toggle has no such consumer to gate - same "scaffolded, not wired" state as
`emailService.js` itself (`.claude/rules/email-sending.md`) - so right now it only ever persists a
preference nobody reads yet; wiring an actual email trigger later just needs to check it.

**Disabling push does not unsubscribe the browser.** Turning the toggle off only flips the backend flag;
the client keeps whatever `push_subscriptions` row it already has, so re-enabling later doesn't need to
re-request permission or generate a new endpoint (`Notification.requestPermission()`/
`pushManager.subscribe()` are both idempotent no-ops when permission/subscription already exist).
Enabling routes through the exact same flow as the existing opt-in banner -
`pushNotifications.js`'s `subscribe()` (also exported as `subscribeToPush`, returns a `boolean` instead
of assuming a banner is always the caller) - so a previously-denied browser permission correctly fails
closed: the toggle snaps back off and a toast explains why, without ever calling the preferences API.

**The push checkbox's displayed state is deliberately NOT just the stored `pushEnabled` preference.**
A fresh signup defaults `pushEnabled` to `true` (matches the column's own `DEFAULT 1`) despite having no
subscription yet, and a denied/revoked browser permission doesn't touch that stored value either - so
reading the preference alone would show the toggle ON for a user who will never actually receive
anything. `pushNotifications.js`'s `hasActiveSubscription()` (checks `Notification.permission` plus an
actual `pushManager.getSubscription()`) supplies the other half; `ui.js`'s `computePushToggleChecked()`
is `pushEnabled && hasActiveSubscription()`, and `refreshPushToggleState()` re-runs it every time the
header menu opens (`toggleHeaderMenu()`), not just once at boot - browser permission can change
underneath the app with no event to notify the page when it does. The email toggle has no such split -
no subscription concept applies to it - so it renders straight from the stored preference
(`apiCaller.js`'s `getNotificationPreferences()`, cached in `localStorage` alongside the rest of the
session, defaulting true if absent so a session cached before this feature shipped still renders as "on").

`frontend/e2e/notification-toggles.spec.js` covers: email's default-on and reload-persistence; push
defaulting OFF for a fresh signup (no subscription yet, despite `pushEnabled` being `true`
server-side); the permission-denied revert path; and a full successful-subscribe path that stays
checked across a menu close/reopen. All push scenarios mock `Notification.requestPermission` *and* the
separate `Notification.permission` read-only property (the same class of substitution
`voice-item.spec.js` uses for Web Speech, see `.claude/rules/voice-dictation.md`), plus
`registration.pushManager.subscribe`/`getSubscription` directly on the real service-worker registration
this app already registers - `getSubscription()` only starts returning a fake subscription after the
mocked `subscribe()` has actually been called, so the "before" state in each test is a
genuinely-unsubscribed device, not a pre-faked one. Two mistakes worth not repeating: Playwright's
`.check()` silently no-ops if the box is already checked, and separately *throws* if a click doesn't
leave the box checked - so proving a checked box reverts to unchecked needs a plain `.click()`, not
`.check()`. Also, `frontend/e2e/globalTeardown.js` needed `push_subscriptions`/`push_notification_log`
added to its per-run cleanup once a test started creating real subscription rows for the first time -
without that, deleting a swept-up test `users` row hit a FOREIGN KEY constraint.
