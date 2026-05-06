const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { initDb, db } = require('./database');
const roomManager = require('./game/roomManager');
const matchmaker = require('./game/matchmaker');
const logger = require('./logger');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingInterval: 5000,
    pingTimeout: 10000
});

app.use(cors());
app.use(express.json());

// Initialize Persistence
initDb();

// --- REST API Routes ---

// Get User Profile by UUID (Updated to include inventory/stats)
app.get('/api/user/:uuid', (req, res) => {
    const { uuid } = req.params;
    let user = db.prepare('SELECT * FROM users WHERE uuid = ?').get(uuid);

    if (!user) {
        const username = `Guest_${Math.floor(Math.random() * 10000)}`;

        // Randomly pick one of the two starters as the initial active avatar
        const starters = db.prepare("SELECT * FROM avatars WHERE cost_gems = 0").all();
        // Fallback if no starters found (unlikely)
        const initialAvatar = starters.length > 0 ? starters[Math.floor(Math.random() * starters.length)] : { url: `https://api.dicebear.com/7.x/avataaars/svg?seed=${uuid}`, id: 1 };

        const result = db.prepare(`
          INSERT INTO users (uuid, username, avatar, active_avatar_id) 
          VALUES (?, ?, ?, ?)
        `).run(uuid, username, initialAvatar.url, initialAvatar.id);

        user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);

        // Give ALL free starter avatars to new user
        starters.forEach(starter => {
            db.prepare('INSERT OR IGNORE INTO user_avatars (user_id, avatar_id) VALUES (?, ?)').run(user.id, starter.id);
        });
    }
    res.json(user);
});

// Mock Google Auth Conversion
app.post('/api/auth/convert', (req, res) => {
    const { uuid, google_id, email, username } = req.body;
    try {
        db.prepare(`
            UPDATE users 
            SET google_id = ?, email = ?, username = ? 
            WHERE uuid = ?
        `).run(google_id, email, username, uuid);
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ error: 'Username or Email already taken' });
    }
});

// --- ECONYOMY ENGINE ---

// 1. Paystack Webhook Mock (Tier 1: NGN -> Tokens)
app.post('/api/economy/deposit', (req, res) => {
    const { uuid, amount_ngn, reference } = req.body;
    // In production, verify reference with Paystack API here

    const user = db.prepare('SELECT id FROM users WHERE uuid = ?').get(uuid);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const tokensToGrant = Math.floor(amount_ngn / 1000);
    if (tokensToGrant <= 0) return res.status(400).json({ error: 'Amount too low' });

    const transaction = db.transaction(() => {
        // Atomic Increment
        db.prepare('UPDATE users SET tokens = tokens + ? WHERE id = ?').run(tokensToGrant, user.id);

        // Log Transaction
        db.prepare(`
            INSERT INTO transactions (id, user_id, amount, currency, type, status)
            VALUES (?, ?, ?, 'Token', 'deposit', 'success')
        `).run(reference || `DEP_${Date.now()}`, user.id, tokensToGrant);
    });

    try {
        transaction();
        res.json({ success: true, tokens_added: tokensToGrant });
    } catch (e) {
        res.status(500).json({ error: 'Transaction failed' });
    }
});

// 2. Exchange (Tier 2: Tokens -> Gems)
app.post('/api/economy/exchange', (req, res) => {
    const { uuid, tokens } = req.body;
    if (tokens <= 0) return res.status(400).json({ error: 'Invalid amount' });

    const user = db.prepare('SELECT id, tokens FROM users WHERE uuid = ?').get(uuid);
    if (!user || user.tokens < tokens) return res.status(400).json({ error: 'Insufficient tokens' });

    const gemsToGrant = tokens * 100;

    const exchangeTx = db.transaction(() => {
        db.prepare('UPDATE users SET tokens = tokens - ?, gems = gems + ? WHERE id = ?').run(tokens, gemsToGrant, user.id);
        db.prepare(`
            INSERT INTO transactions (id, user_id, amount, currency, type, status)
            VALUES (?, ?, ?, 'Gem', 'exchange', 'success')
        `).run(`EXC_${Date.now()}`, user.id, tokens);
    });

    try {
        exchangeTx();
        res.json({ success: true, gems_added: gemsToGrant });
    } catch (e) {
        res.status(500).json({ error: 'Atomic exchange failed' });
    }
});

