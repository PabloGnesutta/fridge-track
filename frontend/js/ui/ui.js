import { appState, dataState, dbStore, setStateField } from "../common/state.js";
import { $, $button, $getInner, $input, $queryOne } from "../lib/dom.js";
import { _info, _log, _warn, openLogs } from "../lib/logger.js";
import { showConfirmDialog } from "../lib/confirmDialog.js";
import { showErrorToast } from "../lib/toast.js";
import { clearAllData } from "../lib/indexedDb.js";
import { apiUpdateNotificationPreferences, getNotificationPreferences } from "../api-caller/apiCaller.js";
import { hasActiveSubscription, isPushSupported, subscribeToPush } from "../pushNotifications.js";
import {
  arrow_left, pen_solid, svg_check, svg_home, svg_list, svg_logout, svg_menu, svg_notes, svg_search,
  svg_trash,
} from "../svg/svgFn.js";
import { logout } from "../appBoot.js";
import {
  deleteLocationFromForm, editLocation, openAddLocation, submitLocationForm, switchLocation,
} from "./location-ui.js";
import { openHomeManage, closeHomeManage, switchHome } from "./home-ui.js";
import {
  closeSingleItem, markItemDiscarded, markItemUsed, openItemForm, openItemList, openMostUrgentItem,
  openSingleItem, submitItemBtn, submitItemForm, toggleSearch, tryDeleteItem,
} from "./item-ui.js";
import {
  closeFoodHistory, openFoodHistory, submitFoodNameHistoryForm, switchHistoryCategory,
} from "./food-history-ui.js";


const mainHeader = $('mainHeader');
const pageTitle = $getInner(mainHeader, '.page-title');
const headerMenuPanel = $queryOne('#headerMenu .header-menu-panel');

function toggleHeaderMenu() {
  const opening = headerMenuPanel.classList.contains('display-none');
  headerMenuPanel.classList.toggle('display-none');
  // Refreshed on every open, not just once at boot - browser permission can
  // change underneath the app (revoked/granted via browser site settings)
  // with nothing to notify the page when it does.
  if (opening) { refreshPushToggleState(); }
}

function closeHeaderMenu() {
  headerMenuPanel.classList.add('display-none');
}

/**
 * Signs out, then separately offers a "fresh start" - wiping this device's
 * entire local cache. A manual escape hatch for a device stuck showing
 * stale data (e.g. a sync that silently failed for a while before the
 * failure became visible) - not something normal sign-out should do by
 * default, since IndexedDB is deliberately left alone on logout otherwise
 * (see appBoot.js's logout()) so a device keeps working offline and a
 * repeat login doesn't need a full network round-trip. Asked as a second,
 * separate dialog rather than folded into the sign-out confirmation itself,
 * since by this point sign-out has already happened either way - this
 * question is purely about local cache, and "cancel" here just means
 * "leave it as-is", not "undo the sign-out".
 */
async function confirmLogoutAndOfferWipe() {
  await logout();
  showConfirmDialog(
    '¿Querés borrar los datos guardados en este dispositivo? Vas a perder el acceso sin conexión hasta que vuelvas a iniciar sesión y sincronizar.',
    async () => {
      await clearAllData();
      window.location.reload();
    }
  );
}

/**
 * Whether the push toggle should show as ON is NOT just the stored
 * pushEnabled preference - a fresh signup defaults that to true (matches
 * the DB column's DEFAULT 1) despite having no subscription yet, and a
 * denied/revoked browser permission doesn't change the stored preference
 * either (see pushNotifications.js's hasActiveSubscription() doc comment).
 * So the checkbox is only really ON when the user wants it AND this device
 * actually has a live subscription to back that up.
 * @returns {Promise<boolean>}
 */
async function computePushToggleChecked() {
  const prefs = getNotificationPreferences();
  return prefs.pushEnabled && await hasActiveSubscription();
}

/**
 * Re-derives the push toggle's checked state - called on every menu open,
 * not just once at boot, since browser permission can change underneath the
 * app (revoked/granted via browser site settings) with no event to notify
 * the page when it does.
 */
async function refreshPushToggleState() {
  const pushToggle = $input('pushNotifToggle');
  if (pushToggle.disabled) { return; }
  pushToggle.checked = await computePushToggleChecked();
}

