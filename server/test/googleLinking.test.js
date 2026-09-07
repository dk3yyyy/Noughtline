const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createDatabase } = require('../database');
const { createRuntime } = require('../app');
const { createGoogleAuth } = require('../googleAuth');

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const CONFLICT_MESSAGE = 'This Google account is linked to another player with saved progress. Export your data from the current guest first.';

function config(clientId = CLIENT_ID) {
  return {
    nodeEnv: 'test',
    jwtSecret: 'test-secret-at-least-local',
    jwtExpiresIn: '1h',
    databasePath: ':memory:',
    corsOrigins: ['http://localhost'],
    paystackSecretKey: '',
    publicAppUrl: 'http://localhost',
    googleClientId: clientId,
  };
}

function googlePayload(overrides = {}) {
  return { sub: 'google-sub-1', email: 'player1@example.com', email_verified: true, ...overrides };
}

function createTestRuntime({ clientId = CLIENT_ID, tokenVerifier, now } = {}) {
  const cfg = config(clientId);
  const database = createDatabase(':memory:');
  const googleAuth = createGoogleAuth({
    config: cfg,
    now,
    tokenVerifier: tokenVerifier || (async () => { throw new Error('unexpected verification call'); }),
  });
  const runtime = createRuntime({ config: cfg, database, startTimers: false, googleAuth });
  return { runtime, cfg };
}

async function guest(runtime) {
  const response = await request(runtime.app).post('/api/auth/guest').send({});
  assert.equal(response.status, 201);
  return response.body;
}

async function issueNonce(runtime, token) {
  const response = await request(runtime.app)
    .post('/api/auth/google/nonce')
    .set('Authorization', `Bearer ${token}`)
    .send({});
  assert.equal(response.status, 200);
  return response.body;
}

function link(runtime, token, body) {
  return request(runtime.app).post('/api/auth/google').set('Authorization', `Bearer ${token}`).send(body);
}

test('GET /api/auth/providers reports Google as configured only when a client id is set', async (t) => {
  const unconfigured = createTestRuntime({ clientId: '' });
  t.after(() => unconfigured.runtime.db.close());
  const off = await request(unconfigured.runtime.app).get('/api/auth/providers');
  assert.equal(off.status, 200);
  assert.deepEqual(off.body, { google: { configured: false } });

  const configured = createTestRuntime();
  t.after(() => configured.runtime.db.close());
  const on = await request(configured.runtime.app).get('/api/auth/providers');
  assert.equal(on.status, 200);
  assert.deepEqual(on.body, { google: { configured: true } });
});

test('POST /api/auth/google/nonce requires a signed session', async (t) => {
  const { runtime } = createTestRuntime();
  t.after(() => runtime.db.close());
  const response = await request(runtime.app).post('/api/auth/google/nonce').send({});
  assert.equal(response.status, 401);
});

test('POST /api/auth/google/nonce issues a random 10-minute nonce', async (t) => {
  const { runtime } = createTestRuntime();
  t.after(() => runtime.db.close());
  const session = await guest(runtime);
  const auth = { Authorization: `Bearer ${session.token}` };
  const first = await issueNonce(runtime, session.token);
  const second = await issueNonce(runtime, session.token);
  assert.equal(first.expiresInMs, 600_000);
  assert.equal(first.nonce.length, 32);
  assert.match(first.nonce, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(first.nonce, second.nonce);
  assert.equal(await request(runtime.app).get('/api/me').set(auth).then((r) => r.status), 200);
});

test('POST /api/auth/google fails closed with 503 when Google is not configured', async (t) => {
  let verifierCalls = 0;
  const { runtime } = createTestRuntime({
    clientId: '',
    tokenVerifier: async () => { verifierCalls += 1; return googlePayload(); },
  });
  t.after(() => runtime.db.close());
  const session = await guest(runtime);
  const nonce = await issueNonce(runtime, session.token);
  const response = await link(runtime, session.token, { idToken: 'real-looking-token', nonce: nonce.nonce });
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { error: 'Google sign-in is not configured', code: 'GOOGLE_NOT_CONFIGURED' });
  assert.equal(verifierCalls, 0);
});

