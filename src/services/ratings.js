// Pure formatting + classification helpers for the ranked Elo client UI
// (profile rating, match-complete delta chip, leaderboard rating column).
// Kept free of React/DOM so they can be unit-tested with node:test
// (see test/ratings.test.js).
//
// Server ratings are integers (users.rating, floored at 100); these helpers
// round defensively and never throw on missing/malformed input so old API
// payloads without a rating simply render nothing.

// '1,024' — integer rating with thousands separators. Returns null for
// missing/malformed input so callers can hide the rating entirely.
export function formatRating(input) {
  if (input === null || input === undefined || input === '') return null;
  const n = Number(input);
  if (!Number.isFinite(n)) return null;
  return Math.round(n).toLocaleString('en-US');
}

// Signed integer difference between two ratings (current - previous),
// rounded to whole numbers so it always matches the visible integer
// ratings. Missing ratings count as no change (0) instead of throwing.
export function ratingDelta(previous, current) {
  const prev = toRating(previous);
  const next = toRating(current);
  if (prev === null || next === null) return 0;
  return next - prev;
}

// '+12' | '-8' | '' — signed chip label; zero change renders '' so no
// rating chip is shown for matches that did not move the rating.
export function deltaLabel(previous, current) {
  const delta = ratingDelta(previous, current);
  if (delta === 0) return '';
  return delta > 0 ? `+${delta}` : `${delta}`;
}

// A room only ever adjusts ratings when it was created reward-eligible
// (matchmaking). Anything lacking an explicit `rewardEligible === true` —
// private rooms, AI games, old payloads — is NOT ranked.
export function isRankedRoom(room) {
  return Boolean(room) && room.rewardEligible === true;
}

function toRating(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}
