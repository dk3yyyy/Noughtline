// Pure display helpers for the PROFILE Achievements card. Kept free of
// React/DOM so they can be unit-tested with node:test (see
// test/achievements.client.test.js).
//
// The achievement catalog (titles, descriptions, rewards) is served by
// GET /api/achievements — this module intentionally holds NO catalog copy,
// only the icon-key mapping and tile state rules the UI needs.

const ACHIEVEMENT_ICON_KEYS = Object.freeze({
  first_win: 'trophy',
  wins_10: 'award',
  streak_5: 'flame',
  level_5: 'target',
  level_10: 'crown',
  first_purchase: 'bag',
});

// The server catalog may grow new ids; unknown ones always render the
// fallback icon rather than a missing one.
const FALLBACK_ICON_KEY = 'trophy';

export function achievementIconKey(id) {
  return ACHIEVEMENT_ICON_KEYS[id] || FALLBACK_ICON_KEY;
}

// One of 'claimed' | 'eligible' | 'locked', used to drive the tile's
// styling. Claimed wins over eligible (a claimed achievement is never
// claimable again). Old payloads may omit the booleans — treat them as
// false so nothing renders as claimable by accident.
export function tileStateClass(achievement) {
  if (!achievement) return 'locked';
  if (achievement.claimed) return 'claimed';
  if (achievement.eligible) return 'eligible';
  return 'locked';
}

// 'Claim' for eligible/unclaimed achievements, '' otherwise (no button).
export function claimButtonLabel(achievement) {
  if (!achievement || achievement.claimed || !achievement.eligible) return '';
  return 'Claim';
}
