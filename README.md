# ForgeCoach

**https://jalirkan.github.io/ForgeCoach/**

## Easiest way to start (Linux)

Open a terminal, paste this line and press Enter. You only do this once:

```bash
curl -fsSL https://jalirkan.github.io/ForgeCoach/forgecoach.sh | bash -s install
```

After that, **click ForgeCoach in your app menu**. It finds your mtg-table
folder (or downloads it), updates it, checks Java, Node, Forge and Claude Code,
starts the engine and opens ForgeCoach with Play already started. A small
window shows what it is doing; if something is missing it says what to install
and gives you the exact command to paste.

- **ForgeCoach (phone)** (also on right-click): play from your phone on the
  same Wi-Fi. It shows the link and a QR code, and sends the link to your
  phone with KDE Connect if you use it.
- **ForgeCoach (away from home)**: play from your phone on any network (mobile
  data, a cafe, work), over [Tailscale](https://tailscale.com), a free private
  network between your own devices. Set it up once with
  `forgecoach remote-setup` (see *Play away from home* below).
- **ForgeCoach overnight lab**: runs the cube lab's AI-vs-AI jobs unattended
  (see *Overnight lab on your PC* below).
- **Stop ForgeCoach**: stops the engine.
- No Forge yet? `~/.local/bin/forgecoach get-forge` downloads Forge 2.0.14
  from its official release into `~/forge` (the first start offers to do it).
- `forgecoach status` shows what is running and where everything is.
  `forgecoach help` lists the rest.

The launcher is [`public/forgecoach.sh`](public/forgecoach.sh). It never runs
`sudo` on its own (`remote-setup` runs one only after you answer yes at a
terminal prompt) and updates itself once a day.

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
https-to-ws mixed content is involved. This is for your home network only (away
from home, see below). The token is the key to your seat: don't share the link or post screenshots of it.

## Play away from home (Tailscale)

The phone mode above only works on your home Wi-Fi. To play from anywhere, the
phone and the PC join a free Tailscale network (only devices logged in to your
own account can see each other; nothing is opened on your router).

**Once, on the PC** (a terminal; each step asks before it uses `sudo`):

```bash
forgecoach remote-setup
```

It installs Tailscale if it is missing (Tailscale's official installer,
`curl -fsSL https://tailscale.com/install.sh | sh`; it prints the command and
asks first), runs `sudo tailscale up` (it prints a web address: log in there),
and can run `sudo tailscale set --operator=$USER` so later commands need no
password. Safe to repeat.

**Once, on the phone:** install the Tailscale app (Google Play or App Store) and
log in with the same account as on the PC.

**Each time:** start **ForgeCoach (away from home)** from the app menu (or
`forgecoach remote`). It starts the engine like the phone mode, then shows a link
with the PC's Tailscale address (`http://100.x.y.z:8642/?token=...`), a QR code
and a page with both, and sends the link to your phone with KDE Connect when it
is connected. On the phone, with the Tailscale app on, open the link. If
Tailscale is not connected on the PC it says so, and the link only works at home.

**The PC has to stay on, awake and online while you are away.** While the engine
runs, `forgecoach remote` holds a `systemd-inhibit` lock so the PC does not
suspend by itself (it is released when you stop ForgeCoach; set
`FORGECOACH_NO_INHIBIT=1` to skip it). If it cannot, it tells you to turn off
sleep in System Settings > Power Management. Start it before you leave (or have
someone at home click it), and remember: closing a laptop lid may still suspend it.
The link carries a secret token: do not share it.

## Draft & build (paper cube drafts)

**Draft & build** on the start page is a deck assistant for two-player Grid
and Winston drafts of Justin's four cubes (Synergy, Modern-era, Vintage,
Pauper; the lists are in `public/cubes/`). Everything runs in the browser;
pools are saved in it (several at once).

