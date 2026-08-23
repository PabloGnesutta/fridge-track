NOTES:
cacheServiceWorker.js serves everything cache-first (index.html/css/js/static). The cache version
doesn't need manual bumping: .githooks/pre-commit hashes the exact fileset it covers and writes the
result into cacheServiceWorker.js's cacheVersion const automatically on every commit that touches
any of those files - see "Service worker caching" in CLAUDE.md for the full mechanism.

One-time setup: `cd frontend && npm install` runs the "prepare" script, which wires up the hook via
`git config core.hooksPath .githooks`. If that's ever skipped, run `git config core.hooksPath
.githooks` from anywhere inside the repo by hand.

While actively editing without committing, a browser tab stays on the pre-last-commit cached
version - the classic "PWA + service worker" dev annoyance. Use devtools' "Disable cache" (or
Application tab -> Service Workers -> "Update on reload") while iterating, or flip
cacheServiceWorker.js's BYPASS_CACHE to true locally (never commit it that way).
