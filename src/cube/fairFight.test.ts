// SPDX-License-Identifier: GPL-3.0-or-later
// The Fair Fight Cube document: parses to 180 cards, follows its own rules' counts.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { aiFlagsFromDoc } from '../draft/aiFlags.ts';
import { parseCube } from './parseCube.ts';
import { loadInfos } from './testdata/load.ts';

const text = readFileSync(new URL('../../public/cubes/fair-fight-cube-180.md', import.meta.url), 'utf8');

describe('the Fair Fight document', () => {
  const c = parseCube(text);
  const by = new Map(c.cards.map((x) => [x.name, x]));
  it('180 cards, no warnings, 26 per colour, 16 gold signposts, prices on every card', () => {
    expect(c.warnings).toEqual([]);
    expect(c.cards).toHaveLength(180);
    expect(c.sections.map((s) => [s.name, s.parsed])).toEqual([
      ['White', 26], ['Blue', 26], ['Black', 26], ['Red', 26], ['Green', 26], ['Gold', 16], ['Colorless', 14], ['Lands', 20],
    ]);
    expect(c.cards.every((x) => typeof x.price === 'number')).toBe(true);
    expect(c.themes.map((t) => t.code)).toEqual(['FLK', 'EVA', 'TOK', 'SAC', 'SPL', 'GY', 'ART', 'RMP', 'AGG']);
  });
  it('eight lanes, each with its two gold signposts first', () => {
    const lanes = c.archetypes.filter((a) => a.colors.length === 2);
    expect(lanes.map((a) => a.colors)).toEqual(['WU', 'UB', 'BR', 'RG', 'WG', 'UR', 'BG', 'WR']);
    for (const a of lanes) {
      const gold = c.cards.filter((x) => x.pair === a.colors).map((x) => x.name);
      expect(gold).toHaveLength(2);
      expect(new Set(a.signposts.slice(0, 2))).toEqual(new Set(gold));
    }
    expect(by.get('Fire // Ice')).toMatchObject({ pair: 'UR', tags: ['removal'] });
    expect(by.get('Restless Cottage')).toMatchObject({ land: true, group: 'Restless lands' });
  });
  it('removal in every colour; every name in the Scryfall snapshot; the Forge flags', () => {
    for (const s of ['White', 'Blue', 'Black', 'Red', 'Green']) expect(c.cards.filter((x) => x.section === s && x.tags.includes('removal')).length, s).toBeGreaterThanOrEqual(4);
    const infos = loadInfos('fair-fight', c);
    expect([...infos.values()].filter((i) => i.found)).toHaveLength(180);
    const walkers = [...infos.values()].filter((i) => /Planeswalker/.test(i.typeLine)).map((i) => i.name);
    expect(walkers.sort()).toEqual(['Davriel, Rogue Shadowmage', 'Nahiri, Storm of Stone', 'Saheeli, Sublime Artificer', 'Tibalt, Rakish Instigator', "Vraska, Swarm's Eminence"]);
    const f = aiFlagsFromDoc(text, [...by.keys()]);
    expect([...f.all]).toEqual([]);
    expect([...f.random].sort()).toEqual(['Bomat Courier', 'Fling', 'Soulherder']);
  });
});
