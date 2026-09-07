const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const Database = require('better-sqlite3');
const { createDatabase, initDb, createGuest } = require('../database');
const { createRuntime } = require('../app');
const { ELO_DEFAULTS, expectedScore, computeNewRatings } = require('../elo');

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

const ratingOf = (runtime, userId) => runtime.db.prepare('SELECT rating FROM users WHERE id = ?').get(userId).rating;

function closeTo(actual, expected, tolerance = 0.01) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
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

// X and O trade moves that fill a 3x3 board with no winning line, ending the
// 1-round series in a Draw through the normal 'played' path.
function settlePlayedDraw(runtime, roomId, xSession, oSession) {
  runtime.roomManager.createRoom(roomId, { size: 3, rounds: 1 }, { rewardEligible: true });
  runtime.roomManager.joinRoom(roomId, { userId: xSession.user.id, socketId: `${roomId}-x`, username: xSession.user.username });
  runtime.roomManager.joinRoom(roomId, { userId: oSession.user.id, socketId: `${roomId}-o`, username: oSession.user.username });
  const moves = [
    [0, 'x'], [1, 'o'], [2, 'x'], [4, 'o'], [3, 'x'],
    [6, 'o'], [7, 'x'], [5, 'o'], [8, 'x'],
  ];
  for (const [index, side] of moves) {
    const session = side === 'x' ? xSession : oSession;
    runtime.roomManager.makeMove(roomId, index, session.user.id, `${roomId}-${side}`);
  }
  return runtime.roomManager.getRoom(roomId);
}

// --- Pure Elo module ---------------------------------------------------------

test('elo module exports the agreed defaults', () => {
  assert.deepEqual(ELO_DEFAULTS, { start: 1000, floor: 100, kFactor: 32, divisor: 400 });
});

test('expectedScore is symmetric and anchored at 0.5 for equal ratings', () => {
  assert.equal(expectedScore(1000, 1000), 0.5);
  closeTo(expectedScore(1200, 1000), 1 / (1 + 10 ** ((1000 - 1200) / 400)), 1e-9);
  closeTo(expectedScore(1000, 1200), 0.240253, 1e-6);
  // a vs b complements b vs a: the pair sums to exactly 1 within FP noise.
  assert.ok(Math.abs(expectedScore(1234, 987) + expectedScore(987, 1234) - 1) < 1e-9);
});

test('computeNewRatings: equal ratings win moves 16 points, loss -16, draw unchanged', () => {
  assert.deepEqual(computeNewRatings(1000, 1000, 'A_WINS'), { newA: 1016, newB: 984, deltaA: 16, deltaB: -16 });
  assert.deepEqual(computeNewRatings(1000, 1000, 'B_WINS'), { newA: 984, newB: 1016, deltaA: -16, deltaB: 16 });
  assert.deepEqual(computeNewRatings(1000, 1000, 'DRAW'), { newA: 1000, newB: 1000, deltaA: 0, deltaB: 0 });
});

test('computeNewRatings: favourite gains less than the underdog loses the mirror amount', () => {
  const { newA, newB, deltaA, deltaB } = computeNewRatings(1200, 1000, 'A_WINS');
  closeTo(deltaA, 32 * (1 - expectedScore(1200, 1000)), 1e-9);
  closeTo(newA, 1207.688, 0.001);
  closeTo(newB, 992.312, 0.001);
  // Elo is zero-sum away from the floor: deltas are equal and opposite.
  assert.ok(Math.abs(deltaA + deltaB) < 1e-9);
  closeTo(newA + newB, 2200, 1e-6);
});

test('computeNewRatings: ratings never fall below the 100 floor', () => {
  // A player already at the floor loses 13.7 raw points to a 150-rated rival;
  // the floor clamps the result back to 100 while the winner keeps the gain.
  const floored = computeNewRatings(100, 150, 'B_WINS');
  assert.equal(floored.newA, 100);
  assert.equal(floored.deltaA, 0);
  closeTo(floored.newB, 150 + 32 * (1 - expectedScore(150, 100)), 1e-9);
  closeTo(floored.deltaB, 32 * (1 - expectedScore(150, 100)), 1e-9);
  // A near-certain loss at the floor still cannot push the rating under 100.
  const crushed = computeNewRatings(100, 2000, 'B_WINS');
  assert.equal(crushed.newA, 100);
  assert.equal(crushed.deltaA, 0);
  // Even a sub-floor input cannot end below the floor after a loss.
  const subFloor = computeNewRatings(90, 90, 'B_WINS');
  assert.equal(subFloor.newA, 100);
  assert.equal(subFloor.newB, 106);
});

