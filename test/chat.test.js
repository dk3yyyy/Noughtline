import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CHAT_LENGTH,
  MAX_CHAT_MESSAGES,
  chatErrorText,
  formatChatTime,
  isOwnMessage,
  pushChatMessage,
  validateChatInput,
} from '../src/services/chat.js';

test('validates chat input into trimmed text or a client-side error code', () => {
  assert.deepEqual(validateChatInput('  hello there  '), { ok: true, text: 'hello there' });
  assert.equal(validateChatInput('  hello there  ').ok, true);
  assert.deepEqual(validateChatInput(''), { ok: false, code: 'CHAT_EMPTY' });
  assert.deepEqual(validateChatInput('   '), { ok: false, code: 'CHAT_EMPTY' });
  assert.deepEqual(validateChatInput('\t\n'), { ok: false, code: 'CHAT_EMPTY' });
  assert.equal(validateChatInput(undefined).ok, false);
  assert.equal(validateChatInput(null).code, 'CHAT_INVALID');
  assert.equal(validateChatInput(42).code, 'CHAT_INVALID');
  assert.equal(validateChatInput({ text: 'hi' }).code, 'CHAT_INVALID');
});

test('accepts messages up to the server limit and rejects longer ones', () => {
  const atLimit = 'x'.repeat(MAX_CHAT_LENGTH);
  assert.deepEqual(validateChatInput(atLimit), { ok: true, text: atLimit });
  const padded = `  ${'y'.repeat(MAX_CHAT_LENGTH - 2)}  `;
  assert.deepEqual(validateChatInput(padded), { ok: true, text: 'y'.repeat(MAX_CHAT_LENGTH - 2) });
  const overLimit = 'z'.repeat(MAX_CHAT_LENGTH + 1);
  assert.deepEqual(validateChatInput(overLimit), { ok: false, code: 'CHAT_TOO_LONG' });
  // Validation happens on the trimmed text, mirroring the server.
  assert.deepEqual(validateChatInput(`  ${overLimit}  `), { ok: false, code: 'CHAT_TOO_LONG' });
});

test('maps chat error codes to short inline copy', () => {
  assert.equal(chatErrorText('CHAT_EMPTY').length > 0, true);
  assert.equal(chatErrorText('CHAT_TOO_LONG').length > 0, true);
  assert.equal(chatErrorText('CHAT_INVALID').length > 0, true);
  assert.equal(chatErrorText('CHAT_RATE_LIMITED').length > 0, true);
  assert.equal(chatErrorText('UNKNOWN_CODE'), '');
});

test('flags messages sent by the current user only', () => {
  assert.equal(isOwnMessage({ userId: 'user-1', text: 'hi' }, 'user-1'), true);
  assert.equal(isOwnMessage({ userId: 'user-1', text: 'hi' }, 'user-2'), false);
  assert.equal(isOwnMessage({ userId: 'user-1', text: 'hi' }, undefined), false);
  assert.equal(isOwnMessage(null, 'user-1'), false);
  assert.equal(isOwnMessage(undefined, 'user-1'), false);
});

test('formats timestamps as short local HH:MM and rejects invalid input', () => {
  const at = new Date(2026, 8, 8, 9, 5, 42); // local time on purpose
  const hh = String(at.getHours()).padStart(2, '0');
  const mm = String(at.getMinutes()).padStart(2, '0');
  assert.equal(formatChatTime(at.getTime()), `${hh}:${mm}`);
  assert.equal(formatChatTime(at.toISOString()), `${hh}:${mm}`);
  assert.equal(formatChatTime(new Date(2026, 8, 8, 23, 59)), '23:59');
  assert.equal(formatChatTime('not-a-date'), '');
  assert.equal(formatChatTime(undefined), '');
  assert.equal(formatChatTime(null), '');
});

test('appends new messages, dedupes by id, and caps the list length', () => {
  const seen = new Set();
  const first = { id: 'm1', text: 'one' };
  const result = pushChatMessage([], first, seen);
  assert.equal(result.added, true);
  assert.deepEqual(result.messages, [first]);
  assert.equal(seen.has('m1'), true);

  // Duplicate id (e.g. a replayed broadcast) is dropped, not re-appended.
  const again = pushChatMessage(result.messages, { ...first, text: 'stale copy' }, seen);
  assert.equal(again.added, false);
  assert.deepEqual(again.messages, [first]);

  // Different id appends.
  const second = { id: 'm2', text: 'two' };
  const two = pushChatMessage(again.messages, second, seen);
  assert.deepEqual(two.messages, [first, second]);

  // Default cap trims the oldest message off the front.
  const full = [];
  const fullSeen = new Set();
  for (let i = 0; i < MAX_CHAT_MESSAGES; i += 1) {
    full.push({ id: `old-${i}`, text: String(i) });
    fullSeen.add(`old-${i}`);
  }
  const capped = pushChatMessage(full, { id: 'newest', text: 'new' }, fullSeen);
  assert.equal(capped.messages.length, MAX_CHAT_MESSAGES);
  assert.equal(capped.messages[0].id, 'old-1');
  assert.equal(capped.messages[capped.messages.length - 1].id, 'newest');

  // A custom cap is honored.
  const tiny = pushChatMessage([{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }], { id: 'c', text: 'c' }, new Set(['a', 'b']), 2);
  assert.deepEqual(tiny.messages.map(m => m.id), ['b', 'c']);
});

test('pushChatMessage guards malformed inputs', () => {
  const seen = new Set();
  const out = pushChatMessage(null, { id: 'x', text: 'hi' }, seen);
  assert.deepEqual(out, { messages: null, seenIds: seen, added: false });
  const bad = pushChatMessage([], null, seen);
  assert.equal(bad.added, false);
  assert.deepEqual(bad.messages, []);
  // Messages without an id are appended but never recorded for dedupe.
  const noId = pushChatMessage([], { text: 'anonymous' }, seen);
  assert.equal(noId.added, true);
  assert.equal(seen.size, 0);
});
