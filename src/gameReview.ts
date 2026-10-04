/*
 * ForgeCoach — gameReview.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The engine's post-game review (mtg-table docs/game-review.md, D353): a JSON
 * report that says, for each decision the player made, what every option was
 * worth in playouts, what the player chose and what the engine thinks was
 * best, with intervals. This module reads that report and nothing else:
 *
 * - `parseReviewReport` validates an untrusted report into a view model:
 *   strings cleaned and capped, rates range-checked to [0, 1], unknown fields
 *   ignored, a bad decision dropped with a warning instead of failing it all.
 *   Honesty is enforced here, not trusted: a decision whose regret interval
 *   includes zero is never a "mistake" (it reads as a close call).
 * - `reportMatchesLog` checks it is this log's report (game id, seat, frames).
 * - `tokenLabel` names an option ("cast:6", "attack:25,31", "block:94>91")
 *   from the log's own redacted state at the decision — never from anything
 *   the viewer could not see.
 * - `reviewTimeline` groups the decisions by turn for the timeline.
 * - `reviewExplainPrompt` is the deterministic prompt that asks the coach to
 *   explain the key moments from the engine's table. The coach explains the
 *   numbers; it does not re-solve the position.
 *
 * DOM-free, tested in node.
 */
import type { AnyCard, Card, GameStateBody } from './protocol.ts';
import { isHidden } from './protocol.ts';
import type { GameLog } from './log.ts';
import type { CardInfo } from './cards.ts';
import type { Prompt } from './prompt.ts';
import { cardIndex, phaseLabel } from './decisions.ts';
import { formatCardTexts, isBasicLandName, visibleName } from './review.ts';
import { cleanText, int, num, parseTime } from './lab/status.ts';

// ---------------------------------------------------------------------------
// The view model

export type ReviewType = 'spell' | 'attack' | 'block' | 'target';
export type ReviewStatus = 'ok' | 'trivial' | 'unsupported' | 'error' | 'refused';
export type ReviewStage = 'deep' | 'triage';
/** `wins`: playouts to the end of the game (a win rate). `leaf`: to the end of the turn, scored by an evaluator (not a win rate). */
export type ReviewMeasure = 'wins' | 'leaf';
export type ReviewVerdict = 'best' | 'close' | 'mistake' | 'not-graded';

export interface ReviewOption {
  token: string;
  /** The engine's label (cleaned); the UI prefers `tokenLabel` from the log. */
  label: string | null;
  n: number | null;
  winRate: number | null;
  winLo: number | null;
  winHi: number | null;
  regret: number | null;
  regretLo: number | null;
  regretHi: number | null;
  best: boolean;
  forge: boolean;
  played: boolean;
  /** Another token this option stands for (identical creatures, another copy). */
  alias: string | null;
}

export interface ReviewTriage {
  measure: ReviewMeasure | null;
  rounds: number | null;
  best: string | null;
  regret: number | null;
  regretLo: number | null;
  regretHi: number | null;
}

export interface ReviewDecision {
  /** The moment: everything before this index of `log.frames`. */
  frame: number;
  /** The state frame in force (what the board shows). */
  stateFrame: number;
  turn: number | null;
  round: number | null;
  phase: string | null;
  type: ReviewType;
  status: ReviewStatus;
  error: string | null;
  stage: ReviewStage;
  measure: ReviewMeasure;
  rounds: number | null;
  playouts: number | null;
  ms: number | null;
  played: string | null;
  playedOption: string | null;
  playedLabel: string | null;
  best: string | null;
  bestLabel: string | null;
  forgeChoice: string | null;
  regret: number | null;
  regretLo: number | null;
  regretHi: number | null;
  verdict: ReviewVerdict;
  /** regretLo > 0: the difference is statistically clear. Derived, not trusted. */
  clear: boolean;
  key: boolean;
  rank: number | null;
  selectReason: string | null;
  options: ReviewOption[];
  fidelity: string[];
  notes: string[];
  triage: ReviewTriage | null;
}

export interface ReviewSummary {
  decisions: number;
  graded: number;
  best: number;
  closeCalls: number;
  mistakes: number;
  notGraded: number;
  /** Decisions with one legal option (their verdict is not-graded). */
  trivial: number;
  deepened: number;
}

export interface ReviewReport {
  v: 1;
  gameId: string;
  seat: number;
  log: string | null;
  /** How many frames the graded log had. */
  frames: number | null;
  createdAt: Date | null;
  yardstick: string;
  knowledge: {
    opponent: string | null;
    ownDeck: string | null;
    /**
     * How the opponent's hidden cards were modelled: from the cube pool, from a
     * deck marked public, or as basic lands (nothing known: every number
     * flatters the player). From `knowledge.opponentModel`, else read from
     * `opponent`; null when neither says.
     */
    opponentModel: OpponentModel | null;
  };
  config: Record<string, number>;
  timing: Record<string, number>;
  /** Counted from the decisions kept (the report's own counts are not trusted). */
  summary: ReviewSummary;
  /** Key decisions' frames, most important first (only frames of kept decisions). */
  keyMoments: number[];
  /** In frame order. */
  decisions: ReviewDecision[];
  /** What was dropped or corrected while reading the report. */
  warnings: string[];
}

