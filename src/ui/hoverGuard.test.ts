/*
 * ForgeCoach — ui/hoverGuard.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The hover preview's three guards, DOM-free: a pointer over a non-tile drops
 * the preview, a tile that unmounts while hovered drops it, a tile that was
 * never hovered (or has been left) does not; and after a frame, a preview
 * whose card is no longer drawn, or whose tile the pointer has left without a
 * leave event, is dropped (2026-10-15: Borough Backup's preview stayed pinned
 * bottom-right for several turns after the pointer left the hand).
 */
import { describe, expect, test } from 'vitest';
import {
  CARD_TILE_SELECTOR,
  HoverTracker,
  NO_HOVER,
  cardRendered,
  hoverOf,
  hoverOutlived,
  overCardTile,
  shouldClearHover,
  type AnchorLike,
  type ClosestLike,
} from './hoverGuard.ts';

const tile: ClosestLike = { closest: (sel) => (sel === CARD_TILE_SELECTOR ? {} : null) };
const bare: ClosestLike = { closest: () => null };

describe('overCardTile', () => {
  test('a target inside a tile', () => expect(overCardTile(tile)).toBe(true));
  test('a target outside any tile', () => expect(overCardTile(bare)).toBe(false));
  test('no target, or a non-element target (document, window)', () => {
    expect(overCardTile(null)).toBe(false);
    expect(overCardTile(undefined)).toBe(false);
    expect(overCardTile({})).toBe(false);
  });
});

describe('shouldClearHover', () => {
  test('clears when the pointer is over something that is not a tile', () => expect(shouldClearHover('Shock', bare)).toBe(true));
  test('keeps the preview while the pointer is on a tile', () => expect(shouldClearHover('Shock', tile)).toBe(false));
  test('nothing showing: nothing to clear', () => expect(shouldClearHover(null, bare)).toBe(false));
});

describe('HoverTracker', () => {
  test('unmounting the hovered tile asks for a clear, once', () => {
    const t = new HoverTracker();
    t.enter();
    expect(t.unmount()).toBe(true);
    expect(t.unmount()).toBe(false);
  });
  test('a tile never hovered, or already left, does not clear another tile\'s preview', () => {
    const fresh = new HoverTracker();
    expect(fresh.unmount()).toBe(false);
    const left = new HoverTracker();
    left.enter();
    left.leave();
    expect(left.unmount()).toBe(false);
  });
});

/** A page in miniature: which card ids are drawn (tiles and land piles), as `cardRendered` asks. */
function page(tiles: number[], piles: number[][] = []) {
  const drawn = new Set(tiles);
  return {
    drawn,
    piles,
    querySelector(selector: string): unknown {
      const one = /\[data-card-id="(\d+)"\]/.exec(selector);
      const many = /\[data-card-ids~="(\d+)"\]/.exec(selector);
      if (one && drawn.has(Number(one[1]))) return {};
      if (many && piles.some((p) => p.includes(Number(many[1])))) return {};
      return null;
    },
  };
}

/** A tile element: in the document or not, under the pointer or not. */
function tileEl(): AnchorLike & { isConnected: boolean; hovered: boolean } {
  const el = {
    isConnected: true,
    hovered: true,
    matches: (sel: string) => sel === ':hover' && el.hovered,
  };
  return el;
}

const RECT = { left: 600, top: 700, right: 700, bottom: 840, width: 100, height: 140 } as DOMRect;

describe('cardRendered', () => {
  test('a tile, or any land of a pile, is drawn; anything else is not', () => {
    const p = page([41], [[7, 8, 9]]);
    expect(cardRendered(41, p)).toBe(true);
    expect(cardRendered(8, p)).toBe(true);
    expect(cardRendered(42, p)).toBe(false);
  });
});

describe('a preview that outlives its card (the frame check)', () => {
  test('hovering a hand card: the preview stays while the pointer is on its tile', () => {
    const p = page([41, 42]);
    const el = tileEl();
    const hover = hoverOf('Borough Backup', RECT, { cardId: 41, el });
    expect(hover.name).toBe('Borough Backup');
    expect(hoverOutlived(hover, (id) => cardRendered(id, p))).toBe(false);
  });

  test('the pointer left the hand and no leave came: gone at the next frame', () => {
    const p = page([41, 42]);
    const el = tileEl();
    const hover = hoverOf('Borough Backup', RECT, { cardId: 41, el });
    el.hovered = false;
    expect(hoverOutlived(hover, (id) => cardRendered(id, p))).toBe(true);
  });

  test('the card left the board (cast, died, bottomed): gone, by its id', () => {
    const p = page([41, 42]);
    const hover = hoverOf('Borough Backup', RECT, { cardId: 41, el: null });
    expect(hoverOutlived(hover, (id) => cardRendered(id, p))).toBe(false);
    p.drawn.delete(41);
    expect(hoverOutlived(hover, (id) => cardRendered(id, p))).toBe(true);
  });

  test('its tile left the document though a card of that id is drawn elsewhere: gone', () => {
    const p = page([41]);
    const el = tileEl();
    const hover = hoverOf('Borough Backup', RECT, { cardId: 41, el });
    el.isConnected = false;
    expect(hoverOutlived(hover, (id) => cardRendered(id, p))).toBe(true);
  });

  test('a preview with no card (a Game Log line) and no preview at all are left alone', () => {
    const p = page([]);
    expect(hoverOutlived(hoverOf('Shock', RECT), (id) => cardRendered(id, p))).toBe(false);
    expect(hoverOutlived(NO_HOVER, (id) => cardRendered(id, p))).toBe(false);
    expect(hoverOf(null, RECT, { cardId: 41, el: tileEl() })).toBe(NO_HOVER);
  });
});
