const crypto = require('crypto');

const ALLOWED_SIZES = new Set([3, 4, 5]);
const ALLOWED_ROUNDS = new Set([1, 3, 5]);

class RoomManager {
  constructor({ onSeriesComplete = () => {}, now = () => Date.now() } = {}) {
    this.rooms = new Map();
    this.onSeriesComplete = onSeriesComplete;
    this.now = now;
  }

  createRoom(roomId, config = {}, options = {}) {
    const normalizedId = String(roomId || '').trim().toUpperCase();
    if (!/^[A-Z0-9_-]{4,32}$/.test(normalizedId)) return { error: 'Invalid room ID' };
    if (this.rooms.has(normalizedId)) return { error: 'Room already exists' };

    const size = Number(config.size || 3);
    const rounds = Number(config.rounds || 3);
    if (!ALLOWED_SIZES.has(size)) return { error: 'Unsupported board size' };
    if (!ALLOWED_ROUNDS.has(rounds)) return { error: 'Rounds must be 1, 3, or 5' };

    const room = {
      id: normalizedId,
      seriesId: crypto.randomUUID(),
      config: { size, rounds },
      players: [],
      spectators: [],
      createdAt: this.now(),
      updatedAt: this.now(),
      settled: false,
      rewardEligible: options.rewardEligible === true,
      nextRoundReady: new Set(),
      rematchReady: new Set(),
      roundHistory: [],
      state: this.freshState(size),
    };
    this.rooms.set(normalizedId, room);
    return { room: this.publicRoom(room) };
  }

  freshState(size, previous = {}) {
    return {
      board: Array(size * size).fill(null),
      isXNext: true,
      winner: null,
      winningLine: [],
      status: 'waiting',
      round: previous.round || 1,
      score: previous.score || { X: 0, O: 0 },
      seriesWinner: null,
    };
  }

  getRoom(roomId) {
    return this.rooms.get(String(roomId || '').trim().toUpperCase());
  }

  publicRoom(room) {
    if (!room) return null;
    return {
      id: room.id,
      seriesId: room.seriesId,
      rewardEligible: room.rewardEligible,
      config: { ...room.config },
      players: room.players.map(({ id, username, avatar, symbol, connected }) => ({ id, username, avatar, symbol, connected })),
      spectators: room.spectators.length,
      state: {
        ...room.state,
        board: [...room.state.board],
        winningLine: [...room.state.winningLine],
        score: { ...room.state.score },
      },
    };
  }

  joinRoom(roomId, player) {
    const room = this.getRoom(roomId);
    if (!room) return { error: 'Room not found' };
    if (!Number.isSafeInteger(player.userId)) return { error: 'Authentication required' };

    const reconnecting = room.players.find((entry) => entry.id === player.userId);
    if (reconnecting) {
      reconnecting.socketId = player.socketId;
      reconnecting.connected = true;
      delete reconnecting.disconnectedAt;
      reconnecting.username = player.username;
      reconnecting.avatar = player.avatar;
      room.updatedAt = this.now();
      if (room.players.length === 2 && room.state.status === 'paused') room.state.status = 'active';
      return { room: this.publicRoom(room), player: { ...reconnecting } };
    }
    if (room.players.length >= 2) return { error: 'Room full' };

    const joined = {
      id: player.userId,
      socketId: player.socketId,
      username: player.username,
      avatar: player.avatar,
      symbol: room.players.length === 0 ? 'X' : 'O',
      connected: true,
    };
    room.players.push(joined);
    room.updatedAt = this.now();
    if (room.players.length === 2) room.state.status = 'active';
    return { room: this.publicRoom(room), player: { ...joined } };
  }

  makeMove(roomId, index, userId, socketId) {
    const room = this.getRoom(roomId);
    if (!room) return { error: 'Room not found' };
    if (!Number.isSafeInteger(index) || index < 0 || index >= room.config.size * room.config.size) {
      return { error: 'Invalid move index' };
    }
    if (room.state.status !== 'active') return { error: 'Game is not active' };
    const player = room.players.find((entry) => entry.id === userId && entry.connected && entry.socketId === socketId);
    if (!player) return { error: 'Player is not in this room' };
    const expected = room.state.isXNext ? 'X' : 'O';
    if (player.symbol !== expected) return { error: 'Not your turn' };
    if (room.state.board[index] !== null) return { error: 'Cell is occupied' };

    room.state.board[index] = player.symbol;
    room.state.isXNext = !room.state.isXNext;
    room.updatedAt = this.now();

    const result = this.calculateWinner(room.state.board, room.config.size);
    if (!result) return { room: this.publicRoom(room) };

    room.state.winner = result.winner;
    room.state.winningLine = result.line;
    room.roundHistory.push({
      round: room.state.round,
      winner: result.winner,
      board: [...room.state.board],
    });
    if (result.winner === 'X' || result.winner === 'O') room.state.score[result.winner] += 1;

    const roundsPlayed = room.roundHistory.length;
    const winsNeeded = Math.floor(room.config.rounds / 2) + 1;
    const seriesOver = room.state.score.X >= winsNeeded
      || room.state.score.O >= winsNeeded
      || roundsPlayed >= room.config.rounds;

    if (seriesOver) {
      room.state.status = 'complete';
      room.state.seriesWinner = room.state.score.X === room.state.score.O
        ? 'Draw'
        : room.state.score.X > room.state.score.O ? 'X' : 'O';
      if (!room.settled) {
        this.onSeriesComplete(this.publicRoom(room), room.roundHistory.map((entry) => ({ ...entry, board: [...entry.board] })));
        room.settled = true;
      }
    } else {
      room.state.status = 'round_complete';
      room.nextRoundReady.clear();
    }
    return { room: this.publicRoom(room) };
  }

