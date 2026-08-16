/**
 * Lets a location declare what kind of stuff it holds (food, medicine,
 * ...), so the app isn't hard-locked to food. Existing rows default to
 * 'alimento' - the app's only category until now - so nothing changes
 * visually for anyone until they set something else.
 */
const sql = `
ALTER TABLE locations ADD COLUMN category TEXT NOT NULL DEFAULT 'alimento';
`;

export { sql };
