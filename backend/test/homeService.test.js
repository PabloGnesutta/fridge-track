import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrate.js';
import { migrations } from '../src/db/migrations/index.js';
import { addAllowedEmail, isEmailAllowed } from '../src/db/allowedEmails.js';
import { createAuthService } from '../src/services/authService.js';
import { createHomeService } from '../src/services/homeService.js';
import { ServiceError } from '../src/services/ServiceError.js';


/**
 * Stub emailService - same shape/purpose as authService.test.js's own
 * makeStubEmailService(): sendEmail() resolves `true` without touching real
 * SMTP config, and captures the last sent message so invite tests can
 * assert on its contents.
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

function makeServices() {
  const db = new DatabaseSync(':memory:');
  runMigrations(db, migrations);
  const { emailService, getLastSent } = makeStubEmailService();
  return {
    authService: createAuthService(db, emailService),
    homeService: createHomeService(db, emailService),
    db, getLastSent,
  };
}

test('createHome returns a 6-char join code and adds the creator as a member', () => {
  const { authService, homeService, db } = makeServices();
  addAllowedEmail(db, 'a@test.local');
  const user = authService.createUser('a@test.local', 'password123');
  const home = homeService.createHome(user.id, 'Casa de Prueba');

  assert.equal(home.name, 'Casa de Prueba');
  assert.equal(home.joinCode.length, 6);
  assert.match(home.joinCode, /^[A-Z2-9]+$/);

  const homes = homeService.listHomesForUser(user.id);
  assert.equal(homes.length, 1);
  assert.equal(homes[0].id, home.id);
});

test('joinHome with a valid code adds membership', () => {
  const { authService, homeService, db } = makeServices();
  addAllowedEmail(db, 'owner@test.local');
  addAllowedEmail(db, 'joiner@test.local');
  const owner = authService.createUser('owner@test.local', 'password123');
  const joiner = authService.createUser('joiner@test.local', 'password123');
  const home = homeService.createHome(owner.id, 'Casa Compartida');

  homeService.joinHome(joiner.id, home.joinCode);

  const joinerHomes = homeService.listHomesForUser(joiner.id);
  assert.equal(joinerHomes.length, 1);
  assert.equal(joinerHomes[0].id, home.id);
});

test('joinHome is idempotent - joining twice does not duplicate membership', () => {
  const { authService, homeService, db } = makeServices();
  addAllowedEmail(db, 'owner@test.local');
  addAllowedEmail(db, 'joiner@test.local');
  const owner = authService.createUser('owner@test.local', 'password123');
  const joiner = authService.createUser('joiner@test.local', 'password123');
  const home = homeService.createHome(owner.id, 'Casa Compartida');

  homeService.joinHome(joiner.id, home.joinCode);
  homeService.joinHome(joiner.id, home.joinCode);

  assert.equal(homeService.listHomesForUser(joiner.id).length, 1);
});

test('joinHome with a bogus code throws', () => {
  const { authService, homeService, db } = makeServices();
  addAllowedEmail(db, 'a@test.local');
  const user = authService.createUser('a@test.local', 'password123');
  assert.throws(() => homeService.joinHome(user.id, 'ZZZZZZ'), ServiceError);
});

test('createHome seeds the 3 built-in categories with display labels', () => {
  const { authService, homeService, db } = makeServices();
  addAllowedEmail(db, 'a@test.local');
  const user = authService.createUser('a@test.local', 'password123');
  const home = homeService.createHome(user.id, 'Casa de Prueba');

  /** @type {{name: string}[]} */ // @ts-ignore
  const categories = db.prepare('SELECT name FROM categories WHERE home_id = ? ORDER BY name').all(home.id);
  assert.deepEqual(categories.map(c => c.name), ['Alimentos', 'Medicamentos', 'Otros']);
});

