/*
 * ForgeCoach — cube/generate.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { apportion, generateCube, OMEGA_CURVE, skeleton } from './generate.ts';
import { bucketOf, isBasic, mvBin } from './library.ts';
import { loadShippedLibrary } from './testdata/load.ts';

const LIB = loadShippedLibrary();

describe('apportion and the skeleton', () => {
  it('splits exactly, largest remainders first', () => {
    expect(apportion(158, OMEGA_CURVE)).toEqual(OMEGA_CURVE);
    expect(apportion(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(apportion(0, [1, 2])).toEqual([0, 0]);
    for (const n of [9, 45, 179, 181, 360, 541]) expect(apportion(n, OMEGA_CURVE).reduce((a, b) => a + b, 0)).toBe(n);
  });
  it('is Omega’s at 180 and twice it at 360', () => {
    expect(skeleton(180)).toEqual({ mono: [24, 24, 24, 24, 24], gold: 20, colorless: 18, lands: 22, pairLands: 2 });
    expect(skeleton(360)).toEqual({ mono: [48, 48, 48, 48, 48], gold: 40, colorless: 36, lands: 44, pairLands: 4 });
  });
});

describe('generateCube', () => {
  it('is a pure function of its options: the same seed, the same cube; another seed, another', () => {
    const a = generateCube(LIB, { size: 180, seed: 42, rating: 'lab' });
    const b = generateCube(LIB, { size: 180, seed: 42, rating: 'lab' });
    expect(b).toEqual(a);
    const c = generateCube(LIB, { size: 180, seed: 43, rating: 'lab' });
    expect(c.cards).not.toEqual(a.cards);
    const r1 = generateCube(LIB, { size: 180, seed: 42, rating: 'none' });
    const r2 = generateCube(LIB, { size: 180, seed: 9, rating: 'none' });
    expect(new Set(r1.cards).size).toBe(180);
    expect([...r1.cards].sort()).not.toEqual([...r2.cards].sort());
  });

  it('fills the skeleton exactly at 180: 24 a colour, 20 gold (2 a pair), 18 colourless, 22 lands (2 fixing a pair)', () => {
    const g = generateCube(LIB, { size: 180, seed: 1, rating: 'lab' });
    expect(g.cards.length).toBe(180);
    expect(g.notes).toEqual([]);
    const cards = g.cards.map((n) => LIB.byName.get(n)!);
    const count = (b: string) => cards.filter((c) => bucketOf(c) === b).length;
    for (const c of 'WUBRG') expect(count(c)).toBe(24);
    expect(count('gold')).toBe(20);
    expect(count('colorless')).toBe(18);
    expect(count('land')).toBe(22);
    for (const p of ['WU', 'UB', 'BR', 'RG', 'WG', 'WB', 'UR', 'BG', 'WR', 'UG']) {
      expect(cards.filter((c) => bucketOf(c) === 'gold' && c.colors === p).length).toBe(2);
      expect(cards.filter((c) => bucketOf(c) === 'land' && c.produces === p).length).toBeGreaterThanOrEqual(2);
    }
    // Each colour on Omega's curve.
    const white = cards.filter((c) => bucketOf(c) === 'W');
    const curve = [0, 0, 0, 0, 0, 0, 0, 0];
    for (const c of white) curve[mvBin(c.mv)]!++;
    expect(curve).toEqual(apportion(24, OMEGA_CURVE));
  });

  it('leaves out what Forge lacks, what nobody vouched for, the bot’s bad cards and the basics — unless asked', () => {
    const g = generateCube(LIB, { size: 360, seed: 5, rating: 'none' });
    const cards = g.cards.map((n) => LIB.byName.get(n)!);
    expect(cards.some((c) => c.forge !== undefined)).toBe(false);
    expect(cards.some((c) => c.ai === 'All')).toBe(false);
    expect(cards.some(isBasic)).toBe(false);
    const loose = generateCube(LIB, { size: 1000, seed: 5, rating: 'none', forgeOnly: false, avoidAiBad: false });
    expect(loose.cards.some((n) => LIB.byName.get(n)!.forge === false)).toBe(true);
  });

  it('prefers the cards the lab rates higher', () => {
    const avg = (names: string[]) => {
      const rated = names.map((n) => LIB.byName.get(n)!.lab).filter((l) => !!l);
      return rated.reduce((a, l) => a + l!.winRate, 0) / rated.length;
    };
    const lab = generateCube(LIB, { size: 180, seed: 3, rating: 'lab' });
    const none = generateCube(LIB, { size: 180, seed: 3, rating: 'none' });
    expect(avg(lab.cards)).toBeGreaterThan(avg(none.cards) + 0.02);
  });

  it('draws from one source when asked, and says when it ran short', () => {
    const g = generateCube(LIB, { size: 180, seed: 2, rating: 'lab', sources: ['old-school'] });
    expect(g.cards.every((n) => LIB.byName.get(n)!.sources.includes('old-school'))).toBe(true);
    const small = generateCube(LIB, { size: 360, seed: 2, rating: 'lab', sources: ['pauper'] });
    expect(small.cards.length).toBeLessThan(360);
    expect(small.notes.join(' ')).toMatch(/Only \d+ cards fit/);
  });
});
