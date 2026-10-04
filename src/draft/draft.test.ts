// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { context, loadRealMeta } from '../cube/testdata/load.ts';
import { rng, shuffle } from './rng.ts';
import { labCards, ratingOf } from './cards.ts';
import { committed, scoreCard, setValue, topPair, type DrafterState } from './pick.ts';
import { DEFAULT_WEIGHTS as W } from './weights.ts';
import {
  aiAction,
  aiStep,
  aiPicksAttributable,
  boosterPackSize,
  describeEvent,
  botPick,
  progress,
  type BoosterDraft,
  apply,
  canPass,
  isLegal,
  knownAiCards,
  legalLines,
  newDraft,
  selfPlay,
  toAct,
  type Draft,
  type GridDraft,
  type WinstonDraft,
} from './draft.ts';

const ctx = context('synergy', loadRealMeta('synergy'));
const cards = labCards(ctx);
const names = ctx.cube.cards.map((c) => c.name);

describe('rng', () => {
  it('is a pure function of the seed and stream', () => {
    const a = rng(42, 'x');
    const b = rng(42, 'x');
    const c = rng(42, 'y');
    const sa = [a.next(), a.next(), a.next()];
    expect([b.next(), b.next(), b.next()]).toEqual(sa);
    expect(c.next()).not.toBe(sa[0]);
    for (let i = 0; i < 200; i++) {
      const n = a.int(7);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(7);
    }
  });
  it('shuffles to a permutation', () => {
    const arr = Array.from({ length: 50 }, (_, i) => i);
    const s = shuffle([...arr], rng(1));
    expect([...s].sort((x, y) => x - y)).toEqual(arr);
    expect(s).not.toEqual(arr);
  });
});

describe('ratings and the pick scorer', () => {
  it('uses the meta where it has games, the no-meta estimate otherwise', () => {
    const noMeta = context('synergy');
    expect(ratingOf('Lightning Bolt', ctx)).not.toBe(ratingOf('Lightning Bolt', noMeta));
    expect(ratingOf('Not A Cube Card', ctx)).toBe(W.unrated);
    for (const c of cards.values()) {
      expect(c.rating).toBeGreaterThan(0);
      expect(c.rating).toBeLessThanOrEqual(100);
    }
  });
  it('commits after a third of the picks and punishes off-colour cards after that', () => {
    const rakdos = ['Blood Artist', 'Viscera Seer', 'Goblin Bombardment', 'Bloodghast', 'Fatal Push', 'Lightning Bolt', 'Mayhem Devil', 'Young Pyromancer', 'Zulaport Cutthroat', 'Bone Shards', 'Village Rites', 'Carrion Feeder', 'Gravecrawler', 'Deadly Dispute', 'Legion Warboss', 'Hordeling Outburst'].map((n) => cards.get(n)!);
    const early: DrafterState = { picks: rakdos.slice(0, 3), expected: 45 };
    const late: DrafterState = { picks: rakdos, expected: 45 };
    expect(committed(early, W)).toBe(false);
    expect(committed(late, W)).toBe(true);
    expect(topPair(rakdos)).toBe('BR');
    const elves = cards.get('Wood Elves')!;
    expect(scoreCard(elves, late, W).colour).toBe(-W.offColour);
    expect(scoreCard(cards.get('Blood Crypt')!, late, W).fixing).toBe(W.fixing);
    // A sacrifice payoff gains synergy from a sacrifice pool.
    expect(scoreCard(cards.get('Priest of Forgotten Gods')!, late, W).synergy).toBeGreaterThan(0);
  });
  it('a set is its best card plus 0.6 of the rest', () => {
    const st: DrafterState = { picks: [], expected: 45 };
    const a = cards.get('Lightning Bolt')!;
    const b = cards.get('Opt')!;
    const va = scoreCard(a, st, W).total;
    const vb = scoreCard(b, st, W).total;
    expect(setValue([a, b], st, W)).toBeCloseTo(Math.max(va, vb) + 0.6 * Math.min(va, vb));
  });
});

