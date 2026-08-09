import { debug } from '../logger/logger.js';


/**
 * @param {import('./types').ApiResponse} res
 * @param {string} msg
 * @param {number} [status=400] - Default 400
 */
export function errorResponse(res, msg, status = 400) {
  debug(' @errorResponse:', msg);
  res.writeHead(status, { 'content-type': 'application/json' });
  return res.end(JSON.stringify({ error: msg }));
}
