const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createDatabase } = require('../database');
const { createRuntime } = require('../app');
const { createTournamentService, WALKOVER_AFTER_MS, TOURNAMENT_ROUNDS } = require('../tournaments');

const testConfig = {
  nodeEnv: 'test',
  jwtSecret: 'tournaments-test-secret',
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

// Eight fresh guests + a created tournament filled to auto-start. The creator
// is seed 1 and guests join in order, so sessions[i] holds seed i+1.
async function filledTournament(runtime) {
  const sessions = [await guest(runtime)];
  const created = await createTournament(runtime, sessions[0]);
  for (let i = 0; i < 7; i += 1) {
    sessions.push(await guest(runtime));
    const joined = await joinTournament(runtime, sessions[i + 1], created.tournament.id);
    assert.equal(joined.status, 200);
  }
  return { sessions, tournamentId: created.tournament.id };
}

const matchesInRound = (runtime, tournamentId, round) => runtime.db.prepare(`
  SELECT * FROM tournament_matches WHERE tournament_id = ? AND round = ? ORDER BY pairing
`).all(tournamentId, round);

// X (player_x_id) plays a 1-round series to a win through the real room
// lifecycle: the room is auto-created via ensureMatchRoom, both pre-registered
// players connect over the reconnect path, then X wins 3-0.
function settleMatchAsX(runtime, match, xSession, oSession) {
  const { roomId } = runtime.tournamentService.ensureMatchRoom({ matchId: match.id, userId: xSession.user.id });
  const room = runtime.roomManager.getRoom(roomId);
  assert.ok(room, 'match room should be materialized on entry');
  assert.equal(room.players.length, 2);
  runtime.roomManager.joinRoom(roomId, { userId: xSession.user.id, socketId: `${roomId}-x`, username: xSession.user.username });
  runtime.roomManager.joinRoom(roomId, { userId: oSession.user.id, socketId: `${roomId}-o`, username: oSession.user.username });
  runtime.roomManager.makeMove(roomId, 0, xSession.user.id, `${roomId}-x`);
  runtime.roomManager.makeMove(roomId, 3, oSession.user.id, `${roomId}-o`);
  runtime.roomManager.makeMove(roomId, 1, xSession.user.id, `${roomId}-x`);
  runtime.roomManager.makeMove(roomId, 4, oSession.user.id, `${roomId}-o`);
  const completed = runtime.roomManager.makeMove(roomId, 2, xSession.user.id, `${roomId}-x`);
  assert.equal(completed.room.state.seriesWinner, 'X');
  return completed.room;
}

const tournamentRewardRows = (runtime, tournamentId) => runtime.db.prepare(`
  SELECT user_id, currency, amount, reference FROM currency_ledger WHERE reference LIKE ?
  ORDER BY reference
`).all(`tournament:${tournamentId}:%`);

test('tournament endpoints require a signed session', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  assert.equal((await request(runtime.app).get('/api/tournaments')).status, 401);
  assert.equal((await request(runtime.app).post('/api/tournaments')).status, 401);
  assert.equal((await request(runtime.app).get('/api/tournaments/whatever')).status, 401);
  assert.equal((await request(runtime.app).post('/api/tournaments/whatever/join')).status, 401);
  assert.equal((await request(runtime.app).post('/api/tournaments/whatever/matches/whatever/enter')).status, 401);
});

test('create opens a tournament with the creator pre-registered as seed 1; a second create conflicts', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const session = await guest(runtime);
  const first = await createTournament(runtime, session);
  assert.equal(first.tournament.status, 'open');
  assert.equal(first.tournament.size, 8);
  assert.match(first.tournament.name, /^Tournament #/);
  assert.equal(first.tournament.playerCount, 1);
  assert.equal(first.players.length, 1);
  assert.deepEqual(
    { id: first.players[0].id, seed: first.players[0].seed, username: first.players[0].username },
    { id: session.user.id, seed: 1, username: session.user.username },
  );

  const conflict = await request(runtime.app)
    .post('/api/tournaments')
    .set('Authorization', `Bearer ${(await guest(runtime)).token}`);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, 'TOURNAMENT_EXISTS');
});

