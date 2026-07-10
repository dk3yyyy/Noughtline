# Noughtline Multiplayer Experience — Phase 1 Plan

## Goal

Finish the private multiplayer loop without weakening the server-authoritative game model. A player must be able to create, share, join, refresh, disconnect, and reconnect with clear UI and deterministic server behavior.

## Scope

### Included

- Purpose-built room-code join dialog; remove browser `prompt()`.
- Shareable `/join/:roomId` invite links.
- Copy and native-share actions with visible success/failure feedback.
- Friendly invalid, missing, full, expired, and already-complete room states.
- Authenticated active-room recovery after refresh.
- Opponent-disconnected state with a server-derived 30-second deadline.
- Correct restoration of `waiting`, `active`, and `round_complete` after reconnect.
- Explicit disconnect-forfeit completion reason.
- Focused RoomManager, Socket.IO, and two-client live-browser verification.

### Excluded

- Google/email account linking.
- Live Paystack activation.
- PostgreSQL/Redis migration.
- Ranked rating changes, friends, chat, spectators, or notifications.
- Remote push, PR, or production deployment.

## Product rules

1. Invite links never bypass authentication or room capacity checks.
2. The browser may suggest a room ID, but the server decides whether joining or resuming is allowed.
3. Refresh recovery uses a dedicated resume path that only succeeds for an existing room member; it must not silently join a room as a new player.
4. Disconnect countdowns come from a server timestamp, not a client-created timer.
5. Reconnect restores the state that existed before the pause. It must not turn `round_complete` into `active`.
6. If one player remains disconnected when the other reconnects, the room stays paused.
7. A waiting one-player room remains waiting after its host refreshes.
8. A disconnect forfeit is settled once and reports an explicit completion reason.
9. Private rooms remain ineligible for progression or currency rewards.

## Architecture

### Server room state

Add public recovery metadata:

- `state.disconnectDeadline`: epoch milliseconds or `null`.
- `state.completionReason`: `disconnect_forfeit`, `match_cancelled`, or `null`.

Keep the pre-pause state privately on the room (`resumeStatus`) so reconnect can restore `active`, `waiting`, or `round_complete` correctly.

Add a `resumeRoom(roomId, player)` RoomManager operation that:

- rejects missing rooms;
- rejects users who are not already room members;
- rotates socket authority through the existing authenticated reconnect path;
- returns the public room state.

Expose Socket.IO `resume_room`, join the new socket to the room, and broadcast the recovered state.

### Client persistence and routing

Persist only a small active-room descriptor:

```json
{ "roomId": "ROOM_1234", "savedAt": 1234567890 }
```

Use `noughtline_active_room` and expire stale descriptors client-side. On authenticated socket connection, call `resume_room`; clear the descriptor on authoritative failure.

Parse `/join/:roomId` without adding a router dependency. Open the join dialog with the normalized code, but require an explicit Join action. Remove the invite path from browser history after success or cancellation.

### UI components

- `JoinRoomModal`: controlled input, normalization, validation, submitting state, inline server error, accessible labels and focus.
- `GameCreatedModal`: room code, full invite URL, Copy invite, native Share when supported, status announcement.
- `ConnectionStatus`: connecting/offline/reconnected states without a false startup outage.
- Paused match panel: disconnected player, seconds remaining, automatic removal when room resumes.
- Completion copy for disconnect forfeit.

## Test-first sequence

1. Add failing RoomManager tests for disconnect deadline, status restoration, one-sided reconnect, resume authorization, and completion reason.
2. Implement the smallest RoomManager changes to pass them.
3. Add failing Socket.IO tests for member resume and non-member rejection.
4. Implement `resume_room` and rerun the server suite.
5. Implement client persistence helpers and invite-path parser as small pure functions where possible.
6. Replace the prompt join flow and rebuild the share dialog.
7. Add paused/countdown/forfeit rendering and refresh recovery.
8. Verify with two authenticated live browser contexts through the public HTTPS origin.

## Acceptance criteria

- A host can copy a URL that opens the correct join dialog on another browser.
- Invalid syntax is rejected before a network call.
- Server errors are rendered inline; no alert or prompt is required for join failures.
- A second authenticated browser can join from the invite and both boards become active.
- Refreshing either browser preserves board, turn, score, round, symbol, and opponent.
- Disconnecting one browser pauses the other and shows a countdown based on the server deadline.
- Reconnecting within 30 seconds restores the exact prior status and cancels the countdown.
- Remaining disconnected for 30 seconds settles one forfeit only.
- Waiting rooms recover as waiting; round-complete rooms recover as round-complete.
- Multiplayer moves remain server-authoritative and private rooms still mint no rewards.
- Full tests, lint, production build, dependency audits, desktop/mobile visual checks, and public-origin WebSocket checks pass.

## Verification result

Implemented test-first and verified against the public HTTPS preview with two isolated Chromium contexts. The bounded CDP harness covers invite prefill, inline validation, distinct guest identities, synchronized moves, refresh recovery for both players, disconnect countdown, disabled paused board, and reconnect within grace. Automated coverage totals 31 passing tests: 4 client helper tests and 27 server/integration tests.

## Known limitations and next phase

- Room state remains process-local. Recovery does not survive a Node restart and cannot span multiple Socket.IO instances until Redis or another shared room store is introduced.
- A player can still hold multiple nonterminal room memberships. Disconnect now updates every membership defensively, but strict one-room enforcement should be added together with an explicit leave/forfeit flow so users are not trapped in abandoned waiting rooms.
- Join/create/resume rate limiting and stable machine-readable room error codes remain production-hardening work.

## Rollback

The phase will be one local commit after verification. Rollback is `git revert <commit>`; no database migration is introduced. Existing room records are in-memory and the new client storage descriptor can be safely ignored or removed by older builds.
