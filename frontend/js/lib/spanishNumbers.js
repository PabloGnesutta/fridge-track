/**
 * Parses spoken/dictated Spanish text into an integer. Ported from
 * car-track's lib/spanishNumbers.js (built there for odometer readings) -
 * kept dependency-free and pure so it's unit-testable without a browser;
 * the Web Speech API wrapper that feeds it live transcripts lives in
 * lib/speechRecognition.js instead.
 *
 * Handles three things at once, token by token, since real speech-to-text
 * output is inconsistent about which it gives you:
 *  - digit tokens ("20")
 *  - thousands-separated digit tokens ("50.300" / "50,300")
 *  - Spanish number words ("veinte", "cincuenta mil trescientos")
 * This dual digit/word handling is also exactly what a day-of-month or
 * day-count parser needs, so lib/spanishItemDictation.js reuses this
 * function as-is rather than reimplementing number parsing.
 */

/** @type {Record<string, number>} */
const UNIT_WORDS = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
  dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24,
  veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
  cien: 100, ciento: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400,
  quinientos: 500, seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900,
};

/** @type {Record<string, number>} */
const MULTIPLIER_WORDS = { mil: 1000, millon: 1000000, millones: 1000000 };

/** Connectors that carry no numeric value and should be ignored. */
const SKIP_WORDS = new Set(['y', 'de']);

/**
 * @param {string} s
 * @returns {string}
 */
function stripAccents(s) {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

/**
 * @param {string} text
 * @returns {number|null} the parsed integer, or null if nothing recognizable was found
 */
function parseSpanishNumber(text) {
  if (!text) { return null; }

  const words = stripAccents(text.toLowerCase())
    .replace(/[^a-z0-9.,\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  let total = 0;
  let current = 0;
  let matched = false;

  for (const word of words) {
    if (SKIP_WORDS.has(word)) { continue; }

    const digitsOnly = word.replace(/[.,]/g, '');
    if (/^\d+$/.test(digitsOnly)) {
      current += Number(digitsOnly);
      matched = true;
      continue;
    }

    const multiplier = MULTIPLIER_WORDS[word];
    if (multiplier) {
      total += (current || 1) * multiplier;
      current = 0;
      matched = true;
      continue;
    }

    const value = UNIT_WORDS[word];
    if (value !== undefined) {
      current += value;
      matched = true;
    }
    // Unrecognized words (background noise, filler like "el", etc.) are
    // silently skipped rather than failing the whole parse.
  }

  total += current;
  return matched ? total : null;
}


export { parseSpanishNumber, stripAccents };
