// Pure formatting helpers for the PROFILE match-history and wallet-activity
// lists. Kept free of React/DOM so they can be unit-tested with node:test
// (see test/history.test.js).

const OUTCOME = { WON: 'won', LOST: 'lost', DRAW: 'draw' };

const LEDGER_REASON_LABELS = {
  avatar_purchase: 'Avatar purchase',
  multiplayer_series_reward: 'Series reward',
  paystack_purchase: 'Gem purchase',
  daily_reward: 'Daily reward',
  quest_reward: 'Quest reward',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Series outcome from a specific player's perspective. A row always carries
// the raw result ('X' | 'O' | 'Draw') plus both player ids, so we compare the
// player's side against the winning side instead of trusting winner_id alone.
export function outcomeFor(row, userId) {
  if (!row || userId === null || userId === undefined) return OUTCOME.DRAW;
  if (row.result === 'Draw') return OUTCOME.DRAW;
  const user = Number(userId);
  if (Number(row.player_x_id) === user) return row.result === 'X' ? OUTCOME.WON : OUTCOME.LOST;
  if (Number(row.player_o_id) === user) return row.result === 'O' ? OUTCOME.WON : OUTCOME.LOST;
  return OUTCOME.DRAW;
}

// e.g. { score_x: 2, score_o: 1 } -> 'X 2–1 O'
export function scoreText(row) {
  const x = Number(row?.score_x) || 0;
  const o = Number(row?.score_o) || 0;
  return `X ${x}–${o} O`;
}

export function friendlyLedgerReason(reason) {
  return LEDGER_REASON_LABELS[reason] || reason || '';
}

// '+10' for credits, '-150' for debits.
export function signedAmount(entry) {
  const amount = Number(entry?.amount);
  if (!Number.isFinite(amount)) return '0';
  return amount > 0 ? `+${amount}` : `${amount}`;
}

// SQLite CURRENT_TIMESTAMP rows arrive as 'YYYY-MM-DD HH:MM:SS' (UTC, no zone
// marker); paystack/web timestamps may be full ISO-8601. Normalize both to a
// UTC Date and render a readable local-free label.
export function dateText(iso) {
  const date = parseServerDate(iso);
  if (!date) return 'Unknown date';
  const day = date.getUTCDate();
  const month = MONTHS[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month} ${year}, ${hours}:${minutes}`;
}

function parseServerDate(value) {
  if (!value) return null;
  const normalized = String(value).trim().replace(' ', 'T');
  const hasZone = /[zZ]|[+-]\d{2}:\d{2}$/.test(normalized);
  const date = new Date(hasZone ? normalized : `${normalized}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
