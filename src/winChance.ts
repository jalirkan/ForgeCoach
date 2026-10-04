/*
 * ForgeCoach — winChance.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The win chance over a game (D361 in mtg-table): which positions are scored,
 * the request for each, the turn-to-turn change and the drops after the
 * player's decisions. Pure and DOM-free; evalClient.ts asks the helper.
 *
 * WHICH POSITIONS. The evaluator was trained on decision rows (mtg-table
 * tools/ml/encode.py `encode_game`): a `state` frame in which the viewing seat
 * holds priority in a main phase or a combat step, the game not over. Only those
 * are scored here; anything else would be outside what the model has seen.
 *
 * THE REQUEST. The state as the viewing seat received it — the log's own body,
 * already redacted for this seat — and, as `history`, the earlier state frames'
 * `events` and `stack`: the training rows count this turn's land drop, lands
 * and spells from those events. Only frames holding a `turn`, `land`, `cast` or
 * `mulligan` event are sent (the others cannot change the answer). Frames are
 * read as encode.py reads a log: server-to-client only, each `seq` once.
 */
import type { LoggedFrame, GameLog } from './log.ts';
import type { GameEvent, GameStateBody, StackItem } from './protocol.ts';

export const MAIN_PHASES = ['MAIN1', 'MAIN2'] as const;
export const COMBAT_PHASES = [
  'COMBAT_BEGIN',
  'COMBAT_DECLARE_ATTACKERS',
  'COMBAT_DECLARE_BLOCKERS',
  'COMBAT_FIRST_STRIKE_DAMAGE',
  'COMBAT_DAMAGE',
  'COMBAT_END',
] as const;
const DECISION_PHASES = new Set<string>([...MAIN_PHASES, ...COMBAT_PHASES]);
/** The event kinds the training rows' counters read; a frame with none of them changes nothing. */
export const TALLY_KINDS: ReadonlySet<string> = new Set(['turn', 'land', 'cast', 'mulligan']);
/** A drop of at least this much after one of the player's decisions is marked (8 points). */
export const DROP_THRESHOLD = 0.08;

export interface EvalHistoryFrame {
  events: GameEvent[];
  stack: StackItem[];
}

/** POST /eval's body. */
export interface EvalRequest {
  seat: number;
  state: GameStateBody;
  history: EvalHistoryFrame[];
}

export interface StatePoint {
  /** Index into `log.frames`. */
  frameIndex: number;
  state: GameStateBody;
}

/** A scored position. */
export interface WinPoint {
  frameIndex: number;
  turn: number;
  p: number;
}

/** Is this a position the model was trained on, for `seat`? */
export function isEvalState(state: GameStateBody | null | undefined, seat: number): boolean {
  return !!state && !state.gameOver && state.priority === seat && state.phase !== null && DECISION_PHASES.has(state.phase);
}

/** The game's state frames as encode.py reads them: server-to-client (or unmarked), each seq once. */
export function readStates(log: GameLog): StatePoint[] {
  const seen = new Set<number>();
  const out: StatePoint[] = [];
  log.frames.forEach((f: LoggedFrame, i) => {
    if (f.dir !== undefined && f.dir !== 's2c') return;
    const seq = (f as { seq?: unknown }).seq;
    if (typeof seq === 'number' && Number.isInteger(seq)) {
      if (seen.has(seq)) return;
      seen.add(seq);
    }
    if (f.type === 'state' && f.body) out.push({ frameIndex: i, state: f.body as GameStateBody });
  });
  return out;
}

/** The positions to score: the viewing seat's decision rows. */
export function evalPoints(log: GameLog): StatePoint[] {
  return readStates(log).filter((s) => isEvalState(s.state, log.seat));
}

function tallies(state: GameStateBody): boolean {
  return (state.events ?? []).some((e) => TALLY_KINDS.has((e as { kind?: string }).kind ?? ''));
}

/**
 * The requests for the given frames (indices into `log.frames`, state frames),
 * built in one pass over the log. A frame that is not one of the log's state
 * frames gets none.
 */
export function buildRequests(log: GameLog, frameIndices: Iterable<number>): Map<number, EvalRequest> {
  const want = new Set(frameIndices);
  const out = new Map<number, EvalRequest>();
  if (want.size === 0) return out;
  const history: EvalHistoryFrame[] = [];
  for (const s of readStates(log)) {
    if (want.has(s.frameIndex)) out.set(s.frameIndex, { seat: log.seat, state: s.state, history: history.slice() });
    if (out.size === want.size) break;
    if (tallies(s.state)) history.push({ events: s.state.events ?? [], stack: s.state.stack ?? [] });
  }
  return out;
}

