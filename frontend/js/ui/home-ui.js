import {
  $, $button, $form, $getInner, $new, $queryOne, $queryOneInput, display, undisplay, makeKeyboardActivatable,
} from "../lib/dom.js";
import { showErrorToast, showInfoToast } from "../lib/toast.js";
import { showConfirmDialog } from "../lib/confirmDialog.js";
import { pen_solid, svg_trash, svg_mail, svg_link } from "../svg/svgFn.js";
import { appState, dataState, dbStore, setCurrentView, setStateField } from "../common/state.js";
import { syncUrl } from "../common/router.js";
import { createHome, joinHome, setCurrentHomeId } from "../local-db/home-db.js";
import { deleteCategory, fetchCategories, renameCategory } from "../local-db/category-db.js";
import { apiInviteToHome } from "../api-caller/apiCaller.js";
import { afterHome } from "../appBoot.js";
import { pageTitle } from "./ui.js";
import { openItemList } from "./item-ui.js";


const homeForm = $form('homeForm');
const formTitleText = $getInner(homeForm, '.form-title-text');
const nameField = $('homeNameField');
const joinCodeField = $('joinCodeField');
const nameInput = $queryOneInput('#homeForm input[name="homeName"]');
const joinCodeInput = $queryOneInput('#homeForm input[name="joinCode"]');
const modeToggle = $('homeModeToggle');
const submitContainer = $queryOne('#homeForm .submit');

const cardsContainer = $queryOne('#homeView .home-cards');
const homeSwitcherLabel = $queryOne('.home-switcher-name');
const homeSwitcherCode = $queryOne('.home-switcher-code');

const categoriesList = $queryOne('#homeView .categories-list');
const categoryForm = $form('categoryForm');
const categoryNameInput = $queryOneInput('#categoryForm input[name="categoryName"]');

const inviteHomeForm = $form('inviteHomeForm');
const inviteEmailInput = $queryOneInput('#inviteHomeForm input[name="inviteEmail"]');

/** The category currently open in the rename form, if any. */
/** @type {import("../local-db/category-db.js").Category|null} */
let categoryBeingEdited = null;

/** The Home currently targeted by the invite form, if any. */
/** @type {import("../local-db/home-db.js").Home|null} */
let homeBeingInvited = null;

/**
 * A Home-invite link's ?joinCode= param, captured at boot (see
 * captureJoinLinkCode()) before auth necessarily resolves, consumed once it
 * does (see consumePendingJoin()).
 * @type {string|null}
 */
let pendingJoinCode = null;

/** @type {'create'|'join'} */
let mode = 'create';

// Intercept native form submission (e.g. pressing Enter in a field) so it
// doesn't navigate the browser away with the field as a GET query string.
homeForm.addEventListener('submit', submitHomeForm);
categoryForm.addEventListener('submit', submitCategoryForm);
inviteHomeForm.addEventListener('submit', submitInviteForm);
modeToggle.addEventListener('click', toggleMode);
makeKeyboardActivatable(modeToggle);
// Attached directly (not via the #app click-delegation used for
// data-click-action elements) so stopPropagation() here reliably runs
// before the click ever reaches .home-switcher's own openHomeManage
// handler - otherwise tapping the code would both copy it and open the
// Hogar tab.
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
 * @param {import("../local-db/home-db.js").Home} home
 */
function buildHomeCard(home) {
  const isActive = home.id === dataState.currentHome?.id;

  const header = $new({
    class: 'home-card-header',
    children: [$new({ class: 'home-card-name', text: home.name })],
  });
  if (isActive) {
    header.append($new({ class: 'home-card-badge', text: 'Activo' }));
  }

  // stopPropagation on both action buttons - without it, a click bubbles up
  // to the card's own data-click-action="switchHome" (see the delegation
  // switch in ui.js), which would switch Homes as an unwanted side effect
  // of tapping "Invitar"/"Copiar enlace". Same reasoning as copyJoinCode()'s
  // own stopPropagation above.
  const actions = $new({ class: 'home-card-actions' });
  $button({
    appendTo: actions,
    svgFn: svg_mail,
    label: 'Invitar',
    class: 'horizontal',
    listener: { fn: e => { e.stopPropagation(); openInviteForm(home); } },
  });
  $button({
    appendTo: actions,
    svgFn: svg_link,
    label: 'Copiar enlace',
    class: 'horizontal',
    listener: { fn: e => { e.stopPropagation(); copyHomeJoinLink(home); } },
  });

  return $new({
    class: 'home-card' + (isActive ? ' active' : ''),
    dataset: [['clickAction', 'switchHome'], ['homeId', String(home.id)]],
    children: [header, actions],
  });
}

