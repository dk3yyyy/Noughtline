import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { api, clearSession, ensureSession, getSocket, logoutSession } from './services/client';
import { clearActiveRoom, createInviteUrl, getInviteRoomId, normalizeRoomId, readActiveRoom, saveActiveRoom } from './services/rooms';
import {
  Home,
  Trophy,
  Swords,
  User,
  ShoppingBag,
  Zap,
  Flame,
  Gem,
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
  Link2,
  Share2,
  AlertTriangle,
  LogOut
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

const ShopItemModal = ({ show, onClose, item, user, onBuy }) => {
  if (!show || !item) return null;
  const currency = item.currency === 'coins' ? 'coins' : 'gems';
  const cost = currency === 'coins' ? item.cost_coins : item.cost_gems;
  const canAfford = (user[currency] || 0) >= cost;

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

        <p className="item-desc">{item.description || "Unlock this exclusive item for your collection."}</p>

        <button
          className={`btn-action-lg ${canAfford ? 'btn-purple' : 'btn-disabled'}`}
          onClick={() => canAfford ? onBuy(item.id) : null}
        >
          {canAfford ? 'Unlock Item' : 'Insufficient Gems'}
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
  const [showLeaveRoom, setShowLeaveRoom] = useState(false);
  const [leavePending, setLeavePending] = useState(false);
  const [activeRoomConflict, setActiveRoomConflict] = useState(null);
  const [activeRoomPending, setActiveRoomPending] = useState(false);
  const skipRecoveryOnce = useRef(false);

  // Persisted state
  const [userConfig, setUserConfig] = useState(() => {
    const saved = localStorage.getItem('noughtline_config') || localStorage.getItem('plaything_config');
    return saved ? JSON.parse(saved) : { theme: 'dark', sound: true };
  });

  const [gameConfig, setGameConfig] = useState({ size: 3, difficulty: 'easy', mode: 'singleplayer', roomId: null });
  const [user, setUser] = useState({ username: 'Guest', gems: 0, coins: 0, xp: 0, streak: 0 });
  const [leaderboard, setLeaderboard] = useState([]);
  const [shopItems, setShopItems] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [gemPackages, setGemPackages] = useState([]);
  const [stats, setStats] = useState({ streak: 0, xp: 0, coins: 0 });

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

  // Server-issued guest session. The browser never chooses the account ID.
  useEffect(() => {
    ensureSession()
      .then(({ user: sessionUser }) => {
        setUser(sessionUser);
        return fetchUserData();
      })
      .catch((error) => console.error('Session bootstrap failed', error));
  }, [fetchUserData]);

  // Fetch shop items on mount
  useEffect(() => {
    api.get('/api/shop/items').then(res => setShopItems(res.data));
    api.get('/api/economy/gem-packages').then(res => setGemPackages(res.data));
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
      setView('GAME');
    });

    socket.on('match_fallback_ai', () => {
      setIsSearching(false);
      setShowMultiplayerMenu(false);
      // Fallback to AI if no stranger found
      setGameConfig(prev => ({ ...prev, mode: 'singleplayer', difficulty: 'medium', size: 3 }));
      setView('GAME');
      alert("No stranger found. Matching with AI Bot!");
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

  const sounds = useSound(userConfig.sound);
  const {
    board, handleClick, winner, seriesWinner, winningLine, isXNext, resetGame, mySymbol,
    gameStatus, round, score, readyNextRound, requestRematch, roomPlayers,
    disconnectDeadline, completionReason, actionError,
  } = useTicTacToe(gameConfig, setGameConfig, sounds, user);
  const resultWinner = gameStatus === 'complete' ? (seriesWinner || winner) : winner;
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

  const handleGoogleLogin = async () => {
    alert('Google account linking is disabled until real OAuth credentials and server-side token verification are configured.');
  };

  const buyGemPackage = async (packageId) => {
    try {
      const { data } = await api.post('/api/economy/payments', { packageId });
      window.location.assign(data.authorizationUrl);
    } catch (error) {
      alert(error.response?.data?.error || 'Payment could not be started');
    }
  };

  const buyAvatar = async (avatarId) => {
    try {
      await api.post('/api/shop/purchase', { avatarId });
      await fetchUserData();
      setSelectedShopItem(null);
      alert("Avatar Added to Collection!");
    } catch (error) { alert(error.response?.data?.error || "Purchase failed"); }
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
    } catch { alert("Export failed"); }
  };

  const handleDeleteAccount = async () => {
    if (!confirm("Are you sure? This is permanent and cannot be undone.")) return;

    try {
      await api.delete('/api/me');
      alert("Account Deleted. Goodbye!");
      clearSession();
      window.location.reload();
    } catch { alert("Delete failed"); }
  };

  const handleLogout = async () => {
    if (!confirm("Log out? This abandons the current guest account — progress, coins and unlocks cannot be recovered. You will continue as a brand-new guest.")) return;

    try {
      // Revokes the session server-side, clears the stored token, disconnects the socket.
      await logoutSession();
      // Continue seamlessly as a brand-new guest (fresh token + profile).
      const { user: freshUser } = await ensureSession();
      setUser(freshUser);
      await fetchUserData();
      // Do not auto-resume into the previous guest's room.
      clearActiveRoom(localStorage);
      setGameConfig(previous => ({ ...previous, roomId: null, opponentName: null, opponentAvatar: null, roomSnapshot: null }));
      setRecoveryMessage('');
      setIsSearching(false);
      setShowLeaveRoom(false);
      setActiveRoomConflict(null);
      setShowMultiplayerMenu(false);
      setActiveTab('home');
      setView('HOME');
      setShowSettings(false);
    } catch { alert("Log out failed. Please try again."); }
  };

  const equipAvatar = async (avatarId) => {
    try {
      await api.post('/api/me/equip-avatar', { avatarId });
      await fetchUserData();
      sounds.playClick();
    } catch { alert("Failed to equip"); }
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
      <TopBar stats={stats} setShowSettings={setShowSettings} user={user} onBuyGems={() => setShowBuyGems(true)} />

      <SettingsModal
        show={showSettings}
        onClose={() => setShowSettings(false)}
        config={userConfig}
        setConfig={setUserConfig}
        onExport={handleExportData}
        onDelete={handleDeleteAccount}
        onLogout={handleLogout}
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
              <p className="page-intro">Players ranked by experience earned in eligible matches.</p>
              <div className="leaderboard-list">
                {leaderboard.length > 0 ? leaderboard.map((u, i) => (
                  <div className="rank-item glass" key={i}>
                    <span className="rank-num">#{i + 1}</span>
                    <img src={u.avatar} className="rank-avatar" alt={`${u.username} avatar`} />
                    <div className="rank-info">
                      <p className="rank-name">{u.username}</p>
                      <span className="rank-xp">{u.xp} XP</span>
                    </div>
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
                  <button className="btn-primary google-button" onClick={handleGoogleLogin}>
                    <img src="https://www.google.com/favicon.ico" alt="" />
                    Sign in with Google
                  </button>
                </div>
              )}

              <div className="profile-header">
                <img src={user.avatar} alt="Avatar" className="large-avatar" />
                <h2>{user.username}</h2>
                <p className="text-accent-teal">{user.email || 'Guest Account'}</p>
                <p className="text-accent-teal" style={{ opacity: 0.7 }}>Level {user.level || 1}</p>
              </div>

              <div className="stats-grid">
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
              </div>

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
