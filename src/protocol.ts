/*
 * mtg-table — protocol.ts
 * Copyright (C) 2026 the mtg-table authors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Hand-written TypeScript mirror of docs/protocol.md v1 (decision D4: no codegen).
 * CHANGE docs/protocol.md FIRST, then this file, then bridge/src/mtgtable/Snap.java.
 *
 * Section numbers in the comments below are docs/protocol.md section numbers.
 * This file is types + small const tables only: no runtime logic, no IO.
 *
 * 2026-09-11 — the hidden-information amendments (docs/research/06 §6, 07 §1):
 *   P1  the redacted stub gains `owner` — five keys, still no identity.
 *   P2  `library` gains `cards`: the library cards a continuous "may look"
 *       effect reveals, never a stub, never completing the count.
 *   P3  face-down cards are read from `getCurrentState()` and carry an `alt`
 *       block only when `canFaceDownBeShownTo(viewer)`.
 *   P4  four new event kinds (scry, surveil, phased, foretold); the engine's
 *       free-text accessors stay banned.
 *   P5  a `hidden` card REPLACES the client's card for that id; ids are stable
 *       across zone changes, so merging is a leak (see reduce.ts).
 *   P6  the `open_zones` ask kind is deleted — eleven kinds remain.
 *   P7  ask options are ask-local indices with an optional serialised card.
 *   P15 `Card.token`.
 *
 * 2026-09-12 — **M6 promotes §10's planned additions to live protocol**
 * (report 11 §10; `docs/protocol.md` §10 → §2.1 / §2.2 / §3 / §4). The ids are
 * the real amendment ids from docs/protocol.md's Amendments table, exactly as
 * P4/P5/P6/P7/P15 above are: M1..M8 are M1-era amendments about something else
 * entirely (M1 gates notice strings, M5 empties `abilities`, M8 is the
 * `selectable`-is-not-the-clickable-set rule), and numbering this block 1..8
 * sent a reader to the wrong row of the shared contract file.
 *   M32 `players[].phaseStops: {own, opp}` — the two columns of Forge's own
 *       phase strip, answered from `WireGuiGame`'s map, never from `FPref`.
 *   M33 `setPhaseStop {phase, turn, stop}` — keyed by `turn`, not by player.
 *   M34 `state.yield` — which of the three engine yields is running.
 *   M35 `state.undo {can, depth}` — mana abilities only (report 11 §7).
 *   M36 `stack[].yieldKey` (an opaque **bridge-minted handle**, never rendered),
 *       plus `isAbility`, `isOptionalTrigger`, `yielded`.
 *   M37 acts `yieldTo`, `setYield {yieldKey, mode}`, `newGame {mode}`;
 *       `passPriority` and `undo` go live.
 *   M38 a new `hello_ok` per game; a changed `gameId` invalidates every id.
 *   M39 `input.buttons.focus` — which button SPACE activates (§4).
 *   M40 `sideboard` is reachable; `UI_MANA_LOST_PROMPT` is on by default.
 *   M41 `hello_ok.gameNumber` / `.gameCount` — "Game 2 of 3" from the bridge,
 *       because the client's own count restarts at 1 on a page reload.
 *
 * 2026-09-27 — **match setup** (`docs/protocol.md` §2.1):
 *   M44 `hello_ok.match` — each seat's deck by NAME, the AI's profile and the
 *       match length. The AI's deck is `{name, cards}` and nothing else (hard
 *       rule 8). Optional, like every field above: the whole committed corpus
 *       predates it. `seatMatchOf` is its one reader.
 *
 * 2026-09-28 — **spectating** (`docs/protocol.md` §2.1, §8.1):
 *   M47 `RecordMatch` writes `hello_ok.match` when given a match setup, plus
 *       `match.yourProfile` — the VIEWING seat's own profile, present only when
 *       that seat is an AI — and the session header's optional `paceMs`.
 *       `seatMatchOf` still reads the block; `matchupOf` composes it for the
 *       arena's "watching" line.
 *
 * 2026-10-03 — **the AI's policy** (`docs/protocol.md` §2.1):
 *   M56 `hello_ok.match.aiPolicy` — who answers for the AI seat, MtgTable's
 *       `--ai-policy` (`plain` | `outlets` | `search`), so a client can name
 *       the AI the player chose. Optional: written by `mtgtable.MtgTable` only,
 *       absent from every older stream and from AI-vs-AI recordings.
 *       `aiPolicyOf` is its one reader.
 *
 * 2026-10-06 — **a table of two** (`docs/protocol.md` §2, §2.1, §2.2, §8.1):
 *   M59 `MtgTable --humans 2`: two people, no AI, each seat its own stream on
 *       the table port behind a seat token. A new s→c frame, `table` — who is
 *       at the table, whose decision it is and its clock, and whether this
 *       seat may claim the win (`TableBody`); `hello_ok.match` in its
 *       two-person form (`opponentDeck`, `opponent: "human"`, no `aiDeck` /
 *       `aiProfile` / `aiPolicy`); the act `claimWin`; the session header's
 *       `humans: 2`. `opponentIsHuman` is the one reader of the form.
 *   M60 a best of three at a table of two (D406): `hello_ok.gameNumber` /
 *       `gameCount` and `match.games: 3` with `match.score` (`{you, opponent}`,
 *       the games won before this one, `tableScoreOf` reads it); the session
 *       header's `record`, the seat's consent to recording this game (D407).
 *
 * 2026-10-07 — **what the seat may play from outside the battlefield**
 * (`docs/protocol.md` §3, §3.1):
 *   M61 `state.playable` (D413): at the seat's own priority, each of its own
 *       cards in hand, graveyard, exile, command zone or on top of its library
 *       that Forge would play or activate on a click now, with the abilities
 *       Forge kept (`{abilityId, label, isSpell}`); `null` off the seat's
 *       priority; absent before M61 and in AI-vs-AI recordings. A click is
 *       still `clickCard` (Forge asks its own `ability_menu` when there is more
 *       than one). `playableOf` is its one reader.
 *
 * 2026-10-09 — **what the seat may activate on the battlefield**
 * (`docs/protocol.md` §3, §3.1):
 *   M63 `state.activatable` (D420): at the seat's own priority, each permanent
 *       it controls with a non-mana ability Forge would activate on a click now
 *       (loyalty abilities, equip, crew, a Clue's sacrifice…), with those
 *       abilities (`{abilityId, label, isSpell: false}`), `zone` always
 *       `battlefield`; `null` off the seat's priority; absent before M63 and in
 *       AI-vs-AI recordings. A separate key, so `playable` keeps its meaning. A
 *       click is still `clickCard`. `activatableOf` is its one reader.
 *
 * 2026-10-10 — **a yield to the opponent's next move, and what an input has
 * chosen** (`docs/protocol.md` §2.2, §3.1, §4):
 *   M64 `yieldTo {kind: "endStepOrOpponent"}` (D421): pass priority until an
 *       opponent acts — an item they control goes on the stack, or they attack
 *       this seat or its permanents — or the current turn's end step begins,
 *       whichever is first; the seat then gets priority there, even when its
 *       stops skip that end step. `state.yield.kind` names it while it runs
 *       (`playerId` the turn player, `phase: "END_OF_TURN"`). Refused with
 *       `notice {title: "yieldTo"}` in the end step and cleanup.
 *   M65 `input.selectable.chosen` (D422): what the seat has already chosen in
 *       the input that is up — `{cardIds, playerIds, blocks, attacks}`; `null`
 *       when no selection is up or the bridge cannot say. `chosenOf` is its
 *       one reader.
 *   M66 `input.selectable.playerIds` (D423): the players a click would be
 *       taken for in that input; `[]` when a player click does nothing there;
 *       `null` when the bridge cannot say. `selectablePlayersOf` is its one
 *       reader.
 *   All three are absent before M64–M66: a reader treats absent as "this
 *   frame does not say", never as "none".
 *
 * 2026-10-10 — **the bridge is the rules gate for combat damage**
 * (`docs/protocol.md` §5.2, §5.3):
 *   M67 `assign_damage.defenderAllowed` and `assign_damage.reason` (D424): may
 *       target 0, the defender, take damage (Forge's own rule: trample, or
 *       "divided as you choose" with `overrideOrder`); and why the bridge
 *       refused the last answer (`null` on a first asking — a refused answer is
 *       never applied, the same question comes again under a new `askId`).
 *       `targets[].lethal` is now the damage Forge's dialog counts as lethal
 *       (deathtouch, planeswalkers and damage already assigned included).
 *       Absent before M67. `assignDamageRuleOf` is their one reader.
 *
 * **Every M6 field is declared optional here**, and that is not defensiveness
 * for its own sake: fifteen committed recordings predate them,
 * `web/test/render.test.tsx` folds every frame of all of them, and a required
 * key would make each one a type error and a runtime `undefined` in the
 * renderer. A live M6 bridge writes all of them; the readers below
 * (`phaseStopsOf`, `yieldOf`, `undoOf`, `buttonFocus`, `stackYield`) are the
 * one place the absence is turned into "this recording predates the field".
 */

/** §1. Protocol major. `reduce()` throws on a frame whose `v` differs from this. */
export const PROTOCOL_VERSION = 1;

/** §8.2. Direction marker present on every line of a frame log; absent on the wire. */
export type Direction = 's2c' | 'c2s';

// ---------------------------------------------------------------------------
// §1 Envelope
// ---------------------------------------------------------------------------

/**
 * §2. The frame types: 7 server→client, 4 client→server (ping/pong both).
 * `table` (amendment M59) is sent only at a table of two.
 */
export const FRAME_TYPES = [
  'hello_ok',
  'state',
  'input',
  'ask',
  'notice',
  'over',
  'table',
  'act',
  'answer',
  'resync',
  'ping',
  'pong',
] as const;
export type FrameType = (typeof FRAME_TYPES)[number];

/**
 * §1. Every frame, both directions, is exactly this object. `dir` is the one
 * extra field a frame-log line carries (§8.2); it is absent on the wire.
 */
export interface Envelope<T extends FrameType, B> {
  /** Protocol major version. */
  v: number;
  /** Monotonic counter, per direction, starting at 1. Gaps mean a dropped frame. */
  seq: number;
  /** Epoch milliseconds when the frame was produced. */
  t: number;
  type: T;
  body: B;
  /** §8.2 — frame logs only. */
  dir?: Direction;
}

/** A body with no fields (`resync`, `ping`, `pong`). */
export type EmptyBody = Record<string, never>;

// ---------------------------------------------------------------------------
// §2.1 hello_ok (s→c)
// ---------------------------------------------------------------------------

export interface PlayerIdentity {
  id: number;
  name: string;
  isAi: boolean;
}

export interface HelloOkBody {
  gameId: string;
  /** The viewing player's id — the seat every redaction in this stream was made against. */
  you: number;
  seed: number | null;
  forgeVersion: string;
  forgeJarSha256: string;
  /** Whatever `Match.prepareAllZones` → `revealUnsupported` complained about. */
  unsupportedCards: string[];
  players: PlayerIdentity[];
  /**
   * §2.1, amendment **M41** — which game of the match this is, 1-based, and how
   * many the match is played to (`--games N`). A live bridge writes both
   * whenever the match is more than one game, and **omits both for `--games 1`**:
   * a one-game session has no "where in the match", which is also why
   * `gameLabel()` prints nothing for it.
   *
   * Optional because **every recording made before 2026-09-12 predates them**,
   * and `web/test/render.test.tsx` folds every frame of all of them: a required
   * key would make each one a type error and a runtime `undefined` in the
   * renderer. `gameLabel()` in reduce.ts is the one place the absence is turned
   * into "this stream predates the field" — it falls back to its own count of
   * distinct `gameId`s, which restarts at 1 on a page reload and can never say
   * *of 3*. That fallback is why M41 exists, not a reason it does not.
   */
  gameNumber?: number;
  gameCount?: number | null;
  /**
   * §2.1, amendment **M44** — what this match is. Optional: **every recording
   * made before 2026-09-27 predates it**, and `RecordMatch` (AI vs AI) writes
   * it only when given a match setup (amendment **M47**, a spectated game). Read it with {@link seatMatchOf}, never directly: absent is
   * "this stream does not say", which a component must not draw as an empty
   * deck name.
   */
  match?: MatchSetup | null;
}

