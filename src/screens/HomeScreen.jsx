import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../services/client';
import { outcomeFor } from '../services/history';
import { REWARD_TABLE } from '../services/tournaments';
import { formatNumber, formatCoins } from '../format';
import {Avatar, Chip, Empty, ErrorNote, Loading, Mark} from '../ui.jsx';
import { Coins, Gem, Bot, Users, Trophy, Zap, ArrowRight, Flame, Shield } from 'lucide-react';

const REWARDS = [
  { label: 'Win a series', xp: 50, coins: 10 },
  { label: 'Draw a series', xp: 25, coins: 5 },
  { label: 'Lose a series', xp: 15, coins: 3 },
];

const FormGrid = ({ matches, userId }) => {
  const recent = matches.slice(0, 9);
  const cells = Array.from({ length: 9 }, (_, index) => recent[index] || null);
  return (
    <div className="form-grid" role="img" aria-label={`Recent series: ${recent.map((m) => outcomeFor(m, userId)).join(', ') || 'none played'}`}>
      {cells.map((match, index) => {
        const outcome = match ? outcomeFor(match, userId) : null;
        return (
          <span
            key={index}
            className={`form-cell${outcome ? ` is-${outcome}` : ''}`}
            aria-hidden="true"
          >
            {outcome === 'won' && <Mark symbol="X" strokeWidth={13} />}
            {outcome === 'lost' && <Mark symbol="O" strokeWidth={13} />}
            {outcome === 'draw' && <span className="form-draw" />}
          </span>
        );
      })}
    </div>
  );
};

