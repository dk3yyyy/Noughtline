# Interface redesign

The client was rebuilt as an app, not a landing page. The arena keeps the
existing Express/Socket.IO/SQLite model; only the presentation layer and the
interaction bugs around it changed.

## Direction

- **Style:** true-black flat (design-taste-frontend library, seed `1937351235`).
- **Face:** a warm charcoal scorecard ground, bone ink, one amber highlighter
  hue. Amber belongs to the marks the game is made of — noughts, the winning
  line, ready states — never to chrome.
- **Ownable element:** the winning line is drawn across the board as one stroke,
  and the same 3×3 grid reports your last nine series on Home.
- **Type:** Inter, 400/500/600, tabular figures for every number. One family.
- **Radius:** 20px panels, 14px cells and cards, pill controls.
- **Elevation:** a lightness step (`--ground`, `--surface`, `--raised`,
  `--surface-2`). Resting panels have no border and no shadow; only dialogs and
  toasts float.
- **Theme:** dark by default, a bone/paper light theme, and a System setting
  that follows `prefers-color-scheme`.

Tokens live in `src/index.css`; component styles in `src/App.css`.

## Screens

| Screen | Question it answers | Composition |
| --- | --- | --- |
| Home | What do I play next? | Ranked panel + recent form/quests rail + modes + rewards |
| Play | How do I want to play? | Ranked / Private / Practice tabs over an inline form |
| Ranks | Where do I stand? | Leaderboard table + standing rail |
| Profile | What is my record and what do I own? | Player card + Overview / Matches / Wallet / Collection |
| Shop | What can I unlock? | Rarity-filtered avatar grid + gem packages |
| Tournaments | Who is left in the bracket? | Lobby list + seeds and round-by-round bracket |
| Game | What is the board saying? | Players, board, series facts and room chat |

## Behaviour fixed in this pass

- One accessible dialog shell for every modal: Escape, backdrop click, focus
  trap, focus restore, body scroll lock, labelled title/description.
- Navigation is a single `navigate()` path; the old `activeTab`/`view` pair that
  could strand you on Tournaments is gone. Transient dialogs close on navigation.
- Tournament detail no longer refetches itself in a loop (the polling effect used
  to depend on state it reset). Polling is split into a load effect and an
  interval effect; the lobby also refreshes.
- Room chat works under React StrictMode: dedupe/append now happens outside the
  state updater, so the double-invoked updater no longer drops every message.
  Own messages are labelled correctly for numeric account ids.
- A pre-seated tournament opponent now reads as “waiting”, not “disconnected”,
  and no longer produces a null forfeit deadline.
- Practice reset and board-size changes clear the pending AI move; rapid clicks
  cannot drop a move; the board is not clickable on the opponent’s turn.
- Rematch has a pending state and no longer shows the opponent’s active-room
  error as yours. Tournament matches do not offer a rematch.
- Leaving a room that the server already forgot now clears local state instead
  of stranding the player. The active-room dialog can leave the old room.
- “Copy invite” in the active-room dialog supplies the origin (it used to throw
  and always report a failure).
- Tournaments can be cancelled by their creator from the bracket screen, using
  the existing server endpoint.
- AI difficulty has real tactics at every board size (win, block, positional
  preference) instead of the old random cutoff; Impossible is no longer Hard.
- Game cues are synthesised with WebAudio, so they work offline and under the
  production Content Security Policy (hosted MP3s were blocked).
- `/api/config` exposes whether payments are configured; the shop says plainly
  when paid currency is closed.
- Leaderboard, achievements, quests, activity and tournament states all have
  loading, empty, error and retry paths.

## Verification

- `npm run build` — passes.
- `npm run test:client` — 125 passing.
- `npm --prefix server test` — 174 passing (including a new pre-seated-room test).
- `npx eslint src` — clean.
- Design gate: `inspect.mjs --app` reports **0 FAIL / 0 WARN** at 1440, 768 and
  390 against the production build served by `npm run server`.
- Two-client walks covered: private room host/join, series rounds, rematch,
  forfeit, room chat, ranked matchmaking and rating settlement, tournament
  create/join/cancel/enter, room recovery after refresh, invite deep links,
  daily/quest/achievement claims, avatar purchase and equip.

## Running it

```bash
cp server/.env.example server/.env   # set a JWT_SECRET
npm install && npm --prefix server install
npm run dev:all                      # Vite on :5173, API on :3000
```

Use Node 22 for `better-sqlite3`; Node 26 fails its native build.
