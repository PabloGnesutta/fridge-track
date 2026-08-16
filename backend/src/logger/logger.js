/**
 * Thin console wrapper adding a timestamp + level tag to every line, so
 * server output (wherever the process's stdout/stderr actually ends up -
 * a nohup file, `pm2 logs`, `journalctl`, etc.) can be correlated against
 * a client-side report ("this happened around 3pm") and filtered by level.
 * No logging library/dependency - this is a personal-scale app, a plain
 * formatting wrapper is enough.
 */

/** @returns {string} */
function timestamp() {
  return new Date().toISOString();
}

/** @param {...*} args */
function debug(...args) {
  console.debug(`[${timestamp()}] [DEBUG]`, ...args);
}

/** @param {...*} args */
function log(...args) {
  console.log(`[${timestamp()}] [LOG]`, ...args);
}

/** @param {...*} args */
function warn(...args) {
  console.warn(`[${timestamp()}] [WARN]`, ...args);
}

/** @param {...*} args */
function error(...args) {
  console.error(`[${timestamp()}] [ERROR]`, ...args);
}

export { debug, log, warn, error };
