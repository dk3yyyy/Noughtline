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

test('disconnect publishes a server deadline and reconnect restores active state', () => {
  let now = 1_000;
  const manager = new RoomManager({ now: () => now });
  joinTwo(manager);

  const paused = manager.disconnect('b').room;
  assert.equal(paused.state.status, 'paused');
  assert.equal(paused.state.disconnectDeadline, 31_000);

  now = 5_000;
  const resumed = manager.joinRoom('ROOM_TEST', { userId: 2, socketId: 'b-new', username: 'B' }).room;
  assert.equal(resumed.state.status, 'active');
  assert.equal(resumed.state.disconnectDeadline, null);
});

test('room stays paused when only one of two disconnected players reconnects', () => {
  let now = 0;
  const manager = new RoomManager({ now: () => now });
  joinTwo(manager);
  manager.disconnect('a');
  now = 5_000;
  manager.disconnect('b');

  now = 10_000;
  const resumed = manager.joinRoom('ROOM_TEST', { userId: 1, socketId: 'a-new', username: 'A' }).room;
  assert.equal(resumed.state.status, 'paused');
  assert.equal(resumed.state.disconnectDeadline, 35_000);
});

test('reconnect restores waiting and round-complete states exactly', () => {
  const waitingManager = new RoomManager();
  waitingManager.createRoom('ROOM_WAITING', { size: 3, rounds: 3 });
  waitingManager.joinRoom('ROOM_WAITING', { userId: 1, socketId: 'host', username: 'Host' });
  waitingManager.disconnect('host');
  const waiting = waitingManager.joinRoom('ROOM_WAITING', { userId: 1, socketId: 'host-new', username: 'Host' }).room;
  assert.equal(waiting.state.status, 'waiting');

  const roundManager = new RoomManager();
  joinTwo(roundManager);
  assert.equal(playXWin(roundManager).room.state.status, 'round_complete');
  roundManager.disconnect('b');
  const roundComplete = roundManager.joinRoom('ROOM_TEST', { userId: 2, socketId: 'b-new', username: 'B' }).room;
  assert.equal(roundComplete.state.status, 'round_complete');
});

test('resume room only reconnects an existing authenticated member', () => {
  const manager = new RoomManager();
  joinTwo(manager);
  manager.disconnect('a');

  assert.equal(manager.resumeRoom('ROOM_TEST', { userId: 99, socketId: 'intruder', username: 'Nope' }).error, 'No active room to resume');
  const resumed = manager.resumeRoom('ROOM_TEST', { userId: 1, socketId: 'a-new', username: 'A' });
  assert.equal(resumed.player.socketId, 'a-new');
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
  assert.equal(resolved.room.state.completionReason, 'disconnect_forfeit');
  assert.equal(resolved.room.state.disconnectDeadline, null);
  assert.equal(settlements.length, 1);
  assert.equal(manager.resolveDisconnectTimeouts().length, 0);
  assert.equal(settlements.length, 1);
});

test('both disconnected players produce a recoverable cancellation without settlement', () => {
  let now = 0;
  const settlements = [];
  const manager = new RoomManager({ now: () => now, onSeriesComplete: (room) => settlements.push(room) });
  joinTwo(manager);
  manager.disconnect('a');
  manager.disconnect('b');

  now = 30_000;
  const [resolved] = manager.resolveDisconnectTimeouts();
  assert.equal(resolved.room.state.status, 'cancelled');
  assert.equal(resolved.room.state.completionReason, 'match_cancelled');
  assert.equal(resolved.room.state.disconnectDeadline, null);
  assert.equal(settlements.length, 0);

  const resumed = manager.resumeRoom('ROOM_TEST', { userId: 1, socketId: 'a-new', username: 'A' });
  assert.equal(resumed.room.state.status, 'cancelled');
  assert.equal(manager.makeMove('ROOM_TEST', 0, 1, 'a-new').error, 'Game is not active');
});

test('disconnectAll updates every room associated with a socket', () => {
  const manager = new RoomManager();
  joinTwo(manager, 'ROOM_FIRST');
  manager.createRoom('ROOM_SECOND', { size: 3, rounds: 3 });
  manager.joinRoom('ROOM_SECOND', { userId: 3, socketId: 'c', username: 'C' });
  const legacyRoom = manager.getRoom('ROOM_SECOND');
  legacyRoom.players.push({ id: 1, socketId: 'a', username: 'A', symbol: 'O', connected: true });
  manager.syncConnectionState(legacyRoom, { secondPlayerJoined: true });

  const results = manager.disconnectAll('a');
  assert.equal(results.length, 2);
  assert.equal(manager.getRoom('ROOM_FIRST').players.find((player) => player.id === 1).connected, false);
  assert.equal(manager.getRoom('ROOM_SECOND').players.find((player) => player.id === 1).connected, false);
});

