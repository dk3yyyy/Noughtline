const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createDatabase } = require('../database');
const { createEconomy } = require('../economy');
const { createRuntime } = require('../app');

function config() {
  return {
    nodeEnv: 'test',
    jwtSecret: 'test-secret-at-least-local',
    jwtExpiresIn: '1h',
    databasePath: ':memory:',
    corsOrigins: ['http://localhost'],
    paystackSecretKey: '',
    publicAppUrl: 'http://localhost',
  };
}

function createTestRuntime() {
  return createRuntime({ config: config(), database: createDatabase(':memory:'), startTimers: false });
}

async function guest(runtime) {
  const response = await request(runtime.app).post('/api/auth/guest').send({});
  assert.equal(response.status, 201);
  return response.body;
}

const utcDayString = (date) => new Date(date).toISOString().slice(0, 10);
const todayString = () => utcDayString(new Date());

// X (first joiner) plays a full 1-round series to a win with no forfeit so the
// room settles through the normal 'played' path used by matchmaking rooms.
function settlePlayedWin(runtime, roomId, xSession, oSession) {
  runtime.roomManager.createRoom(roomId, { size: 3, rounds: 1 }, { rewardEligible: true });
  runtime.roomManager.joinRoom(roomId, { userId: xSession.user.id, socketId: `${roomId}-x`, username: xSession.user.username });
  runtime.roomManager.joinRoom(roomId, { userId: oSession.user.id, socketId: `${roomId}-o`, username: oSession.user.username });
  runtime.roomManager.makeMove(roomId, 0, xSession.user.id, `${roomId}-x`);
  runtime.roomManager.makeMove(roomId, 3, oSession.user.id, `${roomId}-o`);
  runtime.roomManager.makeMove(roomId, 1, xSession.user.id, `${roomId}-x`);
  runtime.roomManager.makeMove(roomId, 4, oSession.user.id, `${roomId}-o`);
  return runtime.roomManager.makeMove(roomId, 2, xSession.user.id, `${roomId}-x`);
}

function questProgressByQuestId(runtime, userId, day) {
  return Object.fromEntries(
    runtime.db.prepare('SELECT quest_id, progress FROM quest_progress WHERE user_id = ? AND day = ?')
      .all(userId, day)
      .map((row) => [row.quest_id, row.progress]),
  );
}

test('GET /api/quests and both claim endpoints require a signed session', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  assert.equal((await request(runtime.app).get('/api/quests')).status, 401);
  assert.equal((await request(runtime.app).post('/api/quests/daily-claim')).status, 401);
  assert.equal((await request(runtime.app).post('/api/quests/win_1/claim')).status, 401);
});

test('reward-eligible played win series progresses win and play quests; settlement rewards unchanged', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const winner = await guest(runtime);
  const loser = await guest(runtime);
  const completed = settlePlayedWin(runtime, 'ROOM_QUEST_WIN', winner, loser);
  assert.equal(completed.room.state.seriesWinner, 'X');
  assert.equal(completed.room.state.completionReason, null);

  const day = todayString();
  assert.deepEqual(questProgressByQuestId(runtime, winner.user.id, day), {
    play_3: 1, play_5: 1, win_1: 1, win_3: 1,
  });
  assert.deepEqual(questProgressByQuestId(runtime, loser.user.id, day), { play_3: 1, play_5: 1 });

  // Quest recording must not alter the existing settlement math.
  const winnerProfile = await request(runtime.app).get('/api/me').set('Authorization', `Bearer ${winner.token}`);
  const loserProfile = await request(runtime.app).get('/api/me').set('Authorization', `Bearer ${loser.token}`);
  assert.equal(winnerProfile.body.wins, 1);
  assert.equal(winnerProfile.body.coins, 10);
  assert.equal(winnerProfile.body.xp, 50);
  assert.equal(loserProfile.body.losses, 1);
  assert.equal(loserProfile.body.coins, 3);
  assert.equal(loserProfile.body.xp, 15);
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS count FROM currency_ledger').get().count, 2);
});

test('private (non-reward-eligible) series records results but never progresses quests', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const winner = await guest(runtime);
  const loser = await guest(runtime);
  runtime.roomManager.createRoom('ROOM_QUEST_PRIVATE', { size: 3, rounds: 1 });
  runtime.roomManager.joinRoom('ROOM_QUEST_PRIVATE', { userId: winner.user.id, socketId: 'p-x', username: winner.user.username });
  runtime.roomManager.joinRoom('ROOM_QUEST_PRIVATE', { userId: loser.user.id, socketId: 'p-o', username: loser.user.username });
  runtime.roomManager.makeMove('ROOM_QUEST_PRIVATE', 0, winner.user.id, 'p-x');
  runtime.roomManager.makeMove('ROOM_QUEST_PRIVATE', 3, loser.user.id, 'p-o');
  runtime.roomManager.makeMove('ROOM_QUEST_PRIVATE', 1, winner.user.id, 'p-x');
  runtime.roomManager.makeMove('ROOM_QUEST_PRIVATE', 4, loser.user.id, 'p-o');
  runtime.roomManager.makeMove('ROOM_QUEST_PRIVATE', 2, winner.user.id, 'p-x');
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS count FROM series_results').get().count, 1);
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS count FROM quest_progress').get().count, 0);
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS count FROM currency_ledger').get().count, 0);
});

