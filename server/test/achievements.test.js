const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const Database = require('better-sqlite3');
const { createDatabase, initDb, createGuest } = require('../database');
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

function createTestRuntime(overrides = {}) {
  return createRuntime({
    config: { ...config(), ...(overrides.config || {}) },
    database: createDatabase(':memory:'),
    startTimers: false,
    ...(overrides.fetchImpl ? { fetchImpl: overrides.fetchImpl } : {}),
  });
}

async function guest(runtime) {
  const response = await request(runtime.app).post('/api/auth/guest').send({});
  assert.equal(response.status, 201);
  return response.body;
}

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

// X (first joiner) plays a 1-round series that O wins (O completes the middle
// row on its fourth move) through the normal 'played' path.
function settlePlayedLossForX(runtime, roomId, xSession, oSession) {
  runtime.roomManager.createRoom(roomId, { size: 3, rounds: 1 }, { rewardEligible: true });
  runtime.roomManager.joinRoom(roomId, { userId: xSession.user.id, socketId: `${roomId}-x`, username: xSession.user.username });
  runtime.roomManager.joinRoom(roomId, { userId: oSession.user.id, socketId: `${roomId}-o`, username: oSession.user.username });
  runtime.roomManager.makeMove(roomId, 0, xSession.user.id, `${roomId}-x`);
  runtime.roomManager.makeMove(roomId, 3, oSession.user.id, `${roomId}-o`);
  runtime.roomManager.makeMove(roomId, 1, xSession.user.id, `${roomId}-x`);
  runtime.roomManager.makeMove(roomId, 4, oSession.user.id, `${roomId}-o`);
  runtime.roomManager.makeMove(roomId, 7, xSession.user.id, `${roomId}-x`);
  return runtime.roomManager.makeMove(roomId, 5, oSession.user.id, `${roomId}-o`);
}

const statsOf = (runtime, userId) => runtime.db.prepare('SELECT wins, streak, max_streak, xp, level, coins, gems FROM users WHERE id = ?').get(userId);

test('GET /api/achievements and the claim endpoint require a signed session', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  assert.equal((await request(runtime.app).get('/api/achievements')).status, 401);
  assert.equal((await request(runtime.app).post('/api/achievements/first_win/claim')).status, 401);
});

test('GET /api/achievements lists the full catalog unclaimed and ineligible for a fresh guest', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const session = await guest(runtime);
  const response = await request(runtime.app).get('/api/achievements').set('Authorization', `Bearer ${session.token}`);
  assert.equal(response.status, 200);
  assert.deepEqual(
    response.body.achievements.map((achievement) => achievement.id),
    ['first_win', 'wins_10', 'streak_5', 'level_5', 'level_10', 'first_purchase'],
  );
  for (const achievement of response.body.achievements) {
    assert.equal(achievement.claimed, false);
    assert.equal(achievement.eligible, false);
    assert.equal(typeof achievement.title, 'string');
    assert.equal(typeof achievement.description, 'string');
    assert.ok(['coins', 'gems'].includes(achievement.reward.currency));
    assert.equal(typeof achievement.reward.amount, 'number');
  }
});

test('claiming an unearned achievement returns 409 ACHIEVEMENT_INCOMPLETE', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const session = await guest(runtime);
  const response = await request(runtime.app)
    .post('/api/achievements/first_win/claim')
    .set('Authorization', `Bearer ${session.token}`);
  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'ACHIEVEMENT_INCOMPLETE');
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS count FROM currency_ledger').get().count, 0);
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS count FROM user_achievements').get().count, 0);
});

test('claiming an unknown achievement id returns 404 UNKNOWN_ACHIEVEMENT', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const session = await guest(runtime);
  const response = await request(runtime.app)
    .post('/api/achievements/not_an_achievement/claim')
    .set('Authorization', `Bearer ${session.token}`);
  assert.equal(response.status, 404);
  assert.equal(response.body.code, 'UNKNOWN_ACHIEVEMENT');
  assert.equal(response.body.error, 'Unknown achievement');
});

test('claiming first_win after a played reward-eligible win credits 100 coins exactly once', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const winner = await guest(runtime);
  settlePlayedWin(runtime, 'ROOM_ACH_FIRST', winner, await guest(runtime));
  assert.equal(statsOf(runtime, winner.user.id).wins, 1);

  const claim = await request(runtime.app)
    .post('/api/achievements/first_win/claim')
    .set('Authorization', `Bearer ${winner.token}`);
  assert.equal(claim.status, 200);
  assert.deepEqual(claim.body, { achievementId: 'first_win', reward: { currency: 'coins', amount: 100 } });
  assert.equal(statsOf(runtime, winner.user.id).coins, 10 + 100);

  const ledgerRow = runtime.db.prepare('SELECT currency, amount, reason, reference FROM currency_ledger WHERE reference = ?').get('achievement:first_win');
  assert.equal(ledgerRow.currency, 'coins');
  assert.equal(ledgerRow.amount, 100);
  assert.equal(ledgerRow.reason, 'achievement_reward');
  assert.equal(runtime.db.prepare('SELECT 1 FROM user_achievements WHERE user_id = ? AND achievement_id = ?').get(winner.user.id, 'first_win') !== undefined, true);

  const state = (await request(runtime.app).get('/api/achievements').set('Authorization', `Bearer ${winner.token}`)).body;
  const firstWin = state.achievements.find((achievement) => achievement.id === 'first_win');
  assert.equal(firstWin.claimed, true);
  assert.equal(firstWin.eligible, false);

  const duplicate = await request(runtime.app)
    .post('/api/achievements/first_win/claim')
    .set('Authorization', `Bearer ${winner.token}`);
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, 'ACHIEVEMENT_ALREADY_CLAIMED');
  assert.equal(statsOf(runtime, winner.user.id).coins, 110);
  assert.equal(runtime.db.prepare("SELECT COUNT(*) AS count FROM currency_ledger WHERE reference = 'achievement:first_win'").get().count, 1);
});

