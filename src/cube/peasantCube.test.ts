/*
 * ForgeCoach — cube/peasantCube.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The Peasant Cube document: MatEffect's Twobert cut with common/uncommon lands.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { aiFlagsFromDoc } from '../draft/aiFlags.ts';
import { parseCube } from './parseCube.ts';
import { loadInfos } from './testdata/load.ts';

const text = readFileSync(new URL('../../public/cubes/peasant-cube-180.md', import.meta.url), 'utf8');

describe('the Peasant document', () => {
  const c = parseCube(text);
  const by = new Map(c.cards.map((x) => [x.name, x]));

  it('180 cards, ten guild archetypes, every name in the Scryfall snapshot', () => {
    expect(c.cards).toHaveLength(180);
    expect(c.warnings).toEqual([]);
    expect(c.archetypes.map((a) => a.colors).sort()).toEqual(['BG', 'BR', 'RG', 'UB', 'UG', 'UR', 'WB', 'WG', 'WR', 'WU']);
    expect(c.archetypes.find((a) => a.colors === 'BR')?.signposts.slice(0, 2)).toEqual(['Mayhem Devil', 'Goblin Plate Mail']);
    const infos = loadInfos('peasant', c);
    expect([...infos.values()].filter((i) => i.found)).toHaveLength(180);
  });

  it('gold pairs, front-face names, and common/uncommon lands only', () => {
    expect(by.get('Elas il-Kor, Sadistic Pilgrim')).toMatchObject({ pair: 'WB', themes: ['SAC'] });
    expect(by.get('Sink into Stupor')).toMatchObject({ section: 'Blue', tags: ['removal'] });
    expect(by.get('Summon: Fenrir')).toMatchObject({ section: 'Green', themes: ['RMP'] });
    const lands = c.cards.filter((x) => x.land);
    expect(lands).toHaveLength(22);
    expect(lands.filter((x) => x.group === 'Duals')).toHaveLength(10);
    for (const rare of ['Steam Vents', 'Blood Crypt', 'Horizon Canopy', 'Prismatic Vista']) expect(by.has(rare), rare).toBe(false);
  });

  it('states its Forge AI flags', () => {
    const f = aiFlagsFromDoc(text, [...by.keys()]);
    expect([...f.all].sort()).toEqual(['Faithless Looting', 'Goblin Bombardment', "Mishra's Bauble", 'Spawning Pit', 'Waker of Waves']);
    expect([...f.random].sort()).toEqual(['Halo Forager', 'Soulherder']);
  });
});