/** §2.1 (M44) — one deck, as the wire names it: never a path for the AI's. */
export interface MatchDeck {
  /** The `.dck` file's `[metadata] Name=`, or its base name when it has none. */
  name: string;
  /** The main deck's card count — public for every seat (§8.1). */
  cards: number;
}

/** §2.1 (M44) — `hello_ok.match`. */
export interface MatchSetup {
  /** The VIEWING seat's deck; `path` is the one §8.1's header already carries. */
  yourDeck: MatchDeck & { path: string };
  /**
   * The other seat's deck: `{name, cards}` and NOTHING else (hard rule 8).
   * Absent at a table of two (M59), where it is {@link opponentDeck}.
   */
  aiDeck?: MatchDeck;
  /**
   * A Forge AI profile: `Default` / `Cautious` / `Reckless` / `Experimental` in
   * 2.0.14. Absent at a table of two (M59): the other seat is a person.
   */
  aiProfile?: string;
  /**
   * §2.1, amendment **M59** — at a table of two, the other PERSON's deck:
   * `{name, cards}` and nothing else, exactly as `aiDeck` (hard rule 8).
   */
  opponentDeck?: MatchDeck;
  /** §2.1, amendment **M59** — `"human"` at a table of two; absent when the other seat is the AI. */
  opponent?: 'human';
  /** `--games N`. Always present, unlike M41's `gameCount`. At a table of two: 1, or 3 (M60). */
  games: number;
  /**
   * §2.1, amendment **M60** — a game of a best of three at a table of two: the
   * games each side won BEFORE this one, from the viewing seat's side. Present
   * exactly when `games` is 3. Read it through {@link tableScoreOf}.
   */
  score?: { you: number; opponent: number };
  /**
   * §2.1, amendment **M47** — the VIEWING seat's own Forge AI profile. Written
   * only by `mtgtable.RecordMatch` (AI vs AI, a spectated game), because only
   * there is the viewing seat an AI; `tools/check-redaction.mjs` fails it on a
   * stream whose `players[]` marks the viewer human. Optional: every M44 stream
   * lacks it. Read it through {@link seatMatchOf}.
   */
  yourProfile?: string;
  /**
   * §2.1, amendment **M56** — who answers for the AI seat: MtgTable's
   * `--ai-policy`, `plain` (Forge's own AI), `outlets` (with the
   * sacrifice-outlet policy) or `search` (the look-ahead search). Optional:
   * absent from every stream before 2026-10-03 and from `RecordMatch`'s. Read
   * it through {@link aiPolicyOf}.
   */
  aiPolicy?: string;
}

/** §2.1 (M56) — the AI seat's controller, as `--ai-policy` names it. */
export type AiPolicy = 'plain' | 'outlets' | 'search';

/** The three {@link AiPolicy} values, in `--ai-policy`'s order. */
export const AI_POLICY_IDS: readonly AiPolicy[] = ['plain', 'outlets', 'search'];

/**
 * §2.1, amendment **M56** — **the one reader of `hello_ok.match.aiPolicy`.**
 * Returns the policy when the handshake names one of the three, and `null`
 * otherwise: a stream from before M56 (or an AI-vs-AI recording) does not say
 * which AI played, so a caller keeps whatever it said before rather than
 * guessing `plain`. An unknown word is `null` too, never echoed.
 */
export function aiPolicyOf(hello: HelloOkBody | null | undefined): AiPolicy | null {
  const p = hello?.match?.aiPolicy;
  return typeof p === 'string' && (AI_POLICY_IDS as readonly string[]).includes(p) ? (p as AiPolicy) : null;
}

/**
 * §2.1, amendment **M60** — the one reader of `hello_ok.match.score`: the games
 * the viewing seat and the other person won before this one, or `null` when the
 * stream does not say (not a best of three at a table, or a malformed value).
 */
export function tableScoreOf(hello: HelloOkBody | null | undefined): { you: number; opponent: number } | null {
  const sc = hello?.match?.score;
  const ok = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 2;
  return sc && typeof sc === 'object' && ok(sc.you) && ok(sc.opponent) ? { you: sc.you, opponent: sc.opponent } : null;
}

/**
 * §2.1, amendment **M59** — the one reader of the two-person form: is the other
 * seat a person? True when `hello_ok.match.opponent` is `"human"` (or, for a
 * stream without a match block, when `players[]` marks no seat an AI and there
 * are two of them). Everything a client says about "the AI" hangs on this.
 */
export function opponentIsHuman(hello: HelloOkBody | null | undefined): boolean {
  if (hello === null || hello === undefined) return false;
  if (hello.match?.opponent === 'human') return true;
  return hello.match === undefined && Array.isArray(hello.players) && hello.players.length === 2
    && hello.players.every((p) => p.isAi === false);
}

/** What one seat's plate says about the match (M44). */
export interface SeatMatch {
  /** This seat's deck name, or `null` when the wire does not say. */
  deck: string | null;
  /**
   * The seat's AI profile — on a seat `players[]` marks `isAi` only; `null` on a
   * human seat and when absent. The other seat's comes from `aiProfile` (M44),
   * the viewing seat's from `yourProfile` (M47, a spectated recording).
   */
  aiProfile: string | null;
}

/**
 * §2.1 (M44) — **the one reader of `hello_ok.match`.** The viewing seat gets
 * `yourDeck`, every other seat `aiDeck`; the profile is printed only for a seat
 * `players[]` marks `isAi`, because a profile is a fact about the AI — the other
 * seat's is `aiProfile`, and the viewing seat's is `yourProfile` (amendment
 * **M47**), which only a spectated recording carries because only there is the
 * viewer an AI. Returns `null` for a stream that carries no `match` — every
 * recording made before 2026-09-27 — so a plate draws nothing rather than a
 * blank deck name, and a seat the handshake does not know gets `null` too.
 */
export function seatMatchOf(hello: HelloOkBody | null | undefined, playerId: number): SeatMatch | null {
  const m = hello?.match;
  if (hello === null || hello === undefined || m === undefined || m === null || typeof m !== 'object') {
    return null;
  }
  const player = hello.players.find((p) => p.id === playerId);
  if (player === undefined) return null;
  const mine = playerId === hello.you;
  const deck = mine ? m.yourDeck : (m.opponentDeck ?? m.aiDeck);   // M59: a person's deck at a table of two
  const name = typeof deck?.name === 'string' && deck.name.trim() !== '' ? deck.name : null;
  const raw = mine ? m.yourProfile : m.aiProfile;
  const profile = player.isAi && typeof raw === 'string' && raw !== '' ? raw : null;
  return { deck: name, aiProfile: profile };
}

/** One seat of {@link Matchup}: who sits there and what they play, from the handshake alone. */
export interface MatchupSeat {
  id: number;
  /** `players[].name` — the engine's lobby name (`AI-Seat0`), never a deck. */
  name: string;
  isAi: boolean;
  /** This seat is the one the stream was redacted for (`hello_ok.you`). */
  you: boolean;
  /** {@link seatMatchOf}'s answer for this seat; `null` when the stream does not say. */
  match: SeatMatch | null;
}

/** What a spectator is watching (amendment M47): every seat, and whether anyone at the table is human. */
export interface Matchup {
  /** The viewing seat first, then the rest in `players[]` order. */
  seats: MatchupSeat[];
  /** No seat is human: an AI-vs-AI stream — a recording with nobody at the keyboard. */
  aiOnly: boolean;
}

/**
 * **What is being watched** — every seat of the handshake with its deck and
 * profile, for the arena's "watching" line (spectating, amendment M47). It is
 * {@link seatMatchOf} per seat and nothing else, so `hello_ok.match` keeps ONE
 * reader and the line can print no key the reader would have refused (a path on
 * the other seat's deck, D105). Returns `null` before the handshake. Names and
 * labels only — nothing here is ever a card.
 */
export function matchupOf(hello: HelloOkBody | null | undefined): Matchup | null {
  if (hello === null || hello === undefined || !Array.isArray(hello.players)) return null;
  const ordered = [...hello.players].sort((a, b) => Number(b.id === hello.you) - Number(a.id === hello.you));
  const seats = ordered.map((p) => ({
    id: p.id,
    name: p.name,
    isAi: p.isAi,
    you: p.id === hello.you,
    match: seatMatchOf(hello, p.id),
  }));
  return { seats, aiOnly: seats.length > 0 && seats.every((s) => s.isAi) };
}

// ---------------------------------------------------------------------------
// §3 state
// ---------------------------------------------------------------------------

/** §3.1. Zone keys are exactly these six. */
export const ZONE_NAMES = [
  'hand',
  'battlefield',
  'graveyard',
  'exile',
  'command',
  'library',
] as const;
export type ZoneName = (typeof ZONE_NAMES)[number];

/** Every zone except `library` carries its cards. */
export interface CardZone {
  count: number;
  cards: AnyCard[];
}

/**
 * §3.4, **amended** (report 06 §0.4 / §6.3). A library is still a `count` — but
 * it now also carries the cards a *continuous* effect lets the viewer see.
 *
 * Future Sight, Bolas's Citadel, Experimental Frenzy and Oracle of Mul Daya call
 * `Card.addMayLookAt` from a static ability: nothing blocks, so there is no
 * `ask` for those cards to ride on, and under the old "a library is a count and
 * nothing else" rule they were invisible forever.
 *
 * Two invariants, both asserted by `tools/check-redaction.mjs` (A3):
 *
 * - `cards` holds **only** library cards for which `canBeShownTo(viewer)` is
 *   true. It is never a redacted stub and never completes the count.
 * - `count` is the **full** library size, so `cards.length <= count` always.
 *
 * `cards` is **not optional**. Every emitter writes it, every committed
 * recording carries it (`[]` in an ordinary game), and
 * `tools/check-redaction.mjs` fails a file whose library lacks it. It was
 * optional for one afternoon, while `fixtures/synthetic/sample-handwritten.jsonl`
 * still predated the amendment, and the cost was every reader in `web/` guarding
 * a key that cannot be absent — the pattern CLAUDE.md rule 10 bans outright on
 * the Java side ("the renderer never tests for key absence").
 */
export interface LibraryZone {
  count: number;
  cards: Card[];
}

export interface Zones {
  hand: CardZone;
  battlefield: CardZone;
  graveyard: CardZone;
  exile: CardZone;
  command: CardZone;
  library: LibraryZone;
}

/** §3.1. All six keys are always present, zeros included. */
export interface ManaPool {
  W: number;
  U: number;
  B: number;
  R: number;
  G: number;
  C: number;
}

export const MANA_COLORS = ['W', 'U', 'B', 'R', 'G', 'C'] as const;
export type ManaColor = (typeof MANA_COLORS)[number];

