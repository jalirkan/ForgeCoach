/*
 * ForgeCoach — ambience/overlay.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Board accents (spec 1.3): which corner and edge pieces a player's area
 * shows, from their scenery slots and the pack's `overlay` lists (or the
 * built-in placeholders), and how they fit the area's width. Pure; the
 * drawing is ui/ambience/SceneryOverlay.tsx.
 *
 * Several biomes: split by slot. The strip runs left to right in slot order,
 * so the accents follow it: left corners and the left edge come from the
 * leftmost live slot's biome, right corners and the right edge from the
 * rightmost, and the top and bottom edges (which span the area) from the
 * dominant biome (the most land weight). A lone biome owns every anchor. Each
 * biome's pieces are those of its own stage.
 *
 * Mirroring: pieces are authored for the viewer's side, where the player's
 * outer edge is the bottom. On the opponent's side (the top of the board) a
 * piece with `mirror` (the default) swaps top and bottom and is flipped
 * vertically, so it hugs their outer edge; `mirror: false` keeps it as drawn.
 */
import { dominantBiome } from './effects.ts';
import { slotLayout } from './layout.ts';
import type { Biome, SlotState } from './model.ts';
import { isOverlayCorner, MAX_OVERLAY_ANIMATED, MAX_OVERLAY_PIECES, OVERLAY_DEFAULTS, overlayAt, type BuiltinOverlay, type OverlayAnchor, type OverlayMotion, type OverlayPiece, type ScenePack } from './manifest.ts';

/** Below this player-area width, only corners show, smaller and still. */
export const OVERLAY_CORNERS_ONLY_PX = 600;
/** Below this, no accents at all. */
export const OVERLAY_HIDDEN_PX = 300;
/** The corner pixel cap in corners-only mode. */
export const OVERLAY_SMALL_MAX_PX = 88;

export type OverlayFit = { mode: 'full' | 'corners' | 'hidden'; maxPx: number | null };

/** What fits an area this wide: everything, corners only (capped), or nothing. */
export function overlayFit(widthPx: number): OverlayFit {
  if (!(widthPx >= OVERLAY_HIDDEN_PX)) return { mode: 'hidden', maxPx: null };
  if (widthPx < OVERLAY_CORNERS_ONLY_PX) return { mode: 'corners', maxPx: OVERLAY_SMALL_MAX_PX };
  return { mode: 'full', maxPx: null };
}

/** Where a piece goes on a side: the opponent's (`top`) side swaps top and bottom when it mirrors. */
export function mirrorAnchor(anchor: OverlayAnchor, side: 'top' | 'bottom', mirror: boolean): { anchor: OverlayAnchor; flipY: boolean } {
  if (side === 'bottom' || !mirror) return { anchor, flipY: false };
  const swapped = anchor.replace(/^top/, '\0').replace(/^bottom/, 'top').replace('\0', 'bottom') as OverlayAnchor;
  return { anchor: swapped, flipY: true };
}

/** Which biome owns an anchor: `left` and `right` groups follow the outer slots; the long edges follow the dominant biome. */
export function anchorGroup(anchor: OverlayAnchor): 'left' | 'right' | 'span' {
  if (anchor === 'top-edge' || anchor === 'bottom-edge') return 'span';
  return anchor.includes('left') ? 'left' : 'right';
}

// ---------------------------------------------------------------------------
// Built-in placeholders: subtle procedural accents, so the feature shows with no pack.

const piece = (id: string, anchor: OverlayAnchor, builtin: BuiltinOverlay, extra: Partial<OverlayPiece> = {}): OverlayPiece => {
  const d = isOverlayCorner(anchor) ? OVERLAY_DEFAULTS.corner : OVERLAY_DEFAULTS.edge;
  return { id, anchor, src: null, src2x: null, builtin, size: d.size, maxPx: d.maxPx, tile: 'repeat', opacity: 0.7, blend: 'normal', motion: 'none', periodMs: 9000, mirror: true, bytes: null, ...extra };
};

/**
 * A corner placeholder that grows with the stage, a second corner from stage
 * 2, a band along the outer edge from stage 3, and from stage 4 bands creeping
 * up both side edges (five pieces, the two corners moving).
 */
function grows(corner: BuiltinOverlay, edge: BuiltinOverlay, motion: OverlayMotion, opts: { opacity?: number; blend?: OverlayPiece['blend'] } = {}): OverlayPiece[][] {
  const o = { opacity: opts.opacity ?? 0.85, blend: opts.blend ?? 'normal' };
  const a = (size: number, maxPx: number) => piece('bl', 'bottom-left', corner, { ...o, size, maxPx, motion, periodMs: 11000 });
  const b = (size: number, maxPx: number) => piece('br', 'bottom-right', corner, { ...o, size, maxPx, motion, periodMs: 13000 });
  const e = (size: number) => piece('edge', 'bottom-edge', edge, { ...o, opacity: o.opacity * 0.85, size, maxPx: 44 });
  const side = (id: string, anchor: OverlayAnchor) => piece(id, anchor, edge, { ...o, opacity: o.opacity * 0.75, size: 0.03, maxPx: 34 });
  return [[a(0.12, 140)], [a(0.15, 180), b(0.12, 140)], [a(0.18, 220), b(0.15, 180), e(0.03)], [a(0.22, 260), b(0.18, 220), e(0.04), side('left', 'left-edge'), side('right', 'right-edge')]];
}

