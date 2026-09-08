import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { api, adoptSessionToken, clearSession, ensureSession, getSocket, logoutSession } from './services/client';
import { clearActiveRoom, createInviteUrl, getInviteRoomId, normalizeRoomId, readActiveRoom, saveActiveRoom } from './services/rooms';
import { chatErrorText, formatChatTime, isOwnMessage, MAX_CHAT_LENGTH, pushChatMessage, validateChatInput } from './services/chat';
import { mergeToast } from './services/toasts';
import { dateText, friendlyLedgerReason, outcomeFor, scoreText, signedAmount } from './services/history';
import { canClaimQuest, DAILY_REWARD, dailyRewardCopy, questComplete, questProgressLabel, rewardLabel } from './services/quests';
import { insufficientGuidance, insufficientLabel, itemCost, shortfallText } from './services/shop';
import { achievementIconKey, claimButtonLabel, tileStateClass } from './services/achievements';
import { parsePaymentComplete, providerReturnState } from './services/payments';
import { deltaLabel, formatRating, isRankedRoom, ratingDelta } from './services/ratings';
import { GOOGLE_CLIENT_ID } from './config';
import { buildGoogleIdConfig, loadGsiScript, normalizeGoogleError, parseProviderResponse, signInAvailability } from './services/google';
import {
  Home,
  Trophy,
  Swords,
  User,
  ShoppingBag,
  Zap,
  Flame,
  Gem,
  History,
  Coins,
  Settings,
  ChevronLeft,
  Volume2,
  VolumeX,
  Moon,
  Sun,
  Shield,
  RotateCcw,
  Check,
  Copy,
  Crown,
  Link2,
  Lock,
  Share2,
  AlertTriangle,
  Award,
  Target,
  Wallet,
  Gift,
  Gauge,
  LogOut,
  MessageSquare,
  Send,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import './App.css';
import './MultiplayerModals.css';

// --- Sound Hook ---
const useSound = (enabled) => useMemo(() => {
  const playClick = () => {
    if (!enabled) return;
    const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3');
    audio.volume = 0.2;
    audio.play().catch(() => { });
  };

  const playWin = () => {
    if (!enabled) return;
    const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3');
    audio.volume = 0.3;
    audio.play().catch(() => { });
  };

  const playLose = () => {
    if (!enabled) return;
    const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2052/2052-preview.mp3'); // soft thud
    audio.volume = 0.3;
    audio.play().catch(() => { }); // ignore auto-play errors
  };

  return { playClick, playWin, playLose };
}, [enabled]);

// --- Toast Hook ---
const TOAST_DURATION_MS = 3200;

// Safety net for the Google sign-in prompt: if GIS never resolves a moment or
// returns a credential (e.g. a chooser closed in a way GIS does not report),
// the button must not stay disabled forever.
const GOOGLE_PROMPT_TIMEOUT_MS = 60000;

const useToasts = () => {
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);
  const timersRef = useRef(new Map());

  const dismissToast = useCallback((id) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts(current => current.filter(toast => toast.id !== id));
  }, []);

  const notify = useCallback((message, tone = 'info', duration = TOAST_DURATION_MS) => {
    toastIdRef.current += 1;
    const id = `toast-${toastIdRef.current}`;
    const timer = window.setTimeout(() => dismissToast(id), duration);
    timersRef.current.set(id, timer);
    setToasts(current => mergeToast(current, { id, message, tone }).toasts);
  }, [dismissToast]);

  useEffect(() => () => {
    timersRef.current.forEach(timer => window.clearTimeout(timer));
    timersRef.current.clear();
  }, []);

  return { toasts, notify, dismissToast };
};

// --- Components ---

const SettingsModal = ({ show, onClose, config, setConfig, onExport, onDelete, onLogout }) => {
  if (!show) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="modal-overlay"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        className="modal glass settings-modal"
        onClick={e => e.stopPropagation()}
      >
        <h2>Settings</h2>
        {/* Settings Content Restored */}
        <div className="setting-row">
          <div className="setting-label">
            {config.theme === 'dark' ? <Moon size={20} /> : <Sun size={20} />}
            <span>Theme</span>
          </div>
          <button
            className="toggle-pill"
            onClick={() => setConfig(p => ({ ...p, theme: p.theme === 'dark' ? 'light' : 'dark' }))}
          >
            {config.theme === 'dark' ? 'Dark Mode' : 'Light Mode'}
          </button>
        </div>
        <div className="setting-row">
          <div className="setting-label">
            {config.sound ? <Volume2 size={20} /> : <VolumeX size={20} />}
            <span>Sound Effects</span>
          </div>
          <button
            className={`toggle-switch ${config.sound ? 'on' : 'off'}`}
            onClick={() => setConfig(p => ({ ...p, sound: !p.sound }))}
          >
            <motion.div className="handle" layout />
          </button>
        </div>
        <h3>Data & Privacy</h3>
        <div className="btn-stack" style={{ marginTop: '1rem', gap: '0.5rem' }}>
          <button className="btn-teal" onClick={() => onExport && onExport()}>Export My Data</button>
          <button className="btn-gray" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} onClick={() => onLogout && onLogout()}>
            <LogOut size={17} /> Log out (new guest)
          </button>
          <button className="btn-gray" style={{ background: '#ef4444', color: 'white' }} onClick={() => onDelete && onDelete()}>Delete Account</button>
          <p className="settings-hint">Logging out abandons this guest account — progress, coins and unlocks cannot be recovered. You continue as a brand-new guest.</p>
        </div>
        <button className="close-btn" onClick={onClose}>Close</button>
      </motion.div>
    </motion.div>
  );
};

const TopBar = ({ stats, setShowSettings, user, onBuyGems }) => (
  <div className="top-bar">
    <div className="stat-item">
      <Flame size={18} color="#f97316" fill="#f97316" />
      <span>{stats.streak}</span>
    </div>
    <div className="stat-item">
      <Zap size={18} color="#8b5cf6" fill="#8b5cf6" />
      <span>{stats.xp}</span>
    </div>
    <div className="stat-group">
      <button className="stat-item glass clickable" onClick={onBuyGems} aria-label={`Buy gems. Current balance ${user.gems || 0}`}>
        <Gem size={16} color="#2dd4bf" fill="#2dd4bf" />
        <span>{user.gems || 0}</span>
        <div className="plus-btn">+</div>
      </button>
      <div className="stat-item glass">
        <Coins size={16} color="#fbbf24" fill="#fbbf24" />
        <span>{stats.coins.toFixed(2)}</span>
      </div>
    </div>
    <button className="profile-btn-wrapper" onClick={() => setShowSettings(true)} aria-label="Open settings">
      <img src={user.avatar || "https://api.dicebear.com/7.x/avataaars/svg?seed=Agnes"} alt="Avatar" className="profile-img" />
      <div className="settings-badge"><Settings size={12} color="white" /></div>
    </button>
  </div>
);