/**
 * §3.3 (**M6**, report 11 §3) — the phase stops of one seat, as the two columns
 * Forge's own phase strip draws.
 *
 * `own` is "stop here when it is **this player's** turn" (`FPref.PHASES_HUMAN`
 * for the local seat), `opp` "when it is the other seat's" (`FPref.PHASES_AI`).
 * Two lists and not one, because Forge really does hold 24 booleans in a
 * two-player game: *stop at MAIN1 on my turn* and *stop at MAIN1 on theirs* are
 * separate switches (`CMatchUI.actuateMatchPreferences`, report 11 §3.2).
 *
 * Values are `PhaseType` names, exactly as {@link GameStateBody.phase} spells
 * them. The client never derives one: it renders the list and sends
 * {@link SetPhaseStopAct}, and the next `state` says what happened.
 */
export interface PhaseStops {
  own: string[];
  opp: string[];
}

export interface PlayerState {
  id: number;
  name: string;
  isAi: boolean;
  life: number;
  poison: number;
  /** Counter name → count. Poison is broken out because the UI always shows it. */
  counters: Record<string, number>;
  manaPool: ManaPool;
  zones: Zones;
  /**
   * §3.3 (M6). Absent in every recording made before 2026-09-12 — read it with
   * {@link phaseStopsOf}, which answers `null` for those rather than `{own:[],
   * opp:[]}`: "this bridge does not carry stops" and "this seat stops nowhere"
   * are different facts and the strip draws them differently.
   */
  phaseStops?: PhaseStops;
}

/**
 * §3 (M6) — which engine yield is running (report 11 §4.1). `endStepOrOpponent`
 * is amendment **M64** (D421): absent from every stream before it.
 */
export const YIELD_KINDS = ['endOfTurn', 'marker', 'stack', 'endStepOrOpponent'] as const;
export type YieldKind = (typeof YIELD_KINDS)[number];

/**
 * §3 (M6, report 11 §4.4). The active pass-to, straight off `YieldController`:
 * `SetAutoPassUntilEndOfTurn` → `endOfTurn`, `SetMarker` → `marker` (with the
 * marked seat and phase), `StackYield` → `stack`. `null` when none is running.
 * **M64**: `endStepOrOpponent` — a yield to the turn's end step that an
 * opponent's action ends first; `playerId` is the turn player, `phase`
 * `"END_OF_TURN"`.
 *
 * Forge enforces **one at a time** (`YieldController:127-158`), so this is one
 * object and not three flags. Every one of them is cancelled by the engine's own
 * Cancel button while `InputLockUI` is up — there is no `cancelYield` act, and
 * inventing one would be a second path into `clearActiveYieldAndDispatch`.
 */
export interface YieldState {
  kind: YieldKind;
  /** The seat the marker belongs to (M64: whose end step); `null` for a yield that names no seat. */
  playerId: number | null;
  /** The marked `PhaseType` (M64: `"END_OF_TURN"`); `null` for `endOfTurn` and `stack`. */
  phase: string | null;
}

/**
 * §3 (M6, report 11 §7). `PlayerControllerHuman.canUndoLastAction()` and
 * `MagicStack.getUndoStackSize()`, both read on the game thread.
 *
 * **It undoes mana abilities, not spells** — the undo stack only ever receives
 * `SpellAbility`s for which `isUndoable()` holds, and it is cleared on every
 * phase change and the moment priority leaves this seat. The UI must not promise
 * more than that.
 */
export interface UndoState {
  can: boolean;
  depth: number;
}

/** §3.2. An ability as the engine offers it. `canPlay` is the engine's own answer. */
export interface CardAbility {
  id: number;
  text: string;
  canPlay: boolean;
  isSpell: boolean;
}

/**
 * §3.2 (report 06 §6.2, amendment P3). The real face of a face-down card, and
 * the **only** place `CardView.getAlternateState()` may reach the wire.
 *
 * The bridge emits it only when `cv.isFaceDown() && cv.canFaceDownBeShownTo(me)`
 * — Forge's own "you may look at face-down permanents you control" predicate
 * (`CardView.java:688-704`), the same one `AbstractGuiGame.mayFlip` uses. Every
 * other card on the wire is read from `getCurrentState()` alone, whose name for
 * a face-down card is `""` (`CardUtil.getFaceDownCharacteristic`).
 *
 * So: `alt` present ⇒ this seat is entitled to flip the card. It is how a viewer
 * sees their **own** morph, which M1 could not do at all.
 */
export interface AltFace {
  name: string;
  manaCost: string | null;
  /** A string, `""` if Forge has nothing — never `null`, like {@link Card.types}. */
  types: string;
  power: string | null;
  toughness: string | null;
}

/** §3.2. A card the viewer is allowed to see. */
export interface Card {
  /** Forge's `CardView` id; stable for the life of the game. The only identity we have. */
  id: number;
  name: string;
  setCode: string | null;
  /**
   * `"{1}{W}"`, or **`null` for a card with no mana cost** (every land, every
   * token). Never `""`, and never Forge's internal `"no cost"` display string —
   * §3.2 pins this, and the bridge emits it through `ManaCost.isNoCost()`.
   */
  manaCost: string | null;
  /**
   * Forge's `CardType.toString()` verbatim (a plain hyphen, not an em dash).
   * Always a string, never `null` — and **`""` for a face-down card outside the
   * battlefield and the stack** (report 06 §1.4 / amendment P3):
   * `CardStateView.getType()` returns `CardType.EMPTY` there, and the "2/2
   * Creature" of `CardUtil.getFaceDownCharacteristic` is an artifact of the
   * face-down state object rather than a rules fact. `""` is the same spelling
   * §3.2 already uses for "Forge has nothing here", so the renderer has one
   * absence to handle rather than two.
   */
  types: string;
  /**
   * Strings, because `"*"` and `"1+*"` are real values. Both are `null` for a
   * face-down card outside battlefield/stack, for the reason on {@link types}.
   */
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  /**
   * §3.2 (**amendment M49**, the status layer). The card's keyword abilities as
   * the engine has them now — each a `forge.game.keyword.Keyword` constant's
   * `name()` (`"FLYING"`, `"FIRST_STRIKE"`), with no parameter, never a display
   * string. `[]` on every face-down card. **Optional**: absent from every
   * recording made before 2026-09-28 — read it with {@link keywordsOf}, never by
   * testing for the key.
   */
  keywords?: string[];
  damage: number;
  counters: Record<string, number>;
  tapped: boolean;
  /** Summoning sickness. */
  sick: boolean;
  attacking: boolean;
  blocking: boolean;
  faceDown: boolean;
  /**
   * §3.2 (amendment P15, `CardView.isToken()` — javap-confirmed). A token has a
   * card id like any other permanent but no printing behind it, so `art.json`
   * can never have an entry for it and a miss is expected rather than a gap in
   * the art index.
   */
  token: boolean;
  /**
   * The card's real face, **only** when this seat may look at it (see
   * {@link AltFace}). `null` for every face-up card and for every face-down card
   * this seat may not flip — which is how an opponent's morph stays a 2/2 with
   * no name.
   */
  alt: AltFace | null;
  attachedToId: number | null;
  attachmentIds: number[];
  /**
   * §3.2. A number for a card in a player zone, where the bridge's fallback
   * hint is that zone's own player. **`null` is possible only on
   * `state.stackCards`**, where the hint is
   * `StackItemView.getActivatingPlayer()` — the same nullable accessor that
   * makes `StackItem.controller` nullable. Guard it the same way.
   */
  controller: number | null;
  owner: number | null;
  zone: string;
  abilities: CardAbility[];
  /** Present only so the union below discriminates; never emitted as `true` here. */
  hidden?: false;
  /** Present only so the union below discriminates; never emitted as `true` here. */
  faceDownHidden?: false;
}

/**
 * §3.3, gate 1 (`canBeShownTo`). A card the viewer may not see **at all**:
 * exactly **five** keys and nothing else (amendment P1, report 06 §6.1).
 *
 * `owner` joined the stub because `canBeShownTo`'s `case Hand` compares against
 * `getController()` (`CardView.java:646-650`) while the zone arrays are keyed by
 * the zone's *player*: when the two diverge — Gonti, a stolen permanent — the
 * client otherwise cannot tell whose card it is looking at. An owner id is not
 * identity-bearing; a name is.
 */
export interface RedactedCard {
  id: number;
  zone: string;
  /** §3.2 — `null` only on `state.stackCards`; see {@link Card.controller}. */
  controller: number | null;
  /** §3.3 — the fifth key (P1). `null` only where `controller` may be null. */
  owner: number | null;
  hidden: true;
  /** Present only so the union discriminates; never emitted. */
  faceDownHidden?: false;
}

/**
 * **Superseded (amendment P3), still accepted.** The eleven-key `faceDownHidden`
 * shape M1 invented for a face-down permanent.
 *
 * The amendment replaces it: a face-down card now takes the ordinary
 * full-fields branch read from `getCurrentState()` — whose name is `""`, whose
 * type is `Creature` and whose P/T is 2/2, i.e. exactly what every player at the
 * table can see — carrying `faceDown: true` and an {@link AltFace} `alt` block
 * *only* when this seat may flip it. One shape fewer, one gate more.
 *
 * **Nothing in the repo emits this any more** — not the bridge, not
 * `tools/make-sample-fixture.mjs`, and `tools/check-redaction.mjs` fails any
 * file that carries one (its own negative control is
 * `fixtures/negative/redaction/p3-facedownhidden-revived.jsonl`). The type stays
 * only so a log recorded before 2026-09-11 still replays instead of being read
 * as a full card. `isHidden` covers it, so nothing downstream can accidentally
 * treat one as identifiable.
 */
export interface FaceDownCard {
  id: number;
  zone: string;
  /** §3.2 — `null` only on `state.stackCards`; see {@link Card.controller}. */
  controller: number | null;
  faceDownHidden: true;
  /** Present only so the union discriminates; never emitted. */
  hidden?: false;
  tapped: boolean;
  attacking: boolean;
  blocking: boolean;
  damage: number;
  counters: Record<string, number>;
  power: string | null;
  toughness: string | null;
}

export type AnyCard = Card | RedactedCard | FaceDownCard;

/**
 * §3.3. **The** predicate: is this card's identity concealed from the viewer?
 * True for both concealed shapes, so anything that must not leak an identity
 * (art lookup, a name in a label) has one thing to ask and cannot pick the
 * wrong gate.
 */
export function isHidden(card: AnyCard): card is RedactedCard | FaceDownCard {
  return card.hidden === true || card.faceDownHidden === true;
}

/** §3.3 gate 1 only — the five-key stub. Use {@link isHidden} unless you mean this. */
export function isRedacted(card: AnyCard): card is RedactedCard {
  return card.hidden === true;
}

/**
 * The superseded `faceDownHidden` shape (see {@link FaceDownCard}) — true only
 * for a pre-amendment recording. New logs express the same card as a
 * `faceDown: true` {@link Card} with no {@link AltFace}.
 */
export function isFaceDownHidden(card: AnyCard): card is FaceDownCard {
  return card.faceDownHidden === true;
}

/**
 * Is this card face down, in either spelling? True for the superseded
 * `faceDownHidden` shape and for a full {@link Card} with `faceDown: true`.
 *
 * A face-down card is **not** necessarily concealed: the viewer's own morph
 * comes through as a full card with an {@link AltFace}. Ask {@link isHidden} for
 * "may I name this", and this for "is it face down on the table".
 */
export function isFaceDown(card: AnyCard): boolean {
  return card.faceDownHidden === true || (card as Card).faceDown === true;
}