/** The built-in accents per biome: vines for forest, frost and spray for island, ash and embers for mountain, moss for swamp, petals for plains, dust for wastes. */
export const BUILTIN_OVERLAY: Record<Biome, OverlayPiece[][]> = {
  forest: grows('vine', 'leaves', 'sway'),
  island: grows('frost', 'spray', 'breathe'),
  mountain: grows('ash', 'embers', 'drift', { opacity: 0.8 }),
  swamp: grows('moss', 'mist', 'breathe'),
  plains: grows('petals', 'motes', 'drift'),
  wastes: grows('dust', 'motes', 'drift', { opacity: 0.7 }),
};

/** A biome's accents at a stage: the pack's when it gives them, else the built-in when the biome draws the built-in scene, else none. */
export function biomeOverlay(pack: ScenePack | null, biome: Biome, stage: number): OverlayPiece[] {
  const own = overlayAt(pack?.overlays?.[biome], stage);
  if (own) return own;
  // A pack biome with its own art and no accents (a 1.2 pack) looks as it did.
  if (pack?.biomes[biome]) return [];
  if (stage <= 0) return [];
  const st = BUILTIN_OVERLAY[biome];
  return st[Math.min(stage, st.length) - 1] ?? [];
}

/** One accent piece placed in a player's area. */
export interface PlacedOverlay {
  /** Stable across renders (biome and piece id), so a kept piece does not appear again. */
  key: string;
  biome: Biome;
  piece: OverlayPiece;
  /** After mirroring. */
  anchor: OverlayAnchor;
  flipY: boolean;
  /** The pixel cap after the fit (corners-only mode caps it lower). */
  maxPx: number;
  /** Moves (CSS), within the per-area budget and not with reduced motion. */
  animate: boolean;
}

export interface OverlayOptions {
  side: 'top' | 'bottom';
  /** The area's width in px (null: unknown yet, treated as full). */
  widthPx: number | null;
  reduced: boolean;
  /** The preview page's stage slider. */
  stageOverride?: number | null;
}

/**
 * The accent pieces for one player's area: split by slot (see the file
 * header), mirrored for the side, fitted to the width, at most
 * {@link MAX_OVERLAY_PIECES} (the dominant biome's first) and at most
 * {@link MAX_OVERLAY_ANIMATED} moving. Withered slots (their lands gone) give none.
 */
export function overlayPieces(slots: SlotState[], pack: ScenePack | null, opts: OverlayOptions): PlacedOverlay[] {
  const fit = opts.widthPx === null ? overlayFit(Infinity) : overlayFit(opts.widthPx);
  if (fit.mode === 'hidden') return [];
  const layout = slotLayout(slots, pack, opts.stageOverride ?? null).filter((l) => l.stage > 0);
  if (!layout.length) return [];
  const stageOf = new Map(layout.map((l) => [l.slot.biome, l.stage]));
  const owner: Record<'left' | 'right' | 'span', Biome> = {
    left: layout[0]!.slot.biome,
    right: layout[layout.length - 1]!.slot.biome,
    span: dominantBiome(layout.map((l) => l.slot)) ?? layout[0]!.slot.biome,
  };
  // The dominant biome's pieces first, so the cap trims the minor biomes.
  const order = [...new Set([owner.span, owner.left, owner.right])];
  const out: PlacedOverlay[] = [];
  for (const biome of order) {
    for (const p of biomeOverlay(pack, biome, stageOf.get(biome) ?? 1)) {
      const group = anchorGroup(p.anchor);
      if (owner[group] !== biome) continue;
      if (fit.mode === 'corners' && !isOverlayCorner(p.anchor)) continue;
      const m = mirrorAnchor(p.anchor, opts.side, p.mirror);
      // One piece per anchor and id; a later biome does not stack on the same corner twice.
      if (out.some((o) => o.anchor === m.anchor && o.piece.id === p.id)) continue;
      out.push({ key: `${biome}:${p.id}:${p.anchor}`, biome, piece: p, anchor: m.anchor, flipY: m.flipY, maxPx: fit.maxPx === null ? p.maxPx : Math.min(p.maxPx, fit.maxPx), animate: false });
    }
  }
  const capped = out.slice(0, MAX_OVERLAY_PIECES);
  let moving = 0;
  for (const o of capped) {
    if (opts.reduced || fit.mode !== 'full' || o.piece.motion === 'none') continue;
    if (moving >= MAX_OVERLAY_ANIMATED) continue;
    moving++;
    o.animate = true;
  }
  return capped;
}
