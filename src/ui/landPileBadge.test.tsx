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
import { BoardMarksContext, type BoardMarks } from './cardContext.ts';
import { cardRect, domLookup } from './BoardArrows.tsx';
import { groupBattlefield } from './Board.tsx';
import { LandPile, LandTab } from './CardTile.tsx';
import { groupLands, TAB_LETTERS } from './landPiles.ts';

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
  it('the tab carries what only the card showed: stack numbers, counters, and a full bar\'s short name', () => {
    const marked = renderToStaticMarkup(<LandTab name="Forest" count={1} marks={{ sources: [2], targets: [1, 3] }} counters={[['CHARGE', 2]]} />);
    expect(marked).toMatch(/<span class="land-tab-stack"><span class="smk smk-src">2<\/span><span class="smk smk-tgt">1<\/span><span class="smk smk-tgt">3<\/span><\/span>/);
    expect(marked).toMatch(/<span class="land-tab-marks"><span class="mk mk-counter">[^<]*2[^<]*<\/span><\/span>/);
    const plain = renderToStaticMarkup(<LandTab name="Forest" count={1} marks={{ sources: [], targets: [] }} counters={[]} />);
    expect(plain).not.toMatch(/land-tab-stack|land-tab-marks|land-tab-short|has-short/);
    const short = renderToStaticMarkup(<LandTab name="Snow-Covered Forest" short="…Forest" count={2} />);
    expect(short).toContain('<span class="land-tab-name has-short"><span class="land-tab-text">Snow-Covered Forest</span><span class="land-tab-short">…Forest</span>');
    // the sizer measures what the tab says
    expect(short).toContain('data-head="…Forest" data-rest=""');
    // ... and carries the whole name for the desktop table, which always says the name and never cuts this one (ui/cards.css)
    expect(short).toContain('data-name="Snow-Covered Forest"');
    expect(plain).not.toContain('data-name');
  });
  it('a pile shows that the stack points at it, and a land with counters says so on its tab', () => {
    const pile = piles.find((p) => p.length === 2)!;
    const marks: BoardMarks = { stack: new Map([[2, { sources: [], targets: [1] }]]) } as unknown as BoardMarks;
    const html = renderToStaticMarkup(
      <BoardMarksContext.Provider value={marks}>
        <LandPile cards={pile} side="me" tab />
      </BoardMarksContext.Provider>,
    );
    expect(html).toMatch(/class="tile land-pile[^"]* is-stack-target[^"]*"/);
    expect(html).toContain('<span class="land-tab-stack"><span class="smk smk-tgt">1</span></span>');
    expect(renderToStaticMarkup(<LandPile cards={pile} side="me" tab />)).not.toContain('is-stack-target');
    const depleted = land(9, 'Gemstone Mine', { types: 'Land', counters: { MINING: 3 } });
    expect(renderToStaticMarkup(<LandPile cards={[depleted]} side="me" tab />)).toMatch(/<span class="land-tab-marks"><span class="mk mk-counter">[^<]*3[^<]*<\/span>/);
  });
});

describe('cardRect (where an arrow finds a card)', () => {
  const box = (w: number, h: number) => ({ x: 10, y: 20, width: w, height: h });
  const el = (name: string) => ({ name }) as unknown as Element;
  const tile = (parts: Record<string, Element>) => ({ name: 'tile', querySelector: (sel: string) => parts[sel] ?? null }) as unknown as Element;
  const rectBy = (sizes: Record<string, [number, number]>) => (e: Element | null) => {
    const s = e && sizes[(e as unknown as { name: string }).name];
    return s && (s[0] || s[1]) ? box(s[0], s[1]) : undefined;
  };
  it('is the slot where it is laid out, the name tab where it is not (a land in a phone\'s bar), else the tile', () => {
    const t = tile({ '.tile-slot': el('slot'), '.land-tab': el('tab') });
    expect(cardRect(t, rectBy({ slot: [63, 88], tab: [80, 30], tile: [80, 40] }))).toEqual(box(63, 88));
    expect(cardRect(t, rectBy({ slot: [0, 0], tab: [80, 30], tile: [80, 40] }))).toEqual(box(80, 30));
    expect(cardRect(tile({ '.tile-slot': el('slot') }), rectBy({ slot: [0, 0], tile: [80, 40] }))).toEqual(box(80, 40));
    expect(cardRect(null)).toBeUndefined();
  });
});

