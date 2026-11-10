import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../services/client';
import { formatNumber } from '../format';
import {Avatar, Empty, ErrorNote, Loading} from '../ui.jsx';
import { Crown, Trophy } from 'lucide-react';

export default function RanksScreen({ user }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = () => {
    let alive = true;
    setLoading(true);
    setError('');
    api.get('/api/leaderboard')
      .then(({ data }) => { if (alive) setRows(Array.isArray(data) ? data : []); })
      .catch(() => { if (alive) setError('Could not load the leaderboard. Check your connection and try again.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  };

  useEffect(load, []);

  const myIndex = useMemo(
    () => (rows || []).findIndex((row) => row.id === user?.id),
    [rows, user?.id],
  );
  const myRow = myIndex >= 0 ? rows[myIndex] : null;
  const rating = Number.isFinite(Number(user?.rating)) ? Number(user.rating) : null;

  return (
    <div className="screen ranks-screen">
      <header className="screen-head">
        <div>
          <h1>Ranks</h1>
          <p className="screen-sub">The top 50 players by rating, then XP. Rating changes only on completed ranked series.</p>
        </div>
        {myRow && <span className="screen-badge">You are #{myIndex + 1}</span>}
      </header>

      <div className="ranks-grid">
        <section className="panel ranks-panel" aria-labelledby="board-title">
          <div className="panel-head">
            <div>
              <h2 id="board-title" className="panel-title">Leaderboard</h2>
              <p className="panel-sub">{rows ? `${rows.length} ranked player${rows.length === 1 ? '' : 's'}` : 'Ranked players'}</p>
            </div>
            <Trophy size={18} className="panel-icon" aria-hidden="true" />
          </div>

          {error ? (
            <ErrorNote onRetry={load}>{error}</ErrorNote>
          ) : loading && !rows ? (
            <Loading label="Loading the leaderboard…" />
          ) : rows.length === 0 ? (
            <Empty title="No ranked players yet">
              Play the first ranked series and the board will fill from the top.
            </Empty>
          ) : (
            <div className="leaderboard" role="table" aria-label="Leaderboard">
              <div className="leaderboard-head" role="row">
                <span role="columnheader" className="col-rank">Rank</span>
                <span role="columnheader" className="col-player">Player</span>
                <span role="columnheader" className="col-num">Rating</span>
                <span role="columnheader" className="col-num col-wins">Wins</span>
                <span role="columnheader" className="col-num col-level">Level</span>
                <span role="columnheader" className="col-num col-xp">XP</span>
              </div>
              <ol className="leaderboard-list">
                {rows.map((row, index) => {
                  const isMe = myIndex === index;
                  return (
                    <li className={`leaderboard-row${isMe ? ' is-me' : ''}`} key={`${row.username}-${index}`} role="row">
                      <span className="col-rank" role="cell">
                        {index === 0 ? <Crown size={15} className="rank-crown" aria-label="First place" /> : null}
                        <span className="num">{index + 1}</span>
                      </span>
                      <span className="col-player" role="cell">
                        <Avatar src={row.avatar} name={row.username} size={30} />
                        <span className="player-name">{row.username || 'Player'}</span>
                        {isMe && <span className="you-tag">You</span>}
                      </span>
                      <span className="col-num num" role="cell">{formatNumber(row.rating)}</span>
                      <span className="col-num col-wins num" role="cell">{formatNumber(row.wins)}</span>
                      <span className="col-num col-level num" role="cell">{formatNumber(row.level)}</span>
                      <span className="col-num col-xp num" role="cell">{formatNumber(row.xp)}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </section>

        <aside className="ranks-rail">
          <section className="panel rail-panel" aria-labelledby="you-title">
            <div className="panel-head">
              <h2 id="you-title" className="panel-title">Your standing</h2>
            </div>
            <div className="your-rank">
              <span className="your-rank-value num">{myRow ? `#${myIndex + 1}` : '—'}</span>
              <span className="your-rank-label">{myRow ? 'on the leaderboard' : 'not in the top 50'}</span>
            </div>
            <dl className="kv-list">
              <div className="kv"><dt>Rating</dt><dd className="num">{rating === null ? '—' : formatNumber(rating)}</dd></div>
              <div className="kv"><dt>Series won</dt><dd className="num">{formatNumber(user?.wins || 0)}</dd></div>
              <div className="kv"><dt>Series lost</dt><dd className="num">{formatNumber(user?.losses || 0)}</dd></div>
              <div className="kv"><dt>Level</dt><dd className="num">{formatNumber(user?.level || 1)}</dd></div>
            </dl>
          </section>

          <section className="panel rail-panel" aria-labelledby="rating-title">
            <div className="panel-head">
              <h2 id="rating-title" className="panel-title">How rating moves</h2>
            </div>
            <p className="rail-copy">
              Every completed ranked series settles a rating change on the server. Private rooms, practice games,
              forfeits and cancellations never move it.
            </p>
            <p className="rail-copy">New accounts start at 1,000. The board ranks by rating first, then by XP.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
