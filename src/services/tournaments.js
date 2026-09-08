// Pure formatting + bracket helpers for the Tournaments screens (lobby +
// bracket detail). Kept free of React/DOM so they can be unit-tested with
// node:test (see test/tournaments.client.test.js).
//
// Server payloads (server/tournaments.js):
//   GET  /api/tournaments      -> { tournaments, counts } — tournament rows
//                                 include id, name, status, size, playerCount
//                                 and a `players` array (for the lobby).
//   GET  /api/tournaments/:id  -> { tournament, players, matches } where
//                                 matches is grouped [{ round, matches }] and
//                                 every match row carries the opponent
//                                 usernames/avatars joined in by the server.
//
// Every helper below tolerates BOTH the flat match-list shape and the
// server's grouped { round, matches } shape, so the UI can pass a detail
// payload straight in without pre-flattening.

export const TOURNAMENT_SIZE = 8;

const ROUND_LABELS = Object.freeze({ 1: 'Quarterfinals', 2: 'Semifinals', 3: 'Final' });
const TOURNAMENT_STATUS_LABELS = Object.freeze({
  open: 'Open',
  in_progress: 'In progress',
  complete: 'Completed',
  cancelled: 'Cancelled',
});
const MATCH_STATUS_LABELS = Object.freeze({
  waiting: 'Waiting',
  active: 'Live',
  complete: 'Done',
  cancelled: 'Cancelled',
});

// The client mirrors the server's payout schedule purely for display copy
// (server/tournaments.js REWARDS). Rewards themselves are credited only by
// the server ledger at tournament completion — never by the client.
export const REWARD_TABLE = Object.freeze({
  champion: { coins: 500, gems: 50 },
  runnerUp: { coins: 250, gems: 0 },
  semifinalist: { coins: 100, gems: 0 },
});

const sameUser = (id, userId) => userId != null && String(id ?? '') === String(userId);

// Accepts a players array, a lobby tournament row, or a detail payload.
function asPlayers(input) {
  if (Array.isArray(input)) return input;
  if (input && Array.isArray(input.players)) return input.players;
  return [];
}

// Accepts a flat match array, the server's grouped { round, matches } detail
// shape, or a whole detail payload — always returns a flat match array.
function asMatchList(input) {
  const list = Array.isArray(input) ? input : input && input.matches;
  if (!Array.isArray(list)) return [];
  if (list.length > 0 && Array.isArray(list[0] && list[0].matches)) {
    return list.flatMap((group) => group.matches || []);
  }
  return list;
}

// 1 -> 'Quarterfinals', 2 -> 'Semifinals', 3 -> 'Final', else 'Round N'.
// Anything that is not a positive whole round number returns null.
export function roundLabel(round) {
  const value = Number(round);
  if (!Number.isInteger(value) || value < 1) return null;
  return ROUND_LABELS[value] || `Round ${value}`;
}

export function tournamentStatusLabel(status) {
  return TOURNAMENT_STATUS_LABELS[status] ?? String(status ?? '');
}

export function matchStatusLabel(status) {
  return MATCH_STATUS_LABELS[status] ?? String(status ?? '');
}

export function isTournamentParticipant(players, userId) {
  if (userId == null) return false;
  return asPlayers(players).some((entry) => sameUser(entry.id ?? entry.user_id, userId));
}

// First match (any round) the caller is slotted into as X or O.
export function myMatchId(matches, userId) {
  if (userId == null) return null;
  const list = asMatchList(matches);
  const found = list.find((entry) => sameUser(entry.player_x_id, userId) || sameUser(entry.player_o_id, userId));
  return found ? found.id : null;
}

// { username, avatar } of the opponent in a match row, or null when the
// caller is not a participant or the opponent slot is empty.
export function matchOpponent(match, userId) {
  if (!match || userId == null) return null;
  const isX = sameUser(match.player_x_id, userId);
  const isO = sameUser(match.player_o_id, userId);
  if (!isX && !isO) return null;
  const opponentId = isX ? match.player_o_id : match.player_x_id;
  if (opponentId == null || String(opponentId) === '') return null;
  return {
    username: (isX ? match.player_o_username : match.player_x_username) ?? null,
    avatar: (isX ? match.player_o_avatar : match.player_x_avatar) ?? null,
  };
}

// True when the caller may (and should) enter this match room right now.
export function canEnterMatch({ tournamentStatus, match, userId } = {}) {
  if (tournamentStatus !== 'in_progress' || !match || userId == null) return false;
  if (!['waiting', 'active'].includes(match.status)) return false;
  return sameUser(match.player_x_id, userId) || sameUser(match.player_o_id, userId);
}

// Lobby row action label: 'Join' (open with space), 'Joined' (already in),
// 'Full' (open but at capacity — defensive, the 8th join auto-starts), or
// null when no join action applies (in_progress/complete + not joined).
export function joinButtonLabel(tournament, userId) {
  if (!tournament) return null;
  const players = asPlayers(tournament);
  if (players.some((entry) => sameUser(entry.id ?? entry.user_id, userId))) return 'Joined';
  if (tournament.status !== 'open') return null;
  const size = Number(tournament.size) || TOURNAMENT_SIZE;
  let count = Number(tournament.playerCount);
  if (!Number.isFinite(count) || count < 0) count = players.length;
  return count >= size ? 'Full' : 'Join';
}

// The caller's settled payout, derived from bracket outcomes (client mirror
// of the server's REWARDS schedule), or null when no payout applies yet.
//   champion     — won the final           -> 500 coins + 50 gems
//   runnerUp     — lost the final          -> 250 coins
//   semifinalist — lost in the semifinals  -> 100 coins
// Quarterfinal losers and any unsettled result return null. The UI only
// shows this once the tournament is complete (credits land then server-side).
export function myTournamentReward(matches, userId) {
  if (userId == null) return null;
  const list = asMatchList(matches);
  const final = list.find((entry) => entry.round === 3
    && (sameUser(entry.player_x_id, userId) || sameUser(entry.player_o_id, userId)));
  if (final) {
    if (final.status !== 'complete' || final.winner_id == null) return null;
    return final.winner_id === userId ? { placement: 'champion', ...REWARD_TABLE.champion }
      : { placement: 'runnerUp', ...REWARD_TABLE.runnerUp };
  }
  const semifinalLoss = list.find((entry) => entry.round === 2
    && (sameUser(entry.player_x_id, userId) || sameUser(entry.player_o_id, userId))
    && entry.status === 'complete' && entry.winner_id != null && !sameUser(entry.winner_id, userId));
  if (semifinalLoss) return { placement: 'semifinalist', ...REWARD_TABLE.semifinalist };
  return null;
}

// Single-elimination rule: a completed match the caller lost means they are
// out. Winners (and players whose match is still waiting/active) are not
// eliminated — polling continues so a later round can surface.
export function isEliminated(matches, userId) {
  if (userId == null) return false;
  return asMatchList(matches).some((entry) => entry.status === 'complete'
    && entry.winner_id != null
    && (sameUser(entry.player_x_id, userId) || sameUser(entry.player_o_id, userId))
    && !sameUser(entry.winner_id, userId));
}
