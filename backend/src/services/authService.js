import { randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from '../auth/passwordHash.js';
import { isEmailAllowed } from '../db/allowedEmails.js';
import { ServiceError } from './ServiceError.js';


/**
 * @param {import('node:sqlite').DatabaseSync} db
 */
function createAuthService(db) {
  /**
   * @param {string} email
   * @param {string} password
   * @param {string} [name]
   */
  function createUser(email, password, name = '') {
    email = String(email || '').trim().toLowerCase();
    if (!email || !password) { throw new ServiceError('Email y contraseña requeridos'); }
    if (!isEmailAllowed(db, email)) { throw new ServiceError('Este email no está autorizado para crear una cuenta'); }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) { throw new ServiceError('Ya existe una cuenta con ese email'); }

    const info = db.prepare(
      'INSERT INTO users (email, password_hash, name, created_at) VALUES (?, ?, ?, ?)'
    ).run(email, hashPassword(password), name, Date.now());

    // pushEnabled/emailEnabled hardcoded true here rather than re-queried -
    // matches the columns' own DEFAULT 1, so this is just avoiding a
    // redundant round-trip for a value we already know.
    return { id: Number(info.lastInsertRowid), email, name, pushEnabled: true, emailEnabled: true };
  }

  /**
   * @param {string} email
   * @param {string} password
   */
  function verifyLogin(email, password) {
    email = String(email || '').trim().toLowerCase();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !verifyPassword(password, /** @type {string} */(user.password_hash))) {
      throw new ServiceError('Email o contraseña incorrectos');
    }
    return user;
  }

  /**
   * @param {number} userId
   * @returns {string} the new bearer token
   */
  function createSession(userId) {
    const token = randomBytes(32).toString('hex');
    db.prepare(
      'INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)'
    ).run(token, userId, Date.now());
    return token;
  }

  /**
   * @param {string} token
   */
  function getUserBySessionToken(token) {
    if (!token) { return null; }
    const row = db.prepare(
      `SELECT users.id, users.email, users.name, users.push_enabled, users.email_enabled FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token = ?`
    ).get(token);
    if (!row) { return null; }
    return {
      id: row.id, email: row.email, name: row.name,
      pushEnabled: !!row.push_enabled, emailEnabled: !!row.email_enabled,
    };
  }

  /**
   * @param {string} token
   */
  function deleteSession(token) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  /**
   * @param {number} userId
   * @param {{pushEnabled?: boolean, emailEnabled?: boolean}} prefs
   */
  function updateNotificationPreferences(userId, prefs) {
    if (prefs.pushEnabled !== undefined) {
      db.prepare('UPDATE users SET push_enabled = ? WHERE id = ?').run(prefs.pushEnabled ? 1 : 0, userId);
    }
    if (prefs.emailEnabled !== undefined) {
      db.prepare('UPDATE users SET email_enabled = ? WHERE id = ?').run(prefs.emailEnabled ? 1 : 0, userId);
    }
    const row = db.prepare('SELECT push_enabled, email_enabled FROM users WHERE id = ?').get(userId);
    return { pushEnabled: !!row.push_enabled, emailEnabled: !!row.email_enabled };
  }

  return {
    createUser, verifyLogin, createSession, getUserBySessionToken, deleteSession,
    updateNotificationPreferences,
  };
}

export { createAuthService };
