import { $, $new, display, undisplay } from "./dom.js";


/** @type {'log'|'warn'|'error'|'info'} */
var logLevel = 'log';

const logger = $('logger');
const logs = $('logs');

$('closeLogsBtn').addEventListener('pointerup', closeLogs);

logs.addEventListener('click', e => {
  // @ts-ignore
  const entry = e.target.closest('.log-entry')
  if (!entry) { return }
  entry.classList.toggle('folded')
})

function openLogs() {
  display(logger);
}

function closeLogs() {
  undisplay(logger);
}

function log() {
  console[logLevel](...arguments);

  [...arguments].forEach(arg => {
    let text = '';
    switch (typeof arg) {
      case 'boolean':
      case 'bigint':
      case 'number':
      case 'symbol':
      case 'function':
        text = String(arg); break;
      case 'object':
        if (arg instanceof Error) {
          _error(arg.message);
          _error(arg.stack);
          return;
        } else {
          text = JSON.stringify(arg, null, 2); break;
        }
      case 'string':
        text = arg; break;
      case "undefined":
        text = "undefined"; break;
      default:
        text = String(arg); break;
    }
    const p = $new({ tag: 'pre', class: 'folded log-entry type-' + logLevel, text });
    if (logLevel === 'error') { p.classList.remove('folded') }
    logs.prepend(p);
  });
}


function _log() {
  logLevel = 'log';
  log(...arguments);
}
function _warn() {
  logLevel = 'warn';
  log(...arguments);
}
function _error() {
  logLevel = 'error';
  log(...arguments);
  openLogs();
}
function _info() {
  logLevel = 'info';
  log(...arguments);
}

window.onerror = e => _error('window.onerror:', e);

window.addEventListener('unhandledrejection', e => _error('unhandledrejection:', e.reason));


export { _log, _warn, _error, _info, openLogs, closeLogs };
