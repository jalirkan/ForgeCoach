/*
 * ForgeCoach — ui/landPiles.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '../protocol.ts';
import { groupLands, pilePlan, pileWeight } from './landPiles.ts';

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