/**
 * Wires the two header-menu toggles. Push is a real, currently-firing
 * feature (see backend/src/scheduler/expiryNotifier.js) so enabling it here
 * goes through the same permission-request/subscribe flow as the opt-in
 * banner (pushNotifications.js's subscribeToPush()); email has no trigger
 * yet (see emailService.js) so its toggle only ever persists a preference,
 * nothing currently reads it. Both write through to the backend immediately
 * on change - there's no separate "save" step in this menu.
 */
function initNotificationToggles() {
  const pushToggle = $input('pushNotifToggle');
  const emailToggle = $input('emailNotifToggle');

  emailToggle.checked = getNotificationPreferences().emailEnabled;

  if (!isPushSupported()) {
    pushToggle.disabled = true;
  } else {
    refreshPushToggleState();
  }

  pushToggle.addEventListener('change', async () => {
    const wantEnabled = pushToggle.checked;

    // Enabling needs an active subscription to actually deliver anything -
    // requests permission (a silent no-op if already granted, impossible to
    // re-request if already denied) and subscribes if not already.
    if (wantEnabled) {
      const subscribed = await subscribeToPush();
      if (!subscribed) {
        pushToggle.checked = false;
        showErrorToast('No se pudo activar - revisá los permisos de notificaciones del navegador.');
        return;
      }
    }

    const { error } = await apiUpdateNotificationPreferences({ pushEnabled: wantEnabled });
    if (error) {
      pushToggle.checked = !wantEnabled;
      showErrorToast('No se pudo guardar la preferencia.');
    }
  });

  emailToggle.addEventListener('change', async () => {
    const wantEnabled = emailToggle.checked;
    const { error } = await apiUpdateNotificationPreferences({ emailEnabled: wantEnabled });
    if (error) {
      emailToggle.checked = !wantEnabled;
      showErrorToast('No se pudo guardar la preferencia.');
    }
  });
}

