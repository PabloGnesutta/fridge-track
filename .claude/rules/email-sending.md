---
paths:
  - "backend/src/lib/emailTemplate.js"
  - "backend/src/services/mailClient.js"
  - "backend/src/services/emailService.js"
---

# Email sending — scaffolding only, not wired to any feature yet

Generic outbound-email capability, added ahead of any specific feature needing it (a "vencimiento hoy"
digest, a password-reset flow, etc. would all consume it later) and deliberately built to be portable —
copy the three files below into another project and they work unchanged, no fridge-track-specific
coupling. Same `create*Service`-factory/injectable-client shape as `recipeService.js`+`edamamClient.js`
(`.claude/rules/recipe-suggestions.md`), split three ways:

- `backend/src/lib/emailTemplate.js` — pure, dependency-free `renderEmailHtml({title, bodyText, appName})`.
  Turns a plain-text body into a self-contained HTML document (inline CSS only, no `<style>` block or
  external asset, since some mail clients strip/block both) with basic styling — a dark header bar, a
  white card, blank-line-separated paragraphs, single newlines as `<br>`. No template engine; unit-tested
  like the other DOM-free `lib/` modules.
- `backend/src/services/mailClient.js` — wraps `nodemailer`'s SMTP transport (not a provider-specific API
  like SES/SendGrid, so switching providers later is just env vars) behind `getMailTransport()`, memoized
  and configured lazily on first call for the same ESM-import-hoisting reason `webPushClient.js`/
  `edamamClient.js` already document — reading `process.env.SMTP_*` at module top level would always see
  `undefined`, since this module loads before `index.fridge.js`'s `configEnv()` dotenv call runs.
- `backend/src/services/emailService.js` — `createEmailService(mailClient = {getMailTransport})` exposes
  `sendEmail({to, subject, text, html?, appName?})`, auto-generating the HTML via `emailTemplate.js` unless
  the caller already supplies `html`. `sendEmail()` **never throws** — it logs and returns `false` on
  missing SMTP config or a transport failure, so a caller can fire-and-forget without a try/catch. This
  is what `expiryNotifier.js` relies on (`.claude/rules/push-notifications.md`) to email an admin alert on
  scheduler failures without risking the scheduler itself on a broken SMTP config.

Config lives in `backend/.env` (`SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`/`SMTP_USER`/`SMTP_PASS`/`MAIL_FROM`/
`MAIL_APP_NAME`, all optional/blank in `.env.example`) the same way `PORT`/`VAPID_*` already are. Not
wired to any route or trigger — no allocated use case yet, so nothing calls `sendEmail()` in the app. To
use it: `import { createEmailService } from './services/emailService.js'; const { sendEmail } =
createEmailService(); await sendEmail({to, subject, text})`.
