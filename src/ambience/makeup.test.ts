/*
 * ForgeCoach — ambience/makeup.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * makeup.ts, the one rule for what a half's colours show (pc-results
 * scenery/SYSTEM.md A5–A6): four or five colours keep the three heaviest by
 * their own weights, the rest show nothing and weigh nothing (the stage still
 * counts every coloured land); the pair is the
 * two heaviest kept, its pan their own two weights; the third is the element;
 * ties keep what is showing, then the earlier arrival.
 */
import { describe, expect, it } from 'vitest';
import { MakeupMemory, makeupOf, pickFromSlots, pickMakeup, pickSplit } from './makeup.ts';
import { SceneryTracker, slotsOf } from './model.ts';
import { SIM_PLAYERS, simLog, type SimLandName } from './sim.ts';

describe('pickMakeup', () => {
  it('one and two colours: no third, the pan by the two weights', () => {
    expect(pickMakeup(makeupOf({ U: 2 }, ['U']))).toMatchObject({ kept: ['U'], pair: null, third: null, heavier: 'U', total: 2 });
    const two = pickMakeup(makeupOf({ W: 1.5, R: 0.5 }, ['R', 'W']));
    expect(two).toMatchObject({ kept: ['W', 'R'], pair: ['R', 'W'], third: null, dropped: [] });
    // Pair-key order is mountain+plains: R's share is 0.25.
    expect(pickSplit(two)).toBe(0.25);
  });

  it('1 + 1 + 1 + 1: the first three arrivals kept, the pair the first two at 50/50, the third the element, the fourth weighing nothing', () => {
    const p = pickMakeup(makeupOf({ W: 1, U: 1, B: 1, R: 1 }, ['W', 'U', 'B', 'R']));
    expect(p.kept).toEqual(['W', 'U', 'B']);
    expect(p.dropped).toEqual(['R']);
    expect(p.pair).toEqual(['U', 'W']);
    expect(pickSplit(p)).toBe(0.5);
    expect(p.third).toBe('B');
    expect(p.weights).toEqual({ W: 1, U: 1, B: 1 });
    // The element's share is of the three kept; the stage counts all four lands (SYSTEM.md A5).
    expect([p.keptTotal, p.total]).toEqual([3, 4]);
  });

  it('four unequal colours: the lightest dropped whatever it arrived, the pan by the pair alone', () => {
    const p = pickMakeup(makeupOf({ R: 1, W: 3, U: 2, B: 1.5 }, ['R', 'W', 'U', 'B']));
    expect(p.kept).toEqual(['W', 'U', 'B']);
    expect(p.dropped).toEqual(['R']);
    expect(p.pair).toEqual(['U', 'W']);
    expect(pickSplit(p)).toBe(0.4);
    expect([p.keptTotal, p.total]).toEqual([6.5, 7.5]);
  });

  it('five colours: three kept, a three-way tie for third to the earliest arrival', () => {
    const p = pickMakeup(makeupOf({ G: 1, B: 1, W: 2, U: 2, R: 1 }, ['G', 'B', 'W', 'U', 'R']));
    expect(p.kept).toEqual(['W', 'U', 'G']);
    expect(p.dropped).toEqual(['B', 'R']);
    expect(p.heavier).toBe('W');
  });

  it('a tie for the third place keeps the colour already showing', () => {
    const m = makeupOf({ W: 2, U: 2, B: 1, R: 1 }, ['W', 'U', 'B', 'R']);
    expect(pickMakeup(m).third).toBe('B');
    expect(pickMakeup(m, { kept: ['W', 'U', 'R'], pair: ['U', 'W'] }).third).toBe('R');
  });

  it('a tie for the pair keeps the pair already showing, else the earlier arrivals', () => {
    const m = makeupOf({ W: 1, U: 1, B: 1 }, ['W', 'U', 'B']);
    expect(pickMakeup(m).pair).toEqual(['U', 'W']);
    const kept = pickMakeup(m, { kept: ['U', 'B', 'W'], pair: ['B', 'U'] });
    expect(kept.pair).toEqual(['U', 'B']);
    expect(kept.third).toBe('W');
    // Weight still wins over what is showing.
    expect(pickMakeup(makeupOf({ W: 2, U: 1, B: 1 }, ['W', 'U', 'B']), { kept: ['U', 'B', 'W'], pair: ['B', 'U'] }).pair).toEqual(['U', 'W']);
  });

  it('is idempotent: a pick handed back as what is showing gives itself (SceneryLayer re-renders)', () => {
    const m = makeupOf({ W: 1, U: 1, B: 1, R: 1, G: 1 }, ['G', 'R', 'B', 'U', 'W']);
    const once = pickMakeup(m, { kept: ['W', 'U', 'B'], pair: ['U', 'W'] });
    expect(pickMakeup(m, once)).toEqual(once);
  });
});

/**
 * The review of #198, LOW 4: the previous pick SceneryLayer remembered was the last one it RENDERED, so a replay scrub
 * or a New Game could leave a stale tie-breaker. MakeupMemory folds the picks over the log's own state frames instead.
 */
describe('MakeupMemory: what each half showed, from the frames', () => {
  const P = SIM_PLAYERS[0];
  const log = (lands: SimLandName[]) => simLog(lands.map((name) => ({ kind: 'land' as const, player: P, name })));
  // Island, Plains (U W), Swamp ×2 (B leads; U keeps second on arrival), Island (B U), Plains: a three-way 2 : 2 : 2 tie.
  const g = log(['Island', 'Plains', 'Swamp', 'Swamp', 'Island', 'Plains']);
  const last = g.frames.length - 1;
  const follow = () => {
    const memory = new MakeupMemory();
    const tracker = new SceneryTracker();
    tracker.observe(memory);
    return { memory, tracker };
  };

  it('the tie keeps the pair showing (island+swamp), where no memory would pick the first arrivals (island+plains)', () => {
    const { memory, tracker } = follow();
    const sc = tracker.at(g, last);
    expect([...memory.showing(P)!.pair!].sort()).toEqual(['B', 'U']);
    expect([...pickFromSlots(slotsOf(sc, P), null).pair!].sort()).toEqual(['U', 'W']);
  });

  it('is the same whether the board stepped there frame by frame, jumped there, or scrubbed back there', () => {
    const stepped = follow();
    for (let i = 0; i <= last; i++) stepped.tracker.at(g, i);
    const jumped = follow();
    jumped.tracker.at(g, last);
    expect(stepped.memory.showing(P)).toEqual(jumped.memory.showing(P));
    // Scrub back to the frame after Island, Plains, Swamp, Swamp: the memory is that frame's, not the end's.
    stepped.tracker.at(g, 4);
    const fresh = follow();
    fresh.tracker.at(g, 4);
    expect(stepped.memory.showing(P)).toEqual(fresh.memory.showing(P));
    expect([...stepped.memory.showing(P)!.pair!].sort()).toEqual(['B', 'U']);
  });

  it('starts empty on a new log (Reset, New Game), and forgets a half with no coloured land', () => {
    const { memory, tracker } = follow();
    tracker.at(g, last);
    expect(memory.showing(P)).not.toBeNull();
    const next = log(['Plains']);
    tracker.at(next, 0);
    expect(memory.showing(P)).toBeNull();
    tracker.at(next, 1);
    expect(memory.showing(P)!.kept).toEqual(['W']);
  });
});
