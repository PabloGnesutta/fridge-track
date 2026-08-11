import { $, $getInner, fold, unfold, undisplay } from "./lib/dom.js";
import { _info } from "./lib/logger.js";


const DISMISSED_KEY = 'installBannerDismissed';

const banner = $('installBanner');
const messageEl = $getInner(banner, '.message');
const installBtn = $('installBtn');
const dismissBtn = $('dismissInstallBtn');

/** Chrome/Edge's captured install prompt, saved so it can be replayed from our own button instead of a browser-timed banner. */
/** @type {*} */
let deferredPrompt = null;

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true; // iOS Safari
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function dismiss() {
  localStorage.setItem(DISMISSED_KEY, '1');
  fold(banner);
}

/**
 * Shows an "install this app" banner: a one-tap install button on
 * Chrome/Edge (via the beforeinstallprompt event, which the browser would
 * otherwise surface on its own schedule), or manual Share-sheet
 * instructions on iOS Safari, which has no install API at all.
 */
function initInstallPrompt() {
  if (isStandalone() || localStorage.getItem(DISMISSED_KEY)) { return; }

  dismissBtn.addEventListener('click', dismiss);

  if (isIos()) {
    messageEl.innerText = 'Instalá la app: tocá Compartir y luego "Agregar a inicio"';
    undisplay(installBtn);
    unfold(banner);
    return;
  }

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    messageEl.innerText = 'Instalá la app para un acceso más rápido';
    unfold(banner);
  });

  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) { return; }
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    _info(' - install prompt outcome:', outcome);
    deferredPrompt = null;
    fold(banner);
  });

  window.addEventListener('appinstalled', () => {
    _info(' - app installed');
    fold(banner);
  });
}


export { initInstallPrompt };
