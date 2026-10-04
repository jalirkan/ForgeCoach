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
 */
import type { SlotState } from './model.ts';
import type { Anchor, Fit, ScenePack } from './manifest.ts';

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
