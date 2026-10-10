/*
 * ForgeCoach — cube/finalFantasy.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The Final Fantasy Cube (public/cubes/final-fantasy-cube-180.md): 180 cards from the Final
 * Fantasy release, built on the set's ten two-colour archetypes. The document, the registry
 * (drafted everywhere, no lab data yet), its guide, and grid drafts that leave both drafters
 * a 40-card deck.
 */
import { describe, expect, it } from 'vitest';
import { labCards } from '../draft/cards.ts';
import { newDraft, selfPlay, type GridDraft } from '../draft/draft.ts';
import { buildDecks } from './builder.ts';
import { AI_DRAFT_CUBES, DRAFT_CUBES, cubeInfo } from './cubes.ts';
import { guideFor } from './guides/index.ts';
import { labOnly } from './score.ts';
import { context, loadCube, loadInfos } from './testdata/load.ts';

const cube = loadCube('final-fantasy');
const names = cube.cards.map((c) => c.name);

describe('the Final Fantasy Cube document', () => {
  it('180 names, one of each, in the house sections, every one in the Scryfall snapshot', () => {
    expect(cube.title).toBe('The Final Fantasy Cube — version 1 (180 cards, two-player)');
    expect(cube.warnings).toEqual([]);
    expect(cube.cards).toHaveLength(180);
    expect(new Set(names).size).toBe(180);
    expect(cube.sections.map((s) => `${s.name} ${s.kind} ${s.parsed}`)).toEqual([
      'White colour 26', 'Blue colour 26', 'Black colour 26', 'Red colour 26', 'Green colour 26', 'Gold gold 22', 'Colorless colorless 16', 'Lands lands 12',
    ]);
    expect([...loadInfos('final-fantasy', cube).values()].filter((i) => i.found)).toHaveLength(180);
  });

  it('the ten colour pairs, each an archetype with gold signposts in the cube', () => {
    const pairs = cube.archetypes.map((a) => a.colors).sort();
    expect(pairs).toEqual(['BG', 'BR', 'RG', 'UB', 'UG', 'UR', 'WB', 'WG', 'WR', 'WU']);
    const gold = cube.cards.filter((c) => c.sectionKind === 'gold');
    for (const p of pairs) expect(gold.filter((c) => c.pair === p).length, p).toBeGreaterThanOrEqual(2);
    for (const a of cube.archetypes) expect(a.signposts.length, a.colors).toBeGreaterThanOrEqual(4);
  });

  it('one Town dual per pair', () => {
    const lands = cube.cards.filter((c) => c.land).map((c) => c.name);
    expect(lands).toHaveLength(12);
    for (const n of ['Sharlayan, Nation of Scholars', 'Treno, Dark City', 'Vector, Imperial Capital', 'Gongaga, Reactor Town', 'Windurst, Federation Center', 'Insomnia, Crown City', 'Gohn, Town of Ruin', 'Balamb Garden, SeeD Academy', 'Baron, Airship Kingdom', 'Rabanastre, Royal City']) expect(lands, n).toContain(n);
  });
});

describe('the Final Fantasy Cube in the registry', () => {
  it('a cube: drafted with a friend and against the AI, with a guide, no lab data yet', () => {
    expect(cubeInfo('final-fantasy')).toMatchObject({ file: 'final-fantasy-cube-180', size: 180, labData: false });
    expect(cubeInfo('final-fantasy')?.kind).toBeUndefined();
    expect(DRAFT_CUBES.some((c) => c.id === 'final-fantasy')).toBe(true);
    expect(AI_DRAFT_CUBES.some((c) => c.id === 'final-fantasy')).toBe(true);
    expect(guideFor('final-fantasy')?.archetypes).toHaveLength(10);
  });

  it('a grid draft leaves both drafters a 40-card deck of two colours with nothing missing', () => {
    const ctx = context('final-fantasy');
    const cards = labCards(ctx);
    for (const seed of [1, 2, 3]) {
      const d = selfPlay(newDraft({ cubeId: 'final-fantasy', format: 'grid', cube: names, seed, youFirst: true, now: 0 }), cards) as GridDraft;
      expect(d.done, `seed ${seed}`).toBe(true);
      for (const pool of [d.picks.you, d.picks.ai]) {
        const b = buildDecks(labOnly(ctx), pool)[0]!;
        expect(b.missing, `seed ${seed}`).toBe(0);
        expect(b.spells.length + b.nonbasics.length + Object.values(b.basics).reduce((s, n) => s + (n ?? 0), 0)).toBe(40);
      }
    }
  });
});
