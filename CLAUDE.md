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
- `faceDown.ts` — defence in depth for a face-down card's face (`alt`, mtg-table D371): every reader (`log.ts` `parseLog`, `live.ts` `LiveLogBuilder`, `play/session.ts`) drops the `alt` of a face-down card **in play** the viewing seat does not control; an exiled card's `alt` (a look permission: Gonti, Thief of Sanity) is kept.
- `decisions.ts` — the moments the viewing seat decided something, with the state and what was done.
- `state.ts` — derived facts about one state: mana available, land drop, cast this turn.
- `cards.ts` — card text and images from Scryfall, rate-limited, cached in IndexedDB.
- `prompt.ts` — the per-decision coaching prompt (state table + oracle text + deck guide); its answer format asks for a **Rule:** and a **Confidence:** line, and `coachSystem('answer-first')` puts a one-line **Answer:** first (Settings → Answer first).
- `coachAnswer.ts` — reads an answer's **Answer:** / **Rule:** / **Confidence:** lines (the coach panel's head; the bench's calibration).
- `review.ts` — whole-game summary and the post-game review prompt.
- `winChance.ts` + `evalClient.ts` — the win chance (mtg-table D361): the coach helper's `POST /eval` scores one position with a local learned model (`/health` `eval: 1`, `evalModel`, `evalSchema`, read by `coachHelper.ts` `helperEvalOf`, even when Claude Code is not ready). `winChance.ts` picks the positions (the viewing seat's priority in a main phase or combat, as the model's training rows) and builds `{seat, state, history}` — the log's own redacted state plus the earlier frames' events that hold a `turn`/`land`/`cast`/`mulligan` (`src/testdata/winchance-requests.golden.json` is mtg-table's reader over the two samples); drops after the player's decisions (`decisionDrops`, 8 points). UI: `ui/winchance/` (`WinChanceStrip` in PlayView, `WinChanceLine` over GameView's timeline and the engine review's), `winchance.css` on the skins' tokens. Off by default (Settings `winChance`); hidden without a helper model. The model never comes to the browser. mtg-table D368: a helper serving an ensemble (`/health` `evalEnsemble` ≥ 2) answers `sd`/`n` — the strip shows "62% ± 6", the line a faint band; one with `evalExplain: 1` answers `explain: true` with attribution buckets (`evalClient.ts` `explainPosition`) — `useDropWhy` + `dropWhy` (bucket differences between the positions around a fall) give each drop marker, and the film room's turning points, a "Why: your board −9, cards in hand −4" line (`WinDropWhy`). Neither is sent or shown when the helper does not advertise it.
- `feedback.ts` — "Was this advice helpful?": thumbs + optional one-line note per coach answer, keyed by game (`gameId|seed|startedAt`, mtg-table `human_collect.py`'s manifest key), the decision's state-frame `seq` (null: whole game), surface (play / replay / film / review / engine-review) and answer source/model; localStorage `forgecoach.feedback.v1`, never the advice text; JSON export in Settings. UI: `ui/AdviceFeedback.tsx` (AnswerBox's `feedback` prop, FilmRoom cards). The D369 collector reads only the bridge's frame log, so nothing reaches the human test set yet (export only).
- `guide.ts` — user-written deck play guides in localStorage.
- `claude.ts` — browser-side Claude API calls with the user's own key; model list; settings.
- `coachHelper.ts` — coaching with no key: mtg-table's local coach helper (`http://127.0.0.1:8643`, started by `play.sh`; on an engine-served page the page's host, on 8643 or the link's `?coachPort=` that `play.sh --lan --coach-port` adds) runs the logged-in Claude Code CLI; `detectHelper` (cached `/health`), `askHelper` (NDJSON `/coach`), `chooseSource` for Settings' `coachSource` (`auto` | `helper` | `apiKey`). `ui/answers.ts` `startAnswer` is the one entry point that picks the source. The helper queues questions (mtg-table D325): `queued` / `running` NDJSON lines, a `supersedes` key, `/health` `queue`; the play coach stops a stale question when the decision moves on. Settings' `coachThinking` (`default` | `low` | `off`) goes to a helper whose `/health` lists `thinking` (mtg-table D346, `helperThinking`); `Answer.thinkingSince` drives the panel's *thinking…* line (`ui/coachWait.ts`).
- `live.ts` — read-only live follow: follows mtg-table's read-only `/observe` WebSocket
  (default `ws://127.0.0.1:8642/observe`, amendment M50), or polls a growing `frames.jsonl` over HTTP as a fallback. Never uses `/ws` and never sends a frame (see the file header and README § Live watch).
- `play/` — playing a game. `session.ts` owns the seat socket (`/ws`), the growing
  GameLog, current input/ask, and sending acts and answers. `acts.ts` has the
  typed act builders and the guard deciding whether an act may go on the wire.
- `play/tableLog.ts` — a table seat's history across a rejoin: the bridge's catch-up on a connect is a snapshot (`hello_ok`, the latest `state` with only its own batch's events, `table`, `input`, open `ask`), so a page that came back to a friend's table mid-game (reload, a dropped phone tab, Back to the room) used to start its Game Log, turn facts, win-chance history, summary and film room at that turn. A table session (`table: true`) appends every frame its log takes to IndexedDB (keyed by a hash of the seat URL; newest 12 tables, 3 days) and a new session on the same URL loads them before it connects (`tableLogWaitMs`, 2 s); the catch-up's repeats are de-duplicated by `LiveLogBuilder`. Only the log and the c2s seq are restored, never `answered` asks or the board. Play against Forge keeps nothing and connects as before.
- `play/seatUrl.ts` — `defaultSeatUrl(location)` / `servedByEngine(location)`: when the mtg-table bridge serves this site itself (`--lan`, phone play), the seat is same-origin `ws://<host>/ws?token=<T>`; the token is redacted from on-screen text. Site builds with `FORGECOACH_BASE=./` for any path. `servedByTunnel` (mtg-table D408): an `https:` page that is not GitHub Pages, a dev port or loopback came through a Cloudflare tunnel (the bridge serves plain http only), so it is the draft room's page, never the engine's; `coachHelper.ts` then tries only the visitor's own 127.0.0.1 helper (`HelperTarget.tunnel`) and says the coach needs their own API key or helper; the room stream says "reload — your Cloudflare sign-in may have expired" after a sign-in redirect or `SIGNIN_AFTER` failed reconnects (`draft/room.ts` `reconnectNote`). The room owner's **New link for your friend** / **Close room** (`ui/draft/RoomOwnerControls.tsx`, `draft/room.ts` `newFriendLink` / `closeRoom`) go to the coach helper's `POST /room/<id>/friend-link` / `close`, shown only when its `/health` has `roomRevoke: 1`.
- `play/friendTable.ts` + `play/tableView.ts` — play with a friend (mtg-table D402–D404, M59): the draft room (`draft/room.ts` `submitDeck`, state `decks` / `yourDeck` / `game`) hands each seat a seat token per game; `tableFromRoom` makes the seat URL `ws(s)://<room origin>/ws?seat=<token>` (`seatUrl.ts` `tableSeatUrl`: the room passes `/ws` through to the table port, a tunnel routes it there — never `host:<tablePort>`), kept in localStorage for `#play/friend` (App.tsx; no wake, never the remembered seat URL; `over` marks it spent). `session.ts` keeps the `table` frame (`table`, `tableSkewMs`), treats close 4002 (seat opened elsewhere) as terminal, `acts.ts` allows `claimWin` wherever `concede` goes; `tableView.ts` words the board's line (thinking / away / claim the win / your clock). Either seat works; `opponentIsHuman` (protocol.ts) hides AI-only UI (next game, new match, engine review) and `opponent.ts` `systemFor` tells the coach its player faces a friend (default prompts byte-identical). `seatUrl.ts` `servedByRoom`: a page the room served (port 8644 or a saved room's origin) is not the bridge's. E2E against the real room and real Forge: `npm run e2e:table` (`e2e/table.e2e.mjs`, MTG_TABLE, FORGE_JAR).
- `play/aiName.ts` — what the board calls the AI seat: the opponent-AI picker's name for `hello_ok.match.aiPolicy` (mtg-table amendment M56, read with `aiPolicyOf`), else the engine's own name (older engines).
- `play/friendReview.ts` — a game with a friend (mtg-table D406/D407): THIS player's own engine review of a finished game and its own seat log, from the draft room behind this seat's room token (`GET /room/<id>/review/<matchId>`, `/log/<matchId>`); never the other seat's. `ui/play/useFriendReview.ts` follows it on the game-over card; the room screen (`ui/draft/FriendApp.tsx`) lists every game with its review and opens it in `ui/review/ReviewApp` (`report` prop). The room runs a best of three (`match`, `games` in its state; sideboarding is a deck handed in again; the previous game's loser is asked play or draw on the board) and each player opts their own seat in or out of recording per game (`record`; the owner picks the default at room creation). `play/match.ts` reads the table's score from `hello_ok.match.score` (`tableScoreOf`, M60) and says what is next (`tableMatchLine`).
- `ui/` — React components; `main.tsx` mounts the app.
- `pwa/` — the installable site. `icons.ts` draws the icons in code from the favicon's anvil (SVG text; PNGs by a tiny scanline rasterizer + PNG encoder) — no image files are committed; `vitePlugin.ts` (in `vite.config.ts`) emits them under `icons/` at build time (and serves them in dev) and builds `sw.ts` into `sw.js` as a standalone chunk with its precache list (the shell) and a version filled in. `swRoutes.ts` `route(url, method, {origin, base, mode})` is the worker's one routing rule set (tested under `/ForgeCoach/` and an engine origin): page network-first, hashed `assets/` cache-first, cubes/samples/icons/manifest network-first, everything else **passthrough (no respondWith)** — non-GET, cross-origin (Anthropic, Scryfall, raw.githubusercontent), loopback hosts, port 8643, the engine's `/ws` `/observe` `/health` `/match` `/review` `/eval` `/coach`…, the draft room's `/room/…` (D400, also on the room listener's own origin, which serves the site to a friend), and the lab's data. Keep `swRoutes.ts` out of the app's imports (sw.js must stay one chunk; the build fails otherwise). `register.ts` registers it in production builds at `BASE_URL`; `install.ts` keeps `beforeinstallprompt` for Settings → Install (iOS Safari: a Share → Add to Home Screen line; nothing elsewhere). `ui/skin.ts` `THEME_COLOR` sets `<meta name="theme-color">` per skin (tested against the `--bg` tokens). E2E: `e2e/pwa.e2e.mjs` (`npm run test:pwa`, needs full Chromium).
- `ui/skin.ts` + `ui/skins.css` — the skins (Settings → Look, `claude.ts` `skin`: `classic` | `stack` (the default) | `felt`; `?skin=` previews): `data-skin` on `<html>`, tokens plus a few skin-scoped rules. Classic has no rules (renders as before); never redraw cards in a skin.
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
  with a no-meta prior by games — `labValue` — plus, for a nonland card with
  17Lands numbers, the human GIH WR relative to the format average, ×0.8,
  weighted by precision — `cardValue`; adopted by the pre-registered
  split-half test in `docs/human-blend.md`, `npm run human-blend`; synergy;
  the Draft vs AI drafter's ratings and deck use `labValue`/`labOnly`, never
  human data), `builder.ts` (best 40s, reasons,
  cuts, swaps, thin-pool 18-land / three-colour builds, text and `.dck`
  export), `pick.ts` (Grid / Winston advice), `deckPrompt.ts` (deterministic
  deckbuilding coach prompt), `pools.ts` (saved pools, paste parser),
  `cubes.ts` (registry + loading), `metaStore.ts` (imported meta, IndexedDB),
  `photoPool.ts` (photo to pool: the cube-constrained recognition prompt, the
  strict-JSON parser, name matching with fuzzy near-misses, the review rows
  with their "two photos / two copies?" questions, `planAdd`).
  Test data: `cube/testdata/` (Scryfall snapshots of the four cubes, a fake
  meta fixture, helpers).
- `cube/human.ts` — human card numbers from 17Lands (CC BY 4.0, credited in
  NOTICE and on screen): `public/cubes/<file>.human.json` (schema 1: source,
  release date, cube, `minGih`, totals, the pooled GIH average, and per card
  only counts — gih/gihW, oh/ohW, gns/gnsW — keyed by the cube's own names).
  Strict validator, `loadHumanCards` (only cubes with `CubeInfo.humanData`;
  injected fetch), `humanCardView` (GIH WR with a Wilson 95% interval, OH WR,
  IWD; strong/weak only when the interval excludes the **format's average**,
  not 50%), the words and the Arena caveat. Only the Vintage cube ships one
  (Arena's Powered Cube: 152/180 cards; the generator's `MIN_COVERAGE` 0.75
  keeps the unpowered cubes out). Generator: `scripts/human-cards/`
  (`npm run human-cards -- --updated <date> <game_data…csv.gz>`, local copies
  of 17Lands' files; `stats.ts` counts as mtg-table `tools/ml/cards17l.py`,
  D396). UI: `ui/HumanNumbers.tsx` (`useHumanCards`, `HumanCardFacts`,
  `HumanSourceNote`) + `ui/human.css` (a blue rule, never the lab's gold) in
  the pick screen's Lab numbers panel and `CardInfoSheet` (its `cubeId` prop).
  `--half 0|1 --out DIR` splits by draft id for the split-half test
  (`blendTest.ts`, `blendCli.ts`, `npm run human-blend`). `score.ts`
  `cardValue` blends it in (see `cube/` above; `ui/deck/useCubeData.ts` loads it
  into the context via `humanCardsFor`); the card sheet shows
  `humanValueLine`, grid/Winston/booster/builder reasons `humanValueNote`.
- `ui/deck/` — the Draft & build screens (lazy-loaded from `#deck`):
  `DeckApp` (home, pools, workspace, meta import), `PoolView`, `BuildView`
  (builds, score, swaps, export, coach via `answers.ts` `startAnswer`),
  `GridView`, `WinstonView`, `CubeCard`, `sheets` (card picker, card info),
  `PhotoSheet` + `photoImage` (Add from photo: downscale to 1568 px JPEG in
  the browser, read through `startAnswer(…, { need: 'vision' })` — the
  helper's `/vision` (mtg-table D362) or the key's image blocks — then the
  review checklist; nothing enters the pool until the player confirms).
- `draft/` — Draft vs AI (pure, tested in node): `rng.ts`, `weights.ts`,
  `labStats.ts` (the pick screen's Lab numbers panel: taken-when-seen /
  avg pick — or `early` when the lab writes it —, made the 40, deck win rate
  with a Wilson 95% interval, strong/weak only when the interval excludes 0.5,
  per-colour baselines from `colorBaselines` or the archetypes, the
  Forge-vs-Forge caveat and the red over-flag note; UI `ui/draft/LabNumbers.tsx`),
  `pick.ts`, `draft.ts` are mtg-table's cube-lab drafting AI (`tools/cubelab`)
  stepped one decision at a time, plus Booster (2–8 seats); `cards.ts` (the
  AI's card view from `cube/` facts, meta ratings); `deck.ts` (the post-draft
  deck: main, side, basics); `poolView.ts` (collection grouping, curve, colour
  counts); `aiFlags.ts` (AI:RemoveDeck from the cube docs); `pickPrompt.ts`; `gridBlurb.ts` (the grid Hint's "why this line" popover from `recommendGrid`, no model call; UI `ui/draft/GridHint.tsx`, opened from GridBoard's Hint arrow; its "Explain more" asks the coach via `startAnswer` with `gridWhyPrompt.ts`, cached per grid and line);
  `store.ts` (the draft in localStorage); `launch.ts` (mtg-table's match
  launcher, `POST /match`, docs/match-launcher.md there; plain Play vs
  Forge wakes a sleeping engine with `POST /engine/start`, carrying
  `{"aiProfile"}` only when `/health` has `engine_start_profile: 1`, D381 —
  picker `ui/PlayProfile.tsx`, the helper's warnings shown on the board). Hidden information:
  the player only ever sees `knownAiCards`, never the AI's list.
- `draft/room.ts` — Draft with a friend: the client for mtg-table's draft room
  (D400, mtg-table `docs/draft-room.md`). It holds:
  - room creation: `createRoom` through the coach helper's `POST /room` (the
    owner's door) and `roomSupport` (`/health` `draftRoom`, `roomPort`);
  - `RoomClient`, the calls to the room listener (8644): get, join, and a pick
    with `expect: version` — a stale view is a `RoomError` that carries the
    current state;
  - the live stream: SSE read through `fetch` so the seat token can travel in
    the `X-Room-Token` header and never in a URL; it reconnects with backoff
    and reports `gone`;
  - checks on what the server sends: a strict `parseRoomState`, and `cubeHash`
    against the room's;
  - join links, with the token in the `#fragment` (`#draft/friend/join?room=&t=`):
    `joinLink`, `parseJoinHash`, `friendLinks`, `ownerRoomBase`;
  - the pick-screen adapter: `toGridDraft` (you = this seat, `ai` = the friend);
  - the end-of-draft check: `replayMatches`, which re-deals the revealed seed
    with draft.ts and replays every pick;
  - the seats this browser holds, in localStorage `forgecoach.friendRooms.v1`.

  `draft/testdata/grid-golden.json` is the Grid cross-check. It is the same file
  as mtg-table's `fixtures/draft-room/grid-golden.json`, and both draft.ts and
  mtg-table's `tools/draft-room.mjs` must reproduce it.
- `ui/draft/` — Draft vs AI screens (lazy, `#draft`, `#draft/build`,
  `#draft/match`), Draft with a friend (`FriendApp`, lazy, `#draft/friend[/join?…|/r/<id>/<seat>[/build]]`;
  `useFriendRoom`: one seat as a `DraftGame`, so `PickScreen` (its `opponent` prop
  names the friend instead of the AI) and `DeckEditor` are reused unchanged; the
  e2e is `e2e/friend.e2e.mjs`, two browser contexts against the real room) and the
  cube pages (`#cube/<id>`): `PickScreen`,
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
  exporter sample, read as is in the tests). Optional schema-1 `series` (per-night `cubes` rows: games, avgTurns, onPlayWinRate [+ onPlayLo/Hi]; per-night `pairs` rows: games, winRate, lo, hi), null when absent; `lab/trends.ts` lines nights up for the Trends charts (gaps stay gaps). UI: `ui/lab/DataPage.tsx` (lazy) + `data.css`, `ui/lab/TrendChart.tsx` (dependency-free SVG: one axis, bands, crosshair tooltip, legend + end labels, a numbers table).
- `lab/ledger.ts` — the morning report's data (`#lab/report`): the runner's public, allowlisted decision ledger `ledger.json` (schema 1, mtg-table D366's private ledger rebuilt from an allowlist by the runner) on the `lab-status` branch: id, opted-in public title and `public_decides:`, the rule's short form (D-numbers, `gate N`, `*_RULE`), outcome + cause, `checked`, headline numbers, finish time, follow-up ids/templates and states. Strict parser (tokens for ids, metrics, rules, templates; free text cleaned and capped; bad entries dropped and counted), the window (`?since=12h|24h|48h|7d|<time>`, default 24 h), `entryVerdict` (pass only when done with pre-registered checks, fail only when a check or the pilot failed, else no verdict — never stronger than the outcome), deterministic `entrySummary` / `nightSummary` / `reportPrompt`, `followupNow` from status.json. Sample: `public/ledger-sample.json` (made up). UI: `ui/lab/ReportPage.tsx` (lazy, "Overnight" in `LabTabs`) + `report.css`; "Ask the coach to explain this night" via `startAnswer`.
- `gameReview.ts` — mtg-table's engine review report (`docs/game-review.md` there, D353): strict validator to a view model (honesty enforced: an interval including zero is never a mistake; a zero-regret close call is a tie; leaf = short-horizon, not a win rate; `knowledge.opponentModel` basic-lands → warning), log matching, option labels from the redacted state, timeline, and the deterministic `reviewExplainPrompt`. `gameReviewClient.ts` — the helper's `/health` `review: 1`, `POST /review`, `GET /review/<id>`, `runReview` polling (injected fetch). `draft/reviewInput.ts` — `oppPool` / `oppKnown` only for the Draft vs AI match the saved draft launched.
- `filmRoom.ts` — the film room: the three biggest turning points of the viewer's own decisions (score just before a decision → the next scored position after it ends; source: the helper's win chance, else the engine review report, else a labelled life/board/hand heuristic) and a deterministic per-moment coach prompt (prompt.ts's state table, options, what was done, both scores; **Rule:** / **Confidence:**). UI: `ui/filmroom/FilmRoom.tsx` on the game-over card, the replay's Game review tab and the engine review screen.
- `practice/puzzles.ts` — practice puzzles from the player's own games (pure, tested): the film room's turning points plus the engine review's graded calls, one per decision; options are the report's own tokens when graded, else read from the viewer's state (main: playable lands, spells the untapped mana covers, what was played; attack: untapped non-sick creatures); `checkAnswer` (engine: best / tie / close — an interval including zero is never a mistake — / worse only when the interval excludes zero; ungraded: only "as in the game" / "different"); the book in localStorage (`forgecoach.practice.v1`, no boards: the log is re-read); `puzzlePrompt` = film prompt + practice section. UI: `ui/practice/` (`PracticeApp`, lazy `#practice[/<id>]`; `practiceData.ts`: Your record scan, samples, `rememberGame` called by the film room for saved games).
- `ui/review/` — the engine review screen (lazy `ReviewApp`, opened from GameView's top bar, the game-over card, or `#sample=<id>&review=1`): timeline, `OptionBars`, the replay `Board` at `stateFrame`, the coach via `startAnswer`. Sample report: `public/samples/human-auto-42.review.json` (engine-made); tests also use the hand-made `src/testdata/human-auto-42.review.handmade.json`.
- `ambience/` — board scenery (pure, tested in node): `model.ts` (lands → biomes per player, slots by first appearance, growth stages; `SceneryTracker`), `events.ts` (land / creature / attack / damage events), `effects.ts` (spec 1.2 one-shot effects: event → cue, pack or built-in, `EffectQueue` concurrency cap, `effectGate`: live play and normal replay steps fire, jumps and scrubbing cancel), `manifest.ts` (art-pack `scenery.json` schema 1, spec 1.4, strict validator incl. `effects` and `overlay`; 1.4's full-area piece `anchor: "area"` with `fit` / `safe` / `position` / `minWidthPx`, one per stage, its own 3 MB per biome), `pack.ts` (load, preload, fall back to procedural), `prefs.ts` (on by default with ForgeCoach's own art pack, `FORGECOACH_PACK_URL`; Settings, `?scenery=`; `accents`, `?accents=`), `layout.ts`, `sim.ts` (made-up states for `#ambience`), `overlay.ts` (spec 1.3 board accents: corner / edge pieces split by slot, mirrored for the opponent, width fit, caps, built-in placeholders; 1.4 full-area pieces: the dominant biome's, `areaPlacement` = the cover / contain crop that keeps the `safe` rect, `builtinAreaPiece` = `#ambience`'s placeholder only, never on the board). Backward compatibility: `testdata/pack-v2.golden.json` is the 1.3 engine's output for pack-v2's manifest and the built-ins (`overlay-area.test.ts`). UI: `ui/ambience/` — `BoardScenery` (the one overlay hook on PlayView / GameView; lazy-loads `SceneryLayer`, which portals a `SceneryStrip` and, with Settings → Board accents on, a `SceneryOverlay` into each `.battlefield`, both at z-index −1 beneath the cards), `procedural.tsx` (built-in art and effect presets), `SceneryEffects.tsx` (effect renderer), `SceneryOverlay.tsx` + `overlayArt.ts` (accents and their built-in art; a full-area piece goes in its own layer at z-index −2, beneath the strip and its fade), `AmbiencePage` (`#ambience` preview, no engine; View → Full-area accent shows the built-in placeholder; a pasted manifest can be previewed). Contract for art packs: `docs/scenery-pack-spec.md`. Packs are never committed here.
- `public/cubes/` — the four cube documents (Justin's) and the cube lab's
  `<cube>.meta.json` beside each; `vintage-cube-180.human.json` (17Lands,
  `cube/human.ts`).
- `public/samples/` — two gzipped sample logs from mtg-table's fixture corpus.
- `e2e/playtest/` — the full-game playtest (`npm run playtest`, README § Full-game playtest). A UI-only monkey (`monkey.mjs`) reads the engine's offer from the seat socket (`tap.mjs`, Playwright's WebSocket events; it never sends a frame) and clicks the board's control for it. An offered option with no control is an `unreachable-option` finding. `checks.mjs` holds the invariants: stack panel, combat badges, the log through a reload, hidden names in the DOM. `scripts.mjs` (Forge card scripts: priority candidates), `decks.mjs` (cube drafts, `.dck`), `fakehelper.mjs`, `report.mjs`. Modes: `fake` (CI, the fake engine), `solo` (real Forge via POST /match), `table` (the draft room, two browsers, Bo3). Run with `--experimental-transform-types` (the npm script does).
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
npm run playtest -- --mode fake --games 3   # whole games through the UI (fake engine; solo/table need mtg-table)
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