function initUi() {
  // Go Back Button
  $button({
    appendTo: $('goBack2'),
    svgFn: arrow_left,
    ariaLabel: 'Volver',
    listener: {
      fn: e => {
        switch (appState.currentView) {
          case 'ItemList':
            break;
          case 'SingleItem':
            closeSingleItem();
            break;
          case 'FoodHistory':
            closeFoodHistory();
            break;
          case 'Home':
            closeHomeManage();
            break;
          default: break;
        }
      }
    }
  });

  $button({
    appendTo: $('headerMenuBtn'),
    svgFn: svg_menu,
    ariaLabel: 'Menú',
    listener: { fn: toggleHeaderMenu },
  });

  initNotificationToggles();

  $button({
    appendTo: $('logoutBtn'),
    svgFn: svg_logout,
    label: 'Cerrar sesión',
    class: 'horizontal',
    listener: {
      fn: () => {
        closeHeaderMenu();
        showConfirmDialog('¿Seguro que querés cerrar sesión?', confirmLogoutAndOfferWipe);
      },
    },
  });

  $button({
    appendTo: $('openLogsBtn'),
    svgFn: svg_notes,
    label: 'Ver logs',
    class: 'horizontal',
    listener: {
      fn: () => {
        closeHeaderMenu();
        openLogs();
      },
    },
  });

  $('newItemBtn').addEventListener('click', () => { openItemForm(false); });

  $button({
    appendTo: $('searchToggleBtn'),
    svgFn: svg_search,
    ariaLabel: 'Buscar',
    listener: { fn: toggleSearch },
  });

  $button({
    label: 'Usado',
    svgFn: svg_check,
    class: 'horizontal',
    // Wrapped in a no-arg closure - $button's listener otherwise passes the
    // DOM click event as the first argument, which would land in
    // markItemUsed's now-optional `item` param instead of falling through
    // to its dataState.currentItem default.
    listener: { fn: () => markItemUsed() },
    appendTo: $('usedBtn'),
  });
  $button({
    label: 'Tirado',
    svgFn: svg_trash,
    class: 'horizontal',
    listener: { fn: () => markItemDiscarded() },
    appendTo: $('discardedBtn'),
  });

  $button({
    label: 'Agregar Ubicación',
    listener: { fn: submitLocationForm },
    appendTo: $queryOne('#locationForm .submit'),
  });

  $button({
    label: 'Guardar Cambios',
    listener: { fn: submitFoodNameHistoryForm },
    appendTo: $queryOne('#foodNameHistoryForm .submit'),
  });

  $button({
    // Borrar Ubicación (only shown while editing an existing one)
    listener: { fn: deleteLocationFromForm },
    svgFn: svg_trash,
    ariaLabel: 'Borrar ubicación',
    appendTo: $('deleteLocationBtn'),
  });

  $button({
    label: 'Ingresar Alimento',
    listener: { fn: submitItemForm },
    appendTo: submitItemBtn,
  });

  $button({
    // Editar Alimento
    listener: { fn: () => openItemForm(true) },
    svgFn: pen_solid,
    ariaLabel: 'Editar alimento',
    appendTo: $queryOne('#singleItemView .edit-btn'),
  });
  $button({
    // Borrar Alimento
    listener: { fn: () => tryDeleteItem() },
    svgFn: svg_trash,
    ariaLabel: 'Borrar alimento',
    appendTo: $queryOne('#singleItemView .delete-btn'),
  });

  // Bottom tab bar - navigation triggers wired purely through data-click-
  // action (see the delegation switch below), no per-button listener.
  $button({
    appendTo: $('tabListBtn'),
    svgFn: svg_list,
    label: 'Lista',
    class: 'tab-btn',
    ariaLabel: 'Lista de alimentos',
    dataset: [['clickAction', 'openItemList'], ['tab', 'list']],
  });
  $button({
    appendTo: $('tabHistoryBtn'),
    svgFn: svg_notes,
    label: 'Historial',
    class: 'tab-btn',
    ariaLabel: 'Historial',
    dataset: [['clickAction', 'openFoodHistory'], ['tab', 'history']],
  });
  $button({
    appendTo: $('tabHomeBtn'),
    svgFn: svg_home,
    label: 'Hogar',
    class: 'tab-btn',
    ariaLabel: 'Cambiar de Hogar',
    dataset: [['clickAction', 'openHomeManage'], ['tab', 'home']],
  });

  modalBackdropHandler();

  // Close the header menu on any click outside it - the hamburger button
  // itself is inside #headerMenu, so the same click that opens the menu
  // can't also immediately close it here.
  $('app').addEventListener('click', e => {
    if (headerMenuPanel.classList.contains('display-none')) { return; }
    if (!(e.target instanceof Element) || !e.target.closest('#headerMenu')) {
      closeHeaderMenu();
    }
  });

  // Click Event Delegation
  $('app').addEventListener('click', e => {
    const target = e.target;
    if (!target) { return; }
    if (target instanceof HTMLInputElement) {
      target.select();
      return;
    }
    // Note: `instanceof Element` (not HTMLElement) so clicks landing on an
    // inline <svg>/<path> icon (an SVGElement) aren't silently dropped.
    if (!(target instanceof Element)) { return; }
    const clickElement = target.closest('[data-click-action]');
    if (!clickElement) { return; }
    if (!('dataset' in clickElement)) { return; }
    /** @type {DOMStringMap} */ //@ts-ignore
    const dataset = clickElement.dataset;
    switch (dataset.clickAction) {
      case 'openSingleItem':
        openSingleItem(dataset.itemKey || '');
        break;
      case 'openItemList':
        openItemList();
        break;
      case 'openFoodHistory':
        openFoodHistory();
        break;
      case 'switchHistoryCategory':
        switchHistoryCategory(dataset.category || 'alimento');
        break;
      case 'openMostUrgentItem':
        openMostUrgentItem();
        break;
      case 'switchLocation':
        switchLocation(dataset.locationKey || '');
        break;
      case 'editLocation':
        editLocation(dataset.locationKey || '');
        break;
      case 'openAddLocation':
        openAddLocation();
        break;
      case 'switchHome':
        switchHome(dataset.homeId || '');
        break;
      case 'openHomeManage':
        openHomeManage();
        break;
      default:
        return _warn(' :: clickAction not defined: ' + dataset.clickAction);
    }
  });
}

function modalBackdropHandler() {
  $queryOne('#main-modal .backdrop').addEventListener('click', e => {
    if (appState.onboarding) { return; }
    /** @type {boolean} */ // @ts-ignore
    const clickedBackdrop = e.target.classList.contains('backdrop') || e.currentTarget.classList.contains('backdrop');
    if (clickedBackdrop) {
      setStateField('editingItem', false);
      setStateField('showLocationForm', false);
      setStateField('showItemForm', false);
      setStateField('showFoodNameHistoryForm', false);
    }
  });
}


export { initUi, pageTitle };
