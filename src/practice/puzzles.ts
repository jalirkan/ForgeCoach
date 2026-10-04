/*
 * ForgeCoach — practice/puzzles.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Practice puzzles from the player's own games. Pure and DOM-free.
 *
 * WHERE A PUZZLE COMES FROM. The film room's turning points (filmRoom.ts: the
 * biggest falls of the score across one of the viewer's decisions, scored by
 * the helper's win chance, the engine review or the rough heuristic) and,
 * when an engine review report is open, its graded mistakes and close calls
 * (gameReview.ts `keyDecisions`, through filmRoom.ts `reviewMoments`). One
 * puzzle per decision; a decision the engine graded carries the engine's
 * numbers whichever source found it.
 *
 * THE OPTIONS. Only what the log says the viewer could do, from the viewer's
 * own redacted state at the decision:
 *  - an engine-graded decision: the report's own option list (the engine's
 *    legal moves at that exact state), named from the log (`tokenLabel`); an
 *    option that stands for another (`alias`: an identical creature) is shown
 *    once;
 *  - otherwise, read from the board (`derived`), for main phases and attacks
 *    only: the lands in hand while the land drop is unused, the spells in hand
 *    the untapped mana covers (state.ts `canPay`, lenient), anything the player
 *    actually played there (it was legal: it happened), and "play nothing"; an
 *    attack lists the untapped, non-sick creatures (and any that attacked) and
 *    "no attack". Other moments without an engine grade make no puzzle.
 *
 * CHECKING. With the engine's numbers, a pick is compared with the engine's
 * best under gameReview.ts's honesty rules: a regret under TIE_REGRET is a
 * tie; a regret interval that includes zero is a close call, never a mistake;
 * only an interval wholly above zero says the engine's playouts prefer the
 * best. A short-horizon ("leaf") measure is never called a win rate. Without
 * the engine there is no right answer to check against: the pick is only
 * compared with what was played in the game.
 *
 * STORAGE. A small JSON list in localStorage (injected `Storage`): the puzzle
 * (no board: the board is read from the saved game's log when it is opened),
 * the player's tries, and which saved games were already scanned.
 */
import type { AnyCard, Card, GameEvent, GameStateBody } from '../protocol.ts';
import { isHidden } from '../protocol.ts';
import type { GameLog } from '../log.ts';
import { phaseLabel, type Decision, type DecisionKind } from '../decisions.ts';
import { canPay, turnFacts, untappedManaSources, castIsAbility } from '../state.ts';
import { visibleName } from '../review.ts';
import {
  decisionState,
  fmtInterval,
  fmtRate,
  fmtRegret,
  includesZero,
  knowledgeWarning,
  reportMatchesLog,
  sameOption,
  tokenCardIds,
  tokenLabel,
  TIE_REGRET,
  verdictLabel,
  type ReviewDecision,
  type ReviewMeasure,
  type ReviewReport,
} from '../gameReview.ts';
import { filmPrompt, pickFilm, reviewMoments, type Film, type FilmMoment, type FilmSource } from '../filmRoom.ts';
import type { CardInfo } from '../cards.ts';
import type { Prompt } from '../prompt.ts';

// ---------------------------------------------------------------------------
// The model

export interface PuzzleGame {
  /** `<gameId>@<startedAt>` (CoachPanel `gameKey`, history/record.ts record id). */
  ref: string;
  /** A shipped sample log (public/samples/<id>.jsonl.gz), else a saved game in Your record. */
  sample: string | null;
  title: string;
}

export interface PuzzleOption {
  /** An engine token ("cast:6", "attack:25,31", "pass") or a derived id ("land:Island", "cast:Opt", "atk:25", "none"). */
  id: string;
  label: string;
  /** Cards to highlight (ids in the decision's state). */
  cardIds: number[];
}

export interface EngineOption {
  id: string;
  n: number | null;
  winRate: number | null;
  winLo: number | null;
  winHi: number | null;
  regret: number | null;
  regretLo: number | null;
  regretHi: number | null;
}

