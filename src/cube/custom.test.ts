/*
 * ForgeCoach — cube/custom.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { afterEach, describe, expect, it } from 'vitest';
import { accentOf, cubeMarkdown, customId, deleteCustomCube, getCustomCube, importCubeText, listCustomCubes, saveCustomCube, slugOf, CUSTOM_KEY, type CustomCube } from './custom.ts';
import { CUBES, cubeInfo, loadCubeDoc, loadShippedMeta, refreshCustomCubes, SHIPPED_CUBES } from './cubes.ts';
import { generateCube } from './generate.ts';
import { parseCube } from './parseCube.ts';
import { aiFlagsFromDoc } from '../draft/aiFlags.ts';
import { newDraft } from '../draft/draft.ts';
import { loadCubeText, loadShippedLibrary } from './testdata/load.ts';
import { makeContext } from './score.ts';
import { buildDecks } from './builder.ts';

const LIB = loadShippedLibrary();

function memStore(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

function made(title: string, names: string[], now = 1000): CustomCube {
  const cards = names.map((n) => LIB.byName.get(n)!);
  return { id: customId(title, []), title, blurb: 'A test cube.', target: 180, cards: names, doc: cubeMarkdown({ title, blurb: 'A test cube.', cards }), accent: accentOf(cards), createdAt: now, updatedAt: now };
}

afterEach(() => refreshCustomCubes([]));

describe('the document', () => {
  it('round-trips through parseCube: the same cards, in their sections, Forge’s gaps and the AI flags', () => {
    // A Set: the seeded cube may already hold one of the five added cards (it drew Micromancer once Synergy v3 changed the library).
    const names = [...new Set([...generateCube(LIB, { size: 180, seed: 4, rating: 'lab' }).cards, 'Twinned Vision', 'Goblin Bombardment', 'Micromancer', 'Dead // Gone', 'Grist, the Hunger Tide'])].filter((n) => LIB.byName.has(n));
    const cards = names.map((n) => LIB.byName.get(n)!);
    const doc = cubeMarkdown({ title: 'Friday Cube', blurb: 'For the Friday table.', cards, date: '2026-10-16' });
    const cube = parseCube(doc);
    expect(cube.title).toBe('Friday Cube');
    expect(cube.warnings).toEqual([]);
    expect(new Set(cube.cards.map((c) => c.name))).toEqual(new Set(names));
    expect(cube.cards.length).toBe(names.length);
    expect(cube.forgeMissing).toEqual(['Twinned Vision']);
    const flags = aiFlagsFromDoc(
      doc,
      cube.cards.map((c) => c.name),
    );
    expect(flags.all.has('Goblin Bombardment')).toBe(true);
    expect(flags.random.has('Micromancer')).toBe(true);
    // Sections as the cube documents have them: a colour's cards carry its colour; gold cards their pair; lands are lands.
    const bolt = cube.cards.find((c) => c.name === names.find((n) => LIB.byName.get(n)!.colors === 'R'));
    expect(bolt).toMatchObject({ section: 'Red', sectionKind: 'colour', colorHint: 'R' });
    const gold = cube.cards.filter((c) => c.sectionKind === 'gold' && c.pair);
    expect(gold.length).toBeGreaterThanOrEqual(20);
    for (const g of gold) expect(LIB.byName.get(g.name)!.colors).toBe(g.pair);
    expect(cube.cards.filter((c) => c.land).length).toBe(cards.filter((c) => c.type.startsWith('Land') || /\bLand\b/.test(c.type.split(' // ')[0]!)).filter((c) => !/Creature/.test(c.type.split(' // ')[0]!)).length);
    expect(cube.sections.every((s) => s.parsed === s.expected)).toBe(true);
  });

  it('round-trips the whole library (every name survives the document’s punctuation)', () => {
    const cube = parseCube(cubeMarkdown({ title: 'Everything', blurb: '', cards: LIB.cards }));
    expect(cube.cards.map((c) => c.name).sort()).toEqual(LIB.cards.map((c) => c.name).sort());
    expect(cube.warnings).toEqual([]);
  });

  it('reads back as a cube the drafter and the builder take', () => {
    const names = generateCube(LIB, { size: 180, seed: 8, rating: 'lab' }).cards;
    const cube = parseCube(cubeMarkdown({ title: 'Mine', blurb: '', cards: names.map((n) => LIB.byName.get(n)!) }));
    const d = newDraft({ cubeId: 'my-mine', format: 'grid', cube: cube.cards.map((c) => c.name), seed: 1, youFirst: true, now: 0 });
    expect(d.format === 'grid' && d.grids).toBe(18);
    const ctx = makeContext(cube, null, null);
    expect(buildDecks(ctx, names.slice(0, 60)).length).toBeGreaterThan(0);
  });
});

describe('importCubeText', () => {
  it('reads a cube document: its title and cards; strangers reported', () => {
    const r = importCubeText(loadCubeText('synergy'), LIB);
    expect(r.title).toMatch(/Synergy/);
    expect(r.cards.length).toBe(180);
    expect(r.unknown).toEqual([]);
  });
  it('reads a plain list: counts, set codes, front faces; basics left out; repeats once', () => {
    const r = importCubeText('1 Lightning Bolt\n1x Counterspell (MH2) 267\nDead\nlightning bolt\n2 Mountain\nNot A Card\n', LIB);
    expect(r.cards).toEqual(['Lightning Bolt', 'Counterspell', 'Dead // Gone']);
    expect(r.repeats).toEqual(['Lightning Bolt']);
    expect(r.unknown).toEqual(['Not A Card']);
    expect(r.basics).toBe(2);
  });
});

describe('the store', () => {
  it('saves, lists, replaces, deletes; ignores junk', () => {
    const s = memStore();
    expect(listCustomCubes(s)).toEqual([]);
    const a = made('Friday Cube', ['Lightning Bolt', 'Counterspell']);
    expect(saveCustomCube(a, s)).toBe(true);
    expect(getCustomCube('my-friday-cube', s)?.cards).toEqual(['Lightning Bolt', 'Counterspell']);
    saveCustomCube({ ...a, cards: ['Opt'], updatedAt: 2000 }, s);
    expect(listCustomCubes(s).length).toBe(1);
    expect(getCustomCube(a.id, s)?.cards).toEqual(['Opt']);
    s.data.set(CUSTOM_KEY, JSON.stringify([...JSON.parse(s.data.get(CUSTOM_KEY)!), { id: 'Bad Id', title: 1 }, { ...a, id: 'synergy' }]));
    expect(listCustomCubes(s).map((c) => c.id)).toEqual([a.id]);
    deleteCustomCube(a.id, s);
    expect(listCustomCubes(s)).toEqual([]);
    s.data.set(CUSTOM_KEY, 'not json');
    expect(listCustomCubes(s)).toEqual([]);
  });
  it('makes ids the draft room accepts, never twice the same', () => {
    expect(slugOf('Justin’s Friday Cube!')).toBe('justin-s-friday-cube');
    expect(slugOf('***')).toBe('cube');
    expect(customId('Friday', [])).toBe('my-friday');
    expect(customId('Friday', ['my-friday', 'my-friday-2'])).toBe('my-friday-3');
    expect(customId('Ünïcode Çube', [])).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/);
  });
  it('picks a tile accent from the two most common colours', () => {
    expect(accentOf([{ colors: 'R' }, { colors: 'RG' }, { colors: 'U' }, { colors: 'G' }])).toBe('RG');
    expect(accentOf([{ colors: '' }])).toBe('WUBRG');
  });
});

describe('the registry', () => {
  it('lists your cubes after the shipped ones, yours, with no lab data; refreshes in place', async () => {
    const a = made('Friday Cube', ['Lightning Bolt', 'Counterspell', 'Opt']);
    const list = CUBES;
    refreshCustomCubes([a]);
    expect(CUBES).toBe(list);
    expect(CUBES.length).toBe(SHIPPED_CUBES.length + 1);
    expect(CUBES.slice(0, SHIPPED_CUBES.length)).toEqual([...SHIPPED_CUBES]);
    const info = cubeInfo('my-friday-cube')!;
    expect(info).toMatchObject({ custom: true, labData: false, size: 3, title: 'Friday Cube', file: 'my-friday-cube', version: 1000, art: 'Lightning Bolt' });
    // Its document comes from the browser, never the network; no meta is asked for.
    const asked: string[] = [];
    const fetcher = async (u: string) => {
      asked.push(u);
      return new Response('', { status: 404 });
    };
    const cube = await loadCubeDoc(info, '/', fetcher);
    expect(cube.cards.map((c) => c.name).sort()).toEqual(['Counterspell', 'Lightning Bolt', 'Opt']);
    expect(await loadShippedMeta(info, '/', fetcher)).toBeNull();
    expect(asked).toEqual([]);
    // A custom cube never shadows a shipped one.
    refreshCustomCubes([{ ...a, id: 'my-x' }, { ...a, id: 'synergy' } as CustomCube]);
    expect(CUBES.filter((c) => c.id === 'synergy').length).toBe(1);
    expect(cubeInfo('my-friday-cube')).toBeUndefined();
    refreshCustomCubes([]);
    expect(CUBES.length).toBe(SHIPPED_CUBES.length);
  });
});
