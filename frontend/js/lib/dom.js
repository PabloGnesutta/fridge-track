import { _log } from "./logger.js";

/**
 * @typedef {{
 *  id?: string
 *  class?: string
 *  text?: string
 *  html?: string
 *  listener?: { 
 *    event?: keyof HTMLElementEventMap
 *    fn: EventListenerOrEventListenerObject
 *  }
 *  tag?: keyof HTMLElementTagNameMap
 *  value?: string
 *  dataset?: Array<[string, string]>
 *  type?: string
 *  children?: HTMLElement[]
 * }} NewElementParams
 */

/**
 * Gets an HTML element by its ID
 * @param {string} id
 * @returns {HTMLDivElement}
 */
function $(id) { // @ts-ignore
  return document.getElementById(id);
}

/**
 * @param {string} id
 * @returns {HTMLFormElement}
 */
function $form(id) { // @ts-ignore
  return $(id);
}
/**
 * @param {string} id
 * @returns {HTMLInputElement}
 */
function $input(id) { // @ts-ignore
  return $(id);
}


/**
 * Wrapper around querySelectorAll
 * @param {string} selector
 * @returns {HTMLDivElement[]}
 */
function $queryAll(selector) { // @ts-ignore
  return document.querySelectorAll(selector);
}

/**
 * @param {string} selector
 * @returns {HTMLDivElement}
 */
function $queryOne(selector) { // @ts-ignore
  return document.querySelector(selector);
}
/**
 * @param {string} selector
 * @returns {HTMLInputElement}
 */
function $queryOneInput(selector) { // @ts-ignore
  return document.querySelector(selector);
}


/**
 * Create a new html element
 * @param {NewElementParams} args
 * @returns {HTMLDivElement}
 */
function $new(args) {
  const el = document.createElement(args.tag || 'div');
  if (args.id) el.id = args.id;
  if (args.class) el.className = args.class;
  if (args.text) el.innerText = args.text;
  if (args.html) el.innerHTML = args.html;
  if (args.listener) el.addEventListener(args.listener.event || 'click', args.listener.fn);
  if (args.dataset)
    args.dataset.forEach(([key, value]) => {
      el.dataset[key] = value;
    });
  // @ts-ignore
  if (args.value) el.value = args.value;
  // @ts-ignore
  if (args.type) el.type = args.type;
  if (args.children) args.children.forEach(child => el.append(child));


  // @ts-ignore
  return el;
}


/**
 * Create a new html input element
 * @param {NewElementParams & {accept?: string}} args
 * @returns {HTMLInputElement}
 */
function $newInput(args) {
  args.tag = 'input';
  /** @type {HTMLInputElement} */ //@ts-ignore
  const el = $new(args);
  if (args.accept) { el.accept = args.accept; }
  return el;
}


/**
 * Gets the first child of the given class for the provided node
 * @param {HTMLElement} element
 * @param {string} childClass
 * @returns {HTMLDivElement}
 */
function $getChild(element, childClass) {
  /** @type {HTMLDivElement} */ //@ts-ignore
  const child = element.getElementsByClassName(childClass)[0];
  return child;
}


/**
 * @param {HTMLElement} el
 * @param {string} selector
 * @returns {HTMLElement}
 */
function $getInner(el, selector) {
  // @ts-ignore
  return el.querySelector(selector);
}
/**
 * @param {HTMLElement} el
 * @param {string} selector
 * @returns {HTMLInputElement}
 */
function $getInnerInput(el, selector) {
  // @ts-ignore
  return el.querySelector(selector);
}


/**
 * @param {string} key
 * @returns {string}
 */
function getCssVar(key) {
  return getComputedStyle(document.body).getPropertyValue(key);
}

/**
 * @param {string} key
 * @param {string} value
 */
function setCssVar(key, value) {
  document.documentElement.style.setProperty(key, value);
}

/**
 * Makes a non-native clickable element (a div with role="button") keyboard-
 * activatable - browsers only auto-fire a click on Enter/Space for real
 * interactive elements (button/a), not for role="button" divs.
 * @param {HTMLElement} el
 */
function makeKeyboardActivatable(el) {
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      el.click();
    }
  });
}

/**
 * Toggles full screen
 */
function toggleFullScreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen();
  } else if (document.exitFullscreen) {
    document.exitFullscreen();
  }
}


/**
 * @typedef {{
 *  button: HTMLDivElement
 *  icon: HTMLDivElement
 *  label?: HTMLDivElement
 * }} ButtonReturn
 * 
 * @param { NewElementParams & {
 *  svgFn?: () => string
 *  iconId?: string
 *  label?: string
 *  labelId?: string
 *  ariaLabel?: string
 *  appendTo?: HTMLElement
 *  prependTo?: HTMLElement
 * }} args
 * @returns {ButtonReturn|null}
 */
function $button(args) {
  const children = [];
  if (args.label) {
    const label = $new({
      class: 'label',
      text: args.label,
      id: args.labelId,
    });
    children.push(label);
  }

  if (args.svgFn) {
    const icon = $new({ class: 'icon', id: args.iconId });
    icon.innerHTML = args.svgFn();
    children.push(icon);
  }

  children.push($new({ class: 'overlay' }));

  const button = $new({
    class: 'btn base-button ' + (args.class || ''),
    dataset: args.dataset,
    listener: args.listener,
    children
  });

  button.role = 'button';
  button.tabIndex = 0;
  makeKeyboardActivatable(button);
  // Icon-only buttons have no visible text for screen readers to announce -
  // args.label (when present) already does that job, so ariaLabel is mainly
  // needed for svgFn-only buttons.
  if (args.ariaLabel) { button.setAttribute('aria-label', args.ariaLabel); }

  if (args.appendTo) {
    args.appendTo.append(button);
  } else if (args.prependTo) {
    args.prependTo.prepend(button);
  }

  return null;
}

/** @param {HTMLElement} el */
function show(el) { el.classList.remove('hidden'); }
/** @param {HTMLElement} el */
function hide(el) { el.classList.add('hidden'); }
/** @param {HTMLElement} el */
function display(el) { el.classList.remove('display-none'); }
/** @param {HTMLElement} el */
function undisplay(el) { el.classList.add('display-none'); }
/** @param {string} id */
function $display(id) { $(id).classList.remove('display-none'); }
/** @param {string} id */
function $undisplay(id) { $(id).classList.add('display-none'); }
/** @param {HTMLElement} el */
function select(el) { el.classList.add('selected'); }
/** @param {HTMLElement} el */
function unselect(el) { el.classList.remove('selected'); }
/** @param {HTMLElement} el */
function fold(el) { el.classList.add('folded'); }
/** @param {HTMLElement} el */
function unfold(el) { el.classList.remove('folded'); }


export {
  $, $form, $input, $queryAll, $queryOne, $new, $newInput, $getChild, getCssVar, setCssVar,
  toggleFullScreen, show, hide, display, undisplay, $display, $undisplay,
  $button, $getInner, select, unselect, fold, unfold, $getInnerInput, $queryOneInput,
  makeKeyboardActivatable,
};
