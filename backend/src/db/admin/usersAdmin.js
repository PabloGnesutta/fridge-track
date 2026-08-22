import { deleteHomeCascade } from './homesAdmin.js';

/**
 * Admin-only helpers for inspecting/deleting a user account directly against
 * the database - not exposed via the API, only through manageUsers.js.
 * Mirrors homesAdmin.js's shape (plain `(db, ...)` functions, no service-
 * layer ceremony) since these are one-off operator tools, not app-facing
 * logic.
 */

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} email
 */
function findUserByEmail(db, email) {
  const normalized = String(email || '').trim().toLowerCase();
  return db.prepare('SELECT id, email FROM users WHERE email = ?').get(normalized);
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {{
 *   id: number, email: string, name: string, createdAt: number, emailVerified: boolean,
 *   homeCount: number, homesCreatedCount: number, sessionCount: number,
 * }[]}
 */
function listUsers(db) {
  /** @type {any[]} */
  const rows = db.prepare(`
    SELECT
      users.id AS id,
      users.email AS email,
      users.name AS name,
      users.created_at AS createdAt,
      users.email_verified AS emailVerified,
      (SELECT COUNT(*) FROM home_members WHERE home_members.user_id = users.id) AS homeCount,
      (SELECT COUNT(*) FROM homes WHERE homes.created_by = users.id) AS homesCreatedCount,
      (SELECT COUNT(*) FROM sessions WHERE sessions.user_id = users.id) AS sessionCount
    FROM users
    ORDER BY users.id
  `).all();

  return rows.map(row => ({
    id: Number(row.id),
    email: row.email,
    name: row.name,
    createdAt: Number(row.createdAt),
    emailVerified: !!row.emailVerified,
    homeCount: Number(row.homeCount),
    homesCreatedCount: Number(row.homesCreatedCount),
    sessionCount: Number(row.sessionCount),
  }));
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} userId
 * @returns {{id: number, name: string}[]}
 */
function listHomesCreatedBy(db, userId) {
  /** @type {any[]} */
  const rows = db.prepare('SELECT id, name FROM homes WHERE created_by = ?').all(userId);
  return rows.map(row => ({ id: Number(row.id), name: row.name }));
}

/**
 * Counts every row across every table that references this user, without
 * deleting anything - used by manageUsers.js to show a preview before the
 * real, `--yes`-gated delete runs. Each Home the user created is broken out
 * individually with its own member count, since deleteUserCascade below
 * doesn't just unlink those Homes - it deletes them entirely, which can
 * affect other members who never asked to lose access.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} email
 * @returns {{
 *   user: {id: number, email: string}|null,
 *   sessions: number, pushSubscriptions: number, notificationLog: number, memberships: number,
 *   homesCreated: {id: number, name: string, memberCount: number}[],
 * }}
 */
function previewUserCascade(db, email) {
  /** @type {any} */
  const user = findUserByEmail(db, email);
  if (!user) {
    return {
      user: null, sessions: 0, pushSubscriptions: 0, notificationLog: 0, memberships: 0, homesCreated: [],
    };
  }

  const count = (table) =>
    /** @type {any} */ (db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE user_id = ?`).get(user.id)).c;

  const homesCreated = listHomesCreatedBy(db, user.id).map(home => ({
    ...home,
    memberCount: /** @type {any} */ (
      db.prepare('SELECT COUNT(*) AS c FROM home_members WHERE home_id = ?').get(home.id)
    ).c,
  }));

  return {
    user: { id: Number(user.id), email: user.email },
    sessions: count('sessions'),
    pushSubscriptions: count('push_subscriptions'),
    notificationLog: count('push_notification_log'),
    memberships: count('home_members'),
    homesCreated,
  };
}

/**
 * Deletes a user and every row that references them. `homes.created_by` is
 * `NOT NULL REFERENCES users(id)`, so a Home this user created can't be left
 * behind with a dangling owner once the user is gone - each such Home is
 * cascade-deleted in full via homesAdmin.js's own deleteHomeCascade (reused
 * rather than duplicated), which also removes every OTHER member's access to
 * it. previewUserCascade's per-home memberCount is what lets an operator see
 * that coming before confirming.
 *
 * Not wrapped in one single transaction end-to-end: each deleteHomeCascade
 * call is already its own transaction, and nesting a BEGIN inside another
 * isn't supported by sqlite. The remaining leaf-table deletes (sessions,
 * push subscriptions, notification log, memberships) plus the user row
 * itself are wrapped together in one final transaction instead.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} email
 * @returns {{
 *   user: {id: number, email: string},
 *   deletedHomes: {id: number, name: string}[],
 *   sessions: number, pushSubscriptions: number, notificationLog: number, memberships: number,
 * }|null} null if no user with that email exists.
 */
function deleteUserCascade(db, email) {
  /** @type {any} */
  const user = findUserByEmail(db, email);
  if (!user) { return null; }

  const deletedHomes = [];
  for (const home of listHomesCreatedBy(db, user.id)) {
    const result = deleteHomeCascade(db, home.id);
    if (result) { deletedHomes.push(result.home); }
  }

  const del = (table) =>
    /** @type {any} */ (db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(user.id)).changes;

  db.exec('BEGIN');
  try {
    const sessions = del('sessions');
    const pushSubscriptions = del('push_subscriptions');
    const notificationLog = del('push_notification_log');
    const memberships = del('home_members');
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    db.exec('COMMIT');

    return {
      user: { id: Number(user.id), email: user.email },
      deletedHomes, sessions, pushSubscriptions, notificationLog, memberships,
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export { listUsers, findUserByEmail, previewUserCascade, deleteUserCascade };