test('POST /api/auth/google rejects an unknown nonce without calling the verifier', async (t) => {
  let verifierCalls = 0;
  const { runtime } = createTestRuntime({
    tokenVerifier: async () => { verifierCalls += 1; return googlePayload(); },
  });
  t.after(() => runtime.db.close());
  const session = await guest(runtime);
  const response = await link(runtime, session.token, { idToken: 't', nonce: 'never-issued' });
  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { error: 'Invalid or expired nonce', code: 'INVALID_NONCE' });
  assert.equal(verifierCalls, 0);
});

test('POST /api/auth/google rejects a nonce issued to a different session', async (t) => {
  const { runtime } = createTestRuntime({ tokenVerifier: async () => googlePayload() });
  t.after(() => runtime.db.close());
  const first = await guest(runtime);
  const second = await guest(runtime);
  const nonce = await issueNonce(runtime, first.token);
  const response = await link(runtime, second.token, { idToken: 't', nonce: nonce.nonce });
  assert.equal(response.status, 401);
  assert.equal(response.body.code, 'INVALID_NONCE');
});

test('POST /api/auth/google rejects an expired nonce', async (t) => {
  let clock = 1_000_000;
  let verifierCalls = 0;
  const { runtime } = createTestRuntime({
    now: () => clock,
    tokenVerifier: async () => { verifierCalls += 1; return googlePayload(); },
  });
  t.after(() => runtime.db.close());
  const session = await guest(runtime);
  const nonce = await issueNonce(runtime, session.token);
  clock += 600_001;
  const response = await link(runtime, session.token, { idToken: 't', nonce: nonce.nonce });
  assert.equal(response.status, 401);
  assert.equal(response.body.code, 'INVALID_NONCE');
  assert.equal(verifierCalls, 0);
});

test('verification failure returns 401 GOOGLE_VERIFY_FAILED', async (t) => {
  const { runtime } = createTestRuntime({
    tokenVerifier: async () => {
      throw Object.assign(new Error('Google sign-in could not be verified'), { code: 'GOOGLE_VERIFY_FAILED' });
    },
  });
  t.after(() => runtime.db.close());
  const session = await guest(runtime);
  const nonce = await issueNonce(runtime, session.token);
  const response = await link(runtime, session.token, { idToken: 'tampered', nonce: nonce.nonce });
  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { error: 'Google sign-in could not be verified', code: 'GOOGLE_VERIFY_FAILED' });
});

test('a failed verification still consumes the nonce (single use)', async (t) => {
  const { runtime } = createTestRuntime({
    tokenVerifier: async () => { throw new Error('boom'); },
  });
  t.after(() => runtime.db.close());
  const session = await guest(runtime);
  const nonce = await issueNonce(runtime, session.token);
  const first = await link(runtime, session.token, { idToken: 'bad', nonce: nonce.nonce });
  assert.equal(first.status, 401);
  const second = await link(runtime, session.token, { idToken: 'bad', nonce: nonce.nonce });
  assert.equal(second.status, 401);
  assert.equal(second.body.code, 'INVALID_NONCE');
});

test('claiming an unclaimed Google account links it to the current guest and keeps progress', async (t) => {
  const { runtime } = createTestRuntime({
    tokenVerifier: async () => googlePayload({ sub: 'google-sub-1', email: 'player1@example.com' }),
  });
  t.after(() => runtime.db.close());
  const session = await guest(runtime);
  runtime.economy.changeBalance({ userId: session.user.id, currency: 'coins', amount: 50, reason: 'test', reference: 'google-link:1' });

  const nonce = await issueNonce(runtime, session.token);
  const response = await link(runtime, session.token, { idToken: 'valid-token', nonce: nonce.nonce });
  assert.equal(response.status, 200);
  assert.equal(response.body.linked, true);
  assert.equal(response.body.switched, false);
  assert.equal(response.body.user.id, session.user.id);
  assert.equal(response.body.user.email, 'player1@example.com');
  assert.equal(response.body.user.email_verified, 1);
  assert.equal(response.body.user.google_id, undefined);
  assert.equal(response.body.user.session_version, undefined);

  // The database row carries the Google identity and the balance survives.
  const row = runtime.db.prepare('SELECT * FROM users WHERE id = ?').get(session.user.id);
  assert.equal(row.google_id, 'google-sub-1');
  assert.equal(row.email, 'player1@example.com');
  assert.equal(row.email_verified, 1);
  assert.equal(row.coins, 50);
  assert.equal(runtime.db.prepare('SELECT COUNT(*) AS count FROM currency_ledger').get().count, 1);

  // The freshly minted token and the pre-link token both still work (no session bump).
  assert.equal((await request(runtime.app).get('/api/me').set('Authorization', `Bearer ${response.body.token}`)).status, 200);
  assert.equal((await request(runtime.app).get('/api/me').set('Authorization', `Bearer ${session.token}`)).status, 200);
});

