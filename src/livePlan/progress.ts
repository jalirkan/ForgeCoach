/*
 * ForgeCoach — livePlan/progress.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Which of a plan's steps the player has done, read from the log the way the
 * seat counted its plan's progress (mtg-table tools/llm-seat lib/plan-core.mjs,
 * D419) — but from what happened, since the player, not a program, acts:
 *
 *   play land  a `land` event of the player's for that card
 *   cast       a `cast` event of the player's for that card (or a face of it)
 *   activate   a `cast` event (Forge reports abilities so) or a new stack item
 *              of the player's from that permanent
 *   attack     the player's `attackers` event (none: combat went by without one)
 *   block      the player's `blockers` event
 *   target / choose  done with the play it belongs to, or once a later step is
 *                    (a question: once the player answered it)
 *   keep / mulligan  the game began / a `mulligan` event
 *   pass / hold      when the moment has passed
 *
 * A moment has passed when the game is beyond it (the turn changed, the stack
 * item left, the question was answered); the plan then stays readable as it
 * was. Pure and DOM-free.
 */
import type { GameStateBody } from '../protocol.ts';
import type { LoggedFrame } from '../log.ts';
import { cardsById, nameOf, type LooseCard } from './board.ts';
import type { MomentKind } from './moments.ts';
import type { Oracle } from './oracle.ts';
import { normName, parseRef, type Step } from './parse.ts';

export interface PlanProgress {
  done: boolean[];
  /** The game is beyond the moment the plan was for. */
  passed: boolean;
  /** Every step done, or the moment passed. */
  complete: boolean;
}

export interface ProgressInput {
  steps: readonly Step[];
  /** The whole log so far. */
  frames: readonly LoggedFrame[];
  /** The index of the moment's frame in `frames`: only what came after it counts. */
  from: number;
  me: number;
  moment: { kind: MomentKind; id: string; turn: number; phase: string | null };
  oracle?: Oracle | null;
}

const BEYOND_ATTACKS = new Set(['COMBAT_DECLARE_BLOCKERS', 'COMBAT_FIRST_STRIKE_DAMAGE', 'COMBAT_DAMAGE', 'COMBAT_END', 'MAIN2', 'END_OF_TURN', 'CLEANUP']);
const BEYOND_BLOCKS = new Set(['COMBAT_FIRST_STRIKE_DAMAGE', 'COMBAT_DAMAGE', 'COMBAT_END', 'MAIN2', 'END_OF_TURN', 'CLEANUP']);

function names(card: LooseCard | undefined, oracle: Oracle | null | undefined): string[] {
  const n = nameOf(card);
  if (!n) return [];
  return [normName(n), ...(oracle ? oracle.faces(n).map(normName) : [])];
}

function stepNames(s: Step): { name: string; id: number | null } {
  const r = parseRef(String(s.name ?? '').split(':')[0]);
  return { name: r.name, id: r.id };
}

