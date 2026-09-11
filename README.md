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

BGG's XML API requires a registered **application token** on nearly every endpoint. The only
exemption is downloading your own collection while logged in to the site in a browser — which is
exactly why a collection URL works in your browser while `/thing` answers
`401 WWW-Authenticate: Bearer realm="xml api"`.

Register an application at <https://boardgamegeek.com/applications>, create a token under
"Tokens", and put it in `.env` as `BGG_TOKEN`. Sweeple sends it as `Authorization: Bearer <token>`
on every request, server-side, and caches the results in SQLite — BGG asks that requests come from
servers and be kept to a minimum, which the weekly schedule respects.

With the token set, **Sync with BGG** fetches your collection, game details and play history
automatically.

### Manual import (fallback)

The **Import** tab still accepts pasted XML if you would rather not use a token, or to backfill
without waiting for a sync. It hands you the API links and detects which response you paste —
collection, thing or plays. Note that only the collection URL works in a browser without a token;
the others need the `Authorization` header a browser cannot send.

Importing details matters for more than stats: a collection response reports every entry as
subtype `boardgame`, including expansions like Wingspan: European Expansion. Only the `thing`
endpoint distinguishes them, so without that step expansions appear in the swipe deck as if they
were standalone games.

Re-import or re-sync at any time. Existing swipes and matches are preserved, and a game that
leaves your collection is marked not owned rather than deleted.

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