export type OpponentModel = 'pool' | 'deck' | 'basic-lands';

export class ReviewReportError extends Error {}

function opponentModelOf(model: unknown, opponent: string | null): OpponentModel | null {
  if (model === 'pool' || model === 'deck' || model === 'basic-lands') return model;
  const o = (opponent ?? '').trim().toLowerCase();
  if (o.startsWith('pool')) return 'pool';
  if (o.startsWith('public') || o.startsWith('deck')) return 'deck';
  if (o === 'unknown' || o.startsWith('basic')) return 'basic-lands';
  return null;
}

/** Regret this small is no regret: the played option tied the best (within rounding). */
export const TIE_REGRET = 0.005;

/** A close call whose point regret is zero: as good as the engine's best within noise. */
export function isTie(d: Pick<ReviewDecision, 'verdict' | 'regret'>): boolean {
  return d.verdict === 'close' && d.regret !== null && Math.abs(d.regret) < TIE_REGRET;
}

// ---------------------------------------------------------------------------
// Validation

/** Reports over this many bytes are refused before parsing (the helper caps requests at 256 KB; reports are bigger). */
export const MAX_REPORT_BYTES = 4 * 1024 * 1024;
const MAX_DECISIONS = 400;
const MAX_OPTIONS = 40;
const MAX_LINES = 12;
const MAX_FRAME = 10_000_000;
const MAX_WARNINGS = 30;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

const TYPES: readonly ReviewType[] = ['spell', 'attack', 'block', 'target'];
const STATUSES: readonly ReviewStatus[] = ['ok', 'trivial', 'unsupported', 'error', 'refused'];
const VERDICTS: readonly ReviewVerdict[] = ['best', 'close', 'mistake', 'not-graded'];

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

/** A rate (win rate, its interval): a number in [0, 1]. */
const rate = (v: unknown): number | null => (typeof v === 'number' ? num(v, 0, 1) : null);
/** A regret or its interval bound: a difference of two rates, in [-1, 1]. */
const diff = (v: unknown): number | null => (typeof v === 'number' ? num(v, -1, 1) : null);
const count = (v: unknown, max = 1e9): number | null => (typeof v === 'number' ? int(v, 0, max) : null);
const bool = (v: unknown): boolean => v === true;

/** An option token as the report writes it: short, printable, no spaces. */
const TOKEN_RE = /^[a-z]+(?::[0-9A-Za-z,>_-]{1,400})?$/;
function token(v: unknown): string | null {
  return typeof v === 'string' && v.length <= 400 && TOKEN_RE.test(v) ? v : null;
}

function lines(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v.slice(0, MAX_LINES)) {
    const s = cleanText(isObj(x) ? (x.message ?? x.text ?? x.note) : x, 240);
    if (s) out.push(s);
  }
  return out;
}

function numbers(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(v)) return out;
  for (const [k, x] of Object.entries(v).slice(0, 30)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(k)) continue;
    const n = typeof x === 'number' ? num(x, -1e9, 1e12) : null;
    if (n !== null) out[k] = n;
  }
  return out;
}

function parseOption(v: unknown): ReviewOption | null {
  if (!isObj(v)) return null;
  const t = token(v.token);
  if (!t) return null;
  let winLo = rate(v.winLo);
  let winHi = rate(v.winHi);
  const winRate = rate(v.winRate);
  // An interval that does not hold its point is not an interval.
  if (winRate !== null && ((winLo !== null && winLo > winRate + 1e-9) || (winHi !== null && winHi < winRate - 1e-9))) winLo = winHi = null;
  let regretLo = diff(v.regretLo);
  let regretHi = diff(v.regretHi);
  const regret = diff(v.regret);
  if (regret !== null && ((regretLo !== null && regretLo > regret + 1e-9) || (regretHi !== null && regretHi < regret - 1e-9))) regretLo = regretHi = null;
  return {
    token: t,
    label: cleanText(v.label, 160),
    n: count(v.n),
    winRate,
    winLo,
    winHi,
    regret,
    regretLo,
    regretHi,
    best: bool(v.best),
    forge: bool(v.forge),
    played: bool(v.played),
    alias: token(v.alias),
  };
}

function parseTriage(v: unknown): ReviewTriage | null {
  if (!isObj(v)) return null;
  return {
    measure: oneOf(v.measure, ['wins', 'leaf'] as const),
    rounds: count(v.rounds),
    best: token(v.best),
    regret: diff(v.regret),
    regretLo: diff(v.regretLo),
    regretHi: diff(v.regretHi),
  };
}

