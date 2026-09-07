// Pure Elo rating math for ranked multiplayer series. No database access:
// callers read ratings, compute, and persist the returned values themselves.

const ELO_DEFAULTS = Object.freeze({
  start: 1000,
  floor: 100,
  kFactor: 32,
  divisor: 400,
});

const OUTCOMES = Object.freeze(['A_WINS', 'B_WINS', 'DRAW']);

function expectedScore(ratingA, ratingB) {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / ELO_DEFAULTS.divisor));
}

// outcome describes the result from player A's perspective:
// 'A_WINS' | 'B_WINS' | 'DRAW'. Deltas are equal and opposite away from the
// floor; both new ratings are clamped at ELO_DEFAULTS.floor.
function computeNewRatings(ratingA, ratingB, outcome) {
  if (!OUTCOMES.includes(outcome)) {
    throw new TypeError(`Unknown outcome '${outcome}' (expected one of ${OUTCOMES.join(', ')})`);
  }
  const scoreA = outcome === 'A_WINS' ? 1 : outcome === 'B_WINS' ? 0 : 0.5;
  const scoreB = 1 - scoreA;
  const deltaA = ELO_DEFAULTS.kFactor * (scoreA - expectedScore(ratingA, ratingB));
  const deltaB = ELO_DEFAULTS.kFactor * (scoreB - expectedScore(ratingB, ratingA));
  const newA = Math.max(ELO_DEFAULTS.floor, ratingA + deltaA);
  const newB = Math.max(ELO_DEFAULTS.floor, ratingB + deltaB);
  return { newA, newB, deltaA: newA - ratingA, deltaB: newB - ratingB };
}

module.exports = { ELO_DEFAULTS, expectedScore, computeNewRatings };
