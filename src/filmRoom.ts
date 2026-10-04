/*
 * ForgeCoach — filmRoom.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The film room: after a game, the (at most) three moments where the viewing
 * seat's position fell the most across one of its own decisions, and a short
 * deterministic coach prompt for each. Pure and DOM-free.
 *
 * TURNING POINT. Scores are taken at the viewer's scored positions (the
 * `state` frames where it holds priority in a main phase or combat, the rows
 * the win-chance model reads: winChance.ts `evalPoints`). For each of the
 * viewer's decisions (decisions.ts), spanning frames [frameIndex, endFrameIndex]
 * (a frame two decisions share — one's last, the next one's first — counts
 * as the later one's):
 *
 *   before = the newest scored position after the previous decision ended and
 *            at or before this decision's frame — or, when there is none, the
 *            first scored position inside the decision (still after the
 *            previous one ended, so two decisions never share a start);
 *   after  = the first scored position after the decision's last frame: the
 *            next time the viewer holds priority again.
 *   drop   = before − after.
 *
 * The span holds everything between those two positions, the opponent's moves
 * included (and any prompt of the viewer's own that has no scored position of
 * its own, such as a block on the opponent's turn): a drop says where the
 * estimate fell, not why. A decision with no position before it (the
 * mulligan) or none after it (the game ended) has no turning point. The three
 * largest drops of at least FILM_MIN_DROP are kept, largest first, ties to the
 * earlier decision.
 *
 * SOURCES, in order:
 *  1. 'eval'      the coach helper's win chance (POST /eval, mtg-table D361);
 *  2. 'review'    the engine review report (gameReview.ts): its graded
 *                 decisions, the best option's score against the played one's
 *                 (regret), the engine's own key moments first;
 *  3. 'heuristic' a rough score from life, board and cards in hand — never
 *                 called a win chance.
 *
 * Only the viewer's redacted view goes into a prompt: the state at the
 * decision (prompt.ts's state table), what the viewer could do there, what it
 * did, and the two numbers. The state after the decision is never sent.
 */
import type { AnyCard, Card, GameStateBody } from './protocol.ts';
import { isHidden } from './protocol.ts';
import type { GameLog } from './log.ts';
import type { Decision } from './decisions.ts';
import { phaseLabel } from './decisions.ts';
import type { CardInfo } from './cards.ts';
import { buildCoachPrompt, coachCardNames, type Prompt } from './prompt.ts';
import { visibleName } from './review.ts';
import {
  decisionState,
  fmtRate,
  isTie,
  keyDecisions,
  measureLine,
  optionRows,
  opponentKnowledge,
  tokenLabel,
  verdictLabel,
  verdictLine,
  type ReviewDecision,
  type ReviewMeasure,
  type ReviewReport,
} from './gameReview.ts';
import { evalPoints, pct, type WinPoint } from './winChance.ts';

export type FilmSource = 'eval' | 'review' | 'heuristic';

/** How many moments the film room shows. */
export const FILM_MOMENTS = 3;
/** A smaller fall is noise, not a turning point (3 points). */
export const FILM_MIN_DROP = 0.03;

export const SOURCE_WORDS: Record<FilmSource, string> = {
  eval: 'Win chance (local model, Forge-vs-Forge trained)',
  review: 'Engine review (playouts against Forge’s Default AI)',
  heuristic: 'Rough swing from life, board and cards in hand (no win chance available)',
};

export const SOURCE_SHORT: Record<FilmSource, string> = {
  eval: 'win chance',
  review: 'engine review',
  heuristic: 'heuristic swing',
};

/** A scored position: `p` is a win chance (eval), or a 0..1 heuristic score. */
export type FilmPoint = WinPoint;

export interface ReviewFacts {
  /** The engine decision's frame (its id in the report). */
  frame: number;
  verdict: string;
  measure: ReviewMeasure;
  played: string;
  best: string | null;
  regret: number | null;
}

export interface FilmMoment {
  /** 1 = the largest drop. */
  rank: number;
  source: FilmSource;
  decision: Decision;
  turn: number;
  /** The score just before the decision. */
  before: FilmPoint;
  /** The score the next time the viewer is scored again (review: the played option's score, at the same position). */
  after: FilmPoint;
  /** before.p − after.p, positive. */
  drop: number;
  /** For an engine-review moment: the report's facts. */
  review?: ReviewFacts;
}

export interface Film {
  source: FilmSource;
  moments: FilmMoment[];
  /** Why this source (a fallback names what was missing). */
  note: string | null;
}

