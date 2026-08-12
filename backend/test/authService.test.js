import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from '../src/db/schema.js';
import { createAuthService } from '../src/services/authService.js';
import { ServiceError } from '../src/services/ServiceError.js';


function makeAuthService() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA_SQL);
  return createAuthService(db);
}

test('createUser rejects a duplicate email', () => {
  const authService = makeAuthService();
  authService.createUser('a@test.local', 'password123');
  assert.throws(
    () => authService.createUser('a@test.local', 'other-password'),
    ServiceError
  );
});

test('verifyLogin rejects a wrong password', () => {
  const authService = makeAuthService();
  authService.createUser('a@test.local', 'password123');
  assert.throws(
    () => authService.verifyLogin('a@test.local', 'wrong-password'),
    ServiceError
  );
});

test('verifyLogin accepts the right password', () => {
  const authService = makeAuthService();
  const user = authService.createUser('a@test.local', 'password123');
  const loggedIn = authService.verifyLogin('a@test.local', 'password123');
  assert.equal(loggedIn.id, user.id);
});

test('createSession then getUserBySessionToken resolves the same user', () => {
  const authService = makeAuthService();
  const user = authService.createUser('a@test.local', 'password123');
  const token = authService.createSession(user.id);
  const resolved = authService.getUserBySessionToken(token);
  assert.equal(resolved.id, user.id);
  assert.equal(resolved.email, user.email);
});

test('deleteSession makes the token stop resolving', () => {
  const authService = makeAuthService();
  const user = authService.createUser('a@test.local', 'password123');
  const token = authService.createSession(user.id);
  authService.deleteSession(token);
  assert.equal(authService.getUserBySessionToken(token), null);
});

test('getUserBySessionToken returns null for an unknown token', () => {
  const authService = makeAuthService();
  assert.equal(authService.getUserBySessionToken('not-a-real-token'), null);
});
