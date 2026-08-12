export const INVALID_JSON_MESSAGE = 'JSON inválido';

/**
 * Reads and JSON-parses a request body. Resolves {} for an empty body.
 * @param {import('./types').ApiRequest} req
 * @returns {Promise<Object>}
 */
export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      if (!raw) { return resolve({}); }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error(INVALID_JSON_MESSAGE));
      }
    });
    req.on('error', reject);
  });
}
