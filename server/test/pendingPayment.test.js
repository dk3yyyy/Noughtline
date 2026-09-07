const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createDatabase, createGuest } = require('../database');
const { createEconomy } = require('../economy');
const { createRuntime } = require('../app');

// GET /api/economy/payments/pending — the resume hook for the Paystack
// completion loop. Economy-level tests exercise the service method with a
// controllable clock; route-level tests cover auth and the wire shape.

const PACKAGE_ID = 'gems_120';
const REFERENCE = 'TT_pending_check';
const BUYER_EMAIL = 'buyer@example.com';
const PUBLIC_APP_URL = 'http://localhost';

function paymentConfig(overrides = {}) {
  return {
    nodeEnv: 'test',
    jwtSecret: 'test-secret-at-least-local',
    jwtExpiresIn: '1h',
    databasePath: ':memory:',
    corsOrigins: ['http://localhost'],
    paystackSecretKey: 'test-secret',
    publicAppUrl: PUBLIC_APP_URL,
    ...overrides,
  };
}

// Serves both Paystack calls the loop makes: initialization returns the local
// reference, verification confirms charge.success for that exact reference.
function paystackResponder() {
  return async (url) => {
    if (url.includes('/transaction/initialize')) {
      return {
        ok: true,
        json: async () => ({
          status: true,
          data: { reference: REFERENCE, authorization_url: 'https://paystack.test/authorize' },
        }),
      };
    }
    if (url.includes('/transaction/verify/')) {
      return {
        ok: true,
        json: async () => ({
          status: true,
          data: { reference: REFERENCE, status: 'success', amount: 100000, currency: 'NGN' },
        }),
      };
    }
    return { ok: false, json: async () => ({}) };
  };
}

function economyWith(db, extra = {}) {
  return createEconomy({
    db,
    config: { paystackSecretKey: 'test-secret', publicAppUrl: PUBLIC_APP_URL },
    fetchImpl: paystackResponder(),
    ...extra,
  });
}

test('reports no pending payment for a user with no intents', () => {
  const db = createDatabase(':memory:');
  const user = createGuest(db);
  const economy = economyWith(db);
  assert.equal(economy.getPendingPayment(user.id), null);
  db.close();
});

test('returns the newest pending intent after Paystack initialization', async (t) => {
  const db = createDatabase(':memory:');
  t.after(() => db.close());
  const user = createGuest(db);
  db.prepare('UPDATE users SET email = ? WHERE id = ?').run(BUYER_EMAIL, user.id);
  const economy = economyWith(db);
  await economy.initializePayment({ ...user, email: BUYER_EMAIL }, PACKAGE_ID);

  const pending = economy.getPendingPayment(user.id);
  assert.ok(pending, 'expected a pending intent to be reported');
  assert.equal(pending.reference, REFERENCE);
  assert.equal(pending.packageId, PACKAGE_ID);
  assert.equal(pending.gems, 120);
  assert.equal(pending.amountNgn, 1000);
  assert.equal(typeof pending.createdAt, 'string');
  assert.ok(pending.createdAt.length > 0);
});

test('reports no pending payment once the intent has been verified and credited', async (t) => {
  const db = createDatabase(':memory:');
  t.after(() => db.close());
  const user = createGuest(db);
  db.prepare('UPDATE users SET email = ? WHERE id = ?').run(BUYER_EMAIL, user.id);
  const economy = economyWith(db);
  await economy.initializePayment({ ...user, email: BUYER_EMAIL }, PACKAGE_ID);
  await economy.verifyAndCreditPayment(REFERENCE);

  assert.equal(db.prepare('SELECT status FROM payment_intents WHERE reference = ?').get(REFERENCE).status, 'credited');
  assert.equal(economy.getPendingPayment(user.id), null);
});

