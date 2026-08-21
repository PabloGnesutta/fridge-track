/**
 * Gives food_name_history a tombstone for the first time - it was
 * deliberately "never deleted" up to now (see CLAUDE.md), but editing an
 * entry's name needs one anyway: normalized_name is derived from name and is
 * part of this table's primary key, so a real rename (not just a
 * capitalization fix) moves a row to a new key rather than updating it in
 * place - the old key gets soft-deleted exactly like this new column lets
 * items/locations already do, propagating through sync the same way.
 * A plain ADD COLUMN is enough this time (unlike migration 005) since
 * deleted_at isn't part of the primary key.
 */
const sql = `
ALTER TABLE food_name_history ADD COLUMN deleted_at INTEGER;
`;

export { sql };
