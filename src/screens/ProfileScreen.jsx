import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/client';
import { dateText, friendlyLedgerReason, outcomeFor, scoreText, signedAmount } from '../services/history';
import { canClaimQuest, DAILY_REWARD, dailyRewardCopy, questComplete, questProgressLabel, rewardLabel } from '../services/quests';
import { achievementIconKey, claimButtonLabel, tileStateClass } from '../services/achievements';
import { formatNumber, formatCoins } from '../format';
import {Avatar, Chip, Empty, ErrorNote, Loading, Progress, Segmented} from '../ui.jsx';
import {
  ArrowRight, Award, Check, Coins, Crown, Flame, Gem, Gift, History, Lock, ShoppingBag,
  Target, Trophy, User, Wallet, Swords,
} from 'lucide-react';

const ACHIEVEMENT_ICONS = { trophy: Trophy, award: Award, flame: Flame, target: Target, crown: Crown, bag: ShoppingBag };
const OUTCOME_LABEL = { won: 'Won', lost: 'Lost', draw: 'Draw' };

const RewardChip = ({ reward }) => {
  const isCoins = reward?.currency === 'coins';
  const Icon = isCoins ? Coins : Gem;
  return (
    <span className={`reward-chip${isCoins ? ' is-coins' : ' is-gems'}`}>
      <Icon size={13} aria-hidden="true" />
      {rewardLabel(reward)}
    </span>
  );
};

/* ---------------- Quests ---------------- */

