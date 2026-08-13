import { $, $getInner, makeKeyboardActivatable } from "./dom.js";


const dialog = $('confirmDialog');
const messageEl = $getInner(dialog, '.confirm-message');
const backdrop = $getInner(dialog, '.backdrop');
const cancelBtn = $('confirmCancelBtn');
const okBtn = $('confirmOkBtn');

/** @type {(() => void)|null} */
let onConfirm = null;

function close() {
  dialog.classList.remove('open');
  onConfirm = null;
}

cancelBtn.addEventListener('click', close);
backdrop.addEventListener('click', close);
okBtn.addEventListener('click', () => {
  const confirmed = onConfirm;
  close();
  if (confirmed) { confirmed(); }
});
makeKeyboardActivatable(cancelBtn);
makeKeyboardActivatable(okBtn);

/**
 * Shows a custom-styled confirm dialog in place of the browser's native
 * confirm(), which looked out of place against the app's own dark styling
 * and couldn't be dismissed via the backdrop like every other overlay here.
 * @param {string} message
 * @param {() => void} onConfirmed Called only if the user confirms.
 */
function showConfirmDialog(message, onConfirmed) {
  messageEl.innerText = message;
  onConfirm = onConfirmed;
  dialog.classList.add('open');
}

export { showConfirmDialog };
