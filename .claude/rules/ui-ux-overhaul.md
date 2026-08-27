---
paths:
  - "frontend/css/**"
  - "frontend/js/lib/swipe.js"
  - "frontend/js/lib/dom.js"
  - "frontend/js/lib/confirmDialog.js"
---

# UI/UX: navigation, motion, accessibility, gestures

On top of a pure visual pass (dark-themed inputs, `box-shadow` elevation on rows/chips/modal, an
accent-colored FAB, `color-scheme: dark` so native form controls follow the theme, a modernized `body`
font stack — no behavior changes), the app got a full interaction/navigation pass.

**The bottom tab bar replaces the old header-icon pattern.** `#mainFooter` used to be dead markup (a
hardcoded `display-none` div holding only dev-only version labels). It's now the real Lista/Historial/
Hogar tab bar — and since it was already listed in the `#app:not([data-auth-stage='ready']) {
display:none }` gating block alongside `#mainHeader`, it inherited the header's show/hide-during-login-
and-chooseHome behavior for free, with no new CSS-gating logic. The dev version labels
(`#indexedDbVersion`/`#cacheMajorVersion`) moved into the `#logger` debug panel; the old standalone "open
logs" button was dropped (dev-only convenience, superseded by `_error()`'s existing auto-open-on-error).

**Modals fade instead of snapping.** `.modal`/`#confirmDialog` no longer use `display:none` — since that
can't be CSS-transitioned across, they pair `opacity` with a *delayed* `visibility: hidden`
(`transition: opacity 200ms ease-out, visibility 0s linear 200ms` when hiding, `0s` delay when showing) —
the standard trick that keeps both the fade animation and `display:none`'s old side effect of pulling the
modal's form fields out of the tab order while closed. View switches get a matching one-shot `page-enter`
`@keyframes` entrance, applied via `state.js`'s `setCurrentView()` calling `animatePageEnter()` — this
only decorates the already-visible page; it can't (and doesn't try to) animate the underlying
`display:none` toggle itself.

**Swipe-to-act on item rows** (`js/lib/swipe.js`, wired in `item-ui.js`'s `appendItemRow`) is built on
Pointer Events, not Touch Events, specifically so Playwright's ordinary `page.mouse` drag sequence
exercises the real listeners in e2e tests with no synthetic Touch-object plumbing. The pure
threshold-decision logic (`pickSwipeOutcome`) is split out from the DOM-touching gesture wiring
(`attachSwipe`) so it's unit-testable per the DOM-free-module convention in the root `CLAUDE.md`. Each row
is wrapped in a `.row-wrapper` (a swipe-action reveal layer behind `.row` itself) — **the reveal layer
must not out-stack `.row`**: since it's `position: absolute` and `.row` was originally unpositioned
(`static`), it silently intercepted every click on the row regardless of DOM order until `.row` got its
own `position: relative; z-index: 1`. `markItemUsed`/`markItemDiscarded`/`tryDeleteItem`/`removeItem`
(`item-ui.js`) now take an *optional* `item` param (defaulting to `dataState.currentItem`) so a swipe can
act on that row's item directly — their button call sites in `ui.js` had to be rewrapped in no-arg
closures (`() => markItemUsed()`), since `$button()`'s listener otherwise passes the raw DOM click event
as the first argument, which would've landed in the new `item` param instead of falling through to the
default.

**`makeKeyboardActivatable()` (`js/lib/dom.js`) closes a real gap**: `$button()` already set
`role="button"`/`tabIndex=0` on every icon button, but browsers only auto-fire a click on Enter/Space for
*native* interactive elements (`<button>`/`<a>`), not `role="button"` divs — every icon button was
focusable-but-not-operable via keyboard before this. `$button()` calls it internally now; anywhere else a
raw `role="button"` div is wired by hand (mode-toggle links, the confirm dialog's buttons) has to call it
explicitly too.

**The cross-location "what's expiring" summary** (`fetchAllItemsForHome` in `item-db.js`) is deliberately
separate from `fetchItems`/`countItemsByStatus`, which are hard-scoped to one `locationKey` via the
`items` store's IndexedDB index (there's no `homeId` index on `items`). It loops every location for the
Home the same way `sync/syncEngine.js`'s `buildLocalSnapshot` already does (see
`.claude/rules/sync-engine.md`), and does **not** touch `dbStore.items` (reserved for the single active
location's list) — it's rendered by `item-ui.js`'s `renderHomeSummary()`, hooked into the same call site
`renderLocationChips()` already uses so it recomputes for free on every add/edit/remove.

**The confirm dialog** (`js/lib/confirmDialog.js` + `css/confirm-dialog.css`) replaces the app's one
remaining native `confirm()` (location deletion). It deliberately does **not** share the `.modal` class
with the form modal, even though it reuses the same fade/rise CSS technique — deleting a location happens
*from inside* the already-open location-edit modal, so the confirm dialog has to layer on top of it
(`z-index: 20` vs the form modal's `10`) and open/close completely independently; sharing a class would
risk one modal's `data-show-*` trigger rules accidentally matching the other. `/historial`'s history-tab
pills (`.history-category-tab`, see `.claude/rules/food-name-history.md`) make the same deliberate
separate-class choice against `.location-chip` for the same reason.

Still deliberately not done: a light theme (the whole palette is dark-only), per-item category icons, and
toast queuing (rapid swipes supersede each other's undo option — `showUndoToast`'s "one active toast"
behavior was always intentional, just more reachable now that swiping lowers the friction to act on
several items quickly).
