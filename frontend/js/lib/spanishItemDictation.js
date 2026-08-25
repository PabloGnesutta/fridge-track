/**
 * Parses a dictated item ("Leche cantidad dos litros vencimiento en cinco
 * días" / "... vencimiento el 20 de agosto") into the item form's fields.
 * Pure and DOM-free so it's unit-testable without a browser - the mic
 * button/status UI lives in ui/voice-item-ui.js instead.
 *
 * Grammar: [nombre] (cantidad [cantidad]) ((vencimiento|vence) (en [N] días |
 * el [día] de [mes])). Only "nombre" is required; "cantidad"/"vencimiento"
 * are each independently optional and detected by keyword, not position, so
 * a transcript missing one (or with them said out of order) still parses the
 * pieces it does have instead of failing outright. Speech recognition
 * doesn't produce punctuation, so these are spoken keywords, not the
 * literal words with a trailing colon. "vence" is accepted as a shorter
 * alternative to "vencimiento" - same due-phrase keyword either way.
 */
import { parseSpanishNumber, stripAccents } from './spanishNumbers.js';
import { MONTHS } from './date.js';

/**
 * @typedef {{ name: string, quantity: string, shelfLifeDays: number|null, useByDate: Date|null }} ItemDictationResult
 */

/**
 * @param {string} s
 * @returns {string}
 */
function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * @param {string} word
 * @returns {string}
 */
function normalizeWord(word) {
  return stripAccents(word.toLowerCase());
}

/**
 * @param {string[]} rawWords - the due-phrase's words, original casing
 * @param {string[]} normWords - same words, lowercased/accent-stripped
 * @param {Date} currentDate
 * @returns {{ shelfLifeDays: number|null, useByDate: Date|null }}
 */
function parseDuePhrase(rawWords, normWords, currentDate) {
  if (normWords.includes('dias') || normWords.includes('dia')) {
    return { shelfLifeDays: parseSpanishNumber(rawWords.join(' ')), useByDate: null };
  }

  const monthIdx = normWords.findIndex(w => MONTHS.includes(w));
  if (monthIdx === -1) { return { shelfLifeDays: null, useByDate: null }; }

  const monthIndex = MONTHS.indexOf(normWords[monthIdx]);
  const day = parseSpanishNumber(rawWords.slice(0, monthIdx).join(' '));
  if (day === null || day < 1 || day > 31) { return { shelfLifeDays: null, useByDate: null }; }

  const year = currentDate.getFullYear();
  let candidate = new Date(year, monthIndex, day);
  const today = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());
  // A date already past this year means next year's occurrence was meant
  // (e.g. saying "el 3 de enero" in December means next January).
  if (candidate < today) { candidate = new Date(year + 1, monthIndex, day); }

  return { shelfLifeDays: null, useByDate: candidate };
}

/**
 * @param {string} transcript
 * @param {Date} [currentDate]
 * @returns {ItemDictationResult}
 */
function parseItemDictation(transcript, currentDate = new Date()) {
  const rawWords = (transcript || '').trim().split(/\s+/).filter(Boolean);
  /** @type {ItemDictationResult} */
  const result = { name: '', quantity: '', shelfLifeDays: null, useByDate: null };
  if (!rawWords.length) { return result; }

  const normWords = rawWords.map(normalizeWord);

  /** @type {{key: 'cantidad'|'vencimiento', idx: number}[]} */
  const keywords = [];
  normWords.forEach((word, idx) => {
    if (word === 'cantidad') { keywords.push({ key: word, idx }); }
    else if (word === 'vencimiento' || word === 'vence') { keywords.push({ key: 'vencimiento', idx }); }
  });

  const nameEnd = keywords.length ? keywords[0].idx : rawWords.length;
  result.name = capitalize(rawWords.slice(0, nameEnd).join(' ').trim());

  keywords.forEach((kw, i) => {
    const segStart = kw.idx + 1;
    const segEnd = i + 1 < keywords.length ? keywords[i + 1].idx : rawWords.length;
    const segRaw = rawWords.slice(segStart, segEnd);
    const segNorm = normWords.slice(segStart, segEnd);

    if (kw.key === 'cantidad') {
      result.quantity = segRaw.join(' ').trim();
    } else {
      const due = parseDuePhrase(segRaw, segNorm, currentDate);
      result.shelfLifeDays = due.shelfLifeDays;
      result.useByDate = due.useByDate;
    }
  });

  return result;
}


export { parseItemDictation };
