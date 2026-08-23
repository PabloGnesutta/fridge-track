# nginx hardening (rate limiting, TLS, headers - all apps on this box)

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

`ssl_certificate` paths and `proxy_pass` ports are untouched throughout. See
the next section for a second, later pass that touched everything else
(TLS/headers/logging/the port-80 redirect/HTTP2) - the commented-out Chess
block was removed from the working file independently of either pass (not
by either of these changes) and isn't restored here.

## Hardening pass: TLS, headers, logging, the port-80 redirect, HTTP/2

A second pass after the rate-limiting one above, prompted by a "what else
would you improve here" review. nginx version on this box is **older than
1.19.4** (confirmed by you) - that ruled out `ssl_reject_handshake` and the
newer separate `http2 on;` directive, so both hardening items below use the
older, compatible forms instead.

1. **`server_tokens off;`** - stops nginx from announcing its own version in
   the `Server:` response header and default error pages. Free removal of
   one easy fingerprinting signal.
2. **gzip** for text/js/css/json/svg - directly complementary to the
   service-worker caching work in the main repo: smaller transfers on top of
   fewer repeat fetches, for apps that ship many small separate files with no
   bundler. `gzip on;` itself is **not** set in this file - your `nginx.conf`
   already turns it on (Debian/Ubuntu's stock default), and repeating it here
   would be a duplicate directive (see the incident note below). Only
   `gzip_vary`/`gzip_min_length`/`gzip_types` (all left commented out in your
   `nginx.conf`) are added here.
3. **TLS hardening**: an ECDHE/CHACHA20-only `ssl_ciphers` list (no DHE -
   avoids needing a `ssl_dhparam` file, none existed before this), plus a
   shared session cache/timeout and `ssl_session_tickets off;` for forward
   secrecy - all safe to set here since `nginx.conf` doesn't touch them.
   `ssl_protocols`/`ssl_prefer_server_ciphers` are deliberately **not** set
   in this file even though they were originally part of this same
   hardening pass - your `nginx.conf` already sets both (`ssl_protocols
   TLSv1 TLSv1.1 TLSv1.2 TLSv1.3;` and `ssl_prefer_server_ciphers on;`), so
   they'd hit the same duplicate-directive error gzip did. See "nginx.conf
   changes" below for the actual fix - it belongs there, not here.
4. **HSTS**, but deliberately narrow: `Strict-Transport-Security:
   max-age=31536000` (no `includeSubDomains`, no `preload`) added only to
   the **ROOT** (`pablognesutta.com`) server block, per your call - several
   unrelated hobby subdomains live under this one domain, and
   `includeSubDomains` would force all of them (including any not-yet-built
   one) into HTTPS-only for as long as a visiting browser remembers the
   header, which is slow to walk back if a future subdomain isn't
   HTTPS-ready. Add the same header to another vhost's own server block
   individually if you want it there too - it does NOT cascade from ROOT to
   the others.
5. **The port-80 redirect no longer trusts an arbitrary `Host` header.**
   Previously a single `server_name _;` block redirected `https://$host...`
   for *any* Host a request carried - including one an attacker sets by hand
   hitting the bare IP, which nginx would happily 301 back out to
   (`https://evil.com/...`). Now there are two port-80 blocks: one listing
   every real vhost by name (`server_name pablognesutta.com
   websynth.pablognesutta.com ...`) that still uses `$host` for the redirect
   target - safe now, since this block is only ever reached for one of those
   exact names - and a `default_server` catch-all for anything else that just
   `return 444;`s (closes the connection, no response). **Add any new
   subdomain to that list before pointing DNS at it**, or its first requests
   will hit the 444 catch-all instead of redirecting.
6. **A matching catch-all added on port 443** for TLS connections whose
   SNI/Host doesn't match any real vhost - without one, nginx silently uses
   whichever `443` block appears *first* in the file (ROOT) as the fallback,
   meaning a bot scanning the bare IP by SNI could get served ROOT's real
   content. The new block is marked `default_server`, presents ROOT's cert
   (a cert is still required to complete any TLS handshake on the socket
   regardless of SNI match - there's no way around presenting *something*
   pre-1.19.4) and then `return 444;`s immediately. Revisit with
   `ssl_reject_handshake on;` instead if this box's nginx is ever upgraded
   past 1.19.4 - it can skip presenting a cert at all.
7. **Removed `proxy_ssl_name` from every block.** It only affects proxying
   to an `https://` upstream; every `proxy_pass` here targets plain
   `http://localhost:PORT`, so it was dead weight everywhere it appeared -
   including on the Sueldo block, where its value
   (`request-data.pablognesutta.com`) didn't even match that block's own
   domain (`sueldo.pablognesutta.com`), a copy-paste leftover with zero
   effect either way.
8. **Standard proxy headers added to every block**: `Host`, `X-Real-IP`,
   `X-Forwarded-For`, `X-Forwarded-Proto` (via the `map $http_x_forwarded_proto
   $redirect_scheme` block already at the top of the file, which existed
   before this pass but was never actually wired to anything - it is now).
   Without these, every backend app previously saw all requests as coming
   from `127.0.0.1` on plain `http`, regardless of the real visitor's IP/
   protocol - fine for apps that don't care, but blind for any app that logs
   or makes decisions by client IP. Confirmed fridge-track itself doesn't
   depend on the `Host` header for anything (`getAppBaseUrl()` reads
   `APP_BASE_URL` from env instead - see `backend/src/lib/appUrl.js`), so
   this is a pure addition, not a behavior change for it.
9. **Per-app `access_log`/`error_log`** (e.g. `/var/log/nginx/fridge.access.log`)
   added to every server block, so figuring out which app is under bot
   pressure - or checking one app's own 429 rate - doesn't mean grepping one
   shared combined log. **This assumes the standard Debian/Ubuntu default
   log paths/format were otherwise untouched** - if your box's actual
   default `access_log`/`error_log` directives (wherever they live in
   `nginx.conf` itself) use a custom format or path, check that these new
   per-app logs don't need matching adjustment. Because a server-level
   `access_log` replaces (not adds to) the inherited default rather than
   supplementing it, requests now land in these per-app files instead of
   whatever combined log they went to before - **update the fail2ban idea
   below to watch the per-app files (or all of `/var/log/nginx/*.access.log`)
   instead of a single combined log.**
10. **HTTP/2** (`listen 443 ssl http2;` - the older combined-directive form,
    matching this box's pre-1.19.4 nginx) on every 443 block, including the
    new catch-all. Lets one browser multiplex the couple-dozen per-load
    requests these no-bundler apps make over far fewer actual connections -
    directly relevant to the traffic pattern that broke the original rate
    limit zone.

### Considered, not implemented

- **Consolidating the sprawl of separate cert lineages** (`-0001`/`-0002`
  suffixes on several `letsencrypt/live/...` paths, suggesting Certbot
  created new lineages instead of expanding one with `--expand`). Not done
  here because it requires actually running Certbot commands against the
  live box (re-issuing/expanding real certificates) - a state-changing
  action on your actual server, not something to script blind from a config
  file edit. Worth doing by hand if you want fewer things to independently
  track/renew.
- **`client_max_body_size`** tuning - left at nginx's 1m default. No
  evidence any of these apps needs larger request bodies; revisit if one
  starts rejecting uploads.
- **Upstream `keepalive`** (an `upstream {}` block per app + `proxy_http_version
  1.1;`) to avoid re-opening a fresh connection to `localhost:PORT` per
  request. Skipped as a structural change with a marginal payoff here -
  the proxied hop is loopback, already about as cheap as a hop gets.
- **`ssl_reject_handshake`** - see item 6 above; not available on this box's
  nginx version, `return 444` after presenting a cert is the compatible
  substitute.

### Incident: `nginx -t` failed with "gzip" directive is duplicate

`nginx -t` on the first version of this hardening pass failed with:
```
nginx: [emerg] "gzip" directive is duplicate in /etc/nginx/sites-enabled/default:57
```
Cause: this file's top-level directives load into the exact same `http{}`
context as `nginx.conf`'s own `http{}` block (via `sites-enabled`), and
`gzip on;` was already active there (Debian/Ubuntu's stock template ships it
uncommented). A child context (`server`/`location`) can safely *override* a
parent directive, but redefining the exact same directive twice in the exact
same context is a hard error, not an override - unlike the earlier
`listen`/`ssl` merging behavior documented above, which nginx does allow to
combine across blocks.

Checking `nginx.conf` (`grep -n -E 'gzip|server_tokens|ssl_protocols|...'
/etc/nginx/nginx.conf`) turned up two more of the same class of conflict
that `nginx -t` just hadn't reached yet: `ssl_protocols` and
`ssl_prefer_server_ciphers`, both already active there. Fixed by removing
all three from this file (see items 2/3 above) - `gzip`'s directives that
were only *commented out* in `nginx.conf` (`gzip_vary`, `gzip_min_length`,
`gzip_types`) were kept, since those genuinely don't conflict.
`ssl_protocols`/`ssl_prefer_server_ciphers` still need a real fix, just in
`nginx.conf` itself - see below.

**Before adding any new top-level directive to this file in the future,
grep `nginx.conf` for it first** - anything this file sets at the top level
(outside a `server{}` block) is a candidate for this exact class of error.

## nginx.conf changes (do these separately - not part of default.ratelimited.example)

Two lines in `/etc/nginx/nginx.conf`'s `http {}` block are worth updating
directly, since the config in this repo can't safely duplicate them (see the
incident above) and they're the actual point of the TLS hardening:

```
# before:
ssl_protocols TLSv1 TLSv1.1 TLSv1.2 TLSv1.3; # Dropping SSLv3, ref: POODLE
ssl_prefer_server_ciphers on;

# after:
ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers off;
```

- **Dropping TLSv1/TLSv1.1** is the one change in this whole pass with a
  real (if small) compatibility cost: any client that still only speaks
  TLS 1.0/1.1 (very old browsers, ancient IoT/embedded devices) would no
  longer be able to connect to *any* site on this box, not just one vhost.
  Every major browser deprecated 1.0/1.1 years ago and this is now standard
  guidance (PCI-DSS requires it disabled) - almost certainly fine for a
  personal-projects server, but it's a real behavior change, unlike
  everything else in this pass, so it's called out rather than folded in
  silently.
- **`ssl_prefer_server_ciphers off`** matches current Mozilla "intermediate"
  guidance - TLS 1.3 always lets the client choose regardless of this
  setting, and for TLS 1.2, letting the client pick from this file's already
  curated-strong `ssl_ciphers` list is now the recommended default over
  forcing server preference.

Back up first, edit, then validate before reloading:
```
sudo cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.bak-$(date +%F)
sudo nano /etc/nginx/nginx.conf   # or your editor of choice
sudo nginx -t
sudo systemctl reload nginx
```

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

**Checking the hardening pass specifically:**

```
curl -sI https://pablognesutta.com/ | grep -i 'strict-transport-security\|server:'
```
Expect a `strict-transport-security: max-age=31536000` line, and either no
`server:` line at all or one with no version number (confirms
`server_tokens off;`). Repeat against another vhost (e.g.
`fridge.pablognesutta.com`) and expect the HSTS header to be **absent**
there - it's deliberately ROOT-only.

```
curl -sI https://fridge.pablognesutta.com/js/app.js -H 'Accept-Encoding: gzip' | grep -i content-encoding
```
Expect `content-encoding: gzip`.

```
curl -sk -I https://pablognesutta.com/ --resolve pablognesutta.com:443:127.0.0.1
openssl s_client -connect fridge.pablognesutta.com:443 -servername totally-unknown-host.example < /dev/null
```
The second command should complete a TLS handshake (it'll present ROOT's
cert) and then the connection should just close with no HTTP response at
all - confirms the new 443 catch-all's `return 444;` is doing its job
instead of quietly serving ROOT's real content.

```
curl -s -o /dev/null -w "%{http_code}\n" -H 'Host: some-made-up-name.example' http://<this-box's-IP>/
```
Expect this to hang up / return no normal response (444) rather than a 301 -
confirms the port-80 catch-all, not the named-vhost block, is handling an
unrecognized Host.

## What this does and doesn't cover

- Slows down/soft-blocks a single IP hammering an endpoint. It does **not**
  outright ban an IP, and a botnet spreading requests across many IPs will
  mostly sail under the per-IP thresholds.
- If bots keep getting through despite this, the next step is **fail2ban**
  watching for repeated `429`s and firewalling those IPs for a cooldown
  period - a separate, bigger piece of server config, not included here.
  Point it at `/var/log/nginx/*.access.log` (plural, glob) now that logging
  is split per app (see item 9 in the hardening pass above) rather than one
  combined file. Worth doing if this alone doesn't bring the noise down.
- Habit tracker, Snap, Sueldo, and Sonar only got the general baseline, not
  a strict auth zone - I didn't check whether those apps have their own
  signup/login/email routes worth tightening the same way. Worth doing the
  same lookup (find their `apiRouter.js` or equivalent, see which routes
  actually send email or check a password) if they see similar abuse.
- App-level guardrails already exist too and are worth keeping in mind
  alongside this: `MAX_VERIFICATION_ATTEMPTS`, the verification-resend
  cooldown, and invite-by-email now being creator-only (see
  `backend/src/services/homeService.js`).