/** One decision, or a reason it was dropped. */
function parseDecision(v: unknown, warn: (s: string) => void): ReviewDecision | string {
  if (!isObj(v)) return 'not an object';
  const frame = count(v.frame, MAX_FRAME);
  if (frame === null || frame < 1) return 'no valid frame';
  const stateFrame = count(v.stateFrame, MAX_FRAME);
  if (stateFrame === null || stateFrame >= frame) return `frame ${frame}: stateFrame missing or not before the moment`;
  const type = oneOf(v.type, TYPES);
  if (!type) return `frame ${frame}: unknown type ${cleanText(v.type, 20) ?? '(none)'}`;
  const status = oneOf(v.status, STATUSES) ?? 'error';
  const options: ReviewOption[] = [];
  const seen = new Set<string>();
  if (Array.isArray(v.options)) {
    for (const o of v.options.slice(0, MAX_OPTIONS)) {
      const p = parseOption(o);
      if (p && !seen.has(p.token)) {
        seen.add(p.token);
        options.push(p);
      }
    }
    if (options.length < Math.min(v.options.length, MAX_OPTIONS)) warn(`frame ${frame}: ${Math.min(v.options.length, MAX_OPTIONS) - options.length} unreadable option(s) dropped`);
  }
  const measure = oneOf(v.measure, ['wins', 'leaf'] as const) ?? 'leaf';
  if (v.measure !== 'wins' && v.measure !== 'leaf' && status === 'ok') warn(`frame ${frame}: no measure given; read as a short-horizon (leaf) estimate`);
  let regret = diff(v.regret);
  let regretLo = diff(v.regretLo);
  let regretHi = diff(v.regretHi);
  if (regret !== null && ((regretLo !== null && regretLo > regret + 1e-9) || (regretHi !== null && regretHi < regret - 1e-9))) regretLo = regretHi = null;
  let verdict = oneOf(v.verdict, VERDICTS) ?? 'not-graded';
  const playedOption = token(v.playedOption);
  // Nothing to compare against: no grade, whatever the report says.
  if (status !== 'ok' || options.length === 0 || (verdict !== 'not-graded' && !playedOption)) {
    if (verdict !== 'not-graded' && status === 'ok') warn(`frame ${frame}: verdict ${verdict} without a graded played option; shown as not graded`);
    verdict = 'not-graded';
  }
  const clear = regretLo !== null && regretLo > 0;
  // The honesty rule: an interval that includes zero (or is unknown) is a close call, never a mistake.
  if (verdict === 'mistake' && !clear) {
    warn(`frame ${frame}: marked a mistake but its regret interval includes zero; shown as a close call`);
    verdict = 'close';
  }
  if (verdict === 'best') regret = regret ?? 0;
  const stage: ReviewStage = v.stage === 'deep' ? 'deep' : 'triage';
  return {
    frame,
    stateFrame,
    turn: count(v.turn, 10_000),
    round: count(v.round, 10_000),
    phase: typeof v.phase === 'string' && /^[A-Z0-9_]{1,40}$/.test(v.phase) ? v.phase : null,
    type,
    status,
    error: cleanText(v.error, 240),
    stage,
    measure,
    rounds: count(v.rounds),
    playouts: count(v.playouts),
    ms: count(v.ms),
    played: token(v.played),
    playedOption,
    playedLabel: cleanText(v.playedLabel, 160),
    best: token(v.best),
    bestLabel: cleanText(v.bestLabel, 160),
    forgeChoice: token(v.forgeChoice),
    regret,
    regretLo,
    regretHi,
    verdict,
    clear: verdict !== 'not-graded' && clear,
    key: bool(v.key),
    rank: count(v.rank, 1000),
    selectReason: cleanText(v.selectReason, 120),
    options,
    fidelity: lines(v.fidelity),
    notes: lines(v.notes),
    triage: parseTriage(v.triage),
  };
}

export function countVerdicts(decisions: ReviewDecision[]): ReviewSummary {
  const s: ReviewSummary = { decisions: decisions.length, graded: 0, best: 0, closeCalls: 0, mistakes: 0, notGraded: 0, trivial: 0, deepened: 0 };
  for (const d of decisions) {
    if (d.verdict === 'not-graded') s.notGraded++;
    else s.graded++;
    if (d.verdict === 'best') s.best++;
    if (d.verdict === 'close') s.closeCalls++;
    if (d.verdict === 'mistake') s.mistakes++;
    if (d.status === 'trivial') s.trivial++;
    if (d.stage === 'deep') s.deepened++;
  }
  return s;
}

/**
 * The report as a view model. Throws `ReviewReportError` only when it is not a
 * game review at all (not an object, wrong kind or version, no game id or
 * seat); anything smaller is dropped or corrected with a line in `warnings`.
 */
