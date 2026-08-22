import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../src/db/migrate.js';
import { migrations } from '../src/db/migrations/index.js';
import { addAllowedEmail } from '../src/db/allowedEmails.js';
import { createAuthService } from '../src/services/authService.js';
import { createHomeService } from '../src/services/homeService.js';
import { ServiceError } from '../src/services/ServiceError.js';


function makeServices() {
  const db = new DatabaseSync(':memory:');
  runMigrations(db, migrations);
  return { authService: createAuthService(db), homeService: createHomeService(db), db };
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
