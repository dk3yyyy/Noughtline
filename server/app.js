const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { Server } = require('socket.io');
const { createDatabase, createGuest, publicUser } = require('./database');
const { createAuth } = require('./auth');
const { createEconomy, GEM_PACKAGES } = require('./economy');
const { RoomManager } = require('./game/roomManager');
const { Matchmaker } = require('./game/matchmaker');
const { ActionRateLimiter } = require('./game/actionRateLimiter');

const ERROR_CODE_BY_MESSAGE = Object.freeze({
  'Invalid room ID': 'INVALID_ROOM_ID',
  'Room already exists': 'ROOM_EXISTS',
  'Room not found': 'ROOM_NOT_FOUND',
  'Room full': 'ROOM_FULL',
  'Authentication required': 'AUTH_REQUIRED',
  'No active room to resume': 'NOT_ROOM_MEMBER',
  'Player is not in this room': 'NOT_ROOM_MEMBER',
  'Game is not active': 'GAME_NOT_ACTIVE',
  'Invalid move index': 'INVALID_MOVE',
  'Not your turn': 'NOT_YOUR_TURN',
  'Cell is occupied': 'CELL_OCCUPIED',
});

function gameErrorPayload(result) {
  return {
    error: result.error,
    code: result.code || ERROR_CODE_BY_MESSAGE[result.error] || 'ACTION_FAILED',
    ...(result.roomId ? { roomId: result.roomId } : {}),
    ...(Number.isSafeInteger(result.retryAfterMs) ? { retryAfterMs: result.retryAfterMs } : {}),
  };
}

