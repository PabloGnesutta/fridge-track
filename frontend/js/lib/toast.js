import { $, $getInner, fold, unfold } from "./dom.js";


const toastEl = $('undoToast');
const messageEl = $getInner(toastEl, '.message');
const undoBtn = $getInner(toastEl, '.undo-btn');

const errorToastEl = $('errorToast');
const errorMessageEl = $getInner(errorToastEl, '.message');

/** @type {ReturnType<typeof setTimeout>|undefined} */
let hideTimeout;
/** @type {(() => void)|null} */
let currentHandler = null;

/**
 * Shows a toast with an "undo" action for a few seconds. Calling this again
 * before the previous toast's window elapses supersedes it (the previous
 * action stays committed, matching how most undo-toasts behave).
 * @param {string} message
 * @param {() => void} onUndo
 * @param {number} [durationMs]
 */
function showUndoToast(message, onUndo, durationMs = 5000) {
  clearTimeout(hideTimeout);
  if (currentHandler) {
    undoBtn.removeEventListener('click', currentHandler);
  }

  messageEl.innerText = message;
  unfold(toastEl);

  currentHandler = () => {
    clearTimeout(hideTimeout);
    undoBtn.removeEventListener('click', /** @type {() => void} */(currentHandler));
    currentHandler = null;
    fold(toastEl);
    onUndo();
  };
  undoBtn.addEventListener('click', currentHandler);

  hideTimeout = setTimeout(() => {
    undoBtn.removeEventListener('click', /** @type {() => void} */(currentHandler));
    currentHandler = null;
    fold(toastEl);
  }, durationMs);
}


/** @type {ReturnType<typeof setTimeout>|undefined} */
let errorHideTimeout;

/**
 * Shows a short-lived toast for a user-facing, actionable message (e.g.
 * "Ingresar nombre") - as opposed to unexpected/internal errors, which
 * still go through the dev-facing logger (_error) instead.
 * @param {string} message
 * @param {number} [durationMs]
 */
function showErrorToast(message, durationMs = 4000) {
  clearTimeout(errorHideTimeout);
  errorMessageEl.innerText = message;
  unfold(errorToastEl);
  errorHideTimeout = setTimeout(() => fold(errorToastEl), durationMs);
}


export { showUndoToast, showErrorToast };
