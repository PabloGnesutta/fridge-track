import { appState, dataState, dbStore, setStateField } from "../common/state.js";
import { $, $button, $getInner, $queryOne } from "../lib/dom.js";
import { _info, _log, _warn, openLogs } from "../lib/logger.js";
import { arrow_left, pen_solid, svg_check, svg_logout, svg_notes, svg_search, svg_trash } from "../svg/svgFn.js";
import { logout } from "../appBoot.js";
import {
  deleteLocationFromForm, editLocation, openAddLocation, submitLocationForm, switchLocation,
} from "./location-ui.js";
import { openHomeSwitcher, switchHome } from "./home-ui.js";
import {
  closeSingleItem, markItemDiscarded, markItemUsed, openItemForm, openSingleItem, submitItemBtn, submitItemForm,
  toggleSearch, tryDeleteItem,
} from "./item-ui.js";
import { closeFoodHistory, openFoodHistory } from "./food-history-ui.js";


const mainHeader = $('mainHeader');
const pageTitle = $getInner(mainHeader, '.page-title');

function initUi() {
  // Go Back Button
  $button({
    appendTo: $('goBack2'),
    svgFn: arrow_left,
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
    appendTo: $('historyNavBtn'),
    svgFn: svg_notes,
    listener: { fn: () => openFoodHistory() },
  });

  $button({
    appendTo: $('logoutBtn'),
    svgFn: svg_logout,
    listener: { fn: logout },
  });

  $('newItemBtn').addEventListener('click', () => { openItemForm(false); });

  $button({
    appendTo: $('searchToggleBtn'),
    svgFn: svg_search,
    listener: { fn: toggleSearch },
  });

  $button({
    label: 'Usado',
    svgFn: svg_check,
    class: 'horizontal',
    listener: { fn: markItemUsed },
    appendTo: $('usedBtn'),
  });
  $button({
    label: 'Tirado',
    svgFn: svg_trash,
    class: 'horizontal',
    listener: { fn: markItemDiscarded },
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
    appendTo: $queryOne('#singleItemView .edit-btn'),
  });
  $button({
    // Borrar Alimento
    listener: { fn: tryDeleteItem },
    svgFn: svg_trash,
    appendTo: $queryOne('#singleItemView .delete-btn'),
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


function dbugBtns() {
  const mainFooter = $('mainFooter');
    $button({
    label: 'Logs',
    appendTo: mainFooter,
    listener: { fn: e => openLogs() }
  });
}


export { initUi, dbugBtns, pageTitle };
