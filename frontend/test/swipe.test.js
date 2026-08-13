import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickSwipeOutcome } from '../js/lib/swipe.js';


test('pickSwipeOutcome: below threshold in either direction resets', () => {
  assert.equal(pickSwipeOutcome(50, 300, 0.35), 'reset');
  assert.equal(pickSwipeOutcome(-50, 300, 0.35), 'reset');
  assert.equal(pickSwipeOutcome(0, 300, 0.35), 'reset');
});

test('pickSwipeOutcome: past the positive threshold commits right', () => {
  assert.equal(pickSwipeOutcome(120, 300, 0.35), 'right'); // 0.4 > 0.35
});

test('pickSwipeOutcome: past the negative threshold commits left', () => {
  assert.equal(pickSwipeOutcome(-120, 300, 0.35), 'left');
});

test('pickSwipeOutcome: exactly at the threshold commits (boundary is inclusive)', () => {
  assert.equal(pickSwipeOutcome(105, 300, 0.35), 'right'); // exactly 0.35
  assert.equal(pickSwipeOutcome(-105, 300, 0.35), 'left');
});

test('pickSwipeOutcome: zero width resets rather than dividing by zero', () => {
  assert.equal(pickSwipeOutcome(999, 0, 0.35), 'reset');
});
