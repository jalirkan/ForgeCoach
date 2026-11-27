/*
 * ForgeCoach — ui/landPiles.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '../protocol.ts';
import { barIsFull, groupLands, pilePlan, pileWeight, TAB_LETTERS, tabLabels } from './landPiles.ts';

function land(id: number, name: string, extra: Partial<Card> = {}): Card {
  const basic = ['Island', 'Plains', 'Swamp', 'Mountain', 'Forest'].includes(name);
  return {
    id,
    name,
    manaCost: null,
    types: basic ? `Basic Land - ${name}` : 'Land',
    power: null,
    toughness: null,
    loyalty: null,
    tapped: false,
    sick: false,
    attacking: false,
    blocking: false,
    damage: 0,
    counters: {},
    token: false,
    faceDown: false,
    alt: null,
    attachedToId: null,
    attachmentIds: [],
    controller: 0,
    owner: 0,
    zone: 'battlefield',
    abilities: [],
    keywords: [],
    ...extra,
  } as unknown as Card;
}
const plain = (c: Card) => ({ card: c, attachments: 0 });

describe('groupLands', () => {
  it('tapped and untapped lands of one name never share a pile', () => {
    const g = groupLands([land(1, 'Plains'), land(2, 'Plains', { tapped: true }), land(3, 'Plains'), land(4, 'Plains', { tapped: true })].map(plain));
    expect(g).toHaveLength(2);
    for (const pile of g) expect(new Set(pile.map((c) => c.tapped)).size).toBe(1);
    expect(g.map((p) => p.map((c) => c.id))).toEqual([[1, 3], [2, 4]]);
  });
  it('a land with an attachment stays alone, and so does one with counters', () => {
    const g = groupLands([{ card: land(1, 'Island'), attachments: 2 }, plain(land(2, 'Island')), plain(land(3, 'Island')), plain(land(4, 'Island', { counters: { CHARGE: 1 } }))]);
    expect(g.map((p) => p.map((c) => c.id)).sort()).toEqual([[1], [2, 3], [4]].sort());
  });
  it('piles identical basics, split by tapped state, untapped first', () => {
    const g = groupLands([land(1, 'Island'), land(2, 'Island', { tapped: true }), land(3, 'Island'), land(4, 'Plains'), land(5, 'Island', { tapped: true })].map(plain));
    expect(g.map((p) => p.map((c) => c.id))).toEqual([[1, 3], [4], [2, 5]]);
  });
  it('keeps nonbasic lands apart, even two of the same', () => {
    const g = groupLands([land(1, 'Thriving Isle'), land(2, 'Thriving Isle'), land(3, 'Swamp'), land(4, 'Swamp')].map(plain));
    expect(g.map((p) => p.map((c) => c.id))).toEqual([[3, 4], [1], [2]]);
  });
  it('a basic with counters, damage, an attachment or in combat stands alone', () => {
    const g = groupLands([
      plain(land(1, 'Forest')),
      plain(land(2, 'Forest', { counters: { P1P1: 1 } })),
      { card: land(3, 'Forest'), attachments: 1 },
      plain(land(4, 'Forest', { attacking: true })),
      plain(land(5, 'Forest')),
    ]);
    expect(g.map((p) => p.map((c) => c.id)).sort()).toEqual([[1, 5], [2], [3], [4]].sort());
  });
});

describe('groupLands, a land the stack points at', () => {
  it('stands apart from its pile, so the mark and the arrow are on that land alone', () => {
    const lands = [land(1, 'Forest'), land(2, 'Forest'), land(3, 'Forest'), land(4, 'Island')].map((card) => ({ card, attachments: 0 }));
    expect(groupLands(lands).map((g) => g.map((c) => c.id))).toEqual([[1, 2, 3], [4]]);
    expect(groupLands(lands, new Set([2])).map((g) => g.map((c) => c.id))).toEqual([[1, 3], [2], [4]]);
    // a Map of marks (Board's) answers `has` the same way
    expect(groupLands(lands, new Map([[3, {}]])).map((g) => g.map((c) => c.id))).toEqual([[1, 2], [3], [4]]);
  });
});

describe('tabLabels', () => {
  it('leaves names alone that a cut tab would still tell apart', () => {
    expect(tabLabels(['Forest', 'Mountain', 'Thriving Heath', 'Sunpetal Grove', 'Dark Barony', 'Dragonskull Summit']).size).toBe(0);
    expect('Mountain'.length).toBe(TAB_LETTERS);
    // one name twice (two piles of it, or two copies of a nonbasic) is one land: nothing to tell apart
    expect(tabLabels(['Snow-Covered Forest', 'Snow-Covered Forest']).size).toBe(0);
  });
  it('names that would be cut to the same text say the words they differ in', () => {
    const snow = tabLabels(['Snow-Covered Forest', 'Snow-Covered Island', 'Forest']);
    expect(snow.get('Snow-Covered Forest')).toBe('…Forest');
    expect(snow.get('Snow-Covered Island')).toBe('…Island');
    expect(snow.has('Forest')).toBe(false);
    const temples = tabLabels(['Temple of Malady', 'Temple of Mystery', 'Temple of the False God']);
    expect([...temples.values()].sort()).toEqual(['…Malady', '…Mystery', '…the False God']);
    // the short names are told apart within the letters a tab keeps
    expect(new Set([...temples.values()].map((v) => v.slice(0, TAB_LETTERS))).size).toBe(3);
  });
  it('two Thriving lands are told apart by their second word', () => {
    const t = tabLabels(['Thriving Isle', 'Thriving Moor', 'Island']);
    expect(t.get('Thriving Isle')).toBe('…Isle');
    expect(t.get('Thriving Moor')).toBe('…Moor');
  });
  it('keeps a name whole when the names share no whole first word, or nothing would be left', () => {
    expect(tabLabels(['Underground River', 'Undergrowth Stadium']).size).toBe(0);
    expect(tabLabels(['Reflecting Pool', 'Reflecting Pool Annex']).get('Reflecting Pool')).toBe('…Pool');
  });
});

describe('barIsFull', () => {
  const tab = (name: string, count = 1) => ({ name, count });
  it('a bar whose names fit says them whole (the short names are for a full bar only)', () => {
    // seen in a real game at 390 px: all four whole
    expect(barIsFull([tab('Island'), tab('Swamp', 2), tab('Thriving Isle'), tab('Thriving Moor')])).toBe(false);
    expect(barIsFull([tab('Forest', 2), tab('Mountain', 3), tab('Forest', 2), tab('Mountain')])).toBe(false);
    expect(barIsFull([])).toBe(false);
  });
  it('five piles with long names, or four long ones, are a full bar', () => {
    expect(barIsFull([tab('Island'), tab('Swamp', 2), tab('Thriving Isle'), tab('Thriving Moor'), tab('Plains')])).toBe(true);
    expect(barIsFull([tab('Snow-Covered Forest', 3), tab('Snow-Covered Island', 2), tab('Snow-Covered Forest'), tab('Snow-Covered Island')])).toBe(true);
  });
  it('a wider bar holds more', () => {
    const five = [tab('Island'), tab('Swamp', 2), tab('Thriving Isle'), tab('Thriving Moor'), tab('Plains')];
    expect(barIsFull(five, 700)).toBe(false);
  });
});

describe('pilePlan', () => {
  it('while the engine asks for lands, a click selects the first selectable land not yet sent', () => {
    expect(pilePlan([1, 2, 3], [null, 'select', 'select'])).toEqual({ top: 1, select: true, selectable: 2, restart: false });
    expect(pilePlan([1, 2, 3], [null, 'select', 'select'], new Set([2]))).toMatchObject({ top: 2, restart: false });
  });
  it('after every selectable land was sent, it starts over (the engine may still offer them)', () => {
    expect(pilePlan([1, 2], ['select', 'select'], new Set([1, 2]))).toMatchObject({ top: 0, restart: true });
  });
  it('otherwise a click goes to the first land the engine would act on', () => {
    expect(pilePlan([1, 2, 3], [null, 'act', 'act'])).toMatchObject({ top: 1, select: false });
    expect(pilePlan([1, 2], ['act', 'act'])).toMatchObject({ top: 0, select: false });
  });
  it('with nothing to act on, the first land (a click opens its details)', () => {
    expect(pilePlan([1, 2], [null, null])).toMatchObject({ top: 0, select: false, selectable: 0 });
  });
});

describe('pileWeight', () => {
  it('is one card plus a fifth per extra card shown, lying down when tapped', () => {
    expect(pileWeight([land(1, 'Island')])).toBe(1);
    expect(pileWeight([land(1, 'Island'), land(2, 'Island'), land(3, 'Island')])).toBeCloseTo(1.4);
    expect(pileWeight(Array.from({ length: 9 }, (_, i) => land(i, 'Island', { tapped: true })))).toBeCloseTo(2);
  });
});
