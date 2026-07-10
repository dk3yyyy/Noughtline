const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { io: createClient } = require('socket.io-client');
const { createDatabase } = require('../database');
const { createRuntime } = require('../app');

const testConfig = {
  nodeEnv: 'test',
  jwtSecret: 'socket-game-test-secret',
  jwtExpiresIn: '1h',
  databasePath: ':memory:',
  corsOrigins: ['http://localhost'],
  paystackSecretKey: '',
  publicAppUrl: 'http://localhost',
};

function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function emitAckWithin(socket, event, payload, timeout = 1_000) {
  return new Promise((resolve, reject) => {
    socket.timeout(timeout).emit(event, payload, (error, response) => {
      if (error) reject(error);
      else resolve(response);
    });
  });
}

async function newSession(runtime) {
  return (await request(runtime.app).post('/api/auth/guest')).body;
}

test('disconnect forfeit rewards only the remaining player', async (t) => {
  const runtime = createRuntime({ config: testConfig, database: createDatabase(':memory:'), startTimers: false });
  t.after(() => runtime.db.close());
  const first = await newSession(runtime);
  const second = await newSession(runtime);
  runtime.roomManager.createRoom('ROOM_FORFEIT', { size: 3, rounds: 1 }, { rewardEligible: true });
  runtime.roomManager.joinRoom('ROOM_FORFEIT', { userId: first.user.id, socketId: 'a', username: first.user.username });
  runtime.roomManager.joinRoom('ROOM_FORFEIT', { userId: second.user.id, socketId: 'b', username: second.user.username });
  runtime.roomManager.disconnect('b');
  const [resolved] = runtime.roomManager.resolveDisconnectTimeouts(0);
  assert.equal(resolved.room.state.seriesWinner, 'X');
  const winner = runtime.db.prepare('SELECT wins, coins, xp FROM users WHERE id = ?').get(first.user.id);
  const forfeiter = runtime.db.prepare('SELECT losses, coins, xp FROM users WHERE id = ?').get(second.user.id);
  assert.deepEqual(winner, { wins: 1, coins: 10, xp: 50 });
  assert.deepEqual(forfeiter, { losses: 1, coins: 0, xp: 0 });
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS count FROM currency_ledger').get().count, 1);
});

test('private rooms persist results but cannot mint progression or currency', async (t) => {
  const runtime = createRuntime({ config: testConfig, database: createDatabase(':memory:'), startTimers: false });
  t.after(() => runtime.db.close());
  const first = await newSession(runtime);
  const second = await newSession(runtime);
  runtime.roomManager.createRoom('ROOM_PRIVATE', { size: 3, rounds: 1 });
  runtime.roomManager.joinRoom('ROOM_PRIVATE', { userId: first.user.id, socketId: 'a', username: first.user.username });
  runtime.roomManager.joinRoom('ROOM_PRIVATE', { userId: second.user.id, socketId: 'b', username: second.user.username });
  runtime.roomManager.disconnect('b');
  runtime.roomManager.resolveDisconnectTimeouts(0);
  const users = runtime.db.prepare('SELECT wins, losses, draws, coins, xp FROM users ORDER BY id').all();
  assert.deepEqual(users, [
    { wins: 0, losses: 0, draws: 0, coins: 0, xp: 0 },
    { wins: 0, losses: 0, draws: 0, coins: 0, xp: 0 },
  ]);
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS count FROM currency_ledger').get().count, 0);
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS count FROM series_results').get().count, 1);
});

