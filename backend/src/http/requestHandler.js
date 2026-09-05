import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';
import { debug, log, error } from '../logger/logger.js';
import { errorResponse } from './httpResponses.js';
import { handleApiRequest } from './apiRouter.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PUBLIC_DIR = join(__dirname, '../', '../', '../', 'frontend');
const PUBLIC_DIR_RESOLVED = resolve(PUBLIC_DIR);

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
  // Every check below is pathname-based (root check, the static-asset
  // prefixes, the "does the last segment have a dot" SPA-fallback
  // heuristic) - split off the query string first, or a query value that
  // happens to contain a dot (an email address, always does via its domain)
  // corrupts that last check and wrongly 404s a real client route.
  const pathname = _url.split('?')[0];
  try {
    if (pathname === '/') {
      return sendAssetFile(res, ['index.html'], 'text/html');
    }

    const urlArray = pathname.split('/');
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
      // Must never be cached by anything between the browser and this server (a mobile carrier's
      // transparent proxy, in particular - a very plausible reason one Android device sees the
      // update banner while another on a different network doesn't). Chrome's SW "soft update"
      // check (fired on every navigation, and what a manual refresh triggers) only force-bypasses
      // HTTP caching once every ~24h; the rest of the time a stale cached copy here means the
      // byte-diff check compares against old bytes and never finds an update, no matter how many
      // times the page is refreshed.
      return sendAssetFile(res, ['cacheServiceWorker.js'], 'application/javascript', {
        'cache-control': 'no-store',
      });
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
    error('---Error @handleRequest', _err);
    return errorResponse(res, 'Something went wrong', 500);
  }
}

/**
 * Uses the response object to stream static files.
 * Returns null.
 * @param {import('./types').ApiResponse} res - response object
 * @param {string[]} fileRoute
 * @param {string} contentType - Should pobably be an enum
 * @param {Record<string, string>} [extraHeaders]
 * @returns {null}
 */
function sendAssetFile(res, fileRoute, contentType, extraHeaders) {
  // TODO: Not very fond of this spread
  const filePath = resolve(PUBLIC_DIR, ...fileRoute);
  // fileRoute segments come straight from the request URL - resolve() collapses any
  // ".." in them, so confirm the result is still inside PUBLIC_DIR before touching
  // the filesystem, or a path like /css/../../backend/.env reads arbitrary files.
  if (filePath !== PUBLIC_DIR_RESOLVED && !filePath.startsWith(PUBLIC_DIR_RESOLVED + sep)) {
    res.writeHead(404);
    res.end();
    return;
  }
  fs.stat(filePath, (err, stat) => {
    if (err === null) {
      res.writeHead(200, { 'content-type': contentType, ...extraHeaders });
      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
      return;
    }

    if (err.code === 'ENOENT') {
      log('---File does not exist @sendAssetFile', filePath);
      res.writeHead(404);
      res.end();
    } else {
      error('---Error @sendAssetFile', err);
      res.writeHead(500);
      res.end();
    }
  });
  return null;
}