test('each Home gets its own set of built-in categories', () => {
  const { authService, homeService, db } = makeServices();
  addAllowedEmail(db, 'a@test.local');
  const user = authService.createUser('a@test.local', 'password123');
  const homeA = homeService.createHome(user.id, 'Casa A');
  const homeB = homeService.createHome(user.id, 'Casa B');

  /** @type {{id: string}[]} */ // @ts-ignore
  const categoriesA = db.prepare('SELECT id FROM categories WHERE home_id = ?').all(homeA.id);
  /** @type {{id: string}[]} */ // @ts-ignore
  const categoriesB = db.prepare('SELECT id FROM categories WHERE home_id = ?').all(homeB.id);
  assert.equal(categoriesA.length, 3);
  assert.equal(categoriesB.length, 3);
  const idsA = new Set(categoriesA.map(c => c.id));
  assert.ok(categoriesB.every(c => !idsA.has(c.id)));
});

test('joinHome is case-insensitive', () => {
  const { authService, homeService, db } = makeServices();
  addAllowedEmail(db, 'owner@test.local');
  addAllowedEmail(db, 'joiner@test.local');
  const owner = authService.createUser('owner@test.local', 'password123');
  const joiner = authService.createUser('joiner@test.local', 'password123');
  const home = homeService.createHome(owner.id, 'Casa Compartida');

  const joined = homeService.joinHome(joiner.id, home.joinCode.toLowerCase());
  assert.equal(joined.id, home.id);
});

test('inviteToHome sends an email with the join code and a link, and allow-lists the invitee', async () => {
  const { authService, homeService, db, getLastSent } = makeServices();
  addAllowedEmail(db, 'owner@test.local');
  const owner = authService.createUser('owner@test.local', 'password123');
  const home = homeService.createHome(owner.id, 'Casa Compartida');

  await homeService.inviteToHome(owner.id, home.id, 'Invitee@Test.Local');

  const sent = getLastSent();
  assert.equal(sent.to, 'invitee@test.local');
  assert.match(sent.text, new RegExp(home.joinCode));
  const [, linkUrl] = sent.text.match(/(https?:\/\/\S+)/) || [];
  assert.ok(linkUrl, 'email body should contain a link');
  assert.equal(new URL(linkUrl).searchParams.get('joinCode'), home.joinCode);

  // The invite is a dead end for a brand-new email otherwise - signup is
  // gated behind this same list.
  assert.ok(isEmailAllowed(db, 'invitee@test.local'));
});

test('inviteToHome rejects a non-member', async () => {
  const { authService, homeService, db } = makeServices();
  addAllowedEmail(db, 'owner@test.local');
  addAllowedEmail(db, 'outsider@test.local');
  const owner = authService.createUser('owner@test.local', 'password123');
  const outsider = authService.createUser('outsider@test.local', 'password123');
  const home = homeService.createHome(owner.id, 'Casa Compartida');

  await assert.rejects(
    () => homeService.inviteToHome(outsider.id, home.id, 'someone@test.local'),
    ServiceError
  );
});

test('inviteToHome rejects a member who did not create the Home', async () => {
  const { authService, homeService, db } = makeServices();
  addAllowedEmail(db, 'owner@test.local');
  addAllowedEmail(db, 'joiner@test.local');
  const owner = authService.createUser('owner@test.local', 'password123');
  const joiner = authService.createUser('joiner@test.local', 'password123');
  const home = homeService.createHome(owner.id, 'Casa Compartida');
  homeService.joinHome(joiner.id, home.joinCode);

  // The joiner is a real member (unlike the outsider test above), just not
  // the creator - invites are the one action gated by that distinction.
  await assert.rejects(
    () => homeService.inviteToHome(joiner.id, home.id, 'someone@test.local'),
    ServiceError
  );
});

