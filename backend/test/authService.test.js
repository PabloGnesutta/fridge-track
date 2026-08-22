import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrate.js';
import { migrations } from '../src/db/migrations/index.js';
import { addAllowedEmail } from '../src/db/allowedEmails.js';
import { createAuthService } from '../src/services/authService.js';
import { ServiceError } from '../src/services/ServiceError.js';


/**
 * Stub emailService - sendEmail() must still resolve `true` (never reject),
 * matching the real one's "never throws" contract, but doesn't need actual
 * SMTP config in tests. Captures the last sent code so tests can drive the
 * verify-email flow without reading it back out of the db directly.
 */
function makeStubEmailService() {
  /** @type {{to: string, subject: string, text: string}|null} */
  let lastSent = null;
  return {
    emailService: {
      async sendEmail(opts) { lastSent = opts; return true; },
    },
    getLastSent: () => lastSent,
  };
}

function makeAuthService() {
  const db = new DatabaseSync(':memory:');
  runMigrations(db, migrations);
  const { emailService, getLastSent } = makeStubEmailService();
  return { authService: createAuthService(db, emailService), db, getLastSent };
}

/**
 * Pulls the still-unverified code straight out of the db - the value
 * createUser()/resendVerificationCode() never return directly (they only
 * ever leave the app via the actual sent email), same as a real user reading
 * it out of their inbox.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} email
 */
function readVerificationCode(db, email) {
  const row = db.prepare('SELECT verification_code FROM users WHERE email = ?').get(email);
  return row.verification_code;
}

test('createUser rejects an email that has not been allow-listed', () => {
  const { authService } = makeAuthService();
  assert.throws(
    () => authService.createUser('a@test.local', 'password123'),
    ServiceError
  );
});

test('createUser succeeds once the email has been allow-listed', () => {
  const { authService, db } = makeAuthService();
  addAllowedEmail(db, 'a@test.local');
  const user = authService.createUser('a@test.local', 'password123');
  assert.equal(user.email, 'a@test.local');
});

test('createUser allow-list check is case-insensitive', () => {
  const { authService, db } = makeAuthService();
  addAllowedEmail(db, 'A@Test.Local');
  const user = authService.createUser('a@test.local', 'password123');
  assert.equal(user.email, 'a@test.local');
});

test('createUser rejects a duplicate email', () => {
  const { authService, db } = makeAuthService();
  addAllowedEmail(db, 'a@test.local');
  authService.createUser('a@test.local', 'password123');
  assert.throws(
    () => authService.createUser('a@test.local', 'other-password'),
    ServiceError
  );
});

test('verifyLogin rejects a wrong password', () => {
  const { authService, db } = makeAuthService();
  addAllowedEmail(db, 'a@test.local');
  authService.createUser('a@test.local', 'password123');
  assert.throws(
    () => authService.verifyLogin('a@test.local', 'wrong-password'),
    ServiceError
  );
});

test('verifyLogin rejects an unverified email even with the right password', () => {
  const { authService, db } = makeAuthService();
  addAllowedEmail(db, 'a@test.local');
  authService.createUser('a@test.local', 'password123');
  assert.throws(
    () => authService.verifyLogin('a@test.local', 'password123'),
    (err) => err instanceof ServiceError && /** @type {*} */(err).requiresVerification === true
  );
});

test('verifyLogin accepts the right password once the email is verified', () => {
  const { authService, db } = makeAuthService();
  addAllowedEmail(db, 'a@test.local');
  const user = authService.createUser('a@test.local', 'password123');
  authService.verifyEmailCode('a@test.local', readVerificationCode(db, 'a@test.local'));
  const loggedIn = authService.verifyLogin('a@test.local', 'password123');
  assert.equal(loggedIn.id, user.id);
});

test('createUser sends a verification code and leaves the account unverified', () => {
  const { authService, db, getLastSent } = makeAuthService();
  addAllowedEmail(db, 'a@test.local');
  const user = authService.createUser('a@test.local', 'password123');
  assert.equal(user.emailVerified, false);
  const sent = getLastSent();
  assert.equal(sent.to, 'a@test.local');
  assert.match(sent.text, /\d{6}/);
});

