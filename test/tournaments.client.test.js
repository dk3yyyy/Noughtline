import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REWARD_TABLE,
  canEnterMatch,
  isEliminated,
  isTournamentParticipant,
  joinButtonLabel,
  matchOpponent,
  matchStatusLabel,
  myMatchId,
  myTournamentReward,
  roundLabel,
  tournamentStatusLabel,
} from '../src/services/tournaments.js';

// Identifiers mirror the server's hex-string user ids.
const ALICE = 'u-alice';
const BOB = 'u-bob';
const CAROL = 'u-carol';
const DAVE = 'u-dave';

const player = (id, seed = 1) => ({ id, seed, username: id.replace('u-', ''), avatar: `https://example/${id}.png` });

// A match row exactly as GET /api/tournaments/:id serves it (flat list usage;
// grouped { round, matches } lists are also accepted by the helpers).
const match = (overrides = {}) => ({
  id: 'm-1',
  round: 1,
  pairing: 1,
  player_x_id: ALICE,
  player_o_id: BOB,
  winner_id: null,
  status: 'waiting',
  room_id: 'TM_ROOM1',
  player_x_username: 'alice',
  player_x_avatar: 'https://example/alice.png',
  player_o_username: 'bob',
  player_o_avatar: 'https://example/bob.png',
  ...overrides,
});

test('roundLabel names the three tournament rounds and falls back to Round N', () => {
  assert.equal(roundLabel(1), 'Quarterfinals');
  assert.equal(roundLabel(2), 'Semifinals');
  assert.equal(roundLabel(3), 'Final');
  assert.equal(roundLabel(4), 'Round 4');
  assert.equal(roundLabel(9), 'Round 9');
  assert.equal(roundLabel('2'), 'Semifinals');
});

test('roundLabel rejects non-round inputs instead of inventing labels', () => {
  assert.equal(roundLabel(0), null);
  assert.equal(roundLabel(-1), null);
  assert.equal(roundLabel(1.5), null);
  assert.equal(roundLabel(null), null);
  assert.equal(roundLabel(undefined), null);
  assert.equal(roundLabel('x'), null);
});

test('tournamentStatusLabel maps the four server statuses and passes unknown through raw', () => {
  assert.equal(tournamentStatusLabel('open'), 'Open');
  assert.equal(tournamentStatusLabel('in_progress'), 'In progress');
  assert.equal(tournamentStatusLabel('complete'), 'Completed');
  assert.equal(tournamentStatusLabel('cancelled'), 'Cancelled');
  assert.equal(tournamentStatusLabel('weird_state'), 'weird_state');
  assert.equal(tournamentStatusLabel(undefined), '');
});

test('matchStatusLabel maps waiting/active/complete/cancelled for match cards', () => {
  assert.equal(matchStatusLabel('waiting'), 'Waiting');
  assert.equal(matchStatusLabel('active'), 'Live');
  assert.equal(matchStatusLabel('complete'), 'Done');
  assert.equal(matchStatusLabel('cancelled'), 'Cancelled');
  assert.equal(matchStatusLabel('resolved'), 'resolved');
  assert.equal(matchStatusLabel(null), '');
});

test('isTournamentParticipant finds the user in either players shape (id or user_id)', () => {
  const players = [player(ALICE, 1), player(BOB, 2)];
  assert.equal(isTournamentParticipant(players, ALICE), true);
  assert.equal(isTournamentParticipant(players, BOB), true);
  assert.equal(isTournamentParticipant(players, CAROL), false);
  // Whole detail payload works too (players list under the detail).
  assert.equal(isTournamentParticipant({ players }, ALICE), true);
  // Legacy server alias user_id is tolerated.
  assert.equal(isTournamentParticipant([{ user_id: CAROL, seed: 3 }], CAROL), true);
  assert.equal(isTournamentParticipant(players, 42), false);
  assert.equal(isTournamentParticipant([], ALICE), false);
  assert.equal(isTournamentParticipant(null, ALICE), false);
  assert.equal(isTournamentParticipant(players, undefined), false);
});

test('myMatchId finds the caller in X or O slots across rounds, on flat or grouped lists', () => {
  const flat = [
    match({ id: 'm1', player_x_id: BOB, player_o_id: ALICE }),
    match({ id: 'm2', round: 2, player_x_id: CAROL, player_o_id: DAVE }),
  ];
  assert.equal(myMatchId(flat, ALICE), 'm1'); // O slot of m1
  assert.equal(myMatchId(flat, BOB), 'm1'); // X slot of m1
  assert.equal(myMatchId(flat, CAROL), 'm2');
  assert.equal(myMatchId(flat, DAVE), 'm2');
  assert.equal(myMatchId(flat, 'nobody'), null);
  // Grouped shape served by GET /api/tournaments/:id is accepted directly.
  assert.equal(myMatchId({ matches: [{ round: 1, matches: [match({ id: 'm9', player_x_id: DAVE })] }] }, DAVE), 'm9');
  assert.equal(myMatchId([], ALICE), null);
  assert.equal(myMatchId(null, ALICE), null);
  assert.equal(myMatchId(flat, undefined), null);
});

test('matchOpponent returns the other participant with username/avatar from the joined row', () => {
  const row = match({ player_x_id: ALICE, player_o_id: BOB });
  assert.deepEqual(matchOpponent(row, ALICE), { username: 'bob', avatar: 'https://example/bob.png' });
  assert.deepEqual(matchOpponent(row, BOB), { username: 'alice', avatar: 'https://example/alice.png' });
  assert.equal(matchOpponent(row, CAROL), null);
  assert.equal(matchOpponent(row, null), null);
  assert.equal(matchOpponent(null, ALICE), null);
});