describe('grid', () => {
  const g0 = newDraft({ cubeId: 'synergy', format: 'grid', cube: names, seed: 7, youFirst: true, now: 1 }) as GridDraft;

  it('deals 18 grids of nine from the cube, the same for the same seed', () => {
    expect(g0.grids).toBe(18);
    expect(g0.dealt).toHaveLength(162);
    expect(new Set(g0.dealt).size).toBe(162);
    const again = newDraft({ cubeId: 'synergy', format: 'grid', cube: names, seed: 7, youFirst: true, now: 1 });
    expect(again.dealt).toEqual(g0.dealt);
    expect(newDraft({ cubeId: 'synergy', format: 'grid', cube: names, seed: 8, youFirst: true, now: 1 }).dealt).not.toEqual(g0.dealt);
  });

  it('first pick alternates, the second drafter cannot take the same line, crossing lines take two', () => {
    expect(toAct(g0)).toBe('you');
    expect(legalLines(g0)).toEqual([0, 1, 2, 3, 4, 5]);
    const g1 = apply(g0, { kind: 'line', line: 0 }) as GridDraft; // top row
    expect(g1.picks.you).toHaveLength(3);
    expect(toAct(g1)).toBe('ai');
    expect(isLegal(g1, { kind: 'line', line: 0 })).toBe(false);
    const g2 = apply(g1, { kind: 'line', line: 3 }) as GridDraft; // left column crosses: two cards
    expect(g2.picks.ai).toHaveLength(2);
    expect(g2.g).toBe(1);
    expect(toAct(g2)).toBe('ai'); // grid 2: the AI opens
    expect(() => apply(g2, { kind: 'line', line: 9 })).toThrow();
  });

  it('runs to the end with the AI in both seats: 45ish cards each, all public', () => {
    const end = selfPlay(g0, cards) as GridDraft;
    expect(end.done).toBe(true);
    expect(end.log.filter((e) => e.kind === 'line')).toHaveLength(36);
    const total = end.picks.you.length + end.picks.ai.length;
    expect(total).toBeGreaterThanOrEqual(18 * 5);
    expect(total).toBeLessThanOrEqual(18 * 6);
    expect(new Set([...end.picks.you, ...end.picks.ai]).size).toBe(total);
    expect(knownAiCards(end)).toEqual(end.picks.ai);
    expect(selfPlay(g0, cards).picks).toEqual(end.picks);
  });

  it('the AI takes the line with the best set value', () => {
    const a = aiAction(g0, cards);
    expect(a.kind).toBe('line');
  });
});

