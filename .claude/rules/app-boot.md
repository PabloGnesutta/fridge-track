---
paths:
  - "frontend/js/appBoot.js"
  - "frontend/js/ui/home-ui.js"
---

# App boot: login + Home gating

**The app is gated behind login + an active Home before any fridge data loads.** `frontend/js/appBoot.js`
owns this: `bootApp()` (called from `app.js`'s `IndexedDbInited` handler) checks `isLoggedIn()` and stops
at the login screen (`appState.authStage = 'login'`, driving `#authView` via the CSS-attribute state
pattern) if there's no cached session; `afterLogin()` resolves which Home is active (syncing from the
server when reachable, falling back to the IndexedDB `homes` cache otherwise) and stops at `#homeView`
(`authStage = 'chooseHome'`) if none can be resolved; `afterHome(home)` is the point where the *old*
boot sequence picks back up — a best-effort `syncHome()` pull (see `.claude/rules/sync-engine.md`), then
fetch that Home's locations/food-name-history, resolve/open the current location, re-apply the captured
deep link (see `.claude/rules/routing.md`). `afterHome` is also the reentry point for creating/joining/
switching Homes later, not just cold boot: `appBoot.js` imports `refreshHomeUi` from `js/ui/home-ui.js`
(to keep the Home chip list/label in sync after every activation) while `home-ui.js` imports `afterHome`
back from `appBoot.js` — a deliberate circular import between the two, safe here only because neither
module touches the other's export at module top level, just inside function bodies called later. Worth
knowing about before "fixing" it.

**Locations and food-name history are scoped per-Home, not just per-browser.** Every `locations` record
carries a `homeId` field and the store has a `homeId` index (`getAllWithIndex('locations', 'homeId',
...)`); `items` need no such change since they're already scoped via `locationKey` and locations are
home-scoped. A user who belongs to more than one Home (join via a 6-character join-code, no email
invites) can switch between them via the `.home-switcher` label in `#itemListView`
(`openHomeSwitcher()` in `home-ui.js`), which re-enters the Home-selection screen without logging out.

`initPushNotifications()` (see `.claude/rules/push-notifications.md`) is also called from `afterHome()`,
best-effort alongside `syncHome()`, since the push digest is per-Home.
