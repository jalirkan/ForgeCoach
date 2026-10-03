// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { coloursFromText, mentionedCards, parseCube, splitItem } from './parseCube.ts';
import { loadInfos } from './testdata/load.ts';

const doc = (f: string) => readFileSync(new URL(`../../public/cubes/${f}.md`, import.meta.url), 'utf8');
const FILES = ['synergy-cube-180', 'modern-era-cube-180', 'vintage-cube-180', 'pauper-cube-180', 'omega-cube-180'];

describe('parseCube on the shipped documents', () => {
  for (const f of FILES) {
    it(`${f}: 180 cards, every section as promised, no duplicates`, () => {
      const c = parseCube(doc(f));
      expect(c.cards).toHaveLength(180);
      expect(c.warnings).toEqual([]);
      expect(c.sections.reduce((s, x) => s + x.parsed, 0)).toBe(180);
      expect(new Set(c.cards.map((x) => x.name)).size).toBe(180);
      expect(c.title).toMatch(/cube/i);
    });
  }

  it('synergy: theme table codes, themes and lowercase tags per card', () => {
    const c = parseCube(doc('synergy-cube-180'));
    expect(c.themes.map((t) => t.code)).toEqual(['SAC', 'TOK', 'ETB', 'CTR', 'GY', 'SPL', 'ART', 'LND', 'LIFE']);
    expect(c.themes[0]?.connects).toEqual(['TOK', 'ART', 'GY', 'LIFE', 'CTR']);
    const by = new Map(c.cards.map((x) => [x.name, x]));
    expect(by.get('Thraben Inspector')).toMatchObject({ themes: ['ART', 'ETB', 'SAC'], colorHint: 'W', section: 'White' });
    expect(by.get('Bone Shards')).toMatchObject({ themes: ['SAC', 'GY'], tags: ['removal'] });
    expect(by.get('Mana Leak')?.tags).toEqual(['counter']);
    expect(by.get('Reflector Mage')).toMatchObject({ pair: 'WU', colorHint: 'WU', sectionKind: 'gold' });
    expect(by.get('Grist, the Hunger Tide')?.colorHint).toBe('BG');
    expect(by.get('Skullclamp')).toMatchObject({ colorHint: '', sectionKind: 'colorless' });
    expect(by.get('Flooded Strand')).toMatchObject({ land: true, group: 'Fetchlands' });
    expect(c.hasPrices).toBe(false);
    expect(c.cards.filter((x) => x.land)).toHaveLength(20);
  });

  it('synergy: archetypes from the "Decks this cube wants" bullets', () => {
    const c = parseCube(doc('synergy-cube-180'));
    const rakdos = c.archetypes.find((a) => a.name.startsWith('Rakdos'));
    expect(rakdos?.colors).toBe('BR');
    expect(rakdos?.signposts.slice(0, 2)).toEqual(['Viscera Seer', 'Goblin Bombardment']);
    expect(c.archetypes.find((a) => a.name.startsWith('Artifact'))?.colors).toBe('');
  });

  it('modern: prices instead of themes, Pathways by their full front-face name', () => {
    const c = parseCube(doc('modern-era-cube-180'));
    expect(c.hasPrices).toBe(true);
    expect(c.cards.every((x) => typeof x.price === 'number')).toBe(true);
    expect(c.cards.every((x) => x.themes.length === 0)).toBe(true);
    const by = new Map(c.cards.map((x) => [x.name, x]));
    expect(by.get('The One Ring')?.price).toBe(117.87);
    expect(by.get('Minsc & Boo, Timeless Heroes')?.price).toBe(1.6);
    expect(by.get('Hengegate Pathway')).toMatchObject({ land: true, price: 4.85, group: 'Pathways' });
    expect(c.archetypes).toHaveLength(10);
    expect(c.archetypes.find((a) => a.colors === 'UG')?.signposts).toEqual(['Oko, Thief of Crowns', "Uro, Titan of Nature's Wrath"]);
  });

  it('vintage: group tags on land lines, (hoser), the decks table', () => {
    const c = parseCube(doc('vintage-cube-180'));
    const by = new Map(c.cards.map((x) => [x.name, x]));
    expect(by.get('Scalding Tarn')?.themes).toEqual(['LND', 'GY']);
    expect(by.get('Ancient Tomb')).toMatchObject({ land: true, themes: ['RAMP', 'REAN', 'ART'] });
    expect(by.get('Containment Priest')?.tags).toContain('hoser');
    expect(by.get('Six')).toBeDefined();
    expect(c.archetypes.find((a) => a.name === 'Reanimator')?.colors).toBe('UB');
    expect(c.archetypes.find((a) => a.name === 'Lands & ramp')?.colors).toBe('G');
  });

  it('pauper: themes and prices together; table and bullets merge per pair', () => {
    const c = parseCube(doc('pauper-cube-180'));
    expect(c.hasPrices).toBe(true);
    const by = new Map(c.cards.map((x) => [x.name, x]));
    expect(by.get('Spellstutter Sprite')).toMatchObject({ themes: ['EVA', 'FLK'], tags: ['counter'], price: 3.79 });
    const rakdos = c.archetypes.filter((a) => a.colors === 'BR');
    expect(rakdos).toHaveLength(1);
    expect(rakdos[0]?.name).toBe('Rakdos sacrifice');
    expect(rakdos[0]?.signposts.slice(0, 2)).toEqual(['Body Dropper', 'Fireblade Artist']);
  });
});

