/*
 * ForgeCoach — ui/play/autoPlan.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Auto-coach's timing and the live coach's advice history. Pure and DOM-free
 * (the React side is PlayCoach).
 *
 * Auto-coach asks ONE question per turn cycle: a plan for the player's next
 * turn, at the opponent's end step (END_OF_TURN, or CLEANUP when that is the
 * first state the board sees), so the answer is there when the turn starts.
 * The engine does not always send a state in the opponent's end step (a skipped
 * stop goes straight from their second main phase to the player's untap), so
 * when the cycle's plan was not asked by then, it is asked at the start of the
 * player's own turn (untap, upkeep, draw or first main phase). That also covers
 * turn 1 on the play, right after the keep. Each turn's plan is asked once:
 * `planDue` answers null for a turn already in `asked`.
 *
 * Not earlier: asking at the opponent's combat end or second main phase was
 * measured and left out. In all 33 such cycles of the ten recorded games the
 * Forge AI still changed its board after that point (a land, a creature, an
 * enchantment), so the plan would miss it; and the AI's second main phase is
 * short (0–3.5 s in the full-game playtest: its long think is in its first).
 *
 * The plan stays on screen through the player's turn and the opponent's next
 * one, until the next cycle's plan replaces it (`currentPlan`). The player's
 * own asks ("ask" entries) sit beside it and never clear it.
 */
import type { GameStateBody } from '../../protocol.ts';
import type { GameLog } from '../../log.ts';
import type { Decision } from '../../decisions.ts';
import { phaseLabel } from '../../decisions.ts';
import { gameJoinKey } from '../../feedback.ts';

/** The opponent's steps at which the next turn's plan is asked. */
export const PLAN_STEPS_THEIRS: ReadonlySet<string> = new Set(['END_OF_TURN', 'CLEANUP']);
/** The player's own steps at which a cycle's missed plan is asked instead. */
export const PLAN_STEPS_MINE: ReadonlySet<string> = new Set(['UNTAP', 'UPKEEP', 'DRAW', 'MAIN1']);

/**
 * The turn whose plan is due at this state, or null. In a two-player game the
 * turn after the opponent's is the player's, so their end step asks for turn + 1.
 */
export function planDue(state: GameStateBody | null, seat: number | null | undefined, asked: ReadonlySet<number>): number | null {
  if (!state || seat === null || seat === undefined || !state.phase || !state.turn) return null;
  const mine = state.activePlayer === seat;
  let forTurn: number | null = null;
  if (!mine && PLAN_STEPS_THEIRS.has(state.phase)) forTurn = state.turn + 1;
  else if (mine && PLAN_STEPS_MINE.has(state.phase)) forTurn = state.turn;
  if (forTurn === null || asked.has(forTurn)) return null;
  return forTurn;
}

/**
 * One game's seat: the scope of the plan's turn numbers, the history, the coach
 * slots and the advice kept across a reload (adviceStore.ts) — feedback.ts's game
 * key (`gameId|seed|startedAt`) and the seat.
 */
export function gameKeyOf(log: GameLog | null, seat: number | null | undefined): string | null {
  const h = log?.header;
  if (!h || typeof h.gameId !== 'string' || !h.gameId || seat === null || seat === undefined) return null;
  return `${gameJoinKey({ gameId: h.gameId, seed: typeof h.seed === 'number' ? h.seed : null, startedAt: typeof h.startedAt === 'string' && h.startedAt ? h.startedAt : null })}#${seat}`;
}

/** The answers-store key of a turn's plan. */
export function planKey(game: string, forTurn: number): string {
  return `${game}:live:plan:t${forTurn}`;
}

/** What a piece of advice was for, in words: "Plan for your turn 8", "Your Main 1, turn 7". */
export function planLabel(forTurn: number): string {
  return `Plan for your turn ${forTurn}`;
}

export function askLabel(d: Decision): string {
  const s = d.state;
  if (!s.phase || !s.turn) return d.label.replace(/^R\d+\s*·\s*/, '');
  if (d.kind === 'attack') return `Your attacks, turn ${s.turn}`;
  if (d.kind === 'block') return `Your blocks, turn ${s.turn}`;
  const whose = d.label.includes("Opponent's") ? "Opponent's" : 'Your';
  return `${whose} ${phaseLabel(s.phase).toLowerCase()}, turn ${s.turn}`;
}

// ---------------------------------------------------------------------------
// The live coach's advice, per game seat (module state: it outlives the panel,
// which unmounts when the coach is folded away)

