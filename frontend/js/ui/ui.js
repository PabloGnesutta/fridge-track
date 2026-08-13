import { appState, dataState, dbStore, setStateField } from "../common/state.js";
import { $, $button, $getInner, $queryOne } from "../lib/dom.js";
import { _info, _log, _warn } from "../lib/logger.js";
import {
  arrow_left, pen_solid, svg_check, svg_home, svg_list, svg_logout, svg_notes, svg_search, svg_trash,
} from "../svg/svgFn.js";
import { logout } from "../appBoot.js";
import {
  deleteLocationFromForm, editLocation, openAddLocation, submitLocationForm, switchLocation,
} from "./location-ui.js";
import { openHomeSwitcher, switchHome } from "./home-ui.js";
import {
  closeSingleItem, markItemDiscarded, markItemUsed, openItemForm, openItemList, openMostUrgentItem,
  openSingleItem, submitItemBtn, submitItemForm, toggleSearch, tryDeleteItem,
} from "./item-ui.js";
import { closeFoodHistory, openFoodHistory } from "./food-history-ui.js";


const mainHeader = $('mainHeader');
const pageTitle = $getInner(mainHeader, '.page-title');

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
          default: break;
        }
      }
    }
  });

  $button({
    appendTo: $('logoutBtn'),
    svgFn: svg_logout,
    ariaLabel: 'Cerrar sesión',
    listener: { fn: logout },
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
    dataset: [['clickAction', 'openHomeSwitcher'], ['tab', 'home']],
  });

  modalBackdropHandler();

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
      case 'openHomeSwitcher':
        openHomeSwitcher();
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
    }
  });
}


export { initUi, pageTitle };