test('joining 8 players fills and auto-starts with the 1v8/2v7/3v6/4v5 bracket', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const { sessions, tournamentId } = await filledTournament(runtime);

  const detail = (await request(runtime.app).get(`/api/tournaments/${tournamentId}`).set('Authorization', `Bearer ${sessions[0].token}`)).body;
  assert.equal(detail.tournament.status, 'in_progress');
  assert.ok(detail.tournament.started_at);
  assert.deepEqual(detail.players.map((player) => player.seed), [1, 2, 3, 4, 5, 6, 7, 8]);

  const round1 = matchesInRound(runtime, tournamentId, 1);
  assert.equal(round1.length, 4);
  const pairings = round1.map((match) => [match.player_x_id, match.player_o_id, match.pairing, match.status]);
  const expected = [[1, 2, 3, 4].map((seed) => sessions[seed - 1].user.id)];
  assert.deepEqual(
    pairings,
    [
      [expected[0][0], sessions[7].user.id, 1, 'waiting'],
      [expected[0][1], sessions[6].user.id, 2, 'waiting'],
      [expected[0][2], sessions[5].user.id, 3, 'waiting'],
      [expected[0][3], sessions[4].user.id, 4, 'waiting'],
    ],
  );
  for (const match of round1) {
    assert.match(match.id, /^[A-F0-9]{12}$/);
    assert.match(match.room_id, /^TM_[A-F0-9]{24}$/);
  }
  assert.equal(matchesInRound(runtime, tournamentId, 2).length, 0);
  assert.equal(matchesInRound(runtime, tournamentId, 3).length, 0);
});

test('duplicate join conflicts while open; join after start conflicts', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const creator = await guest(runtime);
  const created = await createTournament(runtime, creator);
  const second = await guest(runtime);
  await joinTournament(runtime, second, created.tournament.id);

  const duplicate = await joinTournament(runtime, second, created.tournament.id);
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, 'ALREADY_JOINED');

  const unknown = await request(runtime.app)
    .post('/api/tournaments/DOESNOTEXIST/join')
    .set('Authorization', `Bearer ${creator.token}`);
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.code, 'TOURNAMENT_NOT_FOUND');
});

test('a player cannot join after the tournament auto-started', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const { tournamentId } = await filledTournament(runtime);
  const late = await guest(runtime);
  const afterStart = await joinTournament(runtime, late, tournamentId);
  assert.equal(afterStart.status, 409);
  assert.equal(afterStart.body.code, 'TOURNAMENT_NOT_OPEN');
});

test('enter auto-creates the match room with both players pre-registered and is idempotent', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const { sessions, tournamentId } = await filledTournament(runtime);
  const [match] = matchesInRound(runtime, tournamentId, 1);

  const firstEnter = await request(runtime.app)
    .post(`/api/tournaments/${tournamentId}/matches/${match.id}/enter`)
    .set('Authorization', `Bearer ${sessions[0].token}`);
  assert.equal(firstEnter.status, 200);
  const { roomId } = firstEnter.body;
  assert.equal(roomId, match.room_id);

  const room = runtime.roomManager.getRoom(roomId);
  assert.ok(room);
  assert.equal(room.rewardEligible, false);
  assert.equal(room.config.rounds, 1);
  assert.equal(room.players.length, 2);
  const bySymbol = Object.fromEntries(room.players.map((player) => [player.symbol, player]));
  assert.equal(bySymbol.X.id, sessions[0].user.id);
  assert.equal(bySymbol.O.id, sessions[7].user.id);
  for (const player of room.players) {
    assert.equal(player.connected, false);
    assert.equal(player.socketId, null);
    assert.equal(typeof player.username, 'string');
  }
  assert.equal(runtime.db.prepare('SELECT status FROM tournament_matches WHERE id = ?').get(match.id).status, 'active');

  const secondEnter = await request(runtime.app)
    .post(`/api/tournaments/${tournamentId}/matches/${match.id}/enter`)
    .set('Authorization', `Bearer ${sessions[7].token}`);
  assert.equal(secondEnter.status, 200);
  assert.equal(secondEnter.body.roomId, roomId);
  assert.equal(runtime.roomManager.getRoom(roomId).players.length, 2);

  const nonParticipant = await request(runtime.app)
    .post(`/api/tournaments/${tournamentId}/matches/${match.id}/enter`)
    .set('Authorization', `Bearer ${sessions[4].token}`);
  assert.equal(nonParticipant.status, 403);
  assert.equal(nonParticipant.body.code, 'NOT_MATCH_PARTICIPANT');

  const unknownMatch = await request(runtime.app)
    .post(`/api/tournaments/${tournamentId}/matches/NOPE/enter`)
    .set('Authorization', `Bearer ${sessions[0].token}`);
  assert.equal(unknownMatch.status, 404);
  assert.equal(unknownMatch.body.code, 'MATCH_NOT_FOUND');
});