describe('the Omega document', () => {
  it('180 cards, eight archetypes, Fire // Ice and the creature lands; every name in the Scryfall snapshot', () => {
    const c = parseCube(doc('omega-cube-180'));
    const by = new Map(c.cards.map((x) => [x.name, x]));
    expect(c.archetypes).toHaveLength(8);
    expect(by.get('Fire // Ice')).toMatchObject({ pair: 'UR', tags: ['removal'], themes: ['SPL'] });
    expect(by.get('Mutavault')).toMatchObject({ land: true, group: 'Creature lands', themes: ['LND', 'AGG'] });
    expect(c.cards.filter((x) => x.land)).toHaveLength(22);
    const infos = loadInfos('omega', c);
    expect([...infos.values()].filter((i) => i.found)).toHaveLength(180);
  });
});

describe('parseCube helpers', () => {
  it('splitItem', () => {
    expect(splitItem('Lightning Helix — removal LIFE SPL')).toEqual({ name: 'Lightning Helix', themes: ['LIFE', 'SPL'], tags: ['removal'] });
    expect(splitItem('Thoughtseize 6.91')).toEqual({ name: 'Thoughtseize', themes: [], tags: [], price: 6.91 });
    expect(splitItem('Kor Skyfisher — FLK EVA ART 0.42')).toEqual({ name: 'Kor Skyfisher', themes: ['FLK', 'EVA', 'ART'], tags: [], price: 0.42 });
    expect(splitItem('Endurance — GY (hoser)')).toEqual({ name: 'Endurance', themes: ['GY'], tags: ['hoser'] });
  });
  it('coloursFromText', () => {
    expect(coloursFromText('W + R (or B)')).toBe('WR');
    expect(coloursFromText('U R (+ Ancient Tomb)')).toBe('UR');
    expect(coloursFromText('G + R/U/B')).toBe('G');
    expect(coloursFromText('GW')).toBe('WG');
    expect(coloursFromText('Dimir or Sultai graveyard')).toBe('UB');
  });
  it('mentionedCards: longest name wins, short forms, word boundaries', () => {
    const names = ['Wrenn and Six', 'Six', 'Grist, the Hunger Tide', 'Opt'];
    expect(mentionedCards('Wrenn and Six and Grist', names)).toEqual(['Wrenn and Six', 'Grist, the Hunger Tide']);
    expect(mentionedCards('Optimal play', names)).toEqual([]);
  });
});
