import { appState, dataState, dbStore, setStateField } from "../common/state.js";
import { $, $button, $getInner, $queryOne } from "../lib/dom.js";
import { _info, _log, _warn, openLogs } from "../lib/logger.js";
import { arrow_left, pen_solid, svg_trash } from "../svg/svgFn.js";
import {
  openAddLocationFromSwitcher, openLocationSwitcher, submitLocationForm, switchLocation,
} from "./location-ui.js";
import {
  closeSingleItem, markItemDiscarded, markItemUsed, openItemForm, openSingleItem, submitItemBtn, submitItemForm, tryDeleteItem,
} from "./item-ui.js";


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
          default: break;
        }
      }
    }
  });

  $('locationSwitcherBtn').addEventListener('click', () => { openLocationSwitcher(); });
  $('newItemBtn').addEventListener('click', () => { openItemForm(false); });
  $('addLocationBtn').addEventListener('click', () => { openAddLocationFromSwitcher(); });
  $('usedBtn').addEventListener('click', () => { markItemUsed(); });
  $('discardedBtn').addEventListener('click', () => { markItemDiscarded(); });

  $button({
    label: 'Agregar Ubicación',
    listener: { fn: submitLocationForm },
    appendTo: $queryOne('#locationForm .submit'),
  });

  $button({
    label: 'Crear Alimento',
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
    if (!(target instanceof HTMLElement)) { return; }
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
      setStateField('showLocationSwitcher', false);
      setStateField('showItemForm', false);
    }
  });
}


function dbugBtns() {
  const mainFooter = $('mainFooter');
  $button({
    label: 'State',
    appendTo: mainFooter,
    listener: {
      fn: e => {
        _log('dbStore', dbStore);
        _log('dataState', dataState);
        openLogs()
      }
    }
  });
  $button({
    label: 'Logs',
    appendTo: mainFooter,
    listener: { fn: e => openLogs() }
  });
}


export { initUi, dbugBtns, pageTitle };
