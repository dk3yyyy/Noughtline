import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVE_ROOM_MAX_AGE_MS,
  clearActiveRoom,
  createInviteUrl,
  getInviteRoomId,
  normalizeRoomId,
  readActiveRoom,
  saveActiveRoom,
} from '../src/services/rooms.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test('normalizes room codes and invite URLs without accepting invalid input', () => {
  assert.equal(normalizeRoomId(' room_ab12 '), 'ROOM_AB12');
  assert.equal(normalizeRoomId('https://noughtline.example/join/room_ab12'), 'ROOM_AB12');
  assert.equal(normalizeRoomId('bad code!'), null);
  assert.equal(normalizeRoomId('x'), null);
});

test('parses and creates encoded invite paths', () => {
  assert.equal(getInviteRoomId('/join/room_ab12'), 'ROOM_AB12');
  assert.equal(getInviteRoomId('/JOIN/ROOM_AB12/'), 'ROOM_AB12');
  assert.equal(getInviteRoomId('/shop'), null);
  assert.equal(createInviteUrl('room_ab12', 'https://noughtline.example'), 'https://noughtline.example/join/ROOM_AB12');
});

test('persists, refreshes, expires, and clears active rooms', () => {
  const storage = memoryStorage();
  saveActiveRoom(storage, 'room_ab12', 1_000);
  assert.deepEqual(readActiveRoom(storage, 1_000), { roomId: 'ROOM_AB12', savedAt: 1_000 });
  assert.equal(readActiveRoom(storage, 1_000 + ACTIVE_ROOM_MAX_AGE_MS + 1), null);

  saveActiveRoom(storage, 'ROOM_ZZ99', 5_000);
  clearActiveRoom(storage);
  assert.equal(readActiveRoom(storage, 5_000), null);
});

test('discards malformed persisted room data', () => {
  const storage = memoryStorage();
  storage.setItem('noughtline_active_room', '{not-json');
  assert.equal(readActiveRoom(storage, 1_000), null);
  storage.setItem('noughtline_active_room', JSON.stringify({ roomId: 'bad code', savedAt: 1_000 }));
  assert.equal(readActiveRoom(storage, 1_000), null);
});
