import { db } from '../db/db.js';
import { readJsonBody, INVALID_JSON_MESSAGE } from './bodyParser.js';
import { errorResponse, successResponse } from './httpResponses.js';
import { createAuthService } from '../services/authService.js';
import { createHomeService } from '../services/homeService.js';
import { createSyncService } from '../services/syncService.js';
import { createPushService } from '../services/pushService.js';
import { createRecipeService } from '../services/recipeService.js';
import { ServiceError } from '../services/ServiceError.js';
import { error } from '../logger/logger.js';


const authService = createAuthService(db);
const homeService = createHomeService(db);
const syncService = createSyncService(db);
const pushService = createPushService(db);
const recipeService = createRecipeService(db);

/**
 * @param {import('./types').ApiRequest} req
 */
function getBearerUser(req) {
  const authHeader = req.headers['authorization'] || '';
  const [, token] = authHeader.split(' ');
  return token ? authService.getUserBySessionToken(token) : null;
}

/**
 * Routes /api/* requests. All routes are POST-only, matching the frontend's
 * apiCaller.js, which always does `fetch('api/' + path, {method: 'POST'})`.
 * @param {import('./types').ApiRequest} req
 * @param {import('./types').ApiResponse} res
 * @param {string[]} segments - path segments after 'api', e.g. ['homes','create']
 */
export async function handleApiRequest(req, res, segments) {
  const route = segments.join('/');
  try {
    const body = await readJsonBody(req);

    if (route === 'signup') {
      const user = authService.createUser(body.email, body.password, body.name);
      const accessToken = authService.createSession(user.id);
      return successResponse(res, {
        accessToken, userId: user.id, email: user.email, name: user.name,
        pushEnabled: user.pushEnabled, emailEnabled: user.emailEnabled,
      });
    }
    if (route === 'login') {
      // verifyLogin returns the raw `users` row (snake_case columns,
      // including password_hash) - only picking named fields here keeps
      // that out of the response.
      const user = authService.verifyLogin(body.email, body.password);
      const accessToken = authService.createSession(user.id);
      return successResponse(res, {
        accessToken, userId: user.id, email: user.email, name: user.name,
        pushEnabled: !!user.push_enabled, emailEnabled: !!user.email_enabled,
      });
    }

    // Every route below requires a valid bearer token.
    const user = getBearerUser(req);
    if (!user) { return errorResponse(res, 'No autorizado', 401); }

    if (route === 'whoami') { return successResponse(res, user); }
    if (route === 'logout') {
      const [, token] = (req.headers['authorization'] || '').split(' ');
      authService.deleteSession(token);
      return successResponse(res, { ok: true });
    }
    if (route === 'homes/create') { return successResponse(res, homeService.createHome(user.id, body.name)); }
    if (route === 'homes/join') { return successResponse(res, homeService.joinHome(user.id, body.joinCode)); }
    if (route === 'homes/list') { return successResponse(res, homeService.listHomesForUser(user.id)); }
    if (route === 'sync/pull') { return successResponse(res, syncService.pullHomeSnapshot(user.id, body.homeId)); }
    if (route === 'sync/push') { return successResponse(res, syncService.pushHomeSnapshot(user.id, body.homeId, body.snapshot)); }
    if (route === 'push/vapid-public-key') { return successResponse(res, { publicKey: process.env.VAPID_PUBLIC_KEY }); }
    if (route === 'push/subscribe') {
      pushService.saveSubscription(user.id, body.subscription);
      return successResponse(res, { ok: true });
    }
    if (route === 'push/unsubscribe') {
      pushService.removeSubscription(user.id, body.endpoint);
      return successResponse(res, { ok: true });
    }
    if (route === 'recipes/suggestions') {
      return successResponse(res, await recipeService.getSuggestionsForHome(user.id, body.homeId));
    }
    if (route === 'notifications/preferences') {
      return successResponse(res, authService.updateNotificationPreferences(user.id, {
        pushEnabled: body.pushEnabled, emailEnabled: body.emailEnabled,
      }));
    }

    return errorResponse(res, 'Ruta de API no encontrada: ' + route, 404);
  } catch (err) {
    if (err instanceof ServiceError) { return errorResponse(res, err.message, 400); }
    if (err instanceof Error && err.message === INVALID_JSON_MESSAGE) {
      return errorResponse(res, err.message, 400);
    }
    error('---Error @handleApiRequest', err);
    return errorResponse(res, 'Something went wrong', 500);
  }
}
