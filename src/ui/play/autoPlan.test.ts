// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseLog, type GameLog } from '../../log.ts';
import type { GameStateBody } from '../../protocol.ts';
import type { Decision } from '../../decisions.ts';
import {
  PLAN_STEPS_MINE,
  PLAN_STEPS_THEIRS,
  adviceFor,
  askLabel,
  currentPlan,
  earlierAdvice,
  gameKeyOf,
  lastAsk,
  planDue,
  planKey,
  planLabel,
  recordAdvice,
  resetAdvice,
} from './autoPlan.ts';

const root = new URL('../../../', import.meta.url);
const files = [
  ...readdirSync(new URL('public/samples/', root)).filter((f) => f.endsWith('.jsonl.gz')).map((f) => new URL(`public/samples/${f}`, root)),
  ...readdirSync(new URL('bench/coach/logs/', root)).map((f) => new URL(`bench/coach/logs/${f}`, root)),
];
const logs: Array<[string, GameLog]> = files.map((u) => [u.pathname.split('/').pop()!, parseLog(gunzipSync(readFileSync(u)).toString('utf8'))]);

const states = (log: GameLog) => log.frames.filter((f) => f.type === 'state').map((f) => f.body as GameStateBody);
const fakeDecision = (s: GameStateBody): Decision => ({ index: 0, kind: 'main', frameIndex: 0, state: s, input: null, ask: null, label: 'R1 · Your Main 1', actions: [], endFrameIndex: 0 });

interface Fire {
  forTurn: number;
  turn: number;
  phase: string;
  mine: boolean;
}

/** Walk a game's states as the board sees them, firing as auto-coach does. */
function replay(log: GameLog): { fires: Fire[]; seat: number } {
  const seat = log.seat!;
  const asked = new Set<number>();
  const fires: Fire[] = [];
  for (const s of states(log)) {
    const due = planDue(s, seat, asked);
    if (due === null) continue;
    asked.add(due);
    fires.push({ forTurn: due, turn: s.turn, phase: s.phase!, mine: s.activePlayer === seat });
  }
  return { fires, seat };
}

describe('planDue: when auto-coach asks', () => {
  const s = (turn: number, phase: string | null, activePlayer: number) => ({ turn, phase, activePlayer }) as unknown as GameStateBody;
  it("asks for the next turn at the opponent's end step or cleanup", () => {
    expect(planDue(s(6, 'END_OF_TURN', 1), 0, new Set())).toBe(7);
    expect(planDue(s(6, 'CLEANUP', 1), 0, new Set())).toBe(7);
  });
  it("never at the opponent's other steps, nor in my own later steps", () => {
    for (const phase of ['UPKEEP', 'MAIN1', 'COMBAT_DECLARE_ATTACKERS', 'COMBAT_DECLARE_BLOCKERS', 'MAIN2']) expect(planDue(s(6, phase, 1), 0, new Set())).toBeNull();
    for (const phase of ['COMBAT_BEGIN', 'COMBAT_DECLARE_ATTACKERS', 'MAIN2', 'END_OF_TURN', 'CLEANUP']) expect(planDue(s(7, phase, 0), 0, new Set())).toBeNull();
  });
  it('at the start of my own turn when the cycle has no plan yet (a skipped end step; turn 1 on the play)', () => {
    for (const phase of PLAN_STEPS_MINE) expect(planDue(s(1, phase, 0), 0, new Set())).toBe(1);
    expect(planDue(s(7, 'UPKEEP', 0), 0, new Set([7]))).toBeNull();
  });
  it('once per turn, and never before the game starts', () => {
    expect(planDue(s(6, 'END_OF_TURN', 1), 0, new Set([7]))).toBeNull();
    expect(planDue(s(0, null, 0), 0, new Set())).toBeNull();
    expect(planDue(null, 0, new Set())).toBeNull();
    expect(planDue(s(6, 'END_OF_TURN', 1), null, new Set())).toBeNull();
  });
});