// 3. Purchase Avatar
app.post('/api/economy/buy-avatar', (req, res) => {
    const { uuid, avatarId } = req.body;

    const user = db.prepare('SELECT id, gems FROM users WHERE uuid = ?').get(uuid);
    const avatar = db.prepare('SELECT * FROM avatars WHERE id = ?').get(avatarId);

    if (!user || !avatar) return res.status(404).json({ error: 'Not found' });
    if (user.gems < avatar.cost_gems) return res.status(400).json({ error: 'Insufficient gems' });

    const purchaseTx = db.transaction(() => {
        // Deduct
        db.prepare('UPDATE users SET gems = gems - ? WHERE id = ?').run(avatar.cost_gems, user.id);
        // Add to inventory
        db.prepare('INSERT INTO user_avatars (user_id, avatar_id) VALUES (?, ?)').run(user.id, avatarId);
        // Log
        db.prepare(`
            INSERT INTO transactions (id, user_id, amount, currency, type, status)
            VALUES (?, ?, ?, 'Gem', 'purchase', 'success')
        `).run(`PUR_${Date.now()}`, user.id, avatar.cost_gems);
    });

    try {
        purchaseTx();
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ error: 'Already owned or transaction failed' });
    }
});

// 4. GDPR: Export Data
app.get('/api/user/:uuid/export', (req, res) => {
    const { uuid } = req.params;
    const user = db.prepare('SELECT * FROM users WHERE uuid = ?').get(uuid);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const inventory = db.prepare(`
        SELECT a.name, a.rarity, ua.purchased_at 
        FROM user_avatars ua 
        JOIN avatars a ON ua.avatar_id = a.id 
        WHERE ua.user_id = ?
    `).all(user.id);

    const transactions = db.prepare('SELECT * FROM transactions WHERE user_id = ?').all(user.id);
    const matches = db.prepare('SELECT * FROM matches WHERE player_x_id = ? OR player_o_id = ?').all(user.id, user.id);

    res.json({
        profile: user,
        inventory,
        transactions,
        match_history: matches,
        exporter_version: '1.0',
        exported_at: new Date().toISOString()
    });
});

// 5. GDPR: Delete Account
app.delete('/api/user/:uuid', (req, res) => {
    const { uuid } = req.params;
    const user = db.prepare('SELECT id FROM users WHERE uuid = ?').get(uuid);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const deleteTx = db.transaction(() => {
        db.prepare('DELETE FROM user_avatars WHERE user_id = ?').run(user.id);
        db.prepare('DELETE FROM transactions WHERE user_id = ?').run(user.id);
        // Anonymize matches instead of deleting to preserve history stats for others
        db.prepare('UPDATE matches SET player_x_id = NULL WHERE player_x_id = ?').run(user.id);
        db.prepare('UPDATE matches SET player_o_id = NULL WHERE player_o_id = ?').run(user.id);
        db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    });

    try {
        deleteTx();
        res.json({ success: true, message: 'Account permanently deleted' });
    } catch (e) {
        res.status(500).json({ error: 'Deletion failed' });
    }
});

// 6. Equip Avatar
app.post('/api/user/equip', (req, res) => {
    const { uuid, avatarId } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE uuid = ?').get(uuid);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Verify ownership
    const owned = db.prepare('SELECT * FROM user_avatars WHERE user_id = ? AND avatar_id = ?').get(user.id, avatarId);
    if (!owned) return res.status(403).json({ error: 'Avatar not owned' });

    const avatarUrl = db.prepare('SELECT url FROM avatars WHERE id = ?').get(avatarId).url;

    db.prepare('UPDATE users SET active_avatar_id = ?, avatar = ? WHERE id = ?')
        .run(avatarId, avatarUrl, user.id);

    res.json({ success: true, avatarId, avatarUrl });
});

