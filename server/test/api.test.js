const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { io: createClient } = require('socket.io-client');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDatabase } = require('../database');
const { createRuntime } = require('../app');

function config() {
  return {
    nodeEnv: 'test',
    jwtSecret: 'test-secret-at-least-local',
    jwtExpiresIn: '1h',
    databasePath: ':memory:',
    corsOrigins: ['http://localhost'],
    paystackSecretKey: '',
    publicAppUrl: 'http://localhost',
  };
}

function createTestRuntime() {
  return createRuntime({ config: config(), database: createDatabase(':memory:'), startTimers: false });
}

async function guest(runtime) {
  const response = await request(runtime.app).post('/api/auth/guest').send({});
  assert.equal(response.status, 201);
  return response.body;
}

test('protected profile requires a signed session and ignores client UUID identity', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  assert.equal((await request(runtime.app).get('/api/me')).status, 401);
  const first = await guest(runtime);
  const second = await guest(runtime);
  const profile = await request(runtime.app).get('/api/me').set('Authorization', `Bearer ${first.token}`);
  assert.equal(profile.status, 200);
  assert.equal(profile.body.id, first.user.id);
  assert.notEqual(profile.body.id, second.user.id);
  assert.equal(profile.body.tokens, undefined);
});

test('legacy fake deposit and UUID mutation endpoints no longer exist', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const session = await guest(runtime);
  const auth = { Authorization: `Bearer ${session.token}` };
  assert.equal((await request(runtime.app).post('/api/economy/deposit').set(auth).send({ amount_ngn: 5_000_000, uuid: 'victim' })).status, 404);
  assert.equal((await request(runtime.app).post('/api/economy/exchange').set(auth).send({ tokens: 1_000_000, uuid: 'victim' })).status, 404);
  const me = await request(runtime.app).get('/api/me').set(auth);
  assert.equal(me.body.coins, 0);
  assert.equal(me.body.gems, 100);
});

test('payment initialization fails closed without Paystack credentials', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const session = await guest(runtime);
  const response = await request(runtime.app)
    .post('/api/economy/payments')
    .set('Authorization', `Bearer ${session.token}`)
    .send({ packageId: 'gems_120' });
  assert.equal(response.status, 503);
});

test('Socket.IO rejects unauthenticated clients and accepts signed sessions', async (t) => {
  const runtime = createTestRuntime();
  await new Promise((resolve) => runtime.server.listen(0, resolve));
  t.after(async () => {
    await new Promise((resolve) => runtime.io.close(resolve));
    await new Promise((resolve) => runtime.server.close(resolve));
    runtime.db.close();
  });
  const session = await guest(runtime);
  const url = `http://127.0.0.1:${runtime.server.address().port}`;

  const unauthenticated = createClient(url, { transports: ['websocket'], reconnection: false });
  const authError = await new Promise((resolve) => unauthenticated.on('connect_error', resolve));
  assert.match(authError.message, /Authentication required/);
  unauthenticated.close();

  const authenticated = createClient(url, { transports: ['websocket'], reconnection: false, auth: { token: session.token } });
  await new Promise((resolve, reject) => {
    authenticated.on('connect', resolve);
    authenticated.on('connect_error', reject);
  });
  assert.equal(authenticated.connected, true);
  authenticated.close();
});

test('serves the built SPA without masking unknown API routes', async (t) => {
  const staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-tac-static-'));
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>Tic-Tac test</title>');
  const runtimeConfig = config();
  runtimeConfig.staticDir = staticDir;
  const runtime = createRuntime({ config: runtimeConfig, database: createDatabase(':memory:'), startTimers: false });
  t.after(() => {
    runtime.db.close();
    fs.rmSync(staticDir, { recursive: true, force: true });
  });

  const page = await request(runtime.app).get('/play/room');
  assert.equal(page.status, 200);
  assert.match(page.text, /Tic-Tac test/);
  assert.equal((await request(runtime.app).get('/api/does-not-exist')).status, 404);
});

test('POST /api/auth/logout without a token returns 401', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const response = await request(runtime.app).post('/api/auth/logout').send({});
  assert.equal(response.status, 401);
  assert.equal(response.body.error, 'Authentication required');
});

test('POST /api/auth/logout with a valid session returns { success: true }', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const session = await guest(runtime);
  const auth = { Authorization: `Bearer ${session.token}` };
  const response = await request(runtime.app).post('/api/auth/logout').set(auth).send({});
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { success: true });
});

test('logout revokes the session server-side: the same token fails GET /api/me afterwards', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const session = await guest(runtime);
  const auth = { Authorization: `Bearer ${session.token}` };
  assert.equal((await request(runtime.app).get('/api/me').set(auth)).status, 200);
  assert.equal((await request(runtime.app).post('/api/auth/logout').set(auth).send({})).status, 200);
  const after = await request(runtime.app).get('/api/me').set(auth);
  assert.equal(after.status, 401);
});

test('POST /api/auth/logout with an already-revoked token returns 401', async (t) => {
  const runtime = createTestRuntime();
  t.after(() => runtime.db.close());
  const session = await guest(runtime);
  const auth = { Authorization: `Bearer ${session.token}` };
  assert.equal((await request(runtime.app).post('/api/auth/logout').set(auth).send({})).status, 200);
  const second = await request(runtime.app).post('/api/auth/logout').set(auth).send({});
  assert.equal(second.status, 401);
});