test('full played bracket settles through roomManager: standings, rewards, no Elo or normal rewards', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const { sessions, tournamentId } = await filledTournament(runtime);

  let completedRooms = [];
  for (let round = 1; round <= TOURNAMENT_ROUNDS; round += 1) {
    const matches = matchesInRound(runtime, tournamentId, round);
    assert.equal(matches.length, [4, 2, 1][round - 1], `round ${round} should have its matches`);
    const roundRooms = [];
    for (const match of matches) {
      const seedOf = (userId) => runtime.db.prepare('SELECT seed FROM tournament_players WHERE tournament_id = ? AND user_id = ?').get(tournamentId, userId).seed;
      roundRooms.push(settleMatchAsX(runtime, match, sessions[seedOf(match.player_x_id) - 1], sessions[seedOf(match.player_o_id) - 1]));
    }
    completedRooms = completedRooms.concat(roundRooms);
  }

  const detail = (await request(runtime.app).get(`/api/tournaments/${tournamentId}`).set('Authorization', `Bearer ${sessions[0].token}`)).body;
  assert.equal(detail.tournament.status, 'complete');
  assert.ok(detail.tournament.completed_at);

  const seedById = (id) => detail.players.find((player) => player.id === id).seed;
  const positionById = (id) => detail.players.find((player) => player.id === id).position;
  const champion = detail.matches.find((entry) => entry.round === 3).matches[0].winner_id;
  assert.equal(champion, sessions[0].user.id, 'seed 1 wins every X match and the final');
  assert.deepEqual(detail.players.map((player) => player.position), [1, 3, 2, 4, 5, 6, 7, 8]);
  assert.equal(positionById(champion), 1);
  const runnerUp = detail.players.find((player) => player.position === 2).id;
  assert.equal(runnerUp, sessions[2].user.id, 'seed 3 loses the final');
  const semifinalists = detail.players.filter((player) => player.position === 3 || player.position === 4).map((player) => player.id).sort();
  assert.deepEqual(semifinalists, [sessions[1].user.id, sessions[3].user.id].sort(), 'seeds 2 and 4 lose the semifinals');
  assert.equal(seedById(runnerUp), 3);

  // X wins each match: seeds 1..4 beat seeds 5..8 in round 1, so every round-1
  // loser sits at seed 5..8 — the round-1 matches confirm it.
  const round1 = detail.matches.find((entry) => entry.round === 1).matches;
  for (const match of round1) assert.equal(seedById(match.winner_id), match.pairing);

  // Reward accounting: exactly five tournament ledger rows, nothing else.
  const rewards = tournamentRewardRows(runtime, tournamentId);
  assert.equal(rewards.length, 5);
  const expect = [
    { userId: sessions[0].user.id, currency: 'coins', amount: 500 },
    { userId: sessions[0].user.id, currency: 'gems', amount: 50 },
    { userId: sessions[2].user.id, currency: 'coins', amount: 250 },
    { userId: sessions[1].user.id, currency: 'coins', amount: 100 },
    { userId: sessions[3].user.id, currency: 'coins', amount: 100 },
  ].sort((a, b) => (a.userId - b.userId) || a.currency.localeCompare(b.currency));
  assert.deepEqual(
    rewards.map((row) => ({ userId: row.user_id, currency: row.currency, amount: row.amount })).sort((a, b) => (a.userId - b.userId) || a.currency.localeCompare(b.currency)),
    expect,
  );
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS count FROM currency_ledger').get().count, 5, 'tournament matches mint no normal rewards');

  const balances = (userId) => runtime.db.prepare('SELECT coins, gems FROM users WHERE id = ?').get(userId);
  assert.deepEqual(balances(sessions[0].user.id), { coins: 500, gems: 150 });
  assert.deepEqual(balances(sessions[2].user.id), { coins: 250, gems: 100 });
  assert.deepEqual(balances(sessions[1].user.id), { coins: 100, gems: 100 });
  assert.deepEqual(balances(sessions[4].user.id), { coins: 0, gems: 100 });

  // Elo-neutral: nobody's rating moved and no series minted quests.
  for (const session of sessions) {
    assert.equal(runtime.db.prepare('SELECT rating FROM users WHERE id = ?').get(session.user.id).rating, 1000);
  }
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS count FROM series_results').get().count, 7, 'each played match records a series result');
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS count FROM quest_progress').get().count, 0);

  // Re-delivering a completed room (or replaying settlement) never double-credits.
  const lastRoom = completedRooms[completedRooms.length - 1];
  assert.equal(runtime.tournamentService.afterSeriesComplete(lastRoom), false);
  assert.equal(tournamentRewardRows(runtime, tournamentId).length, 5);
  assert.equal(runtime.db.prepare('SELECT status FROM tournaments WHERE id = ?').get(tournamentId).status, 'complete');
});

