import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrate.js';
import { migrations } from '../src/db/migrations/index.js';
import { addAllowedEmail } from '../src/db/allowedEmails.js';
import { createAuthService } from '../src/services/authService.js';
import { ServiceError } from '../src/services/ServiceError.js';


function makeAuthService() {
  const db = new DatabaseSync(':memory:');
  runMigrations(db, migrations);
  return { authService: createAuthService(db), db };
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

test('verifyLogin accepts the right password', () => {
  const { authService, db } = makeAuthService();
  addAllowedEmail(db, 'a@test.local');
  const user = authService.createUser('a@test.local', 'password123');
  const loggedIn = authService.verifyLogin('a@test.local', 'password123');
  assert.equal(loggedIn.id, user.id);
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
