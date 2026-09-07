const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase, createGuest } = require('../database');

// Guest usernames are Guest_ + 6 random hex chars; a collision with an existing
// username is a ~1/16.7M SQLITE_CONSTRAINT_UNIQUE failure on users.username.
// createGuest retries with freshly generated uuid + username up to this many attempts.
const GUEST_USERNAME_MAX_ATTEMPTS = 5;

function seedUser(db, uuid, username) {
  db.prepare('INSERT INTO users (uuid, username) VALUES (?, ?)').run(uuid, username);
}

function freeAvatarCount(db) {
  return db.prepare('SELECT COUNT(*) AS count FROM avatars WHERE cost_gems = 0 AND cost_coins = 0').get().count;
}

test('createGuest retries with a fresh username when the first one collides', () => {
  const db = createDatabase(':memory:');
  try {
    const taken = 'Taken_Guest_aaaaaa';
    const fresh = 'Fresh_Guest_bbbbbb';
    seedUser(db, 'taken-uuid', taken);

    const calls = [];
    const usernameGenerator = () => {
      calls.push(1);
      return calls.length === 1 ? taken : fresh;
    };

    const user = createGuest(db, { usernameGenerator });

    assert.equal(user.username, fresh);
    assert.equal(calls.length, 2, 'generator ran once for the collision plus once for the retry');
    assert.notEqual(user.uuid, 'taken-uuid');
    // Starter avatars are still granted exactly like a non-colliding guest.
    const granted = db.prepare('SELECT COUNT(*) AS count FROM user_avatars WHERE user_id = ?').get(user.id).count;
    assert.equal(granted, freeAvatarCount(db));
  } finally {
    db.close();
  }
});

test('createGuest exhausts retries and rethrows when every username collides', () => {
  const db = createDatabase(':memory:');
  try {
    const taken = 'Always_Taken_Guest';
    seedUser(db, 'taken-uuid', taken);

    let calls = 0;
    const usernameGenerator = () => {
      calls += 1;
      return taken;
    };

    assert.throws(
      () => createGuest(db, { usernameGenerator }),
      (error) => {
        assert.equal(error.code, 'SQLITE_CONSTRAINT_UNIQUE');
        assert.match(error.message, /users\.username/);
        return true;
      }
    );
    assert.equal(calls, GUEST_USERNAME_MAX_ATTEMPTS, 'bounded retry budget, no infinite loop');
    // Every failed attempt rolled back: no orphaned partial guest rows.
    const total = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    assert.equal(total, 1);
  } finally {
    db.close();
  }
});

test('createGuest default generator still creates a valid guest with starter avatars', () => {
  const db = createDatabase(':memory:');
  try {
    const user = createGuest(db);
    assert.match(user.username, /^Guest_[0-9a-f]{6}$/);
    assert.ok(user.uuid);
    const granted = db.prepare('SELECT COUNT(*) AS count FROM user_avatars WHERE user_id = ?').get(user.id).count;
    assert.equal(granted, freeAvatarCount(db));
  } finally {
    db.close();
  }
});
