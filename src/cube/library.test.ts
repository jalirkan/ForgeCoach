/*
 * ForgeCoach — cube/library.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SHIPPED_CUBES } from './cubes.ts';
import { browse, bucketOf, isBasic, kindOf, libraryName, loadLibrary, LIBRARY_LISTS, matchesFilter, parseLibrary, type Library } from './library.ts';
import { loadCube, loadRealMeta, loadShippedLibrary, type CubeId } from './testdata/load.ts';

const raw = JSON.parse(readFileSync(new URL('../../public/cubes/library.json', import.meta.url), 'utf8')) as unknown;
const LIB: Library = loadShippedLibrary();

describe('the shipped library (scripts/library/build.ts)', () => {
  it('is the union of the cube documents and the two proxy lists, one row a card', () => {
    const names = new Set<string>();
    for (const c of SHIPPED_CUBES) for (const card of loadCube(c.id as CubeId).cards) names.add(card.name);
    for (const l of LIBRARY_LISTS) {
      for (const line of readFileSync(new URL(`../../docs/proxies/${l.file}.txt`, import.meta.url), 'utf8').split('\n')) {
        const m = /^\d+\s+(.+?)\s*$/.exec(line);
        if (m?.[1]) names.add(m[1]);
      }
    }
    expect(LIB.dropped).toBe(0);
    expect(LIB.cards.length).toBe(names.size);
    expect(LIB.cards.length).toBe(1592);
    expect(new Set(LIB.cards.map((c) => c.name))).toEqual(names);
    expect(LIB.sources.map((s) => s.id)).toEqual([...SHIPPED_CUBES.map((c) => c.id), ...LIBRARY_LISTS.map((l) => l.id)]);
    expect(LIB.cards.filter((c) => c.noFacts)).toEqual([]);
  });

  it('records where each card comes from', () => {
    for (const c of SHIPPED_CUBES) for (const card of loadCube(c.id as CubeId).cards) expect(LIB.byName.get(card.name)?.sources).toContain(c.id);
    expect(LIB.byName.get('Abrade')?.sources).toEqual(['peasant', 'evybaby', 'mtgo-vintage']);
  });

  it('marks every card a document lists under "Not in Forge" — they never pass as supported', () => {
    for (const c of SHIPPED_CUBES) for (const n of loadCube(c.id as CubeId).forgeMissing ?? []) expect(LIB.byName.get(n)?.forge).toBe(false);
    expect(LIB.byName.get('Twinned Vision')?.forge).toBe(false);
    // A proxy-list card no document lists and no engine fact covers stays unknown, never supported.
    for (const c of LIB.cards) if (c.forge === null) expect(c.sources.every((s) => LIBRARY_LISTS.some((l) => l.id === s))).toBe(true);
  });

  it('pools the lab numbers of every shipped meta that played the card (games summed, shrunk rates by games)', () => {
    const metas = SHIPPED_CUBES.filter((c) => c.labData !== false).map((c) => [c.id, loadRealMeta(c.id as CubeId)] as const);
    for (const name of ['Abrade', 'Lightning Bolt', 'Counterspell', 'Swords to Plowshares']) {
      let g = 0;
      let w = 0;
      const cubes: string[] = [];
      for (const [id, m] of metas) {
        const st = m.cards[name];
        if (!st?.games || typeof st.winRateShrunk !== 'number') continue;
        g += st.games;
        w += st.games * st.winRateShrunk;
        cubes.push(id);
      }
      const lab = LIB.byName.get(name)?.lab;
      if (!g) expect(lab).toBeUndefined();
      else expect(lab).toEqual({ games: g, winRate: Math.round((w / g) * 10000) / 10000, cubes });
    }
    // mtg-table's library-pool.tsv has the same pooled numbers for Abrade.
    expect(LIB.byName.get('Abrade')?.lab).toMatchObject({ games: 3242, winRate: 0.4739 });
  });

  it('carries the documents’ AI:RemoveDeck flags', () => {
    expect(LIB.byName.get('Goblin Bombardment')?.ai).toBe('All');
    expect(LIB.byName.get('Micromancer')?.ai).toBe('Random');
  });

  it('knows each card’s colours, type and mana value; lands what they make', () => {
    expect(LIB.byName.get('Lightning Bolt')).toMatchObject({ colors: 'R', mv: 1 });
    expect(kindOf(LIB.byName.get('Lightning Bolt')!)).toBe('instant');
    const fountain = LIB.byName.get('Hallowed Fountain');
    if (fountain) expect(fountain).toMatchObject({ colors: '', mv: 0, produces: 'WU' });
    expect(bucketOf(LIB.byName.get('Lightning Bolt')!)).toBe('R');
    expect(LIB.cards.some(isBasic)).toBe(false);
  });
});

describe('parseLibrary', () => {
  it('drops bad rows and repeats, counts them, and refuses a file that is not a library', () => {
    const lib = parseLibrary({
      schema: 1,
      cards: [
        { name: 'Opt', colors: 'U', type: 'Instant', mv: 1, sources: ['x'], lab: { games: 10, winRate: 0.6, cubes: ['x'] } },
        { name: 'Opt', colors: 'U', type: 'Instant', mv: 1, sources: ['x'] },
        { name: 'Bad', colors: 'UW', type: 'Instant', mv: 1, sources: [] },
        { name: 'Worse', colors: 'U', type: 'Instant', mv: -1, sources: [] },
        { name: 'Odd lab', colors: '', type: 'Artifact', mv: 2, sources: [], lab: { games: 3, winRate: 1.4 } },
      ],
    });
    expect(lib.cards.map((c) => c.name)).toEqual(['Opt', 'Odd lab']);
    expect(lib.dropped).toBe(3);
    expect(lib.byName.get('Odd lab')?.lab).toBeUndefined();
    expect(() => parseLibrary({ schema: 2, cards: [] })).toThrow();
  });
  it('loads once through the injected fetch', async () => {
    let asked = 0;
    const f = async () => {
      asked++;
      return new Response(JSON.stringify(raw), { status: 200 });
    };
    const a = await loadLibrary('/x/', f);
    const b = await loadLibrary('/x/', f);
    expect(a).toBe(b);
    expect(a.cards.length).toBe(1592);
    expect(asked).toBe(1);
  });
});

describe('browsing', () => {
  it('filters by name, colour, type, mana value, source, lab rating and Forge', () => {
    expect(browse(LIB, { q: 'lightning bolt' }).map((c) => c.name)).toContain('Lightning Bolt');
    expect(browse(LIB, { colors: ['R'] }).every((c) => c.colors.includes('R'))).toBe(true);
    expect(browse(LIB, { colors: ['M'] }).every((c) => c.colors.length > 1)).toBe(true);
    expect(browse(LIB, { colors: ['C'] }).every((c) => c.colors === '')).toBe(true);
    expect(browse(LIB, { kind: 'land' }).every((c) => kindOf(c) === 'land')).toBe(true);
    expect(browse(LIB, { mv: 7 }).every((c) => c.mv >= 7)).toBe(true);
    expect(browse(LIB, { source: 'old-school' }).length).toBe(360);
    expect(browse(LIB, { minLab: 0.6 }).every((c) => (c.lab?.winRate ?? 0) >= 0.6)).toBe(true);
    expect(browse(LIB, { forgeOnly: true }).some((c) => c.forge !== undefined)).toBe(false);
    const byLab = browse(LIB, { source: 'synergy' }, 'lab');
    expect(byLab[0]!.lab!.winRate).toBeGreaterThanOrEqual(byLab[1]!.lab!.winRate);
    expect(matchesFilter(LIB.byName.get('Lightning Bolt')!, { colors: ['U', 'R'], mv: 1 })).toBe(true);
  });
  it('matches a typed name to the library’s spelling', () => {
    expect(libraryName(LIB, 'lightning bolt')).toBe('Lightning Bolt');
    expect(libraryName(LIB, 'Dead')).toBe('Dead // Gone');
    expect(libraryName(LIB, 'Not A Card')).toBeNull();
  });
});
