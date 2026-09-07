// Pure formatting helpers for the PROFILE Quests card (daily reward + daily
// quest list). Kept free of React/DOM so they can be unit-tested with
// node:test (see test/quests.test.js).
//
// The GET /api/quests response carries quest rows and the daily-claim flag
// but not the daily reward amounts, so the client mirrors the server's
// DAILY_REWARD constant (server/quests.js) here purely for display copy.
// If the server grant ever changes, update BOTH and the pinning test below.

export const DAILY_REWARD = Object.freeze({ coins: 50, gems: 10 });

const CURRENCY_LABELS = Object.freeze({ coins: 'Coins', gems: 'Gems' });

// 'Daily reward: 50 Coins + 10 Gems' — used as the accessible label for the
// daily-reward banner (the visible chips carry the icons/amounts).
export function dailyRewardCopy(reward = DAILY_REWARD) {
  const coins = Number(reward?.coins) || 0;
  const gems = Number(reward?.gems) || 0;
  return `Daily reward: ${coins} Coins + ${gems} Gems`;
}

// '+75 Coins' / '+10 Gems'. Unknown currencies render without a suffix
// rather than inventing a label.
export function rewardLabel(input) {
  const { currency, amount } = input || {};
  const value = Number(amount);
  const n = Number.isFinite(value) ? value : 0;
  const prefix = n >= 0 ? '+' : '';
  const suffix = CURRENCY_LABELS[currency];
  return suffix ? `${prefix}${n} ${suffix}` : `${prefix}${n}`;
}

// A quest is complete once its progress reaches the target.
export function questComplete(input) {
  const { progress, target } = input || {};
  const p = Number(progress);
  const t = Number(target);
  if (!Number.isFinite(p) || !Number.isFinite(t)) return false;
  return p >= t;
}

// '2 of 3' — plain text so screen readers announce progress directly.
export function questProgressLabel(input) {
  const { progress, target } = input || {};
  const p = Number(progress);
  const t = Number(target);
  return `${Number.isFinite(p) ? p : 0} of ${Number.isFinite(t) ? t : 0}`;
}

// Server-side, claimable quests are exactly the complete, unclaimed ones;
// the client mirrors that rule to decide button state.
export function canClaimQuest(quest) {
  return Boolean(quest) && !quest.claimed && questComplete(quest);
}
