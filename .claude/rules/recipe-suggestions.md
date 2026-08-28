---
paths:
  - "backend/src/services/edamamClient.js"
  - "backend/src/services/recipeService.js"
  - "backend/src/services/recipeCacheService.js"
  - "backend/src/db/migrations/013_recipe_search_cache.js"
---

# Recipe suggestions — live, backed by Edamam's free tier + a response cache

`backend/src/lib/itemStatus.js`'s `getDaysUntilDue()` (numeric urgency, mirrors the frontend's
`getSoonestDays()`) picks the Home's top-3 most urgent item names; `backend/src/services/edamamClient.js`
wraps Edamam's Recipe Search API v2 (`api.edamam.com/api/recipes/v2`, `type=public` required) and sends
those names as the raw query text. `backend/src/services/recipeService.js` wires the two together
(injectable `edamamClient`/`recipeCacheService` params for test stubbing) and is reached via the
`recipes/suggestions` route in `apiRouter.js`. Missing `EDAMAM_APP_ID`/`EDAMAM_APP_KEY` don't crash
anything — `edamamClient.searchRecipes()` just returns `[]`, same "missing-keys-means-silent-no-op" pattern
as the VAPID push keys (`.claude/rules/push-notifications.md`) — but it does mean no suggestions will ever
appear until real credentials are set in `backend/.env` (Edamam's free Developer plan, 10,000 calls/month).

**Edamam has no dedicated Spanish endpoint** — the original scaffold's assumption that one existed
(`test-es.edamam.com/search`) was wrong and had never been checked against a live response; that URL just
serves Edamam's marketing homepage (200 OK, HTML, no `hits` field), which silently looked identical to "no
matches" until this was verified with real credentials. There's also no translation step: Spanish item
names are sent as-is to a largely-English recipe database, so match quality depends entirely on whether a
word happens to appear in English recipe titles/ingredients as a loanword (`"cebolla"`, `"dulce de leche"`
match real dishes; a plain grocery noun with no such presence may return nothing). **The free tier's
per-minute rate limit is aggressive** — a handful of manual test calls a few seconds apart is enough to
start getting `429`s — which is the other reason `recipeCacheService.js` matters here, not just the
monthly 10k-call cap.

**`recipeCacheService.js` fronts every Edamam call**, backed by the `recipe_search_cache` table (migration
`013_recipe_search_cache`, one row per cache key: `results_json` + `fetched_at`). `recipeService.js` builds
two different strings from the same top-3 urgent items: `query` (urgency-ordered, e.g. `"Pollo Tomate"` —
what actually gets sent to Edamam, most-urgent-first) and `cacheKey` (the same names lowercased and
**sorted alphabetically** before joining) — the cache key is deliberately order-independent so two Homes,
or the same Home on different days as urgency reorders, hit the same cached row for the same underlying
ingredient set instead of each re-fetching from Edamam. A cache hit returns without calling `edamamClient`
at all; a miss calls it once and stores the result (including empty-array results, so a combo with
genuinely no matches doesn't get re-fetched every time either) before returning. `CACHE_TTL_MS`
(`recipeCacheService.js`, currently a placeholder 24h) should be revisited once Edamam's terms of service
on cache duration are confirmed.

On the frontend, `frontend/js/ui/item-ui.js`'s `toggleRecipeSuggestionsVisibility()` (called from
`fetchAndRenderItems()`) shows/hides the `#recipeSuggestions` strip based on whether `#homeSummary` is
currently showing anything, and `openRecipeSuggestions()` (reached via `ui.js`'s click-delegation switch,
`data-click-action="openRecipeSuggestions"`) fetches and renders the actual cards on tap — Edamam's free
tier is quota-limited and third-party HTTP shouldn't add latency/flakiness to routine list renders, so this
only happens on demand, not automatically.

**A previously-considered alternative**: TheMealDB (fully free, no key/quota, but English-only, so it
would need a Spanish→English ingredient dictionary and a separate ranking step, since its free filter
endpoint only takes one ingredient per call) — ruled out once Edamam's free Developer plan was found, but
worth revisiting if the Edamam free tier ever stops being viable.
