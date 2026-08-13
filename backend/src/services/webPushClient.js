import webpush from 'web-push';

// Configured lazily, not at module top level: this module is statically
// imported (transitively, via expiryNotifier.js) from index.js, and ES
// module imports are hoisted - they all evaluate before index.js's own
// configEnv() call runs, so process.env.VAPID_* would still be undefined
// if read here at import time (the same ESM ordering quirk index.js's own
// header comment warns about).
let configured = false;

function getWebPush() {
  if (!configured) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT,
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
    configured = true;
  }
  return webpush;
}

export { getWebPush };
