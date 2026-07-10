const Database = require('better-sqlite3');
const crypto = require('crypto');

function addColumnIfNotExists(db, tableName, columnName, columnDef) {
  const info = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!info.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`);
  }
}

function initDb(db) {
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE,
      google_id TEXT UNIQUE,
      email TEXT UNIQUE,
      username TEXT UNIQUE NOT NULL,
      avatar TEXT,
      xp INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
      level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
      tokens INTEGER NOT NULL DEFAULT 0,
      gems INTEGER NOT NULL DEFAULT 100 CHECK (gems >= 0),
      coins INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),
      wins INTEGER NOT NULL DEFAULT 0 CHECK (wins >= 0),
      losses INTEGER NOT NULL DEFAULT 0 CHECK (losses >= 0),
      draws INTEGER NOT NULL DEFAULT 0 CHECK (draws >= 0),
      streak INTEGER NOT NULL DEFAULT 0 CHECK (streak >= 0),
      active_avatar_id INTEGER,
      session_version INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS avatars (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      url TEXT NOT NULL,
      cost_gems INTEGER NOT NULL DEFAULT 0 CHECK (cost_gems >= 0),
      cost_coins INTEGER NOT NULL DEFAULT 0 CHECK (cost_coins >= 0),
      currency TEXT NOT NULL DEFAULT 'gems' CHECK (currency IN ('coins', 'gems')),
      rarity TEXT NOT NULL,
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS user_avatars (
      user_id INTEGER NOT NULL,
      avatar_id INTEGER NOT NULL,
      purchased_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, avatar_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(avatar_id) REFERENCES avatars(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS currency_ledger (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      currency TEXT NOT NULL CHECK (currency IN ('coins', 'gems')),
      amount INTEGER NOT NULL CHECK (amount != 0),
      balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
      reason TEXT NOT NULL,
      reference TEXT NOT NULL,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, reference),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS payment_intents (
      reference TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      package_id TEXT NOT NULL,
      amount_ngn INTEGER NOT NULL CHECK (amount_ngn > 0),
      gems INTEGER NOT NULL CHECK (gems > 0),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'credited', 'failed')),
      provider_payload TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      credited_at DATETIME,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS series_results (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      player_x_id INTEGER,
      player_o_id INTEGER,
      winner_id INTEGER,
      result TEXT NOT NULL CHECK (result IN ('X', 'O', 'Draw')),
      score_x INTEGER NOT NULL,
      score_o INTEGER NOT NULL,
      rounds_played INTEGER NOT NULL,
      board_size INTEGER NOT NULL,
      round_history TEXT NOT NULL,
      completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(player_x_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY(player_o_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY(winner_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ledger_user_created ON currency_ledger(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_series_players ON series_results(player_x_id, player_o_id, completed_at DESC);
  `);

  // Migration from the prototype schema.
  addColumnIfNotExists(db, 'users', 'uuid', 'TEXT');
  addColumnIfNotExists(db, 'users', 'google_id', 'TEXT');
  addColumnIfNotExists(db, 'users', 'email', 'TEXT');
  addColumnIfNotExists(db, 'users', 'tokens', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfNotExists(db, 'users', 'gems', 'INTEGER NOT NULL DEFAULT 100');
  addColumnIfNotExists(db, 'users', 'coins', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfNotExists(db, 'users', 'active_avatar_id', 'INTEGER');
  addColumnIfNotExists(db, 'users', 'session_version', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfNotExists(db, 'avatars', 'cost_coins', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfNotExists(db, 'avatars', 'currency', "TEXT NOT NULL DEFAULT 'gems'");

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_uuid ON users(uuid);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_avatars_name ON avatars(name);
  `);

  const avatars = [
    ['Classic Pulse', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Pulse', 0, 0, 'coins', 'Common'],
    ['Cosmic Girl', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Annie', 0, 0, 'coins', 'Common'],
    ['Nano Bot', 'https://api.dicebear.com/7.x/bottts/svg?seed=Nano', 0, 150, 'coins', 'Common'],
    ['Star Pilot', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Pilot', 0, 200, 'coins', 'Common'],
    ['Stone Golem', 'https://api.dicebear.com/7.x/bottts/svg?seed=Golem', 0, 150, 'coins', 'Common'],
    ['Happy Sloth', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Sloth', 0, 150, 'coins', 'Common'],
    ['Panda Chef', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Panda', 0, 180, 'coins', 'Common'],
    ['Plasma Knight', 'https://api.dicebear.com/7.x/bottts/svg?seed=Plasma', 600, 0, 'gems', 'Rare'],
    ['Goblin Rogue', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Goblin', 500, 0, 'gems', 'Rare'],
    ['Water Nymph', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Nymph', 700, 0, 'gems', 'Rare'],
    ['Cool Penguin', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Penguin', 400, 0, 'gems', 'Rare'],
    ['Astro Cat', 'https://api.dicebear.com/7.x/avataaars/svg?seed=AstroCat', 1200, 0, 'gems', 'Epic'],
    ['Forest Spirit', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Groot', 950, 0, 'gems', 'Epic'],
    ['Ninja Fox', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Fox', 800, 0, 'gems', 'Epic'],
    ['Neon Samurai', 'https://api.dicebear.com/7.x/bottts/svg?seed=Samurai', 1500, 0, 'gems', 'Epic'],
    ['Cyborg Ronin', 'https://api.dicebear.com/7.x/bottts/svg?seed=Ronin', 3500, 0, 'gems', 'Legendary'],
    ['King Lion', 'https://api.dicebear.com/7.x/avataaars/svg?seed=LionKing', 2800, 0, 'gems', 'Legendary'],
    ['Dragon Lord', 'https://api.dicebear.com/7.x/avataaars/svg?seed=DragonLord', 6000, 0, 'gems', 'God'],
  ];
  const upsert = db.prepare(`
    INSERT INTO avatars (name, url, cost_gems, cost_coins, currency, rarity)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      url = excluded.url,
      cost_gems = excluded.cost_gems,
      cost_coins = excluded.cost_coins,
      currency = excluded.currency,
      rarity = excluded.rarity
  `);
  db.transaction(() => avatars.forEach((avatar) => upsert.run(...avatar)))();
}

function createDatabase(databasePath) {
  const db = new Database(databasePath);
  db.pragma('busy_timeout = 5000');
  if (databasePath !== ':memory:') db.pragma('journal_mode = WAL');
  initDb(db);
  return db;
}

function createGuest(db) {
  const uuid = crypto.randomUUID();
  const username = `Guest_${crypto.randomBytes(3).toString('hex')}`;
  const starter = db.prepare("SELECT * FROM avatars WHERE cost_gems = 0 AND cost_coins = 0 ORDER BY id LIMIT 1").get();
  const result = db.prepare(`
    INSERT INTO users (uuid, username, avatar, active_avatar_id)
    VALUES (?, ?, ?, ?)
  `).run(uuid, username, starter?.url || null, starter?.id || null);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  const starters = db.prepare('SELECT id FROM avatars WHERE cost_gems = 0 AND cost_coins = 0').all();
  const grant = db.prepare('INSERT OR IGNORE INTO user_avatars (user_id, avatar_id) VALUES (?, ?)');
  db.transaction(() => starters.forEach(({ id }) => grant.run(user.id, id)))();
  return user;
}

function publicUser(user) {
  if (!user) return null;
  const safe = { ...user };
  delete safe.google_id;
  delete safe.session_version;
  delete safe.tokens;
  return safe;
}

module.exports = { createDatabase, initDb, createGuest, publicUser };
