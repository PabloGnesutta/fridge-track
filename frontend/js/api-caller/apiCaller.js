const ACCESS_TOKEN_KEY = 'accessToken';
const USER_ID_KEY = 'userId';
const USER_EMAIL_KEY = 'userEmail';
const USER_NAME_KEY = 'userName';

/**
 * @template T
 * @typedef {{data: T, error?: undefined} | {data?: undefined, error: string}} ApiResult<T>
 */

/**
 * Makes a POST request to /api/{path} with a JSON payload and Authorization
 * header. Always resolves to {data} or {error} - network failures resolve
 * {error} too (rather than throwing) so callers can fall back to the local
 * cache instead of crashing when offline.
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

  let json;
  try {
    const response = await fetch(
      'api/' + path,
      { headers, method: 'POST', body: JSON.stringify(payload) }
    );
    json = await response.json();
  } catch {
    return { error: 'No se pudo conectar con el servidor' };
  }

  if (json.error) {
    console.warn('error', json.error);
    return { error: json.error };
  }

  return { data: json.data };
}

/**
 * @param {{accessToken: string, userId: number, email: string, name?: string}} session
 */
function persistSession(session) {
  localStorage.setItem(ACCESS_TOKEN_KEY, session.accessToken);
  localStorage.setItem(USER_ID_KEY, String(session.userId));
  localStorage.setItem(USER_EMAIL_KEY, session.email);
  localStorage.setItem(USER_NAME_KEY, session.name || '');
}

function clearSession() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(USER_ID_KEY);
  localStorage.removeItem(USER_EMAIL_KEY);
  localStorage.removeItem(USER_NAME_KEY);
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

export {
  apiSignup, apiLogin, apiLogout, apiCreateHome, apiJoinHome, apiListHomes,
  apiSyncPull, apiSyncPush, apiPushVapidKey, apiPushSubscribe, apiPushUnsubscribe,
  isLoggedIn, getAccessToken, clearSession,
};
