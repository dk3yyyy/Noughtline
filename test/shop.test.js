import test from 'node:test';
import assert from 'node:assert/strict';
import {
  currencyLabel,
  insufficientGuidance,
  insufficientLabel,
  itemCost,
  shortfallText,
} from '../src/services/shop.js';

test('currencyLabel maps the two server currencies', () => {
  assert.equal(currencyLabel('coins'), 'Coins');
  assert.equal(currencyLabel('gems'), 'Gems');
  assert.equal(currencyLabel(undefined), 'Gems'); // defensive default
});

test('itemCost reads the correct cost column per currency', () => {
  assert.equal(itemCost({ currency: 'coins', cost_coins: 150, cost_gems: 0 }), 150);
  assert.equal(itemCost({ currency: 'gems', cost_gems: 600, cost_coins: 0 }), 600);
  assert.equal(itemCost({ currency: 'coins', cost_coins: 0 }), 0); // free starters
  assert.equal(itemCost(null), 0);
  assert.equal(itemCost({ currency: 'gems', cost_gems: 'not-a-number' }), 0);
});

test('insufficientLabel names the actual currency, not hardcoded gems', () => {
  assert.equal(insufficientLabel({ currency: 'coins' }), 'Insufficient Coins');
  assert.equal(insufficientLabel({ currency: 'gems' }), 'Insufficient Gems');
  assert.equal(insufficientLabel(null), 'Insufficient');
});

test('shortfallText explains the exact missing amount', () => {
  const gemItem = { currency: 'gems', cost_gems: 400 };
  const coinItem = { currency: 'coins', cost_coins: 150 };
  assert.equal(shortfallText(gemItem, 100), 'You have 100 Gems — need 300 more.');
  assert.equal(shortfallText(coinItem, 50), 'You have 50 Coins — need 100 more.');
  assert.equal(shortfallText(gemItem, 500), ''); // affordable -> no shortfall copy
  assert.equal(shortfallText(coinItem, 0), 'You have 0 Coins — need 150 more.');
  assert.equal(shortfallText(null, 100), '');
});

test('insufficientGuidance points at earn paths per currency', () => {
  assert.match(insufficientGuidance({ currency: 'coins' }), /Win ranked matches/);
  assert.match(insufficientGuidance({ currency: 'gems' }), /buy Gems/);
  assert.match(insufficientGuidance({ currency: 'gems' }), /daily rewards, quests and achievements/);
  assert.equal(insufficientGuidance(null), 'Not enough currency for this item.');
});
