/**
 * @returns {string} A client-generated unique id, used as an IndexedDB primary
 * key for records that need to stay collision-free across devices (required
 * ahead of syncing to the backend in a later phase).
 */
function generateId() {
  return crypto.randomUUID();
}

export { generateId };