export default function HomeScreen({
  user,
  matches,
  matchesLoading,
  searching,
  onFindMatch,
  onCancelSearch,
  onNavigate,
  onOpenTournament,
}) {
  const [quests, setQuests] = useState(null);
  const [questsError, setQuestsError] = useState('');
  const [tournaments, setTournaments] = useState(null);
  const [events, setEvents] = useState([]);

  const loadQuests = useCallback(async (signal) => {
    try {
      const { data } = await api.get('/api/quests', { signal });
      if (signal?.aborted) return;
      setQuests(data);
      setQuestsError('');
    } catch (error) {
      if (error?.code === 'ERR_CANCELED' || signal?.aborted) return;
      setQuestsError('Quests are unavailable right now.');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    if (!user?.id) return undefined;
    loadQuests(controller.signal);
    api.get('/api/tournaments', { signal: controller.signal })
      .then(({ data }) => setTournaments(data))
      .catch(() => setTournaments({ tournaments: [], counts: {} }));
    api.get('/api/events/active', { signal: controller.signal })
      .then(({ data }) => setEvents(Array.isArray(data?.events) ? data.events : []))
      .catch(() => setEvents([]));
    return () => controller.abort();
  }, [user?.id, loadQuests]);

  const openTournament = useMemo(() => {
    const list = tournaments?.tournaments || [];
    return list.find((row) => row.status === 'open' || row.status === 'in_progress') || null;
  }, [tournaments]);

  const questRows = useMemo(() => {
    const list = Array.isArray(quests?.quests) ? quests.quests : [];
    return [...list].sort((a, b) => Number(Boolean(a.claimed)) - Number(Boolean(b.claimed))).slice(0, 3);
  }, [quests]);

  const claimable = useMemo(
    () => (quests?.quests || []).filter((quest) => !quest.claimed && Number(quest.progress) >= Number(quest.target)).length,
    [quests],
  );

  const rating = Number.isFinite(Number(user?.rating)) ? Number(user.rating) : null;
  const level = Number(user?.level) || 1;
  const xp = Number(user?.xp) || 0;
  const xpIntoLevel = xp % 100;
  const boost = events[0];

  return (
    <div className="screen home-screen">
      <header className="screen-head">
        <div>
          <h1>Home</h1>
          <p className="screen-sub">Your next series, today&rsquo;s quests and the live bracket.</p>
        </div>
      </header>

      <div className="home-grid">
        <div className="home-main">
          <section className="panel match-panel" aria-labelledby="match-panel-title">
            <div className="panel-head">
              <div>
                <h2 id="match-panel-title" className="panel-title">Ranked duel</h2>
                <p className="panel-sub">Server-run best of three. Matchmaking pairs you by rating.</p>
              </div>
              <Chip tone="accent">Ranked</Chip>
            </div>

            <div className="match-body">
              <div className="match-rating">
                <span className="figure-label">Your rating</span>
                <span className="figure num">{rating === null ? '—' : formatNumber(rating)}</span>
                <span className="figure-hint">{formatNumber(user?.wins || 0)}W · {formatNumber(user?.losses || 0)}L · {formatNumber(user?.draws || 0)}D</span>
              </div>

              <div className="match-facts">
                <div className="fact">
                  <span className="fact-label">Format</span>
                  <span className="fact-value">Best of 3 rounds</span>
                </div>
                <div className="fact">
                  <span className="fact-label">Board</span>
                  <span className="fact-value">3 × 3</span>
                </div>
                <div className="fact">
                  <span className="fact-label">Rewards</span>
                  <span className="fact-value">XP, coins and quest progress</span>
                </div>
              </div>
            </div>

            <div className="match-actions">
              {searching ? (
                <>
                  <span className="queue-status" role="status">
                    <span className="queue-dot" aria-hidden="true" />
                    Searching for an opponent near {rating === null ? '1,000' : formatNumber(rating)}…
                  </span>
                  <button type="button" className="btn btn-ghost" onClick={onCancelSearch}>Cancel search</button>
                </>
              ) : (
                <>
                  <button type="button" className="btn btn-primary" onClick={onFindMatch}>
                    Find opponent
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                  <button type="button" className="btn btn-quiet" onClick={() => onNavigate('battle', { mode: 'private' })}>
                    <Users size={16} aria-hidden="true" />
                    Play a friend instead
                  </button>
                </>
              )}
            </div>
          </section>

          <div className="mode-row">
            <section className="panel mode-panel" aria-labelledby="private-title">
              <div className="mode-icon" aria-hidden="true"><Users size={20} /></div>
              <h2 id="private-title" className="mode-title">Private room</h2>
              <p className="mode-copy">Host a room, send the invite link, and play unranked. Private series never pay rewards or affect rating.</p>
              <button type="button" className="btn btn-ghost" onClick={() => onNavigate('battle', { mode: 'private' })}>
                Host or join a room
              </button>
            </section>

            <section className="panel mode-panel" aria-labelledby="practice-title">
              <div className="mode-icon" aria-hidden="true"><Bot size={20} /></div>
              <h2 id="practice-title" className="mode-title">Practice vs AI</h2>
              <p className="mode-copy">Pick a 3×3, 4×4 or 5×5 board and one of four strengths. Practice games are local and unranked.</p>
              <button type="button" className="btn btn-ghost" onClick={() => onNavigate('battle', { mode: 'practice' })}>
                Set up a practice game
              </button>
            </section>
          </div>

          <section className="panel rewards-panel" aria-labelledby="rewards-title">
            <div className="panel-head">
              <div>
                <h2 id="rewards-title" className="panel-title">What a ranked series pays</h2>
                <p className="panel-sub">Paid once per completed series in matchmaking. Forfeits pay nothing.</p>
              </div>
            </div>
            <div className="reward-table">
              {REWARDS.map((row) => (
                <div className="reward-row" key={row.label}>
                  <span className="reward-label">{row.label}</span>
                  <span className="reward-value num">{row.xp} XP</span>
                  <span className="reward-value num"><Coins size={14} aria-hidden="true" />{row.coins}</span>
                </div>
              ))}
            </div>
            <p className="panel-note">
              Weekend boost doubles quest and daily-reward coins. Tournament prizes are separate:
              champion {REWARD_TABLE.champion.coins} coins and {REWARD_TABLE.champion.gems} gems.
            </p>
          </section>

          <div className="mode-row">
            <section className="panel mode-panel" aria-labelledby="home-tournament-title">
              <div className="mode-icon" aria-hidden="true"><Trophy size={20} /></div>
              <h2 id="home-tournament-title" className="mode-title">Tournament</h2>
              {tournaments === null ? (
                <p className="mode-copy">Loading the bracket…</p>
              ) : openTournament ? (
                <p className="mode-copy">
                  {openTournament.name || 'Knockout bracket'} · {openTournament.playerCount || 0}/{openTournament.size || 8} seats taken.
                  {openTournament.status === 'open' ? ' Starts when the last seat fills.' : ' The bracket is under way.'}
                </p>
              ) : (
                <p className="mode-copy">No bracket is running. Create an 8-player knockout and wait for challengers.</p>
              )}
              <div className="fact-chips">
                <Chip tone="neutral">8 players</Chip>
                <Chip tone="neutral">Single elimination</Chip>
                <Chip tone="neutral">No rating change</Chip>
              </div>
              <p className="panel-note">Champion takes 500 coins and 50 gems. Runner-up and semifinalists also place.</p>
              <button type="button" className="btn btn-ghost" onClick={() => (openTournament ? onOpenTournament(openTournament.id) : onNavigate('tournaments'))}>
                <Trophy size={15} aria-hidden="true" />
                {openTournament ? 'Open the bracket' : 'Go to tournaments'}
              </button>
            </section>

            {boost ? (
              <section className="panel boost-panel" aria-label="Active event">
                <div className="boost-line"><Flame size={16} aria-hidden="true" /><span>{boost.name}</span></div>
                <p className="rail-copy">{boost.description}. Applies to daily rewards and quest claims until the UTC day ends.</p>
                <ul className="boost-list">
                  <li>Daily reward coins ×{boost.multiplier}</li>
                  <li>Quest claim coins ×{boost.multiplier}</li>
                  <li>Gems are never boosted</li>
                </ul>
              </section>
            ) : (
              <section className="panel mode-panel" aria-labelledby="home-secure-title">
                <div className="mode-icon" aria-hidden="true"><Shield size={20} /></div>
                <h2 id="home-secure-title" className="mode-title">Server-run matches</h2>
                <p className="mode-copy">The browser never picks a result. Moves, turns, rewards and ratings are validated on the server.</p>
                <ul className="rail-list">
                  <li>Every move, turn and reward is validated on the server.</li>
                  <li>A series is written once, with no client-side payout.</li>
                  <li>Rewards settle through the same ledger as purchases.</li>
                </ul>
                <button type="button" className="btn btn-quiet rail-link" onClick={() => onNavigate('play')}>
                  How a series runs
                  <ArrowRight size={14} aria-hidden="true" />
                </button>
              </section>
            )}
          </div>
        </div>

        <aside className="home-rail">
          <section className="panel rail-panel" aria-labelledby="form-title">
            <div className="panel-head">
              <h2 id="form-title" className="panel-title">Your form</h2>
              <span className="panel-meta">Last 9 series</span>
            </div>
            {matchesLoading && matches.length === 0 ? (
              <Loading label="Loading series…" />
            ) : (
              <FormGrid matches={matches} userId={user?.id} />
            )}
            {matches.length === 0 && !matchesLoading && (
              <p className="form-empty">No series yet. Your first nine results land here.</p>
            )}
            <div className="form-legend">
              <span><Mark symbol="X" strokeWidth={16} /> Win</span>
              <span><Mark symbol="O" strokeWidth={16} /> Loss</span>
              <span><span className="form-draw" aria-hidden="true" /> Draw</span>
            </div>
          </section>

          <section className="panel rail-panel" aria-labelledby="quests-title">
            <div className="panel-head">
              <h2 id="quests-title" className="panel-title">Today&rsquo;s quests</h2>
              {claimable > 0
                ? <Chip tone="accent">{claimable} to claim</Chip>
                : <span className="panel-meta">UTC day</span>}
            </div>
            {questsError ? (
              <ErrorNote onRetry={() => loadQuests()}>{questsError}</ErrorNote>
            ) : !quests ? (
              <Loading label="Loading quests…" />
            ) : (
              <>
                <div className="daily-line">
                  <span className="daily-line-icon" aria-hidden="true"><Zap size={15} /></span>
                  <span className="daily-line-label">Daily reward</span>
                  <span className={`daily-line-state${quests.dailyRewardClaimed ? ' is-claimed' : ''}`}>
                    {quests.dailyRewardClaimed ? 'Claimed' : 'Ready'}
                  </span>
                </div>
                <ul className="mini-quests">
                  {questRows.map((quest) => {
                    const done = Number(quest.progress) >= Number(quest.target);
                    return (
                      <li key={quest.id} className={`mini-quest${quest.claimed ? ' is-claimed' : ''}`}>
                        <span className="mini-quest-copy">{quest.description}</span>
                        <span className="mini-quest-progress num">{Math.min(quest.progress, quest.target)}/{quest.target}</span>
                        <span className={`mini-quest-mark${done && !quest.claimed ? ' is-ready' : ''}`}>
                          {quest.claimed ? 'Claimed' : done ? 'Ready' : ''}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <button type="button" className="btn btn-quiet rail-link" onClick={() => onNavigate('profile', { tab: 'quests' })}>
                  Claim rewards
                  <ArrowRight size={14} aria-hidden="true" />
                </button>
              </>
            )}
          </section>

          <section className="rail-foot" aria-label="Account">
            <Avatar src={user?.avatar} name={user?.username} size={36} />
            <div className="rail-foot-copy">
              <span className="rail-foot-name">{user?.username || 'Guest'}</span>
              <span className="rail-foot-meta">Level {level} · {formatNumber(xpIntoLevel)}/250 XP</span>
            </div>
            <div className="rail-foot-balance">
              <span className="num"><Gem size={13} aria-hidden="true" />{formatNumber(user?.gems || 0)}</span>
              <span className="num"><Coins size={13} aria-hidden="true" />{formatCoins(user?.coins || 0)}</span>
            </div>
          </section>
          <p className="rail-secure"><Shield size={13} aria-hidden="true" /> Server-authoritative matches. The browser never picks a result.</p>
        </aside>
      </div>
    </div>
  );
}