export function planProgress(p: ProgressInput): PlanProgress {
  const done = p.steps.map(() => false);
  const take = (verbs: readonly string[], cardId: number, card: LooseCard | undefined): boolean => {
    const ns = names(card, p.oracle);
    for (const [i, s] of p.steps.entries()) {
      if (done[i] || !verbs.includes(s.verb)) continue;
      const want = stepNames(s);
      if ((want.id !== null && want.id === cardId) || (want.id === null && ns.includes(want.name))) {
        done[i] = true;
        return true;
      }
    }
    return false;
  };
  let last: GameStateBody | null = null;
  let attacked = false;
  let blocked = false;
  let mulliganed = false;
  const seenStack = new Set<number>();
  const firstState = p.frames.slice(0, p.from + 1).reverse().find((f) => f.type === 'state' && f.dir !== 'c2s');
  for (const it of (firstState?.body as GameStateBody | undefined)?.stack ?? []) seenStack.add(it.id);
  for (const f of p.frames.slice(p.from + 1)) {
    if (f.dir === 'c2s' || f.type !== 'state') continue;
    const s = f.body as GameStateBody;
    last = s;
    const cards = cardsById(s);
    for (const e of s.events ?? []) {
      if (e.kind === 'land' && e.player === p.me) take(['play land'], e.cardId, cards.get(e.cardId));
      else if (e.kind === 'cast' && e.controller === p.me) {
        const c = cards.get(e.cardId);
        const order = c?.zone === 'battlefield' ? ['activate', 'cast'] : ['cast', 'activate'];
        if (!take([order[0]!], e.cardId, c)) take([order[1]!], e.cardId, c);
      } else if (e.kind === 'attackers' && e.player === p.me) attacked = true;
      else if (e.kind === 'blockers' && e.defendingPlayer === p.me) blocked = true;
      else if (e.kind === 'mulligan' && e.player === p.me) mulliganed = true;
    }
    for (const it of s.stack ?? []) {
      if (seenStack.has(it.id)) continue;
      seenStack.add(it.id);
      if (it.controller === p.me && it.isAbility && it.sourceCardId != null) take(['activate'], it.sourceCardId, cards.get(it.sourceCardId));
    }
    if (attacked) for (const [i, st] of p.steps.entries()) if (st.verb === 'attack with') done[i] = true;
    if (blocked) for (const [i, st] of p.steps.entries()) if (st.verb === 'block') done[i] = true;
  }
  const m = p.moment;
  const turnNow = last?.turn ?? m.turn;
  const phaseNow = last?.phase ?? m.phase;
  let passed = false;
  switch (m.kind) {
    case 'mulligan':
      passed = mulliganed || (turnNow ?? 0) > 0;
      break;
    case 'play-draw':
      passed = (turnNow ?? 0) > 0 || p.frames.slice(p.from + 1).some((f) => f.type === 'input' && /\bkeep\b/i.test(String((f.body as { prompt?: string }).prompt ?? '')));
      break;
    case 'response': {
      const stackId = Number(m.id.split(':')[2]);
      passed = last !== null && !(last.stack ?? []).some((it) => it.id === stackId);
      break;
    }
    case 'blocks':
      passed = blocked || turnNow !== m.turn || BEYOND_BLOCKS.has(phaseNow ?? '');
      break;
    case 'question':
      // answered: the player's answer or click went to the engine after it
      passed = turnNow !== m.turn || p.frames.slice(p.from + 1).some((f) => f.dir === 'c2s' && (f.type === 'answer' || f.type === 'act'));
      break;
    case 'now':
      passed = turnNow !== m.turn || phaseNow !== m.phase;
      break;
    default:
      passed = turnNow !== m.turn;
  }
  for (const [i, s] of p.steps.entries()) {
    if (done[i]) continue;
    if (s.verb === 'keep') done[i] = (turnNow ?? 0) > 0 && !mulliganed;
    if (s.verb === 'mulligan') done[i] = mulliganed;
    if (s.verb === 'attack with' && !s.names && (turnNow !== m.turn || BEYOND_ATTACKS.has(phaseNow ?? ''))) done[i] = true;
    if ((s.verb === 'pass' || s.verb === 'hold') && passed) done[i] = true;
  }
  // a target / choose belongs to the play before it: done with it, or once a later step is
  for (let i = p.steps.length - 1; i >= 0; i--) {
    const s = p.steps[i]!;
    if (done[i] || (s.verb !== 'target' && s.verb !== 'choose')) continue;
    const prev = p.steps.slice(0, i).reverse().find((x) => x.verb !== 'target' && x.verb !== 'choose');
    const prevDone = prev ? done[p.steps.indexOf(prev)] : false;
    const laterDone = done.slice(i + 1).some(Boolean);
    if ((prev && (prev.verb === 'cast' || prev.verb === 'activate') && prevDone) || laterDone || (m.kind === 'question' && passed)) done[i] = true;
  }
  return { done, passed, complete: passed || done.every(Boolean) };
}
