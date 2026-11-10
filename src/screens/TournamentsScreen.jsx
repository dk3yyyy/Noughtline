import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/client';
import { httpErrorMessage } from '../services/errors';
import {
  REWARD_TABLE, canEnterMatch, isEliminated, isTournamentParticipant, joinButtonLabel,
  matchOpponent, matchStatusLabel, myTournamentReward, nextMatchForPlayer, roundLabel,
  tournamentStatusLabel,
} from '../services/tournaments';
import {Avatar, Chip, Dialog, Empty, ErrorNote, Loading} from '../ui.jsx';
import { AlertTriangle, ChevronLeft, Crown, Trophy, Users, X } from 'lucide-react';

const POLL_MS = 4000;
const DEFAULT_SIZE = 8;
const EMPTY_COUNTS = { open: 0, in_progress: 0, complete: 0, cancelled: 0 };
const fallbackAvatar = (seed) => `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(seed || 'player')}`;
const sameUser = (id, userId) => userId != null && String(id ?? '') === String(userId);

const errorText = (error, fallback) => httpErrorMessage(error, fallback);

export default function TournamentsScreen({ userId, notify, onEnterMatch, onExit, initialId = null, onRefreshUser }) {
  const uidRef = useRef(userId);
  useEffect(() => { uidRef.current = userId; }, [userId]);
  const lobbyAbortRef = useRef(null);

  const [lobby, setLobby] = useState([]);
  const [counts, setCounts] = useState(EMPTY_COUNTS);
  const [lobbyLoading, setLobbyLoading] = useState(true);
  const [lobbyError, setLobbyError] = useState('');
  const [detailId, setDetailId] = useState(initialId);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [busy, setBusy] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => { if (initialId) setDetailId(initialId); }, [initialId]);

  const loadLobby = useCallback(async (signal) => {
    const uid = uidRef.current;
    if (!uid) return;
    if (!signal) {
      if (lobbyAbortRef.current) lobbyAbortRef.current.abort();
      const controller = new AbortController();
      lobbyAbortRef.current = controller;
      signal = controller.signal;
    }
    setLobbyLoading(true);
    setLobbyError('');
    try {
      const { data } = await api.get('/api/tournaments', { signal });
      if (signal.aborted || uidRef.current !== uid) return;
      setLobby(Array.isArray(data?.tournaments) ? data.tournaments : []);
      setCounts({ ...EMPTY_COUNTS, ...(data?.counts || {}) });
    } catch (error) {
      if (error?.code === 'ERR_CANCELED' || signal.aborted || uidRef.current !== uid) return;
      setLobbyError('Could not load tournaments. Check your connection and try again.');
    } finally {
      if (!signal.aborted && uidRef.current === uid) setLobbyLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!userId) return undefined;
    setLobby([]);
    setCounts(EMPTY_COUNTS);
    setLobbyError('');
    setDetail(null);
    setDetailError('');
    setBusy('');
    const controller = new AbortController();
    lobbyAbortRef.current = controller;
    loadLobby(controller.signal);
    return () => {
      controller.abort();
      if (lobbyAbortRef.current && lobbyAbortRef.current !== controller) lobbyAbortRef.current.abort();
    };
  }, [userId, loadLobby]);

  const playerList = Array.isArray(detail?.players) ? detail.players : [];
  const participant = isTournamentParticipant(playerList, userId);
  const flattened = useMemo(() => {
    if (!Array.isArray(detail?.matches)) return [];
    return detail.matches.flatMap((group) => (Array.isArray(group?.matches) ? group.matches : []));
  }, [detail]);
  const eliminated = isEliminated(flattened, userId);
  // Polling is decided from the last payload, but it must never be an effect
  // dependency of the reset below: a true -> detail=null -> false cycle would
  // refetch forever and trip the server rate limit.
  const shouldPoll = Boolean(detailId && participant && !eliminated
    && (detail?.tournament?.status === 'in_progress' || detail?.tournament?.status === 'open'));

  const loadDetail = useCallback(async (signal) => {
    if (!detailId) return;
    const uid = uidRef.current;
    try {
      const { data } = await api.get(`/api/tournaments/${encodeURIComponent(detailId)}`, { signal });
      if (signal?.aborted || uidRef.current !== uid) return;
      setDetail(data);
      setDetailError('');
    } catch (error) {
      if (error?.code === 'ERR_CANCELED' || signal?.aborted || uidRef.current !== uid) return;
      setDetailError(error?.response?.status === 404
        ? 'This tournament no longer exists.'
        : 'Could not load the tournament — retrying…');
    } finally {
      if (!signal?.aborted && uidRef.current === uid) setDetailLoading(false);
    }
  }, [detailId]);

  // Load once per selected bracket. Changing the bracket — and only that —
  // clears the old payload.
  useEffect(() => {
    if (!detailId || !userId) return undefined;
    const controller = new AbortController();
    setDetail(null);
    setDetailLoading(true);
    setDetailError('');
    loadDetail(controller.signal);
    return () => controller.abort();
  }, [detailId, userId, loadDetail]);

  // Poll only while the caller is still alive in an open or running bracket.
  // Starting the interval never clears the payload, so the view does not flash
  // to "Loading" every four seconds.
  useEffect(() => {
    if (!shouldPoll || !detailId || !userId) return undefined;
    const controller = new AbortController();
    const timer = window.setInterval(() => loadDetail(controller.signal), POLL_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [shouldPoll, detailId, userId, loadDetail]);

  // The lobby is shared state: keep it fresh while it is visible so another
  // player's bracket and seat count appear without a manual reload.
  useEffect(() => {
    if (!userId) return undefined;
    const timer = window.setInterval(() => loadLobby(), 15000);
    return () => window.clearInterval(timer);
  }, [userId, loadLobby]);

  const tournament = detail?.tournament || null;
  const status = tournament?.status;
  const flatMatches = flattened;
  const players = playerList;
  const joinedCount = players.length || Number(tournament?.playerCount) || 0;
  const size = Number(tournament?.size) || DEFAULT_SIZE;
  const isCreator = tournament && sameUser(tournament.created_by, userId);

  const openDetail = (id) => setDetailId(id);
  const closeDetail = () => {
    setDetailId(null);
    setDetail(null);
    setDetailError('');
    loadLobby();
  };

  const createTournament = async () => {
    if (busy) return;
    const uid = uidRef.current;
    setBusy('create');
    try {
      const { data } = await api.post('/api/tournaments');
      if (uidRef.current !== uid) return;
      notify('Bracket created — you are seed 1. Players join from the lobby.', 'success');
      if (data?.tournament) {
        setDetail(data);
        setDetailId(data.tournament.id);
      }
      loadLobby();
    } catch (error) {
      if (uidRef.current !== uid) return;
      notify(errorText(error, 'Could not create a tournament right now.'), 'error');
      loadLobby();
    } finally {
      if (uidRef.current === uid) setBusy('');
    }
  };

  const joinTournament = async (id) => {
    if (busy || !id) return;
    const uid = uidRef.current;
    setBusy(`join:${id}`);
    try {
      const { data } = await api.post(`/api/tournaments/${encodeURIComponent(id)}/join`);
      if (uidRef.current !== uid) return;
      const started = data?.tournament?.status === 'in_progress';
      notify(started
        ? 'You joined — the bracket filled and the tournament has started.'
        : 'Joined. The bracket starts automatically when all 8 seats fill.', 'success');
      setDetail(data);
      setDetailId(id);
      loadLobby();
    } catch (error) {
      if (uidRef.current !== uid) return;
      notify(errorText(error, 'Could not join the tournament right now.'), 'error');
    } finally {
      if (uidRef.current === uid) setBusy('');
    }
  };

  const cancelTournament = async () => {
    if (!detailId || busy) return;
    const uid = uidRef.current;
    setBusy('cancel');
    try {
      const { data } = await api.post(`/api/tournaments/${encodeURIComponent(detailId)}/cancel`);
      if (uidRef.current !== uid) return;
      setDetail(data);
      setConfirmCancel(false);
      notify('Tournament cancelled. No prizes were awarded.', 'info');
      loadLobby();
    } catch (error) {
      if (uidRef.current !== uid) return;
      notify(errorText(error, 'Could not cancel the tournament.'), 'error');
      setConfirmCancel(false);
    } finally {
      if (uidRef.current === uid) setBusy('');
    }
  };

  const enterMatch = async (matchId) => {
    if (busy || !detailId || !matchId) return;
    const uid = uidRef.current;
    setBusy('enter');
    try {
      const { data } = await api.post(`/api/tournaments/${encodeURIComponent(detailId)}/matches/${encodeURIComponent(matchId)}/enter`);
      if (uidRef.current !== uid) return;
      const roomId = data?.roomId;
      if (!roomId) {
        notify('The match room could not be opened. Try again.', 'error');
        return;
      }
      const result = await onEnterMatch(roomId, detailId);
      if (uidRef.current !== uid) return;
      if (result?.error) {
        if (!['ACTIVE_ROOM_EXISTS', 'RATE_LIMITED'].includes(result.code)) {
          notify(errorText(result, 'Could not join the match room.'), 'error');
        }
        return;
      }
      notify('Match room open — good luck.', 'success');
      onRefreshUser?.();
    } catch (error) {
      if (uidRef.current !== uid) return;
      notify(errorText(error, 'Could not enter the match right now. Try again.'), 'error');
    } finally {
      if (uidRef.current === uid) setBusy('');
    }
  };

  const myMatch = nextMatchForPlayer(flatMatches, userId);
  const myMatchReady = canEnterMatch({ tournamentStatus: status, match: myMatch, userId });
  const myOpponent = myMatch && matchOpponent(myMatch, userId);
  const myReward = myTournamentReward(flatMatches, userId);
  const finalMatch = flatMatches.find((row) => Number(row.round) === 3 && row.status === 'complete') || null;
  const champion = finalMatch?.winner_id
    ? players.find((entry) => sameUser(entry.id, finalMatch.winner_id)) || null
    : null;
  const wonRows = flatMatches.filter((row) => row.status === 'complete' && sameUser(row.winner_id, userId));
  const lastWin = wonRows.sort((a, b) => Number(a.round) - Number(b.round)).at(-1) || null;
  const lost = flatMatches.find((row) => row.status === 'complete' && sameUser(row.player_x_id, userId) && sameUser(row.winner_id, row.player_o_id))
    || flatMatches.find((row) => row.status === 'complete' && sameUser(row.player_o_id, userId) && sameUser(row.winner_id, row.player_x_id))
    || null;

  if (!detailId) {
    const canCreate = !counts.open && !counts.in_progress;
    return (
      <div className="screen tournaments-screen">
        <header className="screen-head">
          <div>
            <h1>Tournaments</h1>
            <p className="screen-sub">One 8-player knockout at a time. Join order seeds the bracket; winners advance automatically.</p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onExit}>
            <ChevronLeft size={16} aria-hidden="true" /> Back home
          </button>
        </header>

        <div className="tournament-prizes" aria-label="Prize schedule">
          <div className="prize"><span className="prize-place"><Crown size={15} aria-hidden="true" /> Champion</span><span className="prize-value num">{REWARD_TABLE.champion.coins} coins · {REWARD_TABLE.champion.gems} gems</span></div>
          <div className="prize"><span className="prize-place">Runner-up</span><span className="prize-value num">{REWARD_TABLE.runnerUp.coins} coins</span></div>
          <div className="prize"><span className="prize-place">Semifinalist</span><span className="prize-value num">{REWARD_TABLE.semifinalist.coins} coins</span></div>
        </div>

        {canCreate && !lobbyLoading && (
          <section className="panel create-panel" aria-labelledby="create-title">
            <div>
              <h2 id="create-title" className="panel-title">Start a bracket</h2>
              <p className="panel-sub">You take seed 1. Seven players join from the lobby; the first round pairs 1v8, 2v7, 3v6, 4v5.</p>
            </div>
            <button type="button" className="btn btn-primary" onClick={createTournament} disabled={Boolean(busy)}>
              {busy === 'create' ? 'Creating…' : 'Create tournament'}
            </button>
          </section>
        )}

        <section className="panel lobby-panel" aria-labelledby="lobby-title">
          <div className="panel-head">
            <div>
              <h2 id="lobby-title" className="panel-title">Lobby</h2>
              <p className="panel-sub">{lobby.length} bracket{lobby.length === 1 ? '' : 's'} on record</p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => loadLobby()} disabled={lobbyLoading}>Refresh</button>
          </div>

          {lobbyError ? (
            <ErrorNote onRetry={() => loadLobby()}>{lobbyError}</ErrorNote>
          ) : lobbyLoading && lobby.length === 0 ? (
            <Loading label="Loading brackets…" />
          ) : lobby.length === 0 ? (
            <Empty title="No brackets yet">Create one above and wait for seven challengers.</Empty>
          ) : (
            <ul className="tournament-list">
              {lobby.map((row) => {
                const rowSize = Number(row.size) || DEFAULT_SIZE;
                const rowCount = Number.isFinite(Number(row.playerCount)) ? Number(row.playerCount) : (row.players?.length || 0);
                const host = row.players?.find((entry) => Number(entry.seed) === 1) || row.players?.[0] || null;
                const joinLabel = joinButtonLabel(row, userId);
                return (
                  <li key={row.id} className="tournament-row">
                    <button type="button" className="tournament-row-main" onClick={() => openDetail(row.id)}>
                      <span className="tournament-row-name">{row.name || 'Tournament'}</span>
                      <span className="tournament-row-meta">
                        <Chip tone={`status-${row.status}`}>{tournamentStatusLabel(row.status)}</Chip>
                        <span>{rowCount}/{rowSize} seats</span>
                        {host?.username && <span>host {host.username}</span>}
                      </span>
                    </button>
                    <div className="tournament-row-actions">
                      {joinLabel === 'Join' && (
                        <button type="button" className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => joinTournament(row.id)}>
                          {busy === `join:${row.id}` ? 'Joining…' : 'Join'}
                        </button>
                      )}
                      {joinLabel === 'Joined' && <Chip tone="positive">Joined</Chip>}
                      {joinLabel === 'Full' && <Chip tone="neutral">Full</Chip>}
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDetail(row.id)}>View</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    );
  }

  if (detailLoading && !detail) {
    return (
      <div className="screen tournaments-screen">
        <button type="button" className="btn btn-ghost btn-sm" onClick={closeDetail}><ChevronLeft size={16} aria-hidden="true" /> All tournaments</button>
        <Loading label="Loading tournament…" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="screen tournaments-screen">
        <button type="button" className="btn btn-ghost btn-sm" onClick={closeDetail}><ChevronLeft size={16} aria-hidden="true" /> All tournaments</button>
        {detailError ? <ErrorNote onRetry={closeDetail}>{detailError}</ErrorNote> : <Loading label="Loading tournament…" />}
      </div>
    );
  }

  const slotsLeft = Math.max(0, size - joinedCount);
  const mySeed = players.find((entry) => sameUser(entry.id, userId));

  return (
    <div className="screen tournaments-screen">
      <header className="screen-head tournament-detail-head">
        <button type="button" className="btn btn-ghost btn-sm" onClick={closeDetail}>
          <ChevronLeft size={16} aria-hidden="true" /> All tournaments
        </button>
        <div>
          <h1>{tournament.name || 'Tournament'}</h1>
          <p className="screen-sub">
            <Chip tone={`status-${status}`}>{tournamentStatusLabel(status)}</Chip>
            <span className="tournament-count">{joinedCount}/{size} players</span>
            {isCreator && <span className="tournament-host-tag">You created this bracket</span>}
          </p>
        </div>
        {isCreator && (status === 'open' || status === 'in_progress') && (
          <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => setConfirmCancel(true)} disabled={Boolean(busy)}>
            <X size={15} aria-hidden="true" /> Cancel tournament
          </button>
        )}
        {!shouldPoll && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setDetailLoading(true); loadDetail(); }} disabled={detailLoading}>
            Refresh
          </button>
        )}
      </header>

      {status === 'open' && !participant && (
        <section className="panel cta-panel">
          <div>
            <h2 className="panel-title">Join this bracket</h2>
            <p className="panel-sub">{slotsLeft > 0 ? `${slotsLeft} seat${slotsLeft === 1 ? '' : 's'} left. It starts automatically when the last seat fills.` : 'The bracket is full — it starts as soon as the room is ready.'}</p>
          </div>
          {slotsLeft > 0 && (
            <button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={() => joinTournament(detailId)}>
              {busy === `join:${detailId}` ? 'Joining…' : 'Join tournament'}
            </button>
          )}
        </section>
      )}

      {status === 'open' && participant && (
        <section className="panel cta-panel">
          <div>
            <h2 className="panel-title">{mySeed ? `You are seed ${mySeed.seed} of ${size}` : 'You are in this bracket'}</h2>
            <p className="panel-sub">Waiting for {slotsLeft} more {slotsLeft === 1 ? 'player' : 'players'} before round one starts.</p>
          </div>
          <Chip tone="accent">{slotsLeft} seats left</Chip>
        </section>
      )}

      {status === 'in_progress' && eliminated && (
        <section className="panel cta-panel">
          <div>
            <h2 className="panel-title">{lost ? `Eliminated in the ${roundLabel(lost.round)}` : 'Eliminated'}</h2>
            <p className="panel-sub">The bracket continues without you. Stay on this page to watch the final.</p>
          </div>
          <Chip tone="neutral">Out</Chip>
        </section>
      )}

      {status === 'in_progress' && !eliminated && myMatchReady && (
        <section className="panel cta-panel cta-live">
          <div>
            <h2 className="panel-title">{myMatch.status === 'waiting' ? 'Your match is waiting' : 'Your match is live'}</h2>
            <p className="panel-sub">
              {myMatch.status === 'waiting'
                ? 'Take your seat — the match begins when your opponent arrives.'
                : myOpponent ? `Against ${myOpponent.username}. Your seat is ready.` : 'Your opponent is in the room.'}
            </p>
          </div>
          <button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={() => enterMatch(String(myMatch.id))}>
            {busy === 'enter' ? 'Entering…' : 'Enter match'}
          </button>
        </section>
      )}

      {status === 'in_progress' && !eliminated && !myMatchReady && lastWin && (
        <section className="panel cta-panel">
          <div>
            <h2 className="panel-title">You won the {roundLabel(lastWin.round)}</h2>
            <p className="panel-sub">
              {lastWin.round < 3
                ? `The ${roundLabel(lastWin.round + 1)} ${lastWin.round + 1 === 3 ? 'starts' : 'start'} when every match in this round settles.`
                : 'The final is settling.'}
              {' '}This page refreshes automatically.
            </p>
          </div>
          <Chip tone="positive">Advanced</Chip>
        </section>
      )}

      {status === 'complete' && (
        <section className="panel cta-panel cta-champion">
          <div>
            <h2 className="panel-title">
              {champion ? `${champion.username || 'The champion'} takes the bracket` : 'Tournament complete'}
            </h2>
            <p className="panel-sub">
              {myReward
                ? `${myReward.placement === 'champion' ? 'You won the bracket.' : myReward.placement === 'runnerUp' ? 'You finished runner-up.' : 'You reached the semifinals.'} Earned +${myReward.coins} coins${myReward.gems ? ` and +${myReward.gems} gems` : ''}.`
                : 'Prizes have been credited to the winners.'}
            </p>
          </div>
          <Crown size={28} className="cta-icon" aria-hidden="true" />
        </section>
      )}

      {status === 'cancelled' && (
        <section className="panel cta-panel">
          <div>
            <h2 className="panel-title">This tournament was cancelled</h2>
            <p className="panel-sub">No prizes were awarded. Create a fresh bracket from the lobby.</p>
          </div>
        </section>
      )}

      <div className="tournament-columns">
        <section className="panel seeds-panel" aria-labelledby="seeds-title">
          <div className="panel-head">
            <div>
              <h2 id="seeds-title" className="panel-title">Seats</h2>
              <p className="panel-sub">Seeded by join order.</p>
            </div>
            <Users size={17} className="panel-icon" aria-hidden="true" />
          </div>
          <ol className="seed-list">
            {Array.from({ length: size }, (_, index) => {
              const entry = players.find((candidate) => Number(candidate.seed) === index + 1);
              if (!entry) {
                return (
                  <li className="seed-row is-empty" key={`empty-${index + 1}`}>
                    <span className="seed-num num">{index + 1}</span>
                    <span className="seed-name">Open seat</span>
                  </li>
                );
              }
              const isChamp = champion && sameUser(entry.id, champion.id);
              return (
                <li className={`seed-row${isChamp ? ' is-champion' : ''}${sameUser(entry.id, userId) ? ' is-me' : ''}`} key={entry.id}>
                  <span className="seed-num num">{entry.seed}</span>
                  <Avatar src={entry.avatar || fallbackAvatar(entry.username)} name={entry.username} size={26} />
                  <span className="seed-name">{entry.username || 'Player'}{sameUser(entry.id, userId) ? ' (you)' : ''}</span>
                  {isChamp && <Crown size={13} aria-label="Champion" />}
                </li>
              );
            })}
          </ol>
        </section>

        <section className="panel bracket-panel" aria-labelledby="bracket-title">
          <div className="panel-head">
            <div>
              <h2 id="bracket-title" className="panel-title">Bracket</h2>
              <p className="panel-sub">Quarterfinal · Semifinal · Final</p>
            </div>
            <Trophy size={17} className="panel-icon" aria-hidden="true" />
          </div>

          {flatMatches.length === 0 ? (
            <Empty title="The bracket is not drawn yet">Pairings appear when the eighth seat fills.</Empty>
          ) : (
            <div className="bracket">
              {(detail.matches || []).map((group) => {
                const roundMatches = Array.isArray(group.matches) ? group.matches : [];
                const done = roundMatches.filter((row) => row.status === 'complete').length;
                return (
                  <section className="bracket-round" key={group.round} aria-labelledby={`round-${group.round}`}>
                    <div className="bracket-round-head">
                      <h3 id={`round-${group.round}`}>{roundLabel(group.round)}</h3>
                      <span className="bracket-round-meta num">{done}/{roundMatches.length} settled</span>
                    </div>
                    <ul className={`bracket-matches count-${roundMatches.length}`}>
                      {roundMatches.map((row) => {
                        const involvesMe = sameUser(row.player_x_id, userId) || sameUser(row.player_o_id, userId);
                        const xWon = row.status === 'complete' && row.winner_id != null && sameUser(row.winner_id, row.player_x_id);
                        const oWon = row.status === 'complete' && row.winner_id != null && sameUser(row.winner_id, row.player_o_id);
                        return (
                          <li key={row.id} className={`bracket-match${involvesMe ? ' involves-me' : ''}${row.status === 'waiting' ? ' is-waiting' : ''}`}>
                            <div className="bracket-match-head">
                              <span className="bracket-match-label">Pairing {row.pairing}</span>
                              <Chip tone={`status-${row.status}`}>{matchStatusLabel(row.status)}</Chip>
                            </div>
                            <div className={`bracket-side${xWon ? ' is-winner' : ''}`}>
                              <Avatar src={row.player_x_avatar || fallbackAvatar(row.player_x_username)} name={row.player_x_username} size={24} />
                              <span className="bracket-name">{row.player_x_username || 'Open seat'}</span>
                              {xWon && <Crown size={12} aria-label="Winner" />}
                            </div>
                            <div className={`bracket-side${oWon ? ' is-winner' : ''}`}>
                              <Avatar src={row.player_o_avatar || fallbackAvatar(row.player_o_username)} name={row.player_o_username} size={24} />
                              <span className="bracket-name">{row.player_o_username || 'Open seat'}</span>
                              {oWon && <Crown size={12} aria-label="Winner" />}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <section className="panel detail-prizes" aria-labelledby="detail-prizes-title">
        <div className="panel-head">
          <div>
            <h2 id="detail-prizes-title" className="panel-title">Prizes</h2>
            <p className="panel-sub">Paid once on completion. Tournament matches do not change rating or pay normal series rewards.</p>
          </div>
          <Trophy size={17} className="panel-icon" aria-hidden="true" />
        </div>
        <div className="tournament-prizes">
          <div className="prize"><span className="prize-place"><Crown size={15} aria-hidden="true" /> Champion</span><span className="prize-value num">{REWARD_TABLE.champion.coins} coins · {REWARD_TABLE.champion.gems} gems</span></div>
          <div className="prize"><span className="prize-place">Runner-up</span><span className="prize-value num">{REWARD_TABLE.runnerUp.coins} coins</span></div>
          <div className="prize"><span className="prize-place">Semifinalist</span><span className="prize-value num">{REWARD_TABLE.semifinalist.coins} coins</span></div>
        </div>
        <p className="panel-note">
          A drawn single-round match advances the lower seed. A match where neither player arrives is walked over the same way after ten minutes.
        </p>
      </section>

      <Dialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title="Cancel this tournament?"
        description="Every seat is released and no prizes are paid. Match rooms already open are closed. This cannot be undone."
        tone="danger"
        size="sm"
        busy={busy === 'cancel'}
        footer={(
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmCancel(false)} disabled={busy === 'cancel'}>Keep it</button>
            <button type="button" className="btn btn-danger" onClick={cancelTournament} disabled={busy === 'cancel'} data-autofocus>
              {busy === 'cancel' ? 'Cancelling…' : 'Cancel tournament'}
            </button>
          </>
        )}
      >
        <p className="dialog-note"><AlertTriangle size={15} aria-hidden="true" /> {joinedCount} player{joinedCount === 1 ? '' : 's'} will lose their seat.</p>
      </Dialog>
    </div>
  );
}