// ---------------------------------------------------------------------------
// Turning points

export interface TurningSpan {
  decision: Decision;
  before: FilmPoint;
  after: FilmPoint;
  drop: number;
}

/** Every decision's span (see the file header), in decision order; decisions with no score on either side are left out. */
export function decisionSwings(decisions: readonly Decision[], points: readonly FilmPoint[]): TurningSpan[] {
  const pts = [...points].sort((a, b) => a.frameIndex - b.frameIndex);
  const ds = [...decisions].sort((a, b) => a.frameIndex - b.frameIndex);
  // A decision's last frame; a frame two decisions share goes to the later one.
  const endOf = (i: number) => {
    const d = ds[i]!;
    const next = ds[i + 1];
    const end = Math.max(d.frameIndex, d.endFrameIndex);
    return next && next.frameIndex > d.frameIndex ? Math.min(end, next.frameIndex - 1) : end;
  };
  const out: TurningSpan[] = [];
  ds.forEach((d, i) => {
    const end = endOf(i);
    const lo = i > 0 ? endOf(i - 1) : -1;
    let before: FilmPoint | null = null;
    for (const p of pts) {
      if (p.frameIndex > d.frameIndex) break;
      if (p.frameIndex > lo) before = p;
    }
    before ??= pts.find((p) => p.frameIndex > lo && p.frameIndex >= d.frameIndex && p.frameIndex <= end) ?? null;
    const after = pts.find((p) => p.frameIndex > end) ?? null;
    if (!before || !after || after.frameIndex <= before.frameIndex) return;
    out.push({ decision: d, before, after, drop: before.p - after.p });
  });
  return out;
}

/** The largest drops, at most `max`, at least `minDrop`; largest first, ties to the earlier decision. */
export function turningPoints(
  decisions: readonly Decision[],
  points: readonly FilmPoint[],
  source: FilmSource,
  opts: { max?: number; minDrop?: number } = {},
): FilmMoment[] {
  const max = opts.max ?? FILM_MOMENTS;
  const min = opts.minDrop ?? FILM_MIN_DROP;
  return decisionSwings(decisions, points)
    .filter((s) => s.drop >= min - 1e-12)
    .sort((a, b) => b.drop - a.drop || a.decision.frameIndex - b.decision.frameIndex)
    .slice(0, max)
    .map((s, i) => ({ rank: i + 1, source, decision: s.decision, turn: s.decision.state.turn, before: s.before, after: s.after, drop: s.drop }));
}

// ---------------------------------------------------------------------------
// The heuristic score (no helper, no report)

const num = (s: string | null | undefined): number => {
  const n = parseInt(s ?? '', 10);
  return Number.isFinite(n) ? n : 0;
};

/** Board presence from what is visible: creatures by (power + toughness) / 2, lands 0.3, other permanents 1, face-down 1. */
function boardValue(cards: readonly AnyCard[]): number {
  let v = 0;
  for (const c of cards) {
    if (isHidden(c)) {
      v += 1;
      continue;
    }
    const k = c as Card;
    if (/\bLand\b/.test(k.types) && !/\bCreature\b/.test(k.types)) v += 0.3;
    else if (/\bCreature\b/.test(k.types)) v += Math.max(0.5, (num(k.power) + num(k.toughness)) / 2);
    else v += 1;
  }
  return v;
}

/**
 * A rough 0..1 score of a position for `seat`, from what its own view shows:
 * life (poison counted as life lost), board presence and hand size (a count,
 * the opponent's cards stay hidden). A logistic of a weighted difference.
 * Not a win chance, and never called one.
 */
export function heuristicScore(state: GameStateBody, seat: number): number {
  const me = state.players.find((p) => p.id === seat);
  const opp = state.players.find((p) => p.id !== seat);
  if (!me || !opp) return 0.5;
  const life = (p: typeof me) => p.life - 2 * (p.poison ?? 0);
  const hand = (p: typeof me) => p.zones.hand.count ?? p.zones.hand.cards.length;
  const x =
    0.12 * (life(me) - life(opp)) + 0.3 * (boardValue(me.zones.battlefield.cards) - boardValue(opp.zones.battlefield.cards)) + 0.2 * (hand(me) - hand(opp));
  return 1 / (1 + Math.exp(-x));
}

/** The heuristic at each of the viewer's scored positions. */
export function heuristicPoints(log: GameLog): FilmPoint[] {
  return evalPoints(log).map((s) => ({ frameIndex: s.frameIndex, turn: s.state.turn, p: heuristicScore(s.state, log.seat) }));
}

