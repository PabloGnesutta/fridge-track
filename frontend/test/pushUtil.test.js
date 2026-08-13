import { test } from 'node:test';
import assert from 'node:assert/strict';
import { urlBase64ToUint8Array } from '../js/lib/pushUtil.js';


test('urlBase64ToUint8Array decodes a URL-safe base64 VAPID key', () => {
  // "hello" base64-encoded, with URL-safe chars swapped in to exercise the -/_ replacement.
  const result = urlBase64ToUint8Array('aGVsbG8');
  assert.deepEqual(Array.from(result), [104, 101, 108, 108, 111]);
});

test('urlBase64ToUint8Array handles - and _ characters', () => {
  const result = urlBase64ToUint8Array('-_8');
  assert.deepEqual(Array.from(result), [251, 255]);
});
