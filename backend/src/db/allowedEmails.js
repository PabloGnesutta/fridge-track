/**
 * @param {string} email
 * @returns {string}
 */
function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} email
 */
function addAllowedEmail(db, email) {
  db.prepare(
    'INSERT OR IGNORE INTO allowed_emails (email, added_at) VALUES (?, ?)'
  ).run(normalizeEmail(email), Date.now());
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} email
 */
function removeAllowedEmail(db, email) {
  db.prepare('DELETE FROM allowed_emails WHERE email = ?').run(normalizeEmail(email));
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {string[]}
 */
function listAllowedEmails(db) {
  /** @type {{email: string}[]} */ // @ts-ignore
  const rows = db.prepare('SELECT email FROM allowed_emails ORDER BY email').all();
  return rows.map(row => row.email);
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} email
 * @returns {boolean}
 */
function isEmailAllowed(db, email) {
  return !!db.prepare('SELECT 1 FROM allowed_emails WHERE email = ?').get(normalizeEmail(email));
}

export { addAllowedEmail, removeAllowedEmail, listAllowedEmails, isEmailAllowed };