export interface PuzzleEngine {
  /** The report's decision (its frame). */
  frame: number;
  measure: ReviewMeasure;
  /** The engine's best option's id, when it named one. */
  best: string | null;
  /** The verdict on what was played: "Mistake — clear", "Close call", "Close call — a tie", "Best play". */
  verdict: string;
  options: EngineOption[];
  /** The report's warning about how the opponent's hidden cards were modelled (basic lands: every number flatters the player). */
  warning: string | null;
}

export interface PuzzleSwing {
  source: FilmSource;
  /** Before → after (eval, heuristic: scored positions; review: the best option's score → the played one's). */
  before: number;
  after: number;
  drop: number;
  beforeTurn: number;
  afterTurn: number;
  measure: ReviewMeasure | null;
}

export type PuzzleOutcome = 'best' | 'tie' | 'close' | 'worse' | 'ungraded' | 'same' | 'different';

export interface PuzzleTry {
  at: string;
  chose: string[];
  outcome: PuzzleOutcome;
}

export interface Puzzle {
  v: 1;
  /** `<game ref>:f<decision frame>`. */
  id: string;
  game: PuzzleGame;
  addedAt: string;
  /** The decision's frame (decisions.ts `frameIndex`). */
  decisionFrame: number;
  /** The state frame the board shows (the engine's graded state, else the decision's). */
  boardFrame: number;
  turn: number;
  phase: string | null;
  kind: DecisionKind;
  /** "Turn 7 · your main 1". */
  title: string;
  /** "Which spell would you cast first — or pass?" */
  question: string;
  /** Pick several (a main phase or an attack read from the board), else one. */
  multi: boolean;
  /** Options read from the board rather than the engine's list. */
  derived: boolean;
  options: PuzzleOption[];
  /** The option ids played in the game (several for a derived main phase or attack; empty = nothing). */
  played: string[];
  /** What the player did there, in words (decisions.ts `actions`). */
  playedWords: string[];
  swing: PuzzleSwing;
  engine: PuzzleEngine | null;
  tries: PuzzleTry[];
}

// ---------------------------------------------------------------------------
// Options read from the board

const isCard = (c: AnyCard | undefined | null): c is Card => !!c && !isHidden(c);
const isLand = (c: Card) => /\bLand\b/.test(c.types);
const isCreature = (c: Card) => /\bCreature\b/.test(c.types);
const sorcerySpeed = (c: Card) => !/\b(Instant)\b/.test(c.types) && !(c.keywords ?? []).some((k) => /^flash$/i.test(k));

interface Played {
  lands: number[];
  casts: number[];
  attackers: number[] | null;
}

/** What the viewer played inside the decision's frames, read from the engine's events (never the clicks). */
export function playedInDecision(log: GameLog, d: Decision, seat: number): Played {
  const out: Played = { lands: [], casts: [], attackers: null };
  let prev: GameStateBody = d.state;
  const end = Math.max(d.frameIndex, d.endFrameIndex);
  for (let i = d.frameIndex + 1; i <= end && i < log.frames.length; i++) {
    const f = log.frames[i]!;
    if (f.type !== 'state' || (f.dir ?? 's2c') !== 's2c') continue;
    const st = f.body as GameStateBody;
    for (const e of (st.events ?? []) as GameEvent[]) {
      if (e.kind === 'turn' && e.turn !== d.state.turn) return out;
      if (e.kind === 'land' && e.player === seat) out.lands.push(e.cardId);
      else if (e.kind === 'cast' && e.controller === seat && !castIsAbility(e, st, prev)) out.casts.push(e.cardId);
      else if (e.kind === 'attackers' && e.player === seat) out.attackers = [...(out.attackers ?? []), ...e.bands.flatMap((b) => b.attackerIds)];
    }
    prev = st;
  }
  return out;
}

/** A card's name as the viewer saw it, from the decision's state or, failing that, a later one. */
function nameIn(log: GameLog, d: Decision, id: number): string | null {
  const find = (st: GameStateBody): AnyCard | undefined => {
    for (const p of st.players) for (const z of Object.values(p.zones)) for (const c of z.cards) if (c.id === id) return c;
    return (st.stackCards ?? []).find((c) => c.id === id);
  };
  const here = find(d.state);
  if (here) return visibleName(here);
  const end = Math.max(d.frameIndex, d.endFrameIndex);
  for (let i = d.frameIndex + 1; i <= end && i < log.frames.length; i++) {
    const f = log.frames[i]!;
    if (f.type !== 'state') continue;
    const c = find(f.body as GameStateBody);
    if (c) return visibleName(c);
  }
  return null;
}

