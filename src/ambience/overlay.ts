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
 *
 * Full-area pieces (spec 1.4, `anchor: "area"`): one picture across the whole
 * area, owned like the long edges by the dominant biome, counting as one
 * piece in the caps, shown only from its `minWidthPx` (default 600 px) and
 * still in the corners-only fit. {@link areaPlacement} works out how it is
 * cropped so its `safe` rect stays visible.
 */
import { dominantBiome } from './effects.ts';
import { slotLayout } from './layout.ts';
import type { Biome, SlotState } from './model.ts';
import { AREA_MIN_WIDTH_PX, isOverlayCorner, MAX_OVERLAY_ANIMATED, MAX_OVERLAY_PIECES, OVERLAY_DEFAULTS, overlayAt, type Anchor, type AreaRect, type BuiltinOverlay, type OverlayAnchor, type OverlayArea, type OverlayMotion, type OverlayPiece, type ScenePack } from './manifest.ts';

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
  if (anchor === 'top-edge' || anchor === 'bottom-edge' || anchor === 'area') return 'span';
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

/** The corner kind each biome's built-in accents use (the full-area placeholder draws the same family). */
const BUILTIN_KIND: Record<Biome, BuiltinOverlay> = { forest: 'vine', island: 'frost', mountain: 'ash', swamp: 'moss', plains: 'petals', wastes: 'dust' };

/**
 * The built-in full-area placeholder (spec 1.4) for a biome at a stage: a
 * sparse scatter of marks that thickens with the stage, from stage 2 (null at
 * stage 1 and below). Used only where asked (`#ambience`'s preview), never on
 * the board by default, so the board's built-in accents are as in 1.3.
 */
export function builtinAreaPiece(biome: Biome, stage: number): OverlayPiece | null {
  if (stage < 2) return null;
  const level = Math.min(stage, 4);
  return { ...piece(`area`, 'area', BUILTIN_KIND[biome], { opacity: 0.9, size: 1, maxPx: 4096, tile: 'stretch', motion: level >= 4 ? 'breathe' : 'none', periodMs: 14000 }), area: { ...DEFAULT_AREA }, builtinLevel: level };
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
  /** Spec 1.4 preview: give the dominant biome the built-in full-area placeholder when its own pieces have no area piece. */
  builtinArea?: boolean;
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
    let own = biomeOverlay(pack, biome, stageOf.get(biome) ?? 1);
    if (opts.builtinArea && biome === owner.span && !own.some((p) => p.anchor === 'area')) {
      const area = builtinAreaPiece(biome, stageOf.get(biome) ?? 1);
      if (area) own = [area, ...own];
    }
    for (const p of own) {
      const group = anchorGroup(p.anchor);
      if (owner[group] !== biome) continue;
      if (p.area) {
        // Full-area (1.4): from its own minimum width; in the corners-only fit it may still show, still.
        if (opts.widthPx !== null && opts.widthPx < p.area.minWidthPx) continue;
      } else if (fit.mode === 'corners' && !isOverlayCorner(p.anchor)) continue;
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

// ---------------------------------------------------------------------------
// Full-area pieces (spec 1.4): how the picture fills the area.

/** CSS object-position for an anchor name (as layers' `anchor`). */
export const POSITION_CSS: Record<Anchor, string> = {
  center: '50% 50%',
  top: '50% 0%',
  bottom: '50% 100%',
  left: '0% 50%',
  right: '100% 50%',
  'top-left': '0% 0%',
  'top-right': '100% 0%',
  'bottom-left': '0% 100%',
  'bottom-right': '100% 100%',
};

/** The built-in placeholder's area options (an even scatter: no safe rect). */
export const DEFAULT_AREA: OverlayArea = { fit: 'cover', safe: null, position: 'center', minWidthPx: AREA_MIN_WIDTH_PX };

export interface AreaPlacement {
  /** The object-fit actually used: `cover` falls back to `contain` when cropping would cut into the safe rect. */
  fit: 'cover' | 'contain';
  /** CSS object-position. */
  position: string;
  /** Is the safe rect (or, with none, the whole picture under contain) fully visible? */
  safeVisible: boolean;
}

/**
 * How a full-area picture of `img` pixels fills a `box` (the player's area,
 * in CSS px): `contain` shows it whole, placed by `position`; `cover` crops
 * it, keeping the `safe` rect visible and as near the middle as the crop
 * allows, or, with no safe rect, cropping by `position`. When the area's
 * shape would crop into the safe rect, the picture is drawn `contain`
 * instead (the safe rect is a promise). Sizes unknown (0): by name only.
 */
export function areaPlacement(img: { w: number; h: number }, box: { w: number; h: number }, area: OverlayArea): AreaPlacement {
  const named = POSITION_CSS[area.position] ?? POSITION_CSS.center;
  if (area.fit === 'contain' || !area.safe) return { fit: area.fit, position: named, safeVisible: area.fit === 'contain' };
  if (!(img.w > 0 && img.h > 0 && box.w > 0 && box.h > 0)) return { fit: 'cover', position: named, safeVisible: false };
  const s = Math.max(box.w / img.w, box.h / img.h);
  const dw = img.w * s;
  const dh = img.h * s;
  const axis = (start: number, size: number, shown: number, drawn: number): { pct: number; ok: boolean } => {
    const over = drawn - shown;
    if (over <= 0.5) return { pct: 50, ok: true };
    const a = start * drawn;
    const len = size * drawn;
    if (len > shown + 0.5) return { pct: 50, ok: false };
    // Centre on the safe rect, then slide just enough to keep it inside the box.
    const off = Math.min(over, Math.max(0, a + len / 2 - shown / 2));
    return { pct: +((off / over) * 100).toFixed(2), ok: true };
  };
  const safe: AreaRect = area.safe;
  const x = axis(safe.x, safe.w, box.w, dw);
  const y = axis(safe.y, safe.h, box.h, dh);
  if (!x.ok || !y.ok) return { fit: 'contain', position: named, safeVisible: true };
  return { fit: 'cover', position: `${x.pct}% ${y.pct}%`, safeVisible: true };
}
