const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createDatabase } = require('../database');
const { createRuntime } = require('../app');

const testConfig = {
  nodeEnv: 'test',
  jwtSecret: 'tournament-cancel-test-secret',
  jwtExpiresIn: '1h',
  databasePath: ':memory:',
  corsOrigins: ['http://localhost'],
  paystackSecretKey: '',
  publicAppUrl: 'http://localhost',
};

function createTestRuntime() {
  return createRuntime({ config: testConfig, database: createDatabase(':memory:'), startTimers: false });
}

async function guest(runtime) {
  const response = await request(runtime.app).post('/api/auth/guest').send({});
  assert.equal(response.status, 201);
  return response.body;
}

async function createTournament(runtime, session) {
  const response = await request(runtime.app)
    .post('/api/tournaments')
    .set('Authorization', `Bearer ${session.token}`);
  assert.equal(response.status, 201);
  return response.body;
}

async function joinTournament(runtime, session, tournamentId) {
  const response = await request(runtime.app)
    .post(`/api/tournaments/${tournamentId}/join`)
    .set('Authorization', `Bearer ${session.token}`);
  return response;
}

async function cancelTournament(runtime, session, tournamentId) {
  return request(runtime.app)
    .post(`/api/tournaments/${tournamentId}/cancel`)
    .set('Authorization', `Bearer ${session.token}`);
}

test('creator cancels an open tournament', async () => {
  const runtime = createTestRuntime();
  const creator = await guest(runtime);
  const created = await createTournament(runtime, creator);
  const response = await cancelTournament(runtime, creator, created.tournament.id);
  assert.equal(response.status, 200);
  assert.equal(response.body.tournament.status, 'cancelled');
  assert.ok(response.body.tournament.completed_at);
});

test('open tournament cancelled by creator is gone from the active block', async () => {
  const runtime = createTestRuntime();
  const creator = await guest(runtime);
  const created = await createTournament(runtime, creator);
  await cancelTournament(runtime, creator, created.tournament.id);
  // A new tournament is now allowed (previously 409 TOURNAMENT_EXISTS).
  const second = await createTournament(runtime, creator);
  assert.equal(second.tournament.status, 'open');
});

test('non-creator cannot cancel (403 NOT_CREATOR)', async () => {
  const runtime = createTestRuntime();
  const creator = await guest(runtime);
  const other = await guest(runtime);
  const created = await createTournament(runtime, creator);
  const response = await cancelTournament(runtime, other, created.tournament.id);
  assert.equal(response.status, 403);
  assert.equal(response.body.code, 'NOT_CREATOR');
  const detail = await request(runtime.app)
    .get(`/api/tournaments/${created.tournament.id}`)
    .set('Authorization', `Bearer ${creator.token}`);
  assert.equal(detail.body.tournament.status, 'open');
});

test('creator cancels an in-progress (filled) tournament', async () => {
  const runtime = createTestRuntime();
  const sessions = [await guest(runtime)];
  const created = await createTournament(runtime, sessions[0]);
  for (let i = 0; i < 7; i += 1) {
    sessions.push(await guest(runtime));
    await joinTournament(runtime, sessions[i + 1], created.tournament.id);
  }
  const before = runtime.db.prepare('SELECT status FROM tournaments WHERE id = ?').get(created.tournament.id);
  assert.equal(before.status, 'in_progress');
  const response = await cancelTournament(runtime, sessions[0], created.tournament.id);
  assert.equal(response.status, 200);
  assert.equal(response.body.tournament.status, 'cancelled');
});

test('cancel deletes materialized match rooms', async () => {
  const runtime = createTestRuntime();
  const sessions = [await guest(runtime)];
  const created = await createTournament(runtime, sessions[0]);
  for (let i = 0; i < 7; i += 1) {
    sessions.push(await guest(runtime));
    await joinTournament(runtime, sessions[i + 1], created.tournament.id);
  }
  const match = runtime.db.prepare('SELECT * FROM tournament_matches WHERE tournament_id = ? AND round = 1 ORDER BY pairing LIMIT 1').get(created.tournament.id);
  const { roomId } = runtime.tournamentService.ensureMatchRoom({ matchId: match.id, userId: sessions[0].user.id });
  assert.ok(runtime.roomManager.getRoom(roomId), 'room materialized before cancel');
  await cancelTournament(runtime, sessions[0], created.tournament.id);
  assert.ok(!runtime.roomManager.getRoom(roomId), 'room deleted after cancel');
  assert.equal(runtime.db.prepare('SELECT status FROM tournaments WHERE id = ?').get(created.tournament.id).status, 'cancelled');
});

test('cancelling an already-completed tournament is rejected (409)', async () => {
  const runtime = createTestRuntime();
  const sessions = [await guest(runtime)];
  const created = await createTournament(runtime, sessions[0]);
  for (let i = 0; i < 7; i += 1) {
    sessions.push(await guest(runtime));
    await joinTournament(runtime, sessions[i + 1], created.tournament.id);
  }
  // Force completion directly (reward path is covered by tournaments.test.js).
  runtime.db.prepare('UPDATE tournaments SET status = ?, completed_at = ? WHERE id = ?')
    .run('complete', new Date().toISOString(), created.tournament.id);
  const response = await cancelTournament(runtime, sessions[0], created.tournament.id);
  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'TOURNAMENT_NOT_CANCELLABLE');
});

test('cancel on a cancelled tournament is rejected (409)', async () => {
  const runtime = createTestRuntime();
  const creator = await guest(runtime);
  const created = await createTournament(runtime, creator);
  await cancelTournament(runtime, creator, created.tournament.id);
  const second = await cancelTournament(runtime, creator, created.tournament.id);
  assert.equal(second.status, 409);
  assert.equal(second.body.code, 'TOURNAMENT_NOT_CANCELLABLE');
});

test('cancel unknown tournament is 404', async () => {
  const runtime = createTestRuntime();
  const creator = await guest(runtime);
  const response = await cancelTournament(runtime, creator, 'DOESNOTEXIST');
  assert.equal(response.status, 404);
  assert.equal(response.body.code, 'TOURNAMENT_NOT_FOUND');
});

test('cancel requires auth (401)', async () => {
  const runtime = createTestRuntime();
  const response = await request(runtime.app).post('/api/tournaments/ANY/cancel').send({});
  assert.equal(response.status, 401);
});
