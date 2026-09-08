const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { io: createClient } = require('socket.io-client');
const { createDatabase } = require('../database');
const { createRuntime } = require('../app');

const testConfig = {
  nodeEnv: 'test',
  jwtSecret: 'room-chat-test-secret',
  jwtExpiresIn: '1h',
  databasePath: ':memory:',
  corsOrigins: ['http://localhost'],
  paystackSecretKey: '',
  publicAppUrl: 'http://localhost',
};

function emitAckWithin(socket, event, payload, timeout = 1_000) {
  return new Promise((resolve, reject) => {
    socket.timeout(timeout).emit(event, payload, (error, response) => {
      if (error) reject(error);
      else resolve(response);
    });
  });
}

async function newSession(runtime) {
  return (await request(runtime.app).post('/api/auth/guest')).body;
}

// Boot a runtime on an ephemeral port and return `clients` connected
// authenticated sockets (plus their guest sessions).
async function boot(t, { config = {}, clients = 1 } = {}) {
  const runtime = createRuntime({
    config: { ...testConfig, ...config },
    database: createDatabase(':memory:'),
    startTimers: false,
  });
  await new Promise((resolve) => runtime.server.listen(0, resolve));
  const url = `http://127.0.0.1:${runtime.server.address().port}`;
  const sessions = [];
  while (sessions.length < clients) sessions.push(await newSession(runtime));
  const sockets = sessions.map((session) => createClient(url, {
    auth: { token: session.token },
    transports: ['websocket'],
    reconnection: false,
  }));
  await Promise.all(sockets.map((socket) => new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
  })));
  t.after(async () => {
    sockets.forEach((socket) => socket.close());
    await new Promise((resolve) => runtime.io.close(resolve));
    await new Promise((resolve) => runtime.server.close(resolve));
    runtime.db.close();
  });
  return { runtime, sessions, sockets };
}

function nextChat(socket) {
  return new Promise((resolve) => socket.once('chat_message', resolve));
}

function expectNoChat(socket, waitMs = 150) {
  return new Promise((resolve, reject) => {
    socket.once('chat_message', () => reject(new Error('unexpected chat_message was broadcast')));
    setTimeout(resolve, waitMs);
  });
}

test('chat_message from a room member acks ok and broadcasts to every member', async (t) => {
  const { sessions, sockets } = await boot(t, { clients: 2 });
  const [first, second] = sessions;
  const [a, b] = sockets;
  const created = await emitAckWithin(a, 'create_room', { roomId: 'ROOM_CHAT', config: { size: 3, rounds: 1 } });
  assert.equal(created.error, undefined);
  await emitAckWithin(b, 'join_room', { roomId: 'ROOM_CHAT' });

  const messageA = nextChat(a);
  const messageB = nextChat(b);
  const ack = await emitAckWithin(a, 'chat_message', { roomId: 'ROOM_CHAT', text: '  gg wp  ' });
  assert.equal(ack.ok, true);
  assert.equal(typeof ack.id, 'string');

  const [msgA, msgB] = await Promise.all([messageA, messageB]);
  assert.equal(msgA.roomId, 'ROOM_CHAT');
  assert.equal(msgA.id, ack.id);
  assert.equal(msgA.userId, first.user.id);
  assert.equal(msgA.username, first.user.username);
  assert.equal(msgA.avatar, first.user.avatar);
  assert.equal(msgA.text, 'gg wp'); // trimmed
  assert.equal(typeof msgA.at, 'number');
  assert.deepEqual(msgB, msgA);
  assert.equal(second.user.id === msgB.userId, false);
});

test('chat_message from a non-member is rejected and never broadcast', async (t) => {
  const { sockets } = await boot(t, { clients: 3 });
  const [a, b, outsider] = sockets;
  await emitAckWithin(a, 'create_room', { roomId: 'ROOM_CHAT', config: { size: 3, rounds: 1 } });
  await emitAckWithin(b, 'join_room', { roomId: 'ROOM_CHAT' });

  const quietA = expectNoChat(a);
  const quietB = expectNoChat(b);
  const denied = await emitAckWithin(outsider, 'chat_message', { roomId: 'ROOM_CHAT', text: 'sneaky' });
  assert.equal(denied.error, 'Player is not in this room');
  assert.equal(denied.code, 'NOT_ROOM_MEMBER');
  await Promise.all([quietA, quietB]);
});