  readyForNextRound(roomId, userId, socketId) {
    const room = this.getRoom(roomId);
    if (!room) return { error: 'Room not found' };
    if (room.state.status !== 'round_complete') return { error: 'Round is not complete' };
    if (!room.players.some((player) => player.id === userId && player.connected && player.socketId === socketId)) return { error: 'Player is not in this room' };
    room.nextRoundReady.add(userId);
    if (room.nextRoundReady.size < 2) return { room: this.publicRoom(room), waiting: true };

    const nextRound = room.state.round + 1;
    const score = { ...room.state.score };
    room.state = this.freshState(room.config.size, { round: nextRound, score });
    room.state.status = room.players.every((player) => player.connected) ? 'active' : 'paused';
    room.nextRoundReady.clear();
    room.updatedAt = this.now();
    return { room: this.publicRoom(room), waiting: false };
  }

  requestRematch(roomId, userId, socketId) {
    const room = this.getRoom(roomId);
    if (!room) return { error: 'Room not found' };
    if (room.state.status !== 'complete') return { error: 'Series is not complete' };
    if (!room.players.some((player) => player.id === userId && player.connected && player.socketId === socketId)) return { error: 'Player is not in this room' };
    room.rematchReady.add(userId);
    if (room.rematchReady.size < 2) return { room: this.publicRoom(room), waiting: true };

    room.seriesId = crypto.randomUUID();
    room.roundHistory = [];
    room.settled = false;
    room.rematchReady.clear();
    room.state = this.freshState(room.config.size);
    room.state.status = room.players.every((player) => player.connected) ? 'active' : 'paused';
    room.updatedAt = this.now();
    return { room: this.publicRoom(room), waiting: false };
  }

  disconnect(socketId) {
    for (const room of this.rooms.values()) {
      const player = room.players.find((entry) => entry.socketId === socketId);
      if (!player) continue;
      player.connected = false;
      player.disconnectedAt = this.now();
      room.state.status = room.state.status === 'complete' ? 'complete' : 'paused';
      room.updatedAt = this.now();
      return { roomId: room.id, room: this.publicRoom(room) };
    }
    return null;
  }

  resolveDisconnectTimeouts(graceMs = 30_000) {
    const resolved = [];
    for (const room of this.rooms.values()) {
      if (room.state.status !== 'paused' || room.players.length !== 2 || room.settled) continue;
      const expired = room.players.filter((player) => !player.connected && this.now() - player.disconnectedAt >= graceMs);
      if (expired.length === 0) continue;
      const connected = room.players.filter((player) => player.connected);
      if (connected.length !== 1) {
        this.rooms.delete(room.id);
        continue;
      }

      const winner = connected[0];
      room.state.status = 'complete';
      room.state.winner = winner.symbol;
      room.state.seriesWinner = winner.symbol;
      room.state.score[winner.symbol] += 1;
      room.roundHistory.push({
        round: room.state.round,
        winner: winner.symbol,
        board: [...room.state.board],
        reason: 'disconnect_forfeit',
      });
      this.onSeriesComplete(this.publicRoom(room), room.roundHistory.map((entry) => ({ ...entry, board: [...entry.board] })));
      room.settled = true;
      room.updatedAt = this.now();
      resolved.push({ roomId: room.id, room: this.publicRoom(room) });
    }
    return resolved;
  }

  removeExpired(maxIdleMs = 30 * 60 * 1000) {
    const cutoff = this.now() - maxIdleMs;
    for (const [roomId, room] of this.rooms.entries()) {
      if (room.updatedAt < cutoff) this.rooms.delete(roomId);
    }
  }

  calculateWinner(squares, size) {
    const lines = [];
    for (let row = 0; row < size; row += 1) lines.push(Array.from({ length: size }, (_, col) => row * size + col));
    for (let col = 0; col < size; col += 1) lines.push(Array.from({ length: size }, (_, row) => col + row * size));
    lines.push(Array.from({ length: size }, (_, i) => i * size + i));
    lines.push(Array.from({ length: size }, (_, i) => i * size + (size - 1 - i)));

    for (const line of lines) {
      const first = squares[line[0]];
      if (first && line.every((position) => squares[position] === first)) return { winner: first, line };
    }
    if (squares.every((cell) => cell !== null)) return { winner: 'Draw', line: [] };
    return null;
  }
}

module.exports = { RoomManager };