test('matchOpponent is null when the opponent slot is empty, even for a participant', () => {
  const row = match({ player_x_id: ALICE, player_o_id: null, player_o_username: null, player_o_avatar: null });
  assert.equal(matchOpponent(row, ALICE), null);
});

test('canEnterMatch gates on tournament in_progress + waiting/active match + participant', () => {
  const row = match({ player_x_id: ALICE, player_o_id: BOB, status: 'waiting' });
  assert.equal(canEnterMatch({ tournamentStatus: 'in_progress', match: row, userId: ALICE }), true);
  assert.equal(canEnterMatch({ tournamentStatus: 'in_progress', match: { ...row, status: 'active' }, userId: BOB }), true);
  assert.equal(canEnterMatch({ tournamentStatus: 'open', match: row, userId: ALICE }), false);
  assert.equal(canEnterMatch({ tournamentStatus: 'in_progress', match: { ...row, status: 'complete' }, userId: ALICE }), false);
  assert.equal(canEnterMatch({ tournamentStatus: 'in_progress', match: { ...row, status: 'cancelled' }, userId: ALICE }), false);
  assert.equal(canEnterMatch({ tournamentStatus: 'in_progress', match: row, userId: CAROL }), false);
  assert.equal(canEnterMatch({ tournamentStatus: 'in_progress', match: row, userId: null }), false);
  assert.equal(canEnterMatch({ tournamentStatus: 'in_progress', match: null, userId: ALICE }), false);
  assert.equal(canEnterMatch({ tournamentStatus: 'complete', match: row, userId: ALICE }), false);
});

test('joinButtonLabel drives lobby rows: Join / Joined / Full / no button', () => {
  const open = (playerCount, extra = {}) => ({ status: 'open', size: 8, playerCount, ...extra });
  assert.equal(joinButtonLabel(open(3), ALICE), 'Join');
  assert.equal(joinButtonLabel(open(7), ALICE), 'Join');
  assert.equal(joinButtonLabel(open(8), ALICE), 'Full');
  // Already a participant -> Joined regardless of status.
  assert.equal(joinButtonLabel(open(3, { players: [player(ALICE, 1)] }), ALICE), 'Joined');
  assert.equal(joinButtonLabel({ status: 'in_progress', playerCount: 8 }, ALICE), null);
  assert.equal(joinButtonLabel({ status: 'complete', playerCount: 8, players: [player(ALICE, 1)] }, ALICE), 'Joined');
  // playerCount missing: falls back to the players list length (lobby rows include it).
  assert.equal(joinButtonLabel({ status: 'open', players: [player(ALICE, 1), player(BOB, 2)] }, CAROL), 'Join');
  assert.equal(joinButtonLabel(null, ALICE), null);
});

test('myTournamentReward derives champion / runner-up / semifinalist placement payouts', () => {
  const finalWon = match({ id: 'f1', round: 3, player_x_id: ALICE, player_o_id: BOB, winner_id: ALICE, status: 'complete' });
  assert.deepEqual(myTournamentReward([finalWon], ALICE), { placement: 'champion', coins: 500, gems: 50 });
  assert.deepEqual(myTournamentReward([finalWon], BOB), { placement: 'runnerUp', coins: 250, gems: 0 });

  const sfLost = match({ id: 's1', round: 2, player_x_id: CAROL, player_o_id: DAVE, winner_id: CAROL, status: 'complete' });
  assert.deepEqual(myTournamentReward([sfLost], DAVE), { placement: 'semifinalist', coins: 100, gems: 0 });

  // Quarterfinal loser gets no payout.
  const qfLost = match({ id: 'q1', round: 1, player_x_id: ALICE, player_o_id: BOB, winner_id: BOB, status: 'complete' });
  assert.equal(myTournamentReward([qfLost], ALICE), null);

  // Unsettled final (still waiting/active) pays nobody yet.
  assert.equal(myTournamentReward([match({ id: 'f2', round: 3, player_x_id: ALICE, player_o_id: BOB, status: 'waiting' })], ALICE), null);

  assert.equal(myTournamentReward([], ALICE), null);
  assert.equal(myTournamentReward(null, ALICE), null);
});

test('REWARD_TABLE mirrors the server payout schedule (server/tournaments.js REWARDS)', () => {
  assert.deepEqual(REWARD_TABLE, {
    champion: { coins: 500, gems: 50 },
    runnerUp: { coins: 250, gems: 0 },
    semifinalist: { coins: 100, gems: 0 },
  });
});

test('isEliminated is true only after a completed, lost match involving the user', () => {
  const lost = match({ id: 'q1', player_x_id: ALICE, player_o_id: BOB, winner_id: BOB, status: 'complete' });
  const won = match({ id: 'q2', player_x_id: ALICE, player_o_id: BOB, winner_id: ALICE, status: 'complete' });
  const live = match({ id: 's1', round: 2, player_x_id: ALICE, player_o_id: CAROL, winner_id: null, status: 'active' });
  assert.equal(isEliminated([lost], ALICE), true);
  assert.equal(isEliminated([lost], BOB), false); // winner is still in it
  assert.equal(isEliminated([won], ALICE), false); // won QF, next round may not exist yet
  assert.equal(isEliminated([live], ALICE), false); // a live match is never an elimination
  assert.equal(isEliminated([live], CAROL), false);
  assert.equal(isEliminated([], ALICE), false);
  assert.equal(isEliminated(null, ALICE), false);
  assert.equal(isEliminated([lost], null), false);
});