/**
 * The card's real face when this seat may look at it, else `null`
 * (amendment P3). The one accessor anything that renders a morph should use —
 * it is impossible to reach `alt` on a concealed shape through it.
 */
export function altFace(card: AnyCard): AltFace | null {
  if (isHidden(card)) return null;
  return (card as Card).alt ?? null;
}

/**
 * **Amendment M49 — the ONE reader of `Card.keywords`.** The card's keyword
 * constants, or `[]`:
 *
 *  - for a redacted stub and for any face-down card, whatever it carries — a
 *    concealed card shows no keyword on any surface (hard rule 8's renderer
 *    half; the bridge already writes `[]` there, and this is the second lock);
 *  - for a recording made before M49, which has no key at all — an absent list
 *    draws no icon, exactly like an empty one, so (like {@link undoOf}) there is
 *    nothing a renderer could usefully draw differently;
 *  - for anything that is not an array of strings.
 *
 * A component must not test for the key itself (M6 convention 1's rule, for a
 * single field). The client maps a constant to an icon and a label; it never
 * decides what a keyword does.
 */
export function keywordsOf(card: AnyCard | null | undefined): readonly string[] {
  if (card === null || card === undefined || isHidden(card) || isFaceDown(card)) return NO_KEYWORDS;
  const keywords = (card as Card).keywords;
  if (!Array.isArray(keywords)) return NO_KEYWORDS;
  return keywords.every((k) => typeof k === 'string') ? keywords : keywords.filter((k) => typeof k === 'string');
}

const NO_KEYWORDS: readonly string[] = Object.freeze([]);

/** §3.1. `"player"` or `"card"` (planeswalkers, battles). */
export interface EntityRef {
  kind: 'player' | 'card';
  id: number;
}

/** §3. Stack items are ordered bottom first; the last element resolves next. */
export interface StackItem {
  /**
   * Forge's `StackItemView` id. §10.1: this is a **different id space** from
   * `Card.id` and the two collide (g1.jsonl has a hidden card #56 and a stack
   * item #56 in the same frame). Never key one map on both; never resolve a
   * `stack[].id` against `players[].zones` — go through `sourceCardId`.
   */
  id: number;
  /**
   * The card this item came from — resolve it against `state.stackCards`
   * (§3.3), **not** against `players[].zones`: a spell on the stack is in
   * `ZoneType.Stack`, which is not one of the six zones a player carries.
   * `null` only if the engine gave us a stack item with no source card; a stack
   * item is never dropped, so the reader guards instead.
   */
  sourceCardId: number | null;
  controller: number | null;
  /**
   * The engine's public stack description — or **`""` when this viewer may not
   * have it** (§3.6 rule 1): the bridge blanks it when the source card's
   * identity is concealed, or when the string mentions the id of any card this
   * same frame concealed. Render the absence from `stackCards` (which carries
   * the concealed card's public half); never print an empty line.
   */
  text: string;
  targetCardIds: number[];
  targetPlayerIds: number[];
  /**
   * §3 (**M6**, report 11 §5.2). The handle `act: setYield` echoes — and the
   * one string on the wire the client must **never render**.
   *
   * Forge's own `StackItemView.getKey()` is `CardView.toString() + ": " + …`,
   * i.e. *a card name, its zone and its id* — the exact text channel report 06
   * §4 opens with — and it is explicitly not stable across Forge versions. So
   * the bridge mints an opaque handle (`"y7"`), interns it for the life of the
   * game, and resolves it back on the EDT. `null` when the item has no key.
   */
  yieldKey?: string | null;
  /** `StackItemView.isAbility()`. Only an ability can be auto-yielded. */
  isAbility?: boolean;
  /** `StackItemView.isOptionalTrigger()` — the "always yes / always no" case. */
  isOptionalTrigger?: boolean;
  /**
   * What this seat has already told the engine about this key:
   * `"yes"` (trigger ACCEPT + auto-yield), `"no"` (DECLINE + auto-yield),
   * `null` (the engine still asks). Absent on a pre-M6 recording.
   */
  yielded?: YieldMode | null;
}

export interface CombatBand {
  attackerIds: number[];
  /** §3.1 — every `defender` on the wire is nullable; guard it. */
  defender: EntityRef | null;
  blockerIds: number[];
  damageOrder: number[];
}

/** §3.1. `combat` is `null` outside a combat phase; `bands` is `[]` outside combat. */
export interface Combat {
  bands: CombatBand[];
}

export interface GameStateBody {
  gameId: string;
  /** §3.1. Counts **player turns**, not rounds. */
  turn: number;
  /** §3.1. `ceil(turn / 2)`. Label the UI with this where the player expects "round". */
  round: number;
  /**
   * The Forge `PhaseType` name verbatim. The client maps it to a label, never
   * parses it. **`null` in the pre-game frames** (§10.5) — the first one or two
   * `state`s of a recording arrive before the first turn, with `turn` and
   * `round` 0 and phase / activePlayer / priority all null. `render(state)` must
   * be total over that.
   */
  phase: string | null;
  /** A player id, not an array index. `null` before the game starts (§10.5). */
  activePlayer: number | null;
  /** A player id, not an array index. `null` before the game starts (§10.5). */
  priority: number | null;
  /** `null` while the game is live; mirrors the `over` body (§7) once it is set. */
  gameOver: OverBody | null;
  players: PlayerState[];
  stack: StackItem[];
  /**
   * §3.3. The source card of every stack item, through the same single
   * redaction gate as every other card. Distinct ids only, in stack order. A
   * spell's card has `zone: "stack"` and appears **only** here; an activated
   * ability's source is usually also on the battlefield and appears in both.
   */
  stackCards: AnyCard[];
  combat: Combat | null;
  /** §3.6. The `GameEventForwarder` batch this snapshot already reflects. */
  events: GameEvent[];
  /**
   * §3 (M6) — the running pass-to, or `null`. Read it with {@link yieldOf}:
   * absent (a pre-M6 recording) and `null` (no yield) are different, and only
   * the second is something to draw a marker for.
   */
  yield?: YieldState | null;
  /** §3 (M6) — see {@link UndoState}. Read it with {@link undoOf}. */
  undo?: UndoState | null;
  /**
   * §3 (**M61**, D413) — what this seat may play from outside the battlefield,
   * at its own priority; `null` off it; absent before M61. Read it with
   * {@link playableOf}.
   */
  playable?: PlayableCard[] | null;
  /**
   * §3 (**M63**, D420) — the permanents this seat controls that Forge would
   * activate a non-mana ability of on a click now, at its own priority; `null`
   * off it; absent before M63. Read it with {@link activatableOf}.
   */
  activatable?: ActivatableCard[] | null;
}

/** §3.1 (M61). One spell or ability Forge would let the seat play from this card now. */
export interface PlayableAbility {
  /**
   * Forge's id for this ability in THIS frame. An alternative cost (flashback,
   * escape) is a fresh copy each frame, so the id is not a handle to keep:
   * the act is `clickCard` on the card, never `clickAbility` with this id.
   */
  abilityId: number;
  /** The engine's description, through the bridge's one ability-label gate. Render verbatim. */
  label: string;
  isSpell: boolean;
}

/** §3.1 (M61). A card of the seat's own, outside the battlefield, with what it may do now. */
export interface PlayableCard {
  cardId: number;
  zone: 'hand' | 'graveyard' | 'exile' | 'command' | 'library';
  /** Never empty. More than one: a click makes Forge ask its own `ability_menu`. */
  abilities: PlayableAbility[];
}

const PLAYABLE_ZONES: ReadonlySet<string> = new Set(['hand', 'graveyard', 'exile', 'command', 'library']);

/**
 * **Amendment M61 — the ONE reader of `state.playable`.** The list, or `null`
 * when the frame does not say: before M61 (no key), in an AI-vs-AI recording,
 * and off the seat's priority (`null`). A client falls back to its own reading
 * on `null` and must never read it as "nothing is playable". Malformed entries
 * are dropped.
 */
export function playableOf(state: GameStateBody | null | undefined): readonly PlayableCard[] | null {
  const list = state?.playable;
  if (!Array.isArray(list)) return null;
  return list.filter(
    (e) =>
      e !== null && typeof e === 'object' && Number.isInteger(e.cardId) && PLAYABLE_ZONES.has(e.zone) &&
      Array.isArray(e.abilities) && e.abilities.length > 0 &&
      e.abilities.every((a) => a !== null && typeof a === 'object' && Number.isInteger(a.abilityId) &&
        typeof a.label === 'string' && typeof a.isSpell === 'boolean'),
  );
}

/** §3.1 (M63). A permanent the seat controls, with the non-mana abilities Forge would activate now. */
export interface ActivatableCard {
  cardId: number;
  zone: 'battlefield';
  /** Never empty; every `isSpell` is false. More than one: a click makes Forge ask its own `ability_menu`. */
  abilities: PlayableAbility[];
}

/**
 * **Amendment M63 — the ONE reader of `state.activatable`.** The list, or
 * `null` when the frame does not say (before M63, an AI-vs-AI recording, off
 * the seat's priority); never read `null` as "nothing can be activated".
 * Malformed entries are dropped.
 */
export function activatableOf(state: GameStateBody | null | undefined): readonly ActivatableCard[] | null {
  const list = state?.activatable;
  if (!Array.isArray(list)) return null;
  return list.filter(
    (e) =>
      e !== null && typeof e === 'object' && Number.isInteger(e.cardId) && e.zone === 'battlefield' &&
      Array.isArray(e.abilities) && e.abilities.length > 0 &&
      e.abilities.every((a) => a !== null && typeof a === 'object' && Number.isInteger(a.abilityId) &&
        typeof a.label === 'string' && a.isSpell === false),
  );
}

// ---------------------------------------------------------------------------
// §3 / §4 — the M6 readers. One place each where "the field is absent" becomes
// "this recording predates M6", so no component has to know the difference.
// ---------------------------------------------------------------------------

/**
 * This seat's phase stops, or `null` when the stream does not carry them (every
 * fixture recorded before 2026-09-12). A `null` is what makes the strip say
 * *Forge's defaults, not this session's map*; `{own: [], opp: []}` would be the
 * lie that the engine stops nowhere.
 */
export function phaseStopsOf(player: PlayerState | null | undefined): PhaseStops | null {
  const stops = player?.phaseStops;
  if (stops === undefined || stops === null) return null;
  return {
    own: Array.isArray(stops.own) ? stops.own : [],
    opp: Array.isArray(stops.opp) ? stops.opp : [],
  };
}

/** The running yield, or `null` — for an absent field as much as for no yield. */
export function yieldOf(board: GameStateBody | null | undefined): YieldState | null {
  return board?.yield ?? null;
}

/**
 * `state.undo`, or `{can: false, depth: 0}` when the field is absent. An undo
 * the wire says nothing about is an undo that cannot be offered, which is the
 * same shape as one the engine says is unavailable — unlike the stops, there is
 * nothing a client could usefully draw differently.
 */
export function undoOf(board: GameStateBody | null | undefined): UndoState {
  const undo = board?.undo;
  if (undo === undefined || undo === null) return { can: false, depth: 0 };
  return { can: undo.can === true, depth: typeof undo.depth === 'number' ? undo.depth : 0 };
}

/*
 * §9 invariant 10 (amendment P5). **A `hidden` card replaces the client's card
 * for that id; it never merges into it.** Forge card ids are stable across zone
 * changes, so a reducer that merged by id would keep the name it learned during
 * a legitimate reveal and keep rendering it after the card went back to a hidden
 * zone. The rule is enforced — and explained — in `reduce.ts`, because `state`
 * is a full snapshot and the reducer is the only place a card could be carried
 * from one frame to the next.
 */

