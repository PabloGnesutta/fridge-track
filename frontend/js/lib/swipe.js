/**
 * Horizontal swipe-to-act gesture, implemented via the Pointer Events API
 * (unifies mouse/touch/pen - also means Playwright's ordinary page.mouse
 * drag sequence exercises the real listeners directly in e2e tests, no
 * synthetic Touch-object plumbing needed). No DOM structure/domain
 * knowledge lives here - the caller supplies the element and callbacks, and
 * owns applying the visual transform.
 */

const DEAD_ZONE_PX = 8; // movement below this still counts as a tap, not a drag

/**
 * Pure decision logic, split out from attachSwipe() so it's unit-testable
 * under plain Node - attachSwipe itself touches real DOM APIs
 * (addEventListener, setPointerCapture, getBoundingClientRect) and isn't,
 * per this repo's DOM-free-module testing convention (see CLAUDE.md).
 * @param {number} deltaX
 * @param {number} width
 * @param {number} threshold Fraction of `width` that counts as a commit.
 * @returns {'right'|'left'|'reset'}
 */
function pickSwipeOutcome(deltaX, width, threshold) {
  if (!width) { return 'reset'; }
  const ratio = deltaX / width;
  if (ratio >= threshold) { return 'right'; }
  if (ratio <= -threshold) { return 'left'; }
  return 'reset';
}

/**
 * @param {HTMLElement} el
 * @param {{
 *   onDragStart?: () => void,
 *   onDrag: (deltaX: number) => void,
 *   onDragEnd?: () => void,
 *   onCommitRight?: () => void,
 *   onCommitLeft?: () => void,
 *   threshold?: number,
 * }} opts onDrag is called repeatedly during the drag with the live
 *   horizontal offset in px (0 on release, unless a commit fires). threshold
 *   is the fraction of the element's own width a drag must cross to commit
 *   (default 0.35).
 */
function attachSwipe(el, { onDragStart, onDrag, onDragEnd, onCommitRight, onCommitLeft, threshold = 0.35 }) {
  let startX = 0;
  let startY = 0;
  let dragging = false; // true once horizontal intent is confirmed (past the dead zone, more horizontal than vertical)
  let deltaX = 0;
  /** @type {number|null} */
  let pointerId = null;
  let suppressNextClick = false;

  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) { return; } // primary mouse button / touch only
    startX = e.clientX;
    startY = e.clientY;
    dragging = false;
    deltaX = 0;
    pointerId = e.pointerId;
  });

  el.addEventListener('pointermove', e => {
    if (pointerId === null || e.pointerId !== pointerId) { return; }
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (!dragging) {
      if (Math.abs(dx) < DEAD_ZONE_PX && Math.abs(dy) < DEAD_ZONE_PX) { return; }
      if (Math.abs(dx) <= Math.abs(dy)) {
        // More vertical than horizontal - this is a page scroll, not a
        // swipe. Bail out of this gesture entirely (don't fight the
        // browser's own scrolling).
        pointerId = null;
        return;
      }
      dragging = true;
      el.setPointerCapture(pointerId);
      if (onDragStart) { onDragStart(); }
    }

    deltaX = dx;
    onDrag(deltaX);
  });

  function endDrag() {
    if (pointerId === null || !dragging) {
      pointerId = null;
      dragging = false;
      return;
    }
    suppressNextClick = true;
    if (onDragEnd) { onDragEnd(); }

    const width = el.getBoundingClientRect().width;
    const outcome = pickSwipeOutcome(deltaX, width, threshold);
    if (outcome === 'right' && onCommitRight) { onCommitRight(); }
    else if (outcome === 'left' && onCommitLeft) { onCommitLeft(); }
    else { onDrag(0); }

    pointerId = null;
    dragging = false;
    deltaX = 0;
  }

  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);

  // A real drag still fires a trailing 'click' on release - swallow it (in
  // the capture phase, before it can reach the row's own data-click-action
  // navigation or the #app-level click delegation) so a swipe doesn't also
  // open the item.
  el.addEventListener('click', e => {
    if (suppressNextClick) {
      suppressNextClick = false;
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);
}

export { attachSwipe, pickSwipeOutcome };