function randomRoomId(prefix = '') {
  return `${prefix}${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function createRuntime({ config, database, fetchImpl, startTimers = true } = {}) {
  if (!config) throw new Error('config is required');
  const db = database || createDatabase(config.databasePath);
  const auth = createAuth({ db, config });
  const economy = createEconomy({ db, config, fetchImpl });

  const settleSeries = (room, roundHistory) => db.transaction(() => {
    const playerX = room.players.find((player) => player.symbol === 'X');
    const playerO = room.players.find((player) => player.symbol === 'O');
    const winner = room.state.seriesWinner === 'Draw'
      ? null
      : room.players.find((player) => player.symbol === room.state.seriesWinner);
    const completionReason = roundHistory.at(-1)?.reason || 'played';

    db.prepare(`
      INSERT INTO series_results
        (id, room_id, player_x_id, player_o_id, winner_id, result, score_x, score_o, rounds_played, board_size, round_history)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      room.seriesId,
      room.id,
      playerX?.id || null,
      playerO?.id || null,
      winner?.id || null,
      room.state.seriesWinner,
      room.state.score.X,
      room.state.score.O,
      roundHistory.length,
      room.config.size,
      JSON.stringify(roundHistory),
    );

    if (!room.rewardEligible) return;

    for (const player of room.players) {
      const isDraw = room.state.seriesWinner === 'Draw';
      const didWin = winner?.id === player.id;
      const forfeited = ['disconnect_forfeit', 'voluntary_forfeit'].includes(completionReason) && !didWin;
      const xp = forfeited ? 0 : isDraw ? 25 : didWin ? 50 : 15;
      const coins = forfeited ? 0 : isDraw ? 5 : didWin ? 10 : 3;
      if (isDraw) {
        db.prepare('UPDATE users SET draws = draws + 1, xp = xp + ? WHERE id = ?').run(xp, player.id);
      } else if (didWin) {
        db.prepare('UPDATE users SET wins = wins + 1, streak = streak + 1, xp = xp + ? WHERE id = ?').run(xp, player.id);
      } else {
        db.prepare('UPDATE users SET losses = losses + 1, streak = 0, xp = xp + ? WHERE id = ?').run(xp, player.id);
      }
      db.prepare('UPDATE users SET level = CAST(xp / 250 AS INTEGER) + 1 WHERE id = ?').run(player.id);
      if (coins > 0) {
        economy.changeBalance({
          userId: player.id,
          currency: 'coins',
          amount: coins,
          reason: 'multiplayer_series_reward',
          reference: `series:${room.seriesId}`,
          metadata: { result: room.state.seriesWinner, xp, completionReason },
        });
      }
    }
  })();

  const roomManager = new RoomManager({ onSeriesComplete: settleSeries });
  const matchmaker = new Matchmaker();
  const roomActionLimiter = new ActionRateLimiter({
    limit: config.roomActionRateLimit,
    windowMs: config.roomActionRateWindowMs,
  });
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: config.corsOrigins, methods: ['GET', 'POST'] },
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 10000,
    pingTimeout: 15000,
  });

  app.disable('x-powered-by');
  app.use(helmet({
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: { directives: { imgSrc: ["'self'", 'data:', 'https:'] } },
  }));
  app.use(cors({ origin: config.corsOrigins }));

  // Paystack signs the exact raw request bytes.
  app.post('/api/payments/paystack/webhook', express.raw({ type: 'application/json', limit: '128kb' }), async (req, res) => {
    if (!config.paystackSecretKey) return res.status(503).json({ error: 'Payments are not configured' });
    const signature = req.headers['x-paystack-signature'];
    const expected = crypto.createHmac('sha512', config.paystackSecretKey).update(req.body).digest('hex');
    const validSignature = typeof signature === 'string'
      && signature.length === expected.length
      && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    if (!validSignature) return res.status(401).json({ error: 'Invalid webhook signature' });
    const event = JSON.parse(req.body.toString('utf8'));
    if (event.event === 'charge.success' && event.data?.reference) {
      try {
        await economy.verifyAndCreditPayment(event.data.reference);
      } catch (error) {
        return res.status(error.status || 500).json({ error: error.message });
      }
    }
    return res.json({ received: true });
  });

  app.use(express.json({ limit: '64kb' }));
  app.use(rateLimit({ windowMs: 60_000, limit: config.nodeEnv === 'test' ? 10000 : 120, standardHeaders: 'draft-8', legacyHeaders: false }));

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  app.post('/api/auth/guest', (req, res) => {
    const user = createGuest(db);
    res.status(201).json({ token: auth.signUser(user), user: publicUser(user) });
  });

  app.get('/api/me', auth.requireAuth, (req, res) => res.json(publicUser(req.user)));
  app.get('/api/me/inventory', auth.requireAuth, (req, res) => {
    const items = db.prepare(`
      SELECT a.* FROM avatars a
      JOIN user_avatars ua ON ua.avatar_id = a.id
      WHERE ua.user_id = ? ORDER BY ua.purchased_at
    `).all(req.user.id);
    res.json(items);
  });
  app.get('/api/me/ledger', auth.requireAuth, (req, res) => {
    res.json(db.prepare('SELECT id, currency, amount, balance_after, reason, reference, created_at FROM currency_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').all(req.user.id));
  });
  app.get('/api/me/matches', auth.requireAuth, (req, res) => {
    res.json(db.prepare('SELECT * FROM series_results WHERE player_x_id = ? OR player_o_id = ? ORDER BY completed_at DESC LIMIT 50').all(req.user.id, req.user.id));
  });
  app.get('/api/me/export', auth.requireAuth, (req, res) => {
    const inventory = db.prepare('SELECT avatar_id, purchased_at FROM user_avatars WHERE user_id = ?').all(req.user.id);
    const ledger = db.prepare('SELECT * FROM currency_ledger WHERE user_id = ?').all(req.user.id);
    const matches = db.prepare('SELECT * FROM series_results WHERE player_x_id = ? OR player_o_id = ?').all(req.user.id, req.user.id);
    res.json({ profile: publicUser(req.user), inventory, ledger, matches, exportedAt: new Date().toISOString() });
  });
  app.delete('/api/me', auth.requireAuth, (req, res) => {
    db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
    res.json({ success: true });
  });
  app.post('/api/me/equip-avatar', auth.requireAuth, (req, res) => {
    const avatarId = Number(req.body.avatarId);
    if (!Number.isSafeInteger(avatarId) || avatarId <= 0) return res.status(400).json({ error: 'Invalid avatar' });
    const owned = db.prepare('SELECT 1 FROM user_avatars WHERE user_id = ? AND avatar_id = ?').get(req.user.id, avatarId);
    if (!owned) return res.status(403).json({ error: 'Avatar not owned' });
    const avatar = db.prepare('SELECT url FROM avatars WHERE id = ?').get(avatarId);
    db.prepare('UPDATE users SET active_avatar_id = ?, avatar = ? WHERE id = ?').run(avatarId, avatar.url, req.user.id);
    res.json({ success: true, avatarId, avatarUrl: avatar.url });
  });

  app.get('/api/shop/items', (_req, res) => res.json(db.prepare('SELECT * FROM avatars ORDER BY id').all()));
  app.post('/api/shop/purchase', auth.requireAuth, (req, res) => {
    try {
      const result = economy.buyAvatar(req.user.id, Number(req.body.avatarId));
      res.status(201).json(result);
    } catch (error) {
      const status = /not found/i.test(error.message) ? 404 : /already|insufficient/i.test(error.message) ? 409 : 400;
      res.status(status).json({ error: error.message });
    }
  });

  app.get('/api/economy/gem-packages', (_req, res) => res.json(GEM_PACKAGES));
  app.post('/api/economy/payments', auth.requireAuth, async (req, res, next) => {
    try {
      res.status(201).json(await economy.initializePayment(req.user, req.body.packageId));
    } catch (error) { next(error); }
  });
  app.post('/api/economy/payments/:reference/verify', auth.requireAuth, async (req, res, next) => {
    try {
      const intent = db.prepare('SELECT user_id FROM payment_intents WHERE reference = ?').get(req.params.reference);
      if (!intent || intent.user_id !== req.user.id) return res.status(404).json({ error: 'Payment not found' });
      return res.json(await economy.verifyAndCreditPayment(req.params.reference));
    } catch (error) { return next(error); }
  });

  app.get('/api/leaderboard', (_req, res) => {
    res.json(db.prepare("SELECT username, avatar, xp, level, wins FROM users WHERE username != 'AI_Bot' ORDER BY xp DESC, wins DESC LIMIT 50").all());
  });

  const spaIndex = config.staticDir && path.join(config.staticDir, 'index.html');
  if (spaIndex && fs.existsSync(spaIndex)) {
    app.use(express.static(config.staticDir, { index: false, maxAge: config.nodeEnv === 'production' ? '1h' : 0 }));
    app.get(/^(?!\/api(?:\/|$)|\/socket\.io(?:\/|$)).*/, (_req, res) => res.sendFile(spaIndex));
  }

  app.use((error, _req, res, _next) => {
    if (config.nodeEnv !== 'test') console.error(error);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Internal server error' });
  });

  io.use(auth.authenticateSocket);
  io.on('connection', (socket) => {
    const socketPlayer = () => ({
      userId: socket.user.id,
      socketId: socket.id,
      username: socket.user.username,
      avatar: socket.user.avatar,
    });
    const emitFailure = (result, callback) => {
      const payload = gameErrorPayload(result);
      socket.emit('game_error', payload);
      callback?.(payload);
      return payload;
    };
    const emitResult = (result, callback) => {
      if (result.error) return emitFailure(result, callback);
      io.to(result.room.id).emit('room_update', result.room);
      callback?.({ room: result.room });
      return result;
    };
    const guardRoomAction = (callback) => {
      const limit = roomActionLimiter.consume(`user:${socket.user.id}`);
      if (limit.allowed) return true;
      emitFailure({
        error: 'Too many room actions. Try again shortly.',
        code: 'RATE_LIMITED',
        retryAfterMs: limit.retryAfterMs,
      }, callback);
      return false;
    };
    const runGameAction = (action, callback) => {
      try {
        emitResult(action(), callback);
      } catch (error) {
        console.error(error);
        emitFailure({ error: 'The game action could not be completed', code: 'ACTION_FAILED' }, callback);
      }
    };

    socket.on('create_room', ({ roomId, config: roomConfig } = {}, callback) => {
      if (!guardRoomAction(callback)) return;
      const activeRoom = roomManager.findActiveRoomForUser(socket.user.id);
      if (activeRoom) return emitFailure({
        error: 'You already have an active room',
        code: 'ACTIVE_ROOM_EXISTS',
        roomId: activeRoom.id,
      }, callback);
      matchmaker.removeUser(socket.user.id);
      const id = roomId || randomRoomId('ROOM_');
      const created = roomManager.createRoom(id, roomConfig);
      if (created.error) return emitFailure(created, callback);
      const joined = roomManager.joinRoom(id, socketPlayer());
      if (joined.error) {
        roomManager.deleteRoom(id);
        return emitFailure(joined, callback);
      }
      socket.join(id);
      io.to(id).emit('room_update', joined.room);
      return callback?.({ room: joined.room });
    });

    socket.on('join_room', ({ roomId } = {}, callback) => {
      if (!guardRoomAction(callback)) return;
      matchmaker.removeUser(socket.user.id);
      const result = roomManager.joinRoom(roomId, socketPlayer());
      if (result.error) return emitFailure(result, callback);
      socket.join(result.room.id);
      io.to(result.room.id).emit('room_update', result.room);
      return callback?.({ room: result.room });
    });

    socket.on('resume_room', ({ roomId } = {}, callback) => {
      if (!guardRoomAction(callback)) return;
      matchmaker.removeUser(socket.user.id);
      const result = roomManager.resumeRoom(roomId, socketPlayer());
      if (result.error) return emitFailure(result, callback);
      socket.join(result.room.id);
      io.to(result.room.id).emit('room_update', result.room);
      return callback?.({ room: result.room });
    });

    socket.on('leave_room', ({ roomId } = {}, callback) => {
      matchmaker.removeUser(socket.user.id);
      const result = roomManager.leaveRoom(roomId, socket.user.id, socket.id);
      if (result.error) return emitFailure(result, callback);
      socket.leave(String(roomId || '').trim().toUpperCase());
      if (result.room) io.to(result.room.id).emit('room_update', result.room);
      return callback?.(result);
    });

    socket.on('make_move', ({ roomId, index } = {}, callback) => runGameAction(() => roomManager.makeMove(roomId, index, socket.user.id, socket.id), callback));
    socket.on('ready_next_round', ({ roomId } = {}, callback) => runGameAction(() => roomManager.readyForNextRound(roomId, socket.user.id, socket.id), callback));
    socket.on('request_rematch', ({ roomId } = {}, callback) => runGameAction(() => roomManager.requestRematch(roomId, socket.user.id, socket.id), callback));

    socket.on('find_match', (_payload, callback) => {
      if (!guardRoomAction(callback)) return;
      const activeRoom = roomManager.findActiveRoomForUser(socket.user.id);
      if (activeRoom) return emitFailure({
        error: 'You already have an active room',
        code: 'ACTIVE_ROOM_EXISTS',
        roomId: activeRoom.id,
      }, callback);
      const queued = matchmaker.addToQueue(socketPlayer());
      if (!queued) return emitFailure({ error: 'You are already searching for a match', code: 'ALREADY_MATCHMAKING' }, callback);
      return callback?.({ queued: true });
    });
    socket.on('cancel_matchmaking', (_payload, callback) => {
      matchmaker.removeUser(socket.user.id);
      callback?.({ cancelled: true });
    });

    socket.on('disconnect', () => {
      matchmaker.removeFromQueue(socket.id);
      for (const result of roomManager.disconnectAll(socket.id)) {
        io.to(result.roomId).emit('room_update', result.room);
      }
    });
  });

  const timers = [];
  if (startTimers) {
    timers.push(setInterval(() => {
      const match = matchmaker.findMatch();
      if (match) {
        const roomId = randomRoomId('MATCH_');
        roomManager.createRoom(roomId, { size: 3, rounds: 3 }, { rewardEligible: true });
        const first = roomManager.joinRoom(roomId, match.player1);
        const second = roomManager.joinRoom(roomId, match.player2);
        io.sockets.sockets.get(match.player1.socketId)?.join(roomId);
        io.sockets.sockets.get(match.player2.socketId)?.join(roomId);
        const publicRoom = second.room || first.room;
        io.to(match.player1.socketId).emit('match_found', { roomId, opponent: match.player2.username, opponentAvatar: match.player2.avatar, symbol: 'X', room: publicRoom });
        io.to(match.player2.socketId).emit('match_found', { roomId, opponent: match.player1.username, opponentAvatar: match.player1.avatar, symbol: 'O', room: publicRoom });
        io.to(roomId).emit('room_update', publicRoom);
      }
      for (const player of matchmaker.expiredPlayers(15_000)) io.to(player.socketId).emit('match_fallback_ai');
      for (const result of roomManager.resolveDisconnectTimeouts()) io.to(result.roomId).emit('room_update', result.room);
      roomActionLimiter.prune();
      roomManager.removeExpired();
    }, 1000));
  }

  function close() {
    timers.forEach(clearInterval);
    return new Promise((resolve) => io.close(() => server.close(() => { db.close(); resolve(); })));
  }

  return { app, server, io, db, auth, economy, roomManager, matchmaker, close };
}

module.exports = { createRuntime };
