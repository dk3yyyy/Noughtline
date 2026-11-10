import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSocket } from './services/client';
import { saveActiveRoom } from './services/rooms';
import { httpErrorMessage } from './services/errors';

const socket = getSocket();

export default function useTicTacToe(gameConfig, setGameConfig, sounds, user) {
  const { size: boardSize, mode, roomId, difficulty, roomSnapshot } = gameConfig;
  const [board, setBoard] = useState(Array(boardSize * boardSize).fill(null));
  const [isXNext, setIsXNext] = useState(true);
  const [winner, setWinner] = useState(null);
  const [seriesWinner, setSeriesWinner] = useState(null);
  const [winningLine, setWinningLine] = useState([]);
  const [isActionPending, setIsActionPending] = useState(false);
  const [mySymbol, setMySymbol] = useState('X');
  const [gameStatus, setGameStatus] = useState('waiting');
  const [round, setRound] = useState(1);
  const [score, setScore] = useState({ X: 0, O: 0 });
  const [roomPlayers, setRoomPlayers] = useState([]);
  const [disconnectDeadline, setDisconnectDeadline] = useState(null);
  const [completionReason, setCompletionReason] = useState(null);
  const [actionError, setActionError] = useState('');
  const aiTimerRef = useRef(null);
  const moveLockRef = useRef(false);

  const clearAiTimer = useCallback(() => {
    if (aiTimerRef.current !== null) {
      window.clearTimeout(aiTimerRef.current);
      aiTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearAiTimer(), [clearAiTimer]);

  useEffect(() => {
    clearAiTimer();
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
        setActionError(typeof error === 'string' ? error : httpErrorMessage(error, 'The game action could not be completed.'));
      };

      socket.on('room_update', handleRoomUpdate);
      socket.on('game_error', handleGameError);
      if (roomSnapshot?.id === roomId) handleRoomUpdate(roomSnapshot);

      return () => {
        socket.off('room_update', handleRoomUpdate);
        socket.off('game_error', handleGameError);
      };
    }
    return undefined;
  }, [boardSize, mode, roomId, roomSnapshot, setGameConfig, user.id, user.username, clearAiTimer]);

  // Every line of `boardSize` cells: rows, columns and both diagonals.
  const boardLines = useMemo(() => {
    const lines = [];
    for (let i = 0; i < boardSize; i++) {
      const row = [];
      for (let j = 0; j < boardSize; j++) row.push(i * boardSize + j);
      lines.push(row);
    }
    for (let i = 0; i < boardSize; i++) {
      const col = [];
      for (let j = 0; j < boardSize; j++) col.push(i + j * boardSize);
      lines.push(col);
    }
    const diagonalA = [];
    const diagonalB = [];
    for (let i = 0; i < boardSize; i++) {
      diagonalA.push(i * boardSize + i);
      diagonalB.push(i * boardSize + (boardSize - 1 - i));
    }
    lines.push(diagonalA, diagonalB);
    return lines;
  }, [boardSize]);

  const calculateWinner = useCallback((squares) => {
    for (const line of boardLines) {
      const first = squares[line[0]];
      if (first && line.every(index => squares[index] === first)) {
        return { winner: first, line };
      }
    }
    if (squares.every(square => square !== null)) return { winner: 'Draw', line: [] };
    return null;
  }, [boardLines]);

  // A line that is one move from completion: win with it, or block it.
  const findLineThreat = useCallback((squares, symbol) => {
    for (const line of boardLines) {
      const marks = line.map((index) => squares[index]);
      const own = marks.filter((mark) => mark === symbol).length;
      const empty = marks.filter((mark) => mark === null).length;
      if (own === boardSize - 1 && empty === 1) {
        return line[marks.indexOf(null)];
      }
    }
    return null;
  }, [boardLines, boardSize]);

  const openingPreference = (squares) => {
    const center = Math.floor(squares.length / 2);
    if (squares[center] === null) return center;
    const corners = [0, boardSize - 1, squares.length - boardSize, squares.length - 1];
    for (const corner of corners) {
      if (squares[corner] === null) return corner;
    }
    return null;
  };

  // Plain recursion (not a hook): it closes over the current board size and
  // winner check and is only called from the AI's turn.
  function minimax(squares, depth, isMaximizing, alpha, beta) {
    const result = calculateWinner(squares);
    if (result?.winner === 'O') return 10 - depth;
    if (result?.winner === 'X') return depth - 10;
    if (result?.winner === 'Draw') return 0;
    if (depth > 3 && boardSize > 3) return 0;

    if (isMaximizing) {
      let bestScore = -Infinity;
      for (let i = 0; i < squares.length; i++) {
        if (!squares[i]) {
          squares[i] = 'O';
          const score = minimax(squares, depth + 1, false, alpha, beta);
          squares[i] = null;
          bestScore = Math.max(score, bestScore);
          alpha = Math.max(alpha, bestScore);
          if (beta <= alpha) break;
        }
      }
      return bestScore;
    }
    let bestScore = Infinity;
    for (let i = 0; i < squares.length; i++) {
      if (!squares[i]) {
        squares[i] = 'X';
        const score = minimax(squares, depth + 1, true, alpha, beta);
        squares[i] = null;
        bestScore = Math.min(score, bestScore);
        beta = Math.min(beta, bestScore);
        if (beta <= alpha) break;
      }
    }
    return bestScore;
  }

  const findBestMove = (squares) => {
    // Tactics first at every board size: complete a line, or block one.
    const winning = findLineThreat(squares, 'O');
    if (winning !== null) return winning;
    const blocking = findLineThreat(squares, 'X');
    if (blocking !== null) return blocking;

    let bestScore = -Infinity;
    let move;

    if (squares.filter(x => x).length === 1 && squares[Math.floor(squares.length / 2)] === null) {
      return Math.floor(squares.length / 2);
    }
    // On 4x4 and 5x5 a full search is too deep for a browser move. Keep the
    // tactical layer above and use a sound positional preference instead of
    // the random move the old cutoff produced.
    if (boardSize > 3 && squares.filter(s => s === null).length > 8) {
      const preferred = openingPreference(squares);
      if (preferred !== null) return preferred;
      const empty = squares.map((s, i) => (s === null ? i : null)).filter(i => i !== null);
      return empty[Math.floor(Math.random() * empty.length)];
    }
    for (let i = 0; i < squares.length; i++) {
      if (!squares[i]) {
        squares[i] = 'O';
        const score = minimax(squares, 0, false, -Infinity, Infinity);
        squares[i] = null;
        if (score > bestScore) {
          bestScore = score;
          move = i;
        }
      }
    }
    return move;
  };

  const makeAIMove = (currentBoard) => {
    const emptyIndices = currentBoard.map((s, i) => (s === null ? i : null)).filter(i => i !== null);
    if (emptyIndices.length === 0) return;

    let move;
    if (difficulty === 'easy') {
      move = emptyIndices[Math.floor(Math.random() * emptyIndices.length)];
    } else if (difficulty === 'medium') {
      move = Math.random() > 0.6
        ? findBestMove(currentBoard)
        : emptyIndices[Math.floor(Math.random() * emptyIndices.length)];
    } else if (difficulty === 'hard') {
      move = Math.random() > 0.25
        ? findBestMove(currentBoard)
        : emptyIndices[Math.floor(Math.random() * emptyIndices.length)];
    } else {
      move = findBestMove(currentBoard);
    }
    if (move === undefined || move === null) move = emptyIndices[0];

    const nextBoard = [...currentBoard];
    nextBoard[move] = 'O';
    setBoard(nextBoard);
    setIsXNext(true);
    sounds.playClick();

    const result = calculateWinner(nextBoard);
    if (result) {
      setWinner(result.winner);
      setWinningLine(result.line);
    }
  };

  const handleClick = (index) => {
    if (moveLockRef.current) return;
    if (winner || board[index] || isActionPending || gameStatus !== 'active') return;

    moveLockRef.current = true;
    window.setTimeout(() => { moveLockRef.current = false; }, mode === 'multiplayer' ? 800 : 0);

    if (mode === 'multiplayer') {
      if (isXNext !== (mySymbol === 'X')) return;
      setIsActionPending(true);
      socket.emit('make_move', { roomId, index });
      sounds.playClick();
      return;
    }

    if (!isXNext) return;

    const nextBoard = [...board];
    nextBoard[index] = 'X';
    setBoard(nextBoard);
    setIsXNext(false);
    sounds.playClick();

    const result = calculateWinner(nextBoard);
    if (result) {
      setWinner(result.winner);
      setWinningLine(result.line);
    } else {
      clearAiTimer();
      aiTimerRef.current = window.setTimeout(() => {
        aiTimerRef.current = null;
        makeAIMove(nextBoard);
      }, 500);
    }
  };

  const resetGame = useCallback(() => {
    if (mode === 'multiplayer') return;
    clearAiTimer();
    setBoard(Array(boardSize * boardSize).fill(null));
    setIsXNext(true);
    setWinner(null);
    setSeriesWinner(null);
    setWinningLine([]);
    setGameStatus('active');
  }, [boardSize, mode, clearAiTimer]);

  const readyNextRound = () => socket.emit('ready_next_round', { roomId });
  const requestRematch = () => socket.emit('request_rematch', { roomId });

  return {
    board, handleClick, winner, seriesWinner, winningLine, isXNext, resetGame, mySymbol,
    gameStatus, round, score, readyNextRound, requestRematch, roomPlayers,
    disconnectDeadline, completionReason, actionError,
  };
}