test('disconnect forfeit series does not progress quests', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const winner = await guest(runtime);
  const forfeiter = await guest(runtime);
  runtime.roomManager.createRoom('ROOM_QUEST_DISC', { size: 3, rounds: 1 }, { rewardEligible: true });
  runtime.roomManager.joinRoom('ROOM_QUEST_DISC', { userId: winner.user.id, socketId: 'd-x', username: winner.user.username });
  runtime.roomManager.joinRoom('ROOM_QUEST_DISC', { userId: forfeiter.user.id, socketId: 'd-o', username: forfeiter.user.username });
  runtime.roomManager.disconnect('d-o');
  const [resolved] = runtime.roomManager.resolveDisconnectTimeouts(0);
  assert.equal(resolved.room.state.seriesWinner, 'X');
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS count FROM quest_progress').get().count, 0);
  // The winner still receives the forfeit payout exactly as before.
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS count FROM currency_ledger').get().count, 1);
});

test('voluntary forfeit series does not progress quests', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const forfeiter = await guest(runtime);
  const winner = await guest(runtime);
  runtime.roomManager.createRoom('ROOM_QUEST_VOL', { size: 3, rounds: 3 }, { rewardEligible: true });
  runtime.roomManager.joinRoom('ROOM_QUEST_VOL', { userId: forfeiter.user.id, socketId: 'v-x', username: forfeiter.user.username });
  runtime.roomManager.joinRoom('ROOM_QUEST_VOL', { userId: winner.user.id, socketId: 'v-o', username: winner.user.username });
  const left = runtime.roomManager.leaveRoom('ROOM_QUEST_VOL', forfeiter.user.id, 'v-x');
  assert.equal(left.room.state.seriesWinner, 'O');
  assert.equal(left.room.state.completionReason, 'voluntary_forfeit');
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS count FROM quest_progress').get().count, 0);
});

