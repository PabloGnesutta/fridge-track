/**
 * Pure last-write-wins comparison logic for the sync engine. No DOM/IDB
 * imports, so this is unit-testable under plain Node (see CLAUDE.md's
 * DOM-free-module testing convention).
 */

/**
 * @param {Date|number|null|undefined} value
 * @returns {number}
 */
function toMillis(value) {
  if (value == null) { return -Infinity; }
  return value instanceof Date ? value.getTime() : Number(value);
}

/**
 * Given a local record and a remote (pulled) record for the same key,
 * returns whichever has the greater `updatedAt`, treating a missing/null
 * `updatedAt` as older than anything. If one side is absent, the other wins
 * outright.
 * @param {{updatedAt?: Date|number|null}|null} local
 * @param {{updatedAt?: Date|number|null}|null} remote
 */
function pickWinner(local, remote) {
  if (!local) { return remote; }
  if (!remote) { return local; }
  return toMillis(remote.updatedAt) > toMillis(local.updatedAt) ? remote : local;
}

/**
 * @param {{updatedAt?: Date|number|null}|null} local
 * @param {{updatedAt?: Date|number|null}|null} remote
 * @returns {boolean} true when the remote record should be applied locally
 */
function remoteWins(local, remote) {
  return pickWinner(local, remote) === remote;
}

export { pickWinner, remoteWins };
