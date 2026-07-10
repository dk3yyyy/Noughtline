# Noughtline Shared Multiplayer State Migration Plan

## Objective

Move authoritative room state, membership indexes, lifecycle rate limits, disconnect deadlines, and cross-instance Socket.IO broadcasts out of a single Node process without allowing duplicate moves, duplicate forfeits, split-brain rooms, or duplicate rewards.

This is an infrastructure migration, not a cache addition. Redis becomes the realtime coordination store; PostgreSQL remains the durable system of record for accounts, series results, and the currency ledger.

## Current constraints

The current `RoomManager` is synchronous and process-owned:

- rooms are mutable JavaScript objects in a `Map`;
- readiness collections use `Set`;
- moves and lifecycle changes are direct read-modify-write operations;
- disconnect timers are scanned by every application process;
- settlement is invoked synchronously through a callback into SQLite;
- socket IDs and room broadcasts are local to one Socket.IO server.

Serializing the Map to Redis after each mutation would still lose concurrent updates. Horizontal safety requires atomic mutation ownership and idempotent durable settlement.

## Target architecture

### Components

1. **Socket/API nodes**
   - Authenticate clients.
   - Validate payload shape.
   - Execute atomic room commands through the shared room repository.
   - Join sockets to Socket.IO rooms.
   - Publish room snapshots through the Socket.IO Redis adapter.

2. **Redis**
   - Authoritative nonterminal room state.
   - User-to-active-room uniqueness index.
   - Disconnect-deadline sorted set.
   - Per-user action limits.
   - Settlement command stream and short-lived idempotency records.
   - Socket.IO pub/sub adapter channels.

3. **Lifecycle worker**
   - Claims expired disconnect deadlines with a lease.
   - Executes the same atomic room command used by live nodes.
   - Publishes resulting room updates.
   - Enqueues settlement exactly once.

4. **PostgreSQL**
   - Durable users, inventory, results, payment intents, and currency ledger.
   - Unique constraints on `series_results.id` and ledger idempotency references.
   - Transactional outbox for post-settlement events when notifications are added.

## Redis key model

Use a deployment prefix and environment name, for example `noughtline:prod`.

| Key | Type | Purpose |
|---|---|---|
| `noughtline:prod:room:{roomId}` | JSON/string | Versioned room document |
| `noughtline:prod:user-room:{userId}` | string | One nonterminal room per user |
| `noughtline:prod:disconnect-deadlines` | sorted set | Room IDs scored by next epoch deadline |
| `noughtline:prod:room-action:{userId}` | string/hash | Distributed fixed-window or token-bucket limit |
| `noughtline:prod:settlements` | stream | One settlement command per completed series |
| `noughtline:prod:settlement:{seriesId}` | string | Short-lived enqueue/idempotency marker |
| `noughtline:prod:deadline-lease:{roomId}` | string | Worker ownership with short TTL |

### Room document

Store JSON with only serializable values. Convert Sets to arrays.

```json
{
  "schemaVersion": 1,
  "version": 17,
  "id": "ROOM_AB12CD34",
  "seriesId": "uuid",
  "config": { "size": 3, "rounds": 3 },
  "players": [
    {
      "id": 41,
      "username": "Guest_123456",
      "avatar": "https://…",
      "symbol": "X",
      "socketId": "ephemeral-socket-id",
      "connected": true,
      "disconnectedAt": null
    }
  ],
  "state": {
    "board": [null, null, null, null, null, null, null, null, null],
    "isXNext": true,
    "winner": null,
    "winningLine": [],
    "status": "waiting",
    "round": 1,
    "score": { "X": 0, "O": 0 },
    "seriesWinner": null,
    "disconnectDeadline": null,
    "completionReason": null
  },
  "roundHistory": [],
  "nextRoundReady": [],
  "rematchReady": [],
  "resumeStatus": null,
  "rewardEligible": false,
  "settlementEnqueued": false,
  "createdAt": 0,
  "updatedAt": 0,
  "expiresAt": 0
}
```

Do not treat socket IDs as identity. They are current transport authority only; every command is also bound to the authenticated user ID.

## Atomic command model

Replace direct `RoomManager` mutations with an async command interface:

```js
await roomRepository.execute({
  roomId,
  userId,
  socketId,
  command: 'make_move',
  payload: { index },
  idempotencyKey,
});
```

Commands include:

- `create_room`
- `join_room`
- `resume_room`
- `leave_room`
- `disconnect_socket`
- `make_move`
- `ready_next_round`
- `request_rematch`
- `resolve_disconnect_timeout`

