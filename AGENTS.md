# AGENTS.md

Notes for coding agents working on Sweeple. `README.md` is for people running the app; this file
is the stuff you only find out by breaking it.

## What this is

A swipe-based board game picker for a household, backed by a shared BoardGameGeek collection.
Two permanent profiles (Phil and Leo) plus any extra profiles they add. Everyone swipes; when
everyone in the round swipes right on the same game, it is a match.

Two workspaces, no monorepo tooling — install and build each separately:

- `server/` — Fastify 4 + TypeScript (ESM, `module: NodeNext`), better-sqlite3, node-cron.
  Serves the API, the WebSocket at `/ws`, and the built client as static files.
- `client/` — React 18 + Vite + TypeScript. Mobile-first; assume a phone held one-handed.

## Commands

```bash
cd server && npm install && npm run dev     # tsx watch, API on :8080
cd client && npm install && npm run dev     # Vite on :5173, proxies /api and /ws to :8080

cd server && npm run build                  # tsc + copies schema.sql into dist/
cd client && npm run build                  # tsc -b + vite build
npx tsc --noEmit -p tsconfig.json           # type-check alone, in either workspace

docker compose up --build -d                # the real deployment
```

There is no linter and no formatter config. Match the file you are editing.

`dist/` is gitignored in both workspaces — never commit build output.

## Verifying a change

There is no test framework. Verification means running the built app against a throwaway
database and driving it, which is why every behaviour below has been measured rather than
assumed. Do the same:

```bash
cd server && npm run build && cd ../client && npm run build
DATA_DIR=/tmp/scratch/db PORT=8199 CLIENT_DIST=$PWD/client/dist node server/dist/index.js
```

Seed the throwaway database directly with better-sqlite3 (games, votes with back-dated
`created_at`, and so on), then drive the UI with Playwright — `playwright` is already a server
dependency, and the Docker image installs Chromium under `PLAYWRIGHT_BROWSERS_PATH`.

Two habits worth keeping:

- **Measure before and after.** A test that passes on the fix but was never seen to fail on the
  bug proves nothing. Several "fixes" in this repo's history were wrong, and the negative control
  is what caught them.
- **For anything statistical** (deck order, weighting), compare an observed distribution against
  the one the weights predict, and prefer mean position over "how often did it come first" —
  top-1 frequency needs thousands of samples to separate close weights.

## Things that will bite you

**BGG needs an application token.** Nearly every XML API endpoint answers
`401 WWW-Authenticate: Bearer realm="xml api"` without one. The single exemption is downloading
your own collection while logged in to the site in a browser, which is why a collection URL works
there and `/thing` does not. The token lives in `.env` as `BGG_TOKEN` and nowhere else — it must
never appear in a repository file, a test fixture, or a commit message. BGG is also behind
Cloudflare; the bundled Chromium in `server/src/browser.ts` is the fallback for a tokenless setup
and is not exercised against real BGG from CI or a sandbox.

**A collection response calls everything a `boardgame`.** Only `/thing` marks expansions. Skip
the detail step and expansions land in the swipe deck as standalone games.

**Two tables record decisions, and they are not interchangeable.** `swipes` is the current
sitting and is wiped when a round starts. `votes` is the permanent record the pick ratings are
built from, one row per player per game per round. Never read one where the other is meant.

**`games.expansion_mode` is written by hand only.** Syncing and importing must never touch it, or
the user's Hidden/In-deck choices are lost on the next refresh.

**Migrations live in `server/src/db.ts`.** `CREATE TABLE IF NOT EXISTS` never alters an existing
table, so every column added after the fact needs an `addColumnIfMissing` call, and a changed
constraint needs a full table rebuild (see the matches unique-index migration). Always test an
upgrade path against a database built the old way, not just a fresh one.

**The WebSocket is an optimisation, not the mechanism.** It never connects behind a proxy that
does not forward the upgrade, and a locked phone kills it silently. The client polls regardless
and refetches on reconnect and on `visibilitychange`. Never make correctness depend on an event
arriving.

**API responses are `no-store`**, both from the server hook and from the client's `fetch`. A
cached `GET /api/matches` is indistinguishable from "no new matches". Avatars are the deliberate
exception: their URL carries a version, so they cache forever.

**Deck order is server-side policy**, all of it in `server/src/deck.ts` — opening hands, the
weights, and the weighted sampling. The client renders whatever order it is given and re-fetches
after each swipe; it does not re-order anything.

**`react-tinder-card` props must be referentially stable.** An inline array or a fresh callback
makes its `useLayoutEffect` reinstall listeners mid-gesture, which resets the drag origin and
snaps the card back to the centre. `DeckCard` is memoised and takes module-level constants for
exactly this reason.

**`@react-spring/web` is a required peer of `react-tinder-card`.** It is an optional peer
dependency, so the build succeeds without it and the bundle throws at module scope — a blank page
with a clean build log. If the app renders nothing, load it in a headless browser and read the
console before suspecting anything else.

**Use `<img>` for BGG artwork, never a CSS `url()`.** BGG image URLs contain parentheses
(`.../filters:format(jpeg)/...`) that an unquoted `url()` cannot express.

**Only three cards are mounted at a time.** Rendering the whole deck meant ~80 animated instances
and ~80 full-size images competing, which is what made the UI crawl. Keep `VISIBLE_CARDS` small,
and keep the explicit `z-index` on `.deck-controls` and `.tab-bar` — a dragged card painted over
statically positioned controls.

## Conventions

- Database columns are `snake_case`; API payloads are `camelCase`. Route modules do the
  translation (`serializeGame` and friends); nothing else should see raw rows.
- Server imports carry the `.js` extension, as `NodeNext` requires, even from `.ts` sources.
- Admin-only endpoints take `{ preHandler: [authenticate, requireAdmin] }`. Permission is
  enforced on the server, never only by hiding a control.
- Comments explain *why*, not what. Prefer one sentence about the decision — the constraint that
  forced it, the failure it prevents — over narrating the code. If nothing non-obvious is going
  on, write no comment.
- Commit messages are prose in the same spirit: what changed, why, and what was measured.
