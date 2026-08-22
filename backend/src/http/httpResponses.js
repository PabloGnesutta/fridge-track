import { debug } from '../logger/logger.js';


/**
 * @param {import('./types').ApiResponse} res
 * @param {string} msg
 * @param {number} [status=400] - Default 400
 * @param {Record<string, *>} [extra] - merged alongside `error` in the JSON
 *   body, e.g. `{ requiresVerification: true }` - additive, existing callers
 *   that only ever read `.error` are unaffected.
 */
export function errorResponse(res, msg, status = 400, extra) {
  debug(' @errorResponse:', msg);
  res.writeHead(status, { 'content-type': 'application/json' });
  return res.end(JSON.stringify({ error: msg, ...extra }));
}

/**
 * @param {import('./types').ApiResponse} res
 * @param {*} data
 * @param {number} [status=200] - Default 200
 */
export function successResponse(res, data, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' });
  return res.end(JSON.stringify({ data }));
}
