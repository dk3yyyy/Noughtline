# 🎮 Noughtline

**Classic Tic-Tac-Toe, rebuilt as a secure real-time multiplayer experience.**

Noughtline combines React, Express, Socket.IO, and SQLite to deliver authenticated guest sessions, server-authoritative multiplayer series, persistent progression, and a two-currency cosmetic economy.

## [🎮 Play Noughtline Live](https://noughtline.onrender.com)

> **Free public preview:** the first load after inactivity can take up to a minute. Accounts, scores, balances, and match history are temporary and may reset when the service sleeps or redeploys.

## ✨ What you can do

- Single-player Tic-Tac-Toe against local AI on 3×3, 4×4 and 5×5 boards.
- Authenticated real-time private rooms and matchmaking; private rooms are unranked and cannot mint progression or currency.
- Server-validated moves, turns, board bounds, best-of-1/3/5 rounds and rematches.
- Reconnection revokes the old socket and allows a 30-second grace period before one-time forfeit settlement.
- Shareable room invitations, refresh recovery, explicit leave/forfeit confirmation, and one-active-room enforcement.
- Stable multiplayer error codes and per-user lifecycle rate limits; leaving a room is never rate-limited.
- Transactional match persistence and one-time server-issued XP, win/loss/draw, streak and Coin rewards for eligible matchmaking games.
- Persistent Coins and Gems with an immutable currency ledger.
- Coin- and Gem-priced avatar inventory with server-side ownership and balance checks.
- Server-defined Paystack packages with server-side initialization, verification, signed webhook handling and idempotent crediting.
- Server-verified Google account linking with single-use nonces; a fresh guest is switched to the owning account, a progressed guest is refused with a conflict.
- Authenticated profile export and account deletion.
- Automated API, economy, room-state and two-client Socket.IO tests.

## 🛡️ Security model

The browser does not choose a UUID or submit its own reward/payment amount. `POST /api/auth/guest` creates an account on the server and returns a signed access token. Protected REST endpoints and Socket.IO connections derive the player from that token.

Production requires a strong `JWT_SECRET`. Startup fails if it is missing. CORS is allowlisted, request sizes are limited, REST requests are rate-limited, and security headers are enabled.

Paid Gems fail closed when `PAYSTACK_SECRET_KEY` is absent. A balance is credited only after the server verifies the Paystack reference, NGN amount, currency and success state. The same reference can be credited only once.

Google account linking is implemented but stays dormant until `GOOGLE_CLIENT_ID` is set — fail-closed, like Paystack. Without it the linking endpoints report Google as not configured and guest accounts keep no verified email. When configured, the server verifies Google ID tokens itself: the RS256 signature against Google's published signing keys, plus `iss`, `aud`, `exp`, the issued nonce and `email_verified`, before linking the account or switching a fresh guest onto it. A Google account that belongs to a different player with saved progress is refused rather than silently merged.

## 🪙 Currency model

- **Coins** are earned from completed multiplayer series and buy standard cosmetics.
- **Gems** are premium currency and buy premium cosmetics.
- The prototype Token layer remains only as a legacy database column and is not exposed to the client.

Rewards are currently:

| Result | XP | Coins |
|---|---:|---:|
| Win | 50 | 10 |
| Draw | 25 | 5 |
| Loss | 15 | 3 |

Change rewards in the server settlement policy, not in the React client.

## 🚀 Run locally

Requirements: Node.js 22+ and npm.

```bash
git clone https://github.com/dk3yyyy/Noughtline.git
cd Noughtline
npm ci
npm ci --prefix server
cp server/.env.example server/.env
```

For local development, replace `JWT_SECRET` in `server/.env` with a random value. Paid currency remains disabled when the Paystack key is blank.

```bash
npm run dev:all
```

- Frontend: http://localhost:5173
- API and Socket.IO: http://localhost:3000
- Health check: http://localhost:3000/api/health

## ✅ Test and verify

```bash
npm run lint
npm test
npm run build
E2E_BASE_URL=http://127.0.0.1:3000 npm run test:e2e
npm audit --omit=dev
npm audit --prefix server --omit=dev
```

The tests cover unauthenticated route rejection, removal of the fake deposit path, ledger idempotency, payment verification, move bounds, multi-round settlement, invite/reconnect recovery, one-active-room enforcement, voluntary forfeits, lifecycle limits, and isolated-browser multiplayer flows.

## 🌐 Production checklist

Before deployment:

1. Set a strong `JWT_SECRET`, exact `CORS_ORIGINS`, production `PUBLIC_APP_URL`, persistent `DATABASE_PATH`, the Paystack secret and the Google OAuth client ID (`GOOGLE_CLIENT_ID`).
2. Configure the Paystack webhook to `POST /api/payments/paystack/webhook`.
3. Point `GOOGLE_CLIENT_ID` at a Google Cloud OAuth 2.0 client (Web application type, authorized JavaScript origins set to the app origin) so players can link a verified email and buy Gems.
4. Put the service behind TLS and a trusted reverse proxy.
5. Back up SQLite or migrate to PostgreSQL; use Redis or another shared state store before running multiple Socket.IO instances.
6. Run CI and a Paystack test-mode transaction before enabling live payments.

See [`docs/SECURE_FOUNDATION_PLAN.md`](docs/SECURE_FOUNDATION_PLAN.md), [`docs/PLAYER_LIFECYCLE_PLAN.md`](docs/PLAYER_LIFECYCLE_PLAN.md), and [`docs/SHARED_MULTIPLAYER_STATE_PLAN.md`](docs/SHARED_MULTIPLAYER_STATE_PLAN.md) for architecture decisions, acceptance criteria, and the horizontal-scaling migration path.

## 🗺️ What comes next

Ranked ELO, tournaments, spectators, chat, social accounts, quests, daily rewards, seasonal progression, PostgreSQL and horizontally shared room state are intentionally deferred until this foundation is reviewed and deployed safely.

## 📄 License

ISC. A standalone `LICENSE` file should be added before publishing a formal release.