describe('what is attached to a land (an aura, a fortification) is drawn with it', () => {
  const forest = land(10, 'Forest', { attachmentIds: [11] });
  const growth = land(11, 'Wild Growth', { types: 'Enchantment - Aura', attachedToId: 10 });
  const plain = land(12, 'Forest');
  const byId = new Map([forest, growth, plain].map((c) => [c.id, c]));
  const player = { id: 0, zones: { battlefield: { cards: [forest, growth, plain] } } } as unknown as Parameters<typeof groupBattlefield>[0];

  it('the board hands the aura to its land: it is in no row of its own, and the land stands apart from its pile', () => {
    const g = groupBattlefield(player, byId);
    expect(g.other).toEqual([]);
    expect(g.creatures).toEqual([]);
    expect(g.lands.map((p) => p.map((c) => c.id))).toEqual([[10], [12]]);
    expect(g.landAtt.get(10)!.map((c) => c.id)).toEqual([11]);
    expect(g.landAtt.has(12)).toBe(false);
  });
  it('in a lands bar it is a chip after the land\'s tab, with its own id; where lands are cards, under the card', () => {
    for (const tab of [true, false]) {
      const html = renderToStaticMarkup(<LandPile cards={[forest]} attachments={[growth]} side="me" tab={tab} />);
      expect(html).toContain('has-attach');
      expect(html).toMatch(/class="tile-attach"><span class="attach-chip[^"]*"[^>]*aria-label="Attached: Wild Growth[^"]*"[^>]*data-card-id="11"/);
      if (tab) expect(html.indexOf('land-tab')).toBeLessThan(html.indexOf('tile-attach'));
      else expect(html).not.toContain('land-tab');
    }
    expect(renderToStaticMarkup(<LandPile cards={[plain]} side="me" tab />)).not.toContain('attach');
  });
  it('the chip carries a sizer for its name, as a land\'s tab does: the first 8 letters in one piece, the rest apart', () => {
    const html = renderToStaticMarkup(<LandPile cards={[forest]} attachments={[growth]} side="me" tab />);
    expect(html).toContain('<span class="attach-name"><span class="attach-text">Wild Growth</span><span class="attach-size" data-head="Wild\u00a0Gro" data-rest="wth"></span></span>');
    // A name of 8 letters or fewer is all head.
    const short = renderToStaticMarkup(<LandPile cards={[forest]} attachments={[{ ...growth, name: 'Overrun' }]} side="me" tab />);
    expect(short).toMatch(/<span class="attach-size" data-head="Overrun" data-rest=""><\/span>/);
  });
  it('a stack line to an attached card ends on its chip (it has no tile of its own): the lookup finds it after tiles and piles', () => {
    const chip = { querySelector: () => null, getBoundingClientRect: () => ({ left: 1, top: 2, right: 61, bottom: 26, width: 60, height: 24 }) };
    const asked: string[] = [];
    const g = globalThis as unknown as { document?: unknown; window?: unknown };
    const saved = { document: g.document, window: g.window };
    g.document = { querySelector: (sel: string) => (asked.push(sel), sel.includes('.attach-chip[data-card-id="11"]') ? chip : null) };
    g.window = { innerWidth: 1440, innerHeight: 900 };
    try {
      expect(domLookup('c:11')).toEqual({ x: 1, y: 2, width: 60, height: 24 });
      expect(asked.map((sel) => (sel.includes('.tile[') ? 'tile' : sel.includes('data-card-ids') ? 'pile' : 'chip'))).toEqual(['tile', 'pile', 'chip']);
      expect(domLookup('c:12')).toBeUndefined();
    } finally {
      g.document = saved.document;
      g.window = saved.window;
    }
  });
});