test('wins_10 requires ten recorded wins and stays unclaimable at nine', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const winner = await guest(runtime);
  const opponent = await guest(runtime);
  for (let i = 1; i <= 9; i += 1) {
    settlePlayedWin(runtime, `ROOM_ACH_W10_${i}`, winner, opponent);
  }
  assert.equal(statsOf(runtime, winner.user.id).wins, 9);

  const premature = await request(runtime.app)
    .post('/api/achievements/wins_10/claim')
    .set('Authorization', `Bearer ${winner.token}`);
  assert.equal(premature.status, 409);
  assert.equal(premature.body.code, 'ACHIEVEMENT_INCOMPLETE');

  settlePlayedWin(runtime, 'ROOM_ACH_W10_10', winner, opponent);
  assert.equal(statsOf(runtime, winner.user.id).wins, 10);
  const claim = await request(runtime.app)
    .post('/api/achievements/wins_10/claim')
    .set('Authorization', `Bearer ${winner.token}`);
  assert.equal(claim.status, 200);
  assert.deepEqual(claim.body, { achievementId: 'wins_10', reward: { currency: 'coins', amount: 250 } });
  assert.equal(statsOf(runtime, winner.user.id).coins, 10 * 10 + 250);
});

test('a five-win settlement run drives users.max_streak and unlocks streak_5 for 15 gems', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const winner = await guest(runtime);
  const opponent = await guest(runtime);
  for (let i = 1; i <= 5; i += 1) {
    settlePlayedWin(runtime, `ROOM_ACH_S5_${i}`, winner, opponent);
    const stats = statsOf(runtime, winner.user.id);
    assert.equal(stats.wins, i);
    assert.equal(stats.streak, i);
    assert.equal(stats.max_streak, i);
  }

  const claim = await request(runtime.app)
    .post('/api/achievements/streak_5/claim')
    .set('Authorization', `Bearer ${winner.token}`);
  assert.equal(claim.status, 200);
  assert.deepEqual(claim.body, { achievementId: 'streak_5', reward: { currency: 'gems', amount: 15 } });
  assert.equal(statsOf(runtime, winner.user.id).gems, 100 + 15);
  const ledgerRow = runtime.db.prepare('SELECT currency, amount, reason FROM currency_ledger WHERE reference = ?').get('achievement:streak_5');
  assert.equal(ledgerRow.currency, 'gems');
  assert.equal(ledgerRow.amount, 15);
  assert.equal(ledgerRow.reason, 'achievement_reward');

  const duplicate = await request(runtime.app)
    .post('/api/achievements/streak_5/claim')
    .set('Authorization', `Bearer ${winner.token}`);
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, 'ACHIEVEMENT_ALREADY_CLAIMED');
});

test('max_streak keeps the best streak after a loss resets the current streak', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const x = await guest(runtime);
  const o = await guest(runtime);
  settlePlayedWin(runtime, 'ROOM_ACH_MS_1', x, o);
  settlePlayedWin(runtime, 'ROOM_ACH_MS_2', x, o);
  assert.deepEqual(
    { streak: statsOf(runtime, x.user.id).streak, max_streak: statsOf(runtime, x.user.id).max_streak },
    { streak: 2, max_streak: 2 },
  );

  const lost = settlePlayedLossForX(runtime, 'ROOM_ACH_MS_3', x, o);
  assert.equal(lost.room.state.seriesWinner, 'O');
  assert.deepEqual(
    { streak: statsOf(runtime, x.user.id).streak, max_streak: statsOf(runtime, x.user.id).max_streak },
    { streak: 0, max_streak: 2 },
  );

  settlePlayedWin(runtime, 'ROOM_ACH_MS_4', x, o);
  assert.deepEqual(
    { streak: statsOf(runtime, x.user.id).streak, max_streak: statsOf(runtime, x.user.id).max_streak },
    { streak: 1, max_streak: 2 },
  );

  const stillUnearned = await request(runtime.app)
    .post('/api/achievements/streak_5/claim')
    .set('Authorization', `Bearer ${x.token}`);
  assert.equal(stillUnearned.status, 409);
  assert.equal(stillUnearned.body.code, 'ACHIEVEMENT_INCOMPLETE');
});

