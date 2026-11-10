# Tic-Tac Implementation Roadmap

The original frontend-only upgrade plan has been superseded by the secure-foundation work documented in [`docs/SECURE_FOUNDATION_PLAN.md`](docs/SECURE_FOUNDATION_PLAN.md).

## Completed in the secure-foundation branch

- Express/Socket.IO application split into testable runtime modules.
- Server-issued guest sessions with signed JWT authentication for REST and sockets.
- Removal of client-selected UUID authorization and fake currency deposit/exchange routes.
- Persistent Coins and Gems with an immutable, idempotent ledger.
- Server-defined Paystack packages, initialization, verification and signed webhook handling.
- Server-side avatar ownership and balance validation.
- Validated multiplayer rooms, moves, board bounds, best-of series, round readiness, rematches and reconnect state.
- Transactional match persistence and one-time progression/currency rewards.
- React integration with authenticated API/socket clients and server-backed balances.
- Unit, integration, migration and two-client Socket.IO tests.
- Lint/build/audit quality gates and GitHub Actions CI.

## Completed product capabilities

- Server-verified Google account linking and guest-account upgrade.
- Paystack package initialization, verification, webhook handling and idempotent credits.
- Match history, wallet ledger, ranked ELO, and separate ranked/casual matchmaking queues.
- Daily rewards, quests and achievements backed by the server economy.
- Tournaments, private room invitations, room chat and cosmetic inventory.

## Remaining product and infrastructure work

- Run and document a Paystack test-mode end-to-end checkout with a verified-email account before enabling live payments.
- Add further Coin and Gem cosmetic categories.
- Migrate SQLite to PostgreSQL and add shared room/presence state before horizontal scaling.
- Add spectators, a social graph and seasonal progression.

## Production gate

Do not enable live payments until Google account linking, verified email, Paystack test-mode verification, webhook configuration, TLS, database backups and production monitoring are complete.
