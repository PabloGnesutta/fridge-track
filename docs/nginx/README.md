# nginx IP rate limiting (all apps on this box)

Added in response to real bot/scanner traffic exhausting fridge-track's
email-sending quota (signup + resend-verification + invite all send mail).
This lives at the nginx layer, not in the Node app, specifically so every
app nginx fronts on this server benefits, not just fridge-track.

Your actual config (`default.example`, copied from
`/etc/nginx/sites-available/default`) is a single file holding every app's
`server {}` block directly - no `conf.d`/`snippets` split. That means the
rate-limiting zone definitions can just live at the top of this same file,
loaded once, and every server block below opts in with a couple of lines.

## Incident: the first version of this broke every app's page load

The first `perip_general` zone shipped here was `rate=10r/s, burst=20
nodelay` with `limit_conn 20`. That's tight enough to break a real page
load, not just bots: these apps have no bundler, so a single page load fires
off a couple dozen near-simultaneous requests (every JS module as its own
file, CSS, manifest/icons/service worker registration, plus several
boot-time `/api/*` calls) - all counted against the same per-IP bucket.
Real traffic exhausted the burst allowance instantly, and everything past it
got a hard 429 right alongside actual bot traffic - which looked like a page
starting to load and then stalling, exactly what got reported after
deploying it.

Fixed by loosening the general zone considerably (`rate=30r/s, burst=80
nodelay`, `limit_conn` raised to 40) - it's now meant to only catch a
sustained flood, not absorb one real browser's opening burst. The strict
zone (`perip_strict`, scoped only to specific auth/email routes that a real
user hits a handful of times per session at most) was never the problem and
is unchanged. **Don't tighten `perip_general` back down without testing an
actual page load against it first** - that's what broke this the first time.

## What changed

`default.ratelimited.example` in this folder is your `default.example` with:

1. Three zone definitions added at the very top of the file (must be outside
   any `server {}` block - `limit_req_zone`/`limit_conn_zone` are only legal
   at this top level):
   - `perip_general` - 30 req/s per IP (burst=80 nodelay), generous baseline
     for real traffic - see the incident note above for why it's this loose.
   - `perip_strict` - 5 req/**minute** per IP, for routes that cost real
     quota per hit.
   - `perip_conn` - caps concurrent connections per IP (40).
   - Plus `limit_req_status 429` / `limit_conn_status 429` / a `warn` log
     level, so throttled requests come back as 429 and don't read as server
     errors in your logs.
2. `limit_conn perip_conn 40;` + `limit_req zone=perip_general burst=80
   nodelay;` added to **every** `server {}` block (root, websynth, habit
   tracker, car tracker, fridge tracker, snap, sueldo, sonar) - this is the
   "applies to all my apps" part.
3. An extra, tighter `location` block added inside both the Fridge tracker
   and Car tracker servers, applying `perip_strict` (5 req/min) to just their
   own auth-ish routes - the part that actually stops a bot from re-burning
   the SMTP quota or hammering login. The general baseline in (2) alone
   would not have been tight enough for that, since even 30 req/s is still
   plenty to blow through an email quota or brute-force a password fast:
   - Fridge tracker: `/api/(signup|login|resend-verification|verify-email|
     homes/invite)` - all of these can trigger an outbound email.
   - Car tracker: `/api/(signup|login)` - checked its actual
     `backend/src/http/apiRouter.js`; unlike fridge-track it has no
     email-verification flow or invite system, just those two routes.
4. `listen 443;` changed to `listen 443 ssl;` on the Habit tracker, Car
   tracker, and Fridge tracker blocks. Previously only Root/Websynth/Snap/
   Sueldo/Sonar declared `ssl` on port 443, and nginx was applying TLS to
   the other three anyway because they share the same `443` socket as a
   block that does declare it - a legacy/undocumented-reliance pattern.
   Declaring it explicitly on every block removes that reliance; behavior
   for site visitors doesn't change, this just stops depending on
   listen-directive merging to keep working.

Everything else (ssl_certificate paths, proxy_pass ports, the commented-out
Chess block, the map/redirect server) is untouched, byte-for-byte.

## Deploy it

```
sudo cp /etc/nginx/sites-available/default /etc/nginx/sites-available/default.bak-$(date +%F)
sudo cp default.ratelimited.example /etc/nginx/sites-available/default
sudo nginx -t
sudo systemctl reload nginx
```

(`nginx -t` validates syntax before anything reloads - if it errors, nothing
on the live site is affected yet.)

## Verify it's working

```
for i in $(seq 1 8); do curl -s -o /dev/null -w "%{http_code}\n" -X POST https://fridge.pablognesutta.com/api/login -d '{}' -H 'Content-Type: application/json'; done
```

Expect the first couple to come back as your app's normal error (400/401 -
not a real login, just proving the route responds) and the rest to turn into
`429` once you're past ~5 in that same minute from one IP.

Also actually **open each app in a browser with devtools' Network tab open**
and do a hard refresh - this is the check that would have caught the
original incident. Confirm every request in that one page load comes back
200 (or the app's normal codes), none of them 429. If you want to check the
general zone's ceiling directly instead:

```
for i in $(seq 1 40); do curl -s -o /dev/null -w "%{http_code} " https://fridge.pablognesutta.com/; done; echo
```

Expect all `200`s well past 40 in a single burst (burst=80) - if you see
`429` in there, the general zone is still too tight for that app's real
traffic pattern.

## What this does and doesn't cover

- Slows down/soft-blocks a single IP hammering an endpoint. It does **not**
  outright ban an IP, and a botnet spreading requests across many IPs will
  mostly sail under the per-IP thresholds.
- If bots keep getting through despite this, the next step is **fail2ban**
  watching nginx's access log for repeated `429`s and firewalling those IPs
  for a cooldown period - a separate, bigger piece of server config, not
  included here. Worth doing if this alone doesn't bring the noise down.
- Habit tracker, Snap, Sueldo, and Sonar only got the general baseline, not
  a strict auth zone - I didn't check whether those apps have their own
  signup/login/email routes worth tightening the same way. Worth doing the
  same lookup (find their `apiRouter.js` or equivalent, see which routes
  actually send email or check a password) if they see similar abuse.
- App-level guardrails already exist too and are worth keeping in mind
  alongside this: `MAX_VERIFICATION_ATTEMPTS`, the verification-resend
  cooldown, and invite-by-email now being creator-only (see
  `backend/src/services/homeService.js`).
