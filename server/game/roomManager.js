const crypto = require('crypto');

const ALLOWED_SIZES = new Set([3, 4, 5]);
const ALLOWED_ROUNDS = new Set([1, 3, 5]);
const DISCONNECT_GRACE_MS = 30_000;
const NONTERMINAL_STATUSES = new Set(['waiting', 'active', 'paused', 'round_complete']);

const ERROR_MESSAGES = Object.freeze({
  ROOM_NOT_FOUND: 'Room not found',
  ACTIVE_ROOM_EXISTS: 'You already have an active room',
  NOT_ROOM_MEMBER: 'Player is not in this room',
});

function failure(code, details = {}) {
  return { error: ERROR_MESSAGES[code] || 'The game action could not be completed', code, ...details };
}

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
      resumeStatus: null,
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
      disconnectDeadline: null,
      completionReason: null,
    };
  }

  getRoom(roomId) {
    return this.rooms.get(String(roomId || '').trim().toUpperCase());
  }

  deleteRoom(roomId) {
    return this.rooms.delete(String(roomId || '').trim().toUpperCase());
  }

  findActiveRoomForUser(userId, { excludingRoomId } = {}) {
    const excluded = String(excludingRoomId || '').trim().toUpperCase();
    for (const room of this.rooms.values()) {
      if (room.id === excluded || !NONTERMINAL_STATUSES.has(room.state.status)) continue;
      if (room.players.some((player) => player.id === userId)) return room;
    }
    return null;
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

  captureMutableRoom(room) {
    return {
      players: room.players.map((player) => ({ ...player })),
      state: {
        ...room.state,
        board: [...room.state.board],
        winningLine: [...room.state.winningLine],
        score: { ...room.state.score },
      },
      roundHistory: room.roundHistory.map((entry) => ({ ...entry, board: [...entry.board] })),
      nextRoundReady: new Set(room.nextRoundReady),
      rematchReady: new Set(room.rematchReady),
      resumeStatus: room.resumeStatus,
      settled: room.settled,
      updatedAt: room.updatedAt,
    };
  }

  restoreMutableRoom(room, snapshot) {
    room.players = snapshot.players;
    room.state = snapshot.state;
    room.roundHistory = snapshot.roundHistory;
    room.nextRoundReady = snapshot.nextRoundReady;
    room.rematchReady = snapshot.rematchReady;
    room.resumeStatus = snapshot.resumeStatus;
    room.settled = snapshot.settled;
    room.updatedAt = snapshot.updatedAt;
  }

  syncConnectionState(room, { secondPlayerJoined = false } = {}) {
    if (room.state.status === 'complete' || room.state.status === 'cancelled') {
      room.state.disconnectDeadline = null;
      room.resumeStatus = null;
      return;
    }

    if (room.players.length < 2) {
      room.state.status = 'waiting';
      room.state.disconnectDeadline = null;
      room.resumeStatus = null;
      return;
    }

    const disconnected = room.players.filter((player) => !player.connected);
    if (disconnected.length === 0) {
      const restored = room.resumeStatus || (room.state.status === 'paused' ? 'active' : room.state.status);
      room.state.status = restored === 'waiting' ? 'active' : restored;
      room.state.disconnectDeadline = null;
      room.resumeStatus = null;
      return;
    }

    if (room.state.status !== 'paused') {
      room.resumeStatus = secondPlayerJoined && room.state.status === 'waiting'
        ? 'active'
        : room.state.status;
    }
    room.state.status = 'paused';
    room.state.disconnectDeadline = Math.min(...disconnected.map((player) => player.disconnectedAt + DISCONNECT_GRACE_MS));
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
      this.syncConnectionState(room);
      return { room: this.publicRoom(room), player: { ...reconnecting } };
    }
    const activeRoom = this.findActiveRoomForUser(player.userId, { excludingRoomId: room.id });
    if (activeRoom) return failure('ACTIVE_ROOM_EXISTS', { roomId: activeRoom.id });
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
    this.syncConnectionState(room, { secondPlayerJoined: room.players.length === 2 });
    return { room: this.publicRoom(room), player: { ...joined } };
  }

  resumeRoom(roomId, player) {
    const room = this.getRoom(roomId);
    if (!room) return { error: 'Room not found' };
    if (!room.players.some((entry) => entry.id === player.userId)) return { error: 'No active room to resume' };
    return this.joinRoom(room.id, player);
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

    const rollbackSnapshot = this.captureMutableRoom(room);
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
        try {
          this.onSeriesComplete(this.publicRoom(room), room.roundHistory.map((entry) => ({ ...entry, board: [...entry.board] })));
          room.settled = true;
        } catch (error) {
          this.restoreMutableRoom(room, rollbackSnapshot);
          throw error;
        }
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
    if (!room.players.some((player) => player.id === userId && player.connected && player.socketId === socketId)) return failure('NOT_ROOM_MEMBER');
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
    if (!room.players.some((player) => player.id === userId && player.connected && player.socketId === socketId)) return failure('NOT_ROOM_MEMBER');
    for (const player of room.players) {
      const activeRoom = this.findActiveRoomForUser(player.id, { excludingRoomId: room.id });
      if (activeRoom) return failure('ACTIVE_ROOM_EXISTS', { roomId: activeRoom.id });
    }
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

  settleForfeit(room, winner, reason, rollbackSnapshot = this.captureMutableRoom(room)) {
    try {
      const completedRound = room.state.status === 'round_complete'
        || (room.state.status === 'paused' && room.resumeStatus === 'round_complete');
      room.state.status = 'complete';
      room.state.winner = winner.symbol;
      room.state.seriesWinner = winner.symbol;
      room.state.completionReason = reason;
      room.state.disconnectDeadline = null;
      room.resumeStatus = null;
      room.state.score[winner.symbol] += 1;
      room.nextRoundReady.clear();
      room.rematchReady.clear();
      if (completedRound && room.roundHistory.length > 0) {
        Object.assign(room.roundHistory.at(-1), { reason, seriesWinner: winner.symbol });
      } else {
        room.roundHistory.push({
          round: room.state.round,
          winner: winner.symbol,
          board: [...room.state.board],
          reason,
        });
      }
      if (!room.settled) {
        this.onSeriesComplete(this.publicRoom(room), room.roundHistory.map((entry) => ({ ...entry, board: [...entry.board] })));
        room.settled = true;
      }
      room.updatedAt = this.now();
      return this.publicRoom(room);
    } catch (error) {
      this.restoreMutableRoom(room, rollbackSnapshot);
      throw error;
    }
  }

  leaveRoom(roomId, userId, socketId) {
    const room = this.getRoom(roomId);
    if (!room) return failure('ROOM_NOT_FOUND');
    const player = room.players.find((entry) => entry.id === userId && entry.connected && entry.socketId === socketId);
    if (!player) return failure('NOT_ROOM_MEMBER');

    if (room.state.status === 'complete' || room.state.status === 'cancelled') {
      player.connected = false;
      player.disconnectedAt = this.now();
      room.updatedAt = this.now();
      return { room: this.publicRoom(room), acknowledged: true };
    }

    if (room.state.status === 'waiting' && room.players.length === 1) {
      this.rooms.delete(room.id);
      return { roomId: room.id, deleted: true };
    }

    const opponent = room.players.find((entry) => entry.id !== userId);
    if (!opponent) return failure('NOT_ROOM_MEMBER');
    const rollbackSnapshot = this.captureMutableRoom(room);
    player.connected = false;
    player.disconnectedAt = this.now();
    return { room: this.settleForfeit(room, opponent, 'voluntary_forfeit', rollbackSnapshot) };
  }

  disconnectAll(socketId) {
    const results = [];
    for (const room of this.rooms.values()) {
      const player = room.players.find((entry) => entry.socketId === socketId);
      if (!player || !player.connected) continue;
      player.connected = false;
      player.disconnectedAt = this.now();
      this.syncConnectionState(room);
      room.updatedAt = this.now();
      results.push({ roomId: room.id, room: this.publicRoom(room) });
    }
    return results;
  }

  disconnect(socketId) {
    return this.disconnectAll(socketId)[0] || null;
  }

  resolveDisconnectTimeouts(graceMs = 30_000) {
    const resolved = [];
    for (const room of this.rooms.values()) {
      if (room.state.status !== 'paused' || room.players.length !== 2 || room.settled) continue;
      const expired = room.players.filter((player) => !player.connected && this.now() - player.disconnectedAt >= graceMs);
      if (expired.length === 0) continue;
      const connected = room.players.filter((player) => player.connected);
      if (connected.length === 0) {
        if (expired.length !== room.players.length) continue;
        room.state.status = 'cancelled';
        room.state.completionReason = 'match_cancelled';
        room.state.disconnectDeadline = null;
        room.resumeStatus = null;
        room.updatedAt = this.now();
        resolved.push({ roomId: room.id, room: this.publicRoom(room) });
        continue;
      }

      const winner = connected[0];
      resolved.push({ roomId: room.id, room: this.settleForfeit(room, winner, 'disconnect_forfeit') });
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
