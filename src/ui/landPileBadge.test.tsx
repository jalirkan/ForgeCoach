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
import { LandPile, LandTab, TAB_LETTERS } from './CardTile.tsx';
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

  it('in a lands bar (the desktop table, the upright phone board) a land carries its name tab; nowhere else', () => {
    const pile = piles.find((p) => p.length === 2)!;
    const bar = renderToStaticMarkup(<LandPile cards={pile} side="me" tab />);
    expect(bar).toMatch(/class="land-tab" aria-hidden="true"><span class="land-tab-name"><span class="land-tab-text">Plains<\/span><span class="land-tab-size"[^>]*><\/span><\/span><span class="land-tab-count">×2<\/span><\/span>/);
    const lone = renderToStaticMarkup(<LandPile cards={piles.find((p) => p[0]!.name === 'Island')!} side="me" tab />);
    expect(lone).toContain('<span class="land-tab-text">Island</span>');
    expect(lone).not.toContain('land-tab-count');
    expect(renderToStaticMarkup(<LandPile cards={pile} side="me" />)).not.toContain('land-tab');
  });
  it('the tab says how many of its pile a choice has picked (a phone shows no card to say it)', () => {
    expect(renderToStaticMarkup(<LandTab name="Forest" count={3} sent={2} />)).toContain('<span class="land-tab-sent">2 picked</span>');
    expect(renderToStaticMarkup(<LandTab name="Forest" count={3} />)).not.toContain('land-tab-sent');
  });
  it("the tab's sizer keeps the first letters of the name in one piece: a basic land's whole name", () => {
    expect(TAB_LETTERS).toBe('Mountain'.length);
    // The name is in the markup once (the sizer's text is CSS content, from these attributes).
    const basic = renderToStaticMarkup(<LandTab name="Mountain" count={1} />);
    expect(basic).toContain('<span class="land-tab-size" data-head="Mountain" data-rest=""></span>');
    expect(basic.match(/Mountain/g)!.length).toBe(2);
    // A longer name: 8 letters that never break (their space is a no-break space), the rest breakable.
    const long = renderToStaticMarkup(<LandTab name="Dark Barony" count={1} />);
    expect(long).toContain('data-head="Dark\u00a0Bar" data-rest="ony"');
    expect(long).toContain('<span class="land-tab-text">Dark Barony</span>');
  });
});
