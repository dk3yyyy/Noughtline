// Pure copy/state helpers for the shop purchase modal. Kept free of
// React/DOM so they can be unit-tested with node:test (see test/shop.test.js).

const CURRENCY_LABELS = Object.freeze({ coins: 'Coins', gems: 'Gems' });

// 'Gems' | 'Coins' — display label for a shop currency. Anything that is not
// explicitly 'coins' is treated as gems (server catalogue only uses the two).
export function currencyLabel(currency) {
  return CURRENCY_LABELS[currency] || 'Gems';
}

// Cost of an item in its own currency, reading the server's cost_* columns.
export function itemCost(item) {
  if (!item) return 0;
  const currency = item.currency === 'coins' ? 'coins' : 'gems';
  const raw = currency === 'coins' ? item.cost_coins : item.cost_gems;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// 'Insufficient Coins' / 'Insufficient Gems' — the previous hardcoded
// 'Insufficient Gems' was wrong for coins-priced items.
export function insufficientLabel(item) {
  if (!item) return 'Insufficient';
  const currency = item.currency === 'coins' ? 'coins' : 'gems';
  return `Insufficient ${currencyLabel(currency)}`;
}

// 'You have 100 Gems — need 400 more' style guidance shown under the price so
// an unaffordable purchase explains itself instead of dead-ending silently.
export function shortfallText(item, balance) {
  if (!item) return '';
  const currency = item.currency === 'coins' ? 'coins' : 'gems';
  const cost = itemCost(item);
  const owned = Number(balance);
  const current = Number.isFinite(owned) ? owned : 0;
  const missing = Math.max(0, cost - current);
  if (cost <= 0 || missing <= 0) return '';
  return `You have ${current} ${currencyLabel(currency)} — need ${missing} more.`;
}

// Guidance toast for an unaffordable item, pointing at the earn paths that now
// exist (quests, achievements, ranked rewards) or the Buy Gems flow.
export function insufficientGuidance(item) {
  if (!item) return 'Not enough currency for this item.';
  const currency = item.currency === 'coins' ? 'coins' : 'gems';
  if (currency === 'coins') {
    return 'Not enough Coins. Win ranked matches to earn coins — quests and achievements also pay out.';
  }
  return 'Not enough Gems. Earn gems from daily rewards, quests and achievements — or buy Gems from your balance.';
}
