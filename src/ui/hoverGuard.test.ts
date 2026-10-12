/*
 * ForgeCoach — ui/hoverGuard.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The hover preview's two guards, DOM-free: a pointer over a non-tile drops
 * the preview, a tile that unmounts while hovered drops it, a tile that was
 * never hovered (or has been left) does not.
 */
import { describe, expect, test } from 'vitest';
import { CARD_TILE_SELECTOR, HoverTracker, overCardTile, shouldClearHover, type ClosestLike } from './hoverGuard.ts';

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