export function buildRequest(log: GameLog, frameIndex: number): EvalRequest | null {
  return buildRequests(log, [frameIndex]).get(frameIndex) ?? null;
}

/** The latest scored position at or before `frameIndex` (the newest when it is omitted). */
export function pointAt(points: readonly WinPoint[], frameIndex?: number): WinPoint | null {
  let best: WinPoint | null = null;
  for (const p of points) {
    if (frameIndex !== undefined && p.frameIndex > frameIndex) break;
    best = p;
  }
  return best;
}

export interface TurnChange {
  now: WinPoint;
  /** The last scored position of an earlier turn, or null on the first turn scored. */
  before: WinPoint | null;
  /** now.p − before.p, or null. */
  delta: number | null;
}

/** The win chance at `frameIndex` (or now) and its change since the last position scored in an earlier turn. */
export function turnChange(points: readonly WinPoint[], frameIndex?: number): TurnChange | null {
  const sorted = [...points].sort((a, b) => a.frameIndex - b.frameIndex);
  const now = pointAt(sorted, frameIndex);
  if (!now) return null;
  let before: WinPoint | null = null;
  for (const p of sorted) {
    if (p.frameIndex >= now.frameIndex) break;
    if (p.turn < now.turn) before = p;
  }
  return { now, before, delta: before ? now.p - before.p : null };
}

export interface WinDrop {
  /** The player's decision the drop is marked at (its first frame, as the caller gave it). */
  decisionFrame: number;
  /** An id the caller gave the decision (an index into its own list). */
  id: number;
  before: WinPoint;
  after: WinPoint;
  /** before.p − after.p (positive). */
  drop: number;
}

/** A decision of the player's: the frames it covers, [frame, end), and the caller's id for it. */
export interface DecisionSpan {
  frame: number;
  /** One past its last frame (default frame + 1: a single moment). */
  end?: number;
  id: number;
}

/**
 * Drops of at least `threshold` between two consecutive scored positions, a
 * then b, that one of the player's decisions overlaps (it starts before b and
 * ends after a). Each drop is marked once, at the last such decision. The
 * opponent's moves in between count too: a drop says where the estimate fell,
 * not why.
 */
export function decisionDrops(points: readonly WinPoint[], decisions: readonly DecisionSpan[], threshold = DROP_THRESHOLD): WinDrop[] {
  const sorted = [...points].sort((a, b) => a.frameIndex - b.frameIndex);
  const ds = [...decisions].sort((a, b) => a.frame - b.frame);
  const out: WinDrop[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    const drop = a.p - b.p;
    if (drop < threshold - 1e-12) continue;
    let last: DecisionSpan | null = null;
    for (const d of ds) {
      if (d.frame >= b.frameIndex) break;
      if ((d.end ?? d.frame + 1) > a.frameIndex) last = d;
    }
    if (last) out.push({ decisionFrame: last.frame, id: last.id, before: a, after: b, drop });
  }
  return out;
}

/**
 * Replay decisions (decisions.ts) cover a stretch of the game — "your main 1"
 * is every action of that main phase — so each spans from its frame to the
 * first state frame of another turn or phase (or the next decision, if sooner).
 */
export function decisionSpans(log: GameLog, decisions: ReadonlyArray<{ frameIndex: number; id: number }>): DecisionSpan[] {
  const states = readStates(log);
  const ds = [...decisions].sort((a, b) => a.frameIndex - b.frameIndex);
  return ds.map((d, k) => {
    const next = ds[k + 1]?.frameIndex ?? Number.POSITIVE_INFINITY;
    const at = states.find((s) => s.frameIndex >= d.frameIndex);
    let end = next;
    if (at) {
      const moved = states.find((s) => s.frameIndex > d.frameIndex && (s.state.turn !== at.state.turn || s.state.phase !== at.state.phase));
      if (moved) end = Math.min(end, moved.frameIndex);
    }
    return { frame: d.frameIndex, end: Number.isFinite(end) ? end : d.frameIndex + 1, id: d.id };
  });
}

/** "54%" */
export function pct(p: number): string {
  return `${Math.round(Math.min(1, Math.max(0, p)) * 100)}%`;
}

/** A change in points, signed: "+4", "−12", "±0". */
export function points(delta: number): string {
  const n = Math.round(delta * 100);
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0';
}

/** The game a cache entry belongs to. */
export function evalGameKey(log: GameLog): string {
  return `${log.header.gameId}@${log.header.startedAt}#${log.seat}`;
}