const QuestPanel = ({ userId, notify, onRefreshUser }) => {
  const uidRef = useRef(userId);
  useEffect(() => { uidRef.current = userId; }, [userId]);
  const requestRef = useRef(null);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [claimingDaily, setClaimingDaily] = useState(false);
  const [claimingId, setClaimingId] = useState(null);

  const load = useCallback(async (signal) => {
    const uid = uidRef.current;
    if (!uid) return;
    let controller = null;
    if (!signal) {
      if (requestRef.current) requestRef.current.abort();
      controller = new AbortController();
      requestRef.current = controller;
      signal = controller.signal;
    }
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/api/quests', { signal });
      if (signal.aborted || uidRef.current !== uid) return;
      setData(response.data);
    } catch (err) {
      if (err?.code === 'ERR_CANCELED' || signal.aborted || uidRef.current !== uid) return;
      setError('Could not load quests. Check your connection and try again.');
    } finally {
      if (!signal.aborted && uidRef.current === uid) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!userId) return undefined;
    setData(null);
    setError('');
    setClaimingDaily(false);
    setClaimingId(null);
    const controller = new AbortController();
    requestRef.current = controller;
    load(controller.signal);
    return () => {
      controller.abort();
      if (requestRef.current && requestRef.current !== controller) requestRef.current.abort();
    };
  }, [userId, load]);

  const claimDaily = async () => {
    if (claimingDaily || data?.dailyRewardClaimed || !uidRef.current) return;
    const uid = uidRef.current;
    setClaimingDaily(true);
    try {
      await api.post('/api/quests/daily-claim');
      if (uidRef.current !== uid) return;
      notify('Daily reward claimed.', 'success');
      await Promise.all([load(), onRefreshUser?.()]);
    } catch (err) {
      if (uidRef.current !== uid) return;
      if (err?.response?.data?.code === 'DAILY_REWARD_CLAIMED') {
        notify('Daily reward already claimed today.', 'info');
        await load();
      } else {
        notify('Could not claim the daily reward. Try again.', 'error');
      }
    } finally {
      if (uidRef.current === uid) setClaimingDaily(false);
    }
  };

  const claimQuest = async (quest) => {
    if (claimingId || !uidRef.current) return;
    const uid = uidRef.current;
    setClaimingId(quest.id);
    try {
      const { data: result } = await api.post(`/api/quests/${quest.id}/claim`);
      if (uidRef.current !== uid) return;
      notify(`Reward claimed: ${rewardLabel(result?.reward)}`, 'success');
      await Promise.all([load(), onRefreshUser?.()]);
    } catch (err) {
      if (uidRef.current !== uid) return;
      const code = err?.response?.data?.code;
      if (code === 'QUEST_ALREADY_CLAIMED') {
        notify('Quest reward already claimed.', 'info');
        await load();
      } else if (code === 'QUEST_INCOMPLETE') {
        notify('Quest is not complete yet — keep playing.', 'error');
      } else {
        notify('Could not claim the quest reward. Try again.', 'error');
      }
    } finally {
      if (uidRef.current === uid) setClaimingId(null);
    }
  };

  const quests = Array.isArray(data?.quests) ? data.quests : [];

  return (
    <section className="panel quests-panel" aria-labelledby="quests-panel-title">
      <div className="panel-head">
        <div>
          <h2 id="quests-panel-title" className="panel-title">Quests</h2>
          <p className="panel-sub">Reset at 00:00 UTC{data?.day ? ` · ${data.day}` : ''}</p>
        </div>
        <Chip tone={data?.dailyRewardClaimed ? 'neutral' : 'accent'}>
          {data?.dailyRewardClaimed ? 'Daily claimed' : 'Daily ready'}
        </Chip>
      </div>

      {error ? (
        <ErrorNote onRetry={() => load()}>{error}</ErrorNote>
      ) : loading && !data ? (
        <Loading label="Loading quests…" />
      ) : (
        <>
          <div className={`daily-reward${data?.dailyRewardClaimed ? ' is-claimed' : ''}`}>
            <span className="daily-reward-icon" aria-hidden="true"><Gift size={20} /></span>
            <div className="daily-reward-copy">
              <span className="daily-reward-title">Daily reward</span>
              <span className="daily-reward-sub">{dailyRewardCopy()}</span>
            </div>
            <div className="daily-reward-chips">
              <RewardChip reward={{ currency: 'coins', amount: DAILY_REWARD.coins }} />
              <RewardChip reward={{ currency: 'gems', amount: DAILY_REWARD.gems }} />
            </div>
            {data?.dailyRewardClaimed ? (
              <span className="claimed-pill"><Check size={13} aria-hidden="true" /> Claimed</span>
            ) : (
              <button type="button" className="btn btn-claim btn-sm" onClick={claimDaily} disabled={claimingDaily} aria-busy={claimingDaily}>
                {claimingDaily ? 'Claiming…' : 'Claim'}
              </button>
            )}
          </div>

          {quests.length === 0 ? (
            <Empty title="No quests today">The quest list refreshes at the next UTC day.</Empty>
          ) : (
            <ul className="quest-list">
              {quests.map((quest) => {
                const complete = questComplete(quest);
                const claimable = canClaimQuest(quest);
                const claiming = claimingId === quest.id;
                const percent = Math.min(100, Math.max(0, (Number(quest.progress) / (Number(quest.target) || 1)) * 100));
                const KindIcon = quest.kind === 'win' ? Trophy : quest.kind === 'draw' ? Target : Swords;
                return (
                  <li key={quest.id} className={`quest-row${quest.claimed ? ' is-claimed' : ''}`}>
                    <span className="quest-kind" aria-hidden="true"><KindIcon size={16} /></span>
                    <div className="quest-main">
                      <div className="quest-top">
                        <span className="quest-name">{quest.description}</span>
                        <RewardChip reward={quest.reward} />
                      </div>
                      <div className="quest-track" aria-hidden="true">
                        <div className="quest-fill" style={{ width: `${percent}%` }} />
                      </div>
                      <div className="quest-meta">
                        <span className="num">{questProgressLabel(quest)}</span>
                        <span>{quest.kind === 'win' ? 'Ranked win' : quest.kind === 'draw' ? 'Ranked draw' : 'Ranked series'}</span>
                      </div>
                    </div>
                    {quest.claimed ? (
                      <span className="claimed-pill"><Check size={13} aria-hidden="true" /> Claimed</span>
                    ) : (
                      <button
                        type="button"
                        className={`btn btn-sm ${claimable ? 'btn-claim' : 'btn-ghost'}`}
                        onClick={() => claimQuest(quest)}
                        disabled={!claimable || claiming}
                        aria-busy={claiming}
                      >
                        {claiming ? 'Claiming…' : complete ? 'Claim' : 'Locked'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
};

/* ---------------- Achievements ---------------- */

const AchievementsPanel = ({ userId, notify, onRefreshUser }) => {
  const uidRef = useRef(userId);
  useEffect(() => { uidRef.current = userId; }, [userId]);
  const requestRef = useRef(null);
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [claimingId, setClaimingId] = useState(null);

  const load = useCallback(async (signal) => {
    const uid = uidRef.current;
    if (!uid) return;
    let controller = null;
    if (!signal) {
      if (requestRef.current) requestRef.current.abort();
      controller = new AbortController();
      requestRef.current = controller;
      signal = controller.signal;
    }
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/api/achievements', { signal });
      if (signal.aborted || uidRef.current !== uid) return;
      setRows(Array.isArray(data?.achievements) ? data.achievements : []);
    } catch (err) {
      if (err?.code === 'ERR_CANCELED' || signal.aborted || uidRef.current !== uid) return;
      setError('Could not load achievements. Check your connection and try again.');
    } finally {
      if (!signal.aborted && uidRef.current === uid) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!userId) return undefined;
    setRows(null);
    const controller = new AbortController();
    requestRef.current = controller;
    load(controller.signal);
    return () => {
      controller.abort();
      if (requestRef.current && requestRef.current !== controller) requestRef.current.abort();
    };
  }, [userId, load]);

  const claim = async (achievement) => {
    if (claimingId || !uidRef.current) return;
    const uid = uidRef.current;
    setClaimingId(achievement.id);
    try {
      const { data } = await api.post(`/api/achievements/${achievement.id}/claim`);
      if (uidRef.current !== uid) return;
      notify(`Reward claimed: ${rewardLabel(data?.reward)}`, 'success');
      await Promise.all([load(), onRefreshUser?.()]);
    } catch (err) {
      if (uidRef.current !== uid) return;
      const code = err?.response?.data?.code;
      if (code === 'ACHIEVEMENT_ALREADY_CLAIMED') {
        notify('Achievement reward already claimed.', 'info');
        await load();
      } else if (code === 'ACHIEVEMENT_INCOMPLETE') {
        notify('Achievement not unlocked yet — keep playing.', 'error');
      } else {
        notify('Could not claim the achievement reward. Try again.', 'error');
      }
    } finally {
      if (uidRef.current === uid) setClaimingId(null);
    }
  };

  return (
    <section className="panel achievements-panel" aria-labelledby="achievements-panel-title">
      <div className="panel-head">
        <div>
          <h2 id="achievements-panel-title" className="panel-title">Achievements</h2>
          <p className="panel-sub">Lifetime milestones. Claim each reward once.</p>
        </div>
      </div>
      {error ? (
        <ErrorNote onRetry={() => load()}>{error}</ErrorNote>
      ) : loading && !rows ? (
        <Loading label="Loading achievements…" />
      ) : !rows || rows.length === 0 ? (
        <Empty title="No achievements yet">Play ranked series to unlock the first one.</Empty>
      ) : (
        <ul className="achievement-list">
          {rows.map((achievement) => {
            const state = tileStateClass(achievement);
            const Icon = ACHIEVEMENT_ICONS[achievementIconKey(achievement?.id)] || Trophy;
            const showClaim = claimButtonLabel(achievement);
            const claiming = claimingId === achievement.id;
            return (
              <li key={achievement?.id} className={`achievement-row is-${state}`}>
                <span className="achievement-icon" aria-hidden="true"><Icon size={18} /></span>
                <div className="achievement-main">
                  <span className="achievement-title">{achievement.title || achievement.id}</span>
                  {achievement.description && <span className="achievement-desc">{achievement.description}</span>}
                  <div className="achievement-foot">
                    <RewardChip reward={achievement.reward} />
                    {state === 'claimed' ? (
                      <span className="claimed-pill"><Check size={12} aria-hidden="true" /> Claimed</span>
                    ) : showClaim ? (
                      <button type="button" className="btn btn-claim btn-sm" onClick={() => claim(achievement)} disabled={claiming} aria-busy={claiming}>
                        {claiming ? 'Claiming…' : 'Claim'}
                      </button>
                    ) : (
                      <span className="locked-pill"><Lock size={12} aria-hidden="true" /> Locked</span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

/* ---------------- Activity ---------------- */

const MatchList = ({ matches, userId }) => {
  if (matches.length === 0) {
    return <Empty title="No matches yet">Finish a ranked series and it appears here with its score and board.</Empty>;
  }
  return (
    <ul className="activity-list" aria-label="Match history">
      {matches.map((row) => {
        const outcome = outcomeFor(row, userId);
        const userSide = Number(row.player_x_id) === Number(userId) ? 'X' : 'O';
        const rounds = Number(row.rounds_played) || 0;
        return (
          <li className="activity-row" key={row.id}>
            <Avatar src={row.opponent_avatar} name={row.opponent_username} size={36} />
            <div className="activity-main">
              <span className="activity-name">{row.opponent_username || 'Unknown player'}</span>
              <span className="activity-meta">
                {row.board_size || 3} × {row.board_size || 3} · {rounds} {rounds === 1 ? 'round' : 'rounds'} · {dateText(row.completed_at)}
              </span>
            </div>
            <div className="activity-result">
              <span className={`outcome outcome-${outcome}`}>{OUTCOME_LABEL[outcome]}{outcome === 'draw' ? '' : ` as ${userSide}`}</span>
              <span className="activity-score num">{scoreText(row)}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
};

const WalletList = ({ ledger }) => {
  if (ledger.length === 0) {
    return <Empty title="No wallet activity">Coins and gems from rewards and purchases are listed here.</Empty>;
  }
  return (
    <ul className="activity-list" aria-label="Wallet activity">
      {ledger.map((entry) => {
        const isCoins = entry.currency === 'coins';
        const positive = Number(entry.amount) > 0;
        const Icon = isCoins ? Coins : Gem;
        return (
          <li className="activity-row" key={entry.id}>
            <span className={`activity-badge${isCoins ? ' is-coins' : ' is-gems'}`} aria-hidden="true"><Icon size={16} /></span>
            <div className="activity-main">
              <span className="activity-name">{friendlyLedgerReason(entry.reason) || (isCoins ? 'Coins' : 'Gems')}</span>
              <span className="activity-meta">{isCoins ? 'Coins' : 'Gems'} · {dateText(entry.created_at)}</span>
            </div>
            <div className="activity-result">
              <span className={`activity-amount num${positive ? ' is-positive' : ''}`}>{signedAmount(entry)}</span>
              <span className="activity-score num">Balance {formatCoins(entry.balance_after)}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
};

/* ---------------- Collection ---------------- */

const CollectionPanel = ({ inventory, onEquip, equippedId }) => {
  if (!inventory || inventory.length === 0) {
    return <Empty title="No avatars owned">Buy an avatar in the Shop to start the collection.</Empty>;
  }
  return (
    <div className="collection-grid">
      {inventory.map((item) => {
        const active = Number(equippedId) === Number(item.id);
        return (
          <button
            key={item.id}
            type="button"
            className={`collection-card${active ? ' is-active' : ''}`}
            onClick={() => onEquip(item.id)}
            aria-pressed={active}
            aria-label={`Equip ${item.name || item.rarity} avatar${active ? ' (equipped)' : ''}`}
          >
            <img src={item.url} alt="" className="collection-img" loading="lazy" />
            <span className="collection-name">{item.name || item.rarity}</span>
            <span className={`rarity rarity-${item.rarity}`}>{item.rarity}</span>
            {active && <span className="collection-equipped"><Check size={12} aria-hidden="true" /> Equipped</span>}
          </button>
        );
      })}
    </div>
  );
};

/* ---------------- Screen ---------------- */

export default function ProfileScreen({
  user,
  inventory,
  notify,
  onRefreshUser,
  onEquip,
  onGoogleSignIn,
  googlePending,
  googleAvailable,
  initialTab = 'overview',
}) {
  const [tab, setTab] = useState(initialTab);
  const [matches, setMatches] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { setTab(initialTab); }, [initialTab]);

  const loadActivity = useCallback(async (signal) => {
    setLoading(true);
    setError('');
    try {
      const [matchRes, ledgerRes] = await Promise.all([
        api.get('/api/me/matches', { signal }),
        api.get('/api/me/ledger', { signal }),
      ]);
      if (signal?.aborted) return;
      setMatches(Array.isArray(matchRes.data) ? matchRes.data : []);
      setLedger(Array.isArray(ledgerRes.data) ? ledgerRes.data : []);
    } catch (err) {
      if (err?.code === 'ERR_CANCELED' || signal?.aborted) return;
      setError('Could not load your activity. Check your connection and try again.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user?.id) return undefined;
    const controller = new AbortController();
    loadActivity(controller.signal);
    return () => controller.abort();
  }, [user?.id, loadActivity]);

  const level = Number(user?.level) || 1;
  const xp = Number(user?.xp) || 0;
  const xpIntoLevel = xp % 250;
  const rating = Number.isFinite(Number(user?.rating)) ? Number(user.rating) : null;

  return (
    <div className="screen profile-screen">
      <header className="screen-head">
        <div>
          <h1>Profile</h1>
          <p className="screen-sub">Your record, your quests and everything you own.</p>
        </div>
      </header>

      <section className="panel player-card" aria-labelledby="player-name">
        <Avatar src={user?.avatar} name={user?.username} size={72} className="player-avatar" />
        <div className="player-identity">
          <div className="player-name-row">
            <h2 id="player-name" className="player-name">{user?.username || 'Guest'}</h2>
            <Chip tone={user?.email ? 'positive' : 'neutral'}>{user?.email ? 'Google linked' : 'Guest account'}</Chip>
          </div>
          <p className="player-meta">{user?.email || 'Progress lives in this browser until you link an account.'}</p>
          <div className="player-level">
            <span className="level-label">Level {level}</span>
            <Progress value={xpIntoLevel} max={250} label={`Level ${level} progress`} />
            <span className="level-xp num">{formatNumber(xpIntoLevel)} / 250 XP</span>
          </div>
        </div>
        <dl className="player-stats">
          <div><dt>Rating</dt><dd className="num">{rating === null ? '—' : formatNumber(rating)}</dd></div>
          <div><dt>Wins</dt><dd className="num">{formatNumber(user?.wins || 0)}</dd></div>
          <div><dt>Losses</dt><dd className="num">{formatNumber(user?.losses || 0)}</dd></div>
          <div><dt>Streak</dt><dd className="num">{formatNumber(user?.streak || 0)}</dd></div>
        </dl>
      </section>

      <Segmented
        label="Profile section"
        className="profile-tabs"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'overview', label: 'Overview', icon: User },
          { value: 'matches', label: 'Matches', icon: History },
          { value: 'wallet', label: 'Wallet', icon: Wallet },
          { value: 'collection', label: 'Collection', icon: ShoppingBag },
        ]}
      />

      {tab === 'overview' && (
        <div className="profile-grid">
          <div className="profile-main">
            {!user?.email && (
              <section className="panel guest-panel" aria-labelledby="guest-title">
                <div className="guest-copy">
                  <h2 id="guest-title" className="panel-title">Keep this progress</h2>
                  <p className="panel-sub">
                    You are playing as a guest. Linking a Google account keeps your coins, rating and collection
                    when you change devices.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={onGoogleSignIn}
                  disabled={googlePending}
                  aria-busy={googlePending}
                >
                  {googlePending ? 'Signing in…' : googleAvailable ? 'Sign in with Google' : 'Google sign-in'}
                </button>
                {!googleAvailable && <p className="field-note">Google sign-in becomes available when the server is configured.</p>}
              </section>
            )}
            <QuestPanel userId={user?.id} notify={notify} onRefreshUser={onRefreshUser} />
          </div>
          <aside className="profile-rail">
            <AchievementsPanel userId={user?.id} notify={notify} onRefreshUser={onRefreshUser} />
            {Array.isArray(inventory) && inventory.length > 0 && (
              <section className="panel rail-panel collection-preview" aria-labelledby="collection-preview-title">
                <div className="panel-head">
                  <h2 id="collection-preview-title" className="panel-title">Collection</h2>
                  <Chip tone="neutral">{inventory.length} owned</Chip>
                </div>
                <div className="rail-collection" aria-hidden="true">
                  {inventory.slice(0, 4).map((item) => (
                    <img key={item.id} src={item.url} alt="" loading="lazy" />
                  ))}
                </div>
                <button type="button" className="btn btn-quiet rail-link" onClick={() => setTab('collection')}>
                  View collection
                  <ArrowRight size={14} aria-hidden="true" />
                </button>
              </section>
            )}
          </aside>
        </div>
      )}

      {tab === 'matches' && (
        <section className="panel activity-panel" aria-labelledby="matches-title">
          <div className="panel-head">
            <div>
              <h2 id="matches-title" className="panel-title">Match history</h2>
              <p className="panel-sub">Your last 50 completed series.</p>
            </div>
          </div>
          {error ? <ErrorNote onRetry={() => loadActivity()}>{error}</ErrorNote>
            : loading && matches.length === 0 ? <Loading label="Loading matches…" />
              : <MatchList matches={matches} userId={user?.id} />}
        </section>
      )}

      {tab === 'wallet' && (
        <section className="panel activity-panel" aria-labelledby="wallet-title">
          <div className="panel-head">
            <div>
              <h2 id="wallet-title" className="panel-title">Wallet</h2>
              <p className="panel-sub">Every credit and debit, newest first.</p>
            </div>
            <div className="wallet-balances">
              <span className="num"><Gem size={14} aria-hidden="true" />{formatNumber(user?.gems || 0)}</span>
              <span className="num"><Coins size={14} aria-hidden="true" />{formatCoins(user?.coins || 0)}</span>
            </div>
          </div>
          {error ? <ErrorNote onRetry={() => loadActivity()}>{error}</ErrorNote>
            : loading && ledger.length === 0 ? <Loading label="Loading wallet…" />
              : <WalletList ledger={ledger} />}
        </section>
      )}

      {tab === 'collection' && (
        <section className="panel activity-panel" aria-labelledby="collection-title">
          <div className="panel-head">
            <div>
              <h2 id="collection-title" className="panel-title">Collection</h2>
              <p className="panel-sub">Tap an avatar to equip it. Your selection shows beside your name everywhere.</p>
            </div>
            <Chip tone="neutral">{inventory?.length || 0} owned</Chip>
          </div>
          <CollectionPanel inventory={inventory} onEquip={onEquip} equippedId={user?.active_avatar_id} />
        </section>
      )}
    </div>
  );
}