Each command must atomically:

1. Load the room and relevant user-room index.
2. Validate membership, current socket authority, status, turn, and command payload.
3. Apply exactly one state transition.
4. Increment `version`.
5. Update membership indexes and deadline sorted-set entries.
6. Mark a newly completed series for settlement once.
7. Return the new public snapshot and side-effect intents.

### Implementation options

**Recommended initial implementation:** Redis Lua scripts over JSON strings and indexes. The script verifies the expected room version and performs the mutation/index updates atomically.

Alternative: RedisJSON with Lua/functions, if the deployed Redis service supports and operationally guarantees the module.

Do not use an unlocked `GET → mutate in Node → SET`. Optimistic `WATCH/MULTI/EXEC` is acceptable only with bounded retries and command-level idempotency, but Lua provides a simpler first correctness boundary.

## One-active-room enforcement

Creation and joining must update `user-room:{userId}` in the same atomic script as room membership.

- If the index points to another nonterminal room, return `ACTIVE_ROOM_EXISTS` and its room ID.
- If the indexed room is missing or terminal, repair the stale index inside the command.
- On waiting-room deletion, terminal acknowledgement, or expiry, conditionally delete the index only when its value still matches that room.
- Never perform index cleanup as an unguarded separate command.

## Socket.IO multi-instance transport

Use `@socket.io/redis-adapter` with separate Redis publisher and subscriber connections.

- All application nodes join local sockets to logical room IDs.
- `io.to(roomId).emit()` fans out through Redis pub/sub.
- Connection-state recovery remains application-level; the Socket.IO adapter does not replace authenticated `resume_room`.
- Configure sticky sessions only if polling transport remains enabled. Pure WebSocket deployments reduce that requirement but should not be assumed without proxy verification.
- Include node ID and room version in structured logs to diagnose stale broadcasts.

Broadcasts are notifications, not authority. Clients accept snapshots, while every mutation still returns to Redis for validation.

## Disconnect deadlines and worker ownership

Maintain `disconnect-deadlines` as a sorted set scored by the earliest room deadline.

A worker loop:

1. Reads due room IDs in small batches.
2. Acquires `deadline-lease:{roomId}` using `SET NX PX`.
3. Executes `resolve_disconnect_timeout` atomically.
4. Removes or updates the sorted-set entry based on the resulting state.
5. Publishes the returned snapshot.
6. Releases the lease only if its random lease token still matches.

The room command rechecks the deadline and current connection state. Therefore, duplicate workers or a worker resumed after lease expiry cannot incorrectly forfeit a reconnected player.

Use Redis server time inside Lua where practical, avoiding clock disagreement between nodes.

## Idempotent settlement

Room completion and durable rewards cross Redis/PostgreSQL, so a single database transaction cannot cover both directly.

### Redis side

The atomic completion command changes `settlementEnqueued` from `false` to `true` and appends one stream entry containing:

- `seriesId`
- `roomId`
- final public room snapshot
- immutable round history
- completion reason
- room version

### Settlement worker

Consume through a Redis Stream consumer group. In one PostgreSQL transaction:

1. Insert `series_results` using `seriesId` as a unique key.
2. If the insert conflicts, treat the command as already settled.
3. Apply wins/losses/draws and XP only when the result insert was new.
4. Insert currency-ledger entries with unique references such as `series:{seriesId}:{userId}:coins`.
5. Commit.
6. Acknowledge the Redis stream entry only after commit.

A worker crash before acknowledgement replays safely. A crash after PostgreSQL commit but before acknowledgement hits unique constraints and is acknowledged without paying twice.

Cancellation states that should not create results never enqueue settlement.

## Distributed rate limiting

Move lifecycle limits to Redis before enabling multiple nodes.

Use an atomic token bucket or fixed window keyed by authenticated user ID. Return:

```json
{
  "error": "Too many room actions. Try again shortly.",
  "code": "RATE_LIMITED",
  "retryAfterMs": 12500
}
```

Do not block `leave_room`; exits must remain available. Apply separate budgets for:

- room creation/join/resume/matchmaking;
- move mutations;
- chat or invitations if added later.

Set TTL on every limiter key.

## Failure behavior

