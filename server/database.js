const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'tic-tac.db'));

// Helper to add column if not exists
function addColumnIfNotExists(tableName, columnName, columnDef) {
  const info = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!info.find(col => col.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`);
    console.log(`Added column ${columnName} to ${tableName}`);
  }
}

// Initialize Database Schema
function initDb() {
  // Users Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE,
      google_id TEXT UNIQUE,
      email TEXT UNIQUE,
      username TEXT UNIQUE,
      avatar TEXT,
      xp INTEGER DEFAULT 0,
      level INTEGER DEFAULT 1,
      tokens INTEGER DEFAULT 0,
      gems INTEGER DEFAULT 100,
      coins REAL DEFAULT 0.0,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      draws INTEGER DEFAULT 0,
      streak INTEGER DEFAULT 0,
      active_avatar_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migrate users table for existing columns
  addColumnIfNotExists('users', 'uuid', 'TEXT');
  addColumnIfNotExists('users', 'google_id', 'TEXT');
  addColumnIfNotExists('users', 'email', 'TEXT');
  addColumnIfNotExists('users', 'tokens', 'INTEGER DEFAULT 0');
  addColumnIfNotExists('users', 'gems', 'INTEGER DEFAULT 100');
  addColumnIfNotExists('users', 'active_avatar_id', 'INTEGER');

  // Add unique indexes separately (safer migration)
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_uuid ON users(uuid)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)');



  // Avatars/Items Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS avatars (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      url TEXT,
      cost_gems INTEGER,
      rarity TEXT, -- Common, Rare, Epic, Legendary
      metadata TEXT -- JSON string for dimensions/etc
    )
  `);

  // User Inventory (Many-to-Many)
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_avatars (
      user_id INTEGER,
      avatar_id INTEGER,
      purchased_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, avatar_id),
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(avatar_id) REFERENCES avatars(id)
    )
  `);

  // Transactions Table for Audit
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY, -- Paystack Reference or internal UUID
      user_id INTEGER,
      amount REAL,
      currency TEXT, -- NGN, Token, Gem
      type TEXT, -- 'purchase', 'exchange', 'deposit'
      status TEXT, -- 'pending', 'success', 'failed'
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  // Matches Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_x_id INTEGER,
      player_o_id INTEGER,
      winner_id INTEGER,
      moves TEXT, -- JSON string of moves
      mode TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(player_x_id) REFERENCES users(id),
      FOREIGN KEY(player_o_id) REFERENCES users(id)
    )
  `);

  // Seed Data
  // 1. Cleanup Duplicates (Keep oldest by name)
  db.exec(`
    DELETE FROM avatars 
    WHERE id NOT IN (
      SELECT MIN(id) 
      FROM avatars 
      GROUP BY name
    )
  `);

  // 2. Ensure Unique Index
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_avatars_name ON avatars(name)');

  const avatars = [
    // Free Starters
    { name: 'Classic Pulse', url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Pulse', cost: 0, rarity: 'Common' },
    { name: 'Cosmic Girl', url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Annie', cost: 0, rarity: 'Common' }, // New Free Female Avatar

    // Common
    { name: 'Nano Bot', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Nano', cost: 150, rarity: 'Common' },
    { name: 'Star Pilot', url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Pilot', cost: 200, rarity: 'Common' },
    { name: 'Stone Golem', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Golem', cost: 150, rarity: 'Common' },
    { name: 'Happy Sloth', url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Sloth', cost: 150, rarity: 'Common' },
    { name: 'Panda Chef', url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Panda', cost: 180, rarity: 'Common' },

    // Rare
    { name: 'Plasma Knight', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Plasma', cost: 600, rarity: 'Rare' },
    { name: 'Goblin Rogue', url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Goblin', cost: 500, rarity: 'Rare' },
    { name: 'Water Nymph', url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Nymph', cost: 700, rarity: 'Rare' },
    { name: 'Cool Penguin', url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Penguin', cost: 400, rarity: 'Rare' },

    // Epic
    { name: 'Astro Cat', url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=AstroCat', cost: 1200, rarity: 'Epic' },
    { name: 'Forest Spirit', url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Groot', cost: 950, rarity: 'Epic' },
    { name: 'Ninja Fox', url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Fox', cost: 800, rarity: 'Epic' },
    { name: 'Neon Samurai', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Samurai', cost: 500, rarity: 'Epic' },

    // Legendary
    { name: 'Cyborg Ronin', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Ronin', cost: 3500, rarity: 'Legendary' },
    { name: 'King Lion', url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=LionKing', cost: 2800, rarity: 'Legendary' },

    // God
    { name: 'Dragon Lord', url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=DragonLord', cost: 6000, rarity: 'God' },
    { name: 'Eternal Void', url: 'https://api.dicebear.com/7.x/shapes/svg?seed=Eternal', cost: 99999, rarity: 'God' },
    { name: 'The All-Seer', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=TheAllSeer1', cost: 50000, rarity: 'God' }
  ];

  const insertAvatar = db.prepare('INSERT OR IGNORE INTO avatars (name, url, cost_gems, rarity) VALUES (?, ?, ?, ?)');
  avatars.forEach(a => insertAvatar.run(a.name, a.url, a.cost, a.rarity));

  // Create a default guest/AI user if not exists
  const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
  if (!stmt.get('AI_Bot')) {
    db.prepare(`
      INSERT INTO users (username, avatar, xp, level) 
      VALUES ('AI_Bot', 'https://api.dicebear.com/7.x/bottts/svg?seed=AI', 999999, 100)
    `).run();
  }

  console.log('Database initialized');
}

module.exports = { db, initDb };