test('authenticated socket series persists once and grants server-side rewards', async (t) => {
  const runtime = createRuntime({ config: testConfig, database: createDatabase(':memory:'), startTimers: false });
  await new Promise((resolve) => runtime.server.listen(0, resolve));
  const url = `http://127.0.0.1:${runtime.server.address().port}`;
  const first = await newSession(runtime);
  const second = await newSession(runtime);
  const a = createClient(url, { auth: { token: first.token }, transports: ['websocket'], reconnection: false });
  const b = createClient(url, { auth: { token: second.token }, transports: ['websocket'], reconnection: false });
  await Promise.all([
    new Promise((resolve, reject) => { a.on('connect', resolve); a.on('connect_error', reject); }),
    new Promise((resolve, reject) => { b.on('connect', resolve); b.on('connect_error', reject); }),
  ]);
  t.after(async () => {
    a.close();
    b.close();
    await new Promise((resolve) => runtime.io.close(resolve));
    await new Promise((resolve) => runtime.server.close(resolve));
    runtime.db.close();
  });

  const created = await emitAck(a, 'create_room', { roomId: 'ROOM_E2E', config: { size: 3, rounds: 1 } });
  assert.equal(created.room.players.length, 1);
  runtime.roomManager.getRoom('ROOM_E2E').rewardEligible = true;
  const joined = await emitAck(b, 'join_room', { roomId: 'ROOM_E2E' });
  assert.equal(joined.room.state.status, 'active');

  const invalid = await emitAck(a, 'make_move', { roomId: 'ROOM_E2E', index: 99 });
  assert.equal(invalid.error, 'Invalid move index');
  assert.equal(runtime.roomManager.getRoom('ROOM_E2E').state.board.length, 9);

  await emitAck(a, 'make_move', { roomId: 'ROOM_E2E', index: 0 });
  await emitAck(b, 'make_move', { roomId: 'ROOM_E2E', index: 3 });
  await emitAck(a, 'make_move', { roomId: 'ROOM_E2E', index: 1 });
  await emitAck(b, 'make_move', { roomId: 'ROOM_E2E', index: 4 });
  const completed = await emitAck(a, 'make_move', { roomId: 'ROOM_E2E', index: 2 });
  assert.equal(completed.room.state.status, 'complete');
  assert.equal(completed.room.state.seriesWinner, 'X');

  const winner = await request(runtime.app).get('/api/me').set('Authorization', `Bearer ${first.token}`);
  const loser = await request(runtime.app).get('/api/me').set('Authorization', `Bearer ${second.token}`);
  assert.equal(winner.body.wins, 1);
  assert.equal(winner.body.coins, 10);
  assert.equal(winner.body.xp, 50);
  assert.equal(loser.body.losses, 1);
  assert.equal(loser.body.coins, 3);
  assert.equal(loser.body.xp, 15);
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS count FROM series_results').get().count, 1);
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS count FROM currency_ledger').get().count, 2);
});

test('authenticated member can resume a room but a non-member cannot', async (t) => {
  const runtime = createRuntime({ config: testConfig, database: createDatabase(':memory:'), startTimers: false });
  await new Promise((resolve) => runtime.server.listen(0, resolve));
  const url = `http://127.0.0.1:${runtime.server.address().port}`;
  const first = await newSession(runtime);
  const second = await newSession(runtime);
  const outsider = await newSession(runtime);
  const a = createClient(url, { auth: { token: first.token }, transports: ['websocket'], reconnection: false });
  const b = createClient(url, { auth: { token: second.token }, transports: ['websocket'], reconnection: false });
  const c = createClient(url, { auth: { token: outsider.token }, transports: ['websocket'], reconnection: false });
  await Promise.all([a, b, c].map((client) => new Promise((resolve, reject) => {
    client.on('connect', resolve);
    client.on('connect_error', reject);
  })));

  let resumed;
  t.after(async () => {
    a.close();
    b.close();
    c.close();
    resumed?.close();
    await new Promise((resolve) => runtime.io.close(resolve));
    await new Promise((resolve) => runtime.server.close(resolve));
    runtime.db.close();
  });

  await emitAck(a, 'create_room', { roomId: 'ROOM_RESUME', config: { size: 3, rounds: 3 } });
  await emitAck(b, 'join_room', { roomId: 'ROOM_RESUME' });
  runtime.roomManager.disconnect(a.id);

  const denied = await emitAckWithin(c, 'resume_room', { roomId: 'ROOM_RESUME' });
  assert.equal(denied.error, 'No active room to resume');

  resumed = createClient(url, { auth: { token: first.token }, transports: ['websocket'], reconnection: false });
  await new Promise((resolve, reject) => {
    resumed.on('connect', resolve);
    resumed.on('connect_error', reject);
  });
  const result = await emitAckWithin(resumed, 'resume_room', { roomId: 'ROOM_RESUME' });
  assert.equal(result.room.state.status, 'active');
  assert.equal(result.room.state.disconnectDeadline, null);
  assert.equal(result.room.players.find((player) => player.id === first.user.id).connected, true);
});
