import { randomBytes, randomUUID } from 'node:crypto';
import { addAllowedEmail } from '../db/allowedEmails.js';
import { deleteHomeCascade } from '../db/homeCascadeDelete.js';
import { getAppBaseUrl } from '../lib/appUrl.js';
import { ServiceError } from './ServiceError.js';
import { createEmailService } from './emailService.js';


// The 3 built-in categories every new Home gets seeded with (see
// docs/plans/categories-table.md) - migration 007/010 backfill this same
// set with these same display labels for Homes that existed before
// categories became a real table.
const BUILTIN_CATEGORIES = ['Alimentos', 'Medicamentos', 'Otros'];


// Excludes visually-ambiguous characters (0/O, 1/I/L) since join-codes get
// read off one screen and typed into another.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const MAX_CODE_ATTEMPTS = 5;

function generateJoinCode() {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return code;
}

/**
 * Builds the "just click this" magic link alongside the join code - mirrors
 * authService.js's buildVerificationLink, a distinct query param
 * (?joinCode=) so the two link types never collide when the frontend reads
 * location.search on boot.
 * @param {string} joinCode
 */
function buildJoinLink(joinCode) {
  return `${getAppBaseUrl()}/?joinCode=${encodeURIComponent(joinCode)}`;
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} homeId
 * @param {number} userId
 */
function isHomeMember(db, homeId, userId) {
  return !!db.prepare(
    'SELECT 1 FROM home_members WHERE home_id = ? AND user_id = ?'
  ).get(homeId, userId);
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} homeId
 * @param {number} userId
 */
function assertHomeMembership(db, homeId, userId) {
  if (!isHomeMember(db, homeId, userId)) {
    throw new ServiceError('No autorizado para este Hogar');
  }
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{sendEmail: (opts: {to: string, subject: string, text: string, appName?: string}) => Promise<boolean>}} [emailService]
 *   Injectable, same `create*Service` factory shape as authService.js's own
 *   emailService param - production code gets the real emailService.js,
 *   tests can pass a stub with no SMTP config required.
 */
function createHomeService(db, emailService = createEmailService()) {
  /**
   * @param {number} userId
   * @param {string} name
   */
  function createHome(userId, name) {
    name = String(name || '').trim();
    if (!name) { throw new ServiceError('Ingresar nombre'); }

    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const joinCode = generateJoinCode();
      try {
        const info = db.prepare(
          'INSERT INTO homes (name, join_code, created_by, created_at) VALUES (?, ?, ?, ?)'
        ).run(name, joinCode, userId, Date.now());
        const homeId = Number(info.lastInsertRowid);
        db.prepare(
          'INSERT INTO home_members (home_id, user_id, joined_at) VALUES (?, ?, ?)'
        ).run(homeId, userId, Date.now());

        const now = Date.now();
        for (const categoryName of BUILTIN_CATEGORIES) {
          db.prepare(
            'INSERT INTO categories (id, home_id, name, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, NULL)'
          ).run(randomUUID(), homeId, categoryName, now, now);
        }

        return { id: homeId, name, joinCode, createdBy: userId };
      } catch (err) {
        const isCollision = err instanceof Error && err.message.includes('UNIQUE');
        if (!isCollision) { throw err; }
        // join_code collision - retry with a freshly generated code
      }
    }
    throw new ServiceError('No se pudo generar un código, reintentar');
  }

  /**
   * @param {number} userId
   * @param {string} joinCode
   */
  function joinHome(userId, joinCode) {
    const code = String(joinCode || '').trim().toUpperCase();
    const home = db.prepare('SELECT * FROM homes WHERE join_code = ?').get(code);
    if (!home) { throw new ServiceError('Código inválido'); }

    if (!isHomeMember(db, home.id, userId)) {
      db.prepare(
        'INSERT INTO home_members (home_id, user_id, joined_at) VALUES (?, ?, ?)'
      ).run(home.id, userId, Date.now());
    }
    return { id: Number(home.id), name: home.name, joinCode: home.join_code, createdBy: Number(home.created_by) };
  }

  /**
   * @param {number} userId
   */
  function listHomesForUser(userId) {
    const rows = db.prepare(
      `SELECT homes.id, homes.name, homes.join_code as joinCode, homes.created_by as createdBy FROM homes
       JOIN home_members ON home_members.home_id = homes.id
       WHERE home_members.user_id = ?`
    ).all(userId);
    return rows.map(row => ({
      id: Number(row.id), name: row.name, joinCode: row.joinCode, createdBy: Number(row.createdBy),
    }));
  }

  /**
   * Emails a join invite for a Home. Also allow-lists the invited address
   * (see db/allowedEmails.js) - signup is gated behind that list, so without
   * this an invite to someone with no existing account would be a dead end:
   * they'd get a link/code that works for joining, but couldn't create the
   * account needed to use it in the first place.
   *
   * Restricted to the Home's creator (`homes.created_by`), unlike every other
   * membership-gated action here (see deleteHome's comment on this app's flat
   * trust model) - a deliberate, narrow exception added after real invite
   * spam/abuse exhausted the outbound email quota, so only the one person who
   * made the Home can send mail on its behalf.
   * @param {number} userId
   * @param {number} homeId
   * @param {string} email
   */
  async function inviteToHome(userId, homeId, email) {
    assertHomeMembership(db, homeId, userId);
    email = String(email || '').trim().toLowerCase();
    if (!email) { throw new ServiceError('Ingresar un email'); }

    const home = db.prepare('SELECT * FROM homes WHERE id = ?').get(homeId);
    if (!home) { throw new ServiceError('Hogar no encontrado'); }
    if (home.created_by !== userId) {
      throw new ServiceError('Solo quien creó el Hogar puede enviar invitaciones');
    }

    const inviter = db.prepare('SELECT email, name FROM users WHERE id = ?').get(userId);
    const inviterLabel = (inviter && (inviter.name || inviter.email)) || 'Alguien';

    addAllowedEmail(db, email);

    const link = buildJoinLink(home.join_code);
    await emailService.sendEmail({
      to: email,
      subject: `Te invitaron al Hogar "${home.name}" - FridgeTrack`,
      text: `${inviterLabel} te invitó a unirte al Hogar "${home.name}" en FridgeTrack.\n\n`
        + `Código de invitación: ${home.join_code}\n\n`
        + `O simplemente abrí este enlace para unirte con un solo toque:\n${link}\n\n`
        + `Si no esperabas esta invitación, podés ignorar este mensaje.`,
    });

    return { ok: true };
  }

  /**
   * Deletes a Home and everything in it, for every member - not just this
   * user's own access to it. Gated by membership, not ownership: any member
   * can already edit or delete every item/location/category in a shared
   * Home, so requiring only membership here matches that same flat trust
   * model rather than introducing a role-based permission. inviteToHome
   * above is the one deliberate exception to this (creator-only, to stop
   * invite-driven email abuse) - deletion wasn't part of that problem, so it
   * stays open to every member. The confirm dialog on the client is what
   * actually carries the "this affects everyone" warning - there's no undo
   * once this returns.
   * @param {number} userId
   * @param {number} homeId
   */
  function deleteHome(userId, homeId) {
    assertHomeMembership(db, homeId, userId);
    const result = deleteHomeCascade(db, homeId);
    if (!result) { throw new ServiceError('Hogar no encontrado'); }
    return { id: result.home.id, name: result.home.name };
  }

  return { createHome, joinHome, listHomesForUser, inviteToHome, deleteHome };
}

export { createHomeService, assertHomeMembership };
