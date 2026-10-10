/*
 * ForgeCoach — livePlan/coach.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The live coach in plan mode (mtg-table D419, ported from tools/llm-seat): one
 * fresh call per moment (moments.ts), the reply read (parse.ts) and checked
 * against what the engine allows (check.ts), and — when a step cannot be done
 * or the reply cannot be read — a fresh call again with the full prompt and the
 * correction's words, at most MAX_CORRECTIONS times. This file puts the pieces
 * together for one moment; the play screen (ui/play/planRun.ts) runs the calls.
 *
 * Measured basis (mtg-table D419): ~60 real games of Sonnet in the human seat
 * against Forge in this format, about one failed step a game, 9 of 10 won
 * against plain Forge; a fresh call per moment did as well as a running session
 * (7/10 vs 8/10 on 10 paired deals) at a third of the cost. Pure and DOM-free.
 */
import type { AskBody, GameStateBody, InputBody } from '../protocol.ts';
import type { GameLog } from '../log.ts';
import type { CardInfo } from '../cards.ts';
import type { Prompt } from '../prompt.ts';
import { systemFor } from '../opponent.ts';
import { checkPlan, type CheckResult } from './check.ts';
import { landsPlayedThisTurn, momentAt, type Moment, type PlanSoFar } from './moments.ts';
import { atPriority, offersOf } from './offers.ts';
import { oracleFromCards, type Oracle } from './oracle.ts';
import { parsePlan, type ParsedPlan } from './parse.ts';
import { MAX_CORRECTIONS, PLAN_SYSTEM, attackCandidates, correctionQuestion, invalidQuestion, planFullPrompt } from './prompt.ts';
import { visibleNames } from './history.ts';

/** The game at the moment asked about: the log's frame and what was open then. */
export interface Snapshot {
  frameIndex: number;
  state: GameStateBody;
  input: InputBody | null;
  ask: AskBody | null;
}

const BEFORE_COMBAT = new Set(['UPKEEP', 'DRAW', 'MAIN1', 'COMBAT_BEGIN']);

/** The card names a plan prompt needs text for (every card the seat can see). */
export function planPromptNames(snap: Snapshot): string[] {
  return visibleNames(snap.state);
}

/** The moment at a snapshot (auto-coach's, or with `force` the one "Ask about this" asks). */
export function momentOf(log: GameLog, snap: Snapshot, seat: number, oracle: Oracle | null, opts: { force?: boolean; plan?: PlanSoFar | null } = {}): Moment | null {
  return momentAt({ frames: log.frames.slice(0, snap.frameIndex + 1), state: snap.state, input: snap.input, ask: snap.ask, me: seat, oracle, plan: opts.plan ?? null }, { force: opts.force ?? false });
}

/** The prompt for a moment (or a correction's question about it). Deterministic. */
export function buildPlanPrompt(log: GameLog, snap: Snapshot, seat: number, cards: ReadonlyMap<string, CardInfo>, question: string, opts: { guide?: string | null; moment?: Pick<Moment, 'kind' | 'atAttack'> } = {}): Prompt {
  const oracle = oracleFromCards(cards);
  const frames = log.frames.slice(0, snap.frameIndex + 1);
  const st = snap.state;
  const priority = atPriority(st, seat, snap.input, snap.ask) && opts.moment?.kind !== 'mulligan' && opts.moment?.kind !== 'play-draw';
  const own = st.activePlayer === seat;
  const atAttack = opts.moment?.atAttack === true || /^Select creatures to attack/.test(String(snap.input?.prompt ?? ''));
  const attackers = own && (BEFORE_COMBAT.has(st.phase ?? '') || atAttack) ? attackCandidates(st, seat) : null;
  const user = planFullPrompt({
    question,
    frames,
    state: st,
    me: seat,
    oracle,
    offers: priority ? offersOf(st, seat, oracle) : null,
    attackers,
    landsPlayed: landsPlayedThisTurn(frames, seat),
    guide: opts.guide ?? null,
  });
  return { system: systemFor(PLAN_SYSTEM, log), user };
}

export type Review = { parsed: ParsedPlan; check: CheckResult | null };

/** Reads a reply and checks its steps at the moment's snapshot. */
export function reviewReply(text: string, log: GameLog, snap: Snapshot, seat: number, cards: ReadonlyMap<string, CardInfo>, moment: Pick<Moment, 'kind' | 'atAttack' | 'ask'>): Review {
  const parsed = parsePlan(text);
  if (!parsed.ok) return { parsed, check: null };
  const oracle = oracleFromCards(cards);
  const frames = log.frames.slice(0, snap.frameIndex + 1);
  const check = checkPlan({ steps: parsed.steps, moment, state: snap.state, me: seat, oracle, landsPlayed: landsPlayedThisTurn(frames, seat), input: snap.input, ask: snap.ask });
  return { parsed, check };
}

/**
 * The question for the next attempt, or null when the reply stands (it reads
 * and checks out, or the corrections are used up). `attempt` is the attempt
 * just made (0 for the first call).
 */
export function correctionFor(review: Review, reply: string, question: string, attempt: number): string | null {
  if (attempt >= MAX_CORRECTIONS) return null;
  const n = attempt + 1;
  if (!review.parsed.ok) return invalidQuestion({ error: review.parsed.error, reply, question, n });
  if (review.check && review.check.first) return correctionQuestion({ step: review.check.first.step, why: review.check.first.why, steps: review.parsed.steps, n, question });
  return null;
}