// ---------------------------------------------------------------------------
// The engine review's moments

/** The replay decision an engine decision falls in: the last one starting at or before its state frame. */
export function decisionFor(decisions: readonly Decision[], frame: number): Decision | null {
  let best: Decision | null = null;
  for (const d of decisions) if (d.frameIndex <= frame && (!best || d.frameIndex > best.frameIndex)) best = d;
  return best;
}

/**
 * The engine review's turning points: its key moments, then its other
 * mistakes and close calls (gameReview.ts `keyDecisions`; ties are never
 * listed), each at the position it was graded in. `before` is the engine's
 * best option's score there, `after` the played option's: the regret.
 */
export function reviewMoments(log: GameLog, decisions: readonly Decision[], report: Pick<ReviewReport, 'decisions' | 'keyMoments'>, max = FILM_MOMENTS): FilmMoment[] {
  const out: FilmMoment[] = [];
  for (const r of keyDecisions(report.decisions, report.keyMoments, report.decisions.length)) {
    if (out.length >= max) break;
    if (r.verdict === 'not-graded' || isTie(r)) continue;
    const played = r.options.find((o) => o.played) ?? r.options.find((o) => o.token === r.played) ?? null;
    const best = r.options.find((o) => o.best) ?? r.options.find((o) => o.token === r.best) ?? null;
    if (!played || !best || played.winRate === null || best.winRate === null) continue;
    const d = decisionFor(decisions, r.stateFrame);
    if (!d || out.some((m) => m.decision === d)) continue;
    const st = decisionState(log, r);
    const turn = r.turn ?? st?.turn ?? d.state.turn;
    out.push({
      rank: out.length + 1,
      source: 'review',
      decision: d,
      turn,
      before: { frameIndex: r.stateFrame, turn, p: best.winRate },
      after: { frameIndex: r.stateFrame, turn, p: played.winRate },
      drop: r.regret ?? best.winRate - played.winRate,
      review: {
        frame: r.frame,
        verdict: verdictLabel(r),
        measure: r.measure,
        played: r.played ? tokenLabel(r.played, st, log.seat, r.playedLabel) : 'unknown',
        best: r.best ? tokenLabel(r.best, st, log.seat, r.bestLabel) : null,
        regret: r.regret,
      },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Choosing the source

export interface FilmInput {
  log: GameLog;
  decisions: readonly Decision[];
  /** The win chance at the viewer's positions, once scoring is finished (null: no helper model, or it failed). */
  evalPoints?: readonly FilmPoint[] | null;
  /** Why there is no win chance (for the note). */
  evalMissing?: string | null;
  report?: ReviewReport | null;
}

/**
 * The film: the win chance when it scored at least two positions, else the
 * engine review when its graded decisions give a moment, else the heuristic.
 */
export function pickFilm(input: FilmInput): Film {
  const { log, decisions } = input;
  const ev = input.evalPoints ?? null;
  if (ev && ev.length >= 2) return { source: 'eval', moments: turningPoints(decisions, ev, 'eval'), note: null };
  const missing = input.evalMissing ?? 'No win chance: the coach helper has no evaluator model.';
  if (input.report) {
    const rm = reviewMoments(log, decisions, input.report);
    if (rm.length) return { source: 'review', moments: rm, note: missing };
  }
  return {
    source: 'heuristic',
    moments: turningPoints(decisions, heuristicPoints(log), 'heuristic'),
    note: input.report ? `${missing} The engine review graded no mistake or close call.` : `${missing} No engine review is open.`,
  };
}

// ---------------------------------------------------------------------------
// Words

/** "−14 points" style: the drop in points (eval, heuristic) or the regret in the report's measure. */
export function dropWords(m: Pick<FilmMoment, 'source' | 'drop' | 'review'>): string {
  const n = Math.round(m.drop * 100);
  if (m.source === 'review') return m.review?.measure === 'leaf' ? `regret ${n} (short-horizon score)` : `regret ${n} points`;
  if (m.source === 'heuristic') return `−${n} (rough swing)`;
  return `−${n} points`;
}

export function scoreWords(p: number, source: FilmSource, measure?: ReviewMeasure): string {
  if (source === 'review') return fmtRate(p, measure ?? 'wins');
  if (source === 'heuristic') return `${Math.round(p * 100)}/100`;
  return pct(p);
}

/** "Turn 5 · your declare attackers" */
export function momentTitle(m: FilmMoment, seat: number): string {
  const s = m.decision.state;
  return `Turn ${m.turn} · ${s.activePlayer === seat ? 'your' : 'their'} ${phaseLabel(s.phase)}`;
}

// ---------------------------------------------------------------------------
// The prompt

export const FILM_SYSTEM = `You are a Magic: The Gathering coach going over the film of a finished game with a newer player (a few months of experience) who played against the Forge AI. You are shown one turning point: the exact state when the player had to decide (straight from the engine, the player's own view: the opponent's hand and both libraries are hidden), the card text, what the player could do, what the player did, and how a score of the position moved across that decision.

Trust the state, not intuition: TAPPED, SUMMONING SICK, P/T, mana sources and the land drop are exact. Use the given card text, never memory. Hidden cards are unknown — never claim to know them; reason about what the opponent could have.

The score moved between the decision and the next time the player held priority, and the opponent's turn in between counts too: a drop says where the position got worse, not that the player erred. When nothing the player could see makes another line better, say so plainly — the drop came from the opponent's play or the draw — rather than inventing a mistake. Never treat the score as certain; an engine-review regret whose interval includes zero is a close call, never a mistake; a short-horizon score is not a win chance.

Answer format — short, no preamble, no restating the state:
**What happened:** two sentences: what the player did and what it led to.
**Instead:** the line to consider instead, with its costs and which sources pay them — or "Nothing clearly better" and why.
**Rule:** the rule of thumb in a few words ("count lethal both ways", "trade on your terms", "hold the removal for the real threat"), so the pattern transfers.
**Confidence:** high, medium or low, then a few words why when it is not high. Low means a close call or a drop that the player's own choice does not explain.`;

function cardList(cards: readonly AnyCard[]): string {
  const names = cards.map((c) => visibleName(c) ?? 'a hidden card');
  return names.length ? names.join('; ') : 'none';
}

/** What the viewer could do at the decision, from its own view only. */
export function optionLines(d: Decision, seat: number): string[] {
  const s = d.state;
  const me = s.players.find((p) => p.id === seat);
  const opp = s.players.find((p) => p.id !== seat);
  const out: string[] = [];
  const creatures = (me?.zones.battlefield.cards ?? []).filter((c) => !isHidden(c) && /\bCreature\b/.test((c as Card).types)) as Card[];
  const pt = (c: Card) => `${c.name}${c.power != null && c.toughness != null ? ` ${c.power}/${c.toughness}` : ''}`;
  if (d.kind === 'attack') {
    const can = creatures.filter((c) => !c.tapped && !c.sick);
    out.push(`- Attack with any of: ${can.length ? can.map(pt).join('; ') : 'none untapped and not summoning sick'} (haste aside), or not at all.`);
  } else if (d.kind === 'block') {
    const attackers = ((opp?.zones.battlefield.cards ?? []) as AnyCard[]).filter((c) => !isHidden(c) && (c as Card).attacking) as Card[];
    const can = creatures.filter((c) => !c.tapped);
    out.push(`- Attacking you: ${attackers.length ? attackers.map(pt).join('; ') : 'see the combat section above'}.`);
    out.push(`- Block with any of: ${can.length ? can.map(pt).join('; ') : 'no untapped creature'}, or take it.`);
  } else if (d.kind === 'main') {
    out.push(`- Cast or play from your hand: ${cardList(me?.zones.hand.cards ?? [])} (what the mana covers: see the untapped sources above).`);
    out.push('- Activate abilities of your permanents, or pass.');
  } else if (d.kind === 'choice') {
    out.push('- The choices are the ones listed under # Decision above.');
  }
  if (d.options?.length) {
    out.push(`- At instant speed the mana covered: ${d.options.map((o) => `${o.name}${o.via === 'ability' ? ` (ability ${o.cost ?? ''})` : o.cost ? ` ${o.cost}` : ''}`).join('; ')}.`);
  }
  if (d.kind === 'priority') out.push('- Or pass and let the game go on.');
  return out;
}

/** Every card name whose text the film prompt for this moment includes (the decision's own). */
export function filmCardNames(log: GameLog, m: FilmMoment): string[] {
  try {
    return coachCardNames(log, m.decision);
  } catch {
    return [];
  }
}

/** The state section of prompt.ts's coach prompt: everything before its "# Question". */
function stateTable(log: GameLog, d: Decision, cards: Map<string, CardInfo>): string {
  const user = buildCoachPrompt(log, d, cards, { format: 'classic' }).user;
  const q = user.lastIndexOf('\n# Question');
  return (q >= 0 ? user.slice(0, q) : user).trimEnd();
}

function scoreSection(m: FilmMoment, log: GameLog, report?: Pick<ReviewReport, 'knowledge'> | null, reviewDecision?: ReviewDecision | null): string[] {
  const out: string[] = ['# How the position moved'];
  if (m.source === 'eval') {
    out.push(`Source: ${SOURCE_WORDS.eval}. An estimate from the player's own view only, not a fact.`);
    out.push(`Before the decision (turn ${m.before.turn}): ${pct(m.before.p)}.`);
    out.push(`The next time the player held priority (turn ${m.after.turn}): ${pct(m.after.p)}.`);
    out.push(`Drop: ${Math.round(m.drop * 100)} points (number ${m.rank} by size among the drops across the player's decisions). The opponent's moves in between count too.`);
  } else if (m.source === 'heuristic') {
    out.push('Source: a rough score from life, board presence and cards in hand (0–100). NOT a win chance; it ignores card quality and what is hidden.');
    out.push(`Before the decision (turn ${m.before.turn}): ${Math.round(m.before.p * 100)}/100.`);
    out.push(`The next time the player held priority (turn ${m.after.turn}): ${Math.round(m.after.p * 100)}/100.`);
    out.push(`Fall: ${Math.round(m.drop * 100)}. The opponent's moves in between count too.`);
  } else {
    out.push(`Source: ${SOURCE_WORDS.review}. Each option was played out many times from this position; the yardstick is the best play against Forge's Default AI playing both seats.`);
    if (report) out.push(`Opponent's hidden cards in the playouts: ${opponentKnowledge(report.knowledge)}`);
    if (reviewDecision) {
      const st = decisionState(log, reviewDecision);
      out.push(measureLine(reviewDecision), 'Options:', ...optionRows(reviewDecision, st, log.seat), verdictLine(reviewDecision));
    } else if (m.review) {
      out.push(`Engine best: ${m.review.best ?? 'unknown'} (${fmtRate(m.before.p, m.review.measure)}); played: ${m.review.played} (${fmtRate(m.after.p, m.review.measure)}). ${m.review.verdict}.`);
    }
  }
  return out;
}

/**
 * The coach prompt for one turning point. Deterministic: the same log,
 * moment, card map (and report) give the same bytes.
 */
export function filmPrompt(
  log: GameLog,
  m: FilmMoment,
  cards: Map<string, CardInfo>,
  opts: { report?: Pick<ReviewReport, 'knowledge' | 'decisions'> | null } = {},
): Prompt {
  const d = m.decision;
  const lines: string[] = [stateTable(log, d, cards), '', '# What you could do', ...optionLines(d, log.seat)];
  lines.push('', '# What you did');
  if (d.actions.length) lines.push(...d.actions.map((a) => `- ${a}`));
  else lines.push('- Nothing recorded: you passed (or this recording has no actions).');
  const rd = m.review && opts.report ? opts.report.decisions.find((x) => x.frame === m.review!.frame) ?? null : null;
  lines.push('', ...scoreSection(m, log, opts.report ?? null, rd));
  lines.push(
    '',
    '# Question',
    `This is turning point #${m.rank} of the game (turn ${m.turn}, ${phaseLabel(d.state.phase)}). What happened here, what should I have considered instead, and what is the rule of thumb?`,
  );
  return { system: FILM_SYSTEM, user: lines.join('\n') };
}

/** The answer store key for a moment (a new source or score is a new question). */
export function filmKey(gameKey: string, m: FilmMoment): string {
  return `${gameKey}:film:${m.source}:f${m.decision.frameIndex}:${Math.round(m.drop * 1000)}`;
}

export interface MiniSide {
  life: number;
  lands: number;
  creatures: number;
  others: number;
  hand: number;
}

/** A glance at the board at the decision, from the viewer's view: life, lands, creatures, other permanents, hand size. */
export function miniBoard(state: GameStateBody, seat: number): { you: MiniSide; them: MiniSide } | null {
  const me = state.players.find((p) => p.id === seat);
  const opp = state.players.find((p) => p.id !== seat);
  if (!me || !opp) return null;
  const side = (p: typeof me): MiniSide => {
    let lands = 0;
    let creatures = 0;
    let others = 0;
    for (const c of p.zones.battlefield.cards) {
      const t = isHidden(c) ? '' : (c as Card).types;
      if (/\bCreature\b/.test(t)) creatures++;
      else if (/\bLand\b/.test(t)) lands++;
      else others++;
    }
    return { life: p.life, lands, creatures, others, hand: p.zones.hand.count ?? p.zones.hand.cards.length };
  };
  return { you: side(me), them: side(opp) };
}
