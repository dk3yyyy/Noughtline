const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase, createGuest } = require('../database');
const { createEconomy } = require('../economy');

function setup() {
  const db = createDatabase(':memory:');
  const user = createGuest(db);
  const economy = createEconomy({ db, config: { paystackSecretKey: '', publicAppUrl: 'http://localhost' } });
  return { db, user, economy };
}

test('ledger changes balances atomically and rejects duplicate references', () => {
  const { db, user, economy } = setup();
  const balance = economy.changeBalance({ userId: user.id, currency: 'coins', amount: 10, reason: 'test', reference: 'test:1' });
  assert.equal(balance, 10);
  assert.throws(() => economy.changeBalance({ userId: user.id, currency: 'coins', amount: 10, reason: 'test', reference: 'test:1' }));
  assert.equal(db.prepare('SELECT coins FROM users WHERE id = ?').get(user.id).coins, 10);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM currency_ledger').get().count, 1);
  db.close();
});

test('cannot spend more currency than the server balance', () => {
  const { db, user, economy } = setup();
  assert.throws(
    () => economy.changeBalance({ userId: user.id, currency: 'coins', amount: -1, reason: 'test', reference: 'test:debit' }),
    /Insufficient coins/,
  );
  assert.equal(db.prepare('SELECT coins FROM users WHERE id = ?').get(user.id).coins, 0);
  db.close();
});

test('paid currency cannot be initialized without server payment configuration', async () => {
  const { db, user, economy } = setup();
  await assert.rejects(() => economy.initializePayment({ ...user, email: 'user@example.com' }, 'gems_120'), /not configured/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM payment_intents').get().count, 0);
  db.close();
});

test('verified Paystack response credits the server package exactly once', async () => {
  const db = createDatabase(':memory:');
  const user = createGuest(db);
  db.prepare('UPDATE users SET email = ? WHERE id = ?').run('verified@example.com', user.id);
  const responses = [
    { ok: true, status: true, data: { reference: 'TT_verified', authorization_url: 'https://paystack.test/authorize' } },
    { ok: true, status: true, data: { reference: 'TT_verified', status: 'success', amount: 100000, currency: 'NGN' } },
  ];
  const fetchImpl = async () => {
    const payload = responses.shift();
    return { ok: payload.ok, json: async () => payload };
  };
  const economy = createEconomy({
    db,
    config: { paystackSecretKey: 'test-key', publicAppUrl: 'http://localhost' },
    fetchImpl,
  });
  const initialized = await economy.initializePayment({ ...user, email: 'verified@example.com' }, 'gems_120');
  assert.equal(initialized.reference, 'TT_verified');
  const credited = await economy.verifyAndCreditPayment('TT_verified');
  assert.equal(credited.gemsAdded, 120);
  assert.equal(db.prepare('SELECT gems FROM users WHERE id = ?').get(user.id).gems, 220);
  const repeated = await economy.verifyAndCreditPayment('TT_verified');
  assert.equal(repeated.alreadyCredited, true);
  assert.equal(db.prepare('SELECT gems FROM users WHERE id = ?').get(user.id).gems, 220);
  db.close();
});

test('coin-priced avatar purchase debits ledger and grants inventory', () => {
  const { db, user, economy } = setup();
  economy.changeBalance({ userId: user.id, currency: 'coins', amount: 200, reason: 'test_grant', reference: 'grant:coins' });
  const avatar = db.prepare("SELECT * FROM avatars WHERE currency = 'coins' AND cost_coins > 0 ORDER BY cost_coins LIMIT 1").get();
  const result = economy.buyAvatar(user.id, avatar.id);
  assert.equal(result.currency, 'coins');
  assert.equal(db.prepare('SELECT coins FROM users WHERE id = ?').get(user.id).coins, 200 - avatar.cost_coins);
  assert.ok(db.prepare('SELECT 1 FROM user_avatars WHERE user_id = ? AND avatar_id = ?').get(user.id, avatar.id));
  db.close();
});