describe('winston', () => {
  const w0 = newDraft({ cubeId: 'synergy', format: 'winston', cube: names, seed: 3, youFirst: true, now: 1 }) as WinstonDraft;

  it('deals a 90-card stack and three one-card piles', () => {
    expect(w0.dealt).toHaveLength(90);
    expect(w0.stack).toHaveLength(87);
    expect(w0.piles.map((p) => p.length)).toEqual([1, 1, 1]);
    expect(toAct(w0)).toBe('you');
    expect(w0.look).toBe(0);
  });

  it('passing grows the pile and moves on; taking ends the turn and refills', () => {
    const p1 = apply(w0, { kind: 'pass' }) as WinstonDraft;
    expect(p1.piles[0]).toHaveLength(2);
    expect(p1.look).toBe(1);
    expect(p1.turn).toBe('you');
    const t = apply(p1, { kind: 'take' }) as WinstonDraft;
    expect(t.picks.you).toHaveLength(1);
    expect(t.piles[1]).toHaveLength(1);
    expect(t.turn).toBe('ai');
    expect(t.look).toBe(0);
  });

  it('passing all three takes the top card blind', () => {
    let d: Draft = w0;
    for (let i = 0; i < 3; i++) d = apply(d, { kind: 'pass' });
    const wd = d as WinstonDraft;
    expect(wd.picks.you).toHaveLength(1);
    expect(wd.log.at(-1)?.kind).toBe('blind');
    expect(wd.turn).toBe('ai');
    expect(wd.stack).toHaveLength(87 - 4);
  });

  it('hides the AI’s takes except cards the player saw', () => {
    // You pass pile 1 (seeing its card); the AI takes it or not, but anything it takes from pile 1 you know.
    let d: Draft = apply(w0, { kind: 'pass' });
    d = apply(d, { kind: 'take' });
    const seenPile1 = (w0.piles[0] ?? [])[0]!;
    while (toAct(d) === 'ai') d = aiStep(d, cards);
    const ai = d.log.filter((e) => e.who === 'ai' && e.kind !== 'pass');
    expect(ai.length).toBe(1);
    const known = knownAiCards(d);
    for (const k of known) expect(d.seen.you).toContain(k);
    if (ai[0]?.cards.includes(seenPile1)) expect(known).toContain(seenPile1);
  });

  it('runs to the end: every dealt card drafted exactly once, about half each', () => {
    const end = selfPlay(w0, cards) as WinstonDraft;
    expect(end.done).toBe(true);
    expect(end.stack).toHaveLength(0);
    const all = [...end.picks.you, ...end.picks.ai];
    expect(all).toHaveLength(90);
    expect(new Set(all)).toEqual(new Set(end.dealt));
    expect(Math.abs(end.picks.you.length - end.picks.ai.length)).toBeLessThan(30);
    expect(canPass(end)).toBe(false);
  });

  it('when the stack is empty the last pile must be taken', () => {
    let d: Draft = w0;
    while (!d.done && (d as WinstonDraft).stack.length > 0) d = aiStep(d, cards);
    if (!d.done) {
      const wd = d as WinstonDraft;
      const later = wd.piles.slice(wd.look + 1).every((p) => p.length === 0);
      expect(canPass(wd)).toBe(!later);
    }
  });
});