test('GET /api/quests lists the catalog unclaimed with zero progress for a fresh guest', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const session = await guest(runtime);
  const response = await request(runtime.app).get('/api/quests').set('Authorization', `Bearer ${session.token}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.day, todayString());
  assert.equal(response.body.dailyRewardClaimed, false);
  assert.deepEqual(response.body.quests.map((quest) => quest.id), ['play_3', 'win_1', 'win_3', 'play_5']);
  for (const quest of response.body.quests) {
    assert.equal(quest.progress, 0);
    assert.equal(quest.claimed, false);
    assert.equal(typeof quest.description, 'string');
    assert.equal(typeof quest.target, 'number');
    assert.ok(['play', 'win'].includes(quest.kind));
    assert.ok(['coins', 'gems'].includes(quest.reward.currency));
    assert.equal(typeof quest.reward.amount, 'number');
  }
  const play5 = response.body.quests.find((quest) => quest.id === 'play_5');
  assert.deepEqual(play5.reward, { currency: 'gems', amount: 10 });
});

test('claiming an incomplete quest returns 409 QUEST_INCOMPLETE', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const session = await guest(runtime);
  const response = await request(runtime.app)
    .post('/api/quests/win_3/claim')
    .set('Authorization', `Bearer ${session.token}`);
  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'QUEST_INCOMPLETE');
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS count FROM currency_ledger').get().count, 0);
});

test('claiming a completed quest credits the exact reward once via the ledger and marks it claimed', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const winner = await guest(runtime);
  settlePlayedWin(runtime, 'ROOM_QUEST_CLAIM', winner, await guest(runtime));
  const day = todayString();

  const claim = await request(runtime.app)
    .post('/api/quests/win_1/claim')
    .set('Authorization', `Bearer ${winner.token}`);
  assert.equal(claim.status, 200);
  assert.deepEqual(claim.body, { questId: 'win_1', reward: { currency: 'coins', amount: 50 } });
  assert.equal(runtime.db.prepare('SELECT coins FROM users WHERE id = ?').get(winner.user.id).coins, 10 + 50);

  const ledgerRow = runtime.db.prepare("SELECT currency, amount, reason, reference FROM currency_ledger WHERE reference = ?").get(`quest:win_1:${day}:coins`);
  assert.equal(ledgerRow.currency, 'coins');
  assert.equal(ledgerRow.amount, 50);
  assert.equal(ledgerRow.reason, 'quest_reward');
  assert.equal(runtime.db.prepare('SELECT claimed FROM quest_progress WHERE user_id = ? AND quest_id = ? AND day = ?').get(winner.user.id, 'win_1', day).claimed, 1);

  const state = (await request(runtime.app).get('/api/quests').set('Authorization', `Bearer ${winner.token}`)).body;
  assert.equal(state.quests.find((quest) => quest.id === 'win_1').progress, 1);
  assert.equal(state.quests.find((quest) => quest.id === 'win_1').claimed, true);

  const duplicate = await request(runtime.app)
    .post('/api/quests/win_1/claim')
    .set('Authorization', `Bearer ${winner.token}`);
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, 'QUEST_ALREADY_CLAIMED');
  assert.equal(runtime.db.prepare('SELECT coins FROM users WHERE id = ?').get(winner.user.id).coins, 60);
});

test('daily claim credits coins and gems exactly once with distinct ledger references', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const session = await guest(runtime);
  const day = todayString();

  const claim = await request(runtime.app)
    .post('/api/quests/daily-claim')
    .set('Authorization', `Bearer ${session.token}`);
  assert.equal(claim.status, 200);
  assert.deepEqual(claim.body, { day, granted: { coins: 50, gems: 10 } });
  assert.deepEqual(
    runtime.db.prepare('SELECT coins, gems FROM users WHERE id = ?').get(session.user.id),
    { coins: 50, gems: 110 },
  );
  const coinsLedger = runtime.db.prepare('SELECT amount, reason, reference FROM currency_ledger WHERE reference = ?').get(`daily:${day}:coins`);
  const gemsLedger = runtime.db.prepare('SELECT amount, reason, reference FROM currency_ledger WHERE reference = ?').get(`daily:${day}:gems`);
  assert.equal(coinsLedger.amount, 50);
  assert.equal(coinsLedger.reason, 'daily_reward');
  assert.equal(gemsLedger.amount, 10);
  assert.equal(gemsLedger.reason, 'daily_reward');

  const duplicate = await request(runtime.app)
    .post('/api/quests/daily-claim')
    .set('Authorization', `Bearer ${session.token}`);
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, 'DAILY_REWARD_CLAIMED');
  assert.deepEqual(
    runtime.db.prepare('SELECT coins, gems FROM users WHERE id = ?').get(session.user.id),
    { coins: 50, gems: 110 },
  );
  const state = (await request(runtime.app).get('/api/quests').set('Authorization', `Bearer ${session.token}`)).body;
  assert.equal(state.dailyRewardClaimed, true);
});

test('daily reward can be claimed again after a UTC day rollover', async (t) => {
  const { createQuestService } = require('../quests');
  let clockMs = Date.parse('2026-09-07T12:00:00Z');
  const db = createDatabase(':memory:');
  const economy = createEconomy({ db, config: { paystackSecretKey: '', publicAppUrl: 'http://localhost' } });
  const questService = createQuestService({ db, economy, now: () => clockMs });
  const runtime = createRuntime({ config: config(), database: db, startTimers: false, questService });
  t.after(() => runtime.db.close());
  const session = await guest(runtime);

  const first = await request(runtime.app).post('/api/quests/daily-claim').set('Authorization', `Bearer ${session.token}`);
  assert.equal(first.status, 200);
  assert.equal(first.body.day, '2026-09-07');

  clockMs = Date.parse('2026-09-08T12:00:00Z');
  const second = await request(runtime.app).post('/api/quests/daily-claim').set('Authorization', `Bearer ${session.token}`);
  assert.equal(second.status, 200);
  assert.equal(second.body.day, '2026-09-08');
  assert.deepEqual(
    runtime.db.prepare('SELECT coins, gems FROM users WHERE id = ?').get(session.user.id),
    { coins: 100, gems: 120 },
  );
  const references = runtime.db.prepare('SELECT reference FROM currency_ledger WHERE user_id = ? ORDER BY reference').all(session.user.id).map((row) => row.reference);
  assert.deepEqual(references, ['daily:2026-09-07:coins', 'daily:2026-09-07:gems', 'daily:2026-09-08:coins', 'daily:2026-09-08:gems']);

  const thrice = await request(runtime.app).post('/api/quests/daily-claim').set('Authorization', `Bearer ${session.token}`);
  assert.equal(thrice.status, 409);
  assert.equal(thrice.body.code, 'DAILY_REWARD_CLAIMED');
});

test('claiming an unknown quest id returns 404 UNKNOWN_QUEST', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const session = await guest(runtime);
  const response = await request(runtime.app)
    .post('/api/quests/not_a_quest/claim')
    .set('Authorization', `Bearer ${session.token}`);
  assert.equal(response.status, 404);
  assert.equal(response.body.code, 'UNKNOWN_QUEST');
  assert.equal(response.body.error, 'Unknown quest');
});

test('quest progress is scoped to its UTC day and does not leak into the next day', async (t) => {
  const { createQuestService } = require('../quests');
  const clockMs = Date.parse('2026-09-08T12:00:00Z');
  const db = createDatabase(':memory:');
  const economy = createEconomy({ db, config: { paystackSecretKey: '', publicAppUrl: 'http://localhost' } });
  const questService = createQuestService({ db, economy, now: () => clockMs });
  const runtime = createRuntime({ config: config(), database: db, startTimers: false, questService });
  t.after(() => runtime.db.close());
  const session = await guest(runtime);

  // Progress earned yesterday lives only on yesterday's row.
  questService.recordSettledSeries({ userId: session.user.id, outcome: 'won', day: '2026-09-07' });
  assert.deepEqual(questProgressByQuestId(runtime, session.user.id, '2026-09-07'), {
    play_3: 1, play_5: 1, win_1: 1, win_3: 1,
  });
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS count FROM quest_progress WHERE day = ?').get('2026-09-08').count, 0);

  // Today's view (injected clock) shows the fresh day, so yesterday's progress
  // neither shows nor is claimable today.
  const state = (await request(runtime.app).get('/api/quests').set('Authorization', `Bearer ${session.token}`)).body;
  assert.equal(state.day, '2026-09-08');
  for (const quest of state.quests) {
    assert.equal(quest.progress, 0);
    assert.equal(quest.claimed, false);
  }
  const staleClaim = await request(runtime.app).post('/api/quests/win_1/claim').set('Authorization', `Bearer ${session.token}`);
  assert.equal(staleClaim.status, 409);
  assert.equal(staleClaim.body.code, 'QUEST_INCOMPLETE');
});

test('series settlement records quest progress under the injected quest clock', async (t) => {
  const { createQuestService } = require('../quests');
  // A fixed day that is (almost certainly) not the host clock's UTC day: if
  // settlement used the host clock this test would write progress elsewhere.
  const clockMs = Date.parse('2026-09-08T12:00:00Z');
  const db = createDatabase(':memory:');
  const economy = createEconomy({ db, config: { paystackSecretKey: '', publicAppUrl: 'http://localhost' } });
  const questService = createQuestService({ db, economy, now: () => clockMs });
  const runtime = createRuntime({ config: config(), database: db, startTimers: false, questService });
  t.after(() => runtime.db.close());

  const x = await guest(runtime);
  const o = await guest(runtime);
  runtime.roomManager.createRoom('ROOM_QUEST_CLOCK', { size: 3, rounds: 1 }, { rewardEligible: true });
  runtime.roomManager.joinRoom('ROOM_QUEST_CLOCK', { userId: x.user.id, socketId: 'a', username: x.user.username });
  runtime.roomManager.joinRoom('ROOM_QUEST_CLOCK', { userId: o.user.id, socketId: 'b', username: o.user.username });
  // X completes the top row -> series settles as 'played' with X the winner.
  runtime.roomManager.makeMove('ROOM_QUEST_CLOCK', 0, x.user.id, 'a');
  runtime.roomManager.makeMove('ROOM_QUEST_CLOCK', 3, o.user.id, 'b');
  runtime.roomManager.makeMove('ROOM_QUEST_CLOCK', 1, x.user.id, 'a');
  runtime.roomManager.makeMove('ROOM_QUEST_CLOCK', 4, o.user.id, 'b');
  runtime.roomManager.makeMove('ROOM_QUEST_CLOCK', 2, x.user.id, 'a');

  // Both players progressed 'play' quests on the injected clock's day only.
  const progressByQuest = (userId) => Object.fromEntries(
    runtime.db.prepare('SELECT quest_id, progress FROM quest_progress WHERE user_id = ? AND day = ?')
      .all(userId, '2026-09-08').map((row) => [row.quest_id, row.progress]),
  );
  assert.deepEqual(progressByQuest(x.user.id), { play_3: 1, play_5: 1, win_1: 1, win_3: 1 });
  assert.deepEqual(progressByQuest(o.user.id), { play_3: 1, play_5: 1 });
  for (const player of [x, o]) {
    assert.equal(
      runtime.db.prepare('SELECT COUNT(*) AS count FROM quest_progress WHERE user_id = ? AND day != ?').get(player.user.id, '2026-09-08').count,
      0,
    );
  }
});
