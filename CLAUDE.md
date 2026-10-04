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
- `prompt.ts` — the per-decision coaching prompt (state table + oracle text + deck guide); its answer format asks for a **Rule:** and a **Confidence:** line, and `coachSystem('answer-first')` puts a one-line **Answer:** first (Settings → Answer first).
- `coachAnswer.ts` — reads an answer's **Answer:** / **Rule:** / **Confidence:** lines (the coach panel's head; the bench's calibration).
- `review.ts` — whole-game summary and the post-game review prompt.
- `winChance.ts` + `evalClient.ts` — the win chance (mtg-table D361): the coach helper's `POST /eval` scores one position with a local learned model (`/health` `eval: 1`, `evalModel`, `evalSchema`, read by `coachHelper.ts` `helperEvalOf`, even when Claude Code is not ready). `winChance.ts` picks the positions (the viewing seat's priority in a main phase or combat, as the model's training rows) and builds `{seat, state, history}` — the log's own redacted state plus the earlier frames' events that hold a `turn`/`land`/`cast`/`mulligan` (`src/testdata/winchance-requests.golden.json` is mtg-table's reader over the two samples); drops after the player's decisions (`decisionDrops`, 8 points). UI: `ui/winchance/` (`WinChanceStrip` in PlayView, `WinChanceLine` over GameView's timeline and the engine review's), `winchance.css` on the skins' tokens. Off by default (Settings `winChance`); hidden without a helper model. The model never comes to the browser.
- `guide.ts` — user-written deck play guides in localStorage.
- `claude.ts` — browser-side Claude API calls with the user's own key; model list; settings.
- `coachHelper.ts` — coaching with no key: mtg-table's local coach helper (`http://127.0.0.1:8643`, started by `play.sh`; on an engine-served page the page's host, on 8643 or the link's `?coachPort=` that `play.sh --lan --coach-port` adds) runs the logged-in Claude Code CLI; `detectHelper` (cached `/health`), `askHelper` (NDJSON `/coach`), `chooseSource` for Settings' `coachSource` (`auto` | `helper` | `apiKey`). `ui/answers.ts` `startAnswer` is the one entry point that picks the source. The helper queues questions (mtg-table D325): `queued` / `running` NDJSON lines, a `supersedes` key, `/health` `queue`; the play coach stops a stale question when the decision moves on. Settings' `coachThinking` (`default` | `low` | `off`) goes to a helper whose `/health` lists `thinking` (mtg-table D346, `helperThinking`); `Answer.thinkingSince` drives the panel's *thinking…* line (`ui/coachWait.ts`).
- `live.ts` — read-only live follow: follows mtg-table's read-only `/observe` WebSocket
  (default `ws://127.0.0.1:8642/observe`, amendment M50), or polls a growing `frames.jsonl` over HTTP as a fallback. Never uses `/ws` and never sends a frame (see the file header and README § Live watch).
- `play/` — playing a game. `session.ts` owns the seat socket (`/ws`), the growing
  GameLog, current input/ask, and sending acts and answers. `acts.ts` has the
  typed act builders and the guard deciding whether an act may go on the wire.
- `play/seatUrl.ts` — `defaultSeatUrl(location)` / `servedByEngine(location)`: when the mtg-table bridge serves this site itself (`--lan`, phone play), the seat is same-origin `ws://<host>/ws?token=<T>`; the token is redacted from on-screen text. Site builds with `FORGECOACH_BASE=./` for any path.
- `play/aiName.ts` — what the board calls the AI seat: the opponent-AI picker's name for `hello_ok.match.aiPolicy` (mtg-table amendment M56, read with `aiPolicyOf`), else the engine's own name (older engines).
- `ui/` — React components; `main.tsx` mounts the app.
- `ui/skin.ts` + `ui/skins.css` — the skins (Settings → Look, `claude.ts` `skin`: `classic` | `stack` | `felt`; `?skin=` previews): `data-skin` on `<html>`, tokens plus a few skin-scoped rules. Classic has no rules (renders as before); never redraw cards in a skin.
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
  `cubes.ts` (registry + loading), `metaStore.ts` (imported meta, IndexedDB),
  `photoPool.ts` (photo to pool: the cube-constrained recognition prompt, the
  strict-JSON parser, name matching with fuzzy near-misses, the review rows
  with their "two photos / two copies?" questions, `planAdd`).
  Test data: `cube/testdata/` (Scryfall snapshots of the four cubes, a fake
  meta fixture, helpers).