// ---------------------------------------------------------------------------
// §3.6 events — ids only, never names. Unknown kinds are ignored, not thrown.
// ---------------------------------------------------------------------------

export const EVENT_KINDS = [
  'zone',
  'cast',
  'resolved',
  'unstacked',
  'attackers',
  'blockers',
  'damage',
  'life',
  'poison',
  'tap',
  'counters',
  'attach',
  'sacrificed',
  'land',
  'stats',
  'turn',
  'phase',
  'combat_end',
  'shuffle',
  'mulligan',
  'outcome',
  // Amendment P4 / report 06 §5.3 — four kinds that carry counts and ids only
  // and were previously invisible in the stream.
  'scry',
  'surveil',
  'phased',
  'foretold',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

const EVENT_KIND_SET: ReadonlySet<string> = new Set<string>(EVENT_KINDS);

export function isKnownEventKind(kind: string): kind is EventKind {
  return EVENT_KIND_SET.has(kind);
}

/**
 * §3.6 — **the nullability rule for events.** An event whose subject id the
 * engine could not supply is *dropped by the bridge*, not emitted with a `null`
 * under a non-nullable type. So every `cardId` / `player` / `controller` /
 * `target` below is genuinely non-null, and the handful of fields that *are*
 * nullable are nullable **by design**, each for a stated reason:
 *
 * | field | why it can be `null` |
 * |---|---|
 * | `ZoneEvent.from` | a token created directly onto the battlefield came from nowhere |
 * | `ZoneEvent.to` | a token that ceases to exist goes nowhere |
 * | `ZoneRef.player` | a shared zone (the stack) has no owner |
 * | `AttackBand.defender` | see §3.1: every `defender` on the wire is nullable |
 * | `AttachEvent.to` | `null` *is* the unattach event |
 * | `DamageEvent.damageType` | player damage has no type enum in Forge 2.0.14 |
 * | `PoisonEvent.sourcePlayer` | poison from an effect with no player source |
 * | `OutcomeEvent.winner` | `null` is a draw |
 *
 * Anything else arriving as `null` is drift, and `tools/check-redaction.mjs`
 * fails the fixture for it.
 */
export interface ZoneRef {
  /** The `ZoneType` name lowercased: `hand`, `library`, `battlefield`, `stack`, … */
  zone: string;
  /** The zone owner's id; `null` for a shared zone. */
  player: number | null;
}

export interface ZoneEvent {
  kind: 'zone';
  cardId: number;
  /** `null` when the card came from nowhere — a token entering the battlefield. */
  from: ZoneRef | null;
  /** `null` when the card went nowhere — a token ceasing to exist. */
  to: ZoneRef | null;
}

/** The only string an event may carry is `cast.text` — the public stack description. */
export interface CastEvent {
  kind: 'cast';
  stackId: number;
  cardId: number;
  controller: number;
  /** The same string as `StackItem.text`, through the same gate — `""` when concealed. */
  text: string;
}

export interface ResolvedEvent {
  kind: 'resolved';
  cardId: number;
  fizzled: boolean;
}

export interface UnstackedEvent {
  kind: 'unstacked';
  cardId: number;
}

export interface AttackBand {
  /** §3.1 — every `defender` on the wire is nullable; guard it. */
  defender: EntityRef | null;
  attackerIds: number[];
}

export interface AttackersEvent {
  kind: 'attackers';
  player: number;
  bands: AttackBand[];
}

export interface BlockAssignment {
  attackerId: number;
  blockerIds: number[];
}

export interface BlockersEvent {
  kind: 'blockers';
  defendingPlayer: number;
  blocks: BlockAssignment[];
}

export interface DamageEvent {
  kind: 'damage';
  target: EntityRef;
  sourceCardId: number;
  amount: number;
  combat: boolean;
  /**
   * The Forge damage-type enum name. §10.6: the key is always present, and is
   * `null` for player damage — `GameEventPlayerDamaged` has no type enum in
   * 2.0.14 — so the shape does not depend on the target.
   */
  damageType: string | null;
}

export interface LifeEvent {
  kind: 'life';
  player: number;
  from: number;
  to: number;
}

export interface PoisonEvent {
  kind: 'poison';
  player: number;
  sourcePlayer: number | null;
  from: number;
  amount: number;
}

export interface TapEvent {
  kind: 'tap';
  cardId: number;
  tapped: boolean;
}

export interface CountersEvent {
  kind: 'counters';
  cardId: number;
  /**
   * Forge's **display** name for the counter — `CounterType.getName()`, i.e.
   * `+1/+1`, `-1/-1`, `Spore` — and **never** the enum constant `P1P1`
   * (docs/protocol.md §3.6, amendment **M43**). It is an opaque string: a
   * consumer that wants an identifier-shaped token normalises one itself
   * (`counterToken()` in `arena/cues/types.ts`).
   */
  counter: string;
  from: number;
  to: number;
}

export interface AttachEvent {
  kind: 'attach';
  cardId: number;
  to: EntityRef | null;
}

export interface SacrificedEvent {
  kind: 'sacrificed';
  cardId: number;
}

export interface LandEvent {
  kind: 'land';
  player: number;
  cardId: number;
}

export interface StatsEvent {
  kind: 'stats';
  cardIds: number[];
  transform: boolean;
}

export interface TurnEvent {
  kind: 'turn';
  player: number;
  /** The player-turn number, matching `state.turn` (§3.1). */
  turn: number;
}

export interface PhaseEvent {
  kind: 'phase';
  player: number;
  /** Same vocabulary as `state.phase`. */
  phase: string;
}

export interface CombatEndEvent {
  kind: 'combat_end';
  attackerIds: number[];
  blockerIds: number[];
}

export interface ShuffleEvent {
  kind: 'shuffle';
  player: number;
}

export interface MulliganEvent {
  kind: 'mulligan';
  player: number;
}

export interface OutcomeEvent {
  kind: 'outcome';
  /**
   * A player id, or `null` for a draw. `GameEventGameOutcome` also carries
   * `outcomeStrings()` and `matchSummary()` — free text built from
   * `CardView.toString()`, **banned from the wire** (report 06 §4, §5.1).
   */
  winner: number | null;
  lastTurn: number;
}

/**
 * `GameEventScry(PlayerView, int toTop, int toBottom)` — javap-confirmed.
 * Counts only, and genuinely public: everyone at the table sees that a scry
 * happened and how many cards went where. *Which* cards is the `ask`'s business.
 */
export interface ScryEvent {
  kind: 'scry';
  player: number;
  toTop: number;
  toBottom: number;
}

/** `GameEventSurveil(PlayerView, int toLibrary, int toGraveyard)` — counts only. */
export interface SurveilEvent {
  kind: 'surveil';
  player: number;
  toLibrary: number;
  toGraveyard: number;
}

/**
 * `GameEventCardPhased(CardView card, boolean phaseState)` — javap-confirmed.
 * Battlefield-public, and otherwise invisible: a phased-out permanent simply
 * vanishes from the zone array with no event to explain it.
 */
export interface PhasedEvent {
  kind: 'phased';
  cardId: number;
  phasedOut: boolean;
}

/**
 * `GameEventCardForetold(PlayerView activatingPlayer)` — javap-confirmed
 * against the 2.0.14 jar: the record's **only** component is the player. It
 * carries no card at all, which is what makes it safe by construction (the
 * foretold card is face down in exile and nobody but its owner may look).
 *
 * Amendment P4 writes this kind as `{cardId}`; there is no card accessor to
 * build that from, so the body is `{player}` and this comment is the evidence.
 */
export interface ForetoldEvent {
  kind: 'foretold';
  player: number;
}

export type GameEvent =
  | ZoneEvent
  | CastEvent
  | ResolvedEvent
  | UnstackedEvent
  | AttackersEvent
  | BlockersEvent
  | DamageEvent
  | LifeEvent
  | PoisonEvent
  | TapEvent
  | CountersEvent
  | AttachEvent
  | SacrificedEvent
  | LandEvent
  | StatsEvent
  | TurnEvent
  | PhaseEvent
  | CombatEndEvent
  | ShuffleEvent
  | MulliganEvent
  | OutcomeEvent
  | ScryEvent
  | SurveilEvent
  | PhasedEvent
  | ForetoldEvent;

// ---------------------------------------------------------------------------
// §4 input
// ---------------------------------------------------------------------------

export interface InputButton {
  label: string;
  enabled: boolean;
}

/** §4 (M6) — `updateButtons(owner, label1, label2, enable1, enable2, **focus1**)`. */
export type ButtonFocus = 'ok' | 'cancel' | null;

export interface InputButtons {
  ok: InputButton;
  cancel: InputButton;
  /**
   * §4 (**M6**, §10.2). Which button the engine focused — the sixth argument of
   * `updateButtons`, which Forge's desktop turns into Swing focus and which is
   * the whole reason "Space = OK" is **not** a Forge shortcut: the desktop
   * activates the *focused* label (`FLabel.java:220-223`). So SPACE follows this
   * field, and falls back to OK when it is `null` or absent (report 11 §11).
   */
  focus?: ButtonFocus;
}

export type SelectableMode = 'cards' | 'players' | 'none';

export interface Selectable {
  /** The ids the engine will accept a click on. */
  cardIds: number[];
  min: number;
  max: number;
  /** Still computed from `cardIds` alone; a player-only choice reads `"none"` — see `playerIds`. */
  mode: SelectableMode;
  /**
   * §4 (**M66**, D423) — the players a click (`clickPlayer`) would be taken for
   * in the input that is up: a target, a list entry, a defender. `[]` when a
   * player click does nothing there; `null` when the bridge cannot say; absent
   * before M66. Read it with {@link selectablePlayersOf}.
   */
  playerIds?: number[] | null;
  /**
   * §4 (**M65**, D422) — what the seat has already chosen in the input that is
   * up; `null` when no selection is up or the bridge cannot say; absent before
   * M65. Read it with {@link chosenOf}.
   */
  chosen?: SelectionChosen | null;
}

/** §4 (M65). A blocker the seat has declared, and the attacker it blocks (one row per pair). */
export interface ChosenBlock {
  blockerId: number;
  attackerId: number;
}

/** §4 (M65). An attacker the seat has declared, and what it attacks (as `combat.bands[].defender`). */
export interface ChosenAttack {
  attackerId: number;
  defender: { kind: 'player' | 'card'; id: number };
}

/**
 * §4 (M65). The selection so far, ids ascending. `cardIds` / `playerIds`: the
 * targets chosen, the list entries ticked — or, in a declaration, the blockers
 * / attackers. `blocks` only in a block declaration, `attacks` only in an
 * attack declaration; `[]` otherwise.
 */
export interface SelectionChosen {
  cardIds: number[];
  playerIds: number[];
  blocks: ChosenBlock[];
  attacks: ChosenAttack[];
}

const intList = (v: unknown): number[] | null =>
  Array.isArray(v) && v.every((x) => Number.isInteger(x)) ? (v as number[]) : null;

/**
 * **Amendment M66 — the ONE reader of `input.selectable.playerIds`.** The
 * players a click would be taken for, `[]` when a player click does nothing in
 * this input, or `null` when the frame does not say (before M66, an input the
 * bridge does not read, a malformed field). Never read `null` as "no player is
 * clickable".
 */
export function selectablePlayersOf(input: InputBody | null | undefined): readonly number[] | null {
  return intList(input?.selectable?.playerIds);
}

/**
 * **Amendment M65 — the ONE reader of `input.selectable.chosen`.** What the seat
 * has chosen so far in the input that is up, or `null` when the frame does not
 * say (before M65, no selection up, an input the bridge does not read). A
 * malformed row is dropped; a malformed list makes the whole answer `null`.
 */
export function chosenOf(input: InputBody | null | undefined): SelectionChosen | null {
  const c: unknown = input?.selectable?.chosen;
  if (c === null || typeof c !== 'object') return null;
  const o = c as Record<string, unknown>;
  const cardIds = intList(o.cardIds);
  const playerIds = intList(o.playerIds);
  if (cardIds === null || playerIds === null || !Array.isArray(o.blocks) || !Array.isArray(o.attacks)) return null;
  const blocks = (o.blocks as unknown[]).filter(
    (b): b is ChosenBlock =>
      b !== null && typeof b === 'object' && Number.isInteger((b as ChosenBlock).blockerId) &&
      Number.isInteger((b as ChosenBlock).attackerId),
  );
  const attacks = (o.attacks as unknown[]).filter(
    (a): a is ChosenAttack =>
      a !== null && typeof a === 'object' && Number.isInteger((a as ChosenAttack).attackerId) &&
      (a as ChosenAttack).defender !== null && typeof (a as ChosenAttack).defender === 'object' &&
      ((a as ChosenAttack).defender.kind === 'player' || (a as ChosenAttack).defender.kind === 'card') &&
      Number.isInteger((a as ChosenAttack).defender.id),
  );
  return { cardIds, playerIds, blocks, attacks };
}

/**
 * §4, amended (report 06 §3, report 07 A1 / amendment P6). `openZones`,
 * `tempShowZones`, `hideZones` and `restoreOldZones` **reveal nothing** —
 * `PlayerZoneUpdate` is `(PlayerView, Set<ZoneType>)` and carries no card
 * accessor of any kind — and they are called on the EDT, where blocking is
 * forbidden. They are "open a floating zone panel" hints, so they became this
 * non-blocking field and the `open_zones` *ask* kind was deleted.
 *
 * The cards themselves arrive the way they always did: through `canBeShownTo`
 * in `state`, or in the body of whatever `ask` is blocking at the time.
 */
export interface OpenZoneHint {
  playerId: number;
  /** Zone names, lowercased, as in {@link ZoneName} plus Forge's extras. */
  zones: string[];
}

export interface InputBody {
  /** The engine's own prompt text. Rendered verbatim; never rewritten. */
  prompt: string;
  /**
   * The id of the card the prompt is about. Kept for the common case; prefer
   * {@link InputBody.focusCard}, because the card frequently is not in the
   * snapshot at all.
   */
  focusCardId: number | null;
  /**
   * §4, amended (report 06 §6.9 / amendment P7). `IGuiGame.setCard(CardView)`
   * and `setPanelSelection(CardView)` are pushed with cards that are often
   * **not** in `state` — a library card during surveil, the card
   * `willPutCardOnTop` is asking about — so an id alone is unresolvable. The
   * serialised card comes through the one gated function, like every other card
   * on the wire. Always present; `null` when there is no focus.
   */
  focusCard: AnyCard | null;
  /** §4.2. `ok.enabled === false` means the engine wants a **card click**, not a button. */
  buttons: InputButtons;
  selectable: Selectable;
  /** Emphasised without being clickable. */
  highlighted: number[];
  /**
   * Report 07 A8 / amendment P7 — `AbstractGuiGame.setWeaklySelectable`. Card
   * ids the engine will accept but does not want: in Forge's own UI a weak
   * selection is what "Auto" would have tapped. Ids, because that is what the
   * `Multiset` behind it holds; a card may appear twice (strength 2).
   *
   * §4 declares this key always present, and it is: `[]` until M5 fills it. See
   * {@link LibraryZone.cards} for why it is not optional.
   */
  weak: number[];
  /**
   * The floating-zone hint of {@link OpenZoneHint}. Always present; `[]` most of
   * the time.
   */
  openZones: OpenZoneHint[];
}

/**
 * §4 (M6) — the button SPACE should press, from {@link InputButtons.focus},
 * with M4's behaviour as the fallback: OK. Absent on every pre-M6 recording,
 * and `null` whenever the engine focused neither.
 */
export function buttonFocus(input: InputBody | null | undefined): ButtonFocus {
  return input?.buttons.focus ?? null;
}

// ---------------------------------------------------------------------------
// §5 ask — the eleven blocking kinds
//
// Amendment P6 / report 06 §3 / report 07 A1 deleted the twelfth, `open_zones`:
// `openZones` and `tempShowZones` are not questions. They carry no cards
// (`PlayerZoneUpdate` is `(PlayerView, Set<ZoneType>)`), they are invoked on the
// EDT where blocking is forbidden, and Forge's own desktop client answers them
// by opening a panel and handing the token straight back. They are now the
// non-blocking `input.openZones` hint (§4).
// ---------------------------------------------------------------------------

export const ASK_KINDS = [
  'ability_menu',
  'confirm',
  'options',
  'text',
  'choose_list',
  'order',
  'choose_entities',
  'assign_damage',
  'assign_amount',
  'manipulate_list',
  'sideboard',
] as const;
export type AskKind = (typeof ASK_KINDS)[number];

const ASK_KIND_SET: ReadonlySet<string> = new Set<string>(ASK_KINDS);

export function isAskKind(kind: string): kind is AskKind {
  return ASK_KIND_SET.has(kind);
}

/**
 * What an option *is*, when the client needs to know. Report 07 §0.7: the `T`
 * of `getChoices` / `order` is frequently not a view object at all — it is a
 * `MagicColor.Color`, a `SpellAbilityView`, an `Integer`, a `String`, a
 * `CostPart`, a `PaperCard` — so `kind` is how a renderer decides whether it can
 * draw a card, a player avatar or just a line of text.
 */
export const OPTION_KINDS = [
  'card',
  'player',
  'ability',
  /** `assign_amount` only: a `GameEntityView` key of the engine's amount map. */
  'entity',
  /** A `MagicColor.Color` — "mana of any one combination of colours". */
  'color',
  'number',
  'text',
  'other',
] as const;
export type OptionKind = (typeof OPTION_KINDS)[number];

/**
 * §5, amended (report 07 A3 / amendment P7). One option of one `ask`.
 *
 * **`id` is an ask-local index**, not a Forge id: the 0-based position in the
 * server's option array for this `askId`. It has to be, because the options of a
 * single ask can be colours, abilities, integers and cards at once, and
 * `Integer 3` and `CardView 3` would collide on any shared id space. The answer
 * echoes indices and the server marshals them back to objects.
 *
 * `cardId` / `playerId` / `abilityId` are present only when the option really is
 * that thing, and exist so the board can highlight it. `card` is the serialised
 * card — from the **one** gated function, like every other card on the wire —
 * because `label` alone throws away the art, the P/T and the cost the UI needs,
 * and because building a second stringifier for options is precisely how a name
 * leaks (report 07 §7: `String.valueOf(CardView)` prints the card's name).
 */
export interface AskOption {
  /** Ask-local index into the server's option array for this `askId`. */
  id: number;
  label: string;
  kind: OptionKind;
  cardId?: number;
  playerId?: number;
  abilityId?: number;
  /** The serialised card, gated like every other card (`"???"` label if hidden). */
  card?: AnyCard;
}

export interface AskBase<K extends AskKind> {
  /** Unique for the life of the connection. */
  askId: string;
  kind: K;
  /** Advisory for the client; enforced by the server (§5.2). */
  timeoutMs: number;
}

/** `getAbilityToPlay` → the chosen option index, or `null`. */
export interface AbilityMenuAsk extends AskBase<'ability_menu'> {
  /**
   * Never `null`: with no host card there is nothing to attach a menu to, so
   * the bridge skips the ask entirely rather than emitting one this type would
   * be wrong about (the emitter used to write a null here).
   */
  cardId: number;
  /** `label` is `SpellAbilityView.getDescription()`; `canPlay` is the engine's answer. */
  options: Array<AskOption & { canPlay: boolean; isSpell: boolean }>;
}

/**
 * `confirm(CardView, …)`, `showConfirmDialog` → `true` | `false` | `null`.
 *
 * `card` is not decoration (report 06 §6.6): `confirm(CardView c, …)` is how
 * surveil's single-card case, `willPutCardOnTop` and `confirmAction` ask about a
 * card that is usually in a **library**, and therefore not in `state` at all.
 */
export interface ConfirmAsk extends AskBase<'confirm'> {
  prompt: string;
  title: string;
  yesLabel: string;
  noLabel: string;
  /** What a `null` answer (timeout, disconnect) means for this call. */
  defaultYes: boolean;
  card: AnyCard | null;
}

/** `showOptionDialog` → index int, or `null`. */
export interface OptionsAsk extends AskBase<'options'> {
  prompt: string;
  title: string;
  options: AskOption[];
  defaultIndex: number;
  /** Same reason as {@link ConfirmAsk.card}: it is the same Forge call. */
  card: AnyCard | null;
}

/** `showInputDialog` → string, or `null`. */
export interface TextAsk extends AskBase<'text'> {
  prompt: string;
  title: string;
  /** `""` when Forge has no initial value — never `null`, like every other string field. */
  initial: string;
  suggestions: string[];
  numeric: boolean;
}

/**
 * `getChoices` and everything `AbstractGuiGame` builds on it → an array of
 * option indices, or `null`.
 *
 * **`reveal`** (report 07 A7 / report 06 §6.5): `AbstractGuiGame.reveal` is
 * `getChoices(message, -1, -1, items)`. A `min`/`max` of `-1` is not a choice at
 * all — it means *show the player these cards and wait for an acknowledgement* —
 * and a client that renders it literally asks the user to pick −1 cards. When
 * `reveal` is true the answer is `[]`.
 */
export interface ChooseListAsk extends AskBase<'choose_list'> {
  prompt: string;
  options: AskOption[];
  min: number;
  max: number;
  reveal: boolean;
  /** Indices the engine pre-selected (`getChoices`'s `selected` argument). */
  preselected: number[];
}

/**
 * `order(…)` → `OrderResult`, which the jar declares as
 * `record OrderResult(List<T> ordered, boolean rememberDecision)` — **not** the
 * `{top, bottom}` M1 guessed (report 07 A2 / §0.5).
 *
 * `dest` is the list being built and `source` the pool left to draw from;
 * answer indices address **`dest ++ source` as one array, in that order**.
 * The answer is **never `null`**: three call sites dereference `.ordered()`
 * unguarded, so a cancel must send the default order rather than nothing.
 */
export interface OrderAsk extends AskBase<'order'> {
  prompt: string;
  /** Forge's label for the destination list (its `top` argument). */
  destLabel: string;
  source: AskOption[];
  dest: AskOption[];
  /**
   * Forge's `remainingMin` / `remainingMax`: how many options may be **left in
   * `source`**, with `-1` meaning unconstrained. They do not bound `dest`.
   */
  min: number;
  max: number;
  referenceCardId: number | null;
  sideboardMode: boolean;
  showRemember: boolean;
}

/**
 * §5, amended (report 06 §6.8 / amendment P7). The context of a
 * `choose_entities`: *here is what you are looking at*, as distinct from
 * `options`, *here is what you may pick*. The two overlap only partially — a
 * deck search reveals the whole library and offers the legal targets.
 *
 * Jar-verified accessors: `getCards()`, `getZone()`, `getOwner()`,
 * `getMessagePrefix()` on `forge.game.player.DelayedReveal` (note the package).
 * Every card in it goes through the one gated function.
 */
export interface DelayedReveal {
  /** The player whose zone is being revealed; `null` if the engine had none. */
  owner: number | null;
  zones: string[];
  messagePrefix: string;
  cards: AnyCard[];
}

/** `chooseSingleEntityForEffect` (min = max = 1), `chooseEntitiesForEffect`. */
export interface ChooseEntitiesAsk extends AskBase<'choose_entities'> {
  prompt: string;
  options: AskOption[];
  min: number;
  max: number;
  delayedReveal: DelayedReveal | null;
}

/**
 * `assignCombatDamage` → `{ "<index>": n }`, or `null`.
 *
 * **The defender is `targets[0]`** (report 07 A4 / amendment P7), carrying
 * `defender: true` and a `playerId` or `cardId`; the server marshals index 0
 * back to the `null` key `PlayerControllerHuman` reads as "the defending
 * player". Blockers follow, each with its remaining toughness as `lethal`.
 */
export interface AssignDamageAsk extends AskBase<'assign_damage'> {
  /**
   * **Nullable, and declared so at both ends.** Forge's `assignCombatDamage`
   * signature allows a null attacker and the emitter has a live path to it, so
   * the type says what the bridge can produce rather than what a run happened
   * to produce. Never observed; `tools/check-redaction.mjs` asserts the
   * declared nullability of every `ask` field, so the next drift fails in CI
   * instead of in a browser tab.
   */
  attackerId: number | null;
  total: number;
  /** Forge's own flags, passed through. */
  overrideOrder: boolean;
  maySkip: boolean;
  /**
   * Amendment M67 (D424): may target 0, the defender, take damage. Forge's own
   * rule, read by the bridge: the attacker has trample (and there is a
   * defender), or it may divide its damage "as you choose" with `overrideOrder`.
   * Absent before M67 — read it with `assignDamageRuleOf`, never as `true`.
   */
  defenderAllowed?: boolean;
  /**
   * Amendment M67: why the bridge refused the previous answer to this same
   * question, a sentence to show the player; `null` on a first asking. Absent
   * before M67.
   */
  reason?: string | null;
  /**
   * Index 0 is the defender (`defender: true`); blockers follow with `lethal`
   * — since M67 the damage Forge's dialog counts as lethal for that blocker.
   */
  targets: Array<AskOption & { lethal?: number | null; defender?: boolean }>;
}

/** What an `assign_damage` ask says about its own rule (M67); see `assignDamageRuleOf`. */
export interface AssignDamageRule {
  /** May target 0 take damage: `true` / `false`, or `null` when the bridge predates M67 and does not say. */
  defenderAllowed: boolean | null;
  /** The bridge's refusal of the previous answer, or `null` (a first asking, or a bridge before M67). */
  reason: string | null;
  /** Lethal damage per target id (blockers only), as the bridge computed it. */
  lethal: Map<number, number>;
}

/**
 * The one reader of M67's fields. A bridge before M67 says nothing about the
 * defender — `defenderAllowed: null`, and a client decides from the engine's
 * own state (the attacker's `keywords`), never from arithmetic of its own.
 */
export function assignDamageRuleOf(ask: AssignDamageAsk): AssignDamageRule {
  const lethal = new Map<number, number>();
  for (const t of ask.targets) {
    if (t.defender !== true && typeof t.lethal === 'number' && Number.isInteger(t.lethal)) lethal.set(t.id, t.lethal);
  }
  return {
    defenderAllowed: typeof ask.defenderAllowed === 'boolean' ? ask.defenderAllowed : null,
    reason: typeof ask.reason === 'string' && ask.reason !== '' ? ask.reason : null,
    lethal,
  };
}

/**
 * `assignGenericAmount` → `{ "<index>": n }`, or `null`.
 *
 * The engine's map is `Map<Object,Integer>` and its keys may be a
 * `GameEntityView` **or** a `MagicColor.Color` ("mana of any one combination"),
 * so a target's `kind` is `entity` or `color` and `max` is the incoming per-key
 * cap (report 07 A5 / amendment P7).
 */
export interface AssignAmountAsk extends AskBase<'assign_amount'> {
  sourceCardId: number | null;
  total: number;
  /** Forge's `atLeastOne`: every target must receive at least one. */
  atLeastOne: boolean;
  /** Forge's `amountLabel` — what the amount *is* ("damage", "counters"). */
  label: string;
  targets: Array<AskOption & { max?: number }>;
}

/**
 * `manipulateCardList` (surveil, scry-likes) → the **full list in its new
 * order**, as indices. Never `null`: `PlayerControllerHuman` indexes the result.
 *
 * `cards` is the whole list in engine order and `manipulable` the indices the
 * player may actually move. With `UI_SELECT_FROM_CARD_DISPLAYS` off (decision
 * D13) the whole-library path never fires, but every entry still goes through
 * the gated card function, so an unrevealed library card arrives redacted.
 */
export interface ManipulateListAsk extends AskBase<'manipulate_list'> {
  prompt: string;
  cards: AskOption[];
  manipulable: number[];
  toTop: boolean;
  toBottom: boolean;
  toAnywhere: boolean;
}

/** `sideboard` → the new main deck as indices, or `null`. Your own pool only. */
export interface SideboardAsk extends AskBase<'sideboard'> {
  prompt: string;
  main: AskOption[];
  side: AskOption[];
}

export type AskBody =
  | AbilityMenuAsk
  | ConfirmAsk
  | OptionsAsk
  | TextAsk
  | ChooseListAsk
  | OrderAsk
  | ChooseEntitiesAsk
  | AssignDamageAsk
  | AssignAmountAsk
  | ManipulateListAsk
  | SideboardAsk;

// ---------------------------------------------------------------------------
// §6 notice, §7 over
// ---------------------------------------------------------------------------

export type NoticeLevel = 'info' | 'warn' | 'error';

/**
 * §6. A toast, never a question. Anything the user must answer is an `ask`.
 *
 * **Both strings are gated.** They are Forge's own — `IGuiGame.message` /
 * `showErrorDialog` — and `PlayerControllerHuman.notifyOfValue` passes
 * `CardView.get(sa.getHostCard()).toString()`, i.e. `name (id)`, as the
 * *title*. So each goes through `Snap.sweepText` against the ids the current
 * snapshot conceals and arrives as `""` when it named one (§3.6 rule 1's sweep,
 * in its second channel). A client renders both verbatim and must be total over
 * an empty title or an empty text.
 */
export interface NoticeBody {
  level: NoticeLevel;
  title: string;
  text: string;
}

/** §7. Also appears verbatim as `state.gameOver` in later snapshots. */
export interface OverBody {
  /** A player id, or `null` for a draw. */
  winner: number | null;
  /**
   * Forge's `GameOutcome.getWinCondition()` name, or **`null` when the engine
   * had not published a win condition yet** (§7). `Snap.state()` writes this
   * body the instant `Game.isGameOver()` is true, while `GameView.getOutcome()`
   * is a lookup in the `Match`'s outcome map, which is not populated at the same
   * instant — so "not known yet" is a real state and `""` would misreport it as
   * a known empty reason.
   */
  reason: string | null;
  /** `false` → the client may send `act: nextGame`. */
  matchOver: boolean;
}

// ---------------------------------------------------------------------------
// §2.6 table (s→c) — amendment M59, a table of two only
// ---------------------------------------------------------------------------

/** One seat of {@link TableBody}. Times are the bridge's epoch ms, as the envelope's `t`. */
export interface TableSeat {
  /** 0 or 1: the table's seat, which is also the order the decks were given in. */
  seat: number;
  /** The player id of `hello_ok.players[]`; `null` before the game exists. */
  playerId: number | null;
  /** The name the player gave the room. */
  name: string;
  /** A socket holds this seat now. */
  connected: boolean;
  /** The engine is waiting on this seat (an input is up, or an ask is parked). */
  deciding: boolean;
  /** When this seat's decision clock runs out; `null` when it is not deciding, is away, or the clock is off. */
  decisionDeadline: number | null;
  /** Since when this seat's person has been gone; `null` while they are here. */
  awaySince: number | null;
}

/**
 * §2.6, amendment **M59** — sent to each seat at a table of two whenever any of
 * it changes, cached and re-sent on a reconnect like a `state`. Count down with
 * `deadline - t` (the envelope's `t` is the same clock), never with the
 * client's own.
 */
export interface TableBody {
  /** This stream's seat (0 or 1). */
  you: number;
  seats: TableSeat[];
  /** The decision clock (0 = off). */
  decisionTimeoutMs: number;
  /** How long a player may be away before the other may claim the win. */
  graceMs: number;
  /** When THIS seat may claim the win (the other seat away since `awaySince + graceMs`); `null` when it may not. */
  claimWinAt: number | null;
  /** This seat may send `act: claimWin` now. */
  canClaimWin: boolean;
}

// ---------------------------------------------------------------------------
// §2.2 act, §2.3 answer (client→server)
// ---------------------------------------------------------------------------

export const ACT_ACTIONS = [
  'clickCard',
  'clickPlayer',
  'clickAbility',
  'buttonOk',
  'buttonCancel',
  /**
   * **Planned (M6) — not emitted yet**, and listed in §2.2's act table with
   * `from: M6` alongside `undo`, `alphaStrike` and `setYield`, because §2.2 also
   * promises the server tolerates any `act` at any time; §10.3 cross-references
   * it rather than defining it twice. Report 07 A6 / amendment P7:
   * `IGameController.passPriority()` exists and is **not** `selectButtonOk`, so
   * a button-only client cannot express "pass until something happens". Typed
   * here so the two ends agree on the spelling before M6 writes it; the M1/M2
   * client sends `buttonOk` / `buttonCancel` with the engine's own labels.
   *
   * §10's other planned acts — `yieldTo`, `newGame` — are deliberately not
   * typed yet: their bodies are still being designed. There is **no `autoPay`
   * act**: "Auto" is the label Forge's `InputPayMana` puts on the OK button.
   */
  'passPriority',
  'useMana',
  'undo',
  'alphaStrike',
  'concede',
  /**
   * **M3's spelling, kept only so an old frame log still types.** M6's act is
   * `newGame {mode}`: `HostedMatch` has three `NextGameDecision`s and a bare
   * `nextGame` can express one of them.
   */
  'nextGame',
  'setPhaseStop',
  'setYield',
  /** M6 — one act for all three of `YieldController`'s mechanisms (report 11 §4). */
  'yieldTo',
  /** M6 — `nextGameDecision(CONTINUE | NEW)`; valid only after `over` (§7). Refused at a table of two (M59). */
  'newGame',
  /** M59 — at a table of two, once the other player has been away past the grace: end the game, a win. */
  'claimWin',
] as const;
export type ActAction = (typeof ACT_ACTIONS)[number];

export interface ClickCardAct {
  action: 'clickCard';
  cardId: number;
}
export interface ClickPlayerAct {
  action: 'clickPlayer';
  playerId: number;
}
export interface ClickAbilityAct {
  action: 'clickAbility';
  cardId: number;
  abilityId: number;
}
export interface ButtonOkAct {
  action: 'buttonOk';
}
export interface ButtonCancelAct {
  action: 'buttonCancel';
}
export interface PassPriorityAct {
  action: 'passPriority';
}
/**
 * §2.2 — `IGameController.useMana(byte)`. **Colour only**: clicking a land to
 * tap it for mana is a `clickCard`, not a `useMana`, and conflating the two is
 * how a client ends up with two ways to say one thing.
 */
export interface UseManaAct {
  action: 'useMana';
  color: ManaColor;
}
export interface UndoAct {
  action: 'undo';
}
export interface AlphaStrikeAct {
  action: 'alphaStrike';
}
export interface ConcedeAct {
  action: 'concede';
}
/**
 * §2.2, amendment **M59** — at a table of two only: the other player has been
 * away for `table.graceMs`, so this seat claims the win (the bridge concedes
 * for them). Refused with `notice {title: "Not yet"}` before that.
 */
export interface ClaimWinAct {
  action: 'claimWin';
}
/** M3's bare act; superseded by {@link NewGameAct}. Nothing sends it any more. */
export interface NextGameAct {
  action: 'nextGame';
}
/**
 * §2.2 (**M6**) — `HostedMatch.nextGameDecision`. `"continue"` is
 * `continueMatch()` (the next game of this match, sideboarding intact);
 * `"restart"` is `restartMatch()` (a fresh match from the same rules and
 * players). Valid **only after `over`**; a new `hello_ok` follows, and the
 * client drops everything it had cached for the finished game (§2.1).
 */
export interface NewGameAct {
  action: 'newGame';
  mode: 'continue' | 'restart';
}
/**
 * §2.2 (**M6**) — one bit of `WireGuiGame`'s own stop map (report 11 §3.3).
 *
 * **`turn`, not `playerId`.** Which of the two columns a stop lives in is
 * decided by *whose turn it is* — `isLocalPlayer(player) ? PHASES_HUMAN :
 * PHASES_AI` — so the viewer's seat is implied and the thing the client has to
 * name is the column: `"own"` is this seat's own turns, `"opp"` the other's.
 * The polarity is **stop**, never `skip` (report 11 §0.4).
 */
export interface SetPhaseStopAct {
  action: 'setPhaseStop';
  /** A `PhaseType` name, as `state.phase` spells it. `UNTAP` has no stop pref. */
  phase: string;
  turn: 'own' | 'opp';
  stop: boolean;
}
/**
 * §2.2 (**M6**) — `IGameController.sendYieldUpdate(YieldUpdate)`, whichever of
 * the three it is (report 11 §4.1):
 *
 * | `kind` | `phase` | engine |
 * |---|---|---|
 * | `endOfTurn` | — | `SetAutoPassUntilEndOfTurn` |
 * | `marker` | `UPKEEP` | `SetMarker(me, UPKEEP)` — *pass to my next turn* |
 * | `marker` | `END_OF_TURN` | `SetMarker(opponent, END_OF_TURN)` — *pass to just before my turn* |
 * | `stack` | — | `StackYield` — let the stack resolve |
 *
 * **`turn` names whose phase cell the marker goes on**, in the same two words
 * `setPhaseStop` uses, and it is not optional in practice: a marker is a
 * per-(player, phase) cell, so `END_OF_TURN` on `"own"` is *my* end step and on
 * `"opp"` is the opponent's — and only the second one means "just before my
 * turn". Measured live on 2026-09-12: sent without it, "Before my turn" put the
 * marker on the viewer's own `END_OF_TURN` (`state.yield.playerId` came back as
 * the viewer) and would have skipped the whole of the next turn. The bridge
 * defaults to the viewer and also accepts a raw `playerId`; the client sends
 * `turn`, because the seat is the bridge's to resolve and the *column* is the
 * thing the user chose. **Cancelling is `buttonCancel`** — `InputLockUI` puts an
 * enabled Cancel on screen for the whole of a yield.
 */
export interface YieldToAct {
  action: 'yieldTo';
  kind: YieldKind;
  phase?: string;
  /** Marker only: whose phase cell. `"own"` is the viewer's own turns. */
  turn?: 'own' | 'opp';
}
/**
 * Report 07 A6 / amendment P7: a yield **cannot** be addressed by `cardId`.
 * `IGameController.setShouldAutoYield(String key, …)` takes
 * `SpellAbility.yieldKey()` — an opaque engine handle — so the client echoes a
 * `yieldKey` it was given (planned on `state.stack[]`, M3/M6) and never
 * synthesises one.
 */
export interface SetYieldAct {
  action: 'setYield';
  yieldKey: string;
  mode: SetYieldMode;
}

/**
 * §2.2 (M6) — what `setYield` is saying. `"yes"` is Forge's *Always Yes*
 * (`setTriggerDecision(ACCEPT)` **and** `setShouldAutoYield(true)`), `"no"` its
 * *Always No* (`DECLINE` + auto-yield), `"clear"` puts the question back.
 */
export const SET_YIELD_MODES = ['yes', 'no', 'clear'] as const;
export type SetYieldMode = (typeof SET_YIELD_MODES)[number];

/** What {@link StackItem.yielded} reports back: the two live modes, or `null`. */
export type YieldMode = 'yes' | 'no';

/**
 * The auto-yield state of one stack item, normalised. `offered` is the engine's
 * own two guards — it is an ability, and it has a key — and **not** a rule this
 * client invented: `KeyboardShortcuts.java:159-200` checks exactly those before
 * it touches `setShouldAutoYield` (report 11 §5.1).
 */
export function stackYield(item: StackItem | null | undefined): {
  offered: boolean;
  yieldKey: string | null;
  mode: YieldMode | null;
  optionalTrigger: boolean;
} {
  const key = item?.yieldKey ?? null;
  const mode = item?.yielded === 'yes' || item?.yielded === 'no' ? item.yielded : null;
  return {
    offered: item?.isAbility === true && typeof key === 'string' && key !== '',
    yieldKey: typeof key === 'string' && key !== '' ? key : null,
    mode,
    optionalTrigger: item?.isOptionalTrigger === true,
  };
}

export type ActBody =
  | ClickCardAct
  | ClickPlayerAct
  | ClickAbilityAct
  | ButtonOkAct
  | ButtonCancelAct
  | PassPriorityAct
  | UseManaAct
  | UndoAct
  | AlphaStrikeAct
  | ConcedeAct
  | ClaimWinAct
  | NextGameAct
  | NewGameAct
  | SetPhaseStopAct
  | SetYieldAct
  | YieldToAct;

/**
 * §5.1 — `order`'s answer (report 07 A2 / amendment P7). The jar's
 * `OrderResult` is `record(List<T> ordered, boolean rememberDecision)`, and
 * `ordered` addresses `dest ++ source` by index. **Never `null`.**
 */
export interface OrderAnswer {
  ordered: number[];
  remember: boolean;
}

/** §5.1. The shape of an answer value is per-kind; this is their union. */
export type AnswerValue =
  | null
  | boolean
  | number
  | string
  | number[]
  | Record<string, number>
  | Record<string, number[]>
  | OrderAnswer;

/** §2.3. Exactly one per `ask`. A second for a completed `askId` is dropped. */
export interface AnswerBody {
  askId: string;
  value: AnswerValue;
}

// ---------------------------------------------------------------------------
// The frame union
// ---------------------------------------------------------------------------

export type HelloOkFrame = Envelope<'hello_ok', HelloOkBody>;
export type StateFrame = Envelope<'state', GameStateBody>;
export type InputFrame = Envelope<'input', InputBody>;
export type AskFrame = Envelope<'ask', AskBody>;
export type NoticeFrame = Envelope<'notice', NoticeBody>;
export type OverFrame = Envelope<'over', OverBody>;
export type TableFrame = Envelope<'table', TableBody>;
export type ActFrame = Envelope<'act', ActBody>;
export type AnswerFrame = Envelope<'answer', AnswerBody>;
export type ResyncFrame = Envelope<'resync', EmptyBody>;
export type PingFrame = Envelope<'ping', EmptyBody>;
export type PongFrame = Envelope<'pong', EmptyBody>;

export type ServerFrame =
  | HelloOkFrame
  | StateFrame
  | InputFrame
  | AskFrame
  | NoticeFrame
  | OverFrame
  | TableFrame;

export type ClientFrame = ActFrame | AnswerFrame | ResyncFrame;

export type Frame = ServerFrame | ClientFrame | PingFrame | PongFrame;

// ---------------------------------------------------------------------------
// §8.1 The frame-log session header (line 0 — NOT a frame)
// ---------------------------------------------------------------------------

/**
 * §8.1. One entry per seat. `path` and `sha256` are the **viewing seat's
 * alone** and are `null` for every other seat: a deck path plus its sha256
 * identifies a decklist exactly, and §8.3 promises the log contains only what
 * this player was allowed to see. `cards` (the main deck's card count) is
 * public for every seat.
 */
export interface DeckRef {
  player: number;
  path: string | null;
  sha256: string | null;
  cards: number;
}

/**
 * §8.1. Line 0 of a `.jsonl` frame log. Distinguished from a frame by `kind:"session"`.
 * `seat` is the player id the whole log was redacted for (§8.3).
 */
export interface SessionHeader {
  v: number;
  kind: 'session';
  gameId: string;
  /** ISO-8601 UTC. */
  startedAt: string;
  seed: number | null;
  forgeVersion: string;
  forgeJarSha256: string;
  seat: number;
  /**
   * §8.1. Which client played this seat — **absent from an AI-vs-AI recording**,
   * which has no transport and nobody at the keyboard.
   *
   * It is not decoration. `--transport null` answers *every* ask with a literal
   * `null` on purpose, so that Forge's documented defaults (§5.4) get played,
   * and `tools/check-redaction.mjs` needs this key to tell that apart from a
   * bridge that completed an `order` future with `null` — which wedges the game
   * thread.
   */
  transport?: 'null' | 'auto' | 'console' | 'ws';
  /**
   * §8.1. Present, and `"client"`, only on a log written by a CLIENT
   * (`tools/ws-auto-play.mjs --log`) rather than by the bridge. Absent means the
   * bridge wrote it.
   *
   * It exists for one reader: `tools/check-redaction.mjs` relaxes the `seq`
   * continuity rule — and nothing else — for a client log, because a client
   * legitimately sees a frame re-delivered verbatim (a `resync`, a reconnect)
   * and real forward gaps (the frames it was not connected for). Both are
   * amendment **M10**; in a bridge log the same shapes would be a dropped frame.
   */
  recordedBy?: 'client';
  /**
   * §8.1, amendment **M47**. Present only on a PACED recording
   * (`mtgtable.RecordMatch --pace <ms>`, `scripts/spectate.sh`): the engine
   * dwelt this long at every frame boundary (a quarter of it after a frame that
   * only moved the phase strip), so every `t` in the file is the engine's clock
   * stretched for a watcher. Absent means engine speed.
   */
  paceMs?: number;
  /** §8.1, amendment **M59** — `2` on a seat's log at a table of two; absent otherwise. */
  humans?: 2;
  /**
   * §8.1, amendment **M60** (D407) — at a table of two, whether this seat's
   * player agreed to this game being recorded (the human test set and the
   * automatic review); absent means not agreed.
   */
  record?: boolean;
  /**
   * §8.1, amendment **M62** (D414) — the AI seat's controller when it is not
   * plain Forge (absent for plain Forge and before M62): `outlets`, or the
   * search with its live version (`search-v2`, or null when other knobs were
   * changed), its budget per searched decision and its config string. The
   * search's knobs only — never a card or a deck.
   */
  ai?: { policy: 'outlets' } | { policy: 'search'; version: string | null; budgetMs: number; config: string };
  decks: DeckRef[];
}

/** A parsed frame log: the header plus every frame line, in file order. */
export interface FrameLog {
  header: SessionHeader;
  frames: Frame[];
}