export interface DerivedOptions {
  options: PuzzleOption[];
  played: string[];
  multi: true;
  question: string;
}

/**
 * The options of a main phase or an attack, read from the viewer's own state
 * (see the file header); null for any other kind of decision.
 */
export function derivedOptions(log: GameLog, d: Decision, seat: number): DerivedOptions | null {
  const me = d.state.players.find((p) => p.id === seat);
  if (!me) return null;
  const did = playedInDecision(log, d, seat);
  if (d.kind === 'main') {
    const hand = me.zones.hand.cards.filter(isCard);
    let landPlayed: boolean | null = null;
    try {
      landPlayed = turnFacts(log, d.frameIndex, seat).landPlayed;
    } catch {
      landPlayed = null;
    }
    const sources = untappedManaSources(d.state, seat);
    const byId = new Map<string, PuzzleOption>();
    const add = (id: string, label: string, cardId: number) => {
      const o = byId.get(id);
      if (o) {
        if (!o.cardIds.includes(cardId)) o.cardIds.push(cardId);
      } else byId.set(id, { id, label, cardIds: [cardId] });
    };
    const stackEmpty = (d.state.stack ?? []).length === 0;
    for (const c of hand) {
      if (isLand(c)) {
        if (landPlayed !== true) add(`land:${c.name}`, `Play ${c.name}`, c.id);
      } else if ((stackEmpty || !sorcerySpeed(c)) && c.manaCost !== null && canPay(c.manaCost, sources)) {
        add(`cast:${c.name}`, `Cast ${c.name}`, c.id);
      }
    }
    // Whatever was played was legal: it is always an option.
    const played: string[] = [];
    for (const id of did.lands) {
      const n = nameIn(log, d, id);
      if (!n) continue;
      add(`land:${n}`, `Play ${n}`, id);
      played.push(`land:${n}`);
    }
    for (const id of did.casts) {
      const n = nameIn(log, d, id);
      if (!n) continue;
      add(`cast:${n}`, `Cast ${n}`, id);
      if (!played.includes(`cast:${n}`)) played.push(`cast:${n}`);
    }
    const options = [...byId.values()].sort((a, b) => Number(b.id.startsWith('land:')) - Number(a.id.startsWith('land:')) || a.label.localeCompare(b.label));
    if (!options.length) return null;
    options.push({ id: 'none', label: 'Play nothing', cardIds: [] });
    return { options, played: played.length ? played : ['none'], multi: true, question: 'What would you play this main phase? Pick everything you would play, or “Play nothing”.' };
  }
  if (d.kind === 'attack') {
    const attacked = new Set(did.attackers ?? []);
    const creatures = me.zones.battlefield.cards.filter(isCard).filter((c) => isCreature(c) && ((!c.tapped && !c.sick) || attacked.has(c.id)));
    if (!creatures.length) return null;
    const count = new Map<string, number>();
    for (const c of creatures) count.set(c.name, (count.get(c.name) ?? 0) + 1);
    const options: PuzzleOption[] = creatures.map((c) => ({
      id: `atk:${c.id}`,
      label: `${c.name}${(count.get(c.name) ?? 0) > 1 ? ` #${c.id}` : ''}${c.power !== null && c.toughness !== null ? ` (${c.power}/${c.toughness})` : ''}`,
      cardIds: [c.id],
    }));
    options.push({ id: 'none', label: 'No attack', cardIds: [] });
    const played = creatures.filter((c) => attacked.has(c.id)).map((c) => `atk:${c.id}`);
    return { options, played: played.length ? played : ['none'], multi: true, question: 'Who attacks? Pick every attacker, or “No attack”.' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Options from the engine review

const ENGINE_QUESTION: Record<ReviewDecision['type'], string> = {
  spell: 'What would you cast first here — or would you pass?',
  attack: 'How would you attack?',
  block: 'How would you block?',
  target: 'Which target would you pick?',
};

/** A graded decision with at least two options that have a score. */
export function gradable(r: ReviewDecision): boolean {
  return r.status === 'ok' && r.verdict !== 'not-graded' && r.options.filter((o) => o.winRate !== null).length >= 2;
}

export function engineOptions(log: GameLog, r: ReviewDecision, seat: number): { options: PuzzleOption[]; engine: EngineOption[]; played: string[]; best: string | null } {
  const st = decisionState(log, r);
  const options: PuzzleOption[] = [];
  const engine: EngineOption[] = [];
  for (const o of r.options) {
    // An option standing for another one already listed (an identical creature) is shown once.
    if (o.alias && options.some((x) => x.id === o.alias)) continue;
    options.push({ id: o.token, label: tokenLabel(o.token, st, seat, o.label), cardIds: tokenCardIds(o.token) });
    engine.push({ id: o.token, n: o.n, winRate: o.winRate, winLo: o.winLo, winHi: o.winHi, regret: o.regret, regretLo: o.regretLo, regretHi: o.regretHi });
  }
  const resolve = (tok: string | null): string | null => {
    if (!tok) return null;
    const hit = r.options.find((o) => sameOption(o, tok));
    if (!hit) return null;
    return options.some((x) => x.id === hit.token) ? hit.token : (hit.alias ?? hit.token);
  };
  const playedOpt = r.options.find((o) => o.played);
  const played = resolve(playedOpt?.token ?? r.played);
  const bestOpt = r.options.find((o) => o.best);
  return { options, engine, played: played ? [played] : [], best: resolve(bestOpt?.token ?? r.best) };
}

/** The graded engine decision inside a replay decision's frames (the first of its type that was graded), or null. */
export function engineDecisionFor(decisions: readonly ReviewDecision[], d: Decision, frame?: number): ReviewDecision | null {
  if (frame !== undefined) return decisions.find((x) => x.frame === frame && gradable(x)) ?? null;
  const lo = d.frameIndex;
  const hi = Math.max(lo, d.endFrameIndex);
  return [...decisions].sort((a, b) => a.stateFrame - b.stateFrame).find((x) => x.stateFrame >= lo && x.stateFrame <= hi && gradable(x)) ?? null;
}

// ---------------------------------------------------------------------------
// Building puzzles

export function puzzleTitle(d: Decision, seat: number): string {
  return `Turn ${d.state.turn} · ${d.state.activePlayer === seat ? 'your' : 'their'} ${phaseLabel(d.state.phase)}`;
}

function puzzleFrom(log: GameLog, game: PuzzleGame, m: FilmMoment, graded: readonly ReviewDecision[], report: ReviewReport | null, now: string): Puzzle | null {
  const d = m.decision;
  const seat = log.seat;
  const r = engineDecisionFor(graded, d, m.review?.frame);
  const base = {
    v: 1 as const,
    id: `${game.ref}:f${d.frameIndex}`,
    game,
    addedAt: now,
    decisionFrame: d.frameIndex,
    turn: m.turn,
    phase: d.state.phase,
    kind: d.kind,
    title: puzzleTitle(d, seat),
    playedWords: [...d.actions],
    swing: { source: m.source, before: m.before.p, after: m.after.p, drop: m.drop, beforeTurn: m.before.turn, afterTurn: m.after.turn, measure: m.review?.measure ?? null },
    tries: [],
  };
  if (r) {
    const eo = engineOptions(log, r, seat);
    if (eo.options.length < 2) return null;
    return {
      ...base,
      boardFrame: r.stateFrame,
      question: ENGINE_QUESTION[r.type],
      multi: false,
      derived: false,
      options: eo.options,
      played: eo.played,
      engine: {
        frame: r.frame,
        measure: r.measure,
        best: eo.best,
        verdict: verdictLabel(r),
        options: eo.engine,
        warning: report ? knowledgeWarning(report.knowledge) : null,
      },
    };
  }
  const dv = derivedOptions(log, d, seat);
  if (!dv || dv.options.length < 2) return null;
  return { ...base, boardFrame: d.frameIndex, question: dv.question, multi: true, derived: true, options: dv.options, played: dv.played, engine: null };
}

export interface GameInput {
  log: GameLog;
  game: PuzzleGame;
  decisions: readonly Decision[];
  /** The film as the film room settled it (the win chance when the helper scored it); the heuristic film when omitted. */
  film?: Film | null;
  report?: ReviewReport | null;
  now?: () => number;
  /** The engine's graded moments to add beside the film (default 5). */
  reviewMax?: number;
}

/**
 * The puzzles of one game: one per turning point of the film and per engine
 * mistake or close call, largest first, one per decision (an engine-graded
 * version wins).
 */
export function puzzlesFromGame(input: GameInput): Puzzle[] {
  const { log, game, decisions } = input;
  const report = input.report ?? null;
  const now = new Date((input.now ?? Date.now)()).toISOString();
  const graded = report ? reportMatchesLog(report, log).decisions.filter(gradable) : [];
  // The film's own turning points (win chance, else the heuristic), then the engine's graded moments beside them.
  const film = input.film ?? pickFilm({ log, decisions });
  const moments: FilmMoment[] = [...film.moments];
  if (report) moments.push(...reviewMoments(log, decisions, report, input.reviewMax ?? 5));
  const out = new Map<string, Puzzle>();
  for (const m of moments) {
    const p = puzzleFrom(log, game, m, graded, report, now);
    if (!p) continue;
    const had = out.get(p.id);
    if (!had) out.set(p.id, p);
    else out.set(p.id, { ...(p.engine && !had.engine ? p : had), swing: betterSwing(had.swing, p.swing) });
  }
  return [...out.values()];
}

const SOURCE_RANK: Record<FilmSource, number> = { eval: 3, review: 2, heuristic: 1 };

function betterSwing(a: PuzzleSwing, b: PuzzleSwing): PuzzleSwing {
  return SOURCE_RANK[b.source] > SOURCE_RANK[a.source] ? b : a;
}

// ---------------------------------------------------------------------------
// Checking an answer

export interface PuzzleResult {
  outcome: PuzzleOutcome;
  /** The pick matches what was played in the game. */
  sameAsGame: boolean;
  headline: string;
  detail: string;
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Normalises a pick: "none" alone means nothing; unknown ids are dropped; order follows the options. */
export function normalizePick(p: Pick<Puzzle, 'options' | 'multi'>, chosen: readonly string[]): string[] {
  const known = p.options.filter((o) => chosen.includes(o.id)).map((o) => o.id);
  if (!p.multi) return known.slice(0, 1);
  const real = known.filter((x) => x !== 'none');
  return real.length ? real : known.includes('none') ? ['none'] : [];
}

function optionLabel(p: Pick<Puzzle, 'options'>, id: string | null): string {
  return (id && p.options.find((o) => o.id === id)?.label) || 'unknown';
}

/**
 * The verdict on a pick. Engine-graded: against the engine's best, with the
 * honesty rules of the file header. Otherwise only against the game.
 */
export function checkAnswer(p: Pick<Puzzle, 'options' | 'multi' | 'played' | 'engine'>, chosen: readonly string[]): PuzzleResult {
  const pick = normalizePick(p, chosen);
  const sameAsGame = p.played.length > 0 && sameSet(pick, p.played);
  const e = p.engine;
  if (!e || p.multi) {
    return {
      outcome: sameAsGame ? 'same' : 'different',
      sameAsGame,
      headline: sameAsGame ? 'Same as you played in the game' : 'Different from what you played in the game',
      detail: 'The engine did not grade this moment, so there is no right answer to check against: compare with how the game went and the coach’s view.',
    };
  }
  const id = pick[0] ?? null;
  const o = e.options.find((x) => x.id === id) ?? null;
  const unit = e.measure === 'wins' ? 'win rate' : 'short-horizon score (not a win rate)';
  if (!o || o.winRate === null) {
    return { outcome: 'ungraded', sameAsGame, headline: 'The engine has no score for that option', detail: 'It was legal, but the review did not play it out.' };
  }
  if (id === e.best) {
    return { outcome: 'best', sameAsGame, headline: 'The engine’s pick', detail: `Its playouts scored it highest: ${fmtRate(o.winRate, e.measure)} ${unit}.` };
  }
  const best = e.options.find((x) => x.id === e.best) ?? null;
  const regret = o.regret ?? (best && best.winRate !== null ? best.winRate - o.winRate : null);
  const bestWords = best ? `${optionLabel(p, best.id)} (${fmtRate(best.winRate, e.measure)})` : 'the engine’s best';
  if (regret !== null && Math.abs(regret) < TIE_REGRET) {
    return { outcome: 'tie', sameAsGame, headline: 'A tie with the engine’s pick', detail: `${fmtRate(o.winRate, e.measure)} against ${bestWords}: no difference within rounding.` };
  }
  if (o.regretLo === null || o.regretHi === null || includesZero(o)) {
    const iv = fmtInterval(o.regretLo, o.regretHi, e.measure, 'regret');
    return {
      outcome: 'close',
      sameAsGame,
      headline: 'A close call',
      detail: `The engine’s best was ${bestWords}; yours scored ${fmtRate(o.winRate, e.measure)}. ${iv ? `The gap’s interval (${iv}) includes zero` : 'The engine gave no interval for the gap'}, so the playouts cannot tell them apart — not a mistake.`,
    };
  }
  return {
    outcome: 'worse',
    sameAsGame,
    headline: 'The engine’s playouts prefer another line',
    detail: `${bestWords} over yours (${fmtRate(o.winRate, e.measure)}): ${fmtRegret(regret, e.measure)}, interval ${fmtInterval(o.regretLo, o.regretHi, e.measure, 'regret')}, wholly above zero.`,
  };
}

/** "Practice: the engine's pick" style one-word status for the list. */
export const OUTCOME_WORDS: Record<PuzzleOutcome, string> = {
  best: 'Engine’s pick',
  tie: 'Tie',
  close: 'Close call',
  worse: 'Engine preferred another',
  ungraded: 'Not scored',
  same: 'As in the game',
  different: 'Different from the game',
};

// ---------------------------------------------------------------------------
// The swing in words

export const SWING_SOURCE_WORDS: Record<FilmSource, string> = {
  eval: 'Win chance (local model, Forge-vs-Forge trained), from your view',
  review: 'Engine review: the best option’s score against the one you played',
  heuristic: 'Rough swing from life, board and cards in hand — not a win chance',
};

/** "62% → 41% (−21 points) by the next time you held priority". */
export function swingWords(s: PuzzleSwing): string {
  const n = Math.round(s.drop * 100);
  if (s.source === 'review') {
    const m = s.measure ?? 'wins';
    return `Best ${fmtRate(s.before, m)}, played ${fmtRate(s.after, m)}: regret ${fmtRegret(s.drop, m)}${m === 'leaf' ? ' (short-horizon score)' : ''}`;
  }
  if (s.source === 'heuristic') return `${Math.round(s.before * 100)}/100 → ${Math.round(s.after * 100)}/100 (−${n}, rough) by the next time you held priority (turn ${s.afterTurn})`;
  return `${Math.round(s.before * 100)}% → ${Math.round(s.after * 100)}% (−${n} points) by the next time you held priority (turn ${s.afterTurn})`;
}

// ---------------------------------------------------------------------------
// The list in storage

export const PUZZLE_KEY = 'forgecoach.practice.v1';
/** At most this many puzzles are kept; the oldest untried go first. */
export const MAX_PUZZLES = 150;
/** At most this many tries per puzzle are kept. */
const MAX_TRIES = 20;

export interface PuzzleBook {
  v: 1;
  puzzles: Puzzle[];
  /** Game refs already turned into puzzles (from Your record), so a scan does not repeat them. */
  scanned: string[];
}

export const emptyBook = (): PuzzleBook => ({ v: 1, puzzles: [], scanned: [] });

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

function validPuzzle(x: unknown): x is Puzzle {
  if (!isObj(x) || x.v !== 1 || typeof x.id !== 'string' || !isObj(x.game) || typeof x.game.ref !== 'string') return false;
  if (typeof x.decisionFrame !== 'number' || typeof x.boardFrame !== 'number' || !Array.isArray(x.options) || !Array.isArray(x.played)) return false;
  if (!isObj(x.swing) || !Array.isArray(x.tries)) return false;
  return x.options.every((o) => isObj(o) && typeof o.id === 'string' && typeof o.label === 'string');
}

/** The stored book; a missing or broken one reads as empty (bad entries are dropped). */
export function loadBook(storage: Pick<Storage, 'getItem'> | null): PuzzleBook {
  try {
    const raw = storage?.getItem(PUZZLE_KEY);
    if (!raw) return emptyBook();
    const j = JSON.parse(raw) as unknown;
    if (!isObj(j) || j.v !== 1) return emptyBook();
    return {
      v: 1,
      puzzles: Array.isArray(j.puzzles) ? j.puzzles.filter(validPuzzle) : [],
      scanned: Array.isArray(j.scanned) ? j.scanned.filter((s): s is string => typeof s === 'string') : [],
    };
  } catch {
    return emptyBook();
  }
}

export function saveBook(storage: Pick<Storage, 'setItem'> | null, book: PuzzleBook): boolean {
  try {
    storage?.setItem(PUZZLE_KEY, JSON.stringify(book));
    return !!storage;
  } catch {
    return false;
  }
}

/**
 * Adds or refreshes puzzles. A puzzle already in the book keeps its tries and
 * its place; its content is replaced when the new one has the engine's
 * numbers and the old one did not, and its swing when the new source is
 * better (win chance over engine review over the heuristic).
 */
export function mergePuzzles(book: PuzzleBook, add: readonly Puzzle[], scannedRef?: string): PuzzleBook {
  const byId = new Map(book.puzzles.map((p) => [p.id, p]));
  const order = book.puzzles.map((p) => p.id);
  for (const n of add) {
    const old = byId.get(n.id);
    if (!old) {
      byId.set(n.id, n);
      order.push(n.id);
      continue;
    }
    const content = n.engine && !old.engine ? { ...n, addedAt: old.addedAt } : old;
    byId.set(n.id, { ...content, swing: betterSwing(old.swing, n.swing), tries: old.tries });
  }
  let puzzles = order.map((id) => byId.get(id)!);
  if (puzzles.length > MAX_PUZZLES) {
    const drop = new Set(
      puzzles
        .filter((p) => p.tries.length === 0)
        .sort((a, b) => (a.addedAt < b.addedAt ? -1 : 1))
        .slice(0, puzzles.length - MAX_PUZZLES)
        .map((p) => p.id),
    );
    puzzles = puzzles.filter((p) => !drop.has(p.id)).slice(-MAX_PUZZLES);
  }
  const scanned = scannedRef && !book.scanned.includes(scannedRef) ? [...book.scanned, scannedRef] : book.scanned;
  return { v: 1, puzzles, scanned };
}

export function recordTry(book: PuzzleBook, id: string, chose: readonly string[], outcome: PuzzleOutcome, now: () => number = Date.now): PuzzleBook {
  return {
    ...book,
    puzzles: book.puzzles.map((p) => (p.id === id ? { ...p, tries: [...p.tries, { at: new Date(now()).toISOString(), chose: [...chose], outcome }].slice(-MAX_TRIES) } : p)),
  };
}

export function removeGame(book: PuzzleBook, ref: string): PuzzleBook {
  return { ...book, puzzles: book.puzzles.filter((p) => p.game.ref !== ref) };
}

/** The order to practise in: never tried first (newest game first), then the ones tried longest ago. */
export function practiceOrder(puzzles: readonly Puzzle[]): Puzzle[] {
  const last = (p: Puzzle) => p.tries[p.tries.length - 1]?.at ?? '';
  return [...puzzles].sort((a, b) => {
    const ta = a.tries.length ? 1 : 0;
    const tb = b.tries.length ? 1 : 0;
    if (ta !== tb) return ta - tb;
    if (!ta) return a.addedAt < b.addedAt ? 1 : a.addedAt > b.addedAt ? -1 : b.swing.drop - a.swing.drop;
    return last(a) < last(b) ? -1 : last(a) > last(b) ? 1 : 0;
  });
}

export interface BookSummary {
  total: number;
  tried: number;
  /** Tries whose last outcome was the engine's pick or a tie. */
  engineAgreed: number;
  graded: number;
}

export function summarizeBook(puzzles: readonly Puzzle[]): BookSummary {
  const tried = puzzles.filter((p) => p.tries.length);
  return {
    total: puzzles.length,
    tried: tried.length,
    graded: puzzles.filter((p) => p.engine).length,
    engineAgreed: tried.filter((p) => {
      const o = p.tries[p.tries.length - 1]!.outcome;
      return o === 'best' || o === 'tie';
    }).length,
  };
}

// ---------------------------------------------------------------------------
// The moment back from a puzzle (for the coach prompt)

/** The film-room moment a puzzle stands for, rebuilt against the game's decision list. */
export function puzzleMoment(p: Puzzle, decision: Decision): FilmMoment {
  const e = p.engine;
  const best = e?.best ? p.options.find((o) => o.id === e.best)?.label ?? null : null;
  const played = p.played[0] ? p.options.find((o) => o.id === p.played[0])?.label ?? 'unknown' : 'unknown';
  return {
    rank: 1,
    source: p.swing.source,
    decision,
    turn: p.turn,
    before: { frameIndex: p.boardFrame, turn: p.swing.beforeTurn, p: p.swing.before },
    after: { frameIndex: p.boardFrame, turn: p.swing.afterTurn, p: p.swing.after },
    drop: p.swing.drop,
    ...(e && p.swing.source === 'review'
      ? { review: { frame: e.frame, verdict: e.verdict, measure: e.measure, played, best, regret: e.options.find((o) => o.id === p.played[0])?.regret ?? null } }
      : {}),
  };
}

/** The lines the practice prompt adds to the film prompt: the engine's table (when graded) and the player's practice pick. */
export function practiceLines(p: Puzzle, chosen: readonly string[]): string[] {
  const pick = normalizePick(p, chosen);
  const lines: string[] = ['# Practice', `The player replayed this moment as a puzzle (“${p.question}”) and picked: ${pick.length ? pick.map((id) => optionLabel(p, id)).join('; ') : 'nothing'}.`];
  if (p.derived) lines.push('The options were read from the player’s own view of the board (lands still playable, spells the untapped mana covers, what was played); the engine did not grade this moment.');
  const e = p.engine;
  if (e) {
    lines.push(`Engine review (${e.measure === 'wins' ? 'win rate: playouts to the end of the game' : 'short-horizon score: playouts to the end of the turn — not a win rate'}; yardstick: the best play against Forge's Default AI):`);
    for (const o of e.options) {
      const marks = [o.id === e.best ? 'engine best' : null, p.played.includes(o.id) ? 'played in the game' : null, pick.includes(o.id) ? 'practice pick' : null].filter(Boolean).join(', ');
      const iv = fmtInterval(o.winLo, o.winHi, e.measure);
      lines.push(`- ${optionLabel(p, o.id)}: ${fmtRate(o.winRate, e.measure)}${iv ? ` (${iv})` : ''}${o.n !== null ? `, ${o.n} playouts` : ''}${marks ? ` [${marks}]` : ''}`);
    }
    if (e.warning) lines.push(`Caution: ${e.warning}`);
    lines.push('A gap whose interval includes zero is a close call, never a mistake.');
  }
  return lines;
}

/**
 * The coach prompt for a puzzle after the reveal: the film room's prompt for
 * the moment (the state at the decision, what could be done, what was done,
 * the swing) with the practice section before its question. Deterministic.
 */
export function puzzlePrompt(log: GameLog, p: Puzzle, decision: Decision, cards: Map<string, CardInfo>, chosen: readonly string[]): Prompt {
  const base = filmPrompt(log, puzzleMoment(p, decision), cards);
  const q = base.user.lastIndexOf('\n# Question');
  const head = q >= 0 ? base.user.slice(0, q) : base.user;
  const question = [
    '# Question',
    `This moment came back as a practice puzzle (${p.title}). Was my practice pick a good one here, how does it compare with what I played in the game${p.engine ? ' and with the engine’s numbers' : ''}, and what is the rule of thumb?`,
  ];
  return { system: base.system, user: [head, '', ...practiceLines(p, chosen), '', ...question].join('\n') };
}

/** The answer store key for a puzzle's coach answer (a different pick is a different question). */
export function puzzleAnswerKey(p: Pick<Puzzle, 'id' | 'options' | 'multi'>, chosen: readonly string[]): string {
  return `${p.id}:practice:${normalizePick(p, chosen).join('+') || 'none'}`;
}
