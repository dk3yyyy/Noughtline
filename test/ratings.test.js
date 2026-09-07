import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatRating,
  ratingDelta,
  deltaLabel,
  isRankedRoom,
} from '../src/services/ratings.js';

test('formatRating renders integer ratings with thousands separators', () => {
  assert.equal(formatRating(1000), '1,000');
  assert.equal(formatRating(1024), '1,024');
  assert.equal(formatRating(12), '12');
  assert.equal(formatRating(999), '999');
  assert.equal(formatRating(1000000), '1,000,000');
});

test('formatRating rounds non-integer ratings before formatting', () => {
  assert.equal(formatRating(1024.6), '1,025');
  assert.equal(formatRating(1012.4), '1,012');
});

test('formatRating returns null for missing or malformed ratings', () => {
  assert.equal(formatRating(undefined), null);
  assert.equal(formatRating(null), null);
  assert.equal(formatRating(''), null);
  assert.equal(formatRating('oops'), null);
  assert.equal(formatRating(Number.NaN), null);
});

test('ratingDelta returns a plain signed difference', () => {
  assert.equal(ratingDelta(1000, 1012), 12);
  assert.equal(ratingDelta(1012, 1004), -8);
  assert.equal(ratingDelta(1000, 1000), 0);
  assert.equal(ratingDelta(100, 150), 50);
});

test('ratingDelta stays consistent with the integer ratings the server stores', () => {
  // Each side rounds like formatRating does, so the delta always matches the
  // difference between the two visible integer ratings.
  assert.equal(ratingDelta(1000.6, 1012.4), 11); // 1001 -> 1012
  assert.equal(ratingDelta(1012.4, 1000.6), -11);
  assert.equal(ratingDelta('1000', '1012'), 12);
});

test('ratingDelta measures losses that hit the rating floor', () => {
  assert.equal(ratingDelta(104, 100), -4);
  assert.equal(ratingDelta(100, 100), 0);
});

test('ratingDelta treats undefined ratings as no change', () => {
  assert.equal(ratingDelta(undefined, 1012), 0);
  assert.equal(ratingDelta(1000, undefined), 0);
  assert.equal(ratingDelta(undefined, undefined), 0);
  assert.equal(ratingDelta(null, 1012), 0);
});

test('deltaLabel signs gains and losses and stays empty for zero', () => {
  assert.equal(deltaLabel(1000, 1012), '+12');
  assert.equal(deltaLabel(1012, 1004), '-8');
  assert.equal(deltaLabel(1000, 1000), '');
  assert.equal(deltaLabel(100, 132), '+32');
});

test('deltaLabel is empty when the floor prevented any drop', () => {
  assert.equal(deltaLabel(100, 100), '');
  assert.equal(deltaLabel(104, 100), '-4');
});

test('deltaLabel is empty when ratings are missing', () => {
  assert.equal(deltaLabel(undefined, 1012), '');
  assert.equal(deltaLabel(1000, undefined), '');
  assert.equal(deltaLabel(null, null), '');
});

test('isRankedRoom only trusts an explicit rewardEligible === true', () => {
  assert.equal(isRankedRoom({ rewardEligible: true }), true);
  assert.equal(isRankedRoom({ rewardEligible: false }), false);
  assert.equal(isRankedRoom({}), false);
  assert.equal(isRankedRoom({ rewardEligible: 'true' }), false);
  assert.equal(isRankedRoom(null), false);
  assert.equal(isRankedRoom(undefined), false);
});

test('isRankedRoom recognises a full public room payload', () => {
  const publicRoom = {
    id: 'ROOM_ABC123',
    seriesId: 'uuid',
    rewardEligible: true,
    config: { size: 3, rounds: 3 },
    players: [],
    state: { status: 'waiting' },
  };
  assert.equal(isRankedRoom(publicRoom), true);
});