test('relinking the same Google account to the same user is idempotent without a session bump', async (t) => {
  const { runtime } = createTestRuntime({
    tokenVerifier: async () => googlePayload({ sub: 'google-sub-1', email: 'player1@example.com' }),
  });
  t.after(() => runtime.db.close());
  const session = await guest(runtime);
  const firstNonce = await issueNonce(runtime, session.token);
  const first = await link(runtime, session.token, { idToken: 'valid-token', nonce: firstNonce.nonce });
  assert.equal(first.status, 200);
  assert.equal(first.body.linked, true);
  assert.equal(first.body.switched, false);

  const secondNonce = await issueNonce(runtime, session.token);
  const second = await link(runtime, session.token, { idToken: 'valid-token', nonce: secondNonce.nonce });
  assert.equal(second.status, 200);
  assert.equal(second.body.linked, true);
  assert.equal(second.body.switched, false);
  assert.equal(second.body.user.id, session.user.id);

  const row = runtime.db.prepare('SELECT session_version FROM users WHERE id = ?').get(session.user.id);
  assert.equal(row.session_version, 0);
  // The token issued before the second (idempotent) link is still valid.
  assert.equal((await request(runtime.app).get('/api/me').set('Authorization', `Bearer ${session.token}`)).status, 200);
});

test('a fresh guest is switched to the owner of a claimed Google account and their session is revoked', async (t) => {
  const ownerPayload = googlePayload({ sub: 'google-sub-owner', email: 'owner@example.com' });
  const { runtime } = createTestRuntime({ tokenVerifier: async () => ownerPayload });
  t.after(() => runtime.db.close());

  // Owner claims the Google account first.
  const owner = await guest(runtime);
  const ownerNonce = await issueNonce(runtime, owner.token);
  const ownerLink = await link(runtime, owner.token, { idToken: 'owner-token', nonce: ownerNonce.nonce });
  assert.equal(ownerLink.status, 200);
  assert.equal(ownerLink.body.user.id, owner.user.id);
  assert.equal(ownerLink.body.switched, false);

  // A brand-new fresh guest tries to link the same claimed Google account.
  const fresh = await guest(runtime);
  const nonce = await issueNonce(runtime, fresh.token);
  const response = await link(runtime, fresh.token, { idToken: 'owner-token', nonce: nonce.nonce });
  assert.equal(response.status, 200);
  assert.equal(response.body.linked, true);
  assert.equal(response.body.switched, true);
  assert.equal(response.body.user.id, owner.user.id);

  // The guest's old session is revoked; the owner's own session is untouched.
  assert.equal((await request(runtime.app).get('/api/me').set('Authorization', `Bearer ${fresh.token}`)).status, 401);
  assert.equal((await request(runtime.app).get('/api/me').set('Authorization', `Bearer ${owner.token}`)).status, 200);
  assert.equal((await request(runtime.app).get('/api/me').set('Authorization', `Bearer ${response.body.token}`)).status, 200);
});

test('linking a claimed account refuses a guest with saved progress', async (t) => {
  const { runtime } = createTestRuntime({
    tokenVerifier: async () => googlePayload({ sub: 'google-sub-owner', email: 'owner@example.com' }),
  });
  t.after(() => runtime.db.close());

  const owner = await guest(runtime);
  const ownerNonce = await issueNonce(runtime, owner.token);
  const ownerLink = await link(runtime, owner.token, { idToken: 'owner-token', nonce: ownerNonce.nonce });
  assert.equal(ownerLink.status, 200);

  const progressed = await guest(runtime);
  runtime.db.prepare('UPDATE users SET xp = 15 WHERE id = ?').run(progressed.user.id);
  const nonce = await issueNonce(runtime, progressed.token);
  const response = await link(runtime, progressed.token, { idToken: 'owner-token', nonce: nonce.nonce });
  assert.equal(response.status, 409);
  assert.deepEqual(response.body, { error: CONFLICT_MESSAGE, code: 'GOOGLE_LINK_CONFLICT' });

  // Neither session was touched by the conflict.
  assert.equal((await request(runtime.app).get('/api/me').set('Authorization', `Bearer ${progressed.token}`)).status, 200);
  assert.equal((await request(runtime.app).get('/api/me').set('Authorization', `Bearer ${owner.token}`)).status, 200);
});

