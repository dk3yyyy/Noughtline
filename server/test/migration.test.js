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
