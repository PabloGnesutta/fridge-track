/**
 * Standard VAPID-key conversion: PushManager.subscribe's applicationServerKey
 * needs a Uint8Array, but the server hands out the key as a URL-safe base64
 * string. Pure/DOM-free so it fits the same unit-test convention as
 * lib/date.js and lib/freshnessStatus.js.
 * @param {string} base64String
 * @returns {Uint8Array}
 */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export { urlBase64ToUint8Array };