export interface AdviceEntry {
  /** The answers-store key. */
  key: string;
  /** 'plan': auto-coach's (or a re-asked) plan for a turn; 'ask': the player's own question. */
  kind: 'plan' | 'ask';
  label: string;
  /** For a plan: the turn it plans. */
  forTurn: number | null;
  /** The log frame it was asked at (its feedback target). */
  frameIndex: number;
  /**
   * The moment it was asked about (its prompt). Null for advice kept across a
   * reload whose moment the log no longer has: its text stays readable.
   */
  decision: Decision | null;
  /** Order of asking (a counter, not a clock). */
  seq: number;
}

/** How many entries one game keeps (the newest first). */
export const MAX_ADVICE = 12;
const MAX_GAMES = 3;

interface GameAdvice {
  entries: AdviceEntry[];
  plans: Set<number>;
}

const games = new Map<string, GameAdvice>();
const listeners = new Set<() => void>();
let seq = 0;
const EMPTY: readonly AdviceEntry[] = Object.freeze([]);

function gameOf(game: string): GameAdvice {
  let g = games.get(game);
  if (!g) {
    g = { entries: [], plans: new Set() };
    games.set(game, g);
    while (games.size > MAX_GAMES) games.delete(games.keys().next().value!);
  }
  return g;
}

function notify() {
  for (const l of listeners) l();
}

export function subscribeAdvice(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The game's advice, newest first (a stable array until it changes). */
export function adviceFor(game: string | null): readonly AdviceEntry[] {
  return (game && games.get(game)?.entries) || EMPTY;
}

/** Record advice that was just asked; the same key asked again moves to the front. */
export function recordAdvice(game: string, e: Omit<AdviceEntry, 'seq' | 'frameIndex'> & { frameIndex?: number }): AdviceEntry {
  const g = gameOf(game);
  const entry: AdviceEntry = { ...e, frameIndex: e.frameIndex ?? e.decision?.frameIndex ?? -1, seq: ++seq };
  g.entries = [entry, ...g.entries.filter((x) => x.key !== e.key)].slice(0, MAX_ADVICE);
  notify();
  return entry;
}

/** The turns whose plan auto-coach has asked for in this game. */
export function plansAsked(game: string | null): ReadonlySet<number> {
  return (game && games.get(game)?.plans) || new Set<number>();
}

export function markPlanAsked(game: string, forTurn: number): void {
  gameOf(game).plans.add(forTurn);
}

/** The plan on screen: the newest one asked. */
export function currentPlan(entries: readonly AdviceEntry[]): AdviceEntry | null {
  return entries.find((e) => e.kind === 'plan') ?? null;
}

/**
 * The player's last own question when the game has moved on from it (`currentKey`
 * is the moment on screen): shown beside the plan until the next cycle's plan.
 */
export function lastAsk(entries: readonly AdviceEntry[], currentKey: string | null): AdviceEntry | null {
  const plan = currentPlan(entries);
  const a = entries.find((e) => e.kind === 'ask' && e.key !== currentKey) ?? null;
  return a && (!plan || a.seq > plan.seq) ? a : null;
}

/** Everything older than what is shown: "Earlier advice". */
export function earlierAdvice(entries: readonly AdviceEntry[], currentKey: string | null): AdviceEntry[] {
  const shown = new Set([currentPlan(entries)?.key, lastAsk(entries, currentKey)?.key, currentKey]);
  return entries.filter((e) => !shown.has(e.key));
}

/** The game seats this page has advice for. */
export function knownGames(): string[] {
  return [...games.keys()];
}

/** The game seat whose advice has the answers-store key `key`, or null. */
export function gameOfKey(key: string): string | null {
  for (const [game, g] of games) if (g.entries.some((e) => e.key === key)) return game;
  return null;
}

/** What one game seat has, for adviceStore.ts. */
export function gameAdvice(game: string): { entries: readonly AdviceEntry[]; plans: ReadonlySet<number> } | null {
  const g = games.get(game);
  return g ? { entries: g.entries, plans: g.plans } : null;
}

/**
 * Puts advice kept across a reload back (adviceStore.ts), unless this page
 * already has advice for the game. Returns whether it did. The order counter
 * moves past the kept entries, so newer advice still sorts first.
 */
export function restoreAdvice(game: string, entries: AdviceEntry[], plans: Iterable<number>): boolean {
  const had = games.get(game);
  if (had && (had.entries.length || had.plans.size)) return false;
  const g = gameOf(game);
  g.entries = [...entries].sort((a, b) => b.seq - a.seq).slice(0, MAX_ADVICE);
  g.plans = new Set(plans);
  for (const e of g.entries) seq = Math.max(seq, e.seq);
  notify();
  return true;
}

/** Tests: forget every game. */
export function resetAdvice(): void {
  games.clear();
  seq = 0;
  notify();
}
