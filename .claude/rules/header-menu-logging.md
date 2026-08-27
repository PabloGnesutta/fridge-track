---
paths:
  - "backend/src/logger/**"
  - "frontend/js/lib/logger.js"
  - "frontend/js/ui/ui.js"
---

# Header hamburger menu + logging

The header's standalone logout icon is a hamburger menu (`#headerMenuBtn`, built like every other icon
button via `$button()` — there was no existing dropdown/popup component anywhere in this app to reuse,
so this one is built from existing primitives: the `.display-none` toggle convention, and a
click-outside-to-close listener on `#app` in the same spirit as `modalBackdropHandler()`). The panel
holds "Cerrar sesión" (the same `#logoutBtn`, just relocated - unchanged id/logic), "Ver logs" (calls
`logger.js`'s `openLogs()`), and the notification toggles (see
`.claude/rules/notification-preferences.md`). The debug panel (`#logger`) has no other manual open
affordance — it otherwise only opens automatically via `_error()`, which was genuinely unreachable
on-demand and a real problem debugging the sync issue in `.claude/rules/sync-engine.md` on a phone
with no devtools.

**Two error-reporting paths, used deliberately for different cases** (see also `showErrorToast()` in
`js/lib/toast.js`, covered in the root `CLAUDE.md`). `_error()` (`js/lib/logger.js`) opens this in-app
dev-facing debug log panel — for unexpected/internal errors (IndexedDB failures, service worker
registration failures, uncaught exceptions/rejections). Keep this split for new error paths rather than
routing everything through one or the other.

Backend logging (`backend/src/logger/logger.js`) was a literal `// TODO: Implement logger` stub - raw
`console.debug/log/warn` re-exports, no `error` level at all, no timestamps. It's now a small wrapper
adding an ISO timestamp + level tag to every line and a real `error` export (routed to `console.error`,
not `console.log`) - no logging library, just enough to make server output (wherever it ends up: a nohup
file, `pm2 logs`, `journalctl`) greppable and correlatable against a client-side report. Every existing
`log('---Error @...', err)` call site (`apiRouter.js`'s catch-all, `requestHandler.js`'s asset-serving
error paths, `expiryNotifier.js`'s tick/notification-send catches) now uses `error(...)` instead;
non-error `log`/`debug` calls (e.g. the per-request `debug('urlArray', ...)`, or the expected-404
"file does not exist" case) are unchanged. The frontend's own `logger.js` gained a matching small
improvement: every rendered log entry is now timestamped, so multiple stacked entries from one
debugging session can be told apart by when they fired, not just what they say.
