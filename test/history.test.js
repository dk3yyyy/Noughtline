import test from 'node:test';
import assert from 'node:assert/strict';
import {
  outcomeFor,
  scoreText,
  friendlyLedgerReason,
  signedAmount,
  dateText,
} from '../src/services/history.js';

test('outcomeFor reports the series result from the requesting player perspective', () => {
  const xWon = { result: 'X', player_x_id: 1, player_o_id: 2, winner_id: 1 };
  assert.equal(outcomeFor(xWon, 1), 'won');
  assert.equal(outcomeFor(xWon, 2), 'lost');

  const oWon = { result: 'O', player_x_id: 1, player_o_id: 2, winner_id: 2 };
  assert.equal(outcomeFor(oWon, 2), 'won');
  assert.equal(outcomeFor(oWon, 1), 'lost');
});

test('outcomeFor treats a Draw series as a draw for both sides', () => {
  const drawn = { result: 'Draw', player_x_id: 1, player_o_id: 2, winner_id: null };
  assert.equal(outcomeFor(drawn, 1), 'draw');
  assert.equal(outcomeFor(drawn, 2), 'draw');
});

test('outcomeFor never claims a win for a row that does not involve the player', () => {
  const xWon = { result: 'X', player_x_id: 1, player_o_id: 2 };
  assert.equal(outcomeFor(xWon, 99), 'draw');
  assert.equal(outcomeFor(null, 1), 'draw');
});

test('outcomeFor coerces numeric ids so JSON string ids cannot skew results', () => {
  const xWon = { result: 'X', player_x_id: 1, player_o_id: 2 };
  assert.equal(outcomeFor(xWon, '1'), 'won');
  assert.equal(outcomeFor(xWon, '2'), 'lost');
});

test('scoreText renders the X and O score totals of a series', () => {
  assert.equal(scoreText({ score_x: 2, score_o: 1 }), 'X 2–1 O');
  assert.equal(scoreText({ score_x: 0, score_o: 2 }), 'X 0–2 O');
});

test('scoreText tolerates missing scores', () => {
  assert.equal(scoreText({}), 'X 0–0 O');
  assert.equal(scoreText(null), 'X 0–0 O');
});

test('friendlyLedgerReason maps known ledger reasons to readable labels', () => {
  assert.equal(friendlyLedgerReason('avatar_purchase'), 'Avatar purchase');
  assert.equal(friendlyLedgerReason('multiplayer_series_reward'), 'Series reward');
  assert.equal(friendlyLedgerReason('paystack_purchase'), 'Gem purchase');
});

test('friendlyLedgerReason falls back to the raw reason for unknown entries', () => {
  assert.equal(friendlyLedgerReason('admin_grant'), 'admin_grant');
  assert.equal(friendlyLedgerReason(''), '');
});

test('signedAmount prefixes positive amounts with a plus sign', () => {
  assert.equal(signedAmount({ amount: 10 }), '+10');
  assert.equal(signedAmount({ amount: 0 }), '0');
});

test('signedAmount keeps the minus sign on negative amounts', () => {
  assert.equal(signedAmount({ amount: -150 }), '-150');
  assert.equal(signedAmount({ amount: -1 }), '-1');
});

test('signedAmount tolerates missing amounts', () => {
  assert.equal(signedAmount({}), '0');
});

test('dateText renders SQLite UTC timestamps as readable dates', () => {
  assert.equal(dateText('2026-09-07 14:30:00'), '7 Sep 2026, 14:30');
  assert.equal(dateText('2026-11-05 08:05:00'), '5 Nov 2026, 08:05');
});

test('dateText also accepts full ISO-8601 timestamps', () => {
  assert.equal(dateText('2026-09-07T14:30:00.000Z'), '7 Sep 2026, 14:30');
});

test('dateText reports an unknown date instead of crashing on bad input', () => {
  assert.equal(dateText(null), 'Unknown date');
  assert.equal(dateText('not-a-date'), 'Unknown date');
  assert.equal(dateText(''), 'Unknown date');
});