/**
 * Renders one card per cached Home, for returning users who belong to more
 * than one and need to switch - each with its own invite/copy-link actions.
 * Called whenever dbStore.homes changes.
 */
function renderHomeCards() {
  cardsContainer.innerHTML = '';
  if (!dbStore.homes.length) { return; }

  for (const home of dbStore.homes) {
    cardsContainer.append(buildHomeCard(home));
  }
}

/**
 * Opens the email-invite form for a specific Home's card.
 * @param {import("../local-db/home-db.js").Home} home
 */
function openInviteForm(home) {
  homeBeingInvited = home;
  inviteEmailInput.value = '';
  setStateField('showInviteForm', true);
  inviteEmailInput.focus();
}

/**
 * @param {Event} e
 */
async function submitInviteForm(e) {
  e.preventDefault();
  const home = homeBeingInvited;
  if (!home) { return; }

  const email = inviteEmailInput.value.trim();
  if (!email) { return showErrorToast('Ingresar un email'); }

  const result = await apiInviteToHome(home.id, email);
  if (!result.data) { return showErrorToast(result.error || 'No se pudo enviar la invitación'); }

  homeBeingInvited = null;
  inviteHomeForm.reset();
  setStateField('showInviteForm', false);
  showInfoToast('Invitación enviada');
}

/**
 * Copies a one-click join link (not just the raw code, unlike
 * copyJoinCode() above) for the given Home to the clipboard.
 * @param {import("../local-db/home-db.js").Home} home
 */
async function copyHomeJoinLink(home) {
  const link = `${window.location.origin}/?joinCode=${encodeURIComponent(home.joinCode)}`;
  try {
    await navigator.clipboard.writeText(link);
    showInfoToast('Enlace copiado');
  } catch {
    showErrorToast('No se pudo copiar el enlace');
  }
}

/**
 * Captures a Home-invite link's ?joinCode= param (if present) for later
 * consumption once auth resolves - joining requires a session, so this
 * can't complete at boot time the way auth-ui.js's tryAutoVerifyFromLink()
 * can (that one needs no prior session). Strips the query string either
 * way so a reload doesn't re-trigger it. Called once from appBoot.js's
 * bootApp().
 * @returns {boolean} whether a join code was found and captured
 */
function captureJoinLinkCode() {
  const params = new URLSearchParams(location.search);
  const joinCode = params.get('joinCode');
  if (!joinCode) { return false; }
  history.replaceState(null, '', location.pathname);
  pendingJoinCode = joinCode;
  return true;
}

/**
 * Consumes (and clears) a captured join code, actually joining that Home.
 * Called from appBoot.js's afterLogin(), once a session is confirmed -
 * takes priority over the normal "resolve last-used or first Home" logic,
 * since arriving via an invite link means the user wants THAT Home
 * specifically, not just whichever Home boot would otherwise land on.
 * @returns {Promise<import("../local-db/home-db.js").Home|null>}
 */
