/*
 * ForgeCoach — ui/hoverGuard.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Keeps the desktop hover preview honest. The preview is driven by a tile's
 * pointerenter / pointerleave, but a tile that leaves the DOM under the mouse
 * (bottomed in a mulligan, cast from hand, died, returned to hand) fires no
 * leave, so the big card would hang mid-screen for the rest of the game.
 * Three guards close that: a tile clears its own hover when it unmounts
 * (CardTile's useOpen, via `HoverTracker`); while a preview is up a
 * document-level pointermove (capture phase, so nothing can stop it on the
 * way) clears it the moment the pointer is over something that is not a card
 * tile (`useHoverGuard`); and after every frame the board draws, a preview
 * whose card is no longer drawn, whose tile left the document, or whose tile
 * the pointer is no longer on, is dropped (`useHoverOutlived`; 2026-10-15,
 * Borough Backup's preview stayed pinned for several turns after the pointer
 * left the hand). The decisions are DOM-free so node tests them.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';

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
    document.addEventListener('pointermove', onMove, { capture: true, passive: true });
    return () => document.removeEventListener('pointermove', onMove, { capture: true });
  }, [name, clear]);
}

/** The part of a tile element the frame check needs. */
export interface AnchorLike {
  readonly isConnected?: boolean;
  matches?(selector: string): boolean;
}

/** The board's hover: the name the preview shows, where, and the card (and tile) it came from. */
export interface HoverState {
  name: string | null;
  rect: DOMRect | null;
  /** The hovered card's id; null for a preview that is not a board card (a Game Log line). */
  cardId: number | null;
  /** The tile the pointer entered; null when unknown. */
  anchor: AnchorLike | null;
}

export const NO_HOVER: HoverState = { name: null, rect: null, cardId: null, anchor: null };

/** Where a hover came from: a card's id and its tile. */
export interface HoverSource {
  cardId: number;
  el: AnchorLike | null;
}

export function hoverOf(name: string | null, rect?: DOMRect, source?: HoverSource): HoverState {
  if (name === null) return NO_HOVER;
  return { name, rect: rect ?? null, cardId: source?.cardId ?? null, anchor: source?.el ?? null };
}

/**
 * Whether a showing preview has outlived its card: the card is no longer drawn
 * (`rendered`), its tile has left the document, or the pointer is no longer on
 * its tile (`:hover`; a leave the browser never sent). A preview with no card
 * id (a Game Log line) is left to its own leave.
 */
export function hoverOutlived(hover: HoverState, rendered: (cardId: number) => boolean): boolean {
  if (hover.name === null || hover.cardId === null) return false;
  if (!rendered(hover.cardId)) return true;
  const el = hover.anchor;
  if (!el) return false;
  if (el.isConnected === false) return true;
  return typeof el.matches === 'function' && !el.matches(':hover');
}

/** Whether a card is drawn anywhere on the page: a tile, a land pile (any of its lands) or a chip. */
export function cardRendered(cardId: number, root: { querySelector(selector: string): unknown } = document): boolean {
  return !!root.querySelector(`[data-card-id="${cardId}"], [data-card-ids~="${cardId}"]`);
}

/**
 * After every frame the board draws (`frame`: the state it shows, which holds
 * the card list), drop a preview that has outlived its card ({@link hoverOutlived}).
 */
export function useHoverOutlived(hover: HoverState, clear: () => void, frame: unknown): void {
  const current = useRef(hover);
  current.current = hover;
  useLayoutEffect(() => {
    if (hoverOutlived(current.current, (id) => cardRendered(id))) clear();
  }, [frame, clear]);
}

/** A box on the screen (px, viewport): what the preview's place is worked out from. */
export interface ScreenBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The preview's size (px): a card, big enough to read. */
export const PREVIEW = { w: 244, h: 340, gap: 12, edge: 8 } as const;

/**
 * Where the hover preview goes: beside its tile (to the right while there is room, else to the left), centred
 * on it and kept on the screen.
 *
 * A land in the desktop table's lands bar (ui/cards.css; `bar` is the bar's box, its land cards up) is
 * different: its neighbours are the other lands, and the bar is pointed at to see them. So there the preview
 * stays clear of the whole bar: above it, over its own land, while it fits on the screen; else below it (the
 * opponent's bar: theirs is the upper half, with no room for a card above its lands); else beside it.
 */
export function previewPlace(tile: ScreenBox, bar: ScreenBox | null, vw: number, vh: number, k: { w: number; h: number; gap: number; edge: number } = PREVIEW): { left: number; top: number } {
  const clampTop = (top: number) => Math.min(Math.max(k.edge, top), vh - k.h - k.edge);
  if (bar) {
    const left = Math.min(Math.max(k.edge, (tile.left + tile.right) / 2 - k.w / 2), vw - k.w - k.edge);
    const above = bar.top - k.gap - k.h;
    if (above >= k.edge) return { left, top: above };
    const below = bar.bottom + k.gap;
    if (below + k.h <= vh - k.edge) return { left, top: below };
    if (bar.right + k.gap + k.w < vw) return { left: bar.right + k.gap, top: clampTop((bar.top + bar.bottom) / 2 - k.h / 2) };
  }
  const right = tile.right + k.gap + k.w < vw;
  const left = right ? tile.right + k.gap : Math.max(k.edge, tile.left - k.gap - k.w);
  return { left, top: clampTop((tile.top + tile.bottom) / 2 - k.h / 2) };
}

/** The desktop table's lands bar a tile stands in (ui/cards.css), if it does. */
export const LANDS_BAR = '.game.play.is-wide .play-board .bf-row-lands';