test('listHomesForUser reports which member created the Home', () => {
  const { authService, homeService, db } = makeServices();
  addAllowedEmail(db, 'owner@test.local');
  addAllowedEmail(db, 'joiner@test.local');
  const owner = authService.createUser('owner@test.local', 'password123');
  const joiner = authService.createUser('joiner@test.local', 'password123');
  const home = homeService.createHome(owner.id, 'Casa Compartida');
  homeService.joinHome(joiner.id, home.joinCode);

  assert.equal(homeService.listHomesForUser(owner.id)[0].createdBy, owner.id);
  assert.equal(homeService.listHomesForUser(joiner.id)[0].createdBy, owner.id);
});

test('inviteToHome rejects a missing email', async () => {
  const { authService, homeService, db } = makeServices();
  addAllowedEmail(db, 'owner@test.local');
  const owner = authService.createUser('owner@test.local', 'password123');
  const home = homeService.createHome(owner.id, 'Casa Compartida');

  await assert.rejects(() => homeService.inviteToHome(owner.id, home.id, '  '), ServiceError);
});

test('deleteHome removes the Home and every member\'s access to it', () => {
  const { authService, homeService, db } = makeServices();
  addAllowedEmail(db, 'owner@test.local');
  addAllowedEmail(db, 'joiner@test.local');
  const owner = authService.createUser('owner@test.local', 'password123');
  const joiner = authService.createUser('joiner@test.local', 'password123');
  const home = homeService.createHome(owner.id, 'Casa Compartida');
  homeService.joinHome(joiner.id, home.joinCode);

  const result = homeService.deleteHome(owner.id, home.id);

  assert.deepEqual(result, { id: home.id, name: 'Casa Compartida' });
  assert.equal(homeService.listHomesForUser(owner.id).length, 0);
  assert.equal(homeService.listHomesForUser(joiner.id).length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM homes WHERE id = ?').get(home.id).c, 0);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('deleteHome does not require ownership - any member can delete, matching the app\'s flat trust model', () => {
  const { authService, homeService, db } = makeServices();
  addAllowedEmail(db, 'owner@test.local');
  addAllowedEmail(db, 'joiner@test.local');
  const owner = authService.createUser('owner@test.local', 'password123');
  const joiner = authService.createUser('joiner@test.local', 'password123');
  const home = homeService.createHome(owner.id, 'Casa Compartida');
  homeService.joinHome(joiner.id, home.joinCode);

  // The joiner, not the creator, deletes it - this must succeed, the same
  // way any member can already invite or edit/delete items in this Home.
  const result = homeService.deleteHome(joiner.id, home.id);
  assert.equal(result.id, home.id);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM homes WHERE id = ?').get(home.id).c, 0);
});

test('deleteHome rejects a non-member', () => {
  const { authService, homeService, db } = makeServices();
  addAllowedEmail(db, 'owner@test.local');
  addAllowedEmail(db, 'outsider@test.local');
  const owner = authService.createUser('owner@test.local', 'password123');
  const outsider = authService.createUser('outsider@test.local', 'password123');
  const home = homeService.createHome(owner.id, 'Casa Compartida');

  assert.throws(() => homeService.deleteHome(outsider.id, home.id), ServiceError);
  // Rejected - the Home must still exist.
  assert.equal(db.prepare('SELECT COUNT(*) c FROM homes WHERE id = ?').get(home.id).c, 1);
});

test('deleteHome throws for a nonexistent Home id', () => {
  const { authService, homeService, db } = makeServices();
  addAllowedEmail(db, 'owner@test.local');
  const owner = authService.createUser('owner@test.local', 'password123');
  assert.throws(() => homeService.deleteHome(owner.id, 999999), ServiceError);
});

test('deleteHome leaves another Home (and a shared user\'s membership in it) untouched', () => {
  const { authService, homeService, db } = makeServices();
  addAllowedEmail(db, 'a@test.local');
  const user = authService.createUser('a@test.local', 'password123');
  const homeA = homeService.createHome(user.id, 'Casa A');
  const homeB = homeService.createHome(user.id, 'Casa B');

  homeService.deleteHome(user.id, homeA.id);

  const remaining = homeService.listHomesForUser(user.id);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, homeB.id);
});
