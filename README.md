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
blocks, responses, engine questions). The coach can answer three ways:

- **Claude Code on your PC (no API key).** mtg-table's `./scripts/play.sh`
  also starts a small *coach helper* (`http://127.0.0.1:8643`) when the
  [Claude Code](https://claude.com/claude-code) CLI is installed and logged in
  on that machine. ForgeCoach finds it on its own; answers come from your
  Claude Code login and are marked *via Claude Code on your PC*. On a phone
  (the engine-served page, below) the helper is on the desktop's address,
  port 8643, and the page's pairing token goes along with each request.
- **Your own API key.** Paste an Anthropic API key in Settings. ForgeCoach
  sends the request straight to Anthropic; answers are marked *via API key*.
- **Copy prompt.** Nothing needed: copy the full prompt (state, card text,
  your deck guide) and paste it into the Claude app or claude.ai.

Settings → **Coach source** shows whether the helper is running and picks the
source: *Automatic* (the default: the helper when it is found, else your key),
*Claude Code* or *API key*. The model choice applies to both (Opus 5.5 → `opus`,
Sonnet 5.5 → `sonnet`, Haiku 4.5 → `haiku` for Claude Code). Either way the
coach gets the decision's state and the exact text of the cards involved, and a
switch asks automatically at your main phases, attacks and blocks.
For development, `?coach=http://127.0.0.1:<port>` points the page at a helper
on another port.

A **deck guide**, your notes on how a deck wants to play, is written in the page
and included in every prompt for that deck.

### After the game

The game-over card offers **Review this game with the coach**: a turn-by-turn
summary and a review in the same style (what went well, at most three mistakes
each tied to a general rule). Same choice: Claude Code on your PC, your key, or
copy the prompt. **Next
game** continues a match.

## Play on your phone

On the desktop, in your mtg-table checkout, run `./scripts/play.sh --engine-only --lan`.
It prints an address like `http://192.168.1.20:8642/?token=...`; open that on
your phone (same Wi-Fi), or scan the QR code if one is shown. The bridge serves
ForgeCoach itself, so the seat socket is on the same origin and no
https-to-ws mixed content is involved. This is for your home network only. The
token is the key to your seat: don't share the link or post screenshots of it.

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
  decision's state and card text go to Anthropic with your request — straight
  from the browser with your key, or through the coach helper and Claude Code
  on your own PC. Copy prompt sends nothing anywhere.
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

### End-to-end test (play a whole game)

`e2e/play.e2e.mjs` opens the real app in a browser, joins the real Forge
engine's seat and plays one game to the end using only what a player sees:
it answers the opening dialogs and Forge's questions with their default
button, plays the hand cards the board outlines as playable (lands first),
pays with Auto, sometimes attacks with everything, and otherwise presses the
action bar's primary button. It fails on a stall (nothing on screen changes
for `STALL_SECONDS`, default 90), on any page error or console error, or when
it cannot join the table, and saves a screenshot and the console log to
`e2e/out/`.

```bash
# in mtg-table, in another terminal
./scripts/play.sh --engine-only
# here
npm run e2e                                    # desktop viewport
VIEWPORT=phone npm run e2e                     # a phone-sized, touch viewport
HEADLESS=0 MAX_TURNS=10 npm run e2e            # watch it, stop after round 10
```

Other settings: `SEAT_URL` (default `ws://127.0.0.1:8642/ws`), `APP_URL` (an
already-running ForgeCoach; by default the test starts vite on a free port of
127.0.0.1), `SEED`, `NEXT_GAME=0` (by default it starts the next game at the
end, because mtg-table ends its session when the client leaves at a game's
result) and `BROWSER_PATH`. It needs `playwright-core` with a Chromium, which
are deliberately not project dependencies: `npm install --no-save
playwright-core && npx playwright-core install chromium` once. The test is
not part of `npm test` and does not run in CI, since it needs mtg-table (a
private repository) and Forge (large) on the machine.

## Licence

GPL-3.0-or-later — see `LICENSE`. `src/protocol.ts` is copied from mtg-table
(GPL-3.0-or-later). Third-party credits and the Wizards of the Coast Fan Content
notice are in `NOTICE`.