test('computeNewRatings rejects an unknown outcome instead of silently drawing', () => {
  assert.throws(() => computeNewRatings(1000, 1000, 'X_WINS'), /outcome/);
});

// --- users.rating migration --------------------------------------------------

test('fresh database users table includes rating and guests start at 1000', () => {
  const db = createDatabase(':memory:');
  const columns = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
  assert.ok(columns.includes('rating'));
  const user = createGuest(db);
  assert.equal(user.rating, 1000);
  db.close();
});

test('initDb migrates a legacy users table without rating, backfilling 1000', () => {
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
    INSERT INTO users (uuid, username, coins) VALUES ('legacy-elo', 'Legacy_Elo', 0);
  `);

  initDb(db);
  const columns = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
  assert.ok(columns.includes('rating'));
  const user = db.prepare("SELECT * FROM users WHERE username = 'Legacy_Elo'").get();
  assert.equal(user.rating, 1000);
  db.close();
});

// --- settlement rating updates ------------------------------------------------

test('played reward-eligible win: winner 1016, loser 984 for equal 1000 starts', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const winner = await guest(runtime);
  const loser = await guest(runtime);
  assert.equal(ratingOf(runtime, winner.user.id), 1000);
  assert.equal(ratingOf(runtime, loser.user.id), 1000);

  const completed = settlePlayedWin(runtime, 'ELO_WIN', winner, loser);
  assert.equal(completed.room.state.seriesWinner, 'X');
  assert.equal(runtime.roomManager.getRoom('ELO_WIN').settled, true);
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS count FROM series_results').get().count, 1);
  assert.equal(ratingOf(runtime, winner.user.id), 1016);
  assert.equal(ratingOf(runtime, loser.user.id), 984);
});

test('played reward-eligible draw leaves equal ratings unchanged', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const x = await guest(runtime);
  const o = await guest(runtime);
  const room = settlePlayedDraw(runtime, 'ELO_DRAW', x, o);
  assert.equal(room.state.seriesWinner, 'Draw');
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS count FROM series_results').get().count, 1);
  assert.equal(ratingOf(runtime, x.user.id), 1000);
  assert.equal(ratingOf(runtime, o.user.id), 1000);
});

test('played win shifts unequal ratings by the exact Elo deltas', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const winner = await guest(runtime);
  const loser = await guest(runtime);
  runtime.db.prepare('UPDATE users SET rating = 800 WHERE id = ?').run(loser.user.id);

  settlePlayedWin(runtime, 'ELO_UNEQUAL', winner, loser);
  const expectedDelta = 32 * (1 - expectedScore(1000, 800));
  closeTo(ratingOf(runtime, winner.user.id), 1000 + expectedDelta, 0.001);
  closeTo(ratingOf(runtime, loser.user.id), 800 - expectedDelta, 0.001);
  const winnerRow = runtime.db.prepare('SELECT rating FROM users WHERE id = ?').get(winner.user.id);
  const loserRow = runtime.db.prepare('SELECT rating FROM users WHERE id = ?').get(loser.user.id);
  assert.ok(Math.abs((winnerRow.rating - 1000) + (loserRow.rating - 800)) < 1e-6);
});

test('private (non-reward-eligible) played series never changes ratings', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const winner = await guest(runtime);
  const loser = await guest(runtime);
  runtime.roomManager.createRoom('ELO_PRIVATE', { size: 3, rounds: 1 });
  runtime.roomManager.joinRoom('ELO_PRIVATE', { userId: winner.user.id, socketId: 'p-x', username: winner.user.username });
  runtime.roomManager.joinRoom('ELO_PRIVATE', { userId: loser.user.id, socketId: 'p-o', username: loser.user.username });
  runtime.roomManager.makeMove('ELO_PRIVATE', 0, winner.user.id, 'p-x');
  runtime.roomManager.makeMove('ELO_PRIVATE', 3, loser.user.id, 'p-o');
  runtime.roomManager.makeMove('ELO_PRIVATE', 1, winner.user.id, 'p-x');
  runtime.roomManager.makeMove('ELO_PRIVATE', 4, loser.user.id, 'p-o');
  runtime.roomManager.makeMove('ELO_PRIVATE', 2, winner.user.id, 'p-x');
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS count FROM series_results').get().count, 1);
  assert.equal(ratingOf(runtime, winner.user.id), 1000);
  assert.equal(ratingOf(runtime, loser.user.id), 1000);
});

test('disconnect forfeit in a reward-eligible room leaves ratings unchanged', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const winner = await guest(runtime);
  const forfeiter = await guest(runtime);
  runtime.roomManager.createRoom('ELO_DISC', { size: 3, rounds: 1 }, { rewardEligible: true });
  runtime.roomManager.joinRoom('ELO_DISC', { userId: winner.user.id, socketId: 'd-x', username: winner.user.username });
  runtime.roomManager.joinRoom('ELO_DISC', { userId: forfeiter.user.id, socketId: 'd-o', username: forfeiter.user.username });
  runtime.roomManager.disconnect('d-o');
  runtime.roomManager.resolveDisconnectTimeouts(0);
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS count FROM series_results').get().count, 1);
  assert.equal(ratingOf(runtime, winner.user.id), 1000);
  assert.equal(ratingOf(runtime, forfeiter.user.id), 1000);
});

test('voluntary forfeit in a reward-eligible room leaves ratings unchanged', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const forfeiter = await guest(runtime);
  const winner = await guest(runtime);
  runtime.roomManager.createRoom('ELO_VOL', { size: 3, rounds: 3 }, { rewardEligible: true });
  runtime.roomManager.joinRoom('ELO_VOL', { userId: forfeiter.user.id, socketId: 'v-x', username: forfeiter.user.username });
  runtime.roomManager.joinRoom('ELO_VOL', { userId: winner.user.id, socketId: 'v-o', username: winner.user.username });
  const left = runtime.roomManager.leaveRoom('ELO_VOL', forfeiter.user.id, 'v-x');
  assert.equal(left.room.state.seriesWinner, 'O');
  assert.equal(ratingOf(runtime, forfeiter.user.id), 1000);
  assert.equal(ratingOf(runtime, winner.user.id), 1000);
});

test('a settled series applies the rating change exactly once', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const winner = await guest(runtime);
  const loser = await guest(runtime);
  const completed = settlePlayedWin(runtime, 'ELO_ONCE', winner, loser);
  assert.equal(completed.room.state.seriesWinner, 'X');
  assert.equal(runtime.roomManager.getRoom('ELO_ONCE').settled, true);
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS count FROM series_results').get().count, 1);
  assert.equal(ratingOf(runtime, winner.user.id), 1016);
  assert.equal(ratingOf(runtime, loser.user.id), 984);
  // The completed room rejects further moves, so no second settlement can occur.
  const extra = runtime.roomManager.makeMove('ELO_ONCE', 8, winner.user.id, 'ELO_ONCE-x');
  assert.equal(extra.error, 'Game is not active');
  assert.equal(ratingOf(runtime, winner.user.id), 1016);
  assert.equal(ratingOf(runtime, loser.user.id), 984);
});

// --- leaderboard --------------------------------------------------------------

test('GET /api/leaderboard returns rating and orders by rating desc, excluding AI_Bot', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const low = await guest(runtime);
  const high = await guest(runtime);
  const mid = await guest(runtime);
  runtime.db.prepare('UPDATE users SET rating = 1300, xp = 120 WHERE id = ?').run(mid.user.id);
  runtime.db.prepare('UPDATE users SET rating = 1500 WHERE id = ?').run(high.user.id);
  runtime.db.prepare("INSERT INTO users (uuid, username, rating) VALUES ('ai-bot-elo', 'AI_Bot', 99999)").run();

  const response = await request(runtime.app).get('/api/leaderboard');
  assert.equal(response.status, 200);
  const usernames = response.body.map((row) => row.username);
  assert.deepEqual(usernames, [high.user.username, mid.user.username, low.user.username]);
  for (const row of response.body) {
    assert.equal(typeof row.rating, 'number');
    for (const field of ['username', 'avatar', 'xp', 'level', 'wins', 'rating']) {
      assert.ok(field in row, `leaderboard row missing ${field}`);
    }
  }
  assert.equal(response.body.find((row) => row.username === high.user.username).rating, 1500);
});
