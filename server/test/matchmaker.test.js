const test = require('node:test');
const assert = require('node:assert/strict');
const { Matchmaker } = require('../game/matchmaker');

function player(userId, socketId = `socket-${userId}`) {
  return { userId, socketId, username: `Player ${userId}` };
}

test('removes every queued entry for an authenticated user', () => {
  const matchmaker = new Matchmaker();
  matchmaker.queue.push(player(1, 'old'), player(1, 'new'), player(2));
  matchmaker.removeUser(1);
  assert.deepEqual(matchmaker.queue.map((entry) => entry.userId), [2]);
});

test('dequeue skips ineligible players and pairs the next eligible users', () => {
  const matchmaker = new Matchmaker();
  matchmaker.addToQueue(player(1));
  matchmaker.addToQueue(player(2));
  matchmaker.addToQueue(player(3));

  const match = matchmaker.findMatch((entry) => entry.userId !== 2);
  assert.equal(match.player1.userId, 1);
  assert.equal(match.player2.userId, 3);
  assert.equal(matchmaker.queue.length, 0);
});

test('queue expiry uses the injected clock', () => {
  let now = 1_000;
  const matchmaker = new Matchmaker({ now: () => now });
  matchmaker.addToQueue(player(1));
  now = 16_001;
  assert.deepEqual(matchmaker.expiredPlayers(15_000).map((entry) => entry.userId), [1]);
});
