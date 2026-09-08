// Tournaments v1 — 8-player single-elimination brackets.
//
// Server-side bracket state machine on top of the existing room lifecycle.
// Match rooms are ordinary RoomManager rooms (single round, 3x3) that are
// auto-created on first entry and settle through the exact same settlement
// path as every other series. Tournament match rooms are created with
// rewardEligible: false, so settlement records a series_results row but never
// mints the normal coins/XP/quest/Elo rewards — tournaments are Elo-neutral
// and pay out ONLY through the explicit tournament reward schedule at the
// end (champion / runnerUp / semifinalist), each credit an idempotent ledger
// entry keyed by `tournament:<id>:<userId>:<currency>`.
//
// Seeding — JOIN ORDER, not rating.
//   Seeds are assigned in join order (first joiner = seed 1 ... eighth = seed
//   8) and round-1 pairs the strongest seeds against the weakest
//   (1v8, 2v7, 3v6, 4v5). The join() signature still accepts a `rating` for
//   API stability but v1 deliberately ignores it: rating-based seeding was
//   considered and cut to keep the v1 surface small and predictable (and to
//   avoid the churn of re-seeding an open lobby as ratings drift). Revisit
//   when tournament v2 lands.
//
// Bracket mapping (mirrored exactly in server/test/tournaments.test.js):
//   Rounds are 1-indexed: round 1 = quarterfinals (4 matches, pairing 1..4),
//   round 2 = semifinals (2, pairing 1..2), round 3 = final (1, pairing 1).
//   Round 1: pairing p pits seed p (X) against seed 9-p (O).
//   Advancement: the winner of round r pairing p (r < 3) advances to round
//   r+1 pairing floor((p-1)/2)+1, taking the X slot when p is odd and the O
//   slot when p is even. Both feeder pairings of a next-round match therefore
//   never collide on a slot. A next-round match row is created only when its
//   entire round has completed.
//
// Walkovers — deterministic, seed-based:
//   Any match with no decisive played winner advances the participant with
//   the LOWER seed number (seed 1 beats seed 8). Applied to:
//     * matches still waiting (room not started) WALKOVER_AFTER_MS after the
//       match row was created,
//     * active rooms that were cancelled (both players disconnected and the
//       disconnect-timeout resolver marked the room match_cancelled — the
//       room manager never fires onSeriesComplete for cancellations),
//     * rooms that settle to a Draw (single-round series with a drawn game).
//   A fully abandoned bracket walks over round by round and eventually crowns
//   a champion; each walkover completes a match row and advances normally, so
//   the state machine is the same in every case. Rooms resolved by walkover
//   are deleted so a late entrant cannot play a ghost game.
//
// Clock: the service takes an injectable now() (default Date.now) — the same
// pattern as quests/economy — and all row timestamps are written from it so
// deadline behavior is deterministic under test. advanceDeadlines() is meant
// to be called from the app.js 1s tick and self-throttles to one scan per
// ADVANCE_MIN_INTERVAL_MS.

const crypto = require('crypto');

const TOURNAMENT_SIZE = 8;
const TOURNAMENT_ROUNDS = 3;
const MATCH_ROOM_PREFIX = 'TM_';
const WALKOVER_AFTER_MS = 10 * 60 * 1000;
const ADVANCE_MIN_INTERVAL_MS = 5000;

const REWARDS = Object.freeze({
  champion: { coins: 500, gems: 50 },
  runnerUp: { coins: 250, gems: 0 },
  semifinalist: { coins: 100, gems: 0 },
});

const randomToken = (bytes) => crypto.randomBytes(bytes).toString('hex').toUpperCase();

const httpError = (message, code, status) => Object.assign(new Error(message), { code, status });

const isoNow = (ms) => new Date(ms).toISOString();