async function consumePendingJoin() {
  const code = pendingJoinCode;
  pendingJoinCode = null;
  if (!code) { return null; }

  const result = await joinHome(code);
  if (!result.data) {
    showErrorToast(result.errorMsg || 'No se pudo unir al Hogar con el enlace');
    return null;
  }
  return result.data;
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
 * Opens the "Hogar" tab - a real page (own URL, header/footer/hamburger menu
 * all present) rather than dropping back to the pre-ready chooseHome screen,
 * so switching/creating/joining a Home once the app is already showing one
 * looks and navigates like every other tab (Lista/Historial) instead of like
 * re-onboarding. The chooseHome auth stage (see state.js) is unrelated and
 * unchanged - that one's still the pre-login/no-Home-yet screen, deliberately
 * without header/footer since the user isn't "in" the app yet.
 */
function openHomeManage() {
  setCurrentView('Home');
  pageTitle.innerText = 'Hogar';
  syncUrl('/hogar');
  renderHomeCards();
  renderCategoriesList();
  setMode('create');
}

/**
 * Renders the categories list: one row per category (name + rename/delete
 * row-action icons), mirroring food-history-ui.js's buildHistoryRow()
 * pattern exactly. This is the actual surface a user renames or deletes a
 * category from - without it, a rename propagating everywhere (the whole
 * point of the categories-table refactor) would have no way to be triggered.
 */
function renderCategoriesList() {
  categoriesList.innerHTML = '';
  if (!dbStore.categories.length) { return; }

  for (const category of dbStore.categories) {
    categoriesList.append(buildCategoryRow(category));
  }
}

/**
 * @param {import("../local-db/category-db.js").Category} category
 */
function buildCategoryRow(category) {
  const actions = $new({ class: 'history-row-actions' });
  $button({
    appendTo: actions,
    svgFn: pen_solid,
    ariaLabel: 'Editar categoría',
    listener: { fn: () => openCategoryForm(category) },
  });
  $button({
    appendTo: actions,
    svgFn: svg_trash,
    ariaLabel: 'Borrar categoría',
    listener: { fn: () => deleteCategoryFromList(category) },
  });

  return $new({
    class: 'row',
    children: [
      $new({ class: 'left-side', children: [$new({ class: 'itemName', text: category.name })] }),
      actions,
    ],
  });
}

/**
 * Opens the rename form, prefilled with the category's current name.
 * @param {import("../local-db/category-db.js").Category} category
 */
function openCategoryForm(category) {
  categoryBeingEdited = category;
  categoryNameInput.value = category.name;
  setStateField('showCategoryForm', true);
  categoryNameInput.focus();
  categoryNameInput.select();
}

/**
 * @param {Event} e
 */
async function submitCategoryForm(e) {
  e.preventDefault();
  const category = categoryBeingEdited;
  if (!category) { return; }

  const newName = categoryNameInput.value.trim();
  if (!newName) { return showErrorToast('Ingresar nombre'); }

  const result = await renameCategory(category, newName);
  if (!result.data) { return showErrorToast(result.errorMsg); }

  categoryBeingEdited = null;
  categoryForm.reset();
  setStateField('showCategoryForm', false);
  renderCategoriesList();
}

/**
 * @param {import("../local-db/category-db.js").Category} category
 */
function deleteCategoryFromList(category) {
  showConfirmDialog(`¿Seguro que querés borrar la categoría "${category.name}"?`, async () => {
    const result = await deleteCategory(category);
    if (!result.ok) { return showErrorToast(result.error); }

    // Re-fetch (rather than manually splicing dbStore.categories) so the
    // now-tombstoned record drops out via fetchCategories()' own
    // deletedAt==null filter - same "refetch after a deliberate, infrequent
    // edit/delete" pattern food-history-ui.js's refreshAfterEdit() uses.
    const homeId = dataState.currentHome?.id;
    if (homeId) { await fetchCategories(homeId); }
    renderCategoriesList();
  });
}

/** Mirrors closeFoodHistory() in food-history-ui.js - go-back from the Hogar tab returns to Lista. */
function closeHomeManage() {
  if (appState.currentView !== 'Home') { return; }
  openItemList();
}

/**
 * Keeps the card list and the current-home label in sync with
 * dataState.currentHome / dbStore.homes. Called after every Home
 * activation (create, join, switch).
 */
function refreshHomeUi() {
  renderHomeCards();
  homeSwitcherLabel.innerText = dataState.currentHome?.name || '';
  homeSwitcherCode.innerText = dataState.currentHome?.joinCode
    ? `· Código: ${dataState.currentHome.joinCode}`
    : '';
}


export {
  initHomeUi, renderHomeCards, switchHome, openHomeManage, closeHomeManage, refreshHomeUi,
  submitCategoryForm, submitInviteForm, captureJoinLinkCode, consumePendingJoin,
};
