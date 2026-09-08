// Central server-error-code → friendly user copy map for the client.
// The server answers HTTP failures as { error, code } (server/app.js) and
// socket acks/failures as { error, code, ... } payloads (emitFailure /
// gameErrorPayload in server/app.js, httpError in server/tournaments.js).
// Historically every feature translated those ad hoc — some sites even
// surfaced raw error text — so a misleading message slipped through. This
// module is the single source of truth: httpErrorMessage(error, fallback)
// maps a known code to short human copy and otherwise returns a readable
// server/client message, never a raw exception string.
//
// Pure and DOM-free so it is unit-testable with node:test (test/errors.test.js).
// Keep codes in sync with server/*.js; the pinning test enumerates them.

export const SERVER_ERROR_COPY = Object.freeze({
  // Google account linking / sign-in (server/app.js, googleAuth.js)
  GOOGLE_NOT_CONFIGURED: "Google sign-in isn't set up on this server yet.",
  GOOGLE_VERIFY_FAILED: 'Google sign-in could not be verified. Try again.',
  INVALID_NONCE: 'Your sign-in link expired — try signing in again.',
  GOOGLE_LINK_CONFLICT: 'This Google account already belongs to another player with saved progress.',
  EMAIL_ALREADY_LINKED: 'That email is already linked to another account.',

  // Rooms / lifecycle (server/game/*, ERROR_CODE_BY_MESSAGE in server/app.js)
  ACTIVE_ROOM_EXISTS: 'You already have an active room — finish or leave it first.',
  ROOM_NOT_FOUND: 'That room no longer exists. Ask the host for a fresh invite.',
  ROOM_FULL: 'That room already has two players.',
  ROOM_EXISTS: 'That room code is already taken — try another.',
  INVALID_ROOM_ID: 'Enter a valid room code or Noughtline invite link.',
  NOT_ROOM_MEMBER: "You're not part of that room.",
  GAME_NOT_ACTIVE: 'That game is no longer active.',
  INVALID_MOVE: 'That move is not allowed.',
  NOT_YOUR_TURN: "It's not your turn yet.",
  CELL_OCCUPIED: 'That cell is already taken.',
  AUTH_REQUIRED: 'Your session expired — refresh the page to reconnect.',
  RATE_LIMITED: 'Too many actions — wait a moment and try again.',
  ALREADY_MATCHMAKING: 'You are already searching for a match.',
  MATCHMAKING_CONFLICT: 'Matchmaking changed state — try again.',
  ACTION_FAILED: 'That action could not be completed. Try again.',

  // Chat (server/app.js 'chat_message'; mirrors chatErrorText in src/services/chat.js)
  CHAT_EMPTY: 'Your message is empty.',
  CHAT_TOO_LONG: 'Keep messages under 240 characters.',
  CHAT_INVALID: 'That message could not be sent.',
  CHAT_RATE_LIMITED: 'Slow down — try again in a moment.',

  // Quests / daily reward (server/quests.js; mirrors the QuestCard toasts)
  DAILY_REWARD_CLAIMED: 'Daily reward already claimed today.',
  UNKNOWN_QUEST: 'Quest not found. Try again later.',
  QUEST_INCOMPLETE: 'Quest is not complete yet — keep playing!',
  QUEST_ALREADY_CLAIMED: 'Quest reward already claimed.',

  // Achievements (server/achievements.js; mirrors the AchievementsCard toasts)
  UNKNOWN_ACHIEVEMENT: 'Achievement not found. Try again later.',
  ACHIEVEMENT_INCOMPLETE: 'Achievement not unlocked yet — keep playing!',
  ACHIEVEMENT_ALREADY_CLAIMED: 'Achievement reward already claimed.',

  // Tournaments (server/tournaments.js httpError codes)
  TOURNAMENT_EXISTS: 'Another tournament is already running — wait for it to finish or cancel it if you created it.',
  TOURNAMENT_NOT_FOUND: 'That tournament no longer exists.',
  TOURNAMENT_NOT_OPEN: 'That tournament is not open for registration right now.',
  ALREADY_JOINED: 'You already joined this tournament.',
  NOT_MATCH_PARTICIPANT: "You're not a participant in that match.",
  MATCH_NOT_READY: 'The match is not ready to play yet.',
  MATCH_NOT_FOUND: 'That match no longer exists.',
  TOURNAMENT_NOT_CANCELLABLE: 'The tournament is already finished — it can no longer be cancelled.',
  NOT_CREATOR: 'Only the tournament creator can cancel it.',
});

export const DEFAULT_ERROR_FALLBACK = 'Something went wrong. Try again.';

// Exception/transport fragments that must never reach the user verbatim.
// A candidate message that matches is treated as not human and skipped.
const RAW_TEXT = /(sqlite|unique constraint|foreign key constraint|not null constraint|check constraint|axioserror|typeerror|referenceerror|syntaxerror|econnrefused|econnreset|enotfound|etimedout|eai_again|err_canceled|err_network|request failed with status code|timeout of \d+ms|network error|^error\b|^[a-z][a-z0-9_]+:)/i;

const looksHuman = (value) => (
  typeof value === 'string'
  && value.trim() !== ''
  && !RAW_TEXT.test(value.trim())
);

// Which object carries the { error, code } the server sent:
// - axios/HTTP failures: error.response.data
// - socket acks / plain results: the { error, code } object itself
//   (never an Error instance — those carry client-side codes like ERR_CANCELED)
const errorBody = (error) => {
  if (!error || typeof error !== 'object') return null;
  const responseData = error.response && error.response.data;
  if (responseData && typeof responseData === 'object') return responseData;
  if (!(error instanceof Error) && (typeof error.code === 'string' || typeof error.error === 'string')) return error;
  return null;
};

/**
 * Pick the message to show a user for a failed request/action.
 *
 * @param {unknown} error axios-like failure, socket ack payload, or plain
 *   { error, code, message } object.
 * @param {string} [fallback] shown when nothing readable can be derived.
 * @returns {string}
 */
export function httpErrorMessage(error, fallback = DEFAULT_ERROR_FALLBACK) {
  const body = errorBody(error);
  const code = body && typeof body.code === 'string' ? body.code : null;
  if (code && Object.prototype.hasOwnProperty.call(SERVER_ERROR_COPY, code)) {
    return SERVER_ERROR_COPY[code];
  }
  const candidates = [
    body && body.error,
    body && body.message,
    error && typeof error.message === 'string' ? error.message : null,
  ];
  for (const candidate of candidates) {
    if (looksHuman(candidate)) return candidate.trim();
  }
  return fallback;
}
