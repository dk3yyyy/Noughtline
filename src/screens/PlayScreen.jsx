import React, { useEffect, useState } from 'react';
import {
  ArrowRight, Bot, Check, Coins, Copy, Gauge, Link2, Swords, Trophy, Users,
} from 'lucide-react';
import { formatNumber } from '../format';
import {Chip, Segmented} from '../ui.jsx';

const DIFFICULTIES = [
  { value: 'easy', label: 'Easy', note: 'Plays at random. Good for learning the board.' },
  { value: 'medium', label: 'Medium', note: 'Mixes random moves with real threats.' },
  { value: 'hard', label: 'Hard', note: 'Looks ahead on every move.' },
  { value: 'impossible', label: 'Impossible', note: 'Full search. A draw is a good result.' },
];

const ROUNDS = [{ value: 1, label: 'Best of 1' }, { value: 3, label: 'Best of 3' }, { value: 5, label: 'Best of 5' }];
const SIZES = [{ value: 3, label: '3 × 3' }, { value: 4, label: '4 × 4' }, { value: 5, label: '5 × 5' }];

export default function PlayScreen({
  mode = 'ranked',
  onModeChange,
  user,
  rating,
  searching,
  onFindMatch,
  onCancelSearch,
  connected,
  gameConfig,
  setGameConfig,
  onHost,
  onJoin,
  onResume,
  onCopyInvite,
  onStartPractice,
  initialCode = '',
}) {
  const [rounds, setRounds] = useState(Number(gameConfig?.rounds) || 3);
  const [size, setSize] = useState(Number(gameConfig?.size) || 3);
  const [joinCode, setJoinCode] = useState(initialCode || '');
  const [joinError, setJoinError] = useState('');
  const [joining, setJoining] = useState(false);
  const [hosting, setHosting] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setRounds(Number(gameConfig?.rounds) || 3);
    setSize(Number(gameConfig?.size) || 3);
  }, [gameConfig?.rounds, gameConfig?.size]);

  useEffect(() => {
    if (initialCode) setJoinCode(initialCode);
  }, [initialCode]);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 2200);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const activeRoom = gameConfig?.mode === 'multiplayer' && gameConfig?.roomId ? gameConfig.roomId : null;
  const difficulty = DIFFICULTIES.find((row) => row.value === gameConfig?.difficulty) || DIFFICULTIES[0];

  const submitJoin = async (event) => {
    event.preventDefault();
    if (joining) return;
    setJoining(true);
    setJoinError('');
    try {
      const result = await onJoin(joinCode);
      if (result?.error && !['ACTIVE_ROOM_EXISTS', 'RATE_LIMITED'].includes(result.code)) setJoinError(result.error);
    } catch {
      setJoinError('The room could not be joined. Check your connection and try again.');
    } finally {
      setJoining(false);
    }
  };

  const createRoom = async () => {
    if (hosting) return;
    setHosting(true);
    try {
      await onHost(rounds, size);
    } finally {
      setHosting(false);
    }
  };

  const handleCopy = async () => {
    await onCopyInvite();
    setCopied(true);
  };

  return (
    <div className="screen play-screen">
      <header className="screen-head">
        <div>
          <h1>Play</h1>
          <p className="screen-sub">Three ways to play: ranked matchmaking, a private room with a friend, or practice against the machine.</p>
        </div>
      </header>

      <Segmented
        label="Play mode"
        className="play-modes"
        value={mode}
        onChange={onModeChange}
        options={[
          { value: 'ranked', label: 'Ranked duel', icon: Swords },
          { value: 'private', label: 'Private room', icon: Users },
          { value: 'practice', label: 'Practice vs AI', icon: Bot },
        ]}
      />

      {mode === 'ranked' && (
        <div className="play-grid">
          <section className="panel play-main" aria-labelledby="ranked-title">
            <div className="panel-head">
              <div>
                <h2 id="ranked-title" className="panel-title">Ranked duel</h2>
                <p className="panel-sub">A stranger near your rating, a 3 × 3 board and a best-of-three series. The server validates every move.</p>
              </div>
              <Chip tone="accent">Rewards on</Chip>
            </div>

            <div className="ranked-figure">
              <span className="figure-label">Rating</span>
              <span className="figure num">{rating === null ? '—' : formatNumber(rating)}</span>
              <span className="figure-hint">{Number(user?.wins || 0)}W · {Number(user?.losses || 0)}L · {Number(user?.draws || 0)}D</span>
            </div>

            <ul className="play-points">
              <li><Check size={15} aria-hidden="true" /> Winning a series adds 50 XP and 10 coins.</li>
              <li><Check size={15} aria-hidden="true" /> Completed series progress daily quests and achievements.</li>
              <li><Check size={15} aria-hidden="true" /> Forfeits and disconnects pay nothing and do not change rating.</li>
            </ul>

            <div className="play-actions">
              {searching ? (
                <>
                  <span className="queue-status" role="status">
                    <span className="queue-dot" aria-hidden="true" />
                    Searching the queue…
                  </span>
                  <button type="button" className="btn btn-ghost" onClick={onCancelSearch}>Cancel search</button>
                </>
              ) : (
                <button type="button" className="btn btn-primary btn-lg" onClick={onFindMatch} disabled={!connected}>
                  <Swords size={18} aria-hidden="true" />
                  Find an opponent
                </button>
              )}
              {!connected && <p className="field-note">Reconnect before entering the queue.</p>}
            </div>

            <div className="rules-block">
              <h3 className="rules-title">How a ranked series runs</h3>
              <ol className="rules-list">
                <li>
                  <span className="rule-step">Queue</span>
                  <span>The server pairs you with the closest waiting rating. Cancel any time before a match is found.</span>
                </li>
                <li>
                  <span className="rule-step">Best of three</span>
                  <span>Crosses move first in every round. The first player to win the majority takes the series; a drawn round scores for neither side but still counts toward the round limit.</span>
                </li>
                <li>
                  <span className="rule-step">Settle</span>
                  <span>The result is written once, rewards are credited, quest progress advances and rating is recalculated on the server.</span>
                </li>
              </ol>
            </div>
          </section>

          <aside className="play-rail">
            <section className="panel rail-panel" aria-labelledby="standing-title">
              <div className="panel-head">
                <h2 id="standing-title" className="panel-title">Your standing</h2>
              </div>
              <dl className="kv-list">
                <div className="kv"><dt>Rating</dt><dd className="num">{rating === null ? '—' : formatNumber(rating)}</dd></div>
                <div className="kv"><dt>Series won</dt><dd className="num">{formatNumber(user?.wins || 0)}</dd></div>
                <div className="kv"><dt>Series lost</dt><dd className="num">{formatNumber(user?.losses || 0)}</dd></div>
                <div className="kv"><dt>Draws</dt><dd className="num">{formatNumber(user?.draws || 0)}</dd></div>
                <div className="kv"><dt>Win streak</dt><dd className="num">{formatNumber(user?.streak || 0)}</dd></div>
              </dl>
              <p className="panel-note">Rating moves only on completed ranked series. The leaderboard shows the top 50.</p>
            </section>

            {activeRoom && (
              <section className="panel rail-panel" aria-labelledby="active-room-title">
                <div className="panel-head">
                  <h2 id="active-room-title" className="panel-title">Active room</h2>
                  <Chip tone="neutral">{activeRoom}</Chip>
                </div>
                <p className="rail-copy">You are already seated in this room. Resume it before starting another.</p>
                <div className="stack-actions">
                  <button type="button" className="btn btn-primary" onClick={onResume}>Resume match</button>
                  <button type="button" className="btn btn-ghost" onClick={handleCopy}>
                    {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
                    {copied ? 'Invite copied' : 'Copy invite'}
                  </button>
                </div>
              </section>
            )}

            <section className="panel rail-panel" aria-labelledby="ranked-tourney-title">
              <div className="panel-head">
                <h2 id="ranked-tourney-title" className="panel-title">Bracket night</h2>
              </div>
              <p className="rail-copy">
                Knockouts run alongside ranked: 8 players, champion takes 500 coins and 50 gems.
              </p>
              <button type="button" className="btn btn-quiet rail-link" onClick={() => onModeChange('tournaments')}>
                <Trophy size={15} aria-hidden="true" />
                Go to tournaments
                <ArrowRight size={14} aria-hidden="true" />
              </button>
            </section>
          </aside>
        </div>
      )}

      {mode === 'private' && (
        <div className="play-grid">
          <section className="panel play-main" aria-labelledby="private-title">
            <div className="panel-head">
              <div>
                <h2 id="private-title" className="panel-title">Host a room</h2>
                <p className="panel-sub">Choose the series length and board, then send the invite link. Private series are unranked.</p>
              </div>
            </div>
            <div className="form-block">
              <span className="field-label">Series length</span>
              <Segmented label="Series length" value={rounds} onChange={setRounds} options={ROUNDS} />
            </div>
            <div className="form-block">
              <span className="field-label">Board size</span>
              <Segmented label="Board size" value={size} onChange={setSize} options={SIZES} />
            </div>
            <p className="field-note">
              {size === 3 ? 'Three in a row wins a round.' : size === 4 ? 'Four in a row wins a round.' : 'Five in a row wins a round.'}
              {' '}First to win the majority of {rounds} round{rounds === 1 ? '' : 's'} takes the series.
            </p>
            <div className="play-actions">
              <button type="button" className="btn btn-primary" onClick={createRoom} disabled={!connected || hosting}>
                {hosting ? 'Creating room…' : 'Create room'}
              </button>
            </div>

            <div className="panel-divider" role="presentation" />

            <div className="panel-head">
              <div>
                <h2 className="panel-title">Join a room</h2>
                <p className="panel-sub">Paste the room code or the full invite link.</p>
              </div>
            </div>
            <form className="join-form" onSubmit={submitJoin}>
              <label className="field-label" htmlFor="join-code">Room code</label>
              <div className="joined-field">
                <Link2 size={16} className="joined-icon" aria-hidden="true" />
                <input
                  id="join-code"
                  className="input"
                  value={joinCode}
                  onChange={(event) => { setJoinCode(event.target.value); setJoinError(''); }}
                  placeholder="e.g. ROOM_ABC123"
                  autoComplete="off"
                  spellCheck="false"
                  maxLength={256}
                  disabled={!connected || joining}
                  aria-invalid={Boolean(joinError)}
                  aria-describedby={joinError ? 'join-code-error' : undefined}
                />
                <button type="submit" className="btn btn-primary btn-joined" disabled={!connected || joining || !joinCode.trim()}>
                  {joining ? 'Joining…' : 'Join'}
                </button>
              </div>
              {joinError && <p className="field-error" id="join-code-error" role="alert">{joinError}</p>}
              {!connected && <p className="field-note">The realtime service is offline. Reconnecting…</p>}
            </form>

            {activeRoom && (
              <>
                <div className="panel-divider" role="presentation" />
                <div className="active-room-line">
                  <div>
                    <span className="field-label">Your active room</span>
                    <strong className="active-room-code">{activeRoom}</strong>
                  </div>
                  <div className="stack-actions stack-actions-inline">
                    <button type="button" className="btn btn-primary" onClick={onResume}>Resume match</button>
                    <button type="button" className="btn btn-ghost" onClick={handleCopy}>
                      {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
                      {copied ? 'Copied' : 'Copy invite'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </section>

          <aside className="play-rail">
            <section className="panel rail-panel" aria-labelledby="private-note-title">
              <div className="panel-head">
                <h2 id="private-note-title" className="panel-title">Private rules</h2>
              </div>
              <ul className="rail-list">
                <li>No rating change.</li>
                <li>No XP, coins or quest progress.</li>
                <li>One active room per player.</li>
                <li>A disconnected opponent has 30 seconds to return before forfeiting.</li>
              </ul>
            </section>
            <section className="panel rail-panel" aria-labelledby="invite-note-title">
              <div className="panel-head">
                <h2 id="invite-note-title" className="panel-title">Invite link</h2>
              </div>
              <p className="rail-copy">The link opens Noughtline with the room code filled in, so your friend only has to join.</p>
              <p className="rail-code">noughtline.app/ROOM_CODE</p>
            </section>
          </aside>
        </div>
      )}

      {mode === 'practice' && (
        <div className="play-grid">
          <section className="panel play-main" aria-labelledby="practice-title">
            <div className="panel-head">
              <div>
                <h2 id="practice-title" className="panel-title">Practice vs AI</h2>
                <p className="panel-sub">Local board, no clock, no rating. Choose a board and an opponent strength.</p>
              </div>
              <Chip tone="neutral">Unranked</Chip>
            </div>

            <div className="form-block">
              <span className="field-label">Board size</span>
              <Segmented
                label="Board size"
                value={Number(gameConfig?.size) || 3}
                onChange={(value) => setGameConfig((previous) => ({ ...previous, size: value, mode: 'singleplayer', roomId: null, opponentName: null, opponentAvatar: null }))}
                options={SIZES}
              />
            </div>

            <div className="form-block">
              <span className="field-label">Opponent strength</span>
              <div className="difficulty-grid" role="group" aria-label="Opponent strength">
                {DIFFICULTIES.map((row) => {
                  const active = (gameConfig?.difficulty || 'easy') === row.value;
                  return (
                    <button
                      key={row.value}
                      type="button"
                      className={`difficulty-option${active ? ' is-active' : ''}`}
                      aria-pressed={active}
                      onClick={() => setGameConfig((previous) => ({ ...previous, difficulty: row.value, mode: 'singleplayer', roomId: null, opponentName: null, opponentAvatar: null }))}
                    >
                      <span className="difficulty-name">{row.label}</span>
                      <span className="difficulty-note">{row.note}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="practice-summary">
              <span className="practice-summary-label">Next game</span>
              <span className="practice-summary-value">
                {(Number(gameConfig?.size) || 3)} × {(Number(gameConfig?.size) || 3)} board · {difficulty.label} AI · you play the crosses
              </span>
            </div>

            <div className="play-actions">
              <button type="button" className="btn btn-primary btn-lg" onClick={onStartPractice}>
                <Gauge size={18} aria-hidden="true" />
                Start practice game
              </button>
            </div>
          </section>

          <aside className="play-rail">
            <section className="panel rail-panel" aria-labelledby="practice-note-title">
              <div className="panel-head">
                <h2 id="practice-note-title" className="panel-title">What practice pays</h2>
              </div>
              <p className="rail-copy">
                Nothing but the board. XP, coins, quests and achievements only come from completed ranked series.
              </p>
              <p className="practice-tip">
                <Coins size={15} aria-hidden="true" />
                Play ranked when you want progress; practice when you want the puzzle.
              </p>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
