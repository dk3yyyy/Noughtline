// Pure, DOM-free helpers for the multiplayer room chat (CHAT-2).
// These mirror the server's chat contract (server/app.js 'chat_message'
// handler): text is trimmed, capped at MAX_CHAT_LENGTH characters, and
// broadcasts carry { roomId, id, userId, username, avatar, text, at }.
// Keeping the validation/dedupe/cap logic here (instead of in the component)
// makes the room chat rules unit-testable without a DOM or socket.

export const MAX_CHAT_LENGTH = 240;
export const MAX_CHAT_MESSAGES = 50;

// Short inline copy shown under the chat input. Codes are shared with the
// server acks (CHAT_RATE_LIMITED etc.) and the client-side pre-send checks.
export const chatErrorText = (code) => {
  switch (code) {
    case 'CHAT_EMPTY':
      return 'Your message is empty.';
    case 'CHAT_TOO_LONG':
      return `Keep messages under ${MAX_CHAT_LENGTH} characters.`;
    case 'CHAT_INVALID':
      return 'That message could not be sent.';
    case 'CHAT_RATE_LIMITED':
      return 'Slow down — try again in a moment.';
    default:
      return '';
  }
};

// Client-side pre-send validation, mirroring the server's rules so the user
// gets instant feedback instead of waiting on a round-trip.
export const validateChatInput = (raw) => {
  if (typeof raw !== 'string') return { ok: false, code: 'CHAT_INVALID' };
  const text = raw.trim();
  if (!text) return { ok: false, code: 'CHAT_EMPTY' };
  if (text.length > MAX_CHAT_LENGTH) return { ok: false, code: 'CHAT_TOO_LONG' };
  return { ok: true, text };
};

// True when the message was authored by the given user id. Guards malformed
// input so callers can pass `user.id` unconditionally.
export const isOwnMessage = (message, userId) => (
  Boolean(message)
  && typeof userId === 'string'
  && userId.length > 0
  && typeof message.userId === 'string'
  && message.userId === userId
);

// Short local 24h clock label (HH:MM) for a chat timestamp. Accepts a ms
// epoch, an ISO string, or a Date; returns '' for anything unparseable.
export const formatChatTime = (at) => {
  // new Date(null) coerces to the epoch; only real timestamps are valid.
  if (at === null || at === undefined) return '';
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
};

// Append an incoming broadcast to the message list: dedupes by message id
// (the server can replay a delivery, and the sender also receives their own
// echo), caps the list at `max` entries by dropping the oldest, and never
// mutates the inputs. Returns { messages, seenIds, added }.
export const pushChatMessage = (messages, incoming, seenIds, max = MAX_CHAT_MESSAGES) => {
  if (!Array.isArray(messages) || !incoming || typeof incoming !== 'object') {
    return { messages, seenIds, added: false };
  }
  const id = incoming.id;
  if (id !== null && id !== undefined) {
    if (seenIds.has(id)) return { messages, seenIds, added: false };
    seenIds.add(id);
  }
  return { messages: [...messages, incoming].slice(-max), seenIds, added: true };
};
