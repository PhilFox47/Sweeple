# Sweeple

A swipe-based board game picker for two players, backed by your shared BoardGameGeek collection.

Both of you swipe through your BGG-tracked games. Right = "I'd play this tonight," left = "not
tonight." When you both swipe right on the same game, it's a match — shown instantly to both of
you (no push notifications, just live in-app updates), ready to play.

## How it works

- **BGG sync**: pulls your owned games, stats (weight, player count, playtime), categories,
  mechanics, and play history from the BGG account `PhilFox` via the public XML API. Runs
  automatically once a week (Sunday 4am) and on-demand via the "Sync with BGG" button. Everything
  is cached in a local SQLite database — no BGG calls happen while you're swiping.
- **Filters**: player count, weight range, max playtime, categories, mechanics, "not played
  recently."
- **Matching**: a match is created the moment both of your accounts have swiped right on the same
  game. Marking a match "played" clears both your decisions for that game so it can naturally
  reappear in a future session.
- **Accounts**: two accounts are seeded from environment variables at first boot. An existing
  account can add further (e.g. guest) accounts via `POST /api/users/guest` — the schema and login
  flow already support more than two users.

## Getting your games in

BGG sits behind Cloudflare, which fingerprints the TLS handshake and serves a JavaScript
challenge. Server-side requests get `401 WWW-Authenticate: Bearer realm="xml api"` while the same
URL works in a browser, and a copied cookie does not help — `cf_clearance` is bound to the
fingerprint that earned it.

So the **Import** tab does it manually, which is reliable and takes about a minute:

1. **Collection** — open the link it gives you. If BGG says the request is being processed, reload
   after a few seconds until the game list appears. Copy the whole page and paste it in.
2. **Game details** — Sweeple then generates links for the games it has, 20 at a time. These add
   player counts, playtime, weight, categories and mechanics, and identify which entries are
   expansions. A collection response reports expansions as ordinary board games, so without this
   step expansions show up in the swipe deck.
3. **Play history** (optional) — adds the dates behind the "not played recently" filter. Play
   counts already come from the collection response.

Paste any of those responses into the same box; Sweeple works out which is which. Re-import at any
time to pick up new games — existing swipes and matches are preserved, and a game that leaves your
collection is marked not owned rather than deleted.

### Automatic sync

The `Sync with BGG` button and the weekly job still exist and drive a bundled Chromium to get past
Cloudflare (`BGG_FETCH_MODE`: `auto`, `browser` or `http`). It works against a simulated challenge
but has not been confirmed against BGG itself — manual import is the dependable path.

## Running it (Docker Desktop on Windows)

1. Copy `.env.example` to `.env` and fill in your BGG username and the two login credentials:

   ```
   cp .env.example .env
   ```

2. Build and start:

   ```
   docker compose up --build -d
   ```

3. Open `http://localhost:8080` (or whatever `HOST_PORT` you set) in a browser. Log in as either
   player and hit "Sync with BGG" once to pull your collection for the first time.

Game data lives in a named Docker volume (`sweeple-data`), so it survives container
restarts/rebuilds. Port forwarding / reverse proxy for access outside your LAN is up to you — the
app just needs to be reachable on the port you expose.

## Local development (without Docker)

```
cd server && npm install && npm run dev   # API on :8080
cd client && npm install && npm run dev   # Vite dev server on :5173, proxies /api and /ws to :8080
```

Set the same environment variables from `.env.example` when running `server` directly (e.g. via a
`.env` loaded by your shell, or export them manually).
