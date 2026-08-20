const ACCESS_TOKEN_KEY = 'accessToken';
const USER_ID_KEY = 'userId';
const USER_EMAIL_KEY = 'userEmail';
const USER_NAME_KEY = 'userName';
const PUSH_ENABLED_KEY = 'pushEnabled';
const EMAIL_ENABLED_KEY = 'emailEnabled';

/**
 * @template T
 * @typedef {{
 *   data: T, error?: undefined, status?: undefined, detail?: undefined
 * } | {
 *   data?: undefined, error: string, status?: number, detail?: string
 * }} ApiResult<T>
 */

/**
 * Makes a POST request to /api/{path} with a JSON payload and Authorization
 * header. Always resolves to {data} or {error} - network failures resolve
 * {error} too (rather than throwing) so callers can fall back to the local
 * cache instead of crashing when offline.
 *
 * `status`/`detail` carry extra diagnostic context (HTTP status, raw
 * response text, or the underlying fetch exception's message) that existing
 * callers ignore - they only ever destructure `.data`/`.error`, so this is
 * purely additive. Added specifically so background callers like
 * sync/syncEngine.js can log something more actionable than a single
 * generic string when a sync silently fails on a real device with no other
 * way to inspect the network request.
 * @param {string} path
 * @param {Object} payload
 * @returns {Promise<ApiResult<*>>}
 */
async function apiCall(path, payload) {
  /** @type RequestInit["headers"] */
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + (localStorage.getItem(ACCESS_TOKEN_KEY) || ''),
  };

  /** @type {Response} */
  let response;
  try {
    // Root-relative ('/api/...'), not relative ('api/...') - a relative URL
    // resolves against the CURRENT browser path, which for a background
    // sync call is whatever client-side route the user happens to be on
    // (e.g. '/item/42'), not necessarily '/'. From '/item/42', a relative
    // 'api/sync/push' resolves to '/item/api/sync/push', which the backend
    // doesn't recognize as an API path and answers with the SPA-fallback
    // index.html (200 OK, wrong body) instead of a real API response or
    // error - silently, since nothing about that response says "wrong route"
    // on its face. Same class of gotcha CLAUDE.md already documents for
    // <script src>/<link href> tags, just missed here.
    response = await fetch(
      '/api/' + path,
      { headers, method: 'POST', body: JSON.stringify(payload) }
    );
  } catch (err) {
    return { error: 'No se pudo conectar con el servidor', detail: String(err?.message || err) };
  }

  // Read as text first, not response.json() directly - a body can only be
  // read once, and a malformed/non-JSON response (e.g. a reverse-proxy
  // error page instead of this API's JSON envelope) needs the raw text
  // available for diagnostics rather than just a generic parse failure.
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { error: 'Respuesta inválida del servidor', status: response.status, detail: text.slice(0, 300) };
  }

  if (json.error) {
    console.warn('error', json.error);
    return { error: json.error, status: response.status };
  }

  return { data: json.data };
}

/**
 * @param {{accessToken: string, userId: number, email: string, name?: string, pushEnabled?: boolean, emailEnabled?: boolean}} session
 */
function persistSession(session) {
  localStorage.setItem(ACCESS_TOKEN_KEY, session.accessToken);
  localStorage.setItem(USER_ID_KEY, String(session.userId));
  localStorage.setItem(USER_EMAIL_KEY, session.email);
  localStorage.setItem(USER_NAME_KEY, session.name || '');
  persistNotificationPreferences({
    pushEnabled: session.pushEnabled !== false,
    emailEnabled: session.emailEnabled !== false,
  });
}

function clearSession() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(USER_ID_KEY);
  localStorage.removeItem(USER_EMAIL_KEY);
  localStorage.removeItem(USER_NAME_KEY);
  localStorage.removeItem(PUSH_ENABLED_KEY);
  localStorage.removeItem(EMAIL_ENABLED_KEY);
}

/**
 * Both channels default to enabled - matches the backend columns' own
 * DEFAULT 1, so a session cached before this feature existed (no stored
 * keys yet) still renders as "on" instead of silently reading as off.
 * @returns {{pushEnabled: boolean, emailEnabled: boolean}}
 */
function getNotificationPreferences() {
  return {
    pushEnabled: localStorage.getItem(PUSH_ENABLED_KEY) !== '0',
    emailEnabled: localStorage.getItem(EMAIL_ENABLED_KEY) !== '0',
  };
}

/** @param {{pushEnabled?: boolean, emailEnabled?: boolean}} prefs */
function persistNotificationPreferences(prefs) {
  if (prefs.pushEnabled !== undefined) {
    localStorage.setItem(PUSH_ENABLED_KEY, prefs.pushEnabled ? '1' : '0');
  }
  if (prefs.emailEnabled !== undefined) {
    localStorage.setItem(EMAIL_ENABLED_KEY, prefs.emailEnabled ? '1' : '0');
  }
}

/** @returns {string|null} */
function getAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

/** @returns {boolean} */
function isLoggedIn() {
  return !!getAccessToken();
}

/**
 * @param {string} email
 * @param {string} password
 * @param {string} [name]
 */
async function apiSignup(email, password, name) {
  const result = await apiCall('signup', { email, password, name });
  if (result.data) { persistSession(result.data); }
  return result;
}

/**
 * @param {string} email
 * @param {string} password
 */
async function apiLogin(email, password) {
  const result = await apiCall('login', { email, password });
  if (result.data) { persistSession(result.data); }
  return result;
}

async function apiLogout() {
  const result = await apiCall('logout', {});
  clearSession();
  return result;
}

/** @param {string} name */
async function apiCreateHome(name) {
  return apiCall('homes/create', { name });
}

/** @param {string} joinCode */
async function apiJoinHome(joinCode) {
  return apiCall('homes/join', { joinCode });
}

async function apiListHomes() {
  return apiCall('homes/list', {});
}

/** @param {number} homeId */
async function apiSyncPull(homeId) {
  return apiCall('sync/pull', { homeId });
}

/**
 * @param {number} homeId
 * @param {{locations: object[], items: object[], foodNameHistory: object[]}} snapshot
 */
async function apiSyncPush(homeId, snapshot) {
  return apiCall('sync/push', { homeId, snapshot });
}

async function apiPushVapidKey() {
  return apiCall('push/vapid-public-key', {});
}

/** @param {PushSubscriptionJSON} subscription */
async function apiPushSubscribe(subscription) {
  return apiCall('push/subscribe', { subscription });
}

/** @param {string} endpoint */
async function apiPushUnsubscribe(endpoint) {
  return apiCall('push/unsubscribe', { endpoint });
}

/** @param {number} homeId */
async function apiRecipeSuggestions(homeId) {
  return apiCall('recipes/suggestions', { homeId });
}

/**
 * @param {{pushEnabled?: boolean, emailEnabled?: boolean}} prefs
 */
async function apiUpdateNotificationPreferences(prefs) {
  const result = await apiCall('notifications/preferences', prefs);
  if (result.data) { persistNotificationPreferences(result.data); }
  return result;
}

export {
  apiSignup, apiLogin, apiLogout, apiCreateHome, apiJoinHome, apiListHomes,
  apiSyncPull, apiSyncPush, apiPushVapidKey, apiPushSubscribe, apiPushUnsubscribe,
  apiRecipeSuggestions, apiUpdateNotificationPreferences, isLoggedIn, getAccessToken, clearSession,
  getNotificationPreferences, persistNotificationPreferences,
};
