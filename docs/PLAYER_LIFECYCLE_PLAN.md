# Noughtline Multiplayer Lifecycle — Phase 2 Plan

## Goal

Make entering and leaving multiplayer deterministic, enforce one nonterminal room per authenticated player, and give clients stable errors and bounded room-action rates without weakening server authority.

## Included

- Explicit `leave_room` Socket.IO action.
- Waiting-room departure that removes the sole player and deletes the empty room.
- Active/paused/round-complete departure treated as a one-time voluntary forfeit when an opponent exists.
- Terminal-room acknowledgement that releases the client without rewriting a settled result.
- One-active-room enforcement across private room creation, invite joining, and ranked matchmaking.
- Queue cleanup whenever a player creates, joins, resumes, leaves, or disconnects.
- Stable machine-readable error codes alongside human-readable messages.
- Per-user room-lifecycle rate limiting for create/join/resume/matchmaking actions. Explicit leave remains available so throttling cannot trap a player in a room.
- Confirmation UI for leaving a live multiplayer match, with accurate waiting-room versus forfeit copy.
- State-machine, Socket.IO, client helper, and two-browser regression coverage.
- An execution-ready shared-state migration design for Redis/PostgreSQL and multi-instance Socket.IO.

## Excluded

- Deploying Redis or PostgreSQL.
- Horizontal multi-instance operation.
- Friends, chat, spectators, notifications, or ranked-rating changes.
- Remote push, pull request, or production deployment.

Redis is deliberately not implemented as a superficial cache. The current `RoomManager` performs synchronous in-process read-modify-write operations over Maps, Sets, callbacks, and socket IDs. Correct horizontal operation requires atomic async room mutations, distributed locking or compare-and-swap, Socket.IO pub/sub, durable timer ownership, and idempotent settlement. That migration is its own infrastructure phase.

## Product rules

1. A user may have at most one room whose status is `waiting`, `active`, `paused`, or `round_complete`.
2. Resuming the same room is allowed and rotates socket authority.
3. Creating or joining a different nonterminal room returns `ACTIVE_ROOM_EXISTS` with the existing room ID.
4. Entering matchmaking while in a nonterminal room is rejected.
5. Joining or creating a room removes the user from matchmaking first.
6. Leaving a one-player waiting room deletes it without recording a result or reward.
7. Leaving a two-player nonterminal room forfeits exactly once to the opponent and records `voluntary_forfeit`.
8. Leaving a complete or cancelled room only acknowledges departure; it does not settle again.
9. Private matches remain reward-ineligible. Ranked forfeits follow existing server-side settlement rules.
10. Every lifecycle rejection has a stable `code` and human-readable `error` string.
11. Rate limits are keyed by authenticated user ID, not socket ID, so reconnecting cannot reset the budget. `leave_room` is authority-checked but never rate-limited.

## Server design

### Stable failures

Room operations return:

```json
{ "error": "A human-readable message", "code": "ROOM_NOT_FOUND" }
```

Initial lifecycle codes:

- `INVALID_ROOM_ID`
- `ROOM_EXISTS`
- `ROOM_NOT_FOUND`
- `ROOM_FULL`
- `AUTH_REQUIRED`
- `ACTIVE_ROOM_EXISTS`
- `NOT_ROOM_MEMBER`
- `GAME_NOT_ACTIVE`
- `INVALID_MOVE`
- `NOT_YOUR_TURN`
- `CELL_OCCUPIED`
- `RATE_LIMITED`
- `ACTION_FAILED`

Acknowledgements preserve `error` for compatibility and add `code` plus structured context such as `roomId` when useful.

### Active membership

`RoomManager.findActiveRoomForUser(userId, { excludingRoomId })` scans nonterminal room memberships. `joinRoom` enforces this centrally before adding a new membership. `create_room` and `find_match` preflight before creating orphan rooms or queue entries.

### Leaving

`RoomManager.leaveRoom(roomId, userId, socketId)` verifies current socket authority and then:

