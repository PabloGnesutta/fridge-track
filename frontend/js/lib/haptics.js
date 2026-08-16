/**
 * Fires a short haptic tick via the Vibration API. Feature-detected and
 * best-effort — no-ops where unsupported (most desktop browsers, iOS
 * Safari has no Vibration API at all) rather than throwing.
 * @param {number|number[]} [pattern=15] - Duration in ms, or a vibrate/pause pattern.
 */
function haptic(pattern = 15) {
  try {
    if ('vibrate' in navigator) { navigator.vibrate(pattern); }
  } catch (e) {
    // best-effort only
  }
}


export { haptic };