| Failure | Required behavior |
|---|---|
| Redis unavailable before mutation | Fail closed with `REALTIME_UNAVAILABLE`; do not mutate local fallback state |
| Redis times out after command may have committed | Retry with the same command idempotency key, then fetch room snapshot |
| Pub/sub unavailable after committed mutation | Ack command with snapshot; reconnecting clients recover by fetching/resuming |
| PostgreSQL unavailable | Leave settlement stream pending; do not pay rewards in application nodes |
| Settlement worker crash | Redis Stream redelivery plus PostgreSQL uniqueness prevents duplicate rewards |
| Deadline worker crash | Lease expires; another worker revalidates and resolves |
| Node crash | Clients reconnect elsewhere and call authenticated `resume_room` |
| Stale user-room index | Atomic command validates target room and repairs only matching stale index |
| Redis data loss | Declare active matches lost/cancelled; never reconstruct rewards from clients |

No automatic in-memory fallback should activate in production, because that creates split-brain rooms.

## Migration sequence

### Stage 0 — contract extraction

- Convert `RoomManager` callers to an async repository interface while retaining the in-memory implementation.
- Preserve current tests as contract tests.
- Inject clock, ID generator, settlement publisher, and repository.
- Add command IDs and room versions to responses.

### Stage 1 — Redis implementation in single-instance shadow mode

- Write Redis command scripts and run them alongside the in-memory implementation using sanitized test traffic.
- Compare resulting public snapshots and errors; Redis output is not yet served.
- Alert on divergence by command, status, and room version.

### Stage 2 — Redis source of truth, one application node

- Switch reads and writes to Redis.
- Keep one Socket.IO node and one deadline worker.
- Enable settlement stream worker against a staging PostgreSQL database.
- Exercise restart recovery, Redis reconnects, and replayed settlement commands.

### Stage 3 — cross-node transport

- Enable the Socket.IO Redis adapter.
- Run two application nodes behind the intended proxy/load balancer.
- Verify players on different nodes can join, move, disconnect, resume, and rematch.

### Stage 4 — production rollout

- Drain or cancel existing in-memory rooms during a maintenance window; do not attempt unsafe live conversion.
- Deploy Redis-backed nodes with horizontal scaling initially fixed at one replica.
- Increase replicas only after cross-node observability and settlement lag are healthy.

## Rollback

Before multi-instance activation, rollback to the in-memory build and accept loss of staging rooms.

After Redis becomes production authority:

- stop new room creation;
- allow or explicitly cancel existing Redis rooms;
- do not run Redis and in-memory mutation authorities simultaneously;
- retain PostgreSQL results and ledger records;
- deploy the previous application only after active Redis rooms are drained.

## Observability

Track:

- command count, latency, and error code;
- optimistic conflict/retry count if used;
- room version gaps observed by clients/nodes;
- active rooms and user-room index cardinality;
- deadline queue depth and oldest overdue deadline;
- settlement stream lag, pending entries, retries, and dead letters;
- PostgreSQL settlement conflicts;
- Socket.IO adapter publish errors;
- Redis connection state and script failures;
- rate-limit rejects by action scope.

Logs include command ID, series ID, room ID, authenticated user ID, node ID, old/new version, and error code. Never log JWTs, invite URLs containing unrelated query data, or payment secrets.

## Verification matrix

### Repository contract

Run every existing room-state test against both in-memory and Redis repositories.

### Atomicity

- two simultaneous moves for the same turn produce one success;
- simultaneous joins for the last slot produce one success;
- simultaneous create/join attempts preserve one-active-room uniqueness;
- reconnect racing timeout resolution cannot incorrectly forfeit a connected player;
- repeated leave/timeout commands settle once;
- stale socket commands are rejected after authority rotation.

### Multi-instance

- host and guest connected to different nodes receive identical versions;
- node termination during a match recovers through another node;
- pub/sub interruption does not corrupt Redis state;
- two deadline workers cannot double-resolve;
- settlement worker crashes before and after PostgreSQL commit do not duplicate rewards.

### Operational

- Redis latency and outage drills fail closed;
- PostgreSQL outage accumulates settlement lag without losing commands;
- rollback rehearsal drains rooms cleanly;
- dashboards and alerts fire before production activation.

## Production prerequisites

- Managed Redis with persistence, TLS, authentication, memory policy that does not evict active-room keys, and tested restore procedures.
- PostgreSQL unique constraints and backups.
- Separate Redis connections for commands, Socket.IO pub/sub, and blocking stream consumption.
- Secret-managed connection URLs.
- Capacity estimates for room documents, pub/sub traffic, deadline volume, and stream retention.
- A documented incident procedure for Redis data loss and stuck settlement streams.
