# ForgeCoach — notes for Claude sessions

Static Vite + React 18 + TypeScript site (GitHub Pages:
https://jalirkan.github.io/ForgeCoach/). Primarily a playable 2D client: the
user plays Magic against the Forge AI (an mtg-table engine on their machine,
`./scripts/play.sh --engine-only`) with a coach beside the board. Replay/review
of recorded logs and live-watching are secondary. No backend: everything runs in the browser. The product brief is
`docs/brief.md`; the log format is mtg-table's `docs/protocol.md` (§3 state,
§5 asks, §8 frame log).

## Architecture (src/)

- `protocol.ts` — wire types, **copied verbatim from mtg-table** `web/src/protocol.ts`.
- `log.ts` — parse `frames.jsonl` / `.jsonl.gz` into a `GameLog` (header, frames, hello, over, seat).
- `decisions.ts` — the moments the viewing seat decided something, with the state and what was done.
- `state.ts` — derived facts about one state: mana available, land drop, cast this turn.
- `cards.ts` — card text and images from Scryfall, rate-limited, cached in IndexedDB.
- `prompt.ts` — the per-decision coaching prompt (state table + oracle text + deck guide).
- `review.ts` — whole-game summary and the post-game review prompt.
- `guide.ts` — user-written deck play guides in localStorage.
- `claude.ts` — browser-side Claude API calls with the user's own key; model list; settings.
- `coachHelper.ts` — coaching with no key: mtg-table's local coach helper (`http://127.0.0.1:8643`, started by `play.sh`) runs the logged-in Claude Code CLI; `detectHelper` (cached `/health`), `askHelper` (NDJSON `/coach`), `chooseSource` for Settings' `coachSource` (`auto` | `helper` | `apiKey`). `ui/answers.ts` `startAnswer` is the one entry point that picks the source.
- `live.ts` — read-only live follow: follows mtg-table's read-only `/observe` WebSocket
  (default `ws://127.0.0.1:8642/observe`, amendment M50), or polls a growing `frames.jsonl` over HTTP as a fallback. Never uses `/ws` and never sends a frame (see the file header and README § Live watch).
- `play/` — playing a game. `session.ts` owns the seat socket (`/ws`), the growing
  GameLog, current input/ask, and sending acts and answers. `acts.ts` has the
  typed act builders and the guard deciding whether an act may go on the wire.
- `play/seatUrl.ts` — `defaultSeatUrl(location)` / `servedByEngine(location)`: when the mtg-table bridge serves this site itself (`--lan`, phone play), the seat is same-origin `ws://<host>/ws?token=<T>`; the token is redacted from on-screen text. Site builds with `FORGECOACH_BASE=./` for any path.
- `ui/` — React components; `main.tsx` mounts the app.
- `ui/play/` — the play screen: `PlayView` (board), `ActionBar`, `HandDock`,
  `AskDialog` + `askModel` (engine questions), `PlayCoach` + `liveDecision`
  (coach for the current decision), `playKeys` (hotkeys), `usePlaySession`
  (hook over `play/session.ts`).
- `cube/` — Draft & build, the deck assistant for two-player paper cube drafts
  (pure, tested in node): `parseCube.ts` (Justin's cube markdown: sections,
  theme codes, lowercase tags, prices, lands groups, archetypes), `colors.ts`,
  `facts.ts` (what a card is: Scryfall → lab meta → document), `meta.ts` (the
  cube lab's `meta.json`, schema 1; pair `gain` = lift − 1; tolerates 3-colour
  archetypes and 18-land rows), `score.ts` (card value = lab win rate blended
  with a no-meta prior by games; synergy), `builder.ts` (best 40s, reasons,
  cuts, swaps, thin-pool 18-land / three-colour builds, text and `.dck`
  export), `pick.ts` (Grid / Winston advice), `deckPrompt.ts` (deterministic
  deckbuilding coach prompt), `pools.ts` (saved pools, paste parser),
  `cubes.ts` (registry + loading), `metaStore.ts` (imported meta, IndexedDB).
  Test data: `cube/testdata/` (Scryfall snapshots of the four cubes, a fake
  meta fixture, helpers).
- `ui/deck/` — the Draft & build screens (lazy-loaded from `#deck`):
  `DeckApp` (home, pools, workspace, meta import), `PoolView`, `BuildView`
  (builds, score, swaps, export, coach via `answers.ts` `startAnswer`),
  `GridView`, `WinstonView`, `CubeCard`, `sheets` (card picker, card info).
- `public/cubes/` — the four cube documents (Justin's) and the cube lab's
  `<cube>.meta.json` beside each.
- `public/samples/` — two gzipped sample logs from mtg-table's fixture corpus.

## Seat rule

ForgeCoach takes the player's seat on `/ws` only when the user clicks **Play vs
Forge** (`play/session.ts`). Live-watch must stay on `/observe` (or HTTP
polling): it must never connect to `/ws`, because the seat admits one client and
a watcher would lock out the player's board.

## Commands

```bash
npm run dev        # local dev server
npm run typecheck  # tsc --noEmit
npm test           # vitest run
npm run build      # tsc + vite build → dist/
```

Keep typecheck, test and build green before handing work back; CI
(`.github/workflows/ci.yml`) runs all three on PRs and non-main branches.

## Conventions

- `src/protocol.ts` is mtg-table's file. **Never edit it**; when the protocol
  changes, re-copy it from `jalirkan/mtg-table` `web/src/protocol.ts`.
- Modules other than `ui/` stay DOM-free where possible and are tested with
  vitest in node; inject `fetch` / `WebSocket` / storage for tests.
- Deck assistant: the coach explains and suggests; only the player's taps
  change a pool or a deck. Normal builds are two colours (+ a splash of at
  most three one-pip cards) on 16–17 lands; 18 lands or three full colours
  only for thin pools (Justin's rule).
- Only read what the log says: never infer hidden information (the opponent's
  hand, library order) beyond the viewing seat's redacted view.
- The API key lives in localStorage and goes only to api.anthropic.com.
- Every source file carries `SPDX-License-Identifier: GPL-3.0-or-later`.
  Third-party credits go in `NOTICE`.

## Deploy

Push to `main` → `.github/workflows/pages.yml` builds with `GITHUB_PAGES=1`
(Vite `base: '/ForgeCoach/'`) and deploys to Pages. Asset URLs must respect
`import.meta.env.BASE_URL`.
