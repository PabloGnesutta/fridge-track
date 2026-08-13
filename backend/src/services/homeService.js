import { randomBytes } from 'node:crypto';
import { ServiceError } from './ServiceError.js';


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
 */
function createHomeService(db) {
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
        return { id: homeId, name, joinCode };
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
    return { id: Number(home.id), name: home.name, joinCode: home.join_code };
  }

  /**
   * @param {number} userId
   */
  function listHomesForUser(userId) {
    const rows = db.prepare(
      `SELECT homes.id, homes.name, homes.join_code as joinCode FROM homes
       JOIN home_members ON home_members.home_id = homes.id
       WHERE home_members.user_id = ?`
    ).all(userId);
    return rows.map(row => ({ id: Number(row.id), name: row.name, joinCode: row.joinCode }));
  }

  return { createHome, joinHome, listHomesForUser };
}

export { createHomeService, assertHomeMembership };