- one-player waiting room: removes/deletes room and returns `{ deleted: true }`;
- two-player nonterminal room: settles a one-time `voluntary_forfeit` for the opponent;
- complete/cancelled room: returns the unchanged public room with `acknowledged: true`;
- non-member or stale socket: rejects without mutation.

The Socket.IO handler leaves the socket room, broadcasts the final state when one exists, and returns an acknowledgement.

### Rate limiting

A small in-memory per-user fixed-window limiter protects lifecycle operations independently of the existing HTTP limiter. Production configuration controls the window and limit. The limiter returns `RATE_LIMITED` and `retryAfterMs`; it does not silently drop actions.

This reduces single-instance abuse but is not a distributed control. The shared-state phase moves counters to Redis.

## Client design

- Back from a multiplayer game opens a confirmation dialog.
- Waiting-room copy: “Leave this room? The invite will stop working.”
- Live/paused/round-complete copy: “Forfeit this match? Your opponent will win the series.”
- Complete/cancelled rooms leave immediately without a destructive warning.
- Successful leave clears `noughtline_active_room`, resets room/opponent state, and returns Home.
- `ACTIVE_ROOM_EXISTS` offers Resume and Copy Invite rather than hiding the existing room.
- `RATE_LIMITED` shows a concise retry message.

## Test-first sequence

1. Add failing RoomManager tests for active-room lookup, cross-room rejection, waiting-room deletion, voluntary forfeit, stale-socket rejection, and one-time settlement.
2. Implement the minimum RoomManager lifecycle behavior.
3. Add failing limiter tests and Socket.IO tests for coded errors, queue guards, leave broadcasts, and ranked/private settlement.
4. Implement handlers, queue cleanup, codes, and limiter.
5. Add the leave confirmation client UI and coded error mapping.
6. Extend the dependency-free two-browser harness for leave/forfeit and re-entry into a new room.
7. Run full tests, lint, build, audits, public HTTPS E2E, and desktop/mobile visual QA.
8. Commit locally only after verification.

## Acceptance criteria

- A waiting host can leave and the room can no longer be joined.
- A player in a live match must explicitly confirm leaving and forfeits exactly once.
- The remaining player receives a terminal `voluntary_forfeit` result.
- A player in any nonterminal room cannot create, join, or matchmake into another room.
- After leaving or acknowledging a terminal room, the player can create or join a new room.
- Stale sockets cannot leave or forfeit on behalf of a reconnected player.
- Lifecycle errors include stable codes and existing human-readable errors.
- Repeated lifecycle actions produce a bounded `RATE_LIMITED` response with retry metadata.
- Existing move authority, rewards, private-room gating, reconnect behavior, and invite flows remain green.
- Public two-browser testing verifies waiting-room leave, active forfeit, opponent result, and subsequent new-room entry.

## Independent audit reconciliation

The post-implementation lifecycle and UX audits were reconciled in a follow-up hardening pass:

- terminal acknowledgement revokes socket action authority;
- rematches cannot reactivate a completed room when either participant has joined another nonterminal room;
- settlement callback failures restore the exact preterminal in-memory state so the transactional database operation can be retried safely;
- a forfeit during `round_complete` annotates the completed round instead of inflating `rounds_played`;
- matchmaking removes all queued sockets for a disconnected user, skips dead or ineligible dequeues, and deletes only rooms created by the failed match attempt;
- terminal client messaging uses `seriesWinner`, while round state continues to use `winner`;
- confirmation dialogs initially focus the safe action, trap keyboard focus, support Escape cancellation, and expose `aria-busy` while submitting.

## Shared-state follow-up deliverable

Produce `docs/SHARED_MULTIPLAYER_STATE_PLAN.md` specifying:

- Redis room schema and indexes by user ID;
- atomic mutation strategy and idempotency keys;
- Socket.IO Redis adapter;
- disconnect deadline scheduling and single-owner timeout settlement;
- restart recovery and stale-socket handling;
- PostgreSQL settlement transaction boundary;
- migration, rollback, observability, and failure-mode tests.

## Rollback

The phase is one local commit with no database migration. Roll back with `git revert <commit>`. Existing in-memory rooms disappear on process restart as before; no production state format changes are introduced.
