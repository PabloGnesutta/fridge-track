import { $, $button, $form, $getInner, $new, $queryOne, $queryOneInput, display, undisplay } from "../lib/dom.js";
import { showErrorToast, showInfoToast } from "../lib/toast.js";
import { dataState, dbStore, setAuthStage } from "../common/state.js";
import { createHome, joinHome, setCurrentHomeId } from "../local-db/home-db.js";
import { afterHome } from "../appBoot.js";


const homeForm = $form('homeForm');
const formTitleText = $getInner(homeForm, '.form-title-text');
const nameField = $('homeNameField');
const joinCodeField = $('joinCodeField');
const nameInput = $queryOneInput('#homeForm input[name="homeName"]');
const joinCodeInput = $queryOneInput('#homeForm input[name="joinCode"]');
const modeToggle = $('homeModeToggle');
const submitContainer = $queryOne('#homeForm .submit');

const chipsContainer = $queryOne('#homeView .home-chips');
const homeSwitcherLabel = $queryOne('.home-switcher-name');
const homeSwitcherCode = $queryOne('.home-switcher-code');

/** @type {'create'|'join'} */
let mode = 'create';

// Intercept native form submission (e.g. pressing Enter in a field) so it
// doesn't navigate the browser away with the field as a GET query string.
homeForm.addEventListener('submit', submitHomeForm);
modeToggle.addEventListener('click', toggleMode);
// Attached directly (not via the #app click-delegation used for
// data-click-action elements) so stopPropagation() here reliably runs
// before the click ever reaches .home-switcher's own openHomeSwitcher
// handler - otherwise tapping the code would both copy it and open the
// switcher.
homeSwitcherCode.addEventListener('click', copyJoinCode);


function initHomeUi() {
  $button({
    label: 'Crear Hogar',
    labelId: 'homeSubmitLabel',
    listener: { fn: submitHomeForm },
    appendTo: submitContainer,
  });
}

/**
 * Only one of "create" or "join" is shown at a time - mirrors auth-ui.js's
 * login/signup toggle, since showing both forms at once made it unclear
 * which button did what.
 * @param {'create'|'join'} newMode
 */
function setMode(newMode) {
  mode = newMode;
  const submitLabel = $getInner(submitContainer, '.label');
  if (mode === 'join') {
    formTitleText.innerText = 'Unirse a un Hogar';
    submitLabel.innerText = 'Unirse';
    modeToggle.innerText = '¿Querés crear un Hogar nuevo?';
    undisplay(nameField);
    display(joinCodeField);
  } else {
    formTitleText.innerText = 'Crear Hogar';
    submitLabel.innerText = 'Crear Hogar';
    modeToggle.innerText = '¿Tenés un código? Unite a un Hogar existente';
    display(nameField);
    undisplay(joinCodeField);
  }
}

function toggleMode() {
  setMode(mode === 'create' ? 'join' : 'create');
}

/**
 * @param {MouseEvent} e
 */
async function copyJoinCode(e) {
  e.stopPropagation();
  const joinCode = dataState.currentHome?.joinCode;
  if (!joinCode) { return; }

  try {
    await navigator.clipboard.writeText(joinCode);
    showInfoToast('Código copiado');
  } catch {
    showErrorToast('No se pudo copiar el código');
  }
}

/**
 * @param {Event} e
 */
async function submitHomeForm(e) {
  e.preventDefault();

  if (mode === 'join') {
    const joinCode = joinCodeInput.value.trim();
    if (!joinCode) { return showErrorToast('Ingresar código'); }

    const result = await joinHome(joinCode);
    if (!result.data) { return showErrorToast(result.errorMsg); }

    homeForm.reset();
    await afterHome(result.data);
  } else {
    const name = nameInput.value.trim();
    if (!name) { return showErrorToast('Ingresar nombre'); }

    const result = await createHome(name);
    if (!result.data) { return showErrorToast(result.errorMsg); }

    homeForm.reset();
    await afterHome(result.data);
  }
}

/**
 * Renders one chip per cached Home, for returning users who belong to more
 * than one and need to switch. Called whenever dbStore.homes changes.
 */
function renderHomeChips() {
  chipsContainer.innerHTML = '';
  if (!dbStore.homes.length) { return; }

  const currentId = dataState.currentHome?.id;
  for (const home of dbStore.homes) {
    chipsContainer.append($new({
      class: 'home-chip' + (home.id === currentId ? ' active' : ''),
      dataset: [['clickAction', 'switchHome'], ['homeId', String(home.id)]],
      children: [$new({ class: 'homeName', text: home.name })],
    }));
  }
}

/**
 * @param {string} homeId
 */
async function switchHome(homeId) {
  const id = +homeId;
  const home = dbStore.homes.find(h => h.id === id);
  if (!home) { return; }
  setCurrentHomeId(home.id);
  await afterHome(home);
}

/**
 * Re-enters the Home selection screen without logging out - the only way to
 * reach a second Home once the app is already showing one.
 */
function openHomeSwitcher() {
  renderHomeChips();
  setMode('create');
  setAuthStage('chooseHome');
}

/**
 * Keeps the chip list and the current-home label in sync with
 * dataState.currentHome / dbStore.homes. Called after every Home
 * activation (create, join, switch).
 */
function refreshHomeUi() {
  renderHomeChips();
  homeSwitcherLabel.innerText = dataState.currentHome?.name || '';
  homeSwitcherCode.innerText = dataState.currentHome?.joinCode
    ? `· Código: ${dataState.currentHome.joinCode}`
    : '';
}


export { initHomeUi, renderHomeChips, switchHome, openHomeSwitcher, refreshHomeUi };