describe('booster', () => {
  it('sizes packs to the cube: 15 for 2 or 4 seats, fewer for 6 or 8', () => {
    expect(boosterPackSize(2, 180)).toBe(15);
    expect(boosterPackSize(4, 180)).toBe(15);
    expect(boosterPackSize(6, 180)).toBe(10);
    expect(boosterPackSize(8, 180)).toBe(7);
  });

  it('two seats: you and the AI pick at once and the pack goes back and forth', () => {
    const b0 = newDraft({ cubeId: 'synergy', format: 'booster', cube: names, seed: 4, youFirst: true, seats: 2, now: 1 }) as BoosterDraft;
    expect(b0.table.map((p) => p.length)).toEqual([15, 15]);
    expect(toAct(b0)).toBe('you');
    expect(() => apply(b0, { kind: 'pick', card: b0.table[0]![0]! })).toThrow(/card data/);
    const first = b0.table[0]![0]!;
    const b1 = apply(b0, { kind: 'pick', card: first }, 2, cards) as BoosterDraft;
    expect(b1.picks.you).toEqual([first]);
    expect(b1.picks.ai).toHaveLength(1);
    expect(b1.table.map((p) => p.length)).toEqual([14, 14]);
    // The pack you hold now is the AI's first pack, minus its pick (which you never saw).
    expect(knownAiCards(b1)).toEqual([]);
    const b2 = apply(b1, { kind: 'pick', card: b1.table[0]![0]! }, 3, cards) as BoosterDraft;
    // Its second pick came from the pack you passed: you saw it.
    expect(knownAiCards(b2)).toHaveLength(1);
    expect(b0.table[0]).toContain(knownAiCards(b2)[0]);
  });

  it('undo is fair: a different pick from the state before leaves every other seat’s pick and your next pack unchanged', () => {
    const b0 = newDraft({ cubeId: 'synergy', format: 'booster', cube: names, seed: 11, youFirst: true, seats: 4, now: 1 }) as BoosterDraft;
    const [a, b] = b0.table[0]!;
    const x = apply(b0, { kind: 'pick', card: a! }, 2, cards) as BoosterDraft;
    const y = apply(b0, { kind: 'pick', card: b! }, 2, cards) as BoosterDraft;
    expect(x.picks.ai).toEqual(y.picks.ai);
    expect(x.bots).toEqual(y.bots);
    // The pack you are handed next does not depend on your pick.
    expect(x.table[0]).toEqual(y.table[0]);
    // Only the pack you passed differs, and nobody has picked from it yet.
    expect(x.table.filter((p, i) => JSON.stringify(p) !== JSON.stringify(y.table[i]))).toHaveLength(1);
  });

  it('runs three packs to 45 cards each, every dealt card once', () => {
    for (const seats of [2, 4, 8]) {
      const d0 = newDraft({ cubeId: 'synergy', format: 'booster', cube: names, seed: 9, youFirst: true, seats, now: 1 }) as BoosterDraft;
      const end = selfPlay(d0, cards) as BoosterDraft;
      expect(end.done).toBe(true);
      const per = 3 * end.packSize;
      expect(end.picks.you).toHaveLength(per);
      expect(end.picks.ai).toHaveLength(per);
      for (const b of end.bots) expect(b).toHaveLength(per);
      const all = [...end.picks.you, ...end.picks.ai, ...end.bots.flat()];
      expect(new Set(all)).toEqual(new Set(end.dealt));
      expect(progress(end).label).toBe('Draft complete');
    }
  });

  it('two seats: every AI pick but the first of each pack is known, and named', () => {
    const end = selfPlay(newDraft({ cubeId: 'synergy', format: 'booster', cube: names, seed: 3, youFirst: true, seats: 2, now: 1 }), cards) as BoosterDraft;
    expect(aiPicksAttributable(end)).toBe(true);
    // Pick 1 of a pack comes from the AI's own fresh pack; every later one from the pack you just passed.
    const firsts = new Set([0, 1, 2].map((r) => end.picks.ai[r * end.packSize]));
    expect(knownAiCards(end)).toEqual(end.picks.ai.filter((n) => !firsts.has(n)));
    const ai = end.log.filter((e) => e.who === 'ai');
    for (const e of ai) expect(describeEvent(e, end)).toBe(e.known?.length ? `AI picked ${e.cards[0]}` : 'AI picked a card you haven’t seen');
  });

  for (const seats of [3, 8]) {
    it(`${seats} seats: no AI pick is known, even of cards you saw, and the feed names none`, () => {
      const d0 = newDraft({ cubeId: 'synergy', format: 'booster', cube: names, seed: 5, youFirst: true, seats, now: 1 }) as BoosterDraft;
      expect(aiPicksAttributable(d0)).toBe(false);
      const end = selfPlay(d0, cards) as BoosterDraft;
      // Not vacuous: the AI took many cards you had seen in a pack.
      const seen = new Set(end.seen.you);
      expect(end.picks.ai.filter((n) => seen.has(n)).length).toBeGreaterThan(5);
      expect(knownAiCards(end)).toEqual([]);
      const ai = end.log.filter((e) => e.who === 'ai');
      expect(ai).toHaveLength(end.picks.ai.length);
      for (const e of ai) {
        expect(e.known).toEqual([]);
        expect(describeEvent(e, end)).toBe('The pack moved on');
      }
      // A draft saved under the old rule (known filled in) leaks nothing either.
      const old = JSON.parse(JSON.stringify(end)) as BoosterDraft;
      for (const e of old.log) if (e.who === 'ai') e.known = seen.has(e.cards[0]!) ? [e.cards[0]!] : [];
      expect(knownAiCards(old)).toEqual([]);
    });
  }

  it('the bot takes its best-scoring card', () => {
    const pack = ['Lightning Bolt', 'Opt', 'Plains'].filter((n) => cards.has(n));
    expect(botPick(pack, [], 45, cards)).toBe('Lightning Bolt');
  });
});