test('linking a claimed account refuses a guest with ledger history even at zero XP', async (t) => {
  const { runtime } = createTestRuntime({
    tokenVerifier: async () => googlePayload({ sub: 'google-sub-owner', email: 'owner@example.com' }),
  });
  t.after(() => runtime.db.close());

  const owner = await guest(runtime);
  const ownerNonce = await issueNonce(runtime, owner.token);
  const ownerLink = await link(runtime, owner.token, { idToken: 'owner-token', nonce: ownerNonce.nonce });
  assert.equal(ownerLink.status, 200);

  // A guest that never played a series but has a ledger entry (e.g. a future
  // zero-XP reward path) must count as having saved progress.
  const progressed = await guest(runtime);
  runtime.db.prepare(
    "INSERT INTO currency_ledger (id, user_id, currency, amount, balance_after, reason, reference) VALUES ('ledger-fresh-check', ?, 'coins', 1, 1, 'test_credit', 'test:ledger-fresh-check')"
  ).run(progressed.user.id);
  const nonce = await issueNonce(runtime, progressed.token);
  const response = await link(runtime, progressed.token, { idToken: 'owner-token', nonce: nonce.nonce });
  assert.equal(response.status, 409);
  assert.deepEqual(response.body, { error: CONFLICT_MESSAGE, code: 'GOOGLE_LINK_CONFLICT' });
});

test('linking a claimed account refuses a guest with a paid avatar even at zero XP', async (t) => {
  const { runtime } = createTestRuntime({
    tokenVerifier: async () => googlePayload({ sub: 'google-sub-owner', email: 'owner@example.com' }),
  });
  t.after(() => runtime.db.close());

  const owner = await guest(runtime);
  const ownerNonce = await issueNonce(runtime, owner.token);
  const ownerLink = await link(runtime, owner.token, { idToken: 'owner-token', nonce: ownerNonce.nonce });
  assert.equal(ownerLink.status, 200);

  // Starter avatars are granted to every guest and must NOT count as progress;
  // a paid (non-free) avatar must. Insert directly to isolate the avatar check
  // from the ledger check.
  const progressed = await guest(runtime);
  const paidAvatar = runtime.db.prepare('SELECT id FROM avatars WHERE cost_gems > 0 OR cost_coins > 0 ORDER BY id LIMIT 1').get();
  assert.ok(paidAvatar, 'seeded catalogue has a paid avatar');
  runtime.db.prepare('INSERT INTO user_avatars (user_id, avatar_id) VALUES (?, ?)').run(progressed.user.id, paidAvatar.id);
  const nonce = await issueNonce(runtime, progressed.token);
  const response = await link(runtime, progressed.token, { idToken: 'owner-token', nonce: nonce.nonce });
  assert.equal(response.status, 409);
  assert.deepEqual(response.body, { error: CONFLICT_MESSAGE, code: 'GOOGLE_LINK_CONFLICT' });
});

test('claiming an email already used by another player returns 409 EMAIL_ALREADY_LINKED', async (t) => {
  const { runtime } = createTestRuntime({
    tokenVerifier: async ({ idToken }) => (idToken === 'first'
      ? googlePayload({ sub: 'g-1', email: 'shared@example.com' })
      : googlePayload({ sub: 'g-2', email: 'shared@example.com' })),
  });
  t.after(() => runtime.db.close());

  const first = await guest(runtime);
  const firstNonce = await issueNonce(runtime, first.token);
  const firstLink = await link(runtime, first.token, { idToken: 'first', nonce: firstNonce.nonce });
  assert.equal(firstLink.status, 200);

  const secondGuest = await guest(runtime);
  const secondNonce = await issueNonce(runtime, secondGuest.token);
  const conflict = await link(runtime, secondGuest.token, { idToken: 'second', nonce: secondNonce.nonce });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, 'EMAIL_ALREADY_LINKED');

  const row = runtime.db.prepare('SELECT google_id, email FROM users WHERE id = ?').get(secondGuest.user.id);
  assert.equal(row.google_id, null);
  assert.equal(row.email, null);
});
