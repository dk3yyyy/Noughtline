import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeToast } from '../src/services/toasts.js';

test('mergeToast appends a new toast to an empty stack', () => {
  const toast = { id: 'toast-1', message: 'Hello', tone: 'info' };
  assert.deepEqual(mergeToast([], toast), { toasts: [toast], added: true });
});

test('mergeToast appends a toast with a distinct message', () => {
  const first = { id: 'toast-1', message: 'One', tone: 'info' };
  const second = { id: 'toast-2', message: 'Two', tone: 'info' };
  const result = mergeToast([first], second);
  assert.equal(result.added, true);
  assert.deepEqual(result.toasts, [first, second]);
});

test('mergeToast deduplicates an identical visible toast (same message and tone)', () => {
  const existing = { id: 'toast-1', message: 'Purchase failed', tone: 'error' };
  const duplicate = { id: 'toast-2', message: 'Purchase failed', tone: 'error' };
  const current = [existing];
  const result = mergeToast(current, duplicate);
  assert.equal(result.added, false);
  assert.equal(result.toasts, current);
  assert.deepEqual(result.toasts, [existing]);
});

test('mergeToast keeps same-message toasts with different tones separate', () => {
  const success = { id: 'toast-1', message: 'Avatar added to collection!', tone: 'success' };
  const error = { id: 'toast-2', message: 'Avatar added to collection!', tone: 'error' };
  const result = mergeToast([success], error);
  assert.equal(result.added, true);
  assert.deepEqual(result.toasts, [success, error]);
});

test('mergeToast never mutates the current stack', () => {
  const existing = [{ id: 'toast-1', message: 'One', tone: 'info' }];
  const frozen = structuredClone(existing);
  mergeToast(existing, { id: 'toast-2', message: 'Two', tone: 'error' });
  mergeToast(existing, { id: 'toast-3', message: 'One', tone: 'info' });
  assert.deepEqual(existing, frozen);
});
