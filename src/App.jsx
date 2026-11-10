import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, adoptSessionToken, clearSession, ensureSession, getSocket, logoutSession } from './services/client';
import {
  clearActiveRoom, createInviteUrl, getInviteRoomId, normalizeRoomId, readActiveRoom, saveActiveRoom,
} from './services/rooms';
import { httpErrorMessage } from './services/errors';
import { mergeToast } from './services/toasts';
import { insufficientGuidance } from './services/shop';
import { parsePaymentComplete, providerReturnState } from './services/payments';
import { deltaLabel, isRankedRoom, ratingDelta } from './services/ratings';
import { normalizeThemePreference, resolveTheme } from './services/theme';
import { GOOGLE_CLIENT_ID } from './config';
import {
  buildGoogleIdConfig, loadGsiScript, normalizeGoogleError, parseProviderResponse, signInAvailability,
} from './services/google';
import confetti from 'canvas-confetti';

import HomeScreen from './screens/HomeScreen.jsx';
import PlayScreen from './screens/PlayScreen.jsx';
import RanksScreen from './screens/RanksScreen.jsx';
import ProfileScreen from './screens/ProfileScreen.jsx';
import ShopScreen from './screens/ShopScreen.jsx';
import GameScreen from './screens/GameScreen.jsx';
import TournamentsScreen from './screens/TournamentsScreen.jsx';
import RoomChat from './RoomChat.jsx';
import { Sidebar, TopBar, BottomNav } from './Shell.jsx';
import useTicTacToe from './useTicTacToe.js';
import {
  ActiveRoomDialog, BuyGemsDialog, ConfirmDialog, FallbackDialog, GameCreatedDialog,
  LeaveRoomDialog, SettingsDialog, ShopItemDialog,
} from './dialogs.jsx';
import './App.css';

const socket = getSocket();

/* ---------------- sound ---------------- */

// Synthesised cues instead of hosted audio files: works offline, adds no
// third-party request, and stays inside the server's Content Security Policy.
const useSound = (enabled) => {
  const contextRef = useRef(null);

  return useMemo(() => {
    const tone = (frequency, delay, duration, type = 'sine', volume = 0.035) => {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      if (!contextRef.current) contextRef.current = new AudioContextClass();
      const context = contextRef.current;
      if (context.state === 'suspended') context.resume().catch(() => {});
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + delay;
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.03);
    };

    return {
      playClick: () => {
        if (!enabled) return;
        try { tone(340, 0, 0.06, 'triangle', 0.028); } catch { /* audio unavailable */ }
      },
      playWin: () => {
        if (!enabled) return;
        try {
          tone(523.25, 0, 0.14, 'sine', 0.045);
          tone(659.25, 0.11, 0.16, 'sine', 0.045);
          tone(783.99, 0.23, 0.26, 'sine', 0.05);
        } catch { /* audio unavailable */ }
      },
      playLose: () => {
        if (!enabled) return;
        try {
          tone(233.08, 0, 0.16, 'sine', 0.04);
          tone(174.61, 0.14, 0.3, 'sine', 0.04);
        } catch { /* audio unavailable */ }
      },
    };
  }, [enabled]);
};

/* ---------------- toasts ---------------- */

const TOAST_DURATION_MS = 3600;

const useToasts = () => {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);
  const timersRef = useRef(new Map());

  const dismissToast = useCallback((id) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback((message, tone = 'info', duration = TOAST_DURATION_MS) => {
    idRef.current += 1;
    const id = `toast-${idRef.current}`;
    const timer = window.setTimeout(() => dismissToast(id), duration);
    timersRef.current.set(id, timer);
    setToasts((current) => mergeToast(current, { id, message, tone }).toasts);
  }, [dismissToast]);

  useEffect(() => () => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current.clear();
  }, []);

  return { toasts, notify, dismissToast };
};

/* ---------------- game hook ---------------- */
// Kept in its own module so the board logic is testable and the App file stays
// about session, navigation and screens.

