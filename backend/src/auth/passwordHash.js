import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';


const KEY_LENGTH = 64;

/**
 * @param {string} password
 * @returns {string} "salt:hash", both hex-encoded
 */
function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `${salt}:${hash}`;
}

/**
 * @param {string} password
 * @param {string} stored "salt:hash" as produced by hashPassword
 * @returns {boolean}
 */
function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) { return false; }
  const candidate = scryptSync(password, salt, KEY_LENGTH);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export { hashPassword, verifyPassword };
