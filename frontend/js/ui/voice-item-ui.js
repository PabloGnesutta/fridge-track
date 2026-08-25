import { $button, $getInner, $queryOne, $queryOneInput } from "../lib/dom.js";
import { isSpeechRecognitionSupported, listenOnce } from "../lib/speechRecognition.js";
import { parseItemDictation } from "../lib/spanishItemDictation.js";
import { toYYYYMMDD } from "../lib/date.js";
import { svg_mic } from "../svg/svgFn.js";
import { haptic } from "../lib/haptics.js";
import { openItemForm } from "./item-ui.js";


const micBtnContainer = $queryOne('#itemForm .mic-btn');
const newItemVoiceBtnContainer = $queryOne('#newItemVoiceBtn');
const statusEl = $getInner($queryOne('#itemForm .name-field'), '.voice-status');
const itemNameInput = $queryOneInput('#itemForm input[name="itemName"]');
const quantityInput = $queryOneInput('#itemForm input[name="quantity"]');
const useByDateInput = $queryOneInput('#itemForm input[name="useByDate"]');
const shelfLifeDaysInput = $queryOneInput('#itemForm input[name="shelfLifeDays"]');

/** @type {(() => void) | null} */
let activeStop = null;

/** @type {Record<string, string>} */
const ERROR_MESSAGES = {
  'not-allowed': 'Se necesita permiso del micrófono.',
  'no-speech': 'No se detectó voz. Probá de nuevo.',
  'audio-capture': 'No se encontró un micrófono.',
};

/**
 * Adds a mic button to the item form that dictates name/cantidad/vencimiento
 * in Spanish (parsed via lib/spanishItemDictation.js) instead of typing
 * them. The button stays hidden where the Web Speech API isn't supported.
 */
function initVoiceItemUi() {
  if (!isSpeechRecognitionSupported()) { return; }

  micBtnContainer.classList.remove('display-none');
  $button({
    svgFn: svg_mic,
    ariaLabel: 'Dictar por voz',
    appendTo: micBtnContainer,
    listener: { fn: () => (activeStop ? activeStop() : startListening()) },
  });

  // Floating button next to "newItemBtn" - opens the item form straight into
  // dictation instead of focusing itemName first (which would pop the
  // on-screen keyboard open on mobile right before voice input takes over).
  newItemVoiceBtnContainer.classList.remove('display-none');
  $button({
    svgFn: svg_mic,
    ariaLabel: 'Agregar alimento por voz',
    appendTo: newItemVoiceBtnContainer,
    listener: { fn: () => { openItemForm(false, false); startListening(); } },
  });
}

/** Clears any stale status message from a previous dictation attempt. */
function resetVoiceStatus() {
  setStatus('', '');
}

function startListening() {
  setStatus('Escuchando…', 'listening');
  micBtnContainer.classList.add('listening');
  haptic();

  const handle = listenOnce({
    lang: 'es-ES',
    onResult: transcript => {
      const { name, quantity, shelfLifeDays, useByDate } = parseItemDictation(transcript);
      if (!name) {
        setStatus(`No se entendió ("${transcript}"). Probá de nuevo o escribilo.`, 'error');
        return;
      }

      itemNameInput.value = name;
      if (quantity) { quantityInput.value = quantity; }
      if (useByDate) { useByDateInput.value = toYYYYMMDD(useByDate); }
      if (shelfLifeDays != null) { shelfLifeDaysInput.value = String(shelfLifeDays); }

      setStatus(`Se detectó "${name}" — revisá y confirmá.`, 'success');
    },
    onError: error => {
      setStatus(ERROR_MESSAGES[error] || 'No se pudo reconocer la voz. Intentá de nuevo.', 'error');
    },
    onEnd: () => {
      micBtnContainer.classList.remove('listening');
      activeStop = null;
    },
  });

  if (!handle) {
    setStatus('No se pudo iniciar el micrófono.', 'error');
    micBtnContainer.classList.remove('listening');
    return;
  }
  activeStop = handle.stop;
}

/**
 * @param {string} text
 * @param {string} type
 */
function setStatus(text, type) {
  statusEl.innerText = text;
  statusEl.dataset.type = type;
}


export { initVoiceItemUi, resetVoiceStatus };