export default function App() {
  const [view, setView] = useState('HOME');
  const [playMode, setPlayMode] = useState('ranked');
  const [profileTab, setProfileTab] = useState('overview');
  const [tournamentFocus, setTournamentFocus] = useState(null);

  const [showSettings, setShowSettings] = useState(false);
  const [showBuyGems, setShowBuyGems] = useState(false);
  const [selectedShopItem, setSelectedShopItem] = useState(null);
  const [showGameCreatedModal, setShowGameCreatedModal] = useState(false);
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
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [copiedInvite, setCopiedInvite] = useState(false);

  const skipRecoveryOnce = useRef(false);
  const searchingRef = useRef(false);
  const hostingRef = useRef(false);

  const { toasts, notify, dismissToast } = useToasts();

  const [inviteRoomId, setInviteRoomId] = useState(() => getInviteRoomId(window.location.pathname) || '');

  const [userConfig, setUserConfig] = useState(() => {
    const saved = localStorage.getItem('noughtline_config') || localStorage.getItem('plaything_config');
    if (!saved) return { theme: 'system', sound: true };
    try {
      const parsed = JSON.parse(saved);
      if (!parsed.themeV2) {
        return { ...parsed, theme: 'system', sound: parsed.sound ?? true, themeV2: true };
      }
      return { ...parsed, theme: normalizeThemePreference(parsed.theme), sound: parsed.sound ?? true };
    } catch {
      return { theme: 'system', sound: true };
    }
  });

  const [gameConfig, setGameConfig] = useState({ size: 3, difficulty: 'easy', mode: 'singleplayer', roomId: null });
  const [user, setUser] = useState({ username: 'Guest', gems: 0, coins: 0, xp: 0, streak: 0 });
  const userIdRef = useRef(null);
  const userRatingRef = useRef(null);
  const rankedBaselineRef = useRef(null);
  const ratingSettleSeqRef = useRef(0);
  const [ratingChange, setRatingChange] = useState(null);
  const [shopItems, setShopItems] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [gemPackages, setGemPackages] = useState([]);
  const [paymentsConfigured, setPaymentsConfigured] = useState(false);
  const [matches, setMatches] = useState([]);
  const [matchesLoading, setMatchesLoading] = useState(false);

  const [googleProviderConfigured, setGoogleProviderConfigured] = useState(false);
  const [googleProvidersLoaded, setGoogleProvidersLoaded] = useState(false);
  const [googleSignInPending, setGoogleSignInPending] = useState(false);
  const googleSignInBusyRef = useRef(false);
  const googlePromptTimerRef = useRef(null);

  const setCurrentUser = useCallback((next) => {
    userIdRef.current = next?.id ?? null;
    userRatingRef.current = (typeof next?.rating === 'number' && Number.isFinite(next.rating)) ? next.rating : null;
    setUser(next);
  }, []);

  const fetchUserData = useCallback(async () => {
    const uid = userIdRef.current;
    try {
      const res = await api.get('/api/me');
      if (uid !== null && userIdRef.current !== uid) return;
      setCurrentUser(res.data);
      const invRes = await api.get('/api/me/inventory');
      if (uid !== null && userIdRef.current !== uid) return;
      setInventory(Array.isArray(invRes.data) ? invRes.data : []);
    } catch (error) {
      if (error?.response?.status !== 401) console.error('Profile sync failed', error);
    }
  }, [setCurrentUser]);

  const fetchMatches = useCallback(async () => {
    const uid = userIdRef.current;
    if (!uid) return;
    setMatchesLoading(true);
    try {
      const { data } = await api.get('/api/me/matches');
      if (userIdRef.current !== uid) return;
      setMatches(Array.isArray(data) ? data : []);
    } catch {
      if (userIdRef.current === uid) setMatches([]);
    } finally {
      if (userIdRef.current === uid) setMatchesLoading(false);
    }
  }, []);

  /* ---------------- boot ---------------- */

  useEffect(() => {
    ensureSession()
      .then(({ user: sessionUser }) => {
        setCurrentUser(sessionUser);
        return fetchUserData();
      })
      .catch((error) => console.error('Session bootstrap failed', error));
  }, [setCurrentUser, fetchUserData]);

  useEffect(() => {
    if (inviteRoomId) {
      setView('BATTLE');
      setPlayMode('private');
    }
  }, [inviteRoomId]);

  // Resume a Paystack purchase: verify once on return, then refresh.
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
          notify('No pending payment for this account — your gems may already be added.', 'info');
          return;
        }
        try {
          const { data: result } = await api.post(`/api/economy/payments/${encodeURIComponent(pending.reference)}/verify`);
          if (canceled || userIdRef.current !== uid) return;
          const added = Number(result?.gemsAdded) || 0;
          notify(added > 0 ? `${added} gems added to your balance.` : 'Gems added to your balance.', 'success');
          await fetchUserData();
        } catch {
          if (canceled || userIdRef.current !== uid) return;
          notify(`Payment is still processing. Reference ${pending.reference}.`, 'info');
        }
      } catch {
        if (canceled || userIdRef.current !== uid) return;
        notify('Could not check the payment right now. Refresh in a moment.', 'info');
      }
    })();
    return () => { canceled = true; };
  }, [user.id, fetchUserData, notify]);

  useEffect(() => {
    api.get('/api/shop/items').then(({ data }) => setShopItems(data)).catch(() => {});
    api.get('/api/economy/gem-packages').then(({ data }) => setGemPackages(data)).catch(() => {});
    api.get('/api/config').then(({ data }) => setPaymentsConfigured(Boolean(data?.payments?.configured))).catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    api.get('/api/auth/providers')
      .then((res) => {
        if (!alive) return;
        setGoogleProviderConfigured(parseProviderResponse(res.data));
        setGoogleProvidersLoaded(true);
      })
      .catch(() => { if (alive) setGoogleProvidersLoaded(true); });
    return () => { alive = false; };
  }, []);

  const [isConnected, setIsConnected] = useState(socket.connected ? true : null);

  useEffect(() => {
    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);
    const onConnectError = () => setIsConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
    };
  }, []);

  const enterMultiplayerRoom = useCallback((room, message = '') => {
    saveActiveRoom(localStorage, room.id);
    setGameConfig((previous) => ({
      ...previous,
      mode: 'multiplayer',
      roomId: room.id,
      size: room.config.size,
      rounds: room.config.rounds,
      roomSnapshot: room,
      opponentName: null,
      opponentAvatar: null,
    }));
    if (isRankedRoom(room)) rankedBaselineRef.current = userRatingRef.current;
    setRatingChange(null);
    setRecoveryMessage(message);
    setActiveRoomConflict(null);
    setShowGameCreatedModal(false);
    setView('GAME');
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    socket.on('match_found', ({ roomId, opponent, opponentAvatar, room }) => {
      saveActiveRoom(localStorage, roomId);
      searchingRef.current = false;
      setIsSearching(false);
      setGameConfig((previous) => ({
        ...previous,
        mode: 'multiplayer',
        roomId,
        size: room?.config?.size || 3,
        rounds: room?.config?.rounds || 3,
        opponentAvatar,
        opponentName: opponent,
        roomSnapshot: room || null,
      }));
      if (isRankedRoom(room)) rankedBaselineRef.current = userRatingRef.current;
      setRatingChange(null);
      setView('GAME');
      window.scrollTo({ top: 0 });
    });

    socket.on('match_fallback_ai', () => {
      searchingRef.current = false;
      setIsSearching(false);
      setShowFallbackModal(true);
    });

    return () => {
      socket.off('match_found');
      socket.off('match_fallback_ai');
    };
  }, []);

  const sounds = useSound(userConfig.sound);
  const {
    board, handleClick, winner, seriesWinner, winningLine, isXNext, resetGame, mySymbol,
    gameStatus, round, score, readyNextRound, roomPlayers,
    disconnectDeadline, completionReason, actionError,
  } = useTicTacToe(gameConfig, setGameConfig, sounds, user);

  const resultWinner = gameStatus === 'complete' ? (seriesWinner || winner) : winner;
  const ratingChip = gameConfig.mode === 'multiplayer'
    && gameStatus === 'complete'
    && isRankedRoom(gameConfig.roomSnapshot)
    && !['disconnect_forfeit', 'voluntary_forfeit'].includes(completionReason)
    && ratingChange !== null && ratingChange.label !== ''
    ? ratingChange : null;

  const opponentPlayer = roomPlayers.find((player) => player.id !== user.id);
  const opponentDisconnected = gameConfig.mode === 'multiplayer' && opponentPlayer?.connected === false;
  const [disconnectSeconds, setDisconnectSeconds] = useState(0);

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
    if (view === 'HOME' || view === 'PROFILE') fetchMatches();
  }, [view, user.id, fetchMatches]);

  const clearRoomAndReturnHome = useCallback(() => {
    clearActiveRoom(localStorage);
    setRecoveryMessage('');
    setShowLeaveRoom(false);
    setActiveRoomConflict(null);
    setGameConfig((previous) => ({ ...previous, roomId: null, opponentName: null, opponentAvatar: null, roomSnapshot: null }));
    rankedBaselineRef.current = null;
    setRatingChange(null);
    setView('HOME');
  }, []);

  const handleLifecycleFailure = (result) => {
    if (result?.code === 'ACTIVE_ROOM_EXISTS' && result.roomId) {
      setActiveRoomConflict(result.roomId);
      setRecoveryMessage('');
      setShowGameCreatedModal(false);
      setIsSearching(false);
      searchingRef.current = false;
      return;
    }
    if (result?.code === 'RATE_LIMITED') {
      const seconds = Math.max(1, Math.ceil((result.retryAfterMs || 1000) / 1000));
      setRecoveryMessage(`Too many room actions. Try again in ${seconds}s.`);
      setIsSearching(false);
      searchingRef.current = false;
      return;
    }
    if (result?.code === 'ALREADY_MATCHMAKING') return;
    setRecoveryMessage(httpErrorMessage(result?.error ?? result, 'That action could not be completed.'));
    setIsSearching(false);
    searchingRef.current = false;
  };

  useEffect(() => {
    if (isConnected !== true || !user.id || activeRoomConflict) return;
    if (skipRecoveryOnce.current) {
      skipRecoveryOnce.current = false;
      return;
    }
    const activeRoom = readActiveRoom(localStorage);
    if (!activeRoom) return;

    socket.timeout(6000).emit('resume_room', { roomId: activeRoom.roomId }, (timeoutError, result) => {
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
        setGameConfig((previous) => (previous.roomId === activeRoom.roomId
          ? { ...previous, roomId: null, opponentName: null, opponentAvatar: null }
          : previous));
        setView('HOME');
        setRecoveryMessage(httpErrorMessage(result.error, 'That room is no longer available.'));
        return;
      }
      enterMultiplayerRoom(result.room, 'Match restored.');
    });
  }, [isConnected, user.id, activeRoomConflict, enterMultiplayerRoom]);

  useEffect(() => {
    if (gameStatus === 'complete' || gameStatus === 'cancelled') setRecoveryMessage('');
  }, [gameStatus]);

  useEffect(() => {
    localStorage.setItem('noughtline_config', JSON.stringify(userConfig));
    localStorage.removeItem('plaything_config');
  }, [userConfig]);

  useEffect(() => {
    const preference = normalizeThemePreference(userConfig.theme);
    const mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    const apply = () => document.documentElement.setAttribute('data-theme', resolveTheme(preference, mql ? mql.matches : false));
    apply();
    if (preference !== 'system' || !mql) return undefined;
    const onChange = () => apply();
    if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onChange);
    else if (typeof mql.addListener === 'function') mql.addListener(onChange);
    return () => {
      if (typeof mql.removeEventListener === 'function') mql.removeEventListener('change', onChange);
      else if (typeof mql.removeListener === 'function') mql.removeListener(onChange);
    };
  }, [userConfig.theme]);

  useEffect(() => {
    const isWin = resultWinner === mySymbol;
    const isLoss = resultWinner && resultWinner !== 'Draw' && resultWinner !== mySymbol;
    if (isWin) {
      sounds.playWin();
      confetti({ particleCount: 120, spread: 90, origin: { y: 0.65 }, colors: ['#f2b33d', '#ffffff', '#b4b4b4'] });
    } else if (isLoss) {
      sounds.playLose();
    }
  }, [resultWinner, mySymbol, sounds]);

  useEffect(() => {
    if (gameConfig.mode === 'multiplayer' && gameStatus === 'complete') {
      fetchUserData();
      fetchMatches();
    }
  }, [gameStatus, gameConfig.mode, fetchUserData, fetchMatches]);

  useEffect(() => {
    if (gameConfig.mode !== 'multiplayer' || gameStatus !== 'complete') return undefined;
    if (!isRankedRoom(gameConfig.roomSnapshot)) return undefined;
    if (['disconnect_forfeit', 'voluntary_forfeit'].includes(completionReason)) return undefined;
    if (rankedBaselineRef.current === null) return undefined;
    const uid = userIdRef.current;
    if (!uid) return undefined;

    setRatingChange(null);
    const seq = ratingSettleSeqRef.current + 1;
    ratingSettleSeqRef.current = seq;
    api.get('/api/me')
      .then((res) => {
        if (userIdRef.current !== uid) return;
        const next = res.data?.rating;
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
    return undefined;
  }, [gameStatus, gameConfig.mode, gameConfig.roomSnapshot, completionReason]);

  /* ---------------- navigation ---------------- */

  const navigate = useCallback((target, options = {}) => {
    setShowSettings(false);
    setShowBuyGems(false);
    setSelectedShopItem(null);
    setShowGameCreatedModal(false);
    setShowFallbackModal(false);
    if (target !== 'play') setShowLeaveRoom(false);

    switch (target) {
      case 'home': setView('HOME'); break;
      case 'ranks': setView('LEADERBOARD'); break;
      case 'play': setView('BATTLE'); if (options.mode) setPlayMode(options.mode); break;
      case 'profile': setView('PROFILE'); if (options.tab) setProfileTab(options.tab); break;
      case 'shop': setView('SHOP'); break;
      case 'tournaments': setView('TOURNAMENTS'); setTournamentFocus(options.id ?? null); break;
      case 'game': setView('GAME'); break;
      default: setView('HOME');
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  const handleOpenTournament = useCallback((id) => {
    navigate('tournaments', { id });
  }, [navigate]);

  /* ---------------- multiplayer actions ---------------- */

  const handleHostGame = (rounds, size) => new Promise((resolve) => {
    if (hostingRef.current) {
      resolve({ error: 'A room is already being created.' });
      return;
    }
    hostingRef.current = true;
    socket.timeout(10000).emit('create_room', { config: { size, rounds } }, (timeoutError, result) => {
      hostingRef.current = false;
      if (timeoutError) {
        resolve({ error: 'The server did not answer. Try again.' });
        return;
      }
      if (result?.error) {
        handleLifecycleFailure(result);
        resolve(result);
        return;
      }
      saveActiveRoom(localStorage, result.room.id);
      setGameConfig((previous) => ({
        ...previous, mode: 'multiplayer', roomId: result.room.id, size, rounds, roomSnapshot: result.room,
      }));
      setRecoveryMessage('');
      setShowGameCreatedModal(true);
      resolve({ room: result.room });
    });
  });

  const handleStartGame = () => {
    setShowGameCreatedModal(false);
    setView('GAME');
    window.scrollTo({ top: 0 });
  };

  const clearInvitePath = () => {
    if (getInviteRoomId(window.location.pathname)) window.history.replaceState({}, '', '/');
  };

  const handleJoinRoom = (rawCode) => new Promise((resolve) => {
    if (!socket.connected) {
      resolve({ error: 'Still connecting to Noughtline. Try again in a moment.' });
      return;
    }
    const roomId = normalizeRoomId(rawCode);
    if (!roomId) {
      resolve({ error: 'Enter a valid room code or invite link.' });
      return;
    }
    socket.timeout(8000).emit('join_room', { roomId }, (timeoutError, result) => {
      if (timeoutError) {
        resolve({ error: 'The room did not respond in time. Try again.' });
        return;
      }
      if (result?.error) {
        if (result.code === 'ACTIVE_ROOM_EXISTS' || result.code === 'RATE_LIMITED') handleLifecycleFailure(result);
        resolve(result);
        return;
      }
      enterMultiplayerRoom(result.room);
      clearInvitePath();
      setInviteRoomId('');
      resolve({ room: result.room });
    });
  });

  const performLeaveRoom = () => {
    if (!gameConfig.roomId || leavePending) return;
    if (!socket.connected) {
      setRecoveryMessage('Reconnect before leaving this room.');
      return;
    }
    const roomId = gameConfig.roomId;
    const leavingTournament = String(roomId || '').startsWith('TM_');
    setLeavePending(true);
    socket.timeout(8000).emit('leave_room', { roomId }, (timeoutError, result) => {
      setLeavePending(false);
      if (timeoutError) {
        skipRecoveryOnce.current = true;
        clearRoomAndReturnHome();
        return;
      }
      if (result?.error) {
        const terminal = ['ROOM_NOT_FOUND', 'NOT_ROOM_MEMBER', 'No active room to resume'].includes(result.code)
          || result.error === 'Room not found';
        if (terminal) {
          skipRecoveryOnce.current = true;
          clearRoomAndReturnHome();
          return;
        }
        handleLifecycleFailure(result);
        return;
      }
      clearRoomAndReturnHome();
      if (leavingTournament) setView('TOURNAMENTS');
    });
  };

  const returnToTournament = useCallback(() => {
    const roomId = gameConfig.roomId;
    const clear = () => {
      clearActiveRoom(localStorage);
      setGameConfig((previous) => ({ ...previous, roomId: null, opponentName: null, opponentAvatar: null, roomSnapshot: null }));
      setView('TOURNAMENTS');
      window.scrollTo({ top: 0 });
    };
    if (!roomId || !socket.connected) {
      clear();
      return;
    }
    socket.timeout(5000).emit('leave_room', { roomId }, () => clear());
  }, [gameConfig.roomId]);

  const handleGameBack = () => {
    if (gameConfig.mode !== 'multiplayer') {
      setView('HOME');
      window.scrollTo({ top: 0 });
      return;
    }
    if (gameStatus === 'complete' || gameStatus === 'cancelled') {
      if (String(gameConfig.roomId || '').startsWith('TM_')) returnToTournament();
      else performLeaveRoom();
      return;
    }
    setRecoveryMessage('');
    setShowLeaveRoom(true);
  };

  const handleResumeActiveRoom = () => {
    if (!activeRoomConflict || activeRoomPending) return;
    setActiveRoomPending(true);
    socket.timeout(8000).emit('resume_room', { roomId: activeRoomConflict }, (timeoutError, result) => {
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
    setActiveRoomConflict(null);
    setView('HOME');
  };

  const handleAbandonActiveRoom = () => {
    if (!activeRoomConflict || activeRoomPending) return;
    const roomId = activeRoomConflict;
    setActiveRoomPending(true);
    socket.timeout(8000).emit('leave_room', { roomId }, () => {
      setActiveRoomPending(false);
      skipRecoveryOnce.current = true;
      clearActiveRoom(localStorage);
      setActiveRoomConflict(null);
      setGameConfig((previous) => ({ ...previous, roomId: null, roomSnapshot: null, opponentName: null, opponentAvatar: null }));
      setView('HOME');
    });
  };

  const handleCopyActiveInvite = async () => {
    if (!activeRoomConflict) return;
    try {
      await navigator.clipboard.writeText(createInviteUrl(activeRoomConflict, window.location.origin));
      setRecoveryMessage('Invite link copied.');
    } catch {
      setRecoveryMessage(`Copy failed. Share room code ${activeRoomConflict}.`);
    }
  };

  const handleCopyGameInvite = async () => {
    if (!gameConfig.roomId) return;
    try {
      await navigator.clipboard.writeText(createInviteUrl(gameConfig.roomId, window.location.origin));
      setCopiedInvite(true);
      window.setTimeout(() => setCopiedInvite(false), 2200);
    } catch {
      notify(`Copy failed. Room code ${gameConfig.roomId}.`, 'error');
    }
  };

  const handlePlayStranger = () => {
    if (searchingRef.current) return;
    if (!socket.connected) {
      setRecoveryMessage('Reconnect before joining the queue.');
      return;
    }
    searchingRef.current = true;
    setIsSearching(true);
    socket.timeout(10000).emit('find_match', {}, (timeoutError, result) => {
      if (timeoutError) {
        searchingRef.current = false;
        setIsSearching(false);
        setRecoveryMessage('Matchmaking did not respond. Try again.');
        return;
      }
      if (result?.error) handleLifecycleFailure(result);
    });
  };

  const handleRequestRematch = () => {
    if (!gameConfig.roomId || !socket.connected) return;
    socket.timeout(8000).emit('request_rematch', { roomId: gameConfig.roomId }, (timeoutError, result) => {
      if (timeoutError) {
        notify('The rematch request did not reach the server. Try again.', 'error');
        return;
      }
      if (result?.error) {
        if (result.code === 'ACTIVE_ROOM_EXISTS') {
          // The server reports the first player it finds in another room; do not
          // open "your active room" for a room the requester is not in.
          notify('Rematch unavailable — one player is already in another match.', 'info');
          return;
        }
        handleLifecycleFailure(result);
      }
    });
  };

  const handleCancelSearch = () => {
    searchingRef.current = false;
    setIsSearching(false);
    socket.emit('cancel_matchmaking');
  };

  const handlePlayVsAIFallback = () => {
    setShowFallbackModal(false);
    setGameConfig((previous) => ({
      ...previous, mode: 'singleplayer', difficulty: 'medium', size: 3, roomId: null,
      opponentName: null, opponentAvatar: null, roomSnapshot: null,
    }));
    resetGame();
    setView('GAME');
    window.scrollTo({ top: 0 });
  };

  const startPractice = () => {
    setGameConfig((previous) => ({ ...previous, mode: 'singleplayer', roomId: null, opponentName: null, opponentAvatar: null, roomSnapshot: null }));
    resetGame();
    setView('GAME');
    window.scrollTo({ top: 0 });
  };

  /* ---------------- account ---------------- */

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
    clearGooglePromptTimer();
    if (!googleSignInBusyRef.current) return;
    googleSignInBusyRef.current = false;
    setGoogleSignInPending(false);
  };

  const linkGoogleCredential = async (credential, nonce) => {
    try {
      const { data } = await api.post('/api/auth/google', { idToken: credential, nonce });
      if (data?.switched) {
        if (!data.token) throw new Error('The server did not return a session for the linked account. Please try again.');
        adoptSessionToken(data.token);
        clearActiveRoom(localStorage);
        setMatches([]);
      }
      await fetchUserData();
      notify('Signed in with Google.', 'success');
    } catch (error) {
      const { message, canceled } = normalizeGoogleError(error);
      if (!canceled && message) notify(message, 'error');
    } finally {
      resetGoogleSignInBusy();
    }
  };

  const handleGoogleLogin = async () => {
    if (googleSignInBusyRef.current) return;

    if (googleAvailability === 'unknown') {
      let configured = false;
      try {
        const { data } = await api.get('/api/auth/providers');
        configured = parseProviderResponse(data);
      } catch { /* treated as unconfigured */ }
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

    let nonce = null;
    try {
      try {
        const nonceRes = await api.post('/api/auth/google/nonce');
        nonce = nonceRes.data?.nonce;
      } catch (error) {
        if (error.response?.status !== 401) throw error;
        await ensureSession();
        const nonceRes = await api.post('/api/auth/google/nonce');
        nonce = nonceRes.data?.nonce;
      }
      if (!nonce) throw new Error('Google sign-in could not be started. Please try again.');

      await loadGsiScript();
      const gsiId = window.google?.accounts?.id;
      if (!gsiId) throw new Error('Google sign-in is unavailable in this browser.');

      const config = buildGoogleIdConfig({
        clientId: GOOGLE_CLIENT_ID,
        nonce,
        callback: (response) => {
          const credential = response?.credential;
          if (!credential) { resetGoogleSignInBusy(); return; }
          clearGooglePromptTimer();
          linkGoogleCredential(credential, nonce);
        },
      });
      if (!config) throw new Error('Google sign-in is not configured correctly.');

      gsiId.initialize(config);
      googlePromptTimerRef.current = window.setTimeout(() => {
        const current = window.google?.accounts?.id;
        if (current && typeof current.cancel === 'function') current.cancel();
        resetGoogleSignInBusy();
      }, 60000);
      const onPromptMoment = (notification) => {
        if (!notification) return;
        const resolved = (typeof notification.isSkippedMoment === 'function' && notification.isSkippedMoment())
          || (typeof notification.isDismissedMoment === 'function' && notification.isDismissedMoment())
          || (typeof notification.isNotDisplayed === 'function' && notification.isNotDisplayed());
        if (resolved) resetGoogleSignInBusy();
      };
      gsiId.prompt(onPromptMoment);
    } catch (error) {
      const { message, canceled } = normalizeGoogleError(error);
      if (!canceled && message) notify(message, 'error');
      resetGoogleSignInBusy();
    }
  };

  const buyGemPackage = async (packageId) => {
    if (!packageId) return;
    try {
      const { data } = await api.post('/api/economy/payments', { packageId });
      window.location.assign(data.authorizationUrl);
    } catch (error) {
      notify(httpErrorMessage(error, 'Payment could not be started. Payments may not be configured in this environment.'), 'error');
    }
  };

  const buyAvatar = async (avatarId) => {
    try {
      await api.post('/api/shop/purchase', { avatarId });
      await fetchUserData();
      setSelectedShopItem(null);
      notify('Avatar added to your collection.', 'success');
    } catch (error) {
      const message = String(error?.response?.data?.error || '');
      if (/already own/i.test(message)) {
        await fetchUserData();
        setSelectedShopItem(null);
        notify('You already own this avatar.', 'info');
        return;
      }
      notify(httpErrorMessage(error, 'Purchase failed'), 'error');
    }
  };

  const handleExportData = async () => {
    try {
      const res = await api.get('/api/me/export');
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(res.data, null, 2));
      const anchor = document.createElement('a');
      anchor.setAttribute('href', dataStr);
      anchor.setAttribute('download', `noughtline_data_${new Date().toISOString()}.json`);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      notify('Data export downloaded.', 'success');
    } catch {
      notify('Export failed.', 'error');
    }
  };

  const handleDeleteAccount = async () => {
    if (deletePending) return;
    setDeletePending(true);
    try {
      await api.delete('/api/me');
      setShowDeleteConfirm(false);
      notify('Account deleted. Goodbye.', 'success');
      clearSession();
      window.setTimeout(() => window.location.reload(), 1600);
    } catch {
      setDeletePending(false);
      notify('Delete failed.', 'error');
    }
  };

  const handleLogout = async () => {
    if (logoutPending) return;
    setLogoutPending(true);
    try {
      await logoutSession();
      clearActiveRoom(localStorage);
      setGameConfig((previous) => ({ ...previous, roomId: null, opponentName: null, opponentAvatar: null, roomSnapshot: null }));
      setRecoveryMessage('');
      setIsSearching(false);
      searchingRef.current = false;
      setShowLeaveRoom(false);
      setActiveRoomConflict(null);
      setMatches([]);
      const { user: freshUser } = await ensureSession();
      setCurrentUser(freshUser);
      await fetchUserData();
      setShowLogoutConfirm(false);
      setLogoutPending(false);
      setView('HOME');
      setShowSettings(false);
    } catch {
      clearSession();
      window.location.reload();
    }
  };

  const equipAvatar = async (avatarId) => {
    try {
      await api.post('/api/me/equip-avatar', { avatarId });
      await fetchUserData();
      sounds.playClick();
      notify('Avatar equipped.', 'success');
    } catch (error) {
      notify(httpErrorMessage(error, 'Failed to equip the avatar.'), 'error');
    }
  };

  /* ---------------- render ---------------- */

  const isGame = view === 'GAME';

  return (
    <div className={`app-shell${isGame ? ' is-game' : ''}`}>
      {isConnected === false && (
        <div className="connection-banner" role="status" aria-live="polite">
          Offline — reconnecting to the arena…
        </div>
      )}

      {!isGame && (
        <Sidebar
          view={view}
          onNavigate={navigate}
          user={user}
          connected={isConnected}
          onOpenSettings={() => setShowSettings(true)}
        />
      )}

      <div className="workspace">
        {!isGame && (
          <TopBar
            user={user}
            connected={isConnected}
            onBuyGems={() => setShowBuyGems(true)}
            onOpenSettings={() => setShowSettings(true)}
            onNavigate={navigate}
          />
        )}

        {recoveryMessage && (
          <div className="notice-bar" role="status" aria-live="polite">
            <span>{recoveryMessage}</span>
            <button type="button" className="icon-btn" onClick={() => setRecoveryMessage('')} aria-label="Dismiss message">×</button>
          </div>
        )}

        <main className={`content${isGame ? ' content-game' : ''}`}>
          {view === 'HOME' && (
            <HomeScreen
              user={user}
              matches={matches}
              matchesLoading={matchesLoading}
              searching={isSearching}
              onFindMatch={handlePlayStranger}
              onCancelSearch={handleCancelSearch}
              onNavigate={navigate}
              onOpenTournament={handleOpenTournament}
            />
          )}

          {view === 'LEADERBOARD' && <RanksScreen user={user} />}

          {view === 'BATTLE' && (
            <PlayScreen
              mode={playMode}
              onModeChange={(next) => {
                if (next === 'tournaments') { navigate('tournaments'); return; }
                setPlayMode(next);
              }}
              user={user}
              rating={Number.isFinite(Number(user?.rating)) ? Number(user.rating) : null}
              searching={isSearching}
              onFindMatch={handlePlayStranger}
              onCancelSearch={handleCancelSearch}
              connected={isConnected === true}
              gameConfig={gameConfig}
              setGameConfig={setGameConfig}
              onHost={handleHostGame}
              onJoin={handleJoinRoom}
              onResume={handleStartGame}
              onCopyInvite={handleCopyGameInvite}
              onStartPractice={startPractice}
              initialCode={inviteRoomId}
              
            />
          )}

          {view === 'PROFILE' && (
            <ProfileScreen
              user={user}
              inventory={inventory}
              notify={notify}
              onRefreshUser={fetchUserData}
              onEquip={equipAvatar}
              onGoogleSignIn={handleGoogleLogin}
              googlePending={googleSignInPending}
              googleAvailable={googleAvailability === 'enabled'}
              initialTab={profileTab}
            />
          )}

          {view === 'SHOP' && (
            <ShopScreen
              user={user}
              inventory={inventory}
              shopItems={shopItems}
              gemPackages={gemPackages}
              loading={shopItems.length === 0}
              onSelectItem={setSelectedShopItem}
              onEquip={equipAvatar}
              onBuyGems={(packageId) => (packageId ? buyGemPackage(packageId) : setShowBuyGems(true))}
              paymentsEnabled={paymentsConfigured}
            />
          )}

          {view === 'TOURNAMENTS' && (
            <TournamentsScreen
              userId={user.id}
              notify={notify}
              onEnterMatch={handleJoinRoom}
              initialId={tournamentFocus}
              onExit={() => navigate('home')}
              onRefreshUser={() => { fetchUserData(); fetchMatches(); }}
            />
          )}

          {isGame && (
            <GameScreen
              user={user}
              gameConfig={gameConfig}
              board={board}
              winningLine={winningLine}
              onPlay={handleClick}
              isXNext={isXNext}
              mySymbol={mySymbol}
              gameStatus={gameStatus}
              round={round}
              score={score}
              roomPlayers={roomPlayers}
              disconnectSeconds={disconnectSeconds}
              completionReason={completionReason}
              actionError={actionError}
              resultWinner={resultWinner}
              ratingChip={ratingChip}
              opponentDisconnected={opponentDisconnected}
              onBack={handleGameBack}
              onReadyNextRound={readyNextRound}
              onRematch={handleRequestRematch}
              onReturnHome={() => { if (String(gameConfig.roomId || '').startsWith('TM_')) returnToTournament(); else clearRoomAndReturnHome(); }}
              onReset={resetGame}
              onCopyInvite={gameConfig.mode === 'multiplayer' ? handleCopyGameInvite : undefined}
              copied={copiedInvite}
              chatSlot={gameConfig.mode === 'multiplayer' && gameConfig.roomId
                ? <RoomChat roomId={gameConfig.roomId} userId={user.id} notify={notify} />
                : null}
            />
          )}
        </main>

        {!isGame && <BottomNav view={view} onNavigate={navigate} />}
      </div>

      {toasts.length > 0 && (
        <div className="toast-stack" role="status" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast toast-${toast.tone}`}>
              <span>{toast.message}</span>
              <button type="button" className="icon-btn" onClick={() => dismissToast(toast.id)} aria-label="Dismiss notification">×</button>
            </div>
          ))}
        </div>
      )}

      <SettingsDialog
        open={showSettings}
        onClose={() => setShowSettings(false)}
        config={userConfig}
        setConfig={setUserConfig}
        onExport={handleExportData}
        onDelete={() => { setShowSettings(false); setShowDeleteConfirm(true); }}
        onLogout={() => { setShowSettings(false); setShowLogoutConfirm(true); }}
      />

      <BuyGemsDialog
        open={showBuyGems}
        packages={gemPackages}
        paymentsEnabled={paymentsConfigured}
        onClose={() => setShowBuyGems(false)}
        onBuy={buyGemPackage}
      />

      <ShopItemDialog
        item={selectedShopItem}
        user={user}
        onClose={() => setSelectedShopItem(null)}
        onBuy={buyAvatar}
        onCannotAfford={(item) => notify(insufficientGuidance(item), 'error')}
      />

      {showGameCreatedModal && (
        <GameCreatedDialog
          roomId={gameConfig.roomId}
          onClose={() => setShowGameCreatedModal(false)}
          onStart={handleStartGame}
        />
      )}

      {showFallbackModal && (
        <FallbackDialog onPlayAI={handlePlayVsAIFallback} onClose={() => setShowFallbackModal(false)} />
      )}

      {showLeaveRoom && (
        <LeaveRoomDialog
          gameStatus={gameStatus}
          hasOpponent={Boolean(opponentPlayer)}
          pending={leavePending}
          onCancel={() => setShowLeaveRoom(false)}
          onConfirm={performLeaveRoom}
        />
      )}

      {activeRoomConflict && (
        <ActiveRoomDialog
          roomId={activeRoomConflict}
          pending={activeRoomPending}
          onResume={handleResumeActiveRoom}
          onLeave={handleAbandonActiveRoom}
          onCopy={handleCopyActiveInvite}
          onClose={handleCloseActiveRoom}
        />
      )}

      {showDeleteConfirm && (
        <ConfirmDialog
          title="Delete this account?"
          description="The account, collection, coins, rating and progress are permanently deleted. This cannot be undone."
          confirmLabel="Delete account"
          pendingLabel="Deleting…"
          busy={deletePending}
          onCancel={() => setShowDeleteConfirm(false)}
          onConfirm={handleDeleteAccount}
        />
      )}

      {showLogoutConfirm && (
        <ConfirmDialog
          title="Log out?"
          description="This abandons the current guest account — progress, coins and unlocks cannot be recovered. You continue as a brand-new guest."
          confirmLabel="Log out"
          pendingLabel="Logging out…"
          busy={logoutPending}
          onCancel={() => setShowLogoutConfirm(false)}
          onConfirm={handleLogout}
          tone="danger"
        />
      )}
    </div>
  );
}