- `ui/deck/` — the Draft & build screens (lazy-loaded from `#deck`):
  `DeckApp` (home, pools, workspace, meta import), `PoolView`, `BuildView`
  (builds, score, swaps, export, coach via `answers.ts` `startAnswer`),
  `GridView`, `WinstonView`, `CubeCard`, `sheets` (card picker, card info),
  `PhotoSheet` + `photoImage` (Add from photo: downscale to 1568 px JPEG in
  the browser, read through `startAnswer(…, { need: 'vision' })` — the
  helper's `/vision` (mtg-table D362) or the key's image blocks — then the
  review checklist; nothing enters the pool until the player confirms).
- `draft/` — Draft vs AI (pure, tested in node): `rng.ts`, `weights.ts`,
  `pick.ts`, `draft.ts` are mtg-table's cube-lab drafting AI (`tools/cubelab`)
  stepped one decision at a time, plus Booster (2–8 seats); `cards.ts` (the
  AI's card view from `cube/` facts, meta ratings); `deck.ts` (the post-draft
  deck: main, side, basics); `poolView.ts` (collection grouping, curve, colour
  counts); `aiFlags.ts` (AI:RemoveDeck from the cube docs); `pickPrompt.ts`;
  `store.ts` (the draft in localStorage); `launch.ts` (mtg-table's match
  launcher, `POST /match`, docs/match-launcher.md there). Hidden information:
  the player only ever sees `knownAiCards`, never the AI's list.
- `ui/draft/` — Draft vs AI screens (lazy, `#draft`, `#draft/build`,
  `#draft/match`) and the cube pages (`#cube/<id>`): `PickScreen`,
  `DeckEditor`, `Setup` (table and match set-up), `Collection` (the shared
  Stacks / Gallery / List view, also used by the deck assistant), `DCard`.
  `ui/forge-theme.css` holds the `.fx` tokens and type the cube section,
  the deck assistant (`ui/deck/skin.css`) and the start page (`ui/lobby.css`)
  share.
