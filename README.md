# ForgeCoach

**https://jalirkan.github.io/ForgeCoach/**

ForgeCoach coaches your *Magic: The Gathering* games against the Forge AI. It
reads the frame logs that [mtg-table](https://github.com/jalirkan/mtg-table)
writes while you play — exact snapshots of the game as your seat saw it:
every card, tapped or untapped, summoning-sick or not, mana in pool, what was
cast this turn — and at each decision you made it asks Claude for the play it
would have made, with the reason, the heuristic it follows and the trap to
avoid. After the game it writes a short review: what went well and at most
three things to fix.

Because the coach reads the engine's own state rather than a screenshot, it
never has to guess what is tapped, and card text comes from Scryfall rather than
from memory.

It is a static web page. There is no ForgeCoach server: your game log, your API
key and your deck guides stay in your browser.

## Using it

### 1. Get a game log

mtg-table writes one log per game, per seat, flushed line by line while the game
runs:

```
<mtg-table>/var/games/<gameId>/frames.jsonl
```

Play a game the normal way (`./scripts/play.sh` in mtg-table) and the file is
there when it ends; a three-game match writes `<gameId>/`, `<gameId>-g2/`,
`<gameId>-g3/`. `ls -t var/games | head -1` is the game you just played.

Games two Forge AIs played against each other (`./scripts/spectate.sh`) are
written to `var/spectate/<name>.jsonl`. ForgeCoach reads those too; with no
choices of yours to review, it coaches every turn from the viewing seat's side.

You can gzip a log first (`gzip -k frames.jsonl`) — ForgeCoach reads
`.jsonl` and `.jsonl.gz`.

### 2. Open it in ForgeCoach

Open the site and either **load a sample** (two recorded games ship with the
page) or **upload** your `frames.jsonl` / `.jsonl.gz`. The log is read in the
browser; it is not uploaded anywhere.

ForgeCoach lists your decisions — main phases, attacks, blocks, responses and
the questions the engine asked you — each with the board as it was at that
moment and what you actually did.

### 3. Coach a decision

Pick a decision, then either:

- **Coach with your own API key.** Paste an Anthropic API key in Settings and
  pick a model. ForgeCoach sends the decision's state and the exact text of the
  cards involved to Claude and shows the recommendation.
- **Copy prompt.** No key needed: ForgeCoach copies the full prompt (state,
  card text, your deck guide) to the clipboard. Paste it into the Claude app or
  claude.ai and ask away.

A **deck guide** — your notes on how a deck wants to play ("hold payoffs until
there's a sac outlet", "Skullclamp only on 1-toughness creatures") — can be
written in the page and is included in every prompt for that deck.

### 4. Post-game review

**Review** summarises the whole game turn by turn and asks for a review in the
same coaching style: at most three mistakes, each tied to a general rule, and
what went well. Same choice: your key, or copy the prompt.

### 5. Live mode (optional)

Live mode follows a game *while you play it*, so the newest decision is always
on screen. ForgeCoach never sends anything to the game — it only reads.

It does **not** connect to mtg-table's game socket (`ws://127.0.0.1:8642/ws`).
That socket admits exactly one client: the board you are playing on. If
ForgeCoach ever took it (say, while your board tab was reloading) your board
would be locked out, and when ForgeCoach let go the bridge would answer your
pending choices with Forge's defaults. ForgeCoach refuses that URL outright.

Instead it connects to mtg-table's **read-only observer socket**,
`ws://127.0.0.1:8642/observe` (the default; protocol amendment M50, mtg-table PR
"read-only /observe"). Start mtg-table as usual, then click **Live** in
ForgeCoach and **Connect**. Any number of observers may connect; the socket is
receive-only (anything ForgeCoach sent would be ignored, and it sends nothing).
On connect it catches up from the seat's cached hello, latest state, input and
any open ask, then streams every frame. A new game in a match starts a new log
automatically, and ForgeCoach reconnects with backoff if the socket drops (for
example when it falls too far behind). mtg-table only accepts the socket from an
allowed `Origin` (`https://jalirkan.github.io` and `localhost` / `127.0.0.1` by
default); otherwise the browser just sees a failed connection.

Browser notes, because the page is `https://` and the server is on your machine:

- **Chrome / Edge**: newer versions ask *"Allow jalirkan.github.io to access apps
  and services on this device?"* the first time. Allow it (site settings ->
  *Local network access*).
- **Firefox**: allows `127.0.0.1` from an https page; use `127.0.0.1`, not a LAN
  address.
- **Safari**: blocks it. Run ForgeCoach locally instead (`npm run dev`, below),
  or use another browser.

#### Fallback: follow the log file over HTTP

If your mtg-table does not have `/observe` yet, serve the game's directory over
HTTP with CORS, from the mtg-table checkout, once the game has started:

```bash
npx http-server "var/games/$(ls -t var/games | head -1)" -p 8650 --cors -c-1
```

and connect to `http://127.0.0.1:8650/frames.jsonl`. Serving all of `var/games`
(`npx http-server var/games -p 8650 --cors -c-1`) works too, with
`http://127.0.0.1:8650/<gameId>/frames.jsonl`. ForgeCoach polls once a second,
reads only the new bytes, and stops when the game ends. Each game of a match is
a new file, so point it at the next one when a game ends. Any `http(s)://` URL
is treated this way.

## Privacy

- Your **API key** is kept in this browser's localStorage and sent only to
  `api.anthropic.com`, directly from your browser. Nothing goes through a
  ForgeCoach server; there isn't one.
- **Game logs** are read locally and never uploaded. When you coach, the
  decision's state and card text go to Anthropic with your request. Copy prompt
  sends nothing anywhere.
- **Card data and images** come from [Scryfall](https://scryfall.com), fetched
  by your browser and cached in it (IndexedDB).

## Development

```bash
npm ci
npm run dev         # http://localhost:5173/
npm run typecheck
npm test
npm run build       # dist/
```

Pushes to `main` deploy to GitHub Pages (`.github/workflows/pages.yml`); pull
requests and other branches run typecheck, tests and build
(`.github/workflows/ci.yml`).

## Licence

GPL-3.0-or-later — see `LICENSE`. `src/protocol.ts` is copied from mtg-table
(GPL-3.0-or-later). Third-party credits and the Wizards of the Coast Fan Content
notice are in `NOTICE`.
