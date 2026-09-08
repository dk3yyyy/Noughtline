import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ERROR_FALLBACK,
  SERVER_ERROR_COPY,
  httpErrorMessage,
} from '../src/services/errors.js';

// Canonical server codes the client must translate (server/app.js,
// server/quests.js, server/achievements.js, server/tournaments.js). The
// pinning test below fails when a new server code is added without client copy.
const SERVER_CODES = [
  'GOOGLE_VERIFY_FAILED', 'GOOGLE_NOT_CONFIGURED', 'GOOGLE_LINK_CONFLICT',
  'INVALID_NONCE', 'EMAIL_ALREADY_LINKED',
  'ACTIVE_ROOM_EXISTS', 'ROOM_NOT_FOUND', 'ROOM_FULL', 'ROOM_EXISTS',
  'INVALID_ROOM_ID', 'NOT_ROOM_MEMBER', 'GAME_NOT_ACTIVE', 'INVALID_MOVE',
  'NOT_YOUR_TURN', 'CELL_OCCUPIED', 'AUTH_REQUIRED', 'RATE_LIMITED',
  'ALREADY_MATCHMAKING', 'MATCHMAKING_CONFLICT', 'ACTION_FAILED',
  'CHAT_EMPTY', 'CHAT_TOO_LONG', 'CHAT_INVALID', 'CHAT_RATE_LIMITED',
  'DAILY_REWARD_CLAIMED', 'UNKNOWN_QUEST', 'QUEST_INCOMPLETE',
  'QUEST_ALREADY_CLAIMED', 'UNKNOWN_ACHIEVEMENT', 'ACHIEVEMENT_INCOMPLETE',
  'ACHIEVEMENT_ALREADY_CLAIMED',
  'TOURNAMENT_EXISTS', 'TOURNAMENT_NOT_FOUND', 'TOURNAMENT_NOT_OPEN',
  'ALREADY_JOINED', 'NOT_MATCH_PARTICIPANT', 'MATCH_NOT_READY',
  'MATCH_NOT_FOUND', 'TOURNAMENT_NOT_CANCELLABLE', 'NOT_CREATOR',
];

test('SERVER_ERROR_COPY covers every server error code and is frozen', () => {
  assert.equal(Object.isFrozen(SERVER_ERROR_COPY), true);
  for (const code of SERVER_CODES) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(SERVER_ERROR_COPY, code),
      `missing friendly copy for server code ${code}`,
    );
    assert.ok(SERVER_ERROR_COPY[code].trim().length > 0, `empty copy for ${code}`);
  }
});

test('mapped code in an axios-style failure returns the friendly copy', () => {
  const error = {
    response: { data: { code: 'RATE_LIMITED', error: 'Too many room actions. Try again shortly.' } },
  };
  assert.equal(httpErrorMessage(error, 'fallback'), 'Too many actions — wait a moment and try again.');
});

test('mapped code in a plain { error, code } socket payload returns the friendly copy', () => {
  assert.equal(
    httpErrorMessage({ error: 'A tournament is already open or in progress', code: 'TOURNAMENT_EXISTS' }, 'fallback'),
    'Another tournament is already running — wait for it to finish or cancel it if you created it.',
  );
});

test('a mapped code wins over a raw/technical message in the same body', () => {
  const error = {
    response: {
      data: { code: 'EMAIL_ALREADY_LINKED', error: 'SQLITE_CONSTRAINT_UNIQUE: UNIQUE constraint failed: users.email' },
    },
  };
  assert.equal(httpErrorMessage(error, 'fallback'), 'That email is already linked to another account.');
});

test('unmapped code with a human server error string returns that string', () => {
  const error = {
    response: {
      data: { code: 'BRAND_NEW_CODE', error: 'The widget is temporarily overloaded — try again shortly.' },
    },
  };
  assert.equal(httpErrorMessage(error, 'fallback'), 'The widget is temporarily overloaded — try again shortly.');
});

test('plain message-only object falls through to the human message', () => {
  assert.equal(httpErrorMessage({ message: 'That room code is not valid.' }, 'fallback'), 'That room code is not valid.');
});

test('an Error instance with a human message passes through', () => {
  assert.equal(httpErrorMessage(new Error('Google sign-in is unavailable in this browser.'), 'fallback'), 'Google sign-in is unavailable in this browser.');
});

test('missing everything returns the provided fallback', () => {
  assert.equal(httpErrorMessage(null, 'Custom fallback'), 'Custom fallback');
  assert.equal(httpErrorMessage(undefined, 'Custom fallback'), 'Custom fallback');
  assert.equal(httpErrorMessage('just a string', 'Custom fallback'), 'Custom fallback');
});

test('no code plus an empty message returns the provided fallback', () => {
  assert.equal(httpErrorMessage({ error: '', message: '' }, 'Custom fallback'), 'Custom fallback');
  assert.equal(httpErrorMessage({ error: '' }, 'Custom fallback'), 'Custom fallback');
});

test('raw SQLITE exception text is never shown verbatim', () => {
  const error = { response: { data: { error: 'SQLITE_CONSTRAINT_UNIQUE: UNIQUE constraint failed: users.email' } } };
  assert.equal(httpErrorMessage(error, 'Custom fallback'), 'Custom fallback');
});

test('"Error: …" prefixed messages are never shown verbatim', () => {
  assert.equal(httpErrorMessage({ message: 'Error: boom' }, 'Custom fallback'), 'Custom fallback');
  assert.equal(httpErrorMessage({ response: { data: { error: 'Error: boom' } } }, 'Custom fallback'), 'Custom fallback');
});

test('transport noise (Network Error / timeouts) falls back instead of surfacing', () => {
  assert.equal(httpErrorMessage({ message: 'Network Error' }, 'Custom fallback'), 'Custom fallback');
  assert.equal(httpErrorMessage({ message: 'timeout of 5000ms exceeded' }, 'Custom fallback'), 'Custom fallback');
  assert.equal(httpErrorMessage({ response: {}, message: 'Request failed with status code 401' }, 'Custom fallback'), 'Custom fallback');
});

test('default fallback is used when no argument is passed', () => {
  assert.equal(httpErrorMessage({}), DEFAULT_ERROR_FALLBACK);
  assert.equal(httpErrorMessage({ response: { data: {} } }), DEFAULT_ERROR_FALLBACK);
  assert.equal(httpErrorMessage(), DEFAULT_ERROR_FALLBACK);
});

test('empty-ish server body (no error/message) returns the provided fallback', () => {
  assert.equal(httpErrorMessage({ response: { data: {} } }, 'Custom fallback'), 'Custom fallback');
});
