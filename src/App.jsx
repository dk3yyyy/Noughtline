import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { api, clearSession, ensureSession, getSocket } from './services/client';
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
  RotateCcw
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

const SettingsModal = ({ show, onClose, config, setConfig, onExport, onDelete }) => {
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
          <button className="btn-gray" style={{ background: '#ef4444', color: 'white' }} onClick={() => onDelete && onDelete()}>Delete Account</button>
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
      <div className="stat-item glass clickable" onClick={onBuyGems}>
        <Gem size={16} color="#2dd4bf" fill="#2dd4bf" />
        <span>{user.gems || 0}</span>
        <div className="plus-btn">+</div>
      </div>
      <div className="stat-item glass">
        <Coins size={16} color="#fbbf24" fill="#fbbf24" />
        <span>{stats.coins.toFixed(2)}</span>
      </div>
    </div>
    <button className="profile-btn-wrapper" onClick={() => setShowSettings(true)}>
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
          >
            <Icon size={24} className="nav-icon" />
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

const GameCreatedModal = ({ show, onClose, roomId, onStart }) => {
  const [copied, setCopied] = useState(false);

  if (!show) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <motion.div
        className="modal-content multiplayer-menu"
        onClick={e => e.stopPropagation()}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
      >
        <h2 className="modal-title">Game Created!</h2>

        <p style={{ marginBottom: '1rem', color: '#64748b' }}>
          Share this code with your friend:
        </p>

        <div style={{
          background: '#f1f5f9',
          padding: '1rem',
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          marginBottom: '2rem',
          fontSize: '1.5rem',
          fontWeight: 'bold',
          color: '#1e1b4b'
        }}>
          <span>{roomId}</span>
          <button
            onClick={handleCopy}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            {copied ? <div style={{ fontSize: '0.8rem', color: 'green' }}>✓</div> : <span style={{ fontSize: '1.2rem' }}>📋</span>}
          </button>
        </div>

        <div className="btn-stack">
          <button className="btn-pink" onClick={onStart}>Start Game</button>
          <button className="btn-gray" onClick={onClose}>Cancel</button>
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

// --- Game Logic Hooks ---

const socket = getSocket();

const useTicTacToe = (gameConfig, setGameConfig, sounds, user) => {
  const { size: boardSize, mode, roomId, difficulty } = gameConfig;
  const [board, setBoard] = useState(Array(boardSize * boardSize).fill(null));
  const [isXNext, setIsXNext] = useState(true);
  const [winner, setWinner] = useState(null);
  const [winningLine, setWinningLine] = useState([]);
  const [isActionPending, setIsActionPending] = useState(false); // For network ops
  const [mySymbol, setMySymbol] = useState('X');
  const [gameStatus, setGameStatus] = useState('waiting');
  const [round, setRound] = useState(1);
  const [score, setScore] = useState({ X: 0, O: 0 });

  useEffect(() => {
    // Reset Logic
    setBoard(Array(boardSize * boardSize).fill(null));
    setIsXNext(true);
    setWinner(null);
    setWinningLine([]);
    setIsActionPending(false);
    setGameStatus(mode === 'singleplayer' ? 'active' : 'waiting');
    setRound(1);
    setScore({ X: 0, O: 0 });
    if (mode === 'singleplayer') setMySymbol('X');

    if (mode === 'multiplayer' && roomId) {
      socket.emit('join_room', { roomId, username: user.username });

      socket.on('room_update', (room) => {
        setBoard(room.state.board);
        setIsXNext(room.state.isXNext);
        setWinner(room.state.winner);
        setWinningLine(room.state.winningLine);
        setGameStatus(room.state.status);
        setRound(room.state.round);
        setScore(room.state.score);
        setIsActionPending(false);

        // Find my symbol
        const me = room.players.find(p => p.id === user.id);
        if (me) setMySymbol(me.symbol);

        // Sync board size if it differs (e.g. joined a room with different size)
        if (room.config && room.config.size !== boardSize) {
          setGameConfig(prev => ({ ...prev, size: room.config.size }));
        }
      });

      socket.on('game_error', (err) => {
        setIsActionPending(false);
        alert(err);
      });

      return () => {
        socket.off('room_update');
        socket.off('game_error');
        // socket.emit('leave_room'); // Optional if component unmounts
      };
    }
  }, [boardSize, mode, roomId, setGameConfig, user.id, user.username]);

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
    setWinningLine([]);
  };

  const readyNextRound = () => socket.emit('ready_next_round', { roomId });
  const requestRematch = () => socket.emit('request_rematch', { roomId });

  return { board, handleClick, winner, winningLine, isXNext, resetGame, mySymbol, gameStatus, round, score, readyNextRound, requestRematch };
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
  const [isSearching, setIsSearching] = useState(false);

  // Persisted state
  const [userConfig, setUserConfig] = useState(() => {
    const saved = localStorage.getItem('plaything_config');
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

  // Connection State
  const [isConnected, setIsConnected] = useState(socket.connected);

  useEffect(() => {
    function onConnect() { setIsConnected(true); }
    function onDisconnect() { setIsConnected(false); }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  // Matchmaking Listeners
  useEffect(() => {
    socket.on('match_found', ({ roomId, opponent, opponentAvatar }) => {
      setIsSearching(false);
      setShowMultiplayerMenu(false);
      setGameConfig(prev => ({ ...prev, mode: 'multiplayer', roomId, size: 3, opponentAvatar, opponentName: opponent }));
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
  const { board, handleClick, winner, winningLine, isXNext, resetGame, mySymbol, gameStatus, round, score, readyNextRound, requestRematch } = useTicTacToe(gameConfig, setGameConfig, sounds, user);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', userConfig.theme);
    localStorage.setItem('plaything_config', JSON.stringify(userConfig));
  }, [userConfig]);


  useEffect(() => {
    if (activeTab === 'shop') setView('SHOP');
    else if (activeTab === 'home') setView('HOME');
    else if (activeTab === 'leaderboard') setView('LEADERBOARD');
    else if (activeTab === 'battle') {
      // Force Battle Arena view, overriding any active game state
      setGameConfig(prev => ({ ...prev, mode: 'multiplayer', roomId: null }));
      setView('BATTLE');
    }
    else if (activeTab === 'profile') setView('PROFILE');
  }, [activeTab]);

  useEffect(() => {
    const isWin = winner === mySymbol;
    const isLoss = winner && winner !== 'Draw' && winner !== mySymbol;

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
  }, [winner, mySymbol, sounds]);

  useEffect(() => {
    if (gameConfig.mode === 'multiplayer' && gameStatus === 'complete') fetchUserData();
  }, [gameStatus, gameConfig.mode, fetchUserData]);

  // Modal Handlers
  const handleHostGame = (rounds, size) => {
    socket.emit('create_room', { config: { size, rounds } }, (result) => {
      if (result?.error) {
        alert(result.error);
        return;
      }
      setGameConfig({ ...gameConfig, mode: 'multiplayer', roomId: result.room.id, size, rounds });
      setShowHostModal(false);
      setShowGameCreatedModal(true);
    });
  };

  const handleStartGame = () => {
    // Redundant emit removed: useTicTacToe effect handles this when roomId is set
    setShowGameCreatedModal(false);
    setShowMultiplayerMenu(false);
    setView('GAME');
  };

  const handleJoinRoom = () => {
    const roomId = prompt("Enter Room ID:")?.trim().toUpperCase();
    if (!roomId) return;
    socket.emit('join_room', { roomId }, (result) => {
      if (result?.error) {
        alert(result.error);
        return;
      }
      setGameConfig({ ...gameConfig, mode: 'multiplayer', roomId: result.room.id, size: result.room.config.size, rounds: result.room.config.rounds });
      setShowMultiplayerMenu(false);
      setView('GAME');
    });
  };

  const handlePlayStranger = () => {
    setIsSearching(true);
    socket.emit('find_match');
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
      downloadAnchorNode.setAttribute("download", `plaything_data_${new Date().toISOString()}.json`);
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

  const equipAvatar = async (avatarId) => {
    try {
      await api.post('/api/me/equip-avatar', { avatarId });
      await fetchUserData();
      sounds.playClick();
    } catch { alert("Failed to equip"); }
  };


  return (
    <div className="app-container">
      {!isConnected && (
        <div className="connection-banner" style={{ background: '#ef4444', color: 'white', padding: '8px', textAlign: 'center', fontSize: '0.8rem', fontWeight: 'bold' }}>
          OFFLINE - Attempting to Reconnect...
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
      />

      <MultiplayerMenu
        show={showMultiaplyerMenu}
        onClose={() => setShowMultiplayerMenu(false)}
        onHost={() => setShowHostModal(true)}
        onJoin={handleJoinRoom}
        onPlayStranger={handlePlayStranger}
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
              <motion.div
                animate={{ y: [0, -10, 0] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              >
                <h1>Plaything</h1>
              </motion.div>
              <div className="button-group">
                <button
                  className="btn-primary human"
                  onClick={() => setShowMultiplayerMenu(true)}
                >
                  Play with Human
                </button>
                <button
                  className="btn-primary ai"
                  onClick={() => setView('AI_CONFIG')}
                >
                  Play with AI
                </button>
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
              <h2>Leaderboard</h2>
              <div className="leaderboard-list">
                {leaderboard.length > 0 ? leaderboard.map((u, i) => (
                  <div className="rank-item glass" key={i}>
                    <span className="rank-num">#{i + 1}</span>
                    <img src={u.avatar} className="rank-avatar" />
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
              <Swords size={64} className="mb-4 text-accent-pink" />
              <h2>Battle Arena</h2>

              <div className="button-group" style={{ width: '100%', marginTop: '20px' }}>
                <button className="btn-primary" style={{ background: 'var(--accent-purple)' }} onClick={() => setShowMultiplayerMenu(true)}>
                  Create / Join Room
                </button>
              </div>

              {gameConfig.mode === 'multiplayer' && gameConfig.roomId && !showGameCreatedModal && (
                <div style={{ marginTop: '20px', padding: '10px', background: 'var(--glass-bg)', borderRadius: '12px' }}>
                  <p>Room ID: <strong>{gameConfig.roomId}</strong></p>
                  <p>Share this code with your friend!</p>
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
                <div className="glass" style={{ padding: '1.5rem', marginBottom: '2rem', border: '1px solid var(--accent-pink)' }}>
                  <p style={{ marginBottom: '1rem' }}>You are playing as a <b>Guest</b>. Link your account to save progress permanently.</p>
                  <button className="btn-primary" style={{ background: '#4285F4' }} onClick={handleGoogleLogin}>
                    <img src="https://www.google.com/favicon.ico" style={{ width: 16, marginRight: 8 }} />
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

              <h3 style={{ marginTop: '2.5rem', textAlign: 'left', marginBottom: '1rem' }}>My Collection</h3>
              <div className="inventory-grid">
                {inventory.map(item => (
                  <div key={item.id} className={`inventory-card glass ${user.active_avatar_id === item.id ? 'active' : ''}`} onClick={() => equipAvatar(item.id)} style={{ cursor: 'pointer' }}>
                    <img src={item.url} />
                    <span className="rarity-tag" data-rarity={item.rarity}>{item.rarity}</span>
                  </div>
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
                  <button className="back-btn" onClick={() => setView('HOME')}>
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
                  <div className={`player-card ${isXNext === (mySymbol === 'O') ? 'active' : ''}`}>
                    <img src={(gameConfig.mode === 'multiplayer' && gameConfig.opponentAvatar) ? gameConfig.opponentAvatar : "https://api.dicebear.com/7.x/bottts/svg?seed=AI"} alt="Opponent" />
                    <p>{gameConfig.opponentName || 'AI'}</p>
                    <span className={`symbol char ${mySymbol === 'X' ? 'O' : 'X'}`}>{mySymbol === 'X' ? 'O' : 'X'}</span>
                  </div>
                </div>

                <div className="turn-indicator">
                  {winner ? (
                    <motion.span
                      initial={{ scale: 0.5 }}
                      animate={{ scale: 1.2 }}
                      className="winner-text"
                    >
                      {winner === 'Draw' ? "It's a Draw!" : `${winner === mySymbol ? 'You' : 'Opponent'} Won!`}
                    </motion.span>
                  ) : (
                    <span className="animate-pulse">{isXNext === (mySymbol === 'X') ? "> Your Turn" : "> Opponent Turn"}</span>
                  )}
                </div>
                {gameConfig.mode === 'multiplayer' && (
                  <div className="mode-badge glass">
                    Round {round}/{gameConfig.rounds || 3} · Score {score.X}-{score.O}
                  </div>
                )}
                {gameStatus === 'round_complete' && (
                  <button className="btn-primary" onClick={readyNextRound}>Ready for next round</button>
                )}
                {gameStatus === 'complete' && (
                  <button className="btn-primary" onClick={requestRematch}>Request rematch</button>
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
              style={{ paddingBottom: '100px' }}
            >
              <div className="shop-header glass" style={{ padding: '2rem', borderRadius: '24px', marginBottom: '3rem' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: '2.5rem' }}>Treasury</h2>
                  <p style={{ opacity: 0.7, margin: 0, fontSize: '1.1rem' }}>Secure Currency Exchange</p>
                </div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <button className="pill-btn active" style={{ background: 'var(--accent-teal)', color: 'black' }} onClick={() => setShowBuyGems(true)}>+ Buy Gems</button>
                </div>
              </div>

              <h3>Avatar Collection</h3>
              <div className="shop-grid">
                {shopItems.map(item => {
                  const isOwned = inventory.some(i => i.id === item.id);
                  return (
                    <div className="shop-card glass" key={item.id} onClick={() => !isOwned && setSelectedShopItem(item)}>
                      <img src={item.url} className="shop-item-img" />
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

      <BottomNav activeTab={activeTab} setActiveTab={setActiveTab} />
    </div >
  );
}
