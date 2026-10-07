/*
 * ForgeCoach — ambience/layout.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Where each slot sits in a strip and how wide it is. Pure.
 *
 * Order: by arrival (the first land's biome on the left), or — when the pack
 * asks for `strip.order: "preference"` — biomes that prefer the left first and
 * those that prefer the right last, arrival order within each group.
 * Width: a flex weight that grows a little with the stage (a richer scene
 * takes more room) times the pack's per-biome weight.
 *
 * Also the placement of a picture inside its layer box: the `anchor` as
 * fractions / CSS object-position, and a sprite frame's rectangle for each
 * `fit` (images get this from CSS object-fit; a sprite sheet cannot, so its
 * frame window is sized here with container-query units of the box).
 *
 * Spec 1.5, the half board: each player's whole half is shared between their
 * biomes in proportion to their lands (no live panel under `minShare`), and
 * each slot shows its art in a *frame* of the art's shape, cover-cropped to
 * the slot about a focal point while keeping a safe rect whole
 * ({@link halfFrame}, and {@link halfFrameCss}, its CSS twin in container
 * units, so the crop follows the slot's size with no script).
 */
import type { SlotState } from './model.ts';
import { DEFAULT_HALF_LAYOUT, halfAt, type Anchor, type AreaRect, type Fit, type FocalPoint, type HalfPicture, type PackHalf, type ScenePack } from './manifest.ts';

export interface SlotLayout {
  slot: SlotState;
  /** Stage to draw (the override from the preview page, else the slot's own). */
  stage: number;
  grow: number;
}

export function slotLayout(slots: SlotState[], pack: ScenePack | null, stageOverride: number | null = null): SlotLayout[] {
  const rank = (s: SlotState) => {
    if (pack?.strip.order !== 'preference') return 0;
    const pref = pack.biomes[s.biome]?.slot.prefer ?? 'any';
    return pref === 'left' ? 0 : pref === 'right' ? 2 : 1;
  };
  const ordered = [...slots].sort((a, b) => rank(a) - rank(b) || a.index - b.index);
  return ordered.map((slot) => {
    const stage = stageOverride !== null && slot.stage > 0 ? stageOverride : slot.stage;
    const weight = pack?.biomes[slot.biome]?.slot.weight ?? 1;
    // A withered slot (its lands gone) keeps a sliver of room.
    const grow = (stage > 0 ? 1 + 0.18 * (stage - 1) : 0.45) * weight;
    return { slot, stage, grow: Math.round(grow * 100) / 100 };
  });
}

/** An anchor as fractions of the free space: x 0 = left … 1 = right, y 0 = top … 1 = bottom. */
export function anchorFractions(anchor: Anchor): { x: number; y: number } {
  const parts = anchor.split('-');
  const x = parts.includes('left') ? 0 : parts.includes('right') ? 1 : 0.5;
  const y = parts.includes('top') ? 0 : parts.includes('bottom') ? 1 : 0.5;
  return { x, y };
}

/** CSS `object-position` / `background-position` for an anchor, e.g. `50% 100%` for `bottom`. */
export function objectPosition(anchor: Anchor): string {
  const { x, y } = anchorFractions(anchor);
  return `${x * 100}% ${y * 100}%`;
}

/** One sprite frame's aspect (width / height) from the sheet's natural size, or null when unknown. */
export function frameAspect(sheetW: number, sheetH: number, cols: number, rows: number): number | null {
  if (!(sheetW > 0 && sheetH > 0 && cols > 0 && rows > 0)) return null;
  const a = sheetW / cols / (sheetH / rows);
  return Number.isFinite(a) && a > 0 ? a : null;
}

/** A frame window in the layer box, as fractions of the box's width and height (left/top from the box's top-left). */
export interface FrameRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where a picture of `aspect` (w / h) sits in a box of `boxAspect` for a fit and
 * anchor, as fractions of the box (may exceed 0..1 with `cover`). The same math
 * as CSS object-fit / object-position; {@link spriteFrameCss} is its CSS form.
 */
export function fitRect(boxAspect: number, aspect: number | null, fit: Fit, anchor: Anchor): FrameRect {
  if (fit === 'fill' || !aspect || !(boxAspect > 0)) return { left: 0, top: 0, width: 1, height: 1 };
  // Width as a fraction of the box's width when the picture's height fills the box.
  const widthAtFullHeight = aspect / boxAspect;
  const fullHeight = fit === 'contain' ? widthAtFullHeight <= 1 : widthAtFullHeight >= 1;
  const width = fullHeight ? widthAtFullHeight : 1;
  const height = fullHeight ? 1 : boxAspect / aspect;
  const { x, y } = anchorFractions(anchor);
  return { left: (1 - width) * x || 0, top: (1 - height) * y || 0, width, height };
}

/**
 * The CSS for a sprite's frame window inside its box (the box must be a size
 * container: `cqw` / `cqh` are its width and height). With no aspect yet (the
 * sheet has not loaded) or `fill`, the window is the whole box.
 */