- **Pool**: the whole cube as cards. Tap what you take (switch to *They took*
  for the opponent's picks, which sharpens the pick helper), search, filter by
  colour, or paste a list (counts, set codes and `.dck` lines are fine). The
  number on each card is its pick value for your pool.
- **Build**: the best 40, three distinct builds, each with a score breakdown
  (card quality, synergy, curve, weak cards, creature count, interaction,
  splash, archetype) and plain reasons ("Skullclamp + Young Pyromancer: +6%
  together", "cut X: off-theme 5-drop"). Every colour pair is tried, with a
  splash where the pool has fixing; 22–24 spells (Auto picks); lands from the
  cube lab or 17 (16 with a low curve); basics by pips, early drops weighted.
  Thin pools (no pair reaches 23 playables) also get 18-land and three-colour
  builds, flagged. Tap a card to swap it and watch the score move. Export as a
  text list or a Forge `.dck`.
- **Grid**: enter the nine cards; it calls the row or column, counting what
  the opponent can take after you. **Winston**: enter the pile; take or pass.
- **Ask the coach** (Build tab): the pool, the build, its score, the lab's
  numbers and every card's text go to the coach (Claude Code via the coach
  helper, or your API key) with a deckbuilding prompt. It explains and
  suggests swaps; it never edits the deck.

**Cube lab data.** Each cube ships with a `meta.json` from mtg-table's cube
lab (`tools/cubelab.sh`: Forge AIs drafting and playing the cube): card win
rates, archetypes, card pairs, land counts, splash results. Samples are small,
so everything weighs the lab by its games (a card's win rate counts
games ÷ (games + 40) against the page's own estimate). Import a newer
`meta.json` from the chip in the header (or drop it on the page); it is kept in
this browser. Without any meta the assistant works from card text, mana value
and the cube's themes.

**Play the deck vs Forge.** Download the `.dck`, save it in mtg-table's
`decks/` folder, start the engine with it —
`./scripts/play.sh --engine-only --deck decks/<name>.dck --mirror` (or
`--ai-deck decks/<other>.dck`) — and press **Play vs Forge**.

## Overnight lab on your PC

The metagame and deck-assistant numbers come from mtg-table's cube lab: Forge
AIs draft a cube against each other, build decks and play them. That uses your
PC's CPU, not tokens or a network. One command runs the whole queue unattended:

```bash
forgecoach overnight          # or: app menu > "ForgeCoach overnight lab"
```

It updates mtg-table first, then runs these **one after another** (never in
parallel; each is resumable, so run it again and it continues where it stopped):

1. **Omega evolve**: 8 generations x 1200 drafts that swap dead and dominant
   cards out of the Omega cube (about 3.8 hours on an 8-core PC).
2. **Meta runs** of seven cubes (`meta-synergy`, `meta-modern-era`, `meta-vintage`,
   `meta-pauper`, `meta-fair-fight`, `meta-peasant`, `meta-omega`): 2000 drafts
   each, then the report that writes `meta.json` (about 50 minutes each on an
   8-core PC). A cube file your mtg-table checkout lacks (an older one) is
   skipped with a note, not treated as a failure; `git pull` it and run again.
3. **Learned drafter**: synergy self-play, 4 iterations x 1000 drafts, head-to-head
   1000, deck head-to-head 500 (about 2 hours).

The sizes come from measurements: a draft with its best of three costs 8 to 10
seconds of one core, and the evolve step needs 865 or more drafts a generation
to have enough data. The launcher assumes 10 s a draft, then **measures your PC**
from the drafts' own timings after the first finished job, keeps the figure in
`~/.config/forgecoach/config` and uses it for the estimates (`--dry-run` says
"about X h at Y workers (measured on this PC: Z s/draft)").

Options:

- `--jobs N`: workers per job. Default: **physical cores - 1** (the lab is limited
  by cores, not hardware threads), at most one per 4 GB of RAM (a Forge JVM).
- `--only evolve,synergy,learn` (`meta` is all seven meta runs; or name cubes:
  `fair-fight`, `peasant`, `meta-omega`; plain `omega` still means the evolve
  step), `--hours N` (start no new job after N hours),
  `--dry-run` (print the plan and the exact commands), `--yes` (run even while the
  engine is up, at the lowest priority), `--redo`.
- Sizes: `--evolve-gens N`, `--evolve-drafts N`, `--meta-drafts N`,
  `--learn-iters N`, `--learn-drafts N`, `--learn-h2h N`, `--learn-deck-h2h N`
  (whole numbers, 1 or more). The output folders carry the sizes
  (`omega-overnight-g8-d1200`, `<cube>-overnight-n2000`,
  `synergy-overnight-i4-d1000-h1000-k500`), so a changed size starts a fresh
  folder and a finished job counts as done only for the sizes it was run with;
  the same sizes resume where they stopped.
- `--budget-hours H`: scale every job's draft counts so the whole queue fits about
  H hours at the measured speed. Proportions are kept; nothing goes below the
  minimums (evolve 865 a generation, meta 500, learn 300 / 400 / 200), and the
  resulting sizes are printed. Combine it with `--only` or the size flags (which
  then set the proportions).
- `--stop`: stop a running lab. It sends `TERM` to the launcher, which stops the
  running cubelab and releases the sleep lock. Use `TERM`
  (`kill -TERM <pid>`), not `INT`: a background job of a non-interactive shell
  ignores `INT`. `forgecoach status` shows the stop command.

Everything runs under `nice`, holds off sleep with `systemd-inhibit` and logs to
`~/.cache/forgecoach/overnight.log`; a desktop notification says when it is
done. `forgecoach status` shows the sizes, the running job and its progress.

**Where the results land**, in `~/.local/share/forgecoach/`: `meta/<cube>.meta.json`
for all seven cubes (also `reports/`), `omega/` (the evolved cube and its changelog) and
`learned/synergy/` (values, synergy pairs, summary). **To use them**, open the
[Metagame page](https://jalirkan.github.io/ForgeCoach/#meta) (it lists the same
seven cubes, including Fair Fight, Peasant and Omega), pick the cube and
click **Import from file** (or drop the file on the page); the deck assistant's
**Lab** chip takes the same files. Imports are kept in that browser only.

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
- **Draft pools** and imported cube-lab files stay in this browser
  (localStorage, IndexedDB).

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

### Coach benchmark

`bench/coach/` holds a fixed set of real decisions from recorded games, each
with the answers a strong player accepts, the clear blunders and a short
rationale. Run it before and after a change to the coach prompt
(`src/prompt.ts`) to see what the change did. Every case rebuilds the exact
prompt the app would send (`buildCoachPrompt`, from the viewing seat's redacted
view only). In bench mode one extra section is appended to the prompt; it lists
the legal choices and asks for a final `ANSWER: <choice>` line. Normal prompts
are unchanged. Scoring: acceptable answer +1, blunder −1, anything else 0
(another answer, or a missing or illegal `ANSWER:` line). Cases marked
`"confidence": "low"` are run but not scored. The report gives the score per
decision type (mulligan, play/draw, spell, attack, block, target, pass, choice)
and the latency.

**Running it on your PC.** The bench asks the same coach the app does: the
local coach helper (Claude Code on your PC, no key) or the Anthropic API with
your key.

1. Start ForgeCoach as usual (the `forgecoach` launcher, or
   `./scripts/play.sh --engine-only` in mtg-table). This also starts the coach
   helper on `http://127.0.0.1:8643` (unless you passed `--no-coach`). Claude
   Code must be installed and logged in.
2. In a ForgeCoach checkout: `npm ci` once, then

   ```bash
   npm run bench:coach -- --label before            # the current prompt
   # …edit src/prompt.ts…
   npm run bench:coach -- --label after
   npm run bench:coach -- --compare bench/coach/results/<…>-before.json bench/coach/results/<…>-after.json
   ```

   Each run writes `bench/coach/results/<time>-<label>.json` (every reply in
   full) and a `.md` summary. `--compare` lists the cases that got better or
   worse. Reports are git-ignored; `git add -f` one to keep it as a baseline.

Options: `--source helper|api` (by default the helper if it is up, otherwise the
API when `ANTHROPIC_API_KEY` is set), `--model <m>` (an alias the helper
accepts, or an API model id from `src/claude.ts`), `--only id1,id2`,
`--type block`, `--helper-url <url>`. Cases run one at a time (the helper
answers one question at a time), so a full run takes about as long as 28 coach
answers. Ctrl-C stops after the current case and still writes the report.

`npm run bench:coach -- --dry-run` builds every prompt and checks every case
without calling a model. Add `--show <case-id>` to print that case's full
prompt. The same checks run in CI as part of `npm test`
(`src/bench/coachBench.test.ts`): every case builds, every listed answer is a
legal choice at that moment, and card text is there for every card.

**Adding a case from one of your games.** mtg-table writes every game to
`var/games/<gameId>/frames.jsonl`.

```bash
npm run bench:coach -- list --log ~/mtg-table/var/games/<gameId>/frames.jsonl          # replay decisions
npm run bench:coach -- list --log ~/mtg-table/var/games/<gameId>/frames.jsonl --live   # every moment you acted
npm run bench:coach -- add --log ~/mtg-table/var/games/<gameId>/frames.jsonl \
  --decision 12 --type block --id block-my-game-double-block                         # or: --frame 1234 --live
```

`add` copies the log (gzipped) into `bench/coach/logs/`, fetches any missing
card text into `bench/coach/cards.json`, writes
`bench/coach/cases/<id>.json` and prints the legal choices. Fill in
`acceptable` (1–3), `unacceptable` (clear blunders) and `rationale`, then run
`--dry-run --show <id>` until it passes. `--decision n` picks the n-th replay
decision (the review screen's list, with the state at the start of that
decision). `--frame n --live` picks the moment just before your act or answer
at frame n, as the play screen's coach saw it. Use that for a target or an
engine question. Choose decisions whose right answer is clear to a strong player
from what you could see. Check the card text in the printed prompt, not your
memory. If you are unsure, use `"confidence": "low"`.

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