- `lab/status.ts` — the lab progress page's data (`#lab`): the PC runner's
  `status.json` (mtg-table `RUNNER-SPEC.md`), pushed numbers-only to this
  repo's `lab-status` branch. Parser/validator to a view model (untrusted
  strings cleaned, numbers range-checked, unknown fields ignored), formatting
  (ETA, durations, staleness 10 / 30 min), source from `#lab?src=` (http(s)
  only, `sample` → `public/lab-sample.json`), `fetchLabStatus` with injected
  `fetch`. UI: `ui/lab/LabPage.tsx` (lazy, in the ledger shell's nav).
- `lab/ladder.ts` — the AI leaderboard's data (`#lab/ladder`): mtg-table's AI
  ladder `ladder.json` (schema 1, `docs/guides/ai-ladder.md`), published to the
  `lab-status` branch. Parser/validator (untrusted strings, ranges), interval
  honesty (`rankRange`, `relation`, `anchorSummary`), `LADDER_FIELDS` (the
  allowlist the runner publishes); shares `hashSource` / `fetchLabJson` with
  `status.ts`. UI: `ui/lab/LadderPage.tsx` (lazy), `LabTabs` switches the lab pages.
- `lab/warehouse.ts` — the lab warehouse at a glance (`#lab/data`): the PC
  runner's numbers-only `warehouse.json` (schema 1, strict) on the
  `lab-status` branch. Parser/validator to a view model (strings cleaned and
  capped, numbers range-checked, rates in [0,1] with lo ≤ winRate ≤ hi, bad
  rows dropped and counted), staleness (amber 36 h / red 72 h), `verdict`
  (strong/weak only when the interval excludes 0.5), `cubeViews`; source from
  `#lab/data?src=` via `hashSource` (`sample` → `public/warehouse-sample.json`,
  made-up numbers; `lab/testdata/warehouse-exporter-sample.json` is mtg-table's
  exporter sample, read as is in the tests). UI: `ui/lab/DataPage.tsx` (lazy) + `data.css`.
- `gameReview.ts` — mtg-table's engine review report (`docs/game-review.md` there, D353): strict validator to a view model (honesty enforced: an interval including zero is never a mistake; a zero-regret close call is a tie; leaf = short-horizon, not a win rate; `knowledge.opponentModel` basic-lands → warning), log matching, option labels from the redacted state, timeline, and the deterministic `reviewExplainPrompt`. `gameReviewClient.ts` — the helper's `/health` `review: 1`, `POST /review`, `GET /review/<id>`, `runReview` polling (injected fetch). `draft/reviewInput.ts` — `oppPool` / `oppKnown` only for the Draft vs AI match the saved draft launched.
- `filmRoom.ts` — the film room: the three biggest turning points of the viewer's own decisions (score just before a decision → the next scored position after it ends; source: the helper's win chance, else the engine review report, else a labelled life/board/hand heuristic) and a deterministic per-moment coach prompt (prompt.ts's state table, options, what was done, both scores; **Rule:** / **Confidence:**). UI: `ui/filmroom/FilmRoom.tsx` on the game-over card, the replay's Game review tab and the engine review screen.
- `ui/review/` — the engine review screen (lazy `ReviewApp`, opened from GameView's top bar, the game-over card, or `#sample=<id>&review=1`): timeline, `OptionBars`, the replay `Board` at `stateFrame`, the coach via `startAnswer`. Sample report: `public/samples/human-auto-42.review.json` (engine-made); tests also use the hand-made `src/testdata/human-auto-42.review.handmade.json`.
- `ambience/` — board scenery (pure, tested in node): `model.ts` (lands → biomes per player, slots by first appearance, growth stages; `SceneryTracker`), `events.ts` (land / creature / attack / damage events), `effects.ts` (spec 1.2 one-shot effects: event → cue, pack or built-in, `EffectQueue` concurrency cap, `effectGate`: live play and normal replay steps fire, jumps and scrubbing cancel), `manifest.ts` (art-pack `scenery.json` schema 1, spec 1.3, strict validator incl. `effects` and `overlay`), `pack.ts` (load, preload, fall back to procedural), `prefs.ts` (off by default; Settings, `?scenery=`; `accents`, `?accents=`), `layout.ts`, `sim.ts` (made-up states for `#ambience`), `overlay.ts` (spec 1.3 board accents: corner / edge pieces split by slot, mirrored for the opponent, width fit, caps, built-in placeholders). UI: `ui/ambience/` — `BoardScenery` (the one overlay hook on PlayView / GameView; lazy-loads `SceneryLayer`, which portals a `SceneryStrip` and, with Settings → Board accents on, a `SceneryOverlay` into each `.battlefield`, both at z-index −1 beneath the cards), `procedural.tsx` (built-in art and effect presets), `SceneryEffects.tsx` (effect renderer), `SceneryOverlay.tsx` + `overlayArt.ts` (accents and their built-in art), `AmbiencePage` (`#ambience` preview, no engine). Contract for art packs: `docs/scenery-pack-spec.md`. Packs are never committed here.
- `public/cubes/` — the four cube documents (Justin's) and the cube lab's
  `<cube>.meta.json` beside each.
- `public/samples/` — two gzipped sample logs from mtg-table's fixture corpus.
- `bench/` — `src/bench/coachBench.ts` (cases, legal choices, scoring, reports), `src/bench/grade.ts` (engine-graded regret tables, low-information rule, held-out set) and `bench/coach/` (cases, logs, card snapshot, the `npm run bench:coach` CLI): the coach benchmark. CI runs its dry run in `npm test`; real runs need the helper or a key; regret tables come from mtg-table's `tools/coach-grade.sh` (README § Coach benchmark, *Engine-graded regret*). Regret's yardstick is "best against Forge Default"; held-out cases (`holdout: true`) are never used to tune the prompt. Transient failures are retried; a call that still fails is a transport error, reported apart from format failures, and a run with any is not to be compared.

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
npm run bench:coach -- --dry-run   # coach benchmark, no model calls
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