test('waiting matches past the walkover deadline advance by lower seed; bracket continues to completion', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const { sessions, tournamentId } = await filledTournament(runtime);
  const round1 = matchesInRound(runtime, tournamentId, 1);

  // Play round-1 pairings 2..4 to completion; pairing 1 is never entered.
  for (const match of round1.slice(1)) {
    const xSeed = runtime.db.prepare('SELECT seed FROM tournament_players WHERE tournament_id = ? AND user_id = ?').get(tournamentId, match.player_x_id).seed;
    const oSeed = runtime.db.prepare('SELECT seed FROM tournament_players WHERE tournament_id = ? AND user_id = ?').get(tournamentId, match.player_o_id).seed;
    settleMatchAsX(runtime, match, sessions[xSeed - 1], sessions[oSeed - 1]);
  }

  // A clock-injected service walks deadlines deterministically against the
  // same db/roomManager (mirrors the quest service clock pattern).
  let clockMs = Date.now();
  const clocked = createTournamentService({
    db: runtime.db,
    economy: runtime.economy,
    roomManager: runtime.roomManager,
    now: () => clockMs,
  });
  clockMs += WALKOVER_AFTER_MS + 60_000;
  clocked.advanceDeadlines();

  const p1 = runtime.db.prepare('SELECT * FROM tournament_matches WHERE id = ?').get(round1[0].id);
  assert.equal(p1.status, 'complete');
  assert.equal(p1.winner_id, sessions[0].user.id, 'walkover awards the lower seed (1 beats 8)');
  assert.ok(p1.completed_at);

  const round2 = matchesInRound(runtime, tournamentId, 2);
  assert.equal(round2.length, 2, 'round completes after the walkover and advances');
  assert.equal(round2[0].player_x_id, sessions[0].user.id, 'seed 1 holds the X slot of semi 1');
  assert.equal(round2[0].player_o_id, sessions[1].user.id, 'seed 2 holds the O slot of semi 1');
  assert.equal(round2[1].player_x_id, sessions[2].user.id);
  assert.equal(round2[1].player_o_id, sessions[3].user.id);
  assert.equal(runtime.db.prepare('SELECT status FROM tournaments WHERE id = ?').get(tournamentId).status, 'in_progress');

  // Walk the rest of the bracket over: semis then final, then rewards pay out
  // to the walkover survivors (champion stays seed 1).
  clockMs += WALKOVER_AFTER_MS + 60_000;
  clocked.advanceDeadlines();
  assert.equal(runtime.db.prepare('SELECT status FROM tournaments WHERE id = ?').get(tournamentId).status, 'in_progress');
  assert.equal(matchesInRound(runtime, tournamentId, 3).length, 1);
  clockMs += WALKOVER_AFTER_MS + 60_000;
  clocked.advanceDeadlines();
  assert.equal(runtime.db.prepare('SELECT status FROM tournaments WHERE id = ?').get(tournamentId).status, 'complete');

  const rewards = tournamentRewardRows(runtime, tournamentId);
  assert.equal(rewards.length, 5);
  assert.deepEqual(
    runtime.db.prepare('SELECT coins, gems FROM users WHERE id = ?').get(sessions[0].user.id),
    { coins: 500, gems: 150 },
  );
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS count FROM series_results').get().count, 3, 'only the three played matches recorded results');
});

