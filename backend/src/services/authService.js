import { randomBytes, randomInt } from 'node:crypto';
import { hashPassword, verifyPassword } from '../auth/passwordHash.js';
import { isEmailAllowed } from '../db/allowedEmails.js';
import { getAppBaseUrl } from '../lib/appUrl.js';
import { ServiceError } from './ServiceError.js';
import { createEmailService } from './emailService.js';

// A code lives long enough for someone to actually check their inbox, but a
// resend can't be spammed - both deliberately generous rather than tight,
// since a locked-out real user is a worse outcome than a slightly-abusable
// resend button on a single-user app today.
const VERIFICATION_CODE_TTL_MS = 15 * 60 * 1000;
const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;

/**
 * @returns {string} a zero-padded 6-digit code, e.g. "004213"
 */
function generateVerificationCode() {
  return String(randomInt(0, 1000000)).padStart(6, '0');
}

/**
 * Builds the "just click this" magic link alongside the code.
 * @param {string} email
 * @param {string} code
 */
function buildVerificationLink(email, code) {
  return `${getAppBaseUrl()}/?email=${encodeURIComponent(email)}&code=${encodeURIComponent(code)}`;
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{sendEmail: (opts: {to: string, subject: string, text: string, appName?: string}) => Promise<boolean>}} [emailService]
 *   Injectable, same `create*Service` factory shape as recipeService.js's
 *   edamamClient param - production code gets the real emailService.js,
 *   tests can pass a stub with no SMTP config required. sendEmail() itself
 *   never throws (logs and returns false on missing config/failure), so
 *   callers here don't need their own try/catch around it.
 */
function createAuthService(db, emailService = createEmailService()) {
  /**
   * @param {string} email
   * @param {string} code
   */
  async function sendVerificationEmail(email, code) {
    const link = buildVerificationLink(email, code);
    await emailService.sendEmail({
      to: email,
      subject: 'Confirmá tu email - FridgeTrack',
      text: `Tu código de verificación es: ${code}\n\n`
        + `O confirmá tu cuenta con un solo toque, sin escribir nada:\n${link}\n\n`
        + `Vence en 15 minutos. Si no creaste una cuenta, podés ignorar este mensaje.`,
    });
  }

  /**
   * Deliberately stays synchronous (returns the user, not a Promise) even
   * though sending the email is async - fire-and-forget, same as
   * expiryNotifier's push sends, since sendVerificationEmail() (via
   * emailService.sendEmail()) never rejects. Keeping this sync also means
   * every existing test/service that uses createUser purely as a fixture
   * (homeService/syncService/pushService/recipeService, none of which ever
   * call verifyLogin) needed zero changes for this feature.
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

    const code = generateVerificationCode();
    const now = Date.now();
    const info = db.prepare(
      `INSERT INTO users (
        email, password_hash, name, created_at,
        email_verified, verification_code, verification_code_sent_at, verification_code_expires_at
      ) VALUES (?, ?, ?, ?, 0, ?, ?, ?)`
    ).run(email, hashPassword(password), name, now, code, now, now + VERIFICATION_CODE_TTL_MS);

    sendVerificationEmail(email, code);

    // pushEnabled/emailEnabled hardcoded true here rather than re-queried -
    // matches the columns' own DEFAULT 1, so this is just avoiding a
    // redundant round-trip for a value we already know.
    return {
      id: Number(info.lastInsertRowid), email, name,
      pushEnabled: true, emailEnabled: true, emailVerified: false,
    };
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
    if (!user.email_verified) {
      throw new ServiceError('Todavía no confirmaste tu email', { requiresVerification: true });
    }
    return user;
  }

  /**
   * @param {string} email
   * @param {string} code
   */
  function verifyEmailCode(email, code) {
    email = String(email || '').trim().toLowerCase();
    code = String(code || '').trim();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) { throw new ServiceError('No existe una cuenta con ese email'); }
    if (user.email_verified) { throw new ServiceError('Este email ya fue confirmado'); }
    if (!user.verification_code || !code || user.verification_code !== code) {
      throw new ServiceError('Código incorrecto');
    }
    if (!user.verification_code_expires_at || Date.now() > user.verification_code_expires_at) {
      throw new ServiceError('El código venció, pedí uno nuevo');
    }

    db.prepare(
      `UPDATE users SET email_verified = 1, verification_code = NULL,
       verification_code_sent_at = NULL, verification_code_expires_at = NULL WHERE id = ?`
    ).run(user.id);

    return { id: user.id, email: user.email, name: user.name };
  }

  /**
   * @param {string} email
   */
  async function resendVerificationCode(email) {
    email = String(email || '').trim().toLowerCase();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) { throw new ServiceError('No existe una cuenta con ese email'); }
    if (user.email_verified) { throw new ServiceError('Este email ya fue confirmado'); }
    if (user.verification_code_sent_at && Date.now() - user.verification_code_sent_at < VERIFICATION_RESEND_COOLDOWN_MS) {
      throw new ServiceError('Esperá un momento antes de pedir otro código');
    }

    const code = generateVerificationCode();
    const now = Date.now();
    db.prepare(
      `UPDATE users SET verification_code = ?, verification_code_sent_at = ?,
       verification_code_expires_at = ? WHERE id = ?`
    ).run(code, now, now + VERIFICATION_CODE_TTL_MS, user.id);

    await sendVerificationEmail(email, code);
    return { ok: true };
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
    createUser, verifyLogin, verifyEmailCode, resendVerificationCode,
    createSession, getUserBySessionToken, deleteSession,
    updateNotificationPreferences,
  };
}

export { createAuthService };
