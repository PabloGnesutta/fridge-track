---
paths:
  - "frontend/js/common/router.js"
  - "frontend/js/common/routeMatch.js"
  - "frontend/js/app.js"
---

# Client-side routing

**Client-side routing** is split across two files for testability: `js/common/routeMatch.js` is a pure,
dependency-free `pathname -> route` mapper; `js/common/router.js` wires it to
`history.pushState`/`popstate` and to the actual view functions (`openItemList`, `openSingleItem` in
`js/ui/item-ui.js`), which call `syncUrl()` themselves so every way of reaching a view (click, deep link,
browser back) keeps the URL in sync.

Boot order matters: `app.js` calls `captureInitialRoute()` *before* `initializeIndexedDb()`/
`appBoot.js#bootApp()` run (see `.claude/rules/app-boot.md`), because `activateLocation`'s default list
render calls `openItemList()`, which resets the URL to `/` — capturing the route first is what lets a
deep link to `/item/42` survive that reset. Since boot may pause for an arbitrarily long login/
Home-selection step, the captured route is held as module state in `appBoot.js` (not a local `const` in
`app.js`) and only re-applied once on the very first `afterHome()` resolution — a later Home switch
calling `afterHome()` again must *not* re-apply a stale initial route from a different Home.

Because of this route-capture requirement, static asset references (`<script src>`, `<link href>`,
`serviceWorker.register(...)`) must be root-relative (`/js/app.js`), not relative (`js/app.js`) —
relative paths resolve incorrectly from a nested URL like `/item/42`. The same relative-vs-root-relative
class of bug bit `apiCaller.js`'s `fetch()` calls in production once — see `.claude/rules/sync-engine.md`.

`js/common/routeMatch.js` has no DOM dependency, so it's the one routing module covered by the plain
`node --test` unit suite — see the testing convention note in the root `CLAUDE.md`.
