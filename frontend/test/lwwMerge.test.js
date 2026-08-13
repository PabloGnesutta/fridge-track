import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickWinner, remoteWins } from '../js/sync/lwwMerge.js';


test('pickWinner: remote wins when newer', () => {
  const local = { updatedAt: new Date(2026, 0, 1) };
  const remote = { updatedAt: new Date(2026, 0, 2) };
  assert.equal(pickWinner(local, remote), remote);
});

test('pickWinner: local wins when newer', () => {
  const local = { updatedAt: new Date(2026, 0, 2) };
  const remote = { updatedAt: new Date(2026, 0, 1) };
  assert.equal(pickWinner(local, remote), local);
});

test('pickWinner: equal updatedAt does not flip - local wins the tie', () => {
  const date = new Date(2026, 0, 1);
  const local = { updatedAt: date };
  const remote = { updatedAt: new Date(date) };
  assert.equal(pickWinner(local, remote), local);
});

test('pickWinner: remote wins when local does not exist', () => {
  const remote = { updatedAt: new Date(2026, 0, 1) };
  assert.equal(pickWinner(null, remote), remote);
});

test('pickWinner: local wins when remote does not exist', () => {
  const local = { updatedAt: new Date(2026, 0, 1) };
  assert.equal(pickWinner(local, null), local);
});

test('pickWinner: missing local updatedAt treated as oldest - remote wins', () => {
  const local = { updatedAt: undefined };
  const remote = { updatedAt: new Date(2026, 0, 1) };
  assert.equal(pickWinner(local, remote), remote);
});

test('pickWinner: missing remote updatedAt treated as oldest - local wins', () => {
  const local = { updatedAt: new Date(2026, 0, 1) };
  const remote = { updatedAt: undefined };
  assert.equal(pickWinner(local, remote), local);
});

test('pickWinner: handles epoch-ms numbers (server-shaped records), not just Dates', () => {
  const local = { updatedAt: 1000 };
  const remote = { updatedAt: 2000 };
  assert.equal(pickWinner(local, remote), remote);
});

test('remoteWins mirrors pickWinner', () => {
  const local = { updatedAt: new Date(2026, 0, 1) };
  const remote = { updatedAt: new Date(2026, 0, 2) };
  assert.equal(remoteWins(local, remote), true);
  assert.equal(remoteWins(remote, local), false);
});