// Get Shop Items
app.get('/api/shop/items', (req, res) => {
    const items = db.prepare('SELECT * FROM avatars').all();
    res.json(items);
});

// Get User Inventory
app.get('/api/user/:uuid/inventory', (req, res) => {
    const { uuid } = req.params;
    const inventory = db.prepare(`
        SELECT a.* FROM avatars a
        JOIN user_avatars ua ON a.id = ua.avatar_id
        JOIN users u ON u.id = ua.user_id
        WHERE u.uuid = ?
    `).all(uuid);
    res.json(inventory);
});

app.get('/api/leaderboard', (req, res) => {
    const topUsers = db.prepare('SELECT username, avatar, xp, wins FROM users ORDER BY xp DESC LIMIT 10').all();
    res.json(topUsers);
});

// Matchmaking Tick
setInterval(() => {
    const match = matchmaker.findMatch();
    if (match) {
        const { player1, player2 } = match;
        const roomId = `MATCH_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

        roomManager.createRoom(roomId, { size: 3, rounds: 3 });
        // Add to room state implicitly or explicitly if needed

        io.to(player1.socketId).emit('match_found', {
            roomId,
            opponent: player2.username,
            opponentAvatar: player2.avatar,
            symbol: 'X'
        });
        io.to(player2.socketId).emit('match_found', {
            roomId,
            opponent: player1.username,
            opponentAvatar: player1.avatar,
            symbol: 'O'
        });

        console.log(`Matched ${player1.username} and ${player2.username} in ${roomId}`);
    }

    // AI Fallback toggle
    const now = Date.now();

    matchmaker.getQueuePlayers().forEach(player => {
        if (now - player.timestamp > 10000) { // 10 seconds timeout
            matchmaker.removeFromQueue(player.socketId);
            io.to(player.socketId).emit('match_fallback_ai');
            console.log(`AI Fallback for ${player.username}`);
        }
    });
}, 2000);

// --- Socket.io Game Logic ---

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('find_match', ({ uuid, username, avatar }) => {
        matchmaker.addToQueue({ socketId: socket.id, uuid, username, avatar });
    });

    socket.on('cancel_matchmaking', () => {
        matchmaker.removeFromQueue(socket.id);
    });

    socket.on('create_room', ({ roomId, config }) => {
        roomManager.createRoom(roomId, config);
        console.log(`Room created: ${roomId} with config:`, config);
    });

    socket.on('join_room', ({ roomId, username }) => {
        // Ensure room exists (fallback if create_room wasn't called)
        if (!roomManager.getRoom(roomId)) {
            roomManager.createRoom(roomId);
        }

        // Join room
        const result = roomManager.joinRoom(roomId, { id: socket.id, username, socketId: socket.id });

        if (result.error) {
            socket.emit('error', result.error);
            console.log(`Join error for ${username} in ${roomId}: ${result.error}`);
        } else {
            socket.join(roomId);
            io.to(roomId).emit('room_update', result.room);
            console.log(`${username} joined room ${roomId} as ${result.player.symbol}`);
        }
    });

    socket.on('make_move', ({ roomId, index }) => {
        const updatedRoom = roomManager.makeMove(roomId, index, socket.id);
        if (updatedRoom) {
            io.to(roomId).emit('room_update', updatedRoom);
        }
    });

    socket.on('disconnect', () => {
        matchmaker.removeFromQueue(socket.id);
        const result = roomManager.leaveRoom(socket.id);
        if (result) {
            io.to(result.roomId).emit('player_left', result.room);
            io.to(result.roomId).emit('room_update', result.room);
        }
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