test('a failed intent stays retry-worthy inside 30 minutes and not afterwards', async (t) => {
  const db = createDatabase(':memory:');
  t.after(() => db.close());
  const user = createGuest(db);
  db.prepare('UPDATE users SET email = ? WHERE id = ?').run(BUYER_EMAIL, user.id);
  const economy = economyWith(db);
  await economy.initializePayment({ ...user, email: BUYER_EMAIL }, PACKAGE_ID);

  // Failed 5 minutes ago: the client-side verify may still race Paystack
  // finalization (webhook not yet arrived), so it must be surfaced for retry.
  db.prepare("UPDATE payment_intents SET status = 'failed', created_at = datetime('now', '-5 minutes') WHERE reference = ?").run(REFERENCE);
  const fresh = economy.getPendingPayment(user.id);
  assert.ok(fresh, 'a recently failed intent should still be reported as pending-with-verification-needed');
  assert.equal(fresh.reference, REFERENCE);

  // Failed 31 minutes ago: an abandoned checkout, never resurrected.
  db.prepare("UPDATE payment_intents SET status = 'failed', created_at = datetime('now', '-31 minutes') WHERE reference = ?").run(REFERENCE);
  assert.equal(economy.getPendingPayment(user.id), null);
});

test('GET /api/economy/payments/pending requires a signed session', async (t) => {
  const runtime = createRuntime({
    config: paymentConfig(),
    database: createDatabase(':memory:'),
    startTimers: false,
  });
  t.after(() => runtime.db.close());

  const response = await request(runtime.app).get('/api/economy/payments/pending');
  assert.equal(response.status, 401);
});

test('GET /api/economy/payments/pending reports no pending intent for a signed guest', async (t) => {
  const runtime = createRuntime({
    config: paymentConfig(),
    database: createDatabase(':memory:'),
    startTimers: false,
  });
  t.after(() => runtime.db.close());

  const session = await request(runtime.app).post('/api/auth/guest').send({});
  const response = await request(runtime.app)
    .get('/api/economy/payments/pending')
    .set('Authorization', `Bearer ${session.body.token}`);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { pending: false });
});

test('resume loop: initialize -> pending reported -> client verify credits -> pending false', async (t) => {
  const runtime = createRuntime({
    config: paymentConfig(),
    database: createDatabase(':memory:'),
    fetchImpl: paystackResponder(),
    startTimers: false,
  });
  t.after(() => runtime.db.close());

  const session = await request(runtime.app).post('/api/auth/guest').send({});
  const auth = { Authorization: `Bearer ${session.body.token}` };
  runtime.db.prepare('UPDATE users SET email = ? WHERE id = ?').run(BUYER_EMAIL, session.body.user.id);

  const initRes = await request(runtime.app)
    .post('/api/economy/payments')
    .set(auth)
    .send({ packageId: PACKAGE_ID });
  assert.equal(initRes.status, 201);
  assert.equal(initRes.body.reference, REFERENCE);

  // The Paystack return leg: the client asks which intent still needs verify.
  const pendingRes = await request(runtime.app).get('/api/economy/payments/pending').set(auth);
  assert.equal(pendingRes.status, 200);
  assert.equal(pendingRes.body.pending, true);
  assert.equal(pendingRes.body.reference, REFERENCE);
  assert.equal(pendingRes.body.packageId, PACKAGE_ID);
  assert.equal(pendingRes.body.gems, 120);
  assert.equal(pendingRes.body.amountNgn, 1000);
  assert.equal(typeof pendingRes.body.createdAt, 'string');

  const verifyRes = await request(runtime.app)
    .post(`/api/economy/payments/${REFERENCE}/verify`)
    .set(auth);
  assert.equal(verifyRes.status, 200);
  assert.equal(verifyRes.body.gemsAdded, 120);

  const afterRes = await request(runtime.app).get('/api/economy/payments/pending').set(auth);
  assert.equal(afterRes.status, 200);
  assert.deepEqual(afterRes.body, { pending: false });
});