test('the verification email includes a one-click link carrying the same code', () => {
  const { authService, db, getLastSent } = makeAuthService();
  addAllowedEmail(db, 'a@test.local');
  authService.createUser('a@test.local', 'password123');
  const code = readVerificationCode(db, 'a@test.local');
  const sent = getLastSent();

  const [, linkUrl] = sent.text.match(/(https?:\/\/\S+)/) || [];
  assert.ok(linkUrl, 'email body should contain a link');
  const url = new URL(linkUrl);
  assert.equal(url.searchParams.get('email'), 'a@test.local');
  assert.equal(url.searchParams.get('code'), code);
});

test('verifyEmailCode rejects a wrong code', () => {
  const { authService, db } = makeAuthService();
  addAllowedEmail(db, 'a@test.local');
  authService.createUser('a@test.local', 'password123');
  assert.throws(
    () => authService.verifyEmailCode('a@test.local', '000000'),
    ServiceError
  );
});

test('verifyEmailCode accepts the right code and lets verifyLogin through afterwards', () => {
  const { authService, db } = makeAuthService();
  addAllowedEmail(db, 'a@test.local');
  authService.createUser('a@test.local', 'password123');
  const code = readVerificationCode(db, 'a@test.local');
  authService.verifyEmailCode('a@test.local', code);
  const loggedIn = authService.verifyLogin('a@test.local', 'password123');
  assert.equal(loggedIn.email, 'a@test.local');
});

test('resendVerificationCode issues a new code that verifyEmailCode accepts', () => {
  const { authService, db } = makeAuthService();
  addAllowedEmail(db, 'a@test.local');
  authService.createUser('a@test.local', 'password123');
  const firstCode = readVerificationCode(db, 'a@test.local');

  // Force the resend past its own cooldown by backdating when the first
  // code was sent, rather than sleeping in the test.
  db.prepare('UPDATE users SET verification_code_sent_at = 0 WHERE email = ?').run('a@test.local');
  authService.resendVerificationCode('a@test.local');
  const secondCode = readVerificationCode(db, 'a@test.local');

  assert.notEqual(secondCode, firstCode);
  authService.verifyEmailCode('a@test.local', secondCode);
  assert.equal(authService.verifyLogin('a@test.local', 'password123').email, 'a@test.local');
});

test('createSession then getUserBySessionToken resolves the same user', () => {
  const { authService, db } = makeAuthService();
  addAllowedEmail(db, 'a@test.local');
  const user = authService.createUser('a@test.local', 'password123');
  const token = authService.createSession(user.id);
  const resolved = authService.getUserBySessionToken(token);
  assert.equal(resolved.id, user.id);
  assert.equal(resolved.email, user.email);
});

test('deleteSession makes the token stop resolving', () => {
  const { authService, db } = makeAuthService();
  addAllowedEmail(db, 'a@test.local');
  const user = authService.createUser('a@test.local', 'password123');
  const token = authService.createSession(user.id);
  authService.deleteSession(token);
  assert.equal(authService.getUserBySessionToken(token), null);
});

test('getUserBySessionToken returns null for an unknown token', () => {
  const { authService } = makeAuthService();
  assert.equal(authService.getUserBySessionToken('not-a-real-token'), null);
});

test('new users default to both notification channels enabled', () => {
  const { authService, db } = makeAuthService();
  addAllowedEmail(db, 'a@test.local');
  const user = authService.createUser('a@test.local', 'password123');
  assert.equal(user.pushEnabled, true);
  assert.equal(user.emailEnabled, true);

  const token = authService.createSession(user.id);
  const resolved = authService.getUserBySessionToken(token);
  assert.equal(resolved.pushEnabled, true);
  assert.equal(resolved.emailEnabled, true);
});

test('updateNotificationPreferences flips only the field given, leaving the other alone', () => {
  const { authService, db } = makeAuthService();
  addAllowedEmail(db, 'a@test.local');
  const user = authService.createUser('a@test.local', 'password123');

  const afterPushOff = authService.updateNotificationPreferences(user.id, { pushEnabled: false });
  assert.equal(afterPushOff.pushEnabled, false);
  assert.equal(afterPushOff.emailEnabled, true);

  const afterEmailOff = authService.updateNotificationPreferences(user.id, { emailEnabled: false });
  assert.equal(afterEmailOff.pushEnabled, false);
  assert.equal(afterEmailOff.emailEnabled, false);

  const token = authService.createSession(user.id);
  const resolved = authService.getUserBySessionToken(token);
  assert.equal(resolved.pushEnabled, false);
  assert.equal(resolved.emailEnabled, false);
});
