const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { initDb } = require('../database');

test('prototype SQLite data migrates in place without losing users', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE,
      username TEXT UNIQUE,
      avatar TEXT,
      xp INTEGER DEFAULT 0,
      level INTEGER DEFAULT 1,
      coins REAL DEFAULT 0,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      draws INTEGER DEFAULT 0,
      streak INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE avatars (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      url TEXT,
      cost_gems INTEGER,
      rarity TEXT,
      metadata TEXT
    );
    INSERT INTO users (uuid, username, coins) VALUES ('legacy-id', 'Legacy_Player', 4.5);
    INSERT INTO avatars (name, url, cost_gems, rarity) VALUES ('Legacy Avatar', 'https://example.invalid/avatar.svg', 20, 'Common');
  `);

  initDb(db);
  const user = db.prepare("SELECT * FROM users WHERE username = 'Legacy_Player'").get();
  assert.equal(user.uuid, 'legacy-id');
  assert.equal(user.session_version, 0);
  assert.equal(user.gems, 100);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'currency_ledger'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'series_results'").get());
  const columns = db.prepare('PRAGMA table_info(avatars)').all().map((column) => column.name);
  assert.ok(columns.includes('currency'));
  assert.ok(columns.includes('cost_coins'));
  db.close();
});

test('migration adds the google account linking column and unique index to legacy schemas', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE,
      username TEXT UNIQUE,
      avatar TEXT,
      xp INTEGER DEFAULT 0,
      level INTEGER DEFAULT 1,
      coins REAL DEFAULT 0,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      draws INTEGER DEFAULT 0,
      streak INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO users (uuid, username) VALUES ('legacy-1', 'Legacy_One');
    INSERT INTO users (uuid, username) VALUES ('legacy-2', 'Legacy_Two');
  `);

  initDb(db);
  const columns = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
  assert.ok(columns.includes('email_verified'));
  assert.ok(columns.includes('google_id'));
  assert.equal(db.prepare('SELECT email_verified FROM users WHERE username = ?').get('Legacy_One').email_verified, 0);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_users_google_id'").get());

  db.prepare('UPDATE users SET google_id = ? WHERE username = ?').run('google-sub-1', 'Legacy_One');
  assert.throws(
    () => db.prepare('UPDATE users SET google_id = ? WHERE username = ?').run('google-sub-1', 'Legacy_Two'),
    (error) => error.code === 'SQLITE_CONSTRAINT_UNIQUE' && /users\.google_id/.test(error.message),
  );
  db.close();
});