test('a cancelled match room (both players disconnect) resolves via the walkover rule', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const { sessions, tournamentId } = await filledTournament(runtime);
  const [match] = matchesInRound(runtime, tournamentId, 1);

  const { roomId } = runtime.tournamentService.ensureMatchRoom({ matchId: match.id, userId: sessions[0].user.id });
  runtime.roomManager.joinRoom(roomId, { userId: sessions[0].user.id, socketId: 'c-x', username: sessions[0].user.username });
  runtime.roomManager.joinRoom(roomId, { userId: sessions[7].user.id, socketId: 'c-o', username: sessions[7].user.username });
  runtime.roomManager.disconnectAll('c-x');
  runtime.roomManager.disconnectAll('c-o');
  const [resolved] = runtime.roomManager.resolveDisconnectTimeouts(0);
  assert.equal(resolved.room.state.status, 'cancelled');
  assert.equal(resolved.room.state.completionReason, 'match_cancelled');

  // The room manager never fires onSeriesComplete for cancellations, so the
  // deadline scanner is what resolves the match — immediately, no age needed.
  runtime.tournamentService.advanceDeadlines();
  const row = runtime.db.prepare('SELECT * FROM tournament_matches WHERE id = ?').get(match.id);
  assert.equal(row.status, 'complete');
  assert.equal(row.winner_id, sessions[0].user.id, 'cancelled match awards the lower seed');
  assert.equal(runtime.roomManager.getRoom(roomId), undefined, 'resolved room is deleted');
  assert.equal(runtime.db.prepare('SELECT status FROM tournaments WHERE id = ?').get(tournamentId).status, 'in_progress');
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS count FROM currency_ledger').get().count, 0);
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS count FROM series_results').get().count, 0);
});

test('list and detail expose participants with usernames and grouped bracket state', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const { sessions, tournamentId } = await filledTournament(runtime);

  const listResponse = await request(runtime.app).get('/api/tournaments').set('Authorization', `Bearer ${sessions[0].token}`);
  assert.equal(listResponse.status, 200);
  assert.equal(listResponse.body.counts.open, 0);
  assert.equal(listResponse.body.counts.in_progress, 1);
  const listed = listResponse.body.tournaments.find((entry) => entry.id === tournamentId);
  assert.equal(listed.playerCount, 8);
  assert.equal(listed.players.length, 8);
  assert.equal(listed.players[0].username, sessions[0].user.username);
  assert.deepEqual(listed.players.map((player) => player.seed), [1, 2, 3, 4, 5, 6, 7, 8]);

  const detailResponse = await request(runtime.app).get(`/api/tournaments/${tournamentId}`).set('Authorization', `Bearer ${sessions[0].token}`);
  assert.equal(detailResponse.status, 200);
  const detail = detailResponse.body;
  assert.equal(detail.tournament.status, 'in_progress');
  assert.deepEqual(detail.matches.map((bucket) => bucket.round), [1]);
  const round1 = detail.matches[0].matches;
  assert.equal(round1.length, 4);
  assert.equal(round1[0].player_x_username, sessions[0].user.username);
  assert.equal(round1[0].player_o_username, sessions[7].user.username);
  assert.equal(typeof round1[0].player_x_avatar, 'string');
  assert.equal(round1[0].status, 'waiting');
  assert.equal(round1[0].winner_id, null);

  const missing = await request(runtime.app).get('/api/tournaments/NOPE').set('Authorization', `Bearer ${sessions[0].token}`);
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, 'TOURNAMENT_NOT_FOUND');
});