test('finds active membership and rejects joining a different nonterminal room', () => {
  const manager = new RoomManager();
  manager.createRoom('ROOM_FIRST', { size: 3, rounds: 3 });
  manager.joinRoom('ROOM_FIRST', { userId: 1, socketId: 'a', username: 'A' });
  manager.createRoom('ROOM_SECOND', { size: 3, rounds: 3 });

  assert.equal(manager.findActiveRoomForUser(1).id, 'ROOM_FIRST');
  const rejected = manager.joinRoom('ROOM_SECOND', { userId: 1, socketId: 'a', username: 'A' });
  assert.equal(rejected.code, 'ACTIVE_ROOM_EXISTS');
  assert.equal(rejected.roomId, 'ROOM_FIRST');
  assert.equal(manager.getRoom('ROOM_SECOND').players.length, 0);
});

test('leaving a one-player waiting room deletes it without settlement', () => {
  const settlements = [];
  const manager = new RoomManager({ onSeriesComplete: (...args) => settlements.push(args) });
  manager.createRoom('ROOM_WAIT', { size: 3, rounds: 3 });
  manager.joinRoom('ROOM_WAIT', { userId: 1, socketId: 'a', username: 'A' });

  const result = manager.leaveRoom('ROOM_WAIT', 1, 'a');
  assert.equal(result.deleted, true);
  assert.equal(result.roomId, 'ROOM_WAIT');
  assert.equal(manager.getRoom('ROOM_WAIT'), undefined);
  assert.equal(settlements.length, 0);
});

test('leaving a live room forfeits exactly once to the opponent', () => {
  const settlements = [];
  const manager = new RoomManager({ onSeriesComplete: (room, history) => settlements.push({ room, history }) });
  joinTwo(manager);

  const result = manager.leaveRoom('ROOM_TEST', 1, 'a');
  assert.equal(result.room.state.status, 'complete');
  assert.equal(result.room.state.seriesWinner, 'O');
  assert.equal(result.room.state.completionReason, 'voluntary_forfeit');
  assert.equal(result.room.state.score.O, 1);
  assert.equal(settlements.length, 1);
  assert.equal(settlements[0].history.at(-1).reason, 'voluntary_forfeit');

  const repeated = manager.leaveRoom('ROOM_TEST', 1, 'a');
  assert.equal(repeated.code, 'NOT_ROOM_MEMBER');
  assert.equal(settlements.length, 1);
});

test('stale sockets cannot leave after reconnect rotates authority', () => {
  const manager = new RoomManager();
  joinTwo(manager);
  manager.joinRoom('ROOM_TEST', { userId: 1, socketId: 'a-new', username: 'A' });

  const rejected = manager.leaveRoom('ROOM_TEST', 1, 'a');
  assert.equal(rejected.code, 'NOT_ROOM_MEMBER');
  assert.equal(manager.getRoom('ROOM_TEST').state.status, 'active');
});

test('leaving a terminal room only acknowledges it and permits a new room', () => {
  const settlements = [];
  const manager = new RoomManager({ onSeriesComplete: (room) => settlements.push(room) });
  manager.createRoom('ROOM_TEST', { size: 3, rounds: 1 });
  manager.joinRoom('ROOM_TEST', { userId: 1, socketId: 'a', username: 'A' });
  manager.joinRoom('ROOM_TEST', { userId: 2, socketId: 'b', username: 'B' });
  playXWin(manager);

  const acknowledged = manager.leaveRoom('ROOM_TEST', 1, 'a');
  assert.equal(acknowledged.acknowledged, true);
  assert.equal(acknowledged.room.state.status, 'complete');
  assert.equal(settlements.length, 1);

  manager.createRoom('ROOM_NEW', { size: 3, rounds: 3 });
  const joined = manager.joinRoom('ROOM_NEW', { userId: 1, socketId: 'a', username: 'A' });
  assert.equal(joined.room.id, 'ROOM_NEW');
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