describe.each(logs)('auto-coach over a recorded game: %s', (_name, log) => {
  const { fires, seat } = replay(log);
  const all = states(log);
  const myTurns = [...new Set(all.filter((s) => s.phase && s.turn && s.activePlayer === seat).map((s) => s.turn))];
  const theirEnd = new Set(all.filter((s) => s.activePlayer !== seat && s.phase && PLAN_STEPS_THEIRS.has(s.phase)).map((s) => s.turn));

  it('exactly one question per turn cycle: one plan for each of my turns', () => {
    expect(fires.map((f) => f.forTurn)).toEqual(myTurns);
  });

  it("fires at the opponent's end step whenever the board saw it, else at the start of my turn", () => {
    for (const f of fires) {
      if (theirEnd.has(f.forTurn - 1)) {
        expect(f).toMatchObject({ mine: false, turn: f.forTurn - 1 });
        expect(PLAN_STEPS_THEIRS.has(f.phase)).toBe(true);
      } else {
        expect(f).toMatchObject({ mine: true, turn: f.forTurn });
        expect(PLAN_STEPS_MINE.has(f.phase)).toBe(true);
      }
    }
  });

  it('the plan stays on screen through my turn and the opponent’s next turn, until the next cycle replaces it', () => {
    resetAdvice();
    const game = gameKeyOf(log, seat)!;
    const asked = new Set<number>();
    let last: number | null = null;
    for (const s of all) {
      const due = planDue(s, seat, asked);
      if (due !== null) {
        asked.add(due);
        recordAdvice(game, { key: planKey(game, due), kind: 'plan', label: planLabel(due), forTurn: due, decision: fakeDecision(s) });
        last = due;
      }
      const shown = currentPlan(adviceFor(game));
      expect(shown?.forTurn ?? null).toBe(last);
      // During my own turn, the plan on screen is that turn's.
      if (s.phase && s.turn && s.activePlayer === seat) expect(shown?.forTurn).toBe(s.turn);
    }
  });
});

describe('the advice beside the plan', () => {
  beforeEach(() => resetAdvice());
  const st = (turn: number) => ({ turn, phase: 'MAIN1', activePlayer: 0, round: 1 }) as unknown as GameStateBody;

  it('my own question never clears the plan, stays readable once the game moves on, and goes to Earlier advice at the next cycle', () => {
    const g = 'g@1#0';
    recordAdvice(g, { key: planKey(g, 8), kind: 'plan', label: planLabel(8), forTurn: 8, decision: fakeDecision(st(7)) });
    recordAdvice(g, { key: 'ask-blocks', kind: 'ask', label: 'Your blocks, turn 9', forTurn: null, decision: fakeDecision(st(9)) });
    let e = adviceFor(g);
    expect(currentPlan(e)?.label).toBe('Plan for your turn 8');
    expect(lastAsk(e, 'ask-blocks')).toBeNull(); // still the moment on screen: shown there
    expect(lastAsk(e, null)?.key).toBe('ask-blocks'); // the opponent has priority: still shown
    expect(earlierAdvice(e, null)).toEqual([]);
    recordAdvice(g, { key: planKey(g, 10), kind: 'plan', label: planLabel(10), forTurn: 10, decision: fakeDecision(st(9)) });
    e = adviceFor(g);
    expect(currentPlan(e)?.forTurn).toBe(10);
    expect(lastAsk(e, null)).toBeNull();
    expect(earlierAdvice(e, null).map((x) => x.key)).toEqual(['ask-blocks', planKey(g, 8)]);
  });

  it('keeps a bounded history per game', () => {
    const g = 'g@2#0';
    for (let t = 2; t < 60; t += 2) recordAdvice(g, { key: planKey(g, t), kind: 'plan', label: planLabel(t), forTurn: t, decision: fakeDecision(st(t - 1)) });
    expect(adviceFor(g).length).toBe(12);
    expect(currentPlan(adviceFor(g))?.forTurn).toBe(58);
  });

  it('labels say what the advice was for', () => {
    expect(planLabel(8)).toBe('Plan for your turn 8');
    const d = fakeDecision({ turn: 7, phase: 'MAIN1', activePlayer: 0 } as unknown as GameStateBody);
    expect(askLabel(d)).toBe('Your main 1, turn 7');
    expect(askLabel({ ...d, kind: 'block' })).toBe('Your blocks, turn 7');
  });
});
