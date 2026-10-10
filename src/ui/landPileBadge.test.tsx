/*
 * ForgeCoach — ui/landPileBadge.test.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Identical untapped lands collapse into one tile with a .pile-count badge
 * (endstep's "2" on the Plains); a lone land is a plain tile with none.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Card } from '../protocol.ts';
import { LandPile } from './CardTile.tsx';
import { groupLands } from './landPiles.ts';

function land(id: number, name: string, extra: Partial<Card> = {}): Card {
  return {
    id, name, setCode: null, manaCost: null, types: `Basic Land - ${name}`, power: null, toughness: null, loyalty: null, damage: 0, counters: {},
    tapped: false, sick: false, attacking: false, blocking: false, faceDown: false, token: false, alt: null, attachedToId: null, attachmentIds: [],
    controller: 0, owner: 0, zone: 'battlefield', abilities: [], keywords: [], ...extra,
  } as unknown as Card;
}

describe('land pile badge', () => {
  const piles = groupLands([land(1, 'Plains'), land(2, 'Plains'), land(3, 'Plains', { tapped: true }), land(4, 'Island')].map((card) => ({ card, attachments: 0 })));

  it('renders the count on a pile of two', () => {
    const pile = piles.find((p) => p.length === 2)!;
    const html = renderToStaticMarkup(<LandPile cards={pile} side="me" />);
    expect(html).toContain('land-pile');
    expect(html).toMatch(/class="pile-count"[^>]*>×2</);
    expect(html).toContain('data-card-ids="1,2"');
  });
  it('a lone land (the tapped Plains, the Island) is a plain tile with no badge', () => {
    for (const pile of piles.filter((p) => p.length === 1)) {
      const html = renderToStaticMarkup(<LandPile cards={pile} side="me" />);
      expect(html).not.toContain('pile-count');
      expect(html).not.toContain('land-pile');
    }
  });
});
