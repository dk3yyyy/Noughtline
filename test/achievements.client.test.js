import test from 'node:test';
import assert from 'node:assert/strict';
import {
  achievementIconKey,
  tileStateClass,
  claimButtonLabel,
} from '../src/services/achievements.js';

test('achievementIconKey maps every known achievement id to a stable icon key', () => {
  assert.equal(achievementIconKey('first_win'), 'trophy');
  assert.equal(achievementIconKey('wins_10'), 'award');
  assert.equal(achievementIconKey('streak_5'), 'flame');
  assert.equal(achievementIconKey('level_5'), 'target');
  assert.equal(achievementIconKey('level_10'), 'crown');
  assert.equal(achievementIconKey('first_purchase'), 'bag');
});

test('achievementIconKey falls back for unknown ids (server catalog may grow)', () => {
  assert.equal(achievementIconKey('play_100_matches'), 'trophy');
  assert.equal(achievementIconKey('anything_new'), 'trophy');
  assert.equal(achievementIconKey(''), 'trophy');
  assert.equal(achievementIconKey(undefined), 'trophy');
  assert.equal(achievementIconKey(null), 'trophy');
});

test('tileStateClass prioritizes claimed over eligible', () => {
  assert.equal(tileStateClass({ claimed: true, eligible: true }), 'claimed');
  assert.equal(tileStateClass({ claimed: true, eligible: false }), 'claimed');
});

test('tileStateClass marks unclaimed eligible achievements as claimable', () => {
  assert.equal(tileStateClass({ claimed: false, eligible: true }), 'eligible');
});

test('tileStateClass locks everything else, defensively on missing flags', () => {
  assert.equal(tileStateClass({ claimed: false, eligible: false }), 'locked');
  // Old payloads may omit the booleans — treat as not claimed / not eligible.
  assert.equal(tileStateClass({}), 'locked');
  assert.equal(tileStateClass({ claimed: false }), 'locked');
  // Missing claimed defaults to false; a present eligible flag still wins.
  assert.equal(tileStateClass({ eligible: true }), 'eligible');
  assert.equal(tileStateClass(null), 'locked');
  assert.equal(tileStateClass(undefined), 'locked');
});

test('claimButtonLabel offers Claim only for eligible, unclaimed achievements', () => {
  assert.equal(claimButtonLabel({ claimed: false, eligible: true }), 'Claim');
  assert.equal(claimButtonLabel({ claimed: true, eligible: true }), '');
  assert.equal(claimButtonLabel({ claimed: true, eligible: false }), '');
  assert.equal(claimButtonLabel({ claimed: false, eligible: false }), '');
  // Missing booleans must never produce a stray claim button.
  assert.equal(claimButtonLabel({}), '');
  assert.equal(claimButtonLabel(null), '');
  assert.equal(claimButtonLabel(undefined), '');
});
