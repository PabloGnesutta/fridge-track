---
paths:
  - "frontend/cacheServiceWorker.js"
  - "frontend/js/initializeCache.js"
  - ".githooks/**"
---

# Service worker caching

Ported from the sibling `car-track`/`sonar` projects' own take on this same problem (sonar's is the
more directly-copied one - same hook shape, same cache-first philosophy). Everything the backend's
static-asset paths serve (`index.html`, `css/**`, `js/**`, `static/**` - icons/manifest.json/
favicon.ico) is served **cache-first**: the app loads instantly from cache, network is only hit on
a cache miss. This used to be off entirely (`INTERCEPT_FETCH_REQUESTS = false`, permanently, since
nothing ever flipped it before a release) specifically because a hand-maintained cache version is
easy to forget to bump - shipping stale cached JS to a real user is worse than no caching at all.
That risk is what's actually gone now, not the tradeoff being ignored: the single cache's name
embeds a version (`cacheVersion`, a `cacheServiceWorker.js`-top const) that's a **content hash of
exactly the files it covers, computed and written automatically by `.githooks/pre-commit`** on
every commit - never hand-maintained, so it can't be forgotten. One cache (`appCache`), not split
by file type like sonar's `jsCache`/`wavCache` - fridge-track has no equivalent large-binary asset
type (car-track/sonar's `.wav`/photo assets rarely change and are large enough to be worth a
separate, longer-lived cache; icons here are small and change about as often as the rest of the
app shell).

Two things this fetch handler has to do that sonar's simpler static site never needed to:
- **Never cache-first serve `/api/*` or anything non-GET.** The Cache API's `put()` throws on a
  non-GET request, and `apiCaller.js`'s `apiCall()` always POSTs to `/api/*` anyway, so both checks
  exclude the same traffic for two independent reasons - either one alone would be enough today,
  but the explicit method check is what actually prevents an uncaught exception if that ever
  changes.
- **Canonicalize every client-side route to one cache entry.** `/item/42`, `/historial`, etc. all
  serve the same `index.html` shell (see `requestHandler.js`'s SPA-fallback, "last path segment has
  no dot") - the fetch handler mirrors that exact heuristic so every one of them cache-hits/
  populates a single `/` entry instead of each route becoming its own separate, individually
  stale-able cache entry.

**One-time setup**: `.githooks/pre-commit` isn't `.git/hooks/pre-commit` (that directory isn't
tracked by git) - `frontend/package.json`'s `"prepare"` script runs `git config core.hooksPath
.githooks` automatically on `npm install`, so a normal `cd frontend && npm install` wires it up with
no extra step. (If that's ever skipped, running `git config core.hooksPath .githooks` from anywhere
inside the repo does the same thing by hand.)

**Local dev**: because the version only changes when the hook runs (i.e. on commit), a browser tab
left open while actively editing files *without* committing keeps serving the cache-first version
from before your last commit - the classic "PWA + service worker" dev annoyance, not something
specific to this setup. Standard mitigation: check "Disable cache" (or Application tab -> Service
Workers -> "Update on reload") in devtools while iterating, or flip `cacheServiceWorker.js`'s
`BYPASS_CACHE` to `true` locally (never commit it that way - it defeats cache-first serving for real
users). This doesn't affect the `run-fridge-track` skill / Playwright-based checks in this repo,
since each of those launches a fresh browser context with no persisted SW/cache state.

`js/initializeCache.js`'s update banner is what actually gets an already-open client onto a new
version: it listens for the browser detecting that the `cacheServiceWorker.js` *script itself*
changed bytes (which it always does whenever the hook bumps `cacheVersion`, since that's literally
part of the script's own source), deletes stale caches, and prompts a refresh. This is a separate
detection path from `appCache`'s own cache-first serving - browsers already re-check a service
worker's script on every navigation regardless of caching strategy, so it doesn't depend on
`appCache` being fresh at all. On a genuinely first-ever install, `initializeCache.js` also does one
silent reload once the new service worker actually takes control (`controllerchange`) - without
that, this exact first visit's own page load never goes through the SW (nothing controlled it yet),
so offline support wouldn't start working until a separate, later visit.

`cacheServiceWorker.js` also holds `push`/`notificationclick` listeners for push notifications (see
`.claude/rules/push-notifications.md`) - both independent of the cache-first `fetch` handler above,
so they work the same regardless of `BYPASS_CACHE` or cache state.
