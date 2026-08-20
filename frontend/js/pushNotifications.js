import { $, fold, unfold, makeKeyboardActivatable } from "./lib/dom.js";
import { urlBase64ToUint8Array } from "./lib/pushUtil.js";
import { apiPushVapidKey, apiPushSubscribe } from "./api-caller/apiCaller.js";
import { _info, _error } from "./lib/logger.js";


const DISMISSED_KEY = 'notifBannerDismissed';

const banner = $('notifBanner');
const activateBtn = $('activateNotifBtn');
const dismissBtn = $('dismissNotifBtn');

// Wired once at module load (unlike installPrompt.js's init, initPushNotifications()
// can run again on every Home switch, not just once at boot - listeners must stay idempotent).
activateBtn.addEventListener('click', subscribe);
dismissBtn.addEventListener('click', dismiss);
makeKeyboardActivatable(activateBtn);
makeKeyboardActivatable(dismissBtn);

function isSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function dismiss() {
  localStorage.setItem(DISMISSED_KEY, '1');
  fold(banner);
}

/**
 * Requests permission (a no-op prompt-wise if already granted/denied) and
 * subscribes this device, saving the subscription server-side. Also used by
 * the header-menu push toggle (ui.js's initNotificationToggles()), not just
 * the opt-in banner - hence returning a boolean instead of just folding the
 * banner, so a caller with no banner of its own can react to failure.
 * @returns {Promise<boolean>}
 */
async function subscribe() {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') { fold(banner); return false; }

  const { data: vapid, error: vapidError } = await apiPushVapidKey();
  if (vapidError || !vapid?.publicKey) { _error(' - could not fetch VAPID public key', vapidError); fold(banner); return false; }

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapid.publicKey),
  });

  const { error: subscribeError } = await apiPushSubscribe(subscription.toJSON());
  fold(banner);
  if (subscribeError) { _error(' - could not save push subscription', subscribeError); return false; }

  _info(' - push notifications enabled');
  return true;
}

/**
 * Whether this device actually has a live, permitted push subscription -
 * the real capability signal, kept deliberately separate from the stored
 * pushEnabled preference (apiCaller.js's getNotificationPreferences()).
 * A fresh signup defaults pushEnabled to true (matches the DB column's own
 * DEFAULT 1) despite having no subscription yet, and a denied/revoked
 * browser permission doesn't change that stored preference either - so
 * "is the toggle actually ON" has to be computed from both, not read off
 * the preference alone. See ui.js's initNotificationToggles().
 * @returns {Promise<boolean>}
 */
async function hasActiveSubscription() {
  if (!isSupported()) { return false; }
  if (Notification.permission !== 'granted') { return false; }
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return !!subscription;
}

/**
 * Shows an opt-in banner for expiry push notifications, mirroring
 * installPrompt.js's exact pattern (localStorage dismissal, .folded banner).
 * Only shown while permission is still 'default' - once granted or denied,
 * the browser itself won't re-prompt, so there's nothing more to ask.
 */
function initPushNotifications() {
  if (!isSupported()) { return; }
  if (localStorage.getItem(DISMISSED_KEY)) { return; }
  if (Notification.permission !== 'default') { return; }

  unfold(banner);
}


export {
  initPushNotifications, isSupported as isPushSupported, subscribe as subscribeToPush,
  hasActiveSubscription,
};
