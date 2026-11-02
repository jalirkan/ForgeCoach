/*
 * ForgeCoach — ambience/makeup.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * makeup.ts, the one rule for what a half's colours show (pc-results
 * scenery/SYSTEM.md A5–A6 as spec 1.19 a and b amend them): the pair showing
 * stays the base while both its colours are among the three heaviest; with
 * none showing, or one of its colours out of the top three, the heaviest pair
 * of the top three; its pan their own two weights; the third is the element;
 * every colour past it is an extra, drawn as a cut-out, weighing nothing in
 * the pair or the pan (the stage still counts every coloured land); ties keep
 * what is showing, then the earlier arrival.
 */
import { describe, expect, it } from 'vitest';
import { elementOpacity, MakeupMemory, makeupOf, pickFromSlots, pickMakeup, pickSplit } from './makeup.ts';
import { SceneryTracker, slotsOf } from './model.ts';
import { SIM_PLAYERS, simLog, type SimLandName } from './sim.ts';

describe('pickMakeup', () => {
  it('one and two colours: no third, the pan by the two weights', () => {
    expect(pickMakeup(makeupOf({ U: 2 }, ['U']))).toMatchObject({ kept: ['U'], pair: null, third: null, heavier: 'U', total: 2 });
    const two = pickMakeup(makeupOf({ W: 1.5, R: 0.5 }, ['R', 'W']));
    expect(two).toMatchObject({ kept: ['W', 'R'], pair: ['R', 'W'], third: null, extras: [] });
    // Pair-key order is mountain+plains: R's share is 0.25.
    expect(pickSplit(two)).toBe(0.25);
  });

  it('1 + 1 + 1 + 1: the first three arrivals kept, the pair the first two at 50/50, the third the element, the fourth an extra weighing nothing in the pair', () => {
    const p = pickMakeup(makeupOf({ W: 1, U: 1, B: 1, R: 1 }, ['W', 'U', 'B', 'R']));
    expect(p.kept).toEqual(['W', 'U', 'B']);
    expect(p.extras).toEqual(['R']);
    expect(p.pair).toEqual(['U', 'W']);
    expect(pickSplit(p)).toBe(0.5);
    expect(p.third).toBe('B');
    expect(p.weights).toEqual({ W: 1, U: 1, B: 1, R: 1 });
    // The stage counts all four lands (SYSTEM.md A5); an equal quarter is fully in (spec 1.19 a: n × the share).
    expect([p.keptTotal, p.total]).toEqual([3, 4]);
    expect([elementOpacity(p, 'B'), elementOpacity(p, 'R')]).toEqual([1, 1]);
  });

  it('four unequal colours: the lightest an extra whatever it arrived, the pan by the pair alone, each faded by its share', () => {
    const p = pickMakeup(makeupOf({ R: 1, W: 3, U: 2, B: 1.5 }, ['R', 'W', 'U', 'B']));
    expect(p.kept).toEqual(['W', 'U', 'B']);
    expect(p.extras).toEqual(['R']);
    expect(p.pair).toEqual(['U', 'W']);
    expect(pickSplit(p)).toBe(0.4);
    expect([p.keptTotal, p.total]).toEqual([6.5, 7.5]);
    // 4 × 1.5 / 7.5 and 4 × 1 / 7.5.
    expect([elementOpacity(p, 'B'), elementOpacity(p, 'R')]).toEqual([0.8, 0.533]);
  });

  it('five colours: three kept, the rest extras heaviest first, a three-way tie for third to the earliest arrival', () => {
    const p = pickMakeup(makeupOf({ G: 1, B: 1, W: 2, U: 2, R: 1 }, ['G', 'B', 'W', 'U', 'R']));
    expect(p.kept).toEqual(['W', 'U', 'G']);
    expect(p.extras).toEqual(['B', 'R']);
    expect(p.heavier).toBe('W');
    const q = pickMakeup(makeupOf({ G: 1, B: 3, W: 4, U: 4, R: 2 }, ['G', 'B', 'W', 'U', 'R']));
    expect([q.third, ...q.extras]).toEqual(['B', 'R', 'G']);
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
  });

  it('spec 1.19 b: the pair showing stays the base while both its colours are among the three heaviest, however heavy the third grows', () => {
    const showing = { kept: ['U', 'B', 'W'] as const, pair: ['B', 'U'] as const };
    // W outweighs both pair colours: before 1.19 the pair re-keyed to island+plains; now W is the third, fully in.
    const p = pickMakeup(makeupOf({ W: 2, U: 1, B: 1 }, ['W', 'U', 'B']), { kept: [...showing.kept], pair: [...showing.pair] });
    expect(p.pair).toEqual(['U', 'B']);
    expect(p.third).toBe('W');
    expect(pickMakeup(makeupOf({ W: 6, U: 1, B: 1, R: 1 }, ['W', 'U', 'B', 'R']), { kept: ['U', 'B', 'W'], pair: ['B', 'U'] })).toMatchObject({ pair: ['U', 'B'], third: 'W', extras: ['R'] });
    // Two colours outweigh a pair colour: still among the three heaviest, the pair stays.
    expect(pickMakeup(makeupOf({ W: 3, U: 2, B: 2, R: 3 }, ['U', 'B', 'W', 'R']), { kept: ['U', 'B', 'W'], pair: ['B', 'U'] }).pair).toEqual(['U', 'B']);
    // Three outweigh the swamp: it has left the top three, so the heaviest pair of the top three (W, R, U).
    const re = pickMakeup(makeupOf({ W: 3, U: 2, B: 1, R: 3, G: 2 }, ['U', 'B', 'W', 'R', 'G']), { kept: ['U', 'B', 'W'], pair: ['B', 'U'] });
    expect(re.pair).toEqual(['R', 'W']);
    expect([re.third, ...re.extras]).toEqual(['U', 'G', 'B']);
    // A tie at the edge of the top three is not leaving it: U2 B2 R2 G2 with W3 keeps island+swamp.
    expect(pickMakeup(makeupOf({ W: 3, U: 2, B: 2, R: 2, G: 2 }, ['U', 'B', 'R', 'G', 'W']), { kept: ['U', 'B', 'R'], pair: ['B', 'U'] }).pair).toEqual(['U', 'B']);
    // A colour of the pair gone (a land left): the heaviest pair of what is there.
    expect(pickMakeup(makeupOf({ W: 1, U: 1 }, ['W', 'U']), { kept: ['U', 'B', 'W'], pair: ['B', 'U'] }).pair).toEqual(['U', 'W']);
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
  // Island, Swamp (U B), Plains ×3, Mountain ×3: W3 and R3 outweigh both, but two colours are not three -- island and
  // swamp stay among the three heaviest, so island+swamp stays the base (spec 1.19 b).
  const g = log(['Island', 'Swamp', 'Plains', 'Plains', 'Plains', 'Mountain', 'Mountain', 'Mountain']);
  const last = g.frames.length - 1;
  const follow = () => {
    const memory = new MakeupMemory();
    const tracker = new SceneryTracker();
    tracker.observe(memory);
    return { memory, tracker };
  };

  it('the pair showing stays the base (island+swamp), where no memory would pick the heaviest pair (plains+mountain)', () => {
    const { memory, tracker } = follow();
    const sc = tracker.at(g, last);
    expect([...memory.showing(P)!.pair!].sort()).toEqual(['B', 'U']);
    expect([...pickFromSlots(slotsOf(sc, P), null).pair!].sort()).toEqual(['R', 'W']);
  });

  it('is the same whether the board stepped there frame by frame, jumped there, or scrubbed back there', () => {
    const stepped = follow();
    for (let i = 0; i <= last; i++) stepped.tracker.at(g, i);
    const jumped = follow();
    jumped.tracker.at(g, last);
    expect(stepped.memory.showing(P)).toEqual(jumped.memory.showing(P));
    // Scrub back to the frame after Island, Swamp, Plains: the memory is that frame's, not the end's.
    stepped.tracker.at(g, 3);
    const fresh = follow();
    fresh.tracker.at(g, 3);
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
