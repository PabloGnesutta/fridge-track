/**
 * A rejection with a user-facing message (bad input, duplicate email, wrong
 * credentials, invalid join-code) - the API router maps these to a 400
 * instead of logging them as unexpected server errors.
 */
class ServiceError extends Error {}

export { ServiceError };
