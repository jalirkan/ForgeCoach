# ForgeCoach

**https://jalirkan.github.io/ForgeCoach/**

ForgeCoach is a 2D client for playing *Magic: The Gathering* against the Forge
AI, with a coach beside the board. You play from the web page; the Forge engine
runs on your own computer via [mtg-table](https://github.com/jalirkan/mtg-table).
At any decision you can ask Claude for the play it would make, with the reason,
the heuristic and the trap to avoid, and after the game you get a short review.
The coach reads the engine's own state (what is tapped, what was cast, mana in
pool), and card text comes from Scryfall rather than memory.

Recorded games can be replayed and reviewed, and a game played elsewhere can be
watched live (see below). It is a static page: there is no ForgeCoach server,
and your API key, logs and deck guides stay in your browser.

## Play vs Forge

1. In an mtg-table checkout, start the engine:

   ```bash
   ./scripts/play.sh --engine-only
   ```

   Wait for `Engine ready on ws://127.0.0.1:8642/ws`. Match options come from
   `play.sh`: `--deck`, `--ai-deck`, `--ai-profile`, `--mirror`, `--seed`,
   `--games`.
2. Close any mtg-table board tab. Only one window can hold your seat.
3. Open ForgeCoach and click **Play vs Forge**. The engine address can be
   changed there if you use another port.

Browser notes, because the page is `https://` and the engine is on your machine:

- **Chrome / Edge** ask *"Allow jalirkan.github.io to access apps and services
  on this device?"* the first time. Allow it (site settings, *Local network
  access*).
- **Firefox** works; use `127.0.0.1`, not a LAN address.
- **Safari is not supported**; it blocks the connection. Use another browser, or
  run ForgeCoach locally (`npm run dev`).

mtg-table only accepts the connection from an allowed `Origin`
(`https://jalirkan.github.io` and `localhost` / `127.0.0.1` by default).

### Keyboard

Forge's own buttons and your clicks on highlighted cards do the rest; the
engine decides what is legal.

| Key | Does |
| --- | --- |
| Space / Enter | the highlighted (primary) button, usually OK / pass |
| Esc | the engine's Cancel button (End Turn, Alpha Strike, Cancel...) |
| P | pass priority once |
| E | pass until end of turn (Cancel stops it) |
| T | pass until my next turn |
| B | pass until just before my turn (opponent's end step) |
| A | attack with everything (while declaring attackers) |
| Ctrl+Z | undo the last mana tap |
| W U B R G C | spend one floating mana of that colour |
| ? | show this list in the game |

### The coach

The panel beside the board follows the current decision (main phases, attacks,
blocks, responses, engine questions). Either:

- **Use your own API key.** Paste an Anthropic API key in Settings and pick a
  model. ForgeCoach sends the decision's state and the exact text of the cards
  involved to Claude. A switch asks automatically at your main phases, attacks
  and blocks.
- **Copy prompt.** No key needed: copy the full prompt (state, card text, your
  deck guide) and paste it into the Claude app or claude.ai.

A **deck guide**, your notes on how a deck wants to play, is written in the page
and included in every prompt for that deck.

### After the game

The game-over card offers **Review this game with the coach**: a turn-by-turn
summary and a review in the same style (what went well, at most three mistakes
each tied to a general rule). Same choice: your key, or copy the prompt. **Next
game** continues a match.

## Replay and review a recorded game

mtg-table writes a log per game and seat at
`<mtg-table>/var/games/<gameId>/frames.jsonl` (`ls -t var/games | head -1` is
the latest). Games between two Forge AIs (`./scripts/spectate.sh`) are in
`var/spectate/<name>.jsonl`; with no choices of yours to review, the coach
covers every turn from the viewing seat's side.

On the load screen, pick one of the two bundled samples or upload a
`frames.jsonl` / `.jsonl.gz`. It is read in the browser and not uploaded.
You get your decisions with the board at that moment and what you did, and can
coach each one or run the whole-game **Review** as above.

## Live watch (optional)

Follows a game being played in mtg-table's own board, read-only, so the newest
decision is always on screen. Live watch uses mtg-table's observer socket,
`ws://127.0.0.1:8642/observe` (the default), which any number of clients may
join and which cannot send anything. It never touches the `/ws` seat socket
(taking it would lock out your board). Start mtg-table as usual, click **Live**
and **Connect**. It catches up from the cached state, streams every frame,
starts a new log for each game of a match, and reconnects with backoff. The same
browser notes apply (Chrome permission prompt, Safari unsupported).

Fallback if your mtg-table lacks `/observe`: serve the game directory over HTTP
with CORS from the mtg-table checkout once the game has started,

```bash
npx http-server "var/games/$(ls -t var/games | head -1)" -p 8650 --cors -c-1
```

and connect to `http://127.0.0.1:8650/frames.jsonl`. ForgeCoach polls once a
second and reads only new bytes. Each game of a match is a new file. Any
`http(s)://` URL is treated this way.

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