const BottomNav = ({ activeTab, setActiveTab }) => {
  const tabs = [
    { id: 'home', icon: Home, label: 'Home' },
    { id: 'leaderboard', icon: Trophy, label: 'Ranks' },
    { id: 'battle', icon: Swords, label: 'Battle' },
    { id: 'profile', icon: User, label: 'Me' },
    { id: 'shop', icon: ShoppingBag, label: 'Shop' },
  ];

  return (
    <div className="bottom-nav glass">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            className={`nav-item ${isActive ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            aria-label={tab.label}
            aria-current={isActive ? 'page' : undefined}
          >
            <Icon size={24} className="nav-icon" />
            <span className="nav-label">{tab.label}</span>
            {isActive && <motion.div layoutId="bubble" className="bubble" />}
          </button>
        );
      })}
    </div>
  );
};

// --- PROFILE Activity lists ---

const OUTCOME_LABEL = { won: 'Won', lost: 'Lost', draw: 'Draw' };

const MatchHistoryList = ({ matches, userId }) => {
  if (matches.length === 0) {
    return <p className="activity-empty">No matches yet — play a multiplayer series!</p>;
  }
  return (
    <ul className="activity-list" aria-label="Match history">
      {matches.map(row => {
        const outcome = outcomeFor(row, userId);
        const outcomeLabel = OUTCOME_LABEL[outcome];
        const userSide = Number(row.player_x_id) === Number(userId) ? 'X' : 'O';
        const rounds = row.rounds_played || 0;
        const roundsLabel = `${rounds} ${rounds === 1 ? 'round' : 'rounds'}`;
        const size = row.board_size || 3;
        return (
          <li className="activity-row" key={row.id}>
            <span className="activity-avatar-wrap">
              {row.opponent_avatar ? (
                <img src={row.opponent_avatar} alt="" className="activity-avatar" />
              ) : (
                <span className="activity-avatar activity-avatar-fallback"><User size={18} /></span>
              )}
            </span>
            <div className="activity-main">
              <span className="activity-name">{row.opponent_username || 'Unknown player'}</span>
              <span className="activity-meta">{size}×{size} · {roundsLabel} · {dateText(row.completed_at)}</span>
            </div>
            <div className="activity-result">
              <span className={`outcome-pill outcome-${outcome}`} aria-label={`${outcomeLabel} the series ${scoreText(row)}`}>
                {outcomeLabel}{outcome === 'draw' ? '' : ` · as ${userSide}`}
              </span>
              <span className="activity-score">{scoreText(row)}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
};

const WalletLedgerList = ({ ledger }) => {
  if (ledger.length === 0) {
    return <p className="activity-empty">No wallet activity yet.</p>;
  }
  return (
    <ul className="activity-list" aria-label="Wallet activity">
      {ledger.map(entry => {
        const isCoins = entry.currency === 'coins';
        const positive = Number(entry.amount) > 0;
        const CurrencyIcon = isCoins ? Coins : Gem;
        const currencyLabel = isCoins ? 'Coins' : 'Gems';
        return (
          <li className="activity-row" key={entry.id}>
            <span className={`activity-avatar-wrap currency-badge ${isCoins ? 'currency-coins' : 'currency-gems'}`}>
              <CurrencyIcon size={18} color={isCoins ? '#fbbf24' : '#2dd4bf'} aria-hidden="true" />
            </span>
            <div className="activity-main">
              <span className="activity-name">{friendlyLedgerReason(entry.reason) || currencyLabel}</span>
              <span className="activity-meta">{currencyLabel} · {dateText(entry.created_at)}</span>
            </div>
            <div className="activity-result">
              <span className={`activity-amount ${positive ? 'amount-positive' : 'amount-negative'}`}>{signedAmount(entry)}</span>
              <span className="activity-score">Balance {entry.balance_after}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
};

// --- PROFILE Quests card (daily reward + daily quests) ---

const QuestRewardChip = ({ reward }) => {
  const isCoins = reward && reward.currency === 'coins';
  const Icon = isCoins ? Coins : Gem;
  return (
    <span className={`quest-reward-chip ${isCoins ? 'is-coins' : 'is-gems'}`}>
      <Icon size={13} color={isCoins ? '#fbbf24' : '#2dd4bf'} aria-hidden="true" />
      {rewardLabel(reward)}
    </span>
  );
};

const QuestClaimedButton = () => (
  <button type="button" className="btn-gray quest-claim-btn is-claimed" aria-disabled="true">
    <Check size={13} aria-hidden="true" /> Claimed
  </button>
);

// Self-contained card so the Activity card's shared matches/ledger state
// machine and error handling stay untouched. Quest state lives here and is
// reset on every PROFILE activation (the view unmounts the card) and on
// identity change (the userId effect below), mirroring the App-level
// AbortController + identity-guard pattern used by fetchActivity.
const QuestCard = ({ userId, notify, onBalanceChange }) => {
  // Identity captured at request start; responses from a previous guest must
  // never populate the next guest's quest state.
  const uidRef = useRef(userId);
  useEffect(() => { uidRef.current = userId; }, [userId]);
  const activeRequestRef = useRef(null);

  const [questsDay, setQuestsDay] = useState('');
  const [quests, setQuests] = useState([]);
  const [dailyClaimed, setDailyClaimed] = useState(false);
  const [questsLoading, setQuestsLoading] = useState(false);
  const [questsError, setQuestsError] = useState('');
  const [claimingDaily, setClaimingDaily] = useState(false);
  const [claimingQuestId, setClaimingQuestId] = useState(null);

  const loadQuests = useCallback(async (signal) => {
    const uid = uidRef.current;
    if (!uid) return;
    if (!signal) {
      // Manual retry/refresh: supersede any in-flight GET.
      if (activeRequestRef.current) activeRequestRef.current.abort();
      const controller = new AbortController();
      activeRequestRef.current = controller;
      signal = controller.signal;
    }
    setQuestsLoading(true);
    setQuestsError('');
    try {
      const { data } = await api.get('/api/quests', { signal });
      if (signal.aborted || uidRef.current !== uid) return;
      setQuestsDay(data.day || '');
      setQuests(Array.isArray(data.quests) ? data.quests : []);
      setDailyClaimed(Boolean(data.dailyRewardClaimed));
    } catch (error) {
      if (error?.code === 'ERR_CANCELED' || signal.aborted || uidRef.current !== uid) return;
      setQuestsError('Could not load quests. Check your connection and try again.');
    } finally {
      if (!signal.aborted && uidRef.current === uid) setQuestsLoading(false);
    }
  }, []);

  // Load once per PROFILE activation / identity. The cleanup aborts the
  // in-flight GET when the card unmounts (view change) or userId changes.
  useEffect(() => {
    if (!userId) return;
    setQuests([]);
    setQuestsDay('');
    setDailyClaimed(false);
    setQuestsError('');
    setClaimingDaily(false);
    setClaimingQuestId(null);
    const controller = new AbortController();
    activeRequestRef.current = controller;
    loadQuests(controller.signal);
    return () => {
      controller.abort();
      // A manual refresh (claim/retry) may have superseded this controller;
      // abort that too so nothing settles state after the card unmounts.
      if (activeRequestRef.current && activeRequestRef.current !== controller) activeRequestRef.current.abort();
    };
  }, [userId, loadQuests]);

  const claimDailyReward = async () => {
    if (claimingDaily || dailyClaimed || !uidRef.current) return;
    const uid = uidRef.current;
    setClaimingDaily(true);
    try {
      await api.post('/api/quests/daily-claim');
      if (uidRef.current !== uid) return;
      notify('Daily reward claimed!', 'success');
      await Promise.all([loadQuests(), onBalanceChange && onBalanceChange()]);
    } catch (error) {
      if (uidRef.current !== uid) return;
      const code = error?.response?.data?.code;
      if (code === 'DAILY_REWARD_CLAIMED') {
        // The server had already credited today — trust it and re-sync.
        notify('Daily reward already claimed today.', 'info');
        await loadQuests();
      } else {
        notify('Could not claim the daily reward. Try again.', 'error');
      }
    } finally {
      if (uidRef.current === uid) setClaimingDaily(false);
    }
  };

  const claimQuestReward = async (questId) => {
    if (claimingQuestId || !uidRef.current) return;
    const uid = uidRef.current;
    setClaimingQuestId(questId);
    try {
      const { data } = await api.post(`/api/quests/${questId}/claim`);
      if (uidRef.current !== uid) return;
      notify(`Reward claimed: ${rewardLabel(data && data.reward)}`, 'success');
      await Promise.all([loadQuests(), onBalanceChange && onBalanceChange()]);
    } catch (error) {
      if (uidRef.current !== uid) return;
      const code = error?.response?.data?.code;
      if (code === 'QUEST_ALREADY_CLAIMED') {
        notify('Quest reward already claimed.', 'info');
        await loadQuests();
      } else if (code === 'QUEST_INCOMPLETE') {
        notify('Quest is not complete yet — keep playing!', 'error');
      } else if (code === 'UNKNOWN_QUEST') {
        notify('Quest not found. Try again later.', 'error');
      } else {
        notify('Could not claim the quest reward. Try again.', 'error');
      }
    } finally {
      if (uidRef.current === uid) setClaimingQuestId(null);
    }
  };

  const showContent = quests.length > 0 && !questsError;

  return (
    <div className="quest-card glass">
      <div className="activity-head quest-head">
        <h3 className="activity-title">Quests</h3>
        {questsDay && <span className="quest-head-day">Today · {questsDay}</span>}
      </div>

      {questsError ? (
        <div className="activity-state" role="alert">
          <AlertTriangle size={18} className="activity-state-icon" />
          <p>{questsError}</p>
          <button type="button" className="btn-gray activity-retry" onClick={() => loadQuests()}>Try again</button>
        </div>
      ) : questsLoading && !showContent ? (
        <p className="activity-state" role="status">Loading quests…</p>
      ) : (
        <div className="quest-pane">
          <div className={`quest-daily ${dailyClaimed ? 'is-claimed' : ''}`} role="group" aria-label={dailyRewardCopy()}>
            <span className="quest-daily-icon" aria-hidden="true">
              <Gift size={19} />
            </span>
            <div className="quest-daily-main">
              <span className="quest-daily-title">Daily reward</span>
              <div className="quest-daily-chips">
                <QuestRewardChip reward={{ currency: 'coins', amount: DAILY_REWARD.coins }} />
                <QuestRewardChip reward={{ currency: 'gems', amount: DAILY_REWARD.gems }} />
              </div>
            </div>
            {dailyClaimed ? (
              <QuestClaimedButton />
            ) : (
              <button
                type="button"
                className="btn-teal quest-claim-btn"
                onClick={claimDailyReward}
                disabled={claimingDaily}
                aria-busy={claimingDaily}
              >
                {claimingDaily ? 'Claiming…' : 'Claim daily reward'}
              </button>
            )}
          </div>

          {quests.length === 0 ? (
            <p className="activity-empty">No quests available right now — check back soon!</p>
          ) : (
            <ul className="quest-list" aria-label="Daily quests">
              {quests.map(quest => {
                const KindIcon = quest.kind === 'win' ? Trophy : Swords;
                const complete = questComplete(quest);
                const claimable = canClaimQuest(quest);
                const claiming = claimingQuestId === quest.id;
                const percent = Math.min(100, Math.max(0, (Number(quest.progress) / (Number(quest.target) || 1)) * 100));
                return (
                  <li className={`quest-row ${complete ? 'is-complete' : ''}`} key={quest.id}>
                    <span className="quest-kind-badge" data-kind={quest.kind} aria-hidden="true">
                      <KindIcon size={18} color={quest.kind === 'win' ? '#fbbf24' : '#49d6b4'} />
                    </span>
                    <div className="quest-main">
                      <span className="quest-name">{quest.description}</span>
                      <div className="quest-track" aria-hidden="true">
                        <div className="quest-track-fill" style={{ width: `${percent}%` }} />
                      </div>
                      <div className="quest-meta">
                        <span className="quest-count">{questProgressLabel(quest)}</span>
                        <QuestRewardChip reward={quest.reward} />
                      </div>
                    </div>
                    {quest.claimed ? (
                      <QuestClaimedButton />
                    ) : (
                      <button
                        type="button"
                        className={`quest-claim-btn ${claimable ? 'btn-teal' : 'btn-gray'}`}
                        onClick={() => claimQuestReward(quest.id)}
                        disabled={!claimable || claiming}
                        aria-busy={claiming}
                        aria-label={claimable ? `Claim ${rewardLabel(quest.reward)}` : undefined}
                      >
                        {claiming ? 'Claiming…' : 'Claim'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

// --- PROFILE Achievements card (lifetime milestones) ---

// Tile icon map keyed by the pure achievementIconKey() helper's output;
// the server catalog may grow new ids, which all fall back to 'trophy'.
const ACHIEVEMENT_ICONS = {
  trophy: Trophy,
  award: Award,
  flame: Flame,
  target: Target,
  crown: Crown,
  bag: ShoppingBag,
};

// Mirrors QuestCard's fetch/abort/identity-guard pattern: achievements are
// loaded once per PROFILE activation / identity change, and the server
// stamps Cache-Control: no-store because claim state is personal. Claiming
// re-fetches the list and asks the parent to refresh balances.
const AchievementsCard = ({ userId, notify, onBalanceChange }) => {
  // Identity captured at request start; responses from a previous guest must
  // never populate the next guest's achievement state.
  const uidRef = useRef(userId);
  useEffect(() => { uidRef.current = userId; }, [userId]);
  const activeRequestRef = useRef(null);

  const [achievements, setAchievements] = useState([]);
  const [achievementsLoading, setAchievementsLoading] = useState(false);
  const [achievementsError, setAchievementsError] = useState('');
  const [claimingId, setClaimingId] = useState(null);

  const loadAchievements = useCallback(async (signal) => {
    const uid = uidRef.current;
    if (!uid) return;
    if (!signal) {
      // Manual retry/refresh: supersede any in-flight GET.
      if (activeRequestRef.current) activeRequestRef.current.abort();
      const controller = new AbortController();
      activeRequestRef.current = controller;
      signal = controller.signal;
    }
    setAchievementsLoading(true);
    setAchievementsError('');
    try {
      const { data } = await api.get('/api/achievements', { signal });
      if (signal.aborted || uidRef.current !== uid) return;
      setAchievements(Array.isArray(data.achievements) ? data.achievements : []);
    } catch (error) {
      if (error?.code === 'ERR_CANCELED' || signal.aborted || uidRef.current !== uid) return;
      setAchievementsError('Could not load achievements. Check your connection and try again.');
    } finally {
      if (!signal.aborted && uidRef.current === uid) setAchievementsLoading(false);
    }
  }, []);

  // Load once per PROFILE activation / identity. The cleanup aborts the
  // in-flight GET when the card unmounts (view change) or userId changes.
  useEffect(() => {
    if (!userId) return;
    setAchievements([]);
    setAchievementsError('');
    setClaimingId(null);
    const controller = new AbortController();
    activeRequestRef.current = controller;
    loadAchievements(controller.signal);
    return () => {
      controller.abort();
      // A manual refresh (claim/retry) may have superseded this controller;
      // abort that too so nothing settles state after the card unmounts.
      if (activeRequestRef.current && activeRequestRef.current !== controller) activeRequestRef.current.abort();
    };
  }, [userId, loadAchievements]);

  const claimAchievement = async (achievementId) => {
    if (claimingId || !uidRef.current) return;
    const uid = uidRef.current;
    setClaimingId(achievementId);
    try {
      const { data } = await api.post(`/api/achievements/${achievementId}/claim`);
      if (uidRef.current !== uid) return;
      notify(`Reward claimed: ${rewardLabel(data && data.reward)}`, 'success');
      await Promise.all([loadAchievements(), onBalanceChange && onBalanceChange()]);
    } catch (error) {
      if (uidRef.current !== uid) return;
      const code = error?.response?.data?.code;
      if (code === 'ACHIEVEMENT_ALREADY_CLAIMED') {
        notify('Achievement reward already claimed.', 'info');
        await loadAchievements();
      } else if (code === 'ACHIEVEMENT_INCOMPLETE') {
        notify('Achievement not unlocked yet — keep playing!', 'error');
      } else if (code === 'UNKNOWN_ACHIEVEMENT') {
        notify('Achievement not found. Try again later.', 'error');
      } else {
        notify('Could not claim the achievement reward. Try again.', 'error');
      }
    } finally {
      if (uidRef.current === uid) setClaimingId(null);
    }
  };

  const showContent = achievements.length > 0 && !achievementsError;

  return (
    <div className="achievements-card glass">
      <div className="activity-head achievements-head">
        <h3 className="activity-title">Achievements</h3>
      </div>

      {achievementsError ? (
        <div className="activity-state" role="alert">
          <AlertTriangle size={18} className="activity-state-icon" />
          <p>{achievementsError}</p>
          <button type="button" className="btn-gray activity-retry" onClick={() => loadAchievements()}>Try again</button>
        </div>
      ) : achievementsLoading && !showContent ? (
        <p className="activity-state" role="status">Loading achievements…</p>
      ) : achievements.length === 0 ? (
        <p className="activity-empty">No achievements yet — play more multiplayer to unlock your first one!</p>
      ) : (
        <ul className="achievements-grid" aria-label="Achievements">
          {achievements.map(achievement => {
            const state = tileStateClass(achievement);
            const Icon = ACHIEVEMENT_ICONS[achievementIconKey(achievement && achievement.id)] || Trophy;
            const claiming = claimingId === achievement.id;
            const showClaim = claimButtonLabel(achievement);
            return (
              <li key={achievement && achievement.id} className={`achievement-tile is-${state}`}>
                <div className="achievement-tile-head">
                  <span className="achievement-tile-icon" aria-hidden="true">
                    <Icon size={20} />
                  </span>
                  <span className="achievement-tile-title">{achievement.title || achievement.id}</span>
                </div>
                {achievement.description && (
                  <p className="achievement-tile-desc">{achievement.description}</p>
                )}
                <div className="achievement-tile-foot">
                  <QuestRewardChip reward={achievement.reward} />
                  {state === 'claimed' ? (
                    <QuestClaimedButton />
                  ) : showClaim ? (
                    <button
                      type="button"
                      className="btn-teal achievement-claim-btn"
                      onClick={() => claimAchievement(achievement.id)}
                      disabled={claiming}
                      aria-busy={claiming}
                      aria-label={`Claim ${rewardLabel(achievement.reward)}`}
                    >
                      {claiming ? 'Claiming…' : 'Claim'}
                    </button>
                  ) : (
                    <span className="achievement-locked">
                      <Lock size={12} aria-hidden="true" />
                      Locked
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

// --- New Modals per Screenshots ---

const BuyGemsModal = ({ show, onClose, packages, onBuy }) => {
  if (!show) return null;

  return (
    <div className="modal-backdrop">
      <motion.div
        className="modal-content light-theme"
        style={{ maxWidth: '500px' }}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
      >
        <h2 className="modal-title-dark">Buy Gems</h2>
        <p className="wallet-status">Gem amounts and prices are verified by the server before payment.</p>

        <div className="gem-grid">
          {packages.map((pkg, i) => (
            <div className="gem-card" key={i}>
              <div className="gem-amount">
                <Gem size={16} color="#2dd4bf" fill="#2dd4bf" /> {pkg.gems}
              </div>
              <div className="gem-label">Gems</div>
              <div className="token-cost">₦{pkg.amountNgn.toLocaleString()}</div>
              <button
                className="btn-buy-sm"
                onClick={() => onBuy(pkg.id)}
              >
                Buy
              </button>
            </div>
          ))}
        </div>

        <button className="btn-cancel full-width" onClick={onClose}>Cancel</button>
      </motion.div>
    </div>
  );
};

const ShopItemModal = ({ show, onClose, item, user, onBuy, onCannotAfford }) => {
  if (!show || !item) return null;
  const currency = item.currency === 'coins' ? 'coins' : 'gems';
  const cost = itemCost(item);
  const canAfford = (user[currency] || 0) >= cost;
  const showShortfall = !canAfford && cost > 0;

  return (
    <div className="modal-backdrop glass-backdrop">
      <motion.div
        className="modal-content blur-theme"
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
      >
        <div className="item-preview-large">
          <img src={item.url} alt={item.name} />
        </div>

        <h2 className="item-title">{item.name}</h2>
        <div className="item-price">
          {cost} {currency === 'coins' ? <Coins size={18} color="#fbbf24" fill="#fbbf24" /> : <Gem size={18} color="#2dd4bf" fill="#2dd4bf" />}
        </div>
        {showShortfall && (
          <p className="item-shortfall">{shortfallText(item, user[currency])}</p>
        )}

        <p className="item-desc">{item.description || "Unlock this exclusive item for your collection."}</p>

        <button
          className={`btn-action-lg ${canAfford ? 'btn-purple' : 'btn-disabled'}`}
          onClick={() => {
            if (canAfford) {
              onBuy(item.id);
            } else if (onCannotAfford) {
              // Never dead-end a click: explain how to earn the currency.
              onCannotAfford(item);
            }
          }}
        >
          {canAfford ? 'Unlock Item' : insufficientLabel(item)}
        </button>

        <button className="btn-close-white" onClick={onClose}>Close</button>
      </motion.div>
    </div>
  );
};

// --- Multiplayer Menu Modals ---

const MultiplayerMenu = ({ show, onClose, onHost, onJoin, onPlayStranger }) => {
  if (!show) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <motion.div
        className="modal-content multiplayer-menu"
        onClick={e => e.stopPropagation()}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
      >
        <h2 className="modal-title">Play with Human</h2>
        <div className="btn-stack">
          <button className="btn-pink" onClick={onHost}>Host Game</button>
          <button className="btn-teal" onClick={onJoin}>Join Game</button>
          <button className="btn-orange" onClick={onPlayStranger}>Play with Stranger</button>
          <button className="btn-gray" onClick={onClose}>Cancel</button>
        </div>
      </motion.div>
    </div>
  );
};

const HostGameModal = ({ show, onClose, onStart }) => {
  const [rounds, setRounds] = useState(3);
  const [size, setSize] = useState(3);

  if (!show) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <motion.div
        className="modal-content multiplayer-menu"
        onClick={e => e.stopPropagation()}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
      >
        <h2 className="modal-title">Host Game</h2>

        <div className="config-section">
          <label className="config-label">Number of Rounds</label>
          <div className="pill-group">
            {[1, 3, 5].map(r => (
              <button
                key={r}
                className={`pill-btn ${rounds === r ? 'active' : ''}`}
                onClick={() => setRounds(r)}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <div className="config-section">
          <label className="config-label">Board Size</label>
          <div className="pill-group">
            {[3, 4, 5].map(s => (
              <button
                key={s}
                className={`pill-btn ${size === s ? 'active' : ''}`}
                onClick={() => setSize(s)}
              >
                {s} x {s}
              </button>
            ))}
          </div>
        </div>

        <div className="btn-stack">
          <button className="btn-pink" onClick={() => onStart(rounds, size)}>Create Game</button>
          <button className="btn-gray" onClick={onClose}>Cancel</button>
        </div>
      </motion.div>
    </div>
  );
};

const roomErrorMessage = (error) => ({
  'Room not found': 'That room no longer exists. Ask the host for a fresh invite.',
  'Room full': 'That room already has two players.',
  'Invalid room ID': 'Enter a valid room code or Noughtline invite link.',
  'No active room to resume': 'The previous room is no longer available.',
}[error] || error || 'The room could not be joined. Try again.');

const JoinRoomModal = ({ show, initialCode = '', connected, onClose, onJoin }) => {
  const [code, setCode] = useState(initialCode);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!show) return;
    setCode(initialCode || '');
    setError('');
    setSubmitting(false);
  }, [show, initialCode]);

  if (!show) return null;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!connected) {
      setError('Reconnect to Noughtline before joining this room.');
      return;
    }
    const roomId = normalizeRoomId(code);
    if (!roomId) {
      setError('Enter a valid room code or Noughtline invite link.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const result = await onJoin(roomId);
      if (result?.error) setError(roomErrorMessage(result.error));
    } catch {
      setError('The room could not be joined. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={submitting ? undefined : onClose}>
      <motion.form
        className="modal-content multiplayer-menu"
        role="dialog"
        aria-modal="true"
        aria-labelledby="join-room-title"
        aria-describedby="join-room-description"
        onClick={event => event.stopPropagation()}
        onKeyDown={event => {
          if (event.key === 'Escape' && !submitting) onClose();
        }}
        onSubmit={handleSubmit}
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
      >
        <div className="modal-heading-icon"><Link2 size={20} /></div>
        <h2 id="join-room-title" className="modal-title">Join a room</h2>
        <p id="join-room-description" className="modal-description">Paste a room code or the full invite link.</p>
        <label className="config-label" htmlFor="room-code">Room code or invite</label>
        <input
          id="room-code"
          className="room-code-input"
          value={code}
          onChange={event => { setCode(event.target.value); setError(''); }}
          placeholder="ROOM_ABC123"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck="false"
          maxLength={256}
          autoFocus
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'join-room-error' : undefined}
        />
        {error && <p id="join-room-error" className="form-error" role="alert">{error}</p>}
        <div className="btn-stack">
          <button className="btn-pink" type="submit" disabled={submitting || !connected}>
            {!connected ? 'Connecting…' : submitting ? 'Joining…' : 'Join room'}
          </button>
          <button className="btn-gray" type="button" onClick={onClose} disabled={submitting}>Cancel</button>
        </div>
      </motion.form>
    </div>
  );
};

const GameCreatedModal = ({ show, onClose, roomId, onStart }) => {
  const [shareStatus, setShareStatus] = useState('');

  useEffect(() => {
    if (show) setShareStatus('');
  }, [show, roomId]);

  if (!show) return null;
  const inviteUrl = createInviteUrl(roomId, window.location.origin);

  const handleCopy = async (value = inviteUrl, successState = 'copied') => {
    try {
      await navigator.clipboard.writeText(value);
      setShareStatus(successState);
    } catch {
      setShareStatus('error');
    }
  };

  const handleShare = async () => {
    if (!navigator.share) return handleCopy(inviteUrl, 'copied');
    try {
      await navigator.share({
        title: 'Join my Noughtline match',
        text: `Join my Noughtline room ${roomId}`,
        url: inviteUrl,
      });
      setShareStatus('shared');
    } catch (error) {
      if (error.name !== 'AbortError') setShareStatus('error');
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <motion.div
        className="modal-content multiplayer-menu"
        role="dialog"
        aria-modal="true"
        aria-labelledby="room-ready-title"
        aria-describedby="room-ready-description"
        onClick={event => event.stopPropagation()}
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
      >
        <div className="modal-heading-icon"><Link2 size={20} /></div>
        <h2 id="room-ready-title" className="modal-title">Room ready</h2>
        <p id="room-ready-description" className="modal-description">Send this invite to your opponent, then enter the board while you wait.</p>

        <div className="invite-code-panel">
          <span className="invite-code-label">Room code</span>
          <strong>{roomId}</strong>
          <span className="invite-url">{inviteUrl}</span>
        </div>

        <div className="share-actions">
          <button type="button" className="btn-gray" onClick={() => handleCopy(inviteUrl, 'copied')}>
            {shareStatus === 'copied' ? <Check size={17} /> : <Copy size={17} />}
            {shareStatus === 'copied' ? 'Copied' : 'Copy invite'}
          </button>
          <button type="button" className="btn-gray" onClick={() => handleCopy(roomId, 'code-copied')}>
            {shareStatus === 'code-copied' ? <Check size={17} /> : <Copy size={17} />}
            {shareStatus === 'code-copied' ? 'Code copied' : 'Copy code'}
          </button>
          <button type="button" className="btn-gray" onClick={handleShare}>
            <Share2 size={17} /> Share
          </button>
        </div>
        <p className={`share-feedback ${shareStatus === 'error' ? 'error' : ''}`} role="status" aria-live="polite">
          {shareStatus === 'copied' && 'Invite link copied.'}
          {shareStatus === 'code-copied' && 'Room code copied.'}
          {shareStatus === 'shared' && 'Invite shared.'}
          {shareStatus === 'error' && 'Could not share automatically. Copy the room code instead.'}
        </p>

        <div className="btn-stack">
          <button className="btn-pink" onClick={onStart}>Enter waiting room</button>
          <button className="btn-gray" onClick={onClose}>Not now</button>
        </div>
      </motion.div>
    </div>
  );
};

const SearchingMatchModal = ({ show, onCancel }) => {
  if (!show) return null;

  return (
    <div className="modal-backdrop">
      <motion.div
        className="modal-content multiplayer-menu"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
      >
        <div className="searching-loader">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            className="loader-icon"
          >
            <Swords size={48} color="var(--accent-pink)" />
          </motion.div>
        </div>
        <h2 className="modal-title">Finding Opponent...</h2>
        <p style={{ color: '#64748b', marginBottom: '2rem' }}>Searching for a worthy stranger...</p>
        <button className="btn-gray" onClick={onCancel}>Cancel</button>
      </motion.div>
    </div>
  );
};

const handleDialogKeyDown = (event, pending, onClose) => {
  if (event.key === 'Escape' && !pending) {
    event.preventDefault();
    onClose();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = [...event.currentTarget.querySelectorAll('button:not(:disabled), [href], input:not(:disabled)')];
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
};

const FallbackModal = ({ show, onPlayAI, onBackToMenu }) => {
  if (!show) return null;

  return (
    <div className="modal-backdrop" onClick={onBackToMenu}>
      <motion.div
        className="modal-content multiplayer-menu"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fallback-ai-title"
        aria-describedby="fallback-ai-description"
        onClick={event => event.stopPropagation()}
        onKeyDown={event => handleDialogKeyDown(event, false, onBackToMenu)}
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
      >
        <div className="modal-heading-icon"><Zap size={21} /></div>
        <h2 id="fallback-ai-title" className="modal-title">No opponent found</h2>
        <p id="fallback-ai-description" className="modal-description">
          No stranger matched in the queue. Play a medium 3×3 AI game instead?
        </p>
        <div className="btn-stack">
          <button type="button" className="btn-pink" onClick={onPlayAI}>
            <Zap size={17} /> Play vs AI
          </button>
          <button type="button" className="btn-gray" onClick={onBackToMenu} autoFocus>
            Back to menu
          </button>
        </div>
      </motion.div>
    </div>
  );
};

const LeaveRoomModal = ({ show, gameStatus, hasOpponent, pending, onCancel, onConfirm }) => {
  if (!show) return null;
  const abandonsInvite = gameStatus === 'waiting' && !hasOpponent;
  const title = abandonsInvite ? 'Leave waiting room?' : 'Forfeit this match?';
  const description = abandonsInvite
    ? 'This closes the room and the invite link will stop working.'
    : 'Your opponent will immediately win the series. This cannot be undone.';

  return (
    <div className="modal-backdrop" onClick={pending ? undefined : onCancel}>
      <motion.div
        className="modal-content multiplayer-menu leave-room-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-busy={pending}
        aria-labelledby="leave-room-title"
        aria-describedby="leave-room-description"
        onClick={event => event.stopPropagation()}
        onKeyDown={event => handleDialogKeyDown(event, pending, onCancel)}
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
      >
        <div className="modal-heading-icon danger"><AlertTriangle size={21} /></div>
        <h2 id="leave-room-title" className="modal-title">{title}</h2>
        <p id="leave-room-description" className="modal-description">{description}</p>
        <div className="btn-stack">
          <button type="button" className="btn-danger" onClick={onConfirm} disabled={pending}>
            <LogOut size={17} /> {pending ? 'Leaving…' : abandonsInvite ? 'Leave room' : 'Forfeit match'}
          </button>
          <button type="button" className="btn-gray" onClick={onCancel} disabled={pending} autoFocus>
            {abandonsInvite ? 'Stay in room' : 'Stay in match'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

const ConfirmDialog = ({
  show,
  title,
  description,
  confirmLabel,
  pendingLabel = 'Working…',
  busy = false,
  onCancel,
  onConfirm,
}) => {
  if (!show) return null;

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onCancel}>
      <motion.div
        className="modal-content multiplayer-menu leave-room-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-busy={busy}
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        onClick={event => event.stopPropagation()}
        onKeyDown={event => handleDialogKeyDown(event, busy, onCancel)}
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
      >
        <div className="modal-heading-icon danger"><AlertTriangle size={21} /></div>
        <h2 id="confirm-dialog-title" className="modal-title">{title}</h2>
        <p id="confirm-dialog-description" className="modal-description">{description}</p>
        <div className="btn-stack">
          <button type="button" className="btn-danger" onClick={onConfirm} disabled={busy}>
            {busy ? pendingLabel : confirmLabel}
          </button>
          <button type="button" className="btn-gray" onClick={onCancel} disabled={busy} autoFocus>
            Cancel
          </button>
        </div>
      </motion.div>
    </div>
  );
};

const ActiveRoomModal = ({ roomId, pending, onResume, onCopy, onClose }) => {
  if (!roomId) return null;
  return (
    <div className="modal-backdrop" onClick={pending ? undefined : onClose}>
      <motion.div
        className="modal-content multiplayer-menu"
        role="dialog"
        aria-modal="true"
        aria-busy={pending}
        aria-labelledby="active-room-title"
        aria-describedby="active-room-description"
        onClick={event => event.stopPropagation()}
        onKeyDown={event => handleDialogKeyDown(event, pending, onClose)}
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
      >
        <div className="modal-heading-icon"><Swords size={21} /></div>
        <h2 id="active-room-title" className="modal-title">You already have a match</h2>
        <p id="active-room-description" className="modal-description">Resume your current room before starting another.</p>
        <div className="invite-code-panel"><span>Active room</span><strong>{roomId}</strong></div>
        <div className="btn-stack">
          <button type="button" className="btn-pink" onClick={onResume} disabled={pending} autoFocus>{pending ? 'Resuming…' : 'Resume match'}</button>
          <button type="button" className="btn-gray" onClick={onCopy}><Copy size={17} /> Copy invite</button>
          <button type="button" className="btn-gray" onClick={onClose} disabled={pending}>Close</button>
        </div>
      </motion.div>
    </div>
  );
};

// --- Game Logic Hooks ---

const socket = getSocket();

const useTicTacToe = (gameConfig, setGameConfig, sounds, user) => {
  const { size: boardSize, mode, roomId, difficulty, roomSnapshot } = gameConfig;
  const [board, setBoard] = useState(Array(boardSize * boardSize).fill(null));
  const [isXNext, setIsXNext] = useState(true);
  const [winner, setWinner] = useState(null);
  const [seriesWinner, setSeriesWinner] = useState(null);
  const [winningLine, setWinningLine] = useState([]);
  const [isActionPending, setIsActionPending] = useState(false); // For network ops
  const [mySymbol, setMySymbol] = useState('X');
  const [gameStatus, setGameStatus] = useState('waiting');
  const [round, setRound] = useState(1);
  const [score, setScore] = useState({ X: 0, O: 0 });
  const [roomPlayers, setRoomPlayers] = useState([]);
  const [disconnectDeadline, setDisconnectDeadline] = useState(null);
  const [completionReason, setCompletionReason] = useState(null);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    // Reset Logic
    setBoard(Array(boardSize * boardSize).fill(null));
    setIsXNext(true);
    setWinner(null);
    setSeriesWinner(null);
    setWinningLine([]);
    setIsActionPending(false);
    setGameStatus(mode === 'singleplayer' ? 'active' : 'waiting');
    setRound(1);
    setScore({ X: 0, O: 0 });
    setRoomPlayers([]);
    setDisconnectDeadline(null);
    setCompletionReason(null);
    setActionError('');
    if (mode === 'singleplayer') setMySymbol('X');

    if (mode === 'multiplayer' && roomId) {
      const handleRoomUpdate = (room) => {
        setBoard(room.state.board);
        setIsXNext(room.state.isXNext);
        setWinner(room.state.winner);
        setSeriesWinner(room.state.seriesWinner || null);
        setWinningLine(room.state.winningLine);
        setGameStatus(room.state.status);
        setRound(room.state.round);
        setScore(room.state.score);
        setRoomPlayers(room.players || []);
        setDisconnectDeadline(room.state.disconnectDeadline || null);
        setCompletionReason(room.state.completionReason || null);
        setActionError('');
        setIsActionPending(false);
        saveActiveRoom(localStorage, room.id);

        const me = room.players.find(player => player.id === user.id);
        if (me) setMySymbol(me.symbol);

        const opponent = room.players.find(player => player.id !== user.id);
        setGameConfig(previous => ({
          ...previous,
          opponentName: opponent?.username || null,
          opponentAvatar: opponent?.avatar || null,
        }));

        if (room.config && room.config.size !== boardSize) {
          setGameConfig(previous => ({ ...previous, size: room.config.size }));
        }
      };

      const handleGameError = (error) => {
        setIsActionPending(false);
        setActionError(typeof error === 'string' ? error : error?.error || 'The game action could not be completed.');
      };

      socket.on('room_update', handleRoomUpdate);
      socket.on('game_error', handleGameError);
      if (roomSnapshot?.id === roomId) handleRoomUpdate(roomSnapshot);

      return () => {
        socket.off('room_update', handleRoomUpdate);
        socket.off('game_error', handleGameError);
      };
    }
  }, [boardSize, mode, roomId, roomSnapshot, setGameConfig, user.id, user.username]);

  const calculateWinner = (squares) => {
    const lines = [];
    // Rows
    for (let i = 0; i < boardSize; i++) {
      const row = [];
      for (let j = 0; j < boardSize; j++) row.push(i * boardSize + j);
      lines.push(row);
    }
    // Columns
    for (let i = 0; i < boardSize; i++) {
      const col = [];
      for (let j = 0; j < boardSize; j++) col.push(i + j * boardSize);
      lines.push(col);
    }
    // Diagonals
    const diag1 = [];
    const diag2 = [];
    for (let i = 0; i < boardSize; i++) {
      diag1.push(i * boardSize + i);
      diag2.push(i * boardSize + (boardSize - 1 - i));
    }
    lines.push(diag1, diag2);

    for (let line of lines) {
      const first = squares[line[0]];
      if (first && line.every(index => squares[index] === first)) {
        return { winner: first, line };
      }
    }
    if (squares.every(s => s !== null)) return { winner: 'Draw', line: [] };
    return null;
  };

  // Client-side Minimax (Only for Singleplayer)
  const minimax = (squares, depth, isMaximizing, alpha, beta) => {
    const res = calculateWinner(squares);
    if (res?.winner === 'O') return 10 - depth;
    if (res?.winner === 'X') return depth - 10;
    if (res?.winner === 'Draw') return 0;

    // Depth limit for performance on larger boards
    if (depth > 3 && boardSize > 3) return 0;

    if (isMaximizing) {
      let bestScore = -Infinity;
      for (let i = 0; i < squares.length; i++) {
        if (!squares[i]) {
          squares[i] = 'O';
          let score = minimax(squares, depth + 1, false, alpha, beta);
          squares[i] = null;
          bestScore = Math.max(score, bestScore);
          alpha = Math.max(alpha, bestScore);
          if (beta <= alpha) break;
        }
      }
      return bestScore;
    } else {
      let bestScore = Infinity;
      for (let i = 0; i < squares.length; i++) {
        if (!squares[i]) {
          squares[i] = 'X';
          let score = minimax(squares, depth + 1, true, alpha, beta);
          squares[i] = null;
          bestScore = Math.min(score, bestScore);
          beta = Math.min(beta, bestScore);
          if (beta <= alpha) break;
        }
      }
      return bestScore;
    }
  };

  const makeAIMove = (currentBoard) => {
    const emptyIndices = currentBoard.map((s, i) => s === null ? i : null).filter(i => i !== null);
    if (emptyIndices.length === 0 || winner) return;

    let move;
    if (difficulty === 'easy') {
      move = emptyIndices[Math.floor(Math.random() * emptyIndices.length)];
    } else if (difficulty === 'medium') {
      if (Math.random() > 0.6) move = findBestMove(currentBoard);
      else move = emptyIndices[Math.floor(Math.random() * emptyIndices.length)];
    } else {
      move = findBestMove(currentBoard);
    }

    if (move === undefined) move = emptyIndices[0];

    const newBoard = [...currentBoard];
    newBoard[move] = 'O';
    setBoard(newBoard);
    setIsXNext(true);

    sounds.playClick();

    const result = calculateWinner(newBoard);
    if (result) {
      setWinner(result.winner);
      setWinningLine(result.line);
    }
  };

  const findBestMove = (squares) => {
    let bestScore = -Infinity;
    let move;

    // Fast path for first move
    if (squares.filter(x => x).length === 1 && squares[Math.floor(squares.length / 2)] === null) {
      return Math.floor(squares.length / 2);
    }

    // Simplified for large boards if not near end game
    if (boardSize > 3 && squares.filter(s => s === null).length > 12) {
      const empty = squares.map((s, i) => s === null ? i : null).filter(i => i !== null);
      return empty[Math.floor(Math.random() * empty.length)];
    }

    for (let i = 0; i < squares.length; i++) {
      if (!squares[i]) {
        squares[i] = 'O';
        let score = minimax(squares, 0, false, -Infinity, Infinity);
        squares[i] = null;
        if (score > bestScore) {
          bestScore = score;
          move = i;
        }
      }
    }
    return move;
  };

  const handleClick = (i) => {
    if (winner || board[i] || isActionPending) return;

    if (mode === 'multiplayer') {
      if (gameStatus !== 'active') return;
      setIsActionPending(true);
      socket.emit('make_move', { roomId, index: i });
      sounds.playClick();
      return;
    }

    // Singleplayer logic
    if (!isXNext) return;

    const newBoard = [...board];
    newBoard[i] = 'X';
    setBoard(newBoard);
    setIsXNext(false);

    sounds.playClick();

    const result = calculateWinner(newBoard);
    if (result) {
      setWinner(result.winner);
      setWinningLine(result.line);
    } else {
      setTimeout(() => makeAIMove(newBoard), 500);
    }
  };

  const resetGame = () => {
    if (mode === 'multiplayer') return;
    setBoard(Array(boardSize * boardSize).fill(null));
    setIsXNext(true);
    setWinner(null);
    setSeriesWinner(null);
    setWinningLine([]);
  };

  const readyNextRound = () => socket.emit('ready_next_round', { roomId });
  const requestRematch = () => socket.emit('request_rematch', { roomId });

  return {
    board, handleClick, winner, seriesWinner, winningLine, isXNext, resetGame, mySymbol,
    gameStatus, round, score, readyNextRound, requestRematch, roomPlayers,
    disconnectDeadline, completionReason, actionError,
  };
};

// --- Room Chat (multiplayer GAME view) ---

// Ephemeral per-room messenger shown inside the multiplayer GAME view. The
// server broadcasts every accepted message back to the room (sender included)
// and keeps no history, so the list is fed purely by 'chat_message' events,
// deduped by id and capped at MAX_CHAT_MESSAGES. Because the panel only
// mounts while a multiplayer room is active, leaving the room (roomId -> null)
// unmounts it and tears the listener down — stale broadcasts from a previous
// room can never be appended.
const RoomChat = ({ roomId, userId, notify }) => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [chatDisabled, setChatDisabled] = useState(false);
  const [rateLimitUntil, setRateLimitUntil] = useState(null);
  const [rateLeftSec, setRateLeftSec] = useState(0);
  const seenIdsRef = useRef(new Set());
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const justOpenedRef = useRef(false);

  // Room changed or chat left: drop all transient state so a new room never
  // inherits the previous room's messages, draft, or errors.
  useEffect(() => {
    setMessages([]);
    seenIdsRef.current = new Set();
    setDraft('');
    setSending(false);
    setSendError('');
    setChatDisabled(false);
    setRateLimitUntil(null);
    setRateLeftSec(0);
    setOpen(false);
  }, [roomId]);

  // Bind the room chat listener for the current room only. Events for other
  // rooms (or replays of the same id) are ignored.
  useEffect(() => {
    if (!roomId) return undefined;
    const handleChatMessage = (message) => {
      if (!message || message.roomId !== roomId) return;
      if (message.id !== null && message.id !== undefined && seenIdsRef.current.has(message.id)) return;
      setMessages(current => pushChatMessage(current, message, seenIdsRef.current).messages);
    };
    socket.on('chat_message', handleChatMessage);
    return () => { socket.off('chat_message', handleChatMessage); };
  }, [roomId]);

  // Count down the server rate-limit retry window (CHAT_RATE_LIMITED ack).
  useEffect(() => {
    if (rateLimitUntil === null) return undefined;
    const update = () => {
      const left = Math.max(0, Math.ceil((rateLimitUntil - Date.now()) / 1000));
      setRateLeftSec(left);
      if (left === 0) setRateLimitUntil(null);
    };
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [rateLimitUntil]);

  // A mid-flight disconnect may never deliver an ack: never leave the send
  // button stuck disabled.
  useEffect(() => {
    const onDisconnect = () => setSending(false);
    socket.on('disconnect', onDisconnect);
    return () => { socket.off('disconnect', onDisconnect); };
  }, []);

  // Focus the composer when the panel opens (and let the auto-scroll below
  // know this is a fresh open, not a follow-on append while reading history).
  useEffect(() => {
    justOpenedRef.current = open;
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  // Auto-scroll to the newest message when open — unless the player has
  // scrolled up to read older messages, in which case leave them alone.
  useEffect(() => {
    const el = listRef.current;
    if (!open || !el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    if (nearBottom || justOpenedRef.current) el.scrollTop = el.scrollHeight;
    justOpenedRef.current = false;
  }, [messages, open]);

  const sendMessage = () => {
    if (sending || rateLimitUntil !== null) return;
    if (!socket.connected) {
      setSendError('Reconnect to Noughtline before sending.');
      return;
    }
    const validated = validateChatInput(draft);
    if (!validated.ok) {
      // Instant client-side feedback; the draft is kept so it can be edited.
      setSendError(chatErrorText(validated.code));
      return;
    }
    setSending(true);
    setSendError('');
    socket.timeout(8_000).emit('chat_message', { roomId, text: validated.text }, (timeoutError, ack) => {
      setSending(false);
      if (timeoutError) {
        setSendError('Your message did not send. Check the connection and try again.');
        return;
      }
      if (ack?.ok) {
        // The broadcast echo (sender included) feeds the list; the ack only
        // confirms delivery, so nothing is appended here.
        setDraft('');
        return;
      }
      if (ack?.code === 'CHAT_RATE_LIMITED') {
        const retryMs = Math.max(1000, Number(ack.retryAfterMs) || 0);
        setRateLimitUntil(Date.now() + retryMs);
        return;
      }
      if (ack?.code === 'ROOM_NOT_FOUND' || ack?.code === 'NOT_ROOM_MEMBER') {
        setChatDisabled(true);
        setSendError('You are no longer in this room, so chat is turned off.');
        notify('Room chat is unavailable.', 'info');
        return;
      }
      setSendError(chatErrorText(ack?.code) || ack?.error || 'Message could not be sent.');
    });
  };

  const inputBlocked = chatDisabled || !socket.connected;
  const sendBlocked = sending || inputBlocked || rateLimitUntil !== null || !draft.trim();

  return (
    <section className="room-chat" aria-label="Room chat">
      {open ? (
        <div id="room-chat-panel" className="room-chat-panel glass">
          <div className="room-chat-header">
            <span className="room-chat-title"><MessageSquare size={15} aria-hidden="true" /> Room chat</span>
            <span className="room-chat-room" title="Room code">{roomId}</span>
            <button type="button" className="room-chat-close" aria-label="Close chat" onClick={() => setOpen(false)}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          <div className="room-chat-messages" ref={listRef} role="log" aria-label="Messages in this room">
            {messages.length === 0 ? (
              <p className="room-chat-empty">
                No messages yet. Chat is ephemeral — only players in this room right now can read it.
              </p>
            ) : messages.map((message, index) => {
              const own = isOwnMessage(message, userId);
              return (
                <div key={message.id ?? index} className={`room-chat-msg${own ? ' own' : ''}`}>
                  <div className="room-chat-msg-meta">
                    <span className="room-chat-sender">{own ? 'You' : (message.username || 'Player')}</span>
                    <time className="room-chat-time">{formatChatTime(message.at)}</time>
                  </div>
                  <p className="room-chat-text">{message.text}</p>
                </div>
              );
            })}
          </div>

          {(rateLimitUntil !== null || sendError) && (
            <p className="room-chat-error" role="alert">
              {rateLimitUntil !== null ? `Slow down — try again in ${rateLeftSec}s.` : sendError}
            </p>
          )}

          <div className="room-chat-input-row">
            <input
              ref={inputRef}
              type="text"
              className="room-chat-input"
              value={draft}
              maxLength={MAX_CHAT_LENGTH}
              placeholder={inputBlocked ? 'Chat unavailable' : 'Type a message…'}
              aria-label="Chat message"
              disabled={inputBlocked}
              onChange={(event) => {
                setDraft(event.target.value);
                if (sendError) setSendError('');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  sendMessage();
                }
              }}
            />
            <button
              type="button"
              className="room-chat-send"
              aria-label="Send message"
              disabled={sendBlocked}
              onClick={sendMessage}
            >
              <Send size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="room-chat-toggle"
          aria-expanded={open}
          aria-controls="room-chat-panel"
          onClick={() => setOpen(true)}
        >
          <MessageSquare size={15} aria-hidden="true" />
          <span>Room chat</span>
          {messages.length > 0 && <span className="room-chat-count">{messages.length}</span>}
        </button>
      )}
    </section>
  );
};

// --- Main App ---

export default function App() {
  const [view, setView] = useState('HOME');
  const [activeTab, setActiveTab] = useState('home');
  const [showSettings, setShowSettings] = useState(false);

  // Multiplayer Modal States
  const [showMultiaplyerMenu, setShowMultiplayerMenu] = useState(false);
  const [showHostModal, setShowHostModal] = useState(false);
  const [showGameCreatedModal, setShowGameCreatedModal] = useState(false);
  const [joinInitialCode, setJoinInitialCode] = useState(() => getInviteRoomId(window.location.pathname) || '');
  const [showJoinModal, setShowJoinModal] = useState(() => Boolean(getInviteRoomId(window.location.pathname)));
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [showFallbackModal, setShowFallbackModal] = useState(false);
  const [showLeaveRoom, setShowLeaveRoom] = useState(false);
  const [leavePending, setLeavePending] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const [activeRoomConflict, setActiveRoomConflict] = useState(null);
  const [activeRoomPending, setActiveRoomPending] = useState(false);
  const skipRecoveryOnce = useRef(false);

  // In-app toast notifications (replaces native browser popups for non-destructive notices)
  const { toasts, notify, dismissToast } = useToasts();

  // Persisted state
  const [userConfig, setUserConfig] = useState(() => {
    const saved = localStorage.getItem('noughtline_config') || localStorage.getItem('plaything_config');
    return saved ? JSON.parse(saved) : { theme: 'dark', sound: true };
  });

  const [gameConfig, setGameConfig] = useState({ size: 3, difficulty: 'easy', mode: 'singleplayer', roomId: null });
  const [user, setUser] = useState({ username: 'Guest', gems: 0, coins: 0, xp: 0, streak: 0 });
  // Tracks the authenticated identity for async guards: responses that resolve
  // after logout must not populate the next guest's profile state.
  const userIdRef = useRef(null);
  useEffect(() => { userIdRef.current = user.id || null; }, [user.id]);
  // Mirrors the latest /api/me rating so the []-dep socket listeners can read
  // it without going stale (readers must never use a closure over `user`).
  const userRatingRef = useRef(null);
  useEffect(() => {
    userRatingRef.current = (typeof user.rating === 'number' && Number.isFinite(user.rating)) ? user.rating : null;
  }, [user.rating]);
  // Rating the current ranked series started from; ref (not state) so the
  // completion effect can re-baseline after each settled series without
  // re-render loops. Null unless a reward-eligible match is in progress.
  const rankedBaselineRef = useRef(null);
  // Monotonic token so an in-flight /api/me settlement fetch from an older
  // completion can never overwrite the delta/baseline of a newer one.
  const ratingSettleSeqRef = useRef(0);
  // Match-complete rating delta for the GAME completion chip ({ delta,
  // label, gained } | null). Null/empty label renders no chip.
  const [ratingChange, setRatingChange] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [shopItems, setShopItems] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [gemPackages, setGemPackages] = useState([]);
  const [stats, setStats] = useState({ streak: 0, xp: 0, coins: 0 });

  // PROFILE activity: match history + wallet ledger.
  const [activityTab, setActivityTab] = useState('matches');
  const [matches, setMatches] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState('');

  // Google account linking: the server reports whether the provider is
  // configured (checked once on mount, defensively) and the button only runs
  // a real GIS sign-in when that is true AND a client id is compiled in.
  const [googleProviderConfigured, setGoogleProviderConfigured] = useState(false);
  const [googleProvidersLoaded, setGoogleProvidersLoaded] = useState(false);
  const [googleSignInPending, setGoogleSignInPending] = useState(false);
  const googleSignInBusyRef = useRef(false);   // synchronous in-flight guard (state lags)
  const googlePromptTimerRef = useRef(null);   // non-stuck safety net for the GIS prompt

  // Unmount safety: a pending prompt safety timer must never fire after the
  // component is gone (setState on an unmounted component is a no-op warning).
  useEffect(() => () => {
    if (googlePromptTimerRef.current !== null) {
      window.clearTimeout(googlePromptTimerRef.current);
      googlePromptTimerRef.current = null;
    }
  }, []);

  // Modal States
  const [showBuyGems, setShowBuyGems] = useState(false);
  const [selectedShopItem, setSelectedShopItem] = useState(null);

  const fetchUserData = useCallback(async () => {
    try {
      const res = await api.get('/api/me');
      setUser(res.data);
      setStats({ streak: res.data.streak || 0, xp: res.data.xp || 0, coins: res.data.coins || 0 });
      const invRes = await api.get('/api/me/inventory');
      setInventory(invRes.data);
    } catch (error) { console.error("Sync error", error); }
  }, []);

  // Match history + wallet ledger share one fetch so PROFILE shows both lists
  // from a single activation; a retry button can re-run it on failure.
  const fetchActivity = useCallback(async (signal) => {
    const uid = userIdRef.current;
    setActivityLoading(true);
    setActivityError('');
    try {
      const [matchesRes, ledgerRes] = await Promise.all([
        api.get('/api/me/matches', { signal }),
        api.get('/api/me/ledger', { signal }),
      ]);
      // Identity changed (logout -> new guest) while the request was in flight:
      // do not populate the next guest's profile with the old guest's data.
      if (userIdRef.current !== uid) return;
      setMatches(matchesRes.data);
      setLedger(ledgerRes.data);
    } catch (error) {
      if (error?.code === 'ERR_CANCELED' || userIdRef.current !== uid) return;
      setActivityError('Could not load activity. Check your connection and try again.');
    } finally {
      if (userIdRef.current === uid) setActivityLoading(false);
    }
  }, []);

  // Server-issued guest session. The browser never chooses the account ID.
  useEffect(() => {
    ensureSession()
      .then(({ user: sessionUser }) => {
        setUser(sessionUser);
        return fetchUserData();
      })
      .catch((error) => console.error('Session bootstrap failed', error));
  }, [fetchUserData]);

  // Resume an interrupted Paystack purchase: the buy-gems flow redirects to
  // the provider and back to /?payment=complete, but nothing ever verifies the
  // payment or refreshes gems. On that return, ask the server which intent is
  // still uncredited (GET /api/economy/payments/pending), verify it — the
  // server-side verify is idempotent and credits exactly once — then refresh
  // the profile so the new gems appear. The query marker is stripped
  // synchronously BEFORE any async work, so a page refresh or React
  // StrictMode's dev remount can never re-run verification for the same
  // return. Gated on user.id so the bearer token exists before the lookup.
  useEffect(() => {
    if (user.id == null) return undefined;
    const uid = user.id;
    const returnSearch = window.location.search;
    if (!parsePaymentComplete(returnSearch)) return undefined;

    const params = new URLSearchParams(returnSearch);
    params.delete('payment');
    const remaining = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (remaining ? `?${remaining}` : '') + window.location.hash);

    let canceled = false;
    (async () => {
      try {
        const { data: pending } = await api.get('/api/economy/payments/pending');
        if (canceled || userIdRef.current !== uid) return;
        const state = providerReturnState(returnSearch, pending?.pending === true);
        if (state !== 'verifying') {
          // Returned from Paystack but this account has nothing to verify:
          // either the webhook already credited the gems or the guest never
          // started a purchase. Fetching fresh data already happened at boot.
          notify('No pending payment found for this account — your gems may already have been added.', 'info');
          return;
        }
        try {
          const { data: result } = await api.post(`/api/economy/payments/${encodeURIComponent(pending.reference)}/verify`);
          if (canceled || userIdRef.current !== uid) return;
          const added = Number(result?.gemsAdded) || 0;
          notify(added > 0 ? `${added} gems added to your balance!` : 'Gems added to your balance!', 'success');
          await fetchUserData();
        } catch {
          if (canceled || userIdRef.current !== uid) return;
          notify(`Payment is still processing — your gems will appear once confirmed. If it does not arrive, contact support with reference ${pending.reference}.`, 'info');
        }
      } catch {
        if (canceled || userIdRef.current !== uid) return;
        notify('Could not check your payment right now. Refresh the page in a moment to confirm your gems.', 'info');
      }
    })();
    return () => { canceled = true; };
  }, [user.id, fetchUserData, notify]);

  // Fetch shop items on mount
  useEffect(() => {
    api.get('/api/shop/items').then(res => setShopItems(res.data));
    api.get('/api/economy/gem-packages').then(res => setGemPackages(res.data));
  }, []);

  // Google provider availability (public, defensive). A missing endpoint, an
  // unreachable server or an unconfigured response all mean "not configured":
  // the sign-in button then keeps its informational behavior instead of
  // attempting a GIS flow that would fail server-side. Until this resolves the
  // state is "unknown" and clicks trigger a live re-check (never a false
  // "not configured" toast).
  useEffect(() => {
    let alive = true;
    api.get('/api/auth/providers')
      .then(res => {
        if (!alive) return;
        setGoogleProviderConfigured(parseProviderResponse(res.data));
        setGoogleProvidersLoaded(true);
      })
      .catch(() => { if (alive) setGoogleProvidersLoaded(true); });
    return () => { alive = false; };
  }, []);

  // Connection State: null means the authenticated socket is still bootstrapping.
  const [isConnected, setIsConnected] = useState(socket.connected ? true : null);

  useEffect(() => {
    function onConnect() { setIsConnected(true); }
    function onDisconnect() { setIsConnected(false); }
    function onConnectError() { setIsConnected(false); }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
    };
  }, []);

  // Matchmaking Listeners
  useEffect(() => {
    socket.on('match_found', ({ roomId, opponent, opponentAvatar, room }) => {
      saveActiveRoom(localStorage, roomId);
      setIsSearching(false);
      setShowMultiplayerMenu(false);
      setGameConfig(prev => ({
        ...prev,
        mode: 'multiplayer',
        roomId,
        size: room?.config?.size || 3,
        rounds: room?.config?.rounds || 3,
        opponentAvatar,
        opponentName: opponent,
        roomSnapshot: room || null,
      }));
      // Matchmaking rooms are always reward-eligible: baseline the rating this
      // series started from so the completion chip can show its real delta.
      if (isRankedRoom(room)) rankedBaselineRef.current = userRatingRef.current;
      setRatingChange(null);
      setView('GAME');
    });

    socket.on('match_fallback_ai', () => {
      // No stranger matched within the queue window: stop searching and let the
      // player choose whether to play the AI instead of dropping them in.
      setIsSearching(false);
      setShowMultiplayerMenu(false);
      setShowFallbackModal(true);
    });

    return () => {
      socket.off('match_found');
      socket.off('match_fallback_ai');
    };
  }, []);

  // Fetch leaderboard when switching tabs
  useEffect(() => {
    if (activeTab === 'leaderboard') {
      api.get('/api/leaderboard')
        .then(res => setLeaderboard(res.data))
        .catch(e => console.error(e));
    }
  }, [activeTab]);

  // Refresh match history + ledger every time the PROFILE view is activated so
  // newly completed series and purchases show up without a manual reload. An
  // in-flight request is aborted when the view or identity changes.
  useEffect(() => {
    if (view !== 'PROFILE' || !user.id) return;
    const controller = new AbortController();
    fetchActivity(controller.signal);
    return () => controller.abort();
  }, [view, user.id, fetchActivity]);

  const sounds = useSound(userConfig.sound);
  const {
    board, handleClick, winner, seriesWinner, winningLine, isXNext, resetGame, mySymbol,
    gameStatus, round, score, readyNextRound, requestRematch, roomPlayers,
    disconnectDeadline, completionReason, actionError,
  } = useTicTacToe(gameConfig, setGameConfig, sounds, user);
  const resultWinner = gameStatus === 'complete' ? (seriesWinner || winner) : winner;
  // Rating delta chip shows only when a ranked (matchmaking) series completed
  // normally AND the settlement actually moved the rating.
  const ratingChip = gameConfig.mode === 'multiplayer'
    && gameStatus === 'complete'
    && isRankedRoom(gameConfig.roomSnapshot)
    && !['disconnect_forfeit', 'voluntary_forfeit'].includes(completionReason)
    && ratingChange !== null && ratingChange.label !== ''
    ? ratingChange : null;
  const opponentPlayer = roomPlayers.find(player => player.id !== user.id);
  const opponentDisconnected = gameConfig.mode === 'multiplayer' && opponentPlayer?.connected === false;
  const [disconnectSeconds, setDisconnectSeconds] = useState(0);

  const enterMultiplayerRoom = useCallback((room, message = '') => {
    saveActiveRoom(localStorage, room.id);
    setGameConfig(previous => ({
      ...previous,
      mode: 'multiplayer',
      roomId: room.id,
      size: room.config.size,
      rounds: room.config.rounds,
      roomSnapshot: room,
    }));
    // A resumed reward-eligible room is still ranked: (re)baseline from the
    // current rating. Private/unranked rooms just clear any previous chip.
    if (isRankedRoom(room)) rankedBaselineRef.current = userRatingRef.current;
    setRatingChange(null);
    setRecoveryMessage(message);
    setActiveRoomConflict(null);
    setShowJoinModal(false);
    setShowMultiplayerMenu(false);
    setView('GAME');
  }, []);

  const clearRoomAndReturnHome = useCallback(() => {
    clearActiveRoom(localStorage);
    setRecoveryMessage('');
    setShowLeaveRoom(false);
    setActiveRoomConflict(null);
    setGameConfig(previous => ({ ...previous, roomId: null, opponentName: null, opponentAvatar: null, roomSnapshot: null }));
    // Leaving the game must never leave a stale delta behind.
    rankedBaselineRef.current = null;
    setRatingChange(null);
    setActiveTab('home');
    setView('HOME');
  }, []);

  const handleLifecycleFailure = (result) => {
    if (result?.code === 'ACTIVE_ROOM_EXISTS' && result.roomId) {
      setActiveRoomConflict(result.roomId);
      setRecoveryMessage('');
      setShowHostModal(false);
      setShowJoinModal(false);
      setShowMultiplayerMenu(false);
      setIsSearching(false);
      return;
    }
    if (result?.code === 'RATE_LIMITED') {
      const seconds = Math.max(1, Math.ceil((result.retryAfterMs || 1000) / 1000));
      setRecoveryMessage(`Too many room actions. Try again in ${seconds}s.`);
      setIsSearching(false);
      return;
    }
    setRecoveryMessage(roomErrorMessage(result?.error));
    setIsSearching(false);
  };

  useEffect(() => {
    if (!disconnectDeadline) {
      setDisconnectSeconds(0);
      return undefined;
    }
    const update = () => setDisconnectSeconds(Math.max(0, Math.ceil((disconnectDeadline - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [disconnectDeadline]);

  useEffect(() => {
    if (isConnected !== true || !user.id || showJoinModal || activeRoomConflict) return;
    if (skipRecoveryOnce.current) {
      skipRecoveryOnce.current = false;
      return;
    }
    const activeRoom = readActiveRoom(localStorage);
    if (!activeRoom) return;

    socket.timeout(6_000).emit('resume_room', { roomId: activeRoom.roomId }, (timeoutError, result) => {
      if (timeoutError) {
        setRecoveryMessage('Could not restore the previous room yet. Reconnecting…');
        return;
      }
      if (result?.error) {
        if (result.code === 'RATE_LIMITED') {
          const seconds = Math.max(1, Math.ceil((result.retryAfterMs || 1000) / 1000));
          setRecoveryMessage(`Room recovery is temporarily limited. Try again in ${seconds}s.`);
          return;
        }
        clearActiveRoom(localStorage);
        setGameConfig(previous => previous.roomId === activeRoom.roomId
          ? { ...previous, roomId: null, opponentName: null, opponentAvatar: null }
          : previous);
        setView('HOME');
        setRecoveryMessage(roomErrorMessage(result.error));
        return;
      }

      enterMultiplayerRoom(result.room, 'Match restored.');
    });
  }, [isConnected, user.id, showJoinModal, activeRoomConflict, enterMultiplayerRoom]);

  useEffect(() => {
    if (gameStatus === 'complete' || gameStatus === 'cancelled') setRecoveryMessage('');
  }, [gameStatus]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', userConfig.theme);
    localStorage.setItem('noughtline_config', JSON.stringify(userConfig));
    localStorage.removeItem('plaything_config');
  }, [userConfig]);


  useEffect(() => {
    if (activeTab === 'shop') setView('SHOP');
    else if (activeTab === 'home') setView('HOME');
    else if (activeTab === 'leaderboard') setView('LEADERBOARD');
    else if (activeTab === 'battle') {
      setView('BATTLE');
    }
    else if (activeTab === 'profile') setView('PROFILE');
  }, [activeTab]);

  useEffect(() => {
    const isWin = resultWinner === mySymbol;
    const isLoss = resultWinner && resultWinner !== 'Draw' && resultWinner !== mySymbol;

    if (isWin) {
      sounds.playWin();
      confetti({
        particleCount: 150,
        spread: 100,
        origin: { y: 0.6 },
        colors: ['#2dd4bf', '#8b5cf6', '#fb7185']
      });
    } else if (isLoss) {
      sounds.playLose();
    }
  }, [resultWinner, mySymbol, sounds]);

  useEffect(() => {
    if (gameConfig.mode === 'multiplayer' && gameStatus === 'complete') fetchUserData();
  }, [gameStatus, gameConfig.mode, fetchUserData]);

  // Ranked Elo chip: when a reward-eligible (matchmaking) series completes
  // normally the server settles a rating change, so read the fresh rating and
  // show the delta next to the outcome. The baseline ref is advanced to the
  // settled rating so a rematch series measures from this result, not from the
  // original room entry. Forfeits never adjust ratings, so they are skipped.
  //
  // The settle fetch is intentionally NOT canceled when the player rematches
  // (status leaving 'complete'): the baseline must still advance, or the next
  // series' delta would be measured against the pre-previous rating. A
  // monotonic sequence token discards responses from superseded completions,
  // and the identity guard drops responses that arrive after a logout/switch.
  useEffect(() => {
    if (gameConfig.mode !== 'multiplayer' || gameStatus !== 'complete') return undefined;
    if (!isRankedRoom(gameConfig.roomSnapshot)) return undefined;
    if (['disconnect_forfeit', 'voluntary_forfeit'].includes(completionReason)) return undefined;
    if (rankedBaselineRef.current === null) return undefined;
    const uid = userIdRef.current;
    if (!uid) return undefined;

    // Fresh completion: clear any chip left over from a previous series, then
    // fetch the settled rating.
    setRatingChange(null);
    const seq = ratingSettleSeqRef.current + 1;
    ratingSettleSeqRef.current = seq;
    api.get('/api/me')
      .then((res) => {
        if (userIdRef.current !== uid) return;
        const next = res.data && res.data.rating;
        if (typeof next !== 'number' || !Number.isFinite(next)) return;
        if (ratingSettleSeqRef.current !== seq) return;
        const baseline = rankedBaselineRef.current;
        setRatingChange({
          delta: ratingDelta(baseline, next),
          label: deltaLabel(baseline, next),
          gained: next > baseline,
        });
        rankedBaselineRef.current = next;
        userRatingRef.current = next;
      })
      .catch(() => {});
  }, [gameStatus, gameConfig.mode, gameConfig.roomSnapshot, completionReason]);

  // Modal Handlers
  const handleHostGame = (rounds, size) => {
    socket.emit('create_room', { config: { size, rounds } }, (result) => {
      if (result?.error) {
        handleLifecycleFailure(result);
        return;
      }
      saveActiveRoom(localStorage, result.room.id);
      setGameConfig(previous => ({ ...previous, mode: 'multiplayer', roomId: result.room.id, size, rounds, roomSnapshot: result.room }));
      setRecoveryMessage('');
      setShowHostModal(false);
      setShowGameCreatedModal(true);
    });
  };

  const handleStartGame = () => {
    setShowGameCreatedModal(false);
    setShowMultiplayerMenu(false);
    setView('GAME');
  };

  const clearInvitePath = () => {
    if (getInviteRoomId(window.location.pathname)) window.history.replaceState({}, '', '/');
  };

  const handleOpenJoinModal = (code = '') => {
    setJoinInitialCode(code);
    setShowMultiplayerMenu(false);
    setShowJoinModal(true);
  };

  const handleCloseJoinModal = () => {
    setShowJoinModal(false);
    setJoinInitialCode('');
    clearInvitePath();
  };

  const handleJoinRoom = (roomId) => new Promise((resolve) => {
    if (!socket.connected) {
      resolve({ error: 'Still connecting to Noughtline. Try again in a moment.' });
      return;
    }

    socket.timeout(8_000).emit('join_room', { roomId }, (timeoutError, result) => {
      if (timeoutError) {
        resolve({ error: 'The room did not respond in time. Try again.' });
        return;
      }
      if (result?.error) {
        if (result.code === 'ACTIVE_ROOM_EXISTS' || result.code === 'RATE_LIMITED') handleLifecycleFailure(result);
        resolve(result);
        return;
      }

      const room = result.room;
      enterMultiplayerRoom(room);
      setJoinInitialCode('');
      clearInvitePath();
      resolve({ room });
    });
  });

  const performLeaveRoom = () => {
    if (!gameConfig.roomId || leavePending) return;
    if (!socket.connected) {
      setRecoveryMessage('Reconnect to Noughtline before leaving this room.');
      return;
    }
    setLeavePending(true);
    socket.timeout(8_000).emit('leave_room', { roomId: gameConfig.roomId }, (timeoutError, result) => {
      setLeavePending(false);
      if (timeoutError) {
        setRecoveryMessage('The room did not respond in time. Your match was not forfeited.');
        return;
      }
      if (result?.error) {
        handleLifecycleFailure(result);
        return;
      }
      clearRoomAndReturnHome();
    });
  };

  const handleGameBack = () => {
    if (gameConfig.mode !== 'multiplayer') {
      setActiveTab('home');
      setView('HOME');
      return;
    }
    if (gameStatus === 'complete' || gameStatus === 'cancelled') {
      performLeaveRoom();
      return;
    }
    setRecoveryMessage('');
    setShowLeaveRoom(true);
  };

  const handleResumeActiveRoom = () => {
    if (!activeRoomConflict || activeRoomPending) return;
    setActiveRoomPending(true);
    socket.timeout(8_000).emit('resume_room', { roomId: activeRoomConflict }, (timeoutError, result) => {
      setActiveRoomPending(false);
      if (timeoutError) {
        setRecoveryMessage('The active room did not respond in time. Try again.');
        return;
      }
      if (result?.error) {
        handleLifecycleFailure(result);
        return;
      }
      skipRecoveryOnce.current = true;
      enterMultiplayerRoom(result.room, 'Match restored.');
    });
  };

  const handleCloseActiveRoom = () => {
    skipRecoveryOnce.current = true;
    setActiveRoomConflict(null);
    setActiveTab('home');
    setView('HOME');
  };

  const handleCopyActiveInvite = async () => {
    if (!activeRoomConflict) return;
    try {
      await navigator.clipboard.writeText(createInviteUrl(activeRoomConflict));
      setRecoveryMessage('Active-room invite copied.');
    } catch {
      setRecoveryMessage(`Copy failed. Share room code ${activeRoomConflict}.`);
    }
  };

  const handleAcknowledgeTerminalRoom = performLeaveRoom;

  const handlePlayStranger = () => {
    if (!socket.connected) {
      setRecoveryMessage('Reconnect to Noughtline before matchmaking.');
      return;
    }
    setIsSearching(true);
    socket.timeout(8_000).emit('find_match', {}, (timeoutError, result) => {
      if (timeoutError) {
        setIsSearching(false);
        setRecoveryMessage('Matchmaking did not respond. Try again.');
        return;
      }
      if (result?.error) handleLifecycleFailure(result);
    });
  };

  const handleCancelSearch = () => {
    setIsSearching(false);
    socket.emit('cancel_matchmaking');
  };

  // Player accepted the "no opponent found" fallback: start a local medium 3x3
  // AI game (previously this happened automatically, without asking).
  const handlePlayVsAIFallback = () => {
    setShowFallbackModal(false);
    setGameConfig(prev => ({
      ...prev,
      mode: 'singleplayer',
      difficulty: 'medium',
      size: 3,
      roomId: null,
      opponentName: null,
      opponentAvatar: null,
      roomSnapshot: null,
    }));
    resetGame();
    setView('GAME');
  };

  // --- Google account linking ---
  // Availability is tri-state: 'unknown' until /api/auth/providers resolves,
  // then 'enabled' (server configured AND this build carries a
  // VITE_GOOGLE_CLIENT_ID) or 'unconfigured'. With no credentials deployed the
  // button degrades to the informational toast below.
  const googleAvailability = signInAvailability({
    configured: googleProviderConfigured,
    loaded: googleProvidersLoaded,
    clientId: GOOGLE_CLIENT_ID,
  });

  const clearGooglePromptTimer = () => {
    if (googlePromptTimerRef.current !== null) {
      window.clearTimeout(googlePromptTimerRef.current);
      googlePromptTimerRef.current = null;
    }
  };

  const resetGoogleSignInBusy = () => {
    // Always disarm the safety timer, even if busy is already false: an armed
    // timer must never outlive the flow that created it.
    clearGooglePromptTimer();
    if (!googleSignInBusyRef.current) return;
    googleSignInBusyRef.current = false;
    setGoogleSignInPending(false);
  };

  // POST /api/auth/google with the id_token + the single-use nonce, then apply
  // the server's decision: linked:true keeps the current guest (which just
  // gained an email), switched:true means the fresh guest was revoked and this
  // token belongs to the already-linked account.
  const linkGoogleCredential = async (credential, nonce) => {
    try {
      const { data } = await api.post('/api/auth/google', { idToken: credential, nonce });
      if (data && data.switched) {
        if (!data.token) {
          throw new Error('The server did not return a session for the linked account. Please try again.');
        }
        // Adopt the existing account's token and reconnect the socket under
        // the new identity before fetching anything.
        adoptSessionToken(data.token);
        // Drop the revoked guest's room descriptor so the fresh socket cannot
        // auto-resume into it (mirrors the logout path).
        clearActiveRoom(localStorage);
        setActivityTab('matches');
        setMatches([]);
        setLedger([]);
        setActivityLoading(false);
        setActivityError('');
      }
      // Refresh the profile: the guest-notice unmounts once user.email exists
      // and (for switched:true) the user.id change re-triggers activity sync.
      await fetchUserData();
      notify('Signed in with Google', 'success');
    } catch (error) {
      // 401/409/503 messages come from the server and are shown verbatim
      // (the GOOGLE_LINK_CONFLICT body explains the export/delete path).
      const { message, canceled } = normalizeGoogleError(error);
      if (!canceled && message) notify(message, 'error');
    } finally {
      resetGoogleSignInBusy();
    }
  };

  const handleGoogleLogin = async () => {
    // Synchronous guard: never double-submit, even on rapid clicks before
    // React has re-rendered the disabled state.
    if (googleSignInBusyRef.current) return;

    if (googleAvailability === 'unknown') {
      // Cold start / slow first load: the providers endpoint has not resolved
      // yet, so "not configured" would be a lie. Re-check it live.
      let configured = false;
      try {
        const { data } = await api.get('/api/auth/providers');
        configured = parseProviderResponse(data);
      } catch { /* treated as unconfigured below */ }
      setGoogleProviderConfigured(configured);
      setGoogleProvidersLoaded(true);
      if (signInAvailability({ configured, loaded: true, clientId: GOOGLE_CLIENT_ID }) !== 'enabled') {
        notify('Google sign-in will be enabled once credentials are configured.', 'info', 6000);
        return;
      }
    } else if (googleAvailability === 'unconfigured') {
      notify('Google sign-in will be enabled once credentials are configured.', 'info', 6000);
      return;
    }

    googleSignInBusyRef.current = true;
    setGoogleSignInPending(true);

    // The GIS flow is callback-driven, so the busy state is released by the
    // credential callback, a prompt moment, or the safety timeout — not when
    // this async continuation returns after calling prompt().
    let nonce = null;
    try {
        // The nonce is single-use server-side and session-bound: request a
        // fresh one per attempt and never reuse it after a failure/cancel.
        try {
          const nonceRes = await api.post('/api/auth/google/nonce');
          nonce = nonceRes.data && nonceRes.data.nonce;
        } catch (error) {
          if (error.response?.status !== 401) throw error;
          // Stale session: the 401 response already dropped the stored token,
          // so bootstrap a fresh guest session, then retry the nonce once.
          await ensureSession();
          const nonceRes = await api.post('/api/auth/google/nonce');
          nonce = nonceRes.data && nonceRes.data.nonce;
        }
        if (!nonce) throw new Error('Google sign-in could not be started. Please try again.');

        await loadGsiScript();
        const gsiId = window.google && window.google.accounts && window.google.accounts.id;
        if (!gsiId) throw new Error('Google sign-in is unavailable in this browser.');

        const config = buildGoogleIdConfig({
          clientId: GOOGLE_CLIENT_ID,
          nonce,
          callback: (response) => {
            const credential = response && response.credential;
            if (!credential) {
              // Prompt resolved without a token: leave the session untouched.
              resetGoogleSignInBusy();
              return;
            }
            // A credential means the flow is moving to the server exchange:
            // disarm the safety timer so it cannot fire during the request.
            clearGooglePromptTimer();
            linkGoogleCredential(credential, nonce);
          },
        });
        if (!config) throw new Error('Google sign-in is not configured correctly.');

        gsiId.initialize(config);
        // Safety net armed BEFORE prompt(): if GIS neither returns a
        // credential nor reports a moment (e.g. a chooser closed in an
        // unreported way), never leave the button stuck in the busy state.
        googlePromptTimerRef.current = window.setTimeout(() => {
          const currentGsi = window.google && window.google.accounts && window.google.accounts.id;
          if (currentGsi && typeof currentGsi.cancel === 'function') currentGsi.cancel();
          resetGoogleSignInBusy();
        }, GOOGLE_PROMPT_TIMEOUT_MS);
        // If the prompt is skipped or dismissed (or suppressed, in the legacy
        // iframe flow) no credential callback ever fires, so release the busy
        // state on those moments. A pure "display" moment (legacy flow, chooser
        // open) is ignored so the button stays disabled while it is showing.
        const onPromptMoment = (notification) => {
          if (!notification) return;
          const resolvedWithoutCredential = (typeof notification.isSkippedMoment === 'function' && notification.isSkippedMoment())
            || (typeof notification.isDismissedMoment === 'function' && notification.isDismissedMoment())
            || (typeof notification.isNotDisplayed === 'function' && notification.isNotDisplayed());
          if (resolvedWithoutCredential) resetGoogleSignInBusy();
        };
        gsiId.prompt(onPromptMoment);
      } catch (error) {
        const { message, canceled } = normalizeGoogleError(error);
        if (!canceled && message) notify(message, 'error');
        resetGoogleSignInBusy();
      }
  };

  const buyGemPackage = async (packageId) => {
    try {
      const { data } = await api.post('/api/economy/payments', { packageId });
      window.location.assign(data.authorizationUrl);
    } catch (error) {
      notify(error.response?.data?.error || 'Payment could not be started', 'error');
    }
  };

  const buyAvatar = async (avatarId) => {
    try {
      await api.post('/api/shop/purchase', { avatarId });
      await fetchUserData();
      setSelectedShopItem(null);
      notify('Avatar added to collection!', 'success');
    } catch (error) { notify(error.response?.data?.error || 'Purchase failed', 'error'); }
  };

  const handleExportData = async () => {
    try {
      const res = await api.get('/api/me/export');
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(res.data, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", `noughtline_data_${new Date().toISOString()}.json`);
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
      notify('Data export downloaded.', 'success');
    } catch { notify('Export failed', 'error'); }
  };

  const handleDeleteAccount = async () => {
    if (deletePending) return;
    setDeletePending(true);
    try {
      await api.delete('/api/me');
      setShowDeleteConfirm(false);
      notify('Account deleted. Goodbye!', 'success');
      clearSession();
      // Give the toast a moment to be read before bootstrapping a fresh guest session.
      window.setTimeout(() => window.location.reload(), 1600);
    } catch {
      setDeletePending(false);
      notify('Delete failed', 'error');
    }
  };

  const handleLogout = async () => {
    if (logoutPending) return;
    setLogoutPending(true);

    try {
      // Revokes the session server-side, clears the stored token, disconnects the socket.
      await logoutSession();
      // Clear the previous guest's active-room descriptor BEFORE the fresh socket
      // connects, so it cannot auto-resume into the abandoned guest's room.
      clearActiveRoom(localStorage);
      setGameConfig(previous => ({ ...previous, roomId: null, opponentName: null, opponentAvatar: null, roomSnapshot: null }));
      setRecoveryMessage('');
      setIsSearching(false);
      setShowLeaveRoom(false);
      setActiveRoomConflict(null);
      setShowMultiplayerMenu(false);
      // Drop the previous guest's profile activity so a stale response (or a
      // delayed one that slips past the abort) cannot surface in the next guest.
      setActivityTab('matches');
      setMatches([]);
      setLedger([]);
      setActivityLoading(false);
      setActivityError('');
      // Continue seamlessly as a brand-new guest (fresh token + profile).
      const { user: freshUser } = await ensureSession();
      setUser(freshUser);
      await fetchUserData();
      setShowLogoutConfirm(false);
      setLogoutPending(false);
      setActiveTab('home');
      setView('HOME');
      setShowSettings(false);
    } catch {
      // logoutSession() always clears the local session before resolving, so by
      // the time we land here the old identity is already invalid locally and
      // possibly revoked server-side. Rendering the abandoned guest's data any
      // longer is stale, so hard-reset to the guest bootstrap instead.
      clearSession();
      window.location.reload();
    }
  };

  const equipAvatar = async (avatarId) => {
    try {
      await api.post('/api/me/equip-avatar', { avatarId });
      await fetchUserData();
      sounds.playClick();
    } catch (error) { notify(error.response?.data?.error || 'Failed to equip', 'error'); }
  };


  return (
    <div className="app-container">
      {isConnected === false && (
        <div className="connection-banner" role="status" aria-live="polite" style={{ background: '#ef4444', color: 'white', padding: '8px', textAlign: 'center', fontSize: '0.8rem', fontWeight: 'bold' }}>
          OFFLINE - Attempting to Reconnect...
        </div>
      )}
      {recoveryMessage && (
        <div className="recovery-toast" role="status" aria-live="polite">
          <span>{recoveryMessage}</span>
          <button type="button" onClick={() => setRecoveryMessage('')} aria-label="Dismiss message">×</button>
        </div>
      )}
      {toasts.length > 0 && (
        <div className="toast-stack" role="status" aria-live="polite">
          <AnimatePresence>
            {toasts.map(toast => (
              <motion.div
                key={toast.id}
                className={`toast toast-${toast.tone}`}
                initial={{ opacity: 0, y: -10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                layout
              >
                <span>{toast.message}</span>
                <button type="button" onClick={() => dismissToast(toast.id)} aria-label="Dismiss notification">×</button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
      <TopBar stats={stats} setShowSettings={setShowSettings} user={user} onBuyGems={() => setShowBuyGems(true)} />

      <SettingsModal
        show={showSettings}
        onClose={() => setShowSettings(false)}
        config={userConfig}
        setConfig={setUserConfig}
        onExport={handleExportData}
        onDelete={() => setShowDeleteConfirm(true)}
        onLogout={() => setShowLogoutConfirm(true)}
      />

      <MultiplayerMenu
        show={showMultiaplyerMenu}
        onClose={() => setShowMultiplayerMenu(false)}
        onHost={() => {
          setShowMultiplayerMenu(false);
          setShowHostModal(true);
        }}
        onJoin={() => handleOpenJoinModal()}
        onPlayStranger={handlePlayStranger}
      />

      <JoinRoomModal
        show={showJoinModal}
        initialCode={joinInitialCode}
        connected={isConnected === true}
        onClose={handleCloseJoinModal}
        onJoin={handleJoinRoom}
      />

      <HostGameModal
        show={showHostModal}
        onClose={() => setShowHostModal(false)}
        onStart={handleHostGame}
      />

      <GameCreatedModal
        show={showGameCreatedModal}
        onClose={() => setShowGameCreatedModal(false)}
        roomId={gameConfig.roomId}
        onStart={handleStartGame}
      />

      <SearchingMatchModal
        show={isSearching}
        onCancel={handleCancelSearch}
      />

      <FallbackModal
        show={showFallbackModal}
        onPlayAI={handlePlayVsAIFallback}
        onBackToMenu={() => setShowFallbackModal(false)}
      />

      <LeaveRoomModal
        show={showLeaveRoom}
        gameStatus={gameStatus}
        hasOpponent={Boolean(opponentPlayer)}
        pending={leavePending}
        onCancel={() => setShowLeaveRoom(false)}
        onConfirm={performLeaveRoom}
      />

      <ActiveRoomModal
        roomId={activeRoomConflict}
        pending={activeRoomPending}
        onResume={handleResumeActiveRoom}
        onCopy={handleCopyActiveInvite}
        onClose={handleCloseActiveRoom}
      />

      <ConfirmDialog
        show={showDeleteConfirm}
        title="Delete account?"
        description="This permanently deletes your account, collection, coins and progress. It cannot be undone."
        confirmLabel="Delete account"
        pendingLabel="Deleting…"
        busy={deletePending}
        onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={handleDeleteAccount}
      />

      <ConfirmDialog
        show={showLogoutConfirm}
        title="Log out?"
        description="This abandons the current guest account — progress, coins and unlocks cannot be recovered. You will continue as a brand-new guest."
        confirmLabel="Log out"
        pendingLabel="Logging out…"
        busy={logoutPending}
        onCancel={() => setShowLogoutConfirm(false)}
        onConfirm={handleLogout}
      />

      <BuyGemsModal
        show={showBuyGems}
        onClose={() => setShowBuyGems(false)}
        packages={gemPackages}
        onBuy={buyGemPackage}
      />

      <ShopItemModal
        show={!!selectedShopItem}
        onClose={() => setSelectedShopItem(null)}
        item={selectedShopItem}
        user={user}
        onBuy={buyAvatar}
        onCannotAfford={(shopItem) => notify(insufficientGuidance(shopItem), 'error')}
      />

      <main className="content">
        <AnimatePresence mode="wait">
          {view === 'HOME' && (
            <motion.div
              key="home"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="home-screen"
            >
              <div className="home-hero">
                <span className="home-eyebrow">Server-authoritative arena</span>
                <h1>Noughtline</h1>
                <p className="home-subtitle">Classic tic-tac-toe rebuilt for quick duels, private rooms, and competitive rounds.</p>
              </div>
              <div className="button-group">
                <button
                  className="btn-primary human"
                  onClick={() => setShowMultiplayerMenu(true)}
                >
                  <span className="mode-icon"><Swords size={22} /></span>
                  <span className="mode-copy"><strong>Challenge a player</strong><small>Host a room, join a friend, or find a live opponent.</small></span>
                  <span className="mode-arrow">↗</span>
                </button>
                <button
                  className="btn-primary ai"
                  onClick={() => {
                    setGameConfig(prev => ({ ...prev, mode: 'singleplayer', roomId: null, opponentName: null, opponentAvatar: null }));
                    setView('AI_CONFIG');
                  }}
                >
                  <span className="mode-icon"><Zap size={22} /></span>
                  <span className="mode-copy"><strong>Train against AI</strong><small>Choose your board and difficulty, then sharpen your game.</small></span>
                  <span className="mode-arrow">→</span>
                </button>
              </div>
              <div className="home-status">
                <span className="status-online">Realtime service online</span>
                <span>3×3 · 4×4 · 5×5 boards</span>
              </div>
            </motion.div>
          )}

          {view === 'LEADERBOARD' && (
            <motion.div
              key="leaderboard"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="leaderboard-screen"
            >
              <span className="page-eyebrow">Competitive standings</span>
              <h2>Leaderboard</h2>
              <p className="page-intro">Players ranked by competitive rating earned in eligible matches.</p>
              <div className="leaderboard-list">
                {leaderboard.length > 0 ? leaderboard.map((u, i) => (
                  <div className="rank-item glass" key={i}>
                    <span className="rank-num">#{i + 1}</span>
                    <img src={u.avatar} className="rank-avatar" alt={`${u.username} avatar`} />
                    <div className="rank-info">
                      <p className="rank-name">{u.username}</p>
                      <span className="rank-xp">{u.xp} XP</span>
                    </div>
                    {Number.isFinite(u.rating) ? (
                      <div className="rank-rating">
                        <strong className="rank-rating-value">{formatRating(u.rating)}</strong>
                        <span className="rank-rating-label">Rating</span>
                      </div>
                    ) : null}
                  </div>
                )) : <p>Loading...</p>}
              </div>
            </motion.div>
          )}

          {view === 'BATTLE' && (
            <motion.div
              key="battle"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="battle-screen"
            >
              <div className="battle-icon"><Swords size={28} /></div>
              <span className="page-eyebrow">Realtime multiplayer</span>
              <h2>Battle Arena</h2>
              <p className="page-intro">Create a private room for a friend or enter matchmaking for a ranked duel.</p>

              <div className="button-group">
                <button className="btn-primary" onClick={() => setShowMultiplayerMenu(true)}>
                  Create / Join Room
                </button>
              </div>

              {gameConfig.mode === 'multiplayer' && gameConfig.roomId && !showGameCreatedModal && (
                <div className="room-summary">
                  <span className="page-eyebrow">Active room</span>
                  <p>Room ID: <strong>{gameConfig.roomId}</strong></p>
                  <div className="room-summary-actions">
                    <button className="btn-pink" onClick={() => setView('GAME')}>Resume match</button>
                    <button className="btn-gray" onClick={() => setShowGameCreatedModal(true)}>Invite player</button>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {view === 'PROFILE' && (
            <motion.div
              key="profile"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="profile-screen"
            >
              {!user.email && (
                <div className="glass guest-notice">
                  <p>You are playing as a <b>Guest</b>. Account linking will preserve progress across devices when OAuth is enabled.</p>
                  <button
                    className="btn-primary google-button"
                    onClick={handleGoogleLogin}
                    disabled={googleSignInPending}
                    aria-busy={googleSignInPending}
                  >
                    <img src="https://www.google.com/favicon.ico" alt="" />
                    {googleSignInPending ? 'Signing in…' : 'Sign in with Google'}
                  </button>
                </div>
              )}

              <div className="profile-header">
                <img src={user.avatar} alt="Avatar" className="large-avatar" />
                <h2>{user.username}</h2>
                <p className="text-accent-teal">{user.email || 'Guest Account'}</p>
                <p className="text-accent-teal" style={{ opacity: 0.7 }}>Level {user.level || 1}</p>
              </div>

              <div className={`stats-grid${Number.isFinite(user.rating) ? ' stats-grid--three' : ''}`}>
                <div className="stat-box glass">
                  <Trophy size={20} color="#fbbf24" />
                  <span className="stat-val">{user.wins || 0}</span>
                  <span className="stat-label">Wins</span>
                </div>
                <div className="stat-box glass">
                  <Flame size={20} color="#f97316" />
                  <span className="stat-val">{stats.streak}</span>
                  <span className="stat-label">Streak</span>
                </div>
                {Number.isFinite(user.rating) && (
                  <div className="stat-box glass">
                    <Gauge size={20} color="#49d6b4" />
                    <span className="stat-val">{formatRating(user.rating)}</span>
                    <span className="stat-label">Rating</span>
                  </div>
                )}
              </div>

              <div className="activity-card glass">
                <div className="activity-head">
                  <h3 className="activity-title">Activity</h3>
                  <div className="activity-tabs" role="group" aria-label="Activity type">
                    <button
                      type="button"
                      className={`activity-tab ${activityTab === 'matches' ? 'active' : ''}`}
                      aria-pressed={activityTab === 'matches'}
                      onClick={() => setActivityTab('matches')}
                    >
                      <History size={15} /> Matches
                    </button>
                    <button
                      type="button"
                      className={`activity-tab ${activityTab === 'wallet' ? 'active' : ''}`}
                      aria-pressed={activityTab === 'wallet'}
                      onClick={() => setActivityTab('wallet')}
                    >
                      <Wallet size={15} /> Wallet
                    </button>
                  </div>
                </div>

                {activityError ? (
                  <div className="activity-state" role="alert">
                    <AlertTriangle size={18} className="activity-state-icon" />
                    <p>{activityError}</p>
                    <button type="button" className="btn-gray activity-retry" onClick={fetchActivity}>Try again</button>
                  </div>
                ) : activityLoading && matches.length === 0 && ledger.length === 0 ? (
                  <p className="activity-state" role="status">Loading activity…</p>
                ) : (
                  <AnimatePresence mode="wait" initial={false}>
                    {activityTab === 'matches' ? (
                      <motion.div
                        key="activity-matches"
                        className="activity-pane"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.16 }}
                      >
                        <MatchHistoryList matches={matches} userId={user.id} />
                      </motion.div>
                    ) : (
                      <motion.div
                        key="activity-wallet"
                        className="activity-pane"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.16 }}
                      >
                        <WalletLedgerList ledger={ledger} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                )}
              </div>

              <QuestCard userId={user.id} notify={notify} onBalanceChange={fetchUserData} />

              <AchievementsCard userId={user.id} notify={notify} onBalanceChange={fetchUserData} />

              <h3 className="collection-title">My Collection</h3>
              <div className="inventory-grid">
                {inventory.map(item => (
                  <button key={item.id} className={`inventory-card glass ${user.active_avatar_id === item.id ? 'active' : ''}`} onClick={() => equipAvatar(item.id)} aria-label={`Equip ${item.name || item.rarity} avatar`}>
                    <img src={item.url} alt={item.name || `${item.rarity} avatar`} />
                    <span className="rarity-tag" data-rarity={item.rarity}>{item.rarity}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}


          {view === 'AI_CONFIG' && (
            <motion.div
              key="config"
              initial={{ opacity: 0, y: 100 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 100 }}
              className="modal glass"
            >
              <h3>Board Size</h3>
              <div className="toggle-group">
                {[3, 4, 5].map(s => (
                  <button
                    key={s}
                    className={`toggle-btn ${gameConfig.size === s ? 'active' : ''}`}
                    onClick={() => setGameConfig(prev => ({ ...prev, size: s }))}
                  >
                    {s} x {s}
                  </button>
                ))}
              </div>

              <h3>Difficulty</h3>
              <div className="difficulty-list">
                {[
                  { id: 'easy', color: 'var(--accent-teal)' },
                  { id: 'medium', color: 'var(--accent-orange)' },
                  { id: 'hard', color: 'var(--accent-pink)' },
                  { id: 'impossible', color: 'var(--accent-purple)' }
                ].map(d => (
                  <button
                    key={d.id}
                    className={`diff-btn ${gameConfig.difficulty === d.id ? 'active' : ''}`}
                    style={{ '--btn-color': d.color }}
                    onClick={() => setGameConfig(prev => ({ ...prev, difficulty: d.id }))}
                  >
                    {d.id.charAt(0).toUpperCase() + d.id.slice(1)}
                  </button>
                ))}
              </div>

              <div className="modal-actions">
                <button className="cancel-btn" onClick={() => setView('HOME')}>Cancel</button>
                <button className="start-btn" onClick={() => { resetGame(); setView('GAME'); }}>Start Game</button>
              </div>
            </motion.div>
          )}

          {view === 'GAME' && (
            <motion.div
              key="game"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="game-screen"
            >
              <div className="game-info-panel">
                <div className="game-header">
                  <button className="back-btn" aria-label={gameConfig.mode === 'multiplayer' ? 'Leave match' : 'Return home'} onClick={handleGameBack}>
                    <ChevronLeft size={28} />
                  </button>
                  <div className="mode-badge glass">MODE: {gameConfig.mode === 'multiplayer' ? `ROOM: ${gameConfig.roomId}` : gameConfig.difficulty.toUpperCase()}</div>
                  <div className="spacer" />
                  {gameConfig.mode === 'singleplayer' && (
                    <button className="reset-icon-btn" onClick={resetGame}>
                      <RotateCcw size={20} />
                    </button>
                  )}
                </div>

                <div className="players">
                  <div className={`player-card ${isXNext === (mySymbol === 'X') ? 'active' : ''}`}>
                    <img src={user.avatar || "https://api.dicebear.com/7.x/avataaars/svg?seed=Agnes"} alt="You" />
                    <p>You</p>
                    <span className={`symbol char ${mySymbol}`}>{mySymbol}</span>
                  </div>
                  <div className="vs">VS</div>
                  <div className={`player-card ${isXNext === (mySymbol === 'O') ? 'active' : ''} ${opponentDisconnected ? 'disconnected' : ''}`}>
                    <img src={(gameConfig.mode === 'multiplayer' && gameConfig.opponentAvatar) ? gameConfig.opponentAvatar : "https://api.dicebear.com/7.x/bottts/svg?seed=AI"} alt="Opponent" />
                    <p>{gameConfig.mode === 'multiplayer' ? (gameConfig.opponentName || 'Waiting…') : 'AI'}</p>
                    {opponentDisconnected && <small className="player-connection-state">Disconnected</small>}
                    <span className={`symbol char ${mySymbol === 'X' ? 'O' : 'X'}`}>{mySymbol === 'X' ? 'O' : 'X'}</span>
                  </div>
                </div>

                <div className={`turn-indicator ${gameStatus === 'paused' ? 'paused' : ''}`} aria-live="polite">
                  {gameConfig.mode === 'multiplayer' && gameStatus === 'waiting' ? (
                    <span>Waiting for opponent…</span>
                  ) : gameConfig.mode === 'multiplayer' && gameStatus === 'paused' ? (
                    <span className="disconnect-countdown">
                      {opponentDisconnected ? 'Opponent disconnected' : 'Connection interrupted'}
                      {disconnectSeconds > 0 ? ` · ${disconnectSeconds}s to forfeit` : ' · resolving match…'}
                    </span>
                  ) : gameConfig.mode === 'multiplayer' && gameStatus === 'cancelled' ? (
                    <span className="cancelled-status">Match cancelled — neither player reconnected in time.</span>
                  ) : resultWinner ? (
                    <motion.span
                      initial={{ scale: 0.5 }}
                      animate={{ scale: 1.08 }}
                      className="winner-text"
                    >
                      {['disconnect_forfeit', 'voluntary_forfeit'].includes(completionReason)
                        ? (resultWinner === mySymbol ? 'Opponent forfeited — you win the series.' : 'You forfeited — opponent wins the series.')
                        : gameConfig.mode === 'multiplayer' && gameStatus === 'complete'
                          ? resultWinner === 'Draw' ? 'Series complete — draw.' : `Series complete — ${resultWinner === mySymbol ? 'you win.' : 'opponent wins.'}`
                          : resultWinner === 'Draw' ? "It's a Draw!" : `${resultWinner === mySymbol ? 'You' : 'Opponent'} Won!`}
                    </motion.span>
                  ) : (
                    <span className="animate-pulse">{isXNext === (mySymbol === 'X') ? "> Your Turn" : "> Opponent Turn"}</span>
                  )}
                  {ratingChip && (
                    <span
                      className={`rating-delta-chip ${ratingChip.gained ? 'gain' : 'loss'}`}
                      role="status"
                      aria-label={`Rating ${ratingChip.gained ? 'increased by' : 'decreased by'} ${Math.abs(ratingChip.delta)}`}
                    >
                      Rating {ratingChip.label}
                    </span>
                  )}
                </div>
                {actionError && <p className="game-action-error" role="alert">{actionError}</p>}
                {gameConfig.mode === 'multiplayer' && (
                  <div className="mode-badge glass">
                    Round {round}/{gameConfig.rounds || 3} · Score {score.X}-{score.O}
                  </div>
                )}
                {gameStatus === 'round_complete' && (
                  <button className="btn-primary" onClick={readyNextRound}>Ready for next round</button>
                )}
                {gameStatus === 'complete' && !['disconnect_forfeit', 'voluntary_forfeit'].includes(completionReason) && (
                  <button className="btn-primary" onClick={requestRematch}>Request rematch</button>
                )}
                {gameStatus === 'complete' && ['disconnect_forfeit', 'voluntary_forfeit'].includes(completionReason) && (
                  <button className="btn-primary" onClick={handleAcknowledgeTerminalRoom}>Return home</button>
                )}
                {gameStatus === 'cancelled' && (
                  <button className="btn-primary" onClick={handleAcknowledgeTerminalRoom}>Return home</button>
                )}
                {gameConfig.mode === 'multiplayer' && gameConfig.roomId && (
                  <RoomChat
                    roomId={gameConfig.roomId}
                    userId={user.id}
                    notify={notify}
                  />
                )}
              </div>

              <div
                className="grid-container"
                style={{ gridTemplateColumns: `repeat(${gameConfig.size}, 1fr)` }}
              >
                {board.map((square, i) => (
                  <button
                    key={i}
                    className={`square ${winningLine.includes(i) ? 'winning' : ''}`}
                    onClick={() => handleClick(i)}
                    disabled={gameConfig.mode === 'multiplayer' && gameStatus !== 'active'}
                    aria-label={`Row ${Math.floor(i / gameConfig.size) + 1}, column ${(i % gameConfig.size) + 1}${square ? `, ${square}` : ', empty'}`}
                  >
                    <AnimatePresence>
                      {square && (
                        <motion.span
                          initial={{ scale: 0, rotate: -45 }}
                          animate={{ scale: 1, rotate: 0 }}
                          className={`char ${square}`}
                        >
                          {square}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {view === 'SHOP' && (
            <motion.div
              key="shop"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="shop-screen"
            >
              <div className="shop-header glass">
                <div>
                  <span className="page-eyebrow">Collection store</span>
                  <h2>Treasury</h2>
                  <p>Unlock avatars using server-verified balances.</p>
                </div>
                <div>
                  <button className="pill-btn active" onClick={() => setShowBuyGems(true)}>+ Buy Gems</button>
                </div>
              </div>

              <h3>Avatar Collection</h3>
              <div className="shop-grid">
                {shopItems.map(item => {
                  const isOwned = inventory.some(i => i.id === item.id);
                  return (
                    <div className="shop-card glass" key={item.id} onClick={() => !isOwned && setSelectedShopItem(item)}>
                      <img src={item.url} className="shop-item-img" alt={item.name} />
                      <div className="rarity-tag" data-rarity={item.rarity}>{item.rarity}</div>
                      <h4>{item.name}</h4>
                      <p>{item.currency === 'coins' ? <Coins size={14} color="#fbbf24" /> : <Gem size={14} color="#2dd4bf" />} {item.currency === 'coins' ? item.cost_coins : item.cost_gems}</p>
                      <button
                        className={isOwned ? 'btn-gray' : 'btn-teal'}
                        disabled={isOwned}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!isOwned) setSelectedShopItem(item);
                        }}
                      >
                        {isOwned ? 'Owned' : 'Buy'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {!['GAME', 'AI_CONFIG'].includes(view) && <BottomNav activeTab={activeTab} setActiveTab={setActiveTab} />}
    </div >
  );
}
