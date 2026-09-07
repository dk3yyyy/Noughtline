import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAILY_REWARD,
  dailyRewardCopy,
  rewardLabel,
  questComplete,
  questProgressLabel,
  canClaimQuest,
} from '../src/services/quests.js';

test('DAILY_REWARD mirrors the server daily grant (coins + gems)', () => {
  assert.deepEqual(DAILY_REWARD, { coins: 50, gems: 10 });
});

test('dailyRewardCopy renders the full daily reward pitch', () => {
  assert.equal(dailyRewardCopy(), 'Daily reward: 50 Coins + 10 Gems');
  assert.equal(dailyRewardCopy({ coins: 10, gems: 2 }), 'Daily reward: 10 Coins + 2 Gems');
});

test('rewardLabel renders a signed, currency-suffixed reward', () => {
  assert.equal(rewardLabel({ currency: 'coins', amount: 75 }), '+75 Coins');
  assert.equal(rewardLabel({ currency: 'gems', amount: 10 }), '+10 Gems');
});

test('rewardLabel tolerates missing rewards', () => {
  assert.equal(rewardLabel({}), '+0');
  assert.equal(rewardLabel({ amount: 75 }), '+75');
  assert.equal(rewardLabel({ currency: 'coins' }), '+0 Coins');
  assert.equal(rewardLabel(null), '+0');
});

test('questComplete is true once progress reaches the target', () => {
  assert.equal(questComplete({ progress: 3, target: 3 }), true);
  assert.equal(questComplete({ progress: 5, target: 3 }), true);
  assert.equal(questComplete({ progress: 2, target: 3 }), false);
  assert.equal(questComplete({ progress: 0, target: 3 }), false);
});

test('questComplete is false when progress or target is missing', () => {
  assert.equal(questComplete({ progress: 3 }), false);
  assert.equal(questComplete({ target: 3 }), false);
  assert.equal(questComplete(null), false);
});

test('questProgressLabel renders progress as a plain "of" phrase', () => {
  assert.equal(questProgressLabel({ progress: 2, target: 3 }), '2 of 3');
  assert.equal(questProgressLabel({ progress: 0, target: 5 }), '0 of 5');
  assert.equal(questProgressLabel({ progress: 5, target: 5 }), '5 of 5');
});

test('questProgressLabel survives missing or malformed progress', () => {
  assert.equal(questProgressLabel({}), '0 of 0');
  assert.equal(questProgressLabel({ progress: 'x', target: 3 }), '0 of 3');
  assert.equal(questProgressLabel(null), '0 of 0');
});

test('canClaimQuest only allows complete, unclaimed quests', () => {
  const complete = { progress: 3, target: 3, claimed: false };
  const incomplete = { progress: 1, target: 3, claimed: false };
  const alreadyClaimed = { progress: 3, target: 3, claimed: true };
  assert.equal(canClaimQuest(complete), true);
  assert.equal(canClaimQuest(incomplete), false);
  assert.equal(canClaimQuest(alreadyClaimed), false);
  assert.equal(canClaimQuest(null), false);
  assert.equal(canClaimQuest(undefined), false);
});
