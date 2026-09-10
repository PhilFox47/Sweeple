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

## BGG authentication

BGG's XML API rejects unauthenticated server requests with
`401 WWW-Authenticate: Bearer realm="xml api"`. A browser gets through on cookies it already
holds for boardgamegeek.com, so the container needs to be given the same thing:

1. Open https://boardgamegeek.com in your browser and log in.
2. F12 → Network tab → reload the page.
3. Click the first request to boardgamegeek.com → Request Headers → `cookie`.
4. Copy the whole value into `BGG_COOKIE` in your `.env`, on one line.

Cookies expire. If syncs start failing with a 401, copy a fresh one and restart the container.
If BGG has issued you a bearer token instead, put it in `BGG_TOKEN` and leave `BGG_COOKIE` empty.

To check credentials without running a full sync:

```
docker compose exec sweeple node dist/diagnose.js
```

It probes the collection URL with and without your configured credentials and reports which
combination BGG accepts.

## Running it (Docker Desktop on Windows)

1. Copy `.env.example` to `.env` and fill in your BGG username, the two login credentials, and
   `BGG_COOKIE` (see above):

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
