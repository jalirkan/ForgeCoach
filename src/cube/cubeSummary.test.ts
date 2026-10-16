/*
 * ForgeCoach — cube/cubeSummary.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { summarizeCube } from './cubeSummary.ts';
import { generateCube } from './generate.ts';
import { loadCube, loadShippedLibrary } from './testdata/load.ts';

const LIB = loadShippedLibrary();
const kinds = (names: string[], target: number | null = null) => summarizeCube(names, LIB, target).warnings.map((w) => w.kind);

describe('summarizeCube', () => {
  it('counts a balanced 180: colours, curve, types, gold and lands, with no warnings worth fixing', () => {
    const g = generateCube(LIB, { size: 180, seed: 11, rating: 'lab' });
    const s = summarizeCube(g.cards, LIB, 180);
    expect(s.count).toBe(180);
    expect(s.buckets).toMatchObject({ W: 24, U: 24, B: 24, R: 24, G: 24, gold: 20, colorless: 18, land: 22 });
    expect(s.lands).toBe(22);
    expect(s.multicolour).toBe(20);
    expect(s.fixing).toBeGreaterThanOrEqual(20);
    expect(s.curve.reduce((a, b) => a + b, 0)).toBe(158);
    expect(s.perColour.W).toBe(24 + 8);
    expect(Object.values(s.kinds).reduce((a, b) => a + b, 0)).toBe(180);
    expect(s.rated).toBeGreaterThan(100);
    expect(s.warnings.filter((w) => w.level !== 'note')).toEqual([]);
  });

  it('warns of Forge’s missing cards (stop), unknown ones, the bot’s bad cards, repeats and strangers', () => {
    const names = ['Twinned Vision', 'Kavaero, Mind-Bitten', 'Goblin Bombardment', 'Micromancer', 'Lightning Bolt', 'Lightning Bolt', 'Not A Card'];
    const s = summarizeCube(names, LIB);
    const by = Object.fromEntries(s.warnings.map((w) => [w.kind, w]));
    expect(by.forge).toMatchObject({ level: 'stop', cards: ['Twinned Vision'] });
    expect(by['forge-unknown']?.cards).toEqual(['Kavaero, Mind-Bitten']);
    expect(by['ai-all']?.cards).toEqual(['Goblin Bombardment']);
    expect(by['ai-random']).toMatchObject({ level: 'note', cards: ['Micromancer'] });
    expect(by.duplicate?.cards).toEqual(['Lightning Bolt']);
    expect(by.unknown?.cards).toEqual(['Not A Card']);
    expect(s.count).toBe(6);
  });

  it('says how far from the size aimed at, and what a short cube deals', () => {
    const g = generateCube(LIB, { size: 170, seed: 1, rating: 'lab' });
    const s = summarizeCube(g.cards, LIB, 180);
    expect(s.warnings.find((w) => w.kind === 'size')?.text).toBe('170 of 180: 10 to go.');
    expect(s.warnings.find((w) => w.kind === 'deal')).toBeUndefined();
    expect(summarizeCube(g.cards.slice(0, 150), LIB).warnings.find((w) => w.kind === 'deal')).toMatchObject({ level: 'note', text: 'A Grid draft deals 16 grids of 9 instead of 18.' });
    const tiny = summarizeCube(g.cards.slice(0, 45), LIB);
    expect(tiny.warnings.find((w) => w.kind === 'deal')?.text).toBe('A Grid draft deals 5 grids of 9 instead of 18; a Winston draft deals 45 cards instead of 90.');
    expect(kinds(g.cards, 170)).not.toContain('size');
  });

  it('finds the colours a Grid draft leaves short of playables', () => {
    const ok = (c: { forge?: unknown }) => c.forge === undefined;
    const of = (col: string, n: number) => LIB.cards.filter((c) => c.colors === col && ok(c)).slice(0, n).map((c) => c.name);
    const lands = LIB.cards.filter((c) => c.type.startsWith('Land') && ok(c)).slice(0, 20).map((c) => c.name);
    // Red deep, the rest thin: every colour's best pair is with red, and deals enough; the balance note names the thin ones.
    const s = summarizeCube([...of('R', 50), ...of('W', 6), ...of('U', 6), ...of('B', 6), ...of('G', 6), ...lands], LIB);
    expect(s.warnings.find((x) => x.kind === 'colour')).toBeUndefined();
    expect(s.warnings.find((x) => x.kind === 'balance')?.text).toBe('Fewer white, blue, black, green cards than the other colours (6, 6, 6, 6 against an average of 15).');
    // Every colour thin: even the best pair deals too few for two drafters.
    const thin = summarizeCube([...of('R', 12), ...of('W', 12), ...of('U', 12), ...of('B', 12), ...of('G', 12), ...lands], LIB);
    expect(thin.warnings.find((x) => x.kind === 'colour')?.text).toBe(
      'Short for a Grid draft: white 21, blue 21, black 21, red 21, green 21 — the playables a Grid draft deals in each colour’s best pair. Two drafters want about 46 there: 23 each for a two-colour deck.',
    );
    // A shipped cube is not short anywhere.
    const synergy = loadCube('synergy').cards.map((c) => c.name);
    expect(kinds(synergy)).not.toContain('colour');
  });
});
