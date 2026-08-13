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

async function subscribe() {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') { fold(banner); return; }

  const { data: vapid, error: vapidError } = await apiPushVapidKey();
  if (vapidError || !vapid?.publicKey) { _error(' - could not fetch VAPID public key', vapidError); fold(banner); return; }

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapid.publicKey),
  });

  const { error: subscribeError } = await apiPushSubscribe(subscription.toJSON());
  if (subscribeError) { _error(' - could not save push subscription', subscribeError); }
  else { _info(' - push notifications enabled'); }

  fold(banner);
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


export { initPushNotifications };
