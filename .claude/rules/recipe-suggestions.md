---
paths:
  - "backend/src/services/edamamClient.js"
  - "backend/src/services/recipeService.js"
---

# Recipe suggestions — scaffolded, deliberately NOT wired live (paused)

Backend groundwork exists but is dormant: `backend/src/lib/itemStatus.js`'s `getDaysUntilDue()` (numeric
urgency, mirrors the frontend's `getSoonestDays()`), `backend/src/services/edamamClient.js` (a wrapper
around Edamam's Spanish-language recipe search — the one recipe API found with native Spanish ingredient
matching, so no translation step needed), `backend/src/services/recipeService.js` (picks the Home's top-3
most urgent item names and asks the client for recipes, injectable client param for test stubbing), and
the `recipes/suggestions` route in `apiRouter.js`. All of this is safe to leave in place — with no
`EDAMAM_APP_ID`/`EDAMAM_APP_KEY` set, `edamamClient.searchRecipes()` just returns `[]`, same
"missing-keys-means-silent-no-op" pattern as the VAPID push keys (`.claude/rules/push-notifications.md`).

**Why it's paused**: Edamam's Recipe Search API turned out not to have a genuinely free tier ($9/mo
minimum after a 10-day trial) — this wasn't caught until after the backend was built, so the code stayed
(it's a reasonable general shape regardless of which recipe API eventually gets wired up) but the
feature was deliberately **not connected to the UI**. `frontend/js/ui/item-ui.js` has the dormant halves
(`toggleRecipeSuggestionsVisibility()`, `openRecipeSuggestions()`, the `#recipeSuggestions`/
`#recipeResults` DOM refs) and `frontend/index.html`/`frontend/css/location-chips.css` have the markup/
styling — but `fetchAndRenderItems()` does NOT call `toggleRecipeSuggestionsVisibility()` (commented out
with an explanation) and `ui.js`'s click-delegation switch has no `openRecipeSuggestions` case, so the
card can never actually become visible or reachable. To re-enable: pick a recipe source (pay for Edamam,
or swap in a free English-only one like TheMealDB — would need a translation step for Spanish item names
first), re-add the `toggleRecipeSuggestionsVisibility()` call, and add the missing `ui.js` case.
