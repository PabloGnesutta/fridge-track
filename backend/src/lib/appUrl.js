/**
 * Shared "what's the public origin of this app" helper - used to build
 * one-click links in emails (email verification, Home invites). Read
 * lazily by callers (never at module load): every caller of this module is
 * itself reachable via a static import chain from index.fridge.js, and ES
 * module imports are hoisted and evaluated before index.fridge.js's own
 * configEnv() dotenv call runs, so reading process.env.APP_BASE_URL at
 * import time would always see undefined. Falls back to localhost:PORT so
 * links still work out of the box in local dev without APP_BASE_URL set.
 * @returns {string} origin with no trailing slash, e.g. "http://localhost:3001"
 */
function getAppBaseUrl() {
  return (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/\/+$/, '');
}

export { getAppBaseUrl };
