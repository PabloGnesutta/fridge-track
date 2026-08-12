import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { debug, log } from '../logger/logger.js';
import { errorResponse } from './httpResponses.js';
import { handleApiRequest } from './apiRouter.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PUBLIC_DIR = join(__dirname, '../', '../', '../', 'frontend');

/**
 * Main handler of the request. 
 * First thing that executes in the request lifecycle.
 * // TODO:? Make it always return ApiResponse
 * @param {import('./types').ApiRequest} req - request object.
 * @param {import('./types').ApiResponse} res - response object.
 * @returns {Promise<import('./types').ApiResponse | null>}
 */
export async function handleRequest(req, res) {
  const _url = req.url || '/'
  try {
    if (_url === '/') {
      return sendAssetFile(res, ['index.html'], 'text/html');
    }

    const urlArray = _url.split('/');
    const pathBase = urlArray[1];
    const fileRoute = urlArray.slice(1, urlArray.length);
    debug('urlArray', urlArray)

    if (pathBase === 'api') {
      return handleApiRequest(req, res, fileRoute.slice(1));
    }

    if (pathBase === 'css') return sendAssetFile(res, fileRoute, 'text/css');
    else if (pathBase === 'js') return sendAssetFile(res, fileRoute, 'application/javascript');
    else if (pathBase === 'static') {
      if (fileRoute[1] === 'icons') {
        return sendAssetFile(res, fileRoute, 'image/png');
      }
      else if (fileRoute[1] === 'manifest.json') {
        return sendAssetFile(res, fileRoute, 'application/json');
      }
    }

    else if (pathBase === 'cacheServiceWorker.js') {
      return sendAssetFile(res, ['cacheServiceWorker.js'], 'application/javascript');
    }
    else if (pathBase === 'favicon.ico') {
      return sendAssetFile(res, ['static', pathBase], 'image/x-icon');
    }

    // TODO: Can't this be checked against then plain ´_url´ string?
    // Client-side routes (e.g. /item/42): the last path segment has no file
    // extension, so it isn't a static asset request - serve the app shell
    // and let the frontend router resolve the URL.
    const lastSegment = fileRoute[fileRoute.length - 1] || '';
    if (!lastSegment.includes('.')) {
      return sendAssetFile(res, ['index.html'], 'text/html');
    }

    // 404
    return errorResponse(res, 'Resource not found ' + _url, 404);
  } catch (_err) {
    log('---Error @handleRequest', _err);
    return errorResponse(res, 'Something went wrong', 500);
  }
}

/**
 * Uses the response object to stream static files. 
 * Returns null.
 * @param {import('./types').ApiResponse} res - response object
 * @param {string[]} fileRoute
 * @param {string} contentType - Should pobably be an enum
 * @returns {null}
 */
function sendAssetFile(res, fileRoute, contentType) {
  // TODO: Not very fond of this spread
  const filePath = join(PUBLIC_DIR, ...fileRoute);
  fs.stat(filePath, (err, stat) => {
    if (err === null) {
      res.writeHead(200, { 'content-type': contentType });
      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
      return;
    }

    if (err.code === 'ENOENT') {
      log('---File does not exist @sendAssetFile', filePath);
      res.writeHead(404);
      res.end();
    } else {
      log('---Error @sendAssetFile', err);
      res.writeHead(500);
      res.end();
    }
  });
  return null;
}
