---
paths:
  - "frontend/js/lib/speechRecognition.js"
  - "frontend/js/lib/haptics.js"
  - "frontend/js/lib/spanishNumbers.js"
  - "frontend/js/lib/spanishItemDictation.js"
  - "frontend/js/ui/voice-item-ui.js"
---

# Voice dictation for adding items

A mic button on the item form ("Nombre" field) lets you dictate "Leche cantidad dos litros
vencimiento en cinco días" instead of typing — it only fills the form fields, never auto-submits,
so the user always reviews before saving. Ported from the sibling `car-track` project, which has
the identical shape of feature for its mileage form: `frontend/js/lib/speechRecognition.js`
(feature-detected Web Speech API wrapper, `isSpeechRecognitionSupported()`/`listenOnce({lang,
onResult, onError, onEnd})`, ported verbatim) and `frontend/js/lib/haptics.js` (best-effort
Vibration API tick, ported verbatim) came across unchanged. `frontend/js/lib/spanishNumbers.js`
(word/digit Spanish number parser, e.g. "veinte" or "20" → 20) was ported too, trimmed of
car-track's odometer-specific skip words — its dual digit/word handling is exactly what a
day-of-month parser needs, so it's reused as-is rather than reimplemented.

The one genuinely new piece is `frontend/js/lib/spanishItemDictation.js`'s `parseItemDictation()`:
unlike car-track's single-number mileage field, this dictates multiple fields from one utterance.
**Speech recognition produces words, not punctuation** — so segments are found by the *spoken
keywords* "cantidad"/"vencimiento" (searched by position, independently optional, order-tolerant),
not by literal semicolons/colons someone can't actually say aloud. "vencimiento en N días" fills
`shelfLifeDaysInput`; "vencimiento el D de MES" parses an absolute date (day via
`parseSpanishNumber`, month via a reverse lookup against `lib/date.js`'s exported `MONTHS` array —
reused, not duplicated) and rolls to next year if that date's already passed this year. Pure and
DOM-free, so it's unit-tested directly (`frontend/test/spanishItemDictation.test.js`) without a
browser.

`frontend/js/ui/voice-item-ui.js` mirrors car-track's `voice-mileage-ui.js` controller structure
(status states "Escuchando…"/success/error via a `data-type` attribute, haptic on listen-start,
click-to-stop while listening), but the mic button itself is built via this app's own `$button()`
helper (`lib/dom.js`) into an empty `.mic-btn` container — **not** a raw HTML div with
manually-injected SVG like car-track's `#voiceMileageBtn`, since that's the idiomatic pattern
every other icon button in this app already follows. `resetVoiceStatus()` is called from
`item-ui.js`'s `openItemForm()` (next to the existing `hideNameSuggestions()` call) so a stale
status message doesn't linger across form (re)opens.

**Testing real speech recognition in headless Chromium doesn't work** (no real
microphone/audio path) — `frontend/e2e/voice-item.spec.js` ports car-track's exact mocking
strategy instead: `page.addInitScript` replaces `window.SpeechRecognition`/`webkitSpeechRecognition`
with a `FakeSpeechRecognition` stub exposing `window.__lastSpeechRecognition`, and tests fire
`.onresult`/`.onerror`/`.onend` on it directly via `page.evaluate`.
