# Secure Game Foundation Plan

## Goal

Turn the current prototype into a testable foundation where identity, multiplayer results, player progression, and currency balances are controlled by the server rather than the browser.

This phase deliberately prioritizes integrity and a coherent vertical slice over adding more screens.

## Product decisions

### Currency model

Use two currencies:

- **Coins**: earned through completed matches and future quests/daily rewards. Used for standard cosmetics.
- **Gems**: premium currency purchased through a verified payment flow. Used for premium cosmetics.

The existing Token layer is retained only as legacy database data during migration and is no longer part of the active client flow.

### Authentication model

- Guests receive a server-created account and a signed access token.
- Protected REST routes derive the user from the token, never from a client-supplied UUID.
- Socket.IO connections authenticate with the same token.
- Google OAuth remains explicitly disabled until real provider credentials and token verification are configured; the mock conversion flow is removed.

### Match authority

- The server validates board size, room ID, turn, player, move index, occupied cells, and completed-game state.
- The server owns round scores, best-of series completion, rematches, and match persistence.
- Rewards and statistics are committed once, transactionally, when a series finishes.
- Client-side AI remains a casual/offline mode and does not award server currency or ranked statistics.

## Implementation sequence

1. Add test tooling and failing tests for unauthenticated economy access, fake deposits, invalid moves, duplicate result rewards, and round progression.
2. Introduce configuration validation, security middleware, request validation, signed guest sessions, and authenticated sockets.
3. Add migration-safe tables for currency ledger entries, payment intents, and persisted match results.
4. Replace client-controlled deposits with server-defined gem packages and a disabled-by-default payment verification boundary.
5. Implement authenticated coin/gem balance and inventory APIs.
6. Rebuild the room manager as a server-authoritative series state machine with validated moves, round scoring, rematches, disconnect handling, and one-time settlement.
7. Update the React client to bootstrap a guest session, send bearer/socket tokens, display server balances, and remove local coin/XP rewards and mock Google/Paystack behavior.
8. Split high-risk client concerns into API/auth/socket modules without rewriting the whole UI.
9. Add CI, lint configuration for browser/server contexts, unit tests, API integration tests, Socket.IO tests, and dependency remediation.
10. Run full build, lint, tests, audit, and a manual two-client game/economy smoke test.

## Acceptance criteria

- A fake or unauthenticated payment request cannot increase a balance.
- A user cannot read, mutate, export, or delete another account by submitting a UUID.
- Invalid, fractional, negative, or out-of-range moves are rejected without changing the board.
- A 3x3 board always remains exactly nine cells.
- Configured multi-round matches progress and settle exactly once.
- Completed multiplayer matches persist and update wins/losses/draws, XP, streak, and coins transactionally.
- Refreshing or using another browser with the same valid session returns the same server balances and progression.
- Local AI games cannot mint server currency.
- Gem purchases use server-defined packages and require verified payment-provider confirmation; development mode cannot silently grant paid currency.
- Tests, lint, and production build pass.
- No secrets are committed, and production startup fails safely when required signing/payment configuration is absent.

## Deferred follow-up

These build on the secure foundation but are not required for this phase: real Google OAuth UI, production Paystack credentials, PostgreSQL, Redis-backed horizontal room state, ranked ELO, tournaments, spectators, social graph, chat, seasonal content, quests, daily rewards, and an admin catalogue.
