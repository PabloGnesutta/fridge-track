/**
 * A rejection with a user-facing message (bad input, duplicate email, wrong
 * credentials, invalid join-code) - the API router maps these to a 400
 * instead of logging them as unexpected server errors.
 *
 * `extra` (optional) is merged onto the instance and, in turn, into the JSON
 * error response - e.g. `{ requiresVerification: true }` so the frontend can
 * tell "wrong password" apart from "right password, unverified email" and
 * route to the right screen instead of just showing red text.
 */
class ServiceError extends Error {
  /**
   * @param {string} message
   * @param {Record<string, *>} [extra]
   */
  constructor(message, extra) {
    super(message);
    if (extra) { Object.assign(this, extra); }
  }
}

export { ServiceError };
