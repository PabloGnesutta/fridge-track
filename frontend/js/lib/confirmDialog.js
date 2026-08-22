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
  okBtn.classList.remove('danger');
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
 * @param {{danger?: boolean}} [opts] `danger: true` turns the OK button red
 *   (confirm-dialog.css already had a `#confirmOkBtn.danger` rule with
 *   nothing ever toggling it) - for actions with no undo and a blast radius
 *   bigger than the usual "delete one thing" confirm, e.g. deleting a whole
 *   Home out from under every one of its members.
 */
function showConfirmDialog(message, onConfirmed, opts = {}) {
  messageEl.innerText = message;
  onConfirm = onConfirmed;
  okBtn.classList.toggle('danger', !!opts.danger);
  dialog.classList.add('open');
}

export { showConfirmDialog };
