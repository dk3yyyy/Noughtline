const test = require('node:test');
const assert = require('node:assert/strict');
const { RoomManager } = require('../game/roomManager');

function joinTwo(manager, roomId = 'ROOM_TEST') {
  assert.ok(manager.createRoom(roomId, { size: 3, rounds: 3 }).room);
  assert.ok(manager.joinRoom(roomId, { userId: 1, socketId: 'a', username: 'A' }).room);
  assert.ok(manager.joinRoom(roomId, { userId: 2, socketId: 'b', username: 'B' }).room);
}

function playXWin(manager, roomId = 'ROOM_TEST') {
  assert.ok(manager.makeMove(roomId, 0, 1, 'a').room);
  assert.ok(manager.makeMove(roomId, 3, 2, 'b').room);
  assert.ok(manager.makeMove(roomId, 1, 1, 'a').room);
  assert.ok(manager.makeMove(roomId, 4, 2, 'b').room);
  return manager.makeMove(roomId, 2, 1, 'a');
}

test('rejects invalid and out-of-range moves without mutating board', () => {
  const manager = new RoomManager();
  joinTwo(manager);
  for (const index of [-1, 9, 99, 1.5, '1']) {
    assert.equal(manager.makeMove('ROOM_TEST', index, 1, 'a').error, 'Invalid move index');
  }
  assert.equal(manager.getRoom('ROOM_TEST').state.board.length, 9);
  assert.deepEqual(manager.getRoom('ROOM_TEST').state.board, Array(9).fill(null));
});

test('enforces turns and occupied cells', () => {
  const manager = new RoomManager();
  joinTwo(manager);
  assert.equal(manager.makeMove('ROOM_TEST', 0, 2, 'b').error, 'Not your turn');
  assert.ok(manager.makeMove('ROOM_TEST', 0, 1, 'a').room);
  assert.equal(manager.makeMove('ROOM_TEST', 0, 2, 'b').error, 'Cell is occupied');
});

test('reconnecting replaces the old socket authority', () => {
  const manager = new RoomManager();
  joinTwo(manager);
  const reconnected = manager.joinRoom('ROOM_TEST', { userId: 1, socketId: 'a-new', username: 'A' });
  assert.equal(reconnected.player.socketId, 'a-new');
  assert.equal(manager.makeMove('ROOM_TEST', 0, 1, 'a').error, 'Player is not in this room');
  assert.ok(manager.makeMove('ROOM_TEST', 0, 1, 'a-new').room);
});

test('disconnect grace expires to a one-time forfeit settlement', () => {
  let now = 0;
  const settlements = [];
  const manager = new RoomManager({ now: () => now, onSeriesComplete: (room) => settlements.push(room) });
  joinTwo(manager);
  assert.equal(manager.disconnect('b').room.state.status, 'paused');
  now = 29_999;
  assert.equal(manager.resolveDisconnectTimeouts().length, 0);
  now = 30_000;
  const [resolved] = manager.resolveDisconnectTimeouts();
  assert.equal(resolved.room.state.status, 'complete');
  assert.equal(resolved.room.state.seriesWinner, 'X');
  assert.equal(settlements.length, 1);
  assert.equal(manager.resolveDisconnectTimeouts().length, 0);
  assert.equal(settlements.length, 1);
});

test('plays a best-of-three series and settles exactly once', () => {
  const settlements = [];
  const manager = new RoomManager({ onSeriesComplete: (room, history) => settlements.push({ room, history }) });
  joinTwo(manager);

  const first = playXWin(manager);
  assert.equal(first.room.state.status, 'round_complete');
  assert.equal(first.room.state.score.X, 1);
  assert.equal(manager.readyForNextRound('ROOM_TEST', 1, 'a').waiting, true);
  assert.equal(manager.readyForNextRound('ROOM_TEST', 2, 'b').waiting, false);

  const second = playXWin(manager);
  assert.equal(second.room.state.status, 'complete');
  assert.equal(second.room.state.seriesWinner, 'X');
  assert.equal(settlements.length, 1);
  assert.equal(settlements[0].history.length, 2);
  assert.equal(manager.makeMove('ROOM_TEST', 8, 1, 'a').error, 'Game is not active');
  assert.equal(settlements.length, 1);
});

test('rejects invalid room configuration', () => {
  const manager = new RoomManager();
  assert.equal(manager.createRoom('x', { size: 3, rounds: 3 }).error, 'Invalid room ID');
  assert.equal(manager.createRoom('ROOM_BIG', { size: 100, rounds: 3 }).error, 'Unsupported board size');
  assert.equal(manager.createRoom('ROOM_EVEN', { size: 3, rounds: 10 }).error, 'Rounds must be 1, 3, or 5');
});
