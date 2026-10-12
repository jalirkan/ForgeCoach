/*
 * ForgeCoach — ui/hoverGuard.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Keeps the desktop hover preview honest. The preview is driven by a tile's
 * pointerenter / pointerleave, but a tile that leaves the DOM under the mouse
 * (bottomed in a mulligan, cast from hand, died, returned to hand) fires no
 * leave, so the big card would hang mid-screen for the rest of the game. Two
 * guards close that: a tile clears its own hover when it unmounts (CardTile's
 * useOpen, via `HoverTracker`), and while a preview is up a document-level
 * pointermove clears it the moment the pointer is over something that is not
 * a card tile (`useHoverGuard`). The decisions are DOM-free so node tests them.
 */
import { useEffect } from 'react';

/** The part of an Element the guard needs; anything with `closest` will do. */
export interface ClosestLike {
  closest?(selector: string): unknown;
}

/** Every card tile, land pile and attachment chip carries `data-card-id`. */
export const CARD_TILE_SELECTOR = '[data-card-id]';

/** Whether a pointer event's target is (inside) a card tile. A missing target is not. */
export function overCardTile(target: ClosestLike | null | undefined): boolean {
  if (!target || typeof target.closest !== 'function') return false;
  return !!target.closest(CARD_TILE_SELECTOR);
}

/** Whether a preview that is showing `name` should be dropped for a move over `target`. */
export function shouldClearHover(name: string | null, target: ClosestLike | null | undefined): boolean {
  return name !== null && !overCardTile(target);
}

/**
 * One tile's hover: remembers whether this tile is the one the preview is
 * showing, so its unmount clears the preview only when it is.
 */
export class HoverTracker {
  private on = false;
  enter(): void {
    this.on = true;
  }
  leave(): void {
    this.on = false;
  }
  /** Call on unmount: true when the preview must be cleared (and forgets it). */
  unmount(): boolean {
    const was = this.on;
    this.on = false;
    return was;
  }
}

/** While `name` is showing, clear it on any pointermove over a non-tile. */
export function useHoverGuard(name: string | null, clear: () => void): void {
  useEffect(() => {
    if (name === null) return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      if (shouldClearHover(name, e.target as ClosestLike | null)) clear();
    };
    document.addEventListener('pointermove', onMove, { passive: true });
    return () => document.removeEventListener('pointermove', onMove);
  }, [name, clear]);
}
