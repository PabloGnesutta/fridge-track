import { $button, $form, $new, $queryOne, $queryOneInput } from "../lib/dom.js";
import { showErrorToast } from "../lib/toast.js";
import { dataState, dbStore, setAuthStage } from "../common/state.js";
import { createHome, joinHome, setCurrentHomeId } from "../local-db/home-db.js";
import { afterHome } from "../appBoot.js";


const createForm = $form('homeCreateForm');
const createNameInput = $queryOneInput('#homeCreateForm input[name="homeName"]');
const createSubmitContainer = $queryOne('#homeCreateForm .submit');

const joinForm = $form('homeJoinForm');
const joinCodeInput = $queryOneInput('#homeJoinForm input[name="joinCode"]');
const joinSubmitContainer = $queryOne('#homeJoinForm .submit');

const chipsContainer = $queryOne('#homeView .home-chips');
const homeSwitcherLabel = $queryOne('.home-switcher-name');

// Intercept native form submission (e.g. pressing Enter in a field) so it
// doesn't navigate the browser away with the field as a GET query string.
createForm.addEventListener('submit', submitCreateHomeForm);
joinForm.addEventListener('submit', submitJoinHomeForm);


function initHomeUi() {
  $button({
    label: 'Crear Hogar',
    listener: { fn: submitCreateHomeForm },
    appendTo: createSubmitContainer,
  });
  $button({
    label: 'Unirse',
    listener: { fn: submitJoinHomeForm },
    appendTo: joinSubmitContainer,
  });
}

/**
 * @param {Event} e
 */
async function submitCreateHomeForm(e) {
  e.preventDefault();
  const name = createNameInput.value.trim();
  if (!name) { return showErrorToast('Ingresar nombre'); }

  const result = await createHome(name);
  if (!result.data) { return showErrorToast(result.errorMsg); }

  createForm.reset();
  await afterHome(result.data);
}

/**
 * @param {Event} e
 */
async function submitJoinHomeForm(e) {
  e.preventDefault();
  const joinCode = joinCodeInput.value.trim();
  if (!joinCode) { return showErrorToast('Ingresar código'); }

  const result = await joinHome(joinCode);
  if (!result.data) { return showErrorToast(result.errorMsg); }

  joinForm.reset();
  await afterHome(result.data);
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
}


export { initHomeUi, renderHomeChips, switchHome, openHomeSwitcher, refreshHomeUi };