export function parseReviewReport(raw: unknown): ReviewReport {
  if (typeof raw === 'string') {
    if (raw.length > MAX_REPORT_BYTES) throw new ReviewReportError('The review file is too large.');
    try {
      raw = JSON.parse(raw);
    } catch {
      throw new ReviewReportError('The review file is not valid JSON.');
    }
  }
  if (!isObj(raw)) throw new ReviewReportError('Not a game review (expected a JSON object).');
  if (raw.kind !== 'game-review') throw new ReviewReportError('Not a game review (its "kind" is not "game-review").');
  if (raw.v !== 1) throw new ReviewReportError(`A game review of version ${cleanText(raw.v, 10) ?? '?'}; this page reads version 1.`);
  const gameId = typeof raw.gameId === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(raw.gameId) ? raw.gameId : null;
  if (!gameId) throw new ReviewReportError('The review names no valid game id.');
  const seat = count(raw.seat, 7);
  if (seat === null) throw new ReviewReportError('The review names no seat.');
  const warnings: string[] = [];
  const warn = (s: string) => {
    if (warnings.length < MAX_WARNINGS) warnings.push(s);
    else if (warnings.length === MAX_WARNINGS) warnings.push('…and more.');
  };
  const decisions: ReviewDecision[] = [];
  const list = Array.isArray(raw.decisions) ? raw.decisions : [];
  if (!Array.isArray(raw.decisions)) warn('The review has no decision list.');
  if (list.length > MAX_DECISIONS) warn(`Only the first ${MAX_DECISIONS} of ${list.length} decisions are read.`);
  const frames = new Set<number>();
  for (const [i, d] of list.slice(0, MAX_DECISIONS).entries()) {
    const p = parseDecision(d, warn);
    if (typeof p === 'string') warn(`Decision ${i + 1} dropped: ${p}.`);
    else if (frames.has(p.frame)) warn(`Decision ${i + 1} dropped: a second decision at frame ${p.frame}.`);
    else {
      frames.add(p.frame);
      decisions.push(p);
    }
  }
  decisions.sort((a, b) => a.frame - b.frame);
  const keyMoments: number[] = [];
  if (Array.isArray(raw.keyMoments)) {
    for (const k of raw.keyMoments.slice(0, 50)) {
      const f = count(k, MAX_FRAME);
      const kd = f !== null ? decisions.find((x) => x.frame === f) : undefined;
      if (kd && isTie(kd)) warn(`Key moment at frame ${f} is a tie with the best option; not shown as a key moment.`);
      else if (f !== null && frames.has(f) && !keyMoments.includes(f)) keyMoments.push(f);
      else if (f !== null && !frames.has(f)) warn(`Key moment at frame ${f} has no decision; skipped.`);
    }
  }
  const knowledge = isObj(raw.knowledge) ? raw.knowledge : {};
  return {
    v: 1,
    gameId,
    seat,
    log: cleanText(raw.log, 200),
    frames: count(raw.frames, MAX_FRAME),
    createdAt: parseTime(raw.createdAt),
    yardstick: cleanText(raw.yardstick, 60) ?? 'forge-default',
    knowledge: {
      opponent: cleanText(knowledge.opponent, 300),
      ownDeck: cleanText(knowledge.ownDeck, 200),
      opponentModel: opponentModelOf(knowledge.opponentModel, cleanText(knowledge.opponent, 300)),
    },
    config: numbers(raw.config),
    timing: numbers(raw.timing),
    summary: countVerdicts(decisions),
    keyMoments,
    decisions,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Does it belong to this log?

export interface LogMatch {
  /** The report is this game's, from this seat. */
  ok: boolean;
  /** Why not (ok false), or what does not line up (ok true: those decisions are left out). */
  problems: string[];
  /** Decisions whose frames fit the log. */
  decisions: ReviewDecision[];
}

export function reportMatchesLog(report: ReviewReport, log: GameLog): LogMatch {
  const problems: string[] = [];
  const gid = log.header?.gameId;
  if (gid !== report.gameId) problems.push(`The review is for game ${report.gameId}; this log is ${gid || 'unnamed'}.`);
  if (log.seat !== report.seat) problems.push(`The review is from seat ${report.seat}; this log is seat ${log.seat}'s view.`);
  if (problems.length) return { ok: false, problems, decisions: [] };
  const n = log.frames.length;
  if (report.frames !== null && report.frames > n) problems.push(`The review graded ${report.frames} frames; this log has ${n} (an earlier copy?). Decisions past its end are left out.`);
  const decisions: ReviewDecision[] = [];
  for (const d of report.decisions) {
    if (d.frame > n) problems.push(`Frame ${d.frame} is past the end of the log.`);
    else if (log.frames[d.stateFrame]?.type !== 'state') problems.push(`Frame ${d.stateFrame} is not a game state in this log.`);
    else decisions.push(d);
  }
  return { ok: true, problems: problems.slice(0, 12), decisions };
}

/** The state the board shows for a decision (its `stateFrame`), or null. */
export function decisionState(log: GameLog, d: Pick<ReviewDecision, 'stateFrame'>): GameStateBody | null {
  const f = log.frames[d.stateFrame];
  return f && f.type === 'state' ? (f.body as GameStateBody) : null;
}

// ---------------------------------------------------------------------------
// Option labels from the log

type Ids = Map<number, AnyCard>;

/**
 * Names for card ids in one state, told apart only where needed: "your" /
 * "their" when both sides have a card of that name, "#id" when one side has
 * two (identical tokens).
 */
function namer(state: GameStateBody | null, seat: number | null): (id: number) => string {
  const ids: Ids = state ? cardIndex(state) : new Map();
  const owner = (c: AnyCard): number | null => (isHidden(c) ? null : ((c as Card).controller ?? null));
  const sides = new Map<string, Set<number | null>>();
  const perSide = new Map<string, number>();
  for (const c of ids.values()) {
    const n = visibleName(c);
    if (!n) continue;
    const o = owner(c);
    if (!sides.has(n)) sides.set(n, new Set());
    sides.get(n)!.add(o);
    perSide.set(`${o}|${n}`, (perSide.get(`${o}|${n}`) ?? 0) + 1);
  }
  return (id) => {
    const c = ids.get(id);
    const n = visibleName(c);
    if (!c || !n) return `card #${id}`;
    const o = owner(c);
    let s = n;
    if ((sides.get(n)?.size ?? 0) > 1 && seat !== null && o !== null) s = `${o === seat ? 'your' : 'their'} ${n}`;
    if ((perSide.get(`${o}|${n}`) ?? 0) > 1) s = `${s} #${id}`;
    return s;
  };
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * A token in words, named from the state the player saw (`state`: the
 * decision's state frame; `seat`: the viewer, to say "your" / "their" where a
 * name is on both sides). Ids the viewer cannot see stay "card #id"; a token
 * this page does not know falls back to `fallback` (the engine's label).
 */
export function tokenLabel(tok: string, state: GameStateBody | null, seat: number | null = null, fallback: string | null = null): string {
  const nm = namer(state, seat);
  if (tok === 'pass') return 'Pass (cast nothing)';
  if (tok === 'attack:none') return 'No attack';
  if (tok === 'block:none') return 'No blocks';
  let m = /^cast:(\d+)$/.exec(tok);
  if (m) return `Cast ${nm(Number(m[1]))}`;
  m = /^target:(\d+)$/.exec(tok);
  if (m) {
    const id = Number(m[1]);
    const ids = state ? cardIndex(state) : new Map<number, AnyCard>();
    const player = ids.has(id) ? undefined : state?.players.find((p) => p.id === id);
    return `Target ${player ? (player.id === seat ? 'yourself' : player.name) : nm(id)}`;
  }
  m = /^attack:(\d+(?:,\d+)*)$/.exec(tok);
  if (m) return `Attack with ${joinNames(m[1]!.split(',').map((x) => nm(Number(x))))}`;
  m = /^block:(\d+>\d+(?:,\d+>\d+)*)$/.exec(tok);
  if (m) {
    const parts = m[1]!.split(',').map((pair) => {
      const [b, a] = pair.split('>').map(Number) as [number, number];
      return `${nm(b)} blocks ${nm(a)}`;
    });
    const text = parts.join('; ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  return fallback ?? tok;
}

/** Card ids a token names (for card text and highlighting). */
export function tokenCardIds(tok: string): number[] {
  const m = /^(?:cast|target|attack|block):([\d,>]+)$/.exec(tok);
  if (!m) return [];
  return [...new Set(m[1]!.split(/[,>]/).filter(Boolean).map(Number))];
}

/** Two tokens name the same option (the token itself, or the option's alias). */
export function sameOption(o: ReviewOption, tok: string | null): boolean {
  return !!tok && (o.token === tok || o.alias === tok);
}

// ---------------------------------------------------------------------------
// Words and numbers

export const VERDICT_WORDS: Record<ReviewVerdict, string> = {
  best: 'Best play',
  close: 'Close call',
  mistake: 'Mistake',
  'not-graded': 'Not graded',
};

/** "Mistake — clear", "Close call", "Best play", "Not graded". */
export function verdictLabel(d: Pick<ReviewDecision, 'verdict' | 'clear'> & { regret?: number | null }): string {
  if (d.regret !== undefined && isTie({ verdict: d.verdict, regret: d.regret })) return 'Close call — a tie';
  return d.verdict === 'mistake' ? `Mistake — clear` : VERDICT_WORDS[d.verdict];
}

export const TYPE_WORDS: Record<ReviewType, string> = { spell: 'Main phase', attack: 'Attacks', block: 'Blocks', target: 'Target' };

export const STATUS_WORDS: Record<ReviewStatus, string> = {
  ok: 'graded',
  trivial: 'only one option',
  unsupported: 'the engine could not grade this kind of moment',
  error: 'grading failed',
  refused: 'refused by the hidden-information guard',
};

/** What a measure's numbers are, for a caption. */
export function measureCaption(m: ReviewMeasure): string {
  return m === 'wins'
    ? 'Win rate: playouts to the end of the game.'
    : 'Short-horizon estimate: playouts to the end of this turn, scored by an evaluator — not a win rate.';
}

/** A rate as the measure reads: "61%" (win rate) or "0.61" (leaf score). */
export function fmtRate(x: number | null, m: ReviewMeasure): string {
  if (x === null) return '—';
  return m === 'wins' ? `${Math.round(x * 100)}%` : x.toFixed(2);
}

function fmtSigned(x: number, m: ReviewMeasure): string {
  const s = m === 'wins' ? String(Math.round(x * 100)) : x.toFixed(2);
  return s.replace(/^-/, '−');
}

/** A regret: "12 pts" (win rate) or "0.12" (leaf score). */
export function fmtRegret(x: number | null, m: ReviewMeasure): string {
  if (x === null) return '—';
  return m === 'wins' ? `${fmtSigned(x, m)} pts` : fmtSigned(x, m);
}

/** An interval: "47–73%", "−3 to 21 pts", "0.47–0.73". */
export function fmtInterval(lo: number | null, hi: number | null, m: ReviewMeasure, kind: 'rate' | 'regret' = 'rate'): string {
  if (lo === null || hi === null) return '';
  const a = kind === 'rate' ? fmtRate(lo, m).replace('%', '') : fmtSigned(lo, m);
  const b = kind === 'rate' ? fmtRate(hi, m).replace('%', '') : fmtSigned(hi, m);
  const unit = m === 'wins' ? (kind === 'rate' ? '%' : ' pts') : '';
  const sep = a.startsWith('−') || b.startsWith('−') ? ' to ' : '–';
  return `${a}${sep}${b}${unit}`;
}

/** Does this decision's regret interval include zero (a close call)? */
export function includesZero(d: Pick<ReviewDecision, 'regretLo' | 'regretHi'>): boolean {
  return d.regretLo === null || d.regretLo <= 0;
}

// ---------------------------------------------------------------------------
// Timeline

export interface TimelineItem {
  decision: ReviewDecision;
  /** Position among the key moments (1 = first), or null. */
  keyRank: number | null;
}

export interface TimelineTurn {
  turn: number | null;
  round: number | null;
  items: TimelineItem[];
}

/** Decisions in frame order, grouped by turn; key moments carry their rank. */
export function reviewTimeline(decisions: ReviewDecision[], keyMoments: number[]): TimelineTurn[] {
  const out: TimelineTurn[] = [];
  const sorted = [...decisions].sort((a, b) => a.frame - b.frame);
  for (const d of sorted) {
    const k = keyMoments.indexOf(d.frame);
    const item: TimelineItem = { decision: d, keyRank: k >= 0 ? k + 1 : null };
    const last = out[out.length - 1];
    if (last && last.turn === d.turn) last.items.push(item);
    else out.push({ turn: d.turn, round: d.round, items: [item] });
  }
  return out;
}

/**
 * The moments to explain, most important first: the report's key moments,
 * then any other mistakes and close calls by how much the choice might have
 * cost (regretHi). At most `max`.
 */
export function keyDecisions(decisions: ReviewDecision[], keyMoments: number[], max = 5): ReviewDecision[] {
  const byFrame = new Map(decisions.map((d) => [d.frame, d]));
  const out: ReviewDecision[] = [];
  for (const f of keyMoments) {
    const d = byFrame.get(f);
    if (d && d.verdict !== 'not-graded' && !isTie(d) && !out.includes(d)) out.push(d);
  }
  const rest = decisions
    .filter((d) => !out.includes(d) && (d.verdict === 'mistake' || (d.verdict === 'close' && !isTie(d))))
    .sort((a, b) => (b.verdict === 'mistake' ? 1 : 0) - (a.verdict === 'mistake' ? 1 : 0) || (b.regretHi ?? 0) - (a.regretHi ?? 0) || a.frame - b.frame);
  return [...out, ...rest].slice(0, max);
}

// ---------------------------------------------------------------------------
// The explain prompt

const isLand = (c: AnyCard) => !isHidden(c) && /\bLand\b/.test((c as Card).types);

function nameList(cards: AnyCard[], hiddenWord = 'a hidden card'): string {
  const counts = new Map<string, number>();
  for (const c of cards) {
    const n = visibleName(c) ?? hiddenWord;
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  // Semicolons: card names contain commas.
  return [...counts].map(([n, k]) => (k > 1 ? `${n} ×${k}` : n)).join('; ') || 'none';
}

function permanentWords(c: AnyCard): string {
  const n = visibleName(c) ?? 'a face-down card';
  if (isHidden(c)) return n;
  const k = c as Card;
  const bits: string[] = [];
  if (k.power != null && k.toughness != null) bits.push(`${k.power}/${k.toughness}`);
  if (k.tapped) bits.push('tapped');
  if (k.sick && /\bCreature\b/.test(k.types)) bits.push('summoning sick');
  return bits.length ? `${n} (${bits.join(', ')})` : n;
}

/** Life, the viewer's board and hand, the opponent's board and hand size: only what the redacted log shows. */
export function boardSummary(state: GameStateBody, seat: number): string[] {
  const me = state.players.find((p) => p.id === seat);
  const opps = state.players.filter((p) => p.id !== seat);
  const out: string[] = [];
  if (!me) return ['(no players in this state)'];
  out.push(`Life: you ${me.life}; ${opps.map((p) => `${p.name || 'opponent'} ${p.life}`).join(', ')}.`);
  const side = (cards: AnyCard[]) => {
    const lands = cards.filter(isLand);
    const other = cards.filter((c) => !isLand(c));
    const counts = new Map<string, number>();
    for (const c of other) {
      const w = permanentWords(c);
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
    const others = [...counts].map(([w, k]) => (k > 1 ? `${w} ×${k}` : w));
    return `${lands.length} land${lands.length === 1 ? '' : 's'}${others.length ? `; ${others.join('; ')}` : ''}`;
  };
  out.push(`Your battlefield: ${side(me.zones.battlefield.cards)}.`);
  out.push(`Your hand: ${me.zones.hand.cards.length ? nameList(me.zones.hand.cards) : 'empty'}.`);
  for (const p of opps) {
    out.push(`Opponent's battlefield: ${side(p.zones.battlefield.cards)}.`);
    const n = p.zones.hand.count ?? p.zones.hand.cards.length;
    out.push(`Opponent's hand: ${n} card${n === 1 ? '' : 's'} (hidden).`);
  }
  return out;
}

/** The prompt's line on the opponent's hidden cards, from the report's knowledge. */
export function opponentKnowledge(k: ReviewReport['knowledge']): string {
  if (k.opponentModel === 'pool') return "sampled from the cube pool, never the AI's real list.";
  if (k.opponentModel === 'deck') return `the opponent's deck was public for this review${k.opponent ? ` (${k.opponent})` : ''}.`;
  if (k.opponentModel === 'basic-lands')
    return "WARNING: modelled as basic lands — nothing was known about the opponent's deck, so every number flatters the player (the opponent's unseen cards are all lands). Say so once, and treat small differences with extra caution.";
  return `${k.opponent ?? 'not stated by the report'}; never the AI's real list.`;
}

export const REVIEW_EXPLAIN_SYSTEM = `You are a Magic: The Gathering coach going over an engine's post-game review with a newer player (a few months of experience) who played against the Forge AI.

The engine graded each of the player's decisions by playing every option out many times from the same position and comparing the results. Its yardstick is the best play against Forge's Default AI playing both seats — strong, not perfect. You get its table for the moments that mattered: each option's win rate (or short-horizon score) with a 95% interval, the regret of the player's choice (how much worse it scored than the engine's best, with an interval), what Forge's own AI would have done, and the verdict.

Your job is to explain the numbers, not to re-solve the position:
- Take the engine's best option and its numbers as given. Explain why the best option plausibly scores better, using only the visible facts listed (life totals, the boards, your hand, the card text). Do not invent lines the table does not support, and do not recommend an option the engine did not rank best.
- When the regret interval includes zero, call it a close call — never a mistake — and say the options were about equal.
- A "short-horizon" measure is an estimate of the position at the end of the turn, scored by an evaluator: never call it a win rate or a chance to win.
- The opponent's hidden cards (hand, library) are unknown to you and to the player; the engine filled them in from the cube pool, or with basic lands when it had no pool (the game section says which), never from the AI's real list. Never claim to know them.
- Keep to about three sentences per moment.

Write one block per moment, in the order given:
**Turn N · <phase> — <verdict>** then your sentences, ending with the general rule it shows in a few words ("count your attackers against their blockers", "hold removal for the real threat").
Finish with **One habit for next game:** a single sentence.`;

export function optionRows(d: ReviewDecision, state: GameStateBody | null, seat: number): string[] {
  const rows: string[] = [];
  const m = d.measure;
  for (const o of d.options) {
    const marks: string[] = [];
    if (o.played || sameOption(o, d.playedOption)) marks.push('PLAYED');
    if (o.best || sameOption(o, d.best)) marks.push('ENGINE BEST');
    if (o.forge || sameOption(o, d.forgeChoice)) marks.push("Forge's choice");
    const win = `${fmtRate(o.winRate, m)}${o.winLo !== null ? ` (${fmtInterval(o.winLo, o.winHi, m)})` : ''}`;
    const reg = o.regret !== null ? `; regret ${fmtRegret(o.regret, m)}${o.regretLo !== null ? ` (${fmtInterval(o.regretLo, o.regretHi, m, 'regret')})` : ''}` : '';
    const n = o.n !== null ? `; n=${o.n}` : '';
    rows.push(`- ${tokenLabel(o.token, state, seat)}: ${win}${reg}${n}${marks.length ? ` — ${marks.join(', ')}` : ''}`);
  }
  return rows;
}

export function verdictLine(d: ReviewDecision): string {
  const m = d.measure;
  const reg = d.regret !== null ? ` Regret of the played option: ${fmtRegret(d.regret, m)}${d.regretLo !== null ? ` (95% interval ${fmtInterval(d.regretLo, d.regretHi, m, 'regret')})` : ''}.` : '';
  if (d.verdict === 'mistake') return `Verdict: mistake — the interval excludes zero, so the difference is clear.${reg}`;
  if (isTie(d)) return `Verdict: a tie — the played option scored as well as the engine's best within noise; not an error.${reg}`;
  if (d.verdict === 'close') return `Verdict: close call — the interval includes zero; do not call it a mistake.${reg}`;
  if (d.verdict === 'best') return `Verdict: the player's choice was the engine's best.${reg}`;
  return 'Verdict: not graded.';
}

export function measureLine(d: ReviewDecision): string {
  const how = d.measure === 'wins' ? 'win rate (playouts to the end of the game)' : 'short-horizon score (playouts to the end of this turn, scored by an evaluator; NOT a win rate)';
  const depth = [d.stage === 'deep' ? 'graded twice, deep' : 'quick triage grade', d.rounds !== null ? `${d.rounds} rounds` : null, d.playouts !== null ? `${d.playouts} playouts` : null]
    .filter(Boolean)
    .join(', ');
  return `Measure: ${how}; ${depth}.`;
}

/** Card names worth text in the prompt: the visible, non-basic cards the options name. */
export function explainCardNames(decisions: ReviewDecision[], log: GameLog): string[] {
  const out: string[] = [];
  for (const d of decisions) {
    const st = decisionState(log, d);
    if (!st) continue;
    const ids = cardIndex(st);
    for (const o of d.options) {
      for (const id of tokenCardIds(o.token)) {
        const n = visibleName(ids.get(id));
        if (n && !isBasicLandName(n) && !out.includes(n)) out.push(n);
      }
    }
  }
  return out.slice(0, 24);
}

/**
 * The coach prompt for the key moments. Deterministic: the same report, log,
 * decisions and card map give the same bytes. Only the viewer's redacted log
 * and the engine's table go in.
 */
export function reviewExplainPrompt(report: ReviewReport, log: GameLog, decisions: ReviewDecision[], cards?: Map<string, CardInfo>): Prompt {
  const parts: string[] = [];
  const opp = log.hello?.players.find((p) => p.id !== log.seat)?.name ?? 'Forge AI';
  const result = log.over ? (log.over.winner === null ? 'a draw' : log.over.winner === log.seat ? 'the player won' : `${opp} won`) : 'the log ends before the game is over';
  parts.push('# The game', `Game ${report.gameId}, seen from seat ${report.seat} (the player). Opponent: ${opp}. Result: ${result}.`);
  parts.push(
    `Engine review: ${report.summary.decisions} decisions, ${report.summary.best} best, ${report.summary.closeCalls} close calls, ${report.summary.mistakes} clear mistakes, ${report.summary.notGraded} not graded.`,
  );
  parts.push("Yardstick: the best play against Forge's Default AI playing both seats.");
  parts.push(`Opponent's hidden cards in the playouts: ${opponentKnowledge(report.knowledge)}`);
  parts.push('', '# Key moments');
  decisions.forEach((d, i) => {
    const st = decisionState(log, d);
    const turn = d.turn ?? st?.turn ?? null;
    const phase = phaseLabel(d.phase ?? st?.phase ?? null);
    const whose = st ? (st.activePlayer === log.seat ? 'your turn' : "opponent's turn") : null;
    parts.push('', `## Moment ${i + 1}: Turn ${turn ?? '?'} · ${phase}${whose ? ` (${whose})` : ''} · ${TYPE_WORDS[d.type].toLowerCase()}`);
    if (st) parts.push(...boardSummary(st, log.seat));
    parts.push(`The player chose: ${d.played ? tokenLabel(d.played, st, log.seat) : 'unknown'}.`);
    if (d.best) parts.push(`Engine best: ${tokenLabel(d.best, st, log.seat)}.`);
    if (d.forgeChoice) parts.push(`Forge's AI would have chosen: ${tokenLabel(d.forgeChoice, st, log.seat)}.`);
    parts.push(measureLine(d));
    parts.push('Options:', ...optionRows(d, st, log.seat));
    parts.push(verdictLine(d));
    const caveats = [...d.fidelity, ...d.notes];
    if (caveats.length) parts.push(`Engine notes: ${caveats.join(' | ')}`);
  });
  if (cards) {
    const names = explainCardNames(decisions, log);
    if (names.length) parts.push('', '# Card text', formatCardTexts(names, cards));
  }
  parts.push(
    '',
    '# Question',
    `Explain these ${decisions.length} moment${decisions.length === 1 ? '' : 's'} from the engine's table: why the best option scores better, in about three sentences each. Say "close call" wherever the interval includes zero.`,
  );
  return { system: REVIEW_EXPLAIN_SYSTEM, user: parts.join('\n') };
}

/** What the engine knew about the opponent's hidden cards, in one line for the screen. */
export function knowledgeLine(k: ReviewReport['knowledge']): string {
  if (k.opponentModel === 'pool') return 'Opponent’s hidden cards: drawn from the cube pool (minus your deck and every public card), never the AI’s list.';
  if (k.opponentModel === 'deck') return `The opponent’s deck was marked public for this review${k.opponent ? `: ${k.opponent}` : ''}.`;
  if (k.opponentModel === 'basic-lands') return 'Opponent’s hidden cards: modelled as basic lands — nothing was known about their deck — never the AI’s list.';
  return `Opponent’s hidden cards: ${k.opponent ?? 'not stated'} — never the AI’s list.`;
}

/** The screen's warning when the numbers flatter the player (hidden cards modelled as basic lands), else null. */
export function knowledgeWarning(k: ReviewReport['knowledge']): string | null {
  return k.opponentModel === 'basic-lands'
    ? 'Nothing was known about the opponent’s deck, so the engine played their hidden cards as basic lands. Every number here flatters you: in these playouts the opponent’s unseen cards are all lands.'
    : null;
}
