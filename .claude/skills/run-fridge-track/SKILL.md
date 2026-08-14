---
name: run-fridge-track
description: Launch and drive the fridge-track PWA (backend serves the frontend, no separate dev server) in headless Chromium to smoke-test UI changes end to end. Use when asked to run, test, or screenshot fridge-track, or to confirm a change actually works before calling it done.
---

Backend and frontend unit tests (`npm test` in each) and the Playwright e2e suite
(`frontend/e2e/*.spec.js`) already cover most behavior - use this skill for one-off manual
verification (a specific screenshot, checking a change interactively) rather than duplicating
what those suites already do. All paths below are relative to the repo root.

## One-time setup

This skill's `node_modules` is self-contained (doesn't depend on `frontend/`'s devDependencies -
a script here can't resolve `frontend/node_modules` packages via normal ESM resolution since
it's a sibling directory, not an ancestor).

```bash
cd .claude/skills/run-fridge-track
npm install
npx playwright install chromium   # likely a no-op - frontend's e2e suite already caches it
```

Also requires **Node ≥24** globally (`node -v`) - the backend's `node:sqlite` module needs it
unflagged. `nvm install 24 && nvm use 24` if not already active.

## Start the backend

No separate frontend build/dev-server - `backend/src/index.js` serves `frontend/` as static
files plus the `/api/*` routes.

```bash
cd backend && npm run serve &
timeout 20 bash -c 'until curl -sf http://localhost:3001/ >/dev/null; do sleep 1; done'
```

Needs `backend/.env` to exist (gitignored, not in the repo) with at least `PORT=3001`. Missing
`VAPID_*`/`EDAMAM_*` keys don't crash anything - they just silently no-op push notifications /
recipe suggestions (see CLAUDE.md).

**Stop when done**: the backgrounded shell job isn't the actual server PID (nodemon spawns a
child). On Windows: `netstat -ano | grep ':3001' | grep LISTENING | awk '{print $5}' | sort -u |
while read pid; do taskkill //F //PID "$pid"; done`. On Linux/Mac: `lsof -ti:3001 | xargs -r
kill`.

## Auth is invite-only - allow-list before you sign up

`authService.createUser` rejects any email that isn't in the `allowed_emails` table first - a
plain signup with an arbitrary email fails with "Ya existe una cuenta..." or an allow-list
rejection, not a generic error. Authorize your test email before signing up:

```bash
cd backend && node src/db/manageAllowedEmails.js add your-test-email@test.local
```

**Do this BEFORE starting the server, or while it's stopped** - see the concurrent-db-access
gotcha below. `node src/db/manageAllowedEmails.js list` / `remove <email>` also exist.

## Drive it

```bash
cd <repo root>
EMAIL=your-test-email@test.local node .claude/skills/run-fridge-track/drive.mjs
```

Runs the one representative flow verified end-to-end: signup → create a Home → create a
location (onboarding) → add an item → screenshot the list. All inputs are overridable via env
vars (`BASE_URL`, `EMAIL`, `PASSWORD`, `HOME_NAME`, `LOCATION_NAME`, `ITEM_NAME`, `SHOTS_DIR`) -
see the top of `drive.mjs`. It re-uses an existing Home if `EMAIL` already has one (skips the
Home-creation step), so it's safe to re-run with the same email.

Screenshot lands in `.claude/skills/run-fridge-track/shots/item-list.png`. **Open it** - a
script that reaches the end with zero console errors can still have rendered a blank or
broken-looking page. The script also exits non-zero if any page/console error was captured, and
prints them.

To drive a *different* flow than the bundled one (e.g. testing swipe-to-act, the food-history
view, push-notification opt-in), copy `drive.mjs` as a starting point rather than writing a
driver from scratch - the login/Home/location scaffolding at the top is the expensive part to
get right (see gotchas below), the flow-specific part after `.location-chips .location-chip`
appears is where to diverge.

## Gotchas (read before writing a script - these cost real debugging time to find)

- **Never run `manageAllowedEmails.js` (or any other script that imports `backend/src/db/db.js`)
  while the dev server is already running.** Both hold `backend/data/fridgetrack.db` open via
  `node:sqlite`, and a concurrent second connection **crashes the running server** (observed:
  the server died silently mid-session, no error logged, right after handling an unrelated
  request - not immediately, which makes the cause non-obvious). Add allow-list entries before
  starting the server, or stop the server first, add the entry, then restart.
- **The auth form starts in login mode.** `#authModeToggle` must be clicked to switch to signup
  before filling fields - there's no separate signup form/route. Field names are
  `authEmail`/`authPassword` (not `email`/`password` - those are the *backend's* JSON body key
  names, not the HTML `name` attributes).
- **Submit buttons are JS-appended, not static HTML.** Every form's `.submit` div is empty in
  the markup; `$button()` appends the actual clickable element at runtime. Target
  `<form-id> .submit .base-button`, not `.submit` itself (clicking the empty container before
  JS has run, or in a race, does nothing).
- **A driver script's location matters for module resolution**, not just for `cwd`. A `.mjs`
  file outside `frontend/`'s directory tree can't resolve `frontend/node_modules/@playwright/test`
  via Node's normal ESM parent-walk even if you `cd` into `frontend/` first - hence this skill
  bundling its own `node_modules` rather than depending on the frontend's.
- **Fresh signup vs. existing Home branch differently** - a brand-new email lands on `#homeView`
  (must create a Home); an email that already has one goes straight to `#itemListView`. `drive.mjs`
  handles both via `Promise.race`, but a custom driver assuming only one path will hang.
- **The service worker is intentionally inert in dev** (`INTERCEPT_FETCH_REQUESTS = false` in
  `cacheServiceWorker.js`) - don't expect offline behavior or cache hits while testing locally;
  this is deliberate, not a bug.

## Troubleshooting

- **`ERR_CONNECTION_REFUSED` on `page.goto`**: the server isn't up (didn't start, or died - see
  the concurrent-db-access gotcha above). Check it's still listening: `netstat -ano | grep
  ':3001'`.
- **Signup silently fails / toast about an existing account or unauthorized email**: the email
  isn't allow-listed, or you're reusing one that already signed up in a previous run - either
  allow-list a new email or just let `drive.mjs`'s existing-Home branch handle it.
- **`page.click` on a submit button does nothing**: you likely targeted the empty `.submit`
  wrapper instead of `.submit .base-button` - see the gotcha above.
- **`ERR_MODULE_NOT_FOUND: @playwright/test`**: you're running a script from outside this
  skill's own directory tree without `cd`-ing here first, or skipped `npm install` in this
  folder - see One-time setup.
