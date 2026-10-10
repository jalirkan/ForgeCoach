/*
 * ForgeCoach — ui/play/planRun.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Runs one plan-mode moment (mtg-table D419; livePlan/coach.ts): a fresh call
 * with the full prompt, the reply read and checked against what the engine
 * allows, and — when a step cannot be done or the reply cannot be read — a
 * fresh call again with the correction's words, at most MAX_CORRECTIONS times.
 * Each attempt is its own answer (key `…~c<n>`); the advice entry moves to the
 * newest (autoPlan.ts `replaceAdviceKey`), so the panel and the kept advice
 * always show the latest. While it works, `runStatus` says what is happening
 * ("checking…", "step 2 can't be done — asking again (correction 1 of 2)") so
 * the player knows. Starting another moment in the same slot ends this run
 * (answers.ts slots: the coach helper's supersede / replaceRunning).
 */
import { useSyncExternalStore } from 'react';
import type { GameLog } from '../../log.ts';
import type { Decision } from '../../decisions.ts';
import { activeGuideText } from '../../guide.ts';
import { buildPlanPrompt, correctionFor, planPromptNames, reviewReply, type Snapshot } from '../../livePlan/coach.ts';
import { MAX_CORRECTIONS } from '../../livePlan/prompt.ts';
import { getAnswer, startAnswer } from '../answers.ts';
import { cardsForPrompt } from '../cardData.ts';
import { adviceFor, baseAnswerKey, recordAdvice, replaceAdviceKey, type AdviceEntry, type PlanMoment } from './autoPlan.ts';

export type RunPhase = 'asking' | 'checking' | 'reasking' | 'done';

export interface RunStatus {
  phase: RunPhase;
  /** The attempt now asked (0 = the first call). */
  attempt: number;
  /** Why the attempt before it was sent back. */
  problem: string | null;
}

const runs = new Map<string, RunStatus & { token: number }>();
/** The run that last started in each slot: an older run never asks a correction over a newer moment. */
const slotOwner = new Map<string, number>();
const listeners = new Set<() => void>();
let tokens = 0;

function set(base: string, s: RunStatus & { token: number }) {
  runs.set(base, s);
  for (const l of listeners) l();
}

/** What the run of a moment (by its first attempt's key) is doing, or undefined. */
export function runStatus(base: string | null): RunStatus | undefined {
  return base ? runs.get(base) : undefined;
}

export function useRunStatus(base: string | null): RunStatus | undefined {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (base ? runs.get(base) : undefined),
  );
}

function guide(): string | null {
  try {
    return activeGuideText() || null;
  } catch {
    return null;
  }
}

/** The snapshot a Decision was taken at. */
export function snapshotOf(d: Pick<Decision, 'frameIndex' | 'state' | 'input' | 'ask'>): Snapshot {
  return { frameIndex: d.frameIndex, state: d.state, input: d.input, ask: d.ask };
}

export interface RunOptions {
  game: string;
  /** The answers-store key of the first attempt. */
  base: string;
  kind: AdviceEntry['kind'];
  moment: PlanMoment;
  log: GameLog;
  seat: number;
  decision: Decision;
  slot: string;
  supersedes: string;
}

/** Asks a moment, checks the reply, corrects it when needed. Resolves when the run ends. */
export async function runPlanMoment(o: RunOptions): Promise<void> {
  const token = ++tokens;
  const snap = snapshotOf(o.decision);
  const names = planPromptNames(snap);
  const g = guide();
  slotOwner.set(o.slot, token);
  // asked again: the entry of an earlier run (maybe under a correction's key) starts over
  const old = adviceFor(o.game).find((e) => e.key !== o.base && baseAnswerKey(e.key) === o.base);
  if (old) replaceAdviceKey(o.game, old.key, o.base, 0);
  recordAdvice(o.game, { key: o.base, kind: o.kind, label: o.moment.label, forTurn: o.decision.state.turn || null, decision: o.decision, moment: o.moment, attempt: 0 });
  const mine = () => runs.get(o.base)?.token === token && slotOwner.get(o.slot) === token;
  let question = o.moment.question;
  let key = o.base;
  for (let attempt = 0; ; attempt++) {
    if (attempt > 0) {
      const next = `${o.base}~c${attempt}`;
      replaceAdviceKey(o.game, key, next, attempt);
      key = next;
    }
    if (attempt === 0) set(o.base, { phase: 'asking', attempt, problem: null, token });
    else if (!mine()) return;
    const q = question;
    await startAnswer(key, async () => buildPlanPrompt(o.log, snap, o.seat, await cardsForPrompt(names), q, { guide: g, moment: o.moment }), {
      supersedes: o.supersedes,
      replaceRunning: true,
      slot: o.slot,
      live: 'plan',
    });
    if (runs.get(o.base)?.token !== token) return;
    const a = getAnswer(key);
    if (!a || a.status !== 'done' || !a.text || !mine()) {
      set(o.base, { phase: 'done', attempt, problem: null, token });
      return;
    }
    set(o.base, { phase: 'checking', attempt, problem: null, token });
    const cards = await cardsForPrompt(names);
    if (!mine()) return;
    const review = reviewReply(a.text, o.log, snap, o.seat, cards, o.moment);
    const next = correctionFor(review, a.text, o.moment.question, attempt);
    if (!next) {
      set(o.base, { phase: 'done', attempt, problem: null, token });
      return;
    }
    const problem = !review.parsed.ok
      ? `the reply was not in the steps format (${review.parsed.error})`
      : `step ${review.check!.first!.step.n} can’t be done: ${review.check!.first!.why}`;
    set(o.base, { phase: 'reasking', attempt: attempt + 1, problem, token });
    question = next;
  }
}

/** Corrections per moment (for the panel's words). */
export const MAX_PLAN_CORRECTIONS = MAX_CORRECTIONS;