export function spriteFrameCss(aspect: number | null, fit: Fit, anchor: Anchor): { left: string; top: string; width: string; height: string } {
  if (fit === 'fill' || !aspect) return { left: '0', top: '0', width: '100%', height: '100%' };
  const a = Math.round(aspect * 10000) / 10000;
  const pick = fit === 'contain' ? 'min' : 'max';
  const width = `${pick}(100cqw, ${a} * 100cqh)`;
  const height = `calc(${width} / ${a})`;
  const { x, y } = anchorFractions(anchor);
  return { left: `calc((100cqw - ${width}) * ${x})`, top: `calc((100cqh - ${height}) * ${y})`, width, height };
}

/**
 * The centre of a biome's slot across the strip, 0..1 (slots share the width
 * by their `grow`), or null when the strip has no such slot.
 */
export function slotCentre(slots: SlotState[], pack: ScenePack | null, biome: string | null, stageOverride: number | null = null): number | null {
  if (!biome) return null;
  const layout = slotLayout(slots, pack, stageOverride);
  const total = layout.reduce((n, l) => n + l.grow, 0);
  if (!(total > 0)) return null;
  let left = 0;
  for (const l of layout) {
    if (l.slot.biome === biome) return (left + l.grow / 2) / total;
    left += l.grow;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The half board (spec 1.5)

/** A slot on the half board: its share of the half's width (the shares sum to 1). */
export interface HalfSlotLayout extends SlotLayout {
  share: number;
}

/**
 * How a player's half is split between their biomes: in proportion to their
 * land weight (5 Islands : 1 Mountain is 5 : 1), every live biome at least
 * `minShare` of the width, a withered one (its lands gone) half that. Same
 * order as the strip ({@link slotLayout}); each slot keeps its own stage.
 */
export function halfLayout(slots: SlotState[], pack: ScenePack | null, stageOverride: number | null = null): HalfSlotLayout[] {
  const layout = slotLayout(slots, pack, stageOverride);
  if (!layout.length) return [];
  const min = (pack?.half ?? DEFAULT_HALF_LAYOUT).minShare;
  const floor = layout.map((l) => (l.stage > 0 && l.slot.weight > 0 ? min : min / 2));
  const raw = layout.map((l) => (l.stage > 0 ? Math.max(0, l.slot.weight) : 0));
  // Water-filling: a slot under its floor is pinned there, the rest share what is left by weight.
  const pinned = layout.map(() => false);
  let shares = layout.map(() => 1 / layout.length);
  for (let pass = 0; pass <= layout.length; pass++) {
    const left = 1 - floor.reduce((n, f, i) => n + (pinned[i] ? f : 0), 0);
    const total = raw.reduce((n, r, i) => n + (pinned[i] ? 0 : r), 0);
    const free = pinned.filter((p) => !p).length;
    shares = layout.map((_, i) => (pinned[i] ? floor[i]! : total > 0 ? (left * raw[i]!) / total : left / free));
    const under = shares.findIndex((v, i) => !pinned[i] && v < floor[i]! - 1e-9);
    if (under < 0) break;
    // Pin every slot under its floor at once.
    shares.forEach((v, i) => {
      if (!pinned[i] && v < floor[i]! - 1e-9) pinned[i] = true;
    });
  }
  return layout.map((l, i) => ({ ...l, grow: Math.round(shares[i]! * 1000) / 1000, share: Math.round(shares[i]! * 1000) / 1000 }));
}

/** The art frame a slot shows on the half: the art's shape (width / height), its focal point and safe rect. */
export interface HalfArt {
  aspect: number;
  focal: FocalPoint;
  safe: AreaRect | null;
  /** `half` / `phone`: a spec 1.5 half picture (desktop or phone shape); `strip`: an older pack's (or the built-in) strip art, cover-cropped. */
  source: 'half' | 'phone' | 'strip';
  /** The picture to draw (null for strip art: the stage's layers). */
  picture?: HalfPicture | null;
}

/** Strip art (older packs, the built-in scenery) is 4:1 (the spec's 2048 × 512 backdrops), its horizon ~57% up: anchored there. */
export const STRIP_ART: HalfArt = { aspect: 4, focal: { x: 0.5, y: 0.43 }, safe: null, source: 'strip', picture: null };

const shape = (p: HalfPicture) => Math.round((p.width / p.height) * 10000) / 10000;

/**
 * Which picture of a stage's `half` a panel of `panelAspect` (width / height)
 * shows: the phone picture when the panel's shape is nearer the phone's than
 * the desktop's (on a log scale: 1:1 is as far from 4:1 as from 1:4), else
 * the desktop picture. Unknown shape: the desktop picture.
 */
export function pickHalfPicture(h: PackHalf, panelAspect: number | null): { picture: HalfPicture; phone: boolean } {
  if (!h.phone || !(panelAspect !== null && panelAspect > 0)) return { picture: h, phone: false };
  const d = (p: HalfPicture) => Math.abs(Math.log(panelAspect / shape(p)));
  return d(h.phone) < d(h) ? { picture: h.phone, phone: true } : { picture: h, phone: false };
}

/** The frame for a picture of a stage's `half`, or the strip art's. */
export function halfArtOf(h: PackHalf | null, panelAspect: number | null = null): HalfArt {
  if (!h) return STRIP_ART;
  const { picture, phone } = pickHalfPicture(h, panelAspect);
  return { aspect: shape(picture), focal: picture.focal, safe: picture.safe, source: phone ? 'phone' : 'half', picture };
}

/** The frame for a biome at a stage in a panel of `panelAspect`: its half picture when the pack has one (spec 1.5), else the strip art. */
export function halfArt(pack: ScenePack | null, biome: SlotState['biome'], stage: number, panelAspect: number | null = null): HalfArt {
  return halfArtOf(halfAt(pack?.biomes[biome], Math.max(1, stage)), panelAspect);
}

/**
 * One axis of a cover crop: how far (in the drawn picture's units) the view
 * starts into it. The focal point as near the view's middle as the picture
 * allows; the safe span kept whole when it fits, else centred.
 */
function cropAxis(shown: number, drawn: number, focal: number, safeStart: number | null, safeSize: number | null): number {
  const over = Math.max(0, drawn - shown);
  const val = focal * drawn - shown / 2;
  let lo = 0;
  let hi = over;
  if (safeStart !== null && safeSize !== null) {
    lo = Math.min(over, Math.max(0, (safeStart + safeSize) * drawn - shown));
    hi = Math.min(over, safeStart * drawn);
  }
  const mid = (lo + hi) / 2;
  return Math.max(Math.min(lo, mid), Math.min(val, Math.max(hi, mid)));
}

/**
 * Where an art frame of `art.aspect` sits in a slot of `box` px, cover-cropped
 * (fractions of the box, as {@link fitRect}; left / top ≤ 0). The same math as
 * {@link halfFrameCss}.
 */
export function halfFrame(box: { w: number; h: number }, art: Pick<HalfArt, 'aspect' | 'focal' | 'safe'>): FrameRect {
  if (!(box.w > 0 && box.h > 0 && art.aspect > 0)) return { left: 0, top: 0, width: 1, height: 1 };
  const dw = Math.max(box.w, box.h * art.aspect);
  const dh = dw / art.aspect;
  const s = art.safe;
  const ox = cropAxis(box.w, dw, art.focal.x, s ? s.x : null, s ? s.w : null);
  const oy = cropAxis(box.h, dh, art.focal.y, s ? s.y : null, s ? s.h : null);
  const r = (n: number) => Math.round(n * 10000) / 10000;
  return { left: r(-ox / box.w) || 0, top: r(-oy / box.h) || 0, width: r(dw / box.w), height: r(dh / box.h) };
}

/**
 * {@link halfFrame} as CSS for an element inside a size container (the slot):
 * `cqw` / `cqh` are the slot's width and height, so the crop follows the slot
 * as it grows with no script. CSS `clamp(lo, v, hi)` is `max(lo, min(v, hi))`,
 * the same as cropAxis with its bounds pre-ordered.
 */
export function halfFrameCss(art: Pick<HalfArt, 'aspect' | 'focal' | 'safe'>): { left: string; top: string; width: string; height: string } {
  const f = (n: number) => String(Math.round(n * 10000) / 10000);
  const a = f(art.aspect);
  const dw = `max(100cqw, ${a} * 100cqh)`;
  const dh = `(${dw} / ${a})`;
  const axis = (shown: string, drawn: string, focal: number, start: number | null, size: number | null) => {
    const over = `(${drawn} - ${shown})`;
    const val = `(${f(focal)} * ${drawn} - ${shown} / 2)`;
    if (start === null || size === null) return `clamp(0px, ${val}, ${over})`;
    const lo = `min(${over}, max(0px, ${f(start + size)} * ${drawn} - ${shown}))`;
    const hi = `min(${over}, ${f(start)} * ${drawn})`;
    const mid = `((${lo} + ${hi}) / 2)`;
    return `clamp(min(${lo}, ${mid}), ${val}, max(${hi}, ${mid}))`;
  };
  const s = art.safe;
  return {
    left: `calc(-1 * ${axis('100cqw', dw, art.focal.x, s ? s.x : null, s ? s.w : null)})`,
    top: `calc(-1 * ${axis('100cqh', dh, art.focal.y, s ? s.y : null, s ? s.h : null)})`,
    width: dw,
    height: `calc(${dh})`,
  };
}

/** Each slot's pixel span across a half `width` px wide: shares of the width plus the seams they overlap (as the flex row lays them out). */
export function halfSpans(layout: HalfSlotLayout[], width: number, seamRatio = DEFAULT_HALF_LAYOUT.seamRatio): { left: number; width: number }[] {
  const seam = layout.length > 1 ? seamRatio * width : 0;
  const total = width + seam * (layout.length - 1);
  const sum = layout.reduce((n, l) => n + l.share, 0) || 1;
  let x = 0;
  return layout.map((l, i) => {
    const w = (l.share / sum) * total;
    const left = i === 0 ? 0 : x - seam;
    x = left + w;
    return { left: Math.round(left * 10) / 10, width: Math.round(w * 10) / 10 };
  });
}