test('chat_message validates text: empty, oversize, and non-string payloads', async (t) => {
  const { sockets } = await boot(t, { clients: 1 });
  const [a] = sockets;
  await emitAckWithin(a, 'create_room', { roomId: 'ROOM_CHAT', config: { size: 3, rounds: 1 } });

  const empty = await emitAckWithin(a, 'chat_message', { roomId: 'ROOM_CHAT', text: '' });
  assert.equal(empty.code, 'CHAT_EMPTY');
  assert.equal(empty.error, 'Message cannot be empty');

  const whitespace = await emitAckWithin(a, 'chat_message', { roomId: 'ROOM_CHAT', text: '   ' });
  assert.equal(whitespace.code, 'CHAT_EMPTY');

  const tooLong = await emitAckWithin(a, 'chat_message', { roomId: 'ROOM_CHAT', text: 'x'.repeat(241) });
  assert.equal(tooLong.code, 'CHAT_TOO_LONG');
  assert.equal(tooLong.error, 'Message is too long (max 240 characters)');

  const boundary = await emitAckWithin(a, 'chat_message', { roomId: 'ROOM_CHAT', text: 'x'.repeat(240) });
  assert.equal(boundary.ok, true);

  const nonString = await emitAckWithin(a, 'chat_message', { roomId: 'ROOM_CHAT', text: 42 });
  assert.equal(nonString.code, 'CHAT_INVALID');
  assert.equal(nonString.error, 'Invalid chat message');

  const missing = await emitAckWithin(a, 'chat_message', { roomId: 'ROOM_CHAT' });
  assert.equal(missing.code, 'CHAT_INVALID');
});

test('chat_message to an unknown or missing room acks ROOM_NOT_FOUND', async (t) => {
  const { sockets } = await boot(t, { clients: 1 });
  const [a] = sockets;

  const ghost = await emitAckWithin(a, 'chat_message', { roomId: 'ROOM_GHOST', text: 'anyone there?' });
  assert.equal(ghost.error, 'Room not found');
  assert.equal(ghost.code, 'ROOM_NOT_FOUND');

  const noRoom = await emitAckWithin(a, 'chat_message', { text: 'no room id' });
  assert.equal(noRoom.code, 'ROOM_NOT_FOUND');
});

test('chat rate limit acks CHAT_RATE_LIMITED with retry metadata and stops further sends', async (t) => {
  const { sockets } = await boot(t, { config: { chatRateLimit: 2, chatRateWindowMs: 60_000 }, clients: 1 });
  const [a] = sockets;
  await emitAckWithin(a, 'create_room', { roomId: 'ROOM_CHAT', config: { size: 3, rounds: 1 } });

  assert.equal((await emitAckWithin(a, 'chat_message', { roomId: 'ROOM_CHAT', text: 'one' })).ok, true);
  assert.equal((await emitAckWithin(a, 'chat_message', { roomId: 'ROOM_CHAT', text: 'two' })).ok, true);

  const limited = await emitAckWithin(a, 'chat_message', { roomId: 'ROOM_CHAT', text: 'three' });
  assert.equal(limited.code, 'CHAT_RATE_LIMITED');
  assert.equal(limited.error, 'You are chatting too quickly. Try again shortly.');
  assert.equal(Number.isSafeInteger(limited.retryAfterMs), true);
  assert.equal(limited.retryAfterMs > 0, true);

  const stillLimited = await emitAckWithin(a, 'chat_message', { roomId: 'ROOM_CHAT', text: 'four' });
  assert.equal(stillLimited.code, 'CHAT_RATE_LIMITED');
});

test('chat never consumes the room action limiter budget', async (t) => {
  const { sockets } = await boot(t, {
    config: { roomActionRateLimit: 1, roomActionRateWindowMs: 60_000 },
    clients: 2,
  });
  const [a, b] = sockets;
  // create_room spends the single room-action allowance for a.
  await emitAckWithin(a, 'create_room', { roomId: 'ROOM_CHAT', config: { size: 3, rounds: 1 } });
  await emitAckWithin(b, 'join_room', { roomId: 'ROOM_CHAT' });

  // Chatting repeatedly must neither require nor spend room-action budget.
  assert.equal((await emitAckWithin(a, 'chat_message', { roomId: 'ROOM_CHAT', text: 'one' })).ok, true);
  assert.equal((await emitAckWithin(a, 'chat_message', { roomId: 'ROOM_CHAT', text: 'two' })).ok, true);
  assert.equal((await emitAckWithin(a, 'chat_message', { roomId: 'ROOM_CHAT', text: 'three' })).ok, true);

  // a's room-action allowance is still exhausted (chats did not touch it).
  const blocked = await emitAckWithin(a, 'resume_room', { roomId: 'ROOM_CHAT' });
  assert.equal(blocked.code, 'RATE_LIMITED');
});

test('leave_room is never rate-limited by the chat limiter', async (t) => {
  const { sockets } = await boot(t, { config: { chatRateLimit: 1, chatRateWindowMs: 60_000 }, clients: 2 });
  const [a, b] = sockets;
  await emitAckWithin(a, 'create_room', { roomId: 'ROOM_CHAT', config: { size: 3, rounds: 3 } });
  await emitAckWithin(b, 'join_room', { roomId: 'ROOM_CHAT' });

  const ok = await emitAckWithin(a, 'chat_message', { roomId: 'ROOM_CHAT', text: 'only one allowed' });
  assert.equal(ok.ok, true);
  const limited = await emitAckWithin(a, 'chat_message', { roomId: 'ROOM_CHAT', text: 'blocked now' });
  assert.equal(limited.code, 'CHAT_RATE_LIMITED');

  const left = await emitAckWithin(a, 'leave_room', { roomId: 'ROOM_CHAT' });
  assert.equal(left.error, undefined);
  assert.equal(left.room.state.status, 'complete');
  assert.equal(left.room.state.completionReason, 'voluntary_forfeit');
});