test('level achievements pay out from the stored level once xp milestones are reached', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const session = await guest(runtime);
  // Mirror what settlement writes: level is recomputed from xp at settlement.
  runtime.db.prepare('UPDATE users SET xp = 1000 WHERE id = ?').run(session.user.id);
  runtime.db.prepare('UPDATE users SET level = CAST(xp / 250 AS INTEGER) + 1 WHERE id = ?').run(session.user.id);
  assert.equal(statsOf(runtime, session.user.id).level, 5);

  const level5 = await request(runtime.app)
    .post('/api/achievements/level_5/claim')
    .set('Authorization', `Bearer ${session.token}`);
  assert.equal(level5.status, 200);
  assert.deepEqual(level5.body, { achievementId: 'level_5', reward: { currency: 'gems', amount: 10 } });
  assert.equal(statsOf(runtime, session.user.id).gems, 110);

  runtime.db.prepare('UPDATE users SET xp = 2300 WHERE id = ?').run(session.user.id);
  runtime.db.prepare('UPDATE users SET level = CAST(xp / 250 AS INTEGER) + 1 WHERE id = ?').run(session.user.id);
  assert.equal(statsOf(runtime, session.user.id).level, 10);

  const level10 = await request(runtime.app)
    .post('/api/achievements/level_10/claim')
    .set('Authorization', `Bearer ${session.token}`);
  assert.equal(level10.status, 200);
  assert.deepEqual(level10.body, { achievementId: 'level_10', reward: { currency: 'gems', amount: 30 } });
  assert.equal(statsOf(runtime, session.user.id).gems, 140);

  const duplicate = await request(runtime.app)
    .post('/api/achievements/level_5/claim')
    .set('Authorization', `Bearer ${session.token}`);
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, 'ACHIEVEMENT_ALREADY_CLAIMED');
});

test('first_purchase unlocks only after a credited gem package and pays 50 coins once', async (t) => {
  const responses = [
    { ok: true, status: true, data: { reference: 'TT_achievement_purchase', authorization_url: 'https://paystack.test/authorize' } },
    { ok: true, status: true, data: { reference: 'TT_achievement_purchase', status: 'success', amount: 100000, currency: 'NGN' } },
  ];
  const fetchImpl = async () => ({ ok: true, json: async () => responses.shift() });
  const runtime = createTestRuntime({ config: { paystackSecretKey: 'test-key' }, fetchImpl });
  t.after(() => runtime.db.close());
  const session = await guest(runtime);
  runtime.db.prepare('UPDATE users SET email = ? WHERE id = ?').run('paid@example.com', session.user.id);

  const initialized = await request(runtime.app)
    .post('/api/economy/payments')
    .set('Authorization', `Bearer ${session.token}`)
    .send({ packageId: 'gems_120' });
  assert.equal(initialized.status, 201);
  const verified = await request(runtime.app)
    .post('/api/economy/payments/TT_achievement_purchase/verify')
    .set('Authorization', `Bearer ${session.token}`);
  assert.equal(verified.body.gemsAdded, 120);
  assert.equal(statsOf(runtime, session.user.id).gems, 220);

  const state = (await request(runtime.app).get('/api/achievements').set('Authorization', `Bearer ${session.token}`)).body;
  const investor = state.achievements.find((achievement) => achievement.id === 'first_purchase');
  assert.equal(investor.eligible, true);
  assert.equal(investor.claimed, false);

  const claim = await request(runtime.app)
    .post('/api/achievements/first_purchase/claim')
    .set('Authorization', `Bearer ${session.token}`);
  assert.equal(claim.status, 200);
  assert.deepEqual(claim.body, { achievementId: 'first_purchase', reward: { currency: 'coins', amount: 50 } });
  assert.equal(statsOf(runtime, session.user.id).coins, 50);

  const duplicate = await request(runtime.app)
    .post('/api/achievements/first_purchase/claim')
    .set('Authorization', `Bearer ${session.token}`);
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, 'ACHIEVEMENT_ALREADY_CLAIMED');
});

test('initDb adds users.max_streak with a 0 default for legacy and fresh users', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE,
      username TEXT UNIQUE,
      avatar TEXT,
      xp INTEGER DEFAULT 0,
      level INTEGER DEFAULT 1,
      coins REAL DEFAULT 0,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      draws INTEGER DEFAULT 0,
      streak INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE avatars (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      url TEXT,
      cost_gems INTEGER,
      rarity TEXT,
      metadata TEXT
    );
    INSERT INTO users (uuid, username, coins) VALUES ('legacy-ach', 'Legacy_Ach', 0);
  `);

  initDb(db);
  const columns = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
  assert.ok(columns.includes('max_streak'));
  assert.equal(db.prepare("SELECT max_streak FROM users WHERE username = 'Legacy_Ach'").get().max_streak, 0);
  const fresh = createGuest(db);
  assert.equal(fresh.max_streak, 0);
  db.close();
});
