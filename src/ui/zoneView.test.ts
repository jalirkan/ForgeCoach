/*
 * ForgeCoach — ui/zoneView.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import type { AnyCard } from '../protocol.ts';
import { mainType, manaValue, sortZone, typeSummary } from './zoneView.ts';

const card = (id: number, name: string, types: string, manaCost: string | null): AnyCard =>
  ({ id, name, types, manaCost, zone: 'graveyard', controller: 0, owner: 0, faceDown: false, alt: null }) as unknown as AnyCard;
const back = (id: number): AnyCard => ({ id, zone: 'exile', controller: 1, owner: 1, hidden: true });

// Oldest first, as the wire holds a zone.
const zone = [
  card(1, 'Lightning Bolt', 'Instant', '{R}'),
  card(2, 'Grizzly Bears', 'Creature - Bear', '{1}{G}'),
  back(3),
  card(4, 'Village Rites', 'Instant', '{B}'),
  card(5, 'Mountain', 'Basic Land - Mountain', null),
  card(6, 'Ajani, Caller', 'Legendary Planeswalker - Ajani', '{2}{W/U}{X}'),
];
const ids = (cs: AnyCard[]) => cs.map((c) => c.id);

describe('manaValue', () => {
  it('reads costs', () => {
    expect(manaValue('{2}{W}{W}')).toBe(4);
    expect(manaValue('{X}{R}')).toBe(1);
    expect(manaValue('{2/W}{G/U}')).toBe(3);
    expect(manaValue(null)).toBe(0);
  });
});

describe('mainType', () => {
  it('picks the headline type', () => {
    expect(mainType('Legendary Creature - Human Wizard')).toBe('Creature');
    expect(mainType('Artifact Creature - Golem')).toBe('Creature');
    expect(mainType('Basic Land - Forest')).toBe('Land');
    expect(mainType('Kindred Instant - Elf')).toBe('Instant');
  });
});

describe('sortZone', () => {
  it('Recency: newest first, hidden cards last', () => {
    expect(ids(sortZone(zone, 'recency'))).toEqual([6, 5, 4, 2, 1, 3]);
  });
  it('Name', () => {
    expect(ids(sortZone(zone, 'name'))).toEqual([6, 2, 1, 5, 4, 3]);
  });
  it('CMC, then name', () => {
    expect(ids(sortZone(zone, 'cmc'))).toEqual([5, 1, 4, 2, 6, 3]);
  });
  it('Type: creatures, planeswalkers, instants … lands', () => {
    expect(ids(sortZone(zone, 'type'))).toEqual([2, 6, 1, 4, 5, 3]);
  });
});

describe('typeSummary', () => {
  it('counts types, most common first, hidden cards named as such', () => {
    expect(typeSummary(zone)).toBe('2 Instants · 1 Creature · 1 Land · 1 Planeswalker · 1 hidden card');
    expect(typeSummary([card(1, 'Ponder', 'Sorcery', '{U}'), card(2, 'Preordain', 'Sorcery', '{U}')])).toBe('2 Sorceries');
    expect(typeSummary([])).toBe('');
  });
});
