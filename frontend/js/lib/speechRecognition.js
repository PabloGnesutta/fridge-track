/**
 * Thin wrapper around the (vendor-prefixed) Web Speech API for one-shot
 * dictation. Feature-detected — callers must check
 * isSpeechRecognitionSupported() before offering any voice-input UI, since
 * support is Chromium-only at the time of writing (no Firefox, patchy
 * Safari) and requires a secure context (HTTPS, or localhost for dev).
 */

/**
 * @returns {boolean}
 */
function isSpeechRecognitionSupported() {
  // @ts-ignore - SpeechRecognition/webkitSpeechRecognition aren't in the standard lib.dom types
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/**
 * Starts listening for a single utterance and stops automatically once the
 * speech engine detects the end of speech (non-continuous mode).
 * @param {{
 *   lang?: string,
 *   onResult: (transcript: string) => void,
 *   onError?: (error: string) => void,
 *   onEnd?: () => void,
 * }} opts
 * @returns {{ stop: () => void } | null} null if unsupported or it failed to start
 */
function listenOnce({ lang = 'es-ES', onResult, onError, onEnd }) {
  // @ts-ignore
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognitionCtor) { return null; }

  const recognition = new SpeechRecognitionCtor();
  recognition.lang = lang;
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onresult = (/** @type {*} */ e) => {
    const transcript = e.results?.[0]?.[0]?.transcript || '';
    onResult(transcript);
  };
  recognition.onerror = (/** @type {*} */ e) => {
    if (onError) { onError(e.error); }
  };
  recognition.onend = () => {
    if (onEnd) { onEnd(); }
  };

  try {
    recognition.start();
  } catch (e) {
    // e.g. InvalidStateError if already listening, or a secure-context failure.
    return null;
  }

  return { stop: () => recognition.stop() };
}


export { isSpeechRecognitionSupported, listenOnce };