// Service rows are written with ISO-8601 UTC timestamps from the injected
// clock. This parser also tolerates the SQLite CURRENT_TIMESTAMP format
// ('YYYY-MM-DD HH:MM:SS', UTC) for any legacy row that used the column
// default.
function dbTimeToMs(value) {
  const text = String(value || '');
  if (!text) return 0;
  const iso = text.includes('T') ? text : `${text.replace(' ', 'T')}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function createTournamentService({ db, economy, roomManager, now = () => Date.now() }) {
  const getTournamentRow = db.prepare('SELECT * FROM tournaments WHERE id = ?');
  const getMatchRow = db.prepare('SELECT * FROM tournament_matches WHERE id = ?');
  const playerSeed = db.prepare('SELECT seed FROM tournament_players WHERE tournament_id = ? AND user_id = ?');

  // Lower seed number advances: deterministic walkover/decider rule.
  const lowerSeedWinnerId = (match) => {
    const xSeed = playerSeed.get(match.tournament_id, match.player_x_id)?.seed ?? Infinity;
    const oSeed = playerSeed.get(match.tournament_id, match.player_o_id)?.seed ?? Infinity;
    return xSeed <= oSeed ? match.player_x_id : match.player_o_id;
  };

  // Credits one tournament reward. The ledger's UNIQUE(user_id, reference)
  // constraint is the idempotency guard: a second attempt to credit the same
  // placement violates the constraint and is treated as already-paid instead
  // of surfacing (so a re-entrant finalize can never double-mint).
  const credit = (tournamentId, userId, currency, amount, placement) => {
    if (!Number.isSafeInteger(amount) || amount <= 0) return;
    try {
      economy.changeBalance({
        userId,
        currency,
        amount,
        reason: 'tournament_reward',
        reference: `tournament:${tournamentId}:${userId}:${currency}`,
        metadata: { tournamentId, placement },
      });
    } catch (error) {
      if (!(error && error.code === 'SQLITE_CONSTRAINT_UNIQUE')) throw error;
    }
  };

  const standingsRewards = db.transaction((tournamentId, championId, runnerUpId, semifinalistIds, completedAtIso) => {
    const tournament = getTournamentRow.get(tournamentId);
    if (!tournament || tournament.status === 'complete') return;

    const qfLoserRows = db.prepare(`
      SELECT CASE WHEN winner_id = player_x_id THEN player_o_id ELSE player_x_id END AS loser_id
      FROM tournament_matches WHERE tournament_id = ? AND round = 1
    `).all(tournamentId);
    // Everyone who placed 3rd..8th: the two semifinal losers then the four
    // quarterfinal losers. Positions are seeded deterministically (lower seed
    // number = better placement) by ordering this whole group by seed.
    const placementIds = [
      ...semifinalistIds,
      ...qfLoserRows
        .map((row) => row.loser_id)
        .filter((id) => id !== championId && id !== runnerUpId && !semifinalistIds.includes(id)),
    ];
    const ranked = db.prepare(`
      SELECT user_id FROM tournament_players
      WHERE tournament_id = ? AND user_id IN (${placementIds.map(() => '?').join(',')})
      ORDER BY seed
    `).all(tournamentId, ...placementIds);
    const setPosition = db.prepare('UPDATE tournament_players SET position = ? WHERE tournament_id = ? AND user_id = ?');
    ranked.forEach((row, index) => setPosition.run(index + 3, tournamentId, row.user_id));
    setPosition.run(1, tournamentId, championId);
    setPosition.run(2, tournamentId, runnerUpId);

    db.prepare("UPDATE tournaments SET status = 'complete', completed_at = ? WHERE id = ?").run(completedAtIso, tournamentId);

    credit(tournamentId, championId, 'coins', REWARDS.champion.coins, 'champion');
    credit(tournamentId, championId, 'gems', REWARDS.champion.gems, 'champion');
    credit(tournamentId, runnerUpId, 'coins', REWARDS.runnerUp.coins, 'runnerUp');
    for (const id of semifinalistIds) credit(tournamentId, id, 'coins', REWARDS.semifinalist.coins, 'semifinalist');
  });

  // Completes one match (winnerId) and, when the whole round is done, either
  // creates the next round or finalizes the tournament + pays rewards. Fully
  // transactional and re-entrant: a match already complete is a no-op, so
  // double settlement (played result racing a walkover) can never double-credit.
  const completeMatchAndAdvance = db.transaction((matchId, winnerId, completedAtMs = now()) => {
    const match = getMatchRow.get(matchId);
    if (!match || match.status === 'complete') return false;
    const completedAtIso = isoNow(completedAtMs);
    db.prepare(`
      UPDATE tournament_matches SET winner_id = ?, status = 'complete', completed_at = ?
      WHERE id = ? AND status != 'complete'
    `).run(winnerId, completedAtIso, matchId);

    const roundCounts = db.prepare(`
      SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END), 0) AS done
      FROM tournament_matches WHERE tournament_id = ? AND round = ?
    `).get(match.tournament_id, match.round);
    if (roundCounts.done < roundCounts.total) return true;

    if (match.round >= TOURNAMENT_ROUNDS) {
      const finalMatch = getMatchRow.get(matchId);
      const championId = finalMatch.winner_id;
      const runnerUpId = finalMatch.player_x_id === championId ? finalMatch.player_o_id : finalMatch.player_x_id;
      const semifinalRows = db.prepare('SELECT * FROM tournament_matches WHERE tournament_id = ? AND round = 2').all(match.tournament_id);
      const semifinalistIds = semifinalRows.map((row) => (row.winner_id === row.player_x_id ? row.player_o_id : row.player_x_id));
      standingsRewards(match.tournament_id, championId, runnerUpId, semifinalistIds, completedAtIso);
      return true;
    }

    const existingNext = db.prepare('SELECT 1 FROM tournament_matches WHERE tournament_id = ? AND round = ? LIMIT 1')
      .get(match.tournament_id, match.round + 1);
    if (existingNext) return true;

    const nextRound = match.round + 1;
    const insertMatch = db.prepare(`
      INSERT INTO tournament_matches (id, tournament_id, round, pairing, player_x_id, player_o_id, room_id, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting', ?)
    `);
    for (let q = 1; q <= roundCounts.total / 2; q += 1) {
      const xFeeder = db.prepare('SELECT winner_id FROM tournament_matches WHERE tournament_id = ? AND round = ? AND pairing = ?')
        .get(match.tournament_id, match.round, 2 * q - 1);
      const oFeeder = db.prepare('SELECT winner_id FROM tournament_matches WHERE tournament_id = ? AND round = ? AND pairing = ?')
        .get(match.tournament_id, match.round, 2 * q);
      insertMatch.run(
        randomToken(6),
        match.tournament_id,
        nextRound,
        q,
        xFeeder.winner_id,
        oFeeder.winner_id,
        `${MATCH_ROOM_PREFIX}${randomToken(12)}`,
        isoNow(completedAtMs),
      );
    }
    return true;
  });

  const startTournament = db.transaction((tournamentId, startedAtIso) => {
    db.prepare("UPDATE tournaments SET status = 'in_progress', started_at = ? WHERE id = ? AND status = 'open'")
      .run(startedAtIso, tournamentId);
    const seeds = db.prepare('SELECT user_id, seed FROM tournament_players WHERE tournament_id = ? ORDER BY seed').all(tournamentId);
    const insertMatch = db.prepare(`
      INSERT INTO tournament_matches (id, tournament_id, round, pairing, player_x_id, player_o_id, room_id, status, created_at)
      VALUES (?, ?, 1, ?, ?, ?, ?, 'waiting', ?)
    `);
    for (let p = 1; p <= TOURNAMENT_SIZE / 2; p += 1) {
      const xSeed = seeds.find((row) => row.seed === p);
      const oSeed = seeds.find((row) => row.seed === TOURNAMENT_SIZE + 1 - p);
      insertMatch.run(
        randomToken(6),
        tournamentId,
        p,
        xSeed.user_id,
        oSeed.user_id,
        `${MATCH_ROOM_PREFIX}${randomToken(12)}`,
        startedAtIso,
      );
    }
  });

  const participantCount = db.prepare('SELECT COUNT(*) AS count FROM tournament_players WHERE tournament_id = ?');

  // Materializes the match room in the RoomManager (idempotent) and returns
  // the room id the client should socket join_room with.
  function ensureMatchRoom({ matchId, userId } = {}) {
    const match = getMatchRow.get(matchId);
    if (!match) throw httpError('Match not found', 'MATCH_NOT_FOUND', 404);
    const tournament = getTournamentRow.get(match.tournament_id);
    if (!tournament) throw httpError('Tournament not found', 'TOURNAMENT_NOT_FOUND', 404);
    if (tournament.status !== 'in_progress') {
      throw httpError('Tournament is not in progress', 'TOURNAMENT_NOT_OPEN', 409);
    }
    if (userId !== match.player_x_id && userId !== match.player_o_id) {
      throw httpError('You are not a participant of this match', 'NOT_MATCH_PARTICIPANT', 403);
    }
    if (match.status !== 'waiting' && match.status !== 'active') {
      throw httpError('Match has already been resolved', 'MATCH_NOT_READY', 409);
    }
    const existing = match.room_id ? roomManager.getRoom(match.room_id) : null;
    if (existing) return { roomId: existing.id };

    if (!match.player_x_id || !match.player_o_id) {
      throw httpError('Match is missing a player', 'MATCH_NOT_READY', 409);
    }
    const xUser = db.prepare('SELECT username, avatar FROM users WHERE id = ?').get(match.player_x_id);
    const oUser = db.prepare('SELECT username, avatar FROM users WHERE id = ?').get(match.player_o_id);
    if (!xUser || !oUser) throw httpError('Match is missing a player', 'MATCH_NOT_READY', 409);

    const roomId = match.room_id || `${MATCH_ROOM_PREFIX}${randomToken(12)}`;
    const created = roomManager.createRoom(roomId, { size: 3, rounds: 1 }, { rewardEligible: false });
    const room = created.error ? roomManager.getRoom(roomId) : roomManager.getRoom(created.room.id);
    if (!room) throw httpError('Could not create match room', 'MATCH_NOT_READY', 409);

    const present = new Set(room.players.map((player) => player.id));
    if (!present.has(match.player_x_id)) {
      room.players.push({
        id: match.player_x_id,
        socketId: null,
        connected: false,
        username: xUser.username,
        avatar: xUser.avatar,
        symbol: 'X',
      });
    }
    if (!present.has(match.player_o_id)) {
      room.players.push({
        id: match.player_o_id,
        socketId: null,
        connected: false,
        username: oUser.username,
        avatar: oUser.avatar,
        symbol: 'O',
      });
    }
    room.updatedAt = now();
    db.prepare("UPDATE tournament_matches SET room_id = ?, status = 'active' WHERE id = ? AND status IN ('waiting', 'active')")
      .run(room.id, match.id);
    return { roomId: room.id };
  }

  // Invoked by app.js AFTER a TM_ room's settlement transaction commits (the
  // wrapper only reaches here when settleSeries succeeded). Maps the played
  // result onto the bracket: winner symbol -> match row, then completes the
  // match and advances. Cancelled rooms never reach here (the room manager
  // does not fire onSeriesComplete for cancellations) — advanceDeadlines()
  // resolves those.
  function afterSeriesComplete(room) {
    const roomId = String((room && room.id) || '').toUpperCase();
    if (!roomId.startsWith(MATCH_ROOM_PREFIX)) return false;
    const match = db.prepare('SELECT * FROM tournament_matches WHERE room_id = ?').get(roomId);
    if (!match || match.status === 'complete') return false;
    const state = (room && room.state) || {};
    let winnerId = null;
    if (state.status === 'cancelled' || state.seriesWinner === 'Draw' || !state.seriesWinner) {
      winnerId = lowerSeedWinnerId(match);
    } else {
      winnerId = state.seriesWinner === 'X' ? match.player_x_id : match.player_o_id;
      if (!winnerId) winnerId = lowerSeedWinnerId(match);
    }
    return completeMatchAndAdvance(match.id, winnerId);
  }

  // Scans in_progress tournaments for stalled matches and resolves them by
  // walkover (see the header design notes). Called from the app.js 1s tick.
  let lastAdvanceMs = 0;
  function advanceDeadlines() {
    const currentMs = now();
    if (currentMs - lastAdvanceMs < ADVANCE_MIN_INTERVAL_MS) return;
    lastAdvanceMs = currentMs;

    const stalled = db.prepare(`
      SELECT tm.* FROM tournament_matches tm
      JOIN tournaments t ON t.id = tm.tournament_id
      WHERE t.status = 'in_progress' AND tm.status IN ('waiting', 'active')
      ORDER BY tm.round ASC, tm.pairing ASC
    `).all();
    for (const match of stalled) {
      const room = match.room_id ? roomManager.getRoom(match.room_id) : null;
      if (room && room.state.status === 'cancelled') {
        // Both players disconnected and the grace period elapsed; the room
        // manager marks the room cancelled without any settlement callback.
        completeMatchAndAdvance(match.id, lowerSeedWinnerId(match), currentMs);
        roomManager.deleteRoom(room.id);
        continue;
      }
      if (room && !['waiting', 'paused'].includes(room.state.status)) continue;
      if (room && room.roundHistory.length > 0) continue; // play started: disconnect grace owns it
      if (dbTimeToMs(match.created_at) + WALKOVER_AFTER_MS > currentMs) continue;
      // Nobody ever started this match inside the window: walk it over.
      completeMatchAndAdvance(match.id, lowerSeedWinnerId(match), currentMs);
      if (room) roomManager.deleteRoom(room.id);
    }
  }

  // create({userId}) — a tournament is created open with its creator
  // pre-registered as seed 1. Only one open/in_progress tournament exists at
  // a time in v1.
  function create({ userId } = {}) {
    const exists = db.prepare("SELECT 1 FROM tournaments WHERE status IN ('open', 'in_progress') LIMIT 1").get();
    if (exists) throw httpError('A tournament is already open or in progress', 'TOURNAMENT_EXISTS', 409);
    const tournamentId = randomToken(6);
    const createdAtIso = isoNow(now());
    db.transaction(() => {
      db.prepare(`
        INSERT INTO tournaments (id, name, status, size, created_by, created_at)
        VALUES (?, ?, 'open', ?, ?, ?)
      `).run(tournamentId, `Tournament #${tournamentId}`, TOURNAMENT_SIZE, userId, createdAtIso);
      db.prepare('INSERT INTO tournament_players (tournament_id, user_id, seed, joined_at) VALUES (?, ?, 1, ?)')
        .run(tournamentId, userId, createdAtIso);
    })();
    return get(tournamentId);
  }

  function list() {
    const rows = db.prepare(`
      SELECT t.*, (SELECT COUNT(*) FROM tournament_players tp WHERE tp.tournament_id = t.id) AS player_count
      FROM tournaments t ORDER BY t.created_at DESC LIMIT 20
    `).all();
    const playersStmt = db.prepare(`
      SELECT tp.user_id AS id, tp.seed, tp.position, u.username, u.avatar
      FROM tournament_players tp JOIN users u ON u.id = tp.user_id
      WHERE tp.tournament_id = ? ORDER BY tp.seed
    `);
    const tournaments = rows.map(({ player_count: playerCount, ...tournament }) => ({
      ...tournament,
      playerCount,
      players: playersStmt.all(tournament.id),
    }));
    const counts = db.prepare('SELECT status, COUNT(*) AS count FROM tournaments GROUP BY status').all();
    const statusCounts = { open: 0, in_progress: 0, complete: 0, cancelled: 0 };
    for (const row of counts) statusCounts[row.status] = row.count;
    return { tournaments, counts: statusCounts };
  }

  function get(id) {
    const tournament = getTournamentRow.get(id);
    if (!tournament) throw httpError('Tournament not found', 'TOURNAMENT_NOT_FOUND', 404);
    const players = db.prepare(`
      SELECT tp.user_id AS id, tp.seed, tp.position, tp.joined_at, u.username, u.avatar
      FROM tournament_players tp JOIN users u ON u.id = tp.user_id
      WHERE tp.tournament_id = ? ORDER BY tp.seed
    `).all(id);
    const matchRows = db.prepare(`
      SELECT tm.*,
             x.username AS player_x_username, x.avatar AS player_x_avatar,
             o.username AS player_o_username, o.avatar AS player_o_avatar,
             w.username AS winner_username
      FROM tournament_matches tm
      LEFT JOIN users x ON x.id = tm.player_x_id
      LEFT JOIN users o ON o.id = tm.player_o_id
      LEFT JOIN users w ON w.id = tm.winner_id
      WHERE tm.tournament_id = ? ORDER BY tm.round ASC, tm.pairing ASC
    `).all(id);
    const matches = [];
    for (const row of matchRows) {
      const bucket = matches.find((entry) => entry.round === row.round);
      if (bucket) bucket.matches.push(row);
      else matches.push({ round: row.round, matches: [row] });
    }
    return {
      tournament: { ...tournament, playerCount: players.length },
      players,
      matches,
    };
  }

  // join({tournamentId, userId}) — adds a player. The 8th registration
  // auto-starts the tournament inside the same transaction (status flips to
  // in_progress and the four round-1 matches are created). `rating` is
  // accepted for API stability and intentionally unused (see header note on
  // join-order seeding).
  function join({ tournamentId, userId, rating: _rating } = {}) {
    db.transaction(() => {
      const tournament = getTournamentRow.get(tournamentId);
      if (!tournament) throw httpError('Tournament not found', 'TOURNAMENT_NOT_FOUND', 404);
      if (tournament.status !== 'open') throw httpError('Tournament is not open for registration', 'TOURNAMENT_NOT_OPEN', 409);
      const already = db.prepare('SELECT 1 FROM tournament_players WHERE tournament_id = ? AND user_id = ?').get(tournamentId, userId);
      if (already) throw httpError('You already joined this tournament', 'ALREADY_JOINED', 409);
      const seed = participantCount.get(tournamentId).count + 1;
      if (seed > TOURNAMENT_SIZE) throw httpError('Tournament is not open for registration', 'TOURNAMENT_NOT_OPEN', 409);
      const joinedAtIso = isoNow(now());
      db.prepare('INSERT INTO tournament_players (tournament_id, user_id, seed, joined_at) VALUES (?, ?, ?, ?)')
        .run(tournamentId, userId, seed, joinedAtIso);
      if (seed === TOURNAMENT_SIZE) startTournament(tournamentId, joinedAtIso);
    })();
    return get(tournamentId);
  }

  return {
    create,
    list,
    get,
    join,
    ensureMatchRoom,
    afterSeriesComplete,
    advanceDeadlines,
  };
}

module.exports = {
  TOURNAMENT_SIZE,
  TOURNAMENT_ROUNDS,
  MATCH_ROOM_PREFIX,
  WALKOVER_AFTER_MS,
  REWARDS,
  createTournamentService,
};
