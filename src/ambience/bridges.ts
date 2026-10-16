/*
 * ForgeCoach — ambience/bridges.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Bridges across the seam (spec 1.8): when one side of the board has two
 * biomes, the half board draws the pair's bridge piece (a pack's transparent
 * ground object, a river from the lagoon into the forest floor) over the seam
 * where their panels meet, and each of the pair's dual lands widens that seam
 * a little, the bridge growing with it. Pure and DOM-free; the drawing is
 * ui/ambience/SceneryStrip.tsx.
 *
 * - The pair's entry is found by {@link pairKey}, so both orders resolve to
 *   one; the art is mirrored when the board's order is the reverse of the
 *   art's (its manifest key's).
 * - The seam: the pack's `half.seamRatio`, plus `dualsWiden` per dual of the
 *   pair, at most `maxSeamRatio` (never less than the base). A pair without a
 *   bridge keeps the base seam, so a 1.7 pack draws exactly today's seam.
 * - The anchor: the piece's centre sits on the seam's middle (across) at `y`
 *   of the half's height (down), `width` of the half's width wide, scaled by
 *   how much the duals widened the seam.
 * - The phone piece where the half is nearer the phone picture's shape than
 *   the desktop one's (layout.ts `pickHalfPicture`'s log-scale rule).
 */
import type { BridgePicture, PackBridge, ScenePack } from './manifest.ts';
import { DEFAULT_HALF_LAYOUT } from './manifest.ts';
import { pairKey, type Biome } from './model.ts';
import type { HalfSlotLayout } from './layout.ts';

/** The CSS cap on a seam's width (scenery.css: `min(var(--scn-seam), 14vw)`), as a fraction of the viewport's width. */
export const SEAM_CAP_VW = 0.14;
/** A half narrower than this (width / height) takes a bridge's phone piece: the log-scale midpoint of 16:5 and 4:5. */
export const PHONE_HALF_ASPECT = Math.sqrt((16 / 5) * (4 / 5));

/** The pack's bridge for two biomes in either order, and whether to mirror it (the board has them the other way round from the art). */
export function bridgeFor(pack: ScenePack | null | undefined, left: Biome, right: Biome): { bridge: PackBridge; mirror: boolean } | null {
  if (left === right) return null;
  const bridge = pack?.bridges?.[pairKey(left, right)];
  return bridge ? { bridge, mirror: bridge.left !== left } : null;
}

/**
 * The one widening rule for what a pair's dual lands grow (spec 1.8's bridged
 * seam, spec 1.9's pair band): `base`, plus `step` for each dual, at most
 * `max`, never under `base`. Rounded to 4 places.
 */
export function widenedRatio(base: number, step: number, max: number, duals: number): number {
  const r = duals > 0 ? Math.max(base, Math.min(max, base + step * duals)) : base;
  return Math.round(r * 10000) / 10000;
}

/** A pair's seam (a fraction of the half's width): the base, widened by each dual, capped; the base when the pair has no bridge. */
export function seamRatioFor(base: number, bridge: PackBridge | null | undefined, duals: number): number {
  if (!bridge || !(duals > 0)) return base;
  return widenedRatio(base, bridge.dualsWiden, bridge.maxSeamRatio, duals);
}

/**
 * The seam left of each slot (index 0, the first slot, has none: 0), as a
 * fraction of the half's width: each live pair with a bridge widened by its
 * duals ({@link seamRatioFor}), every other seam the pack's base.
 */
export function halfSeams(layout: readonly HalfSlotLayout[], pack: ScenePack | null | undefined, duals: Readonly<Record<string, number>> = {}): number[] {
  const base = pack?.half?.seamRatio ?? DEFAULT_HALF_LAYOUT.seamRatio;
  return layout.map((r, i) => {
    if (i === 0) return 0;
    const l = layout[i - 1]!;
    const found = l.stage > 0 && r.stage > 0 ? bridgeFor(pack, l.slot.biome, r.slot.biome) : null;
    return seamRatioFor(base, found?.bridge, duals[pairKey(l.slot.biome, r.slot.biome)] ?? 0);
  });
}

/** One bridge to draw: which seam, which picture, mirrored or not, and its anchor after the duals' widening. */
export interface BridgePlacement {
  key: string;
  /** The slot right of the seam (its index in the layout); the seam is between it and the slot before. */
  index: number;
  /** The two biomes as the board has them, left and right. */
  left: Biome;
  right: Biome;
  bridge: PackBridge;
  picture: BridgePicture;
  phone: boolean;
  mirror: boolean;
  /** The seam's width as a fraction of the half's (the base, widened by duals). */
  seamRatio: number;
  /** How much the duals widened it: the seam over the base (1 with none). */
  scale: number;
  /** The centre's height as a fraction of the half's (from the top), and the drawn width as a fraction of the half's width. */
  y: number;
  width: number;
}

/**
 * The bridges a side draws: one per neighbouring pair of live slots (both
 * with lands; a withered slot's seam has none) that the pack has a bridge
 * for, at the shape the half shows (`phone`: the phone piece where there is
 * one).
 */
export function bridgePlacements(layout: readonly HalfSlotLayout[], pack: ScenePack | null | undefined, duals: Readonly<Record<string, number>> = {}, opts: { phone?: boolean } = {}): BridgePlacement[] {
  if (!pack?.bridges || layout.length < 2) return [];
  const base = pack.half?.seamRatio ?? DEFAULT_HALF_LAYOUT.seamRatio;
  const seams = halfSeams(layout, pack, duals);
  const out: BridgePlacement[] = [];
  for (let i = 1; i < layout.length; i++) {
    const l = layout[i - 1]!;
    const r = layout[i]!;
    if (!(l.stage > 0 && r.stage > 0)) continue;
    const found = bridgeFor(pack, l.slot.biome, r.slot.biome);
    if (!found) continue;
    const phone = !!opts.phone && !!found.bridge.phone;
    const picture = phone ? found.bridge.phone! : found.bridge.desktop;
    const scale = base > 0 ? seams[i]! / base : 1;
    out.push({
      key: found.bridge.key,
      index: i,
      left: l.slot.biome,
      right: r.slot.biome,
      bridge: found.bridge,
      picture,
      phone,
      mirror: found.mirror,
      seamRatio: seams[i]!,
      scale: Math.round(scale * 10000) / 10000,
      y: picture.anchor.y,
      width: Math.round(Math.min(1, picture.anchor.width * scale) * 10000) / 10000,
    });
  }
  return out;
}

/** Does a half of this shape (width / height) take the phone pieces? Unknown shape: the desktop ones. */
export function phoneHalf(halfAspect: number | null): boolean {
  return halfAspect !== null && halfAspect > 0 && halfAspect < PHONE_HALF_ASPECT;
}

/**
 * The centre of the seam left of slot `index`, in px across a half `width`
 * px wide in a viewport `vw` px wide, as the flex row lays the slots out:
 * each slot its share of the width plus every seam, each later slot pulled
 * left by its own seam, each seam capped at 14vw (scenery.css). The numeric
 * twin of {@link seamCentreCss}.
 */
export function seamCentre(layout: readonly Pick<HalfSlotLayout, 'share'>[], seams: readonly number[], index: number, width: number, vw = Infinity): number {
  const px = (i: number) => (i === 0 ? 0 : Math.min((seams[i] ?? 0) * width, SEAM_CAP_VW * vw));
  const total = width + layout.reduce((n, _, i) => n + px(i), 0);
  const sum = layout.reduce((n, l) => n + l.share, 0) || 1;
  const before = layout.slice(0, index).reduce((n, l) => n + l.share, 0) / sum;
  let pulled = 0;
  for (let i = 1; i <= index; i++) pulled += px(i);
  return before * total - pulled + px(index) / 2;
}

/**
 * {@link seamCentre} as CSS for an element inside the half (a size
 * container: `cqw` is the half's width), so the bridge follows the seam with
 * no script as the panels' widths change.
 */
export function seamCentreCss(layout: readonly Pick<HalfSlotLayout, 'share'>[], seams: readonly number[], index: number): string {
  const f = (n: number) => String(Math.round(n * 10000) / 10000);
  const s = (i: number) => `min(${f((seams[i] ?? 0) * 100)}cqw, ${f(SEAM_CAP_VW * 100)}vw)`;
  const sum = layout.reduce((n, l) => n + l.share, 0) || 1;
  const before = layout.slice(0, index).reduce((n, l) => n + l.share, 0) / sum;
  const all = layout.map((_, i) => i).filter((i) => i > 0).map(s);
  const pulled = Array.from({ length: index }, (_, k) => s(k + 1));
  return `calc(${f(before)} * (100cqw + ${all.join(' + ')}) - (${pulled.join(' + ')}) + ${s(index)} / 2)`;
}

/**
 * The bridge pictures worth warming with a side's split pictures: for every
 * two live biomes on a side, the pair's piece at the shape the board shows.
 * Each file once.
 */
export function bridgePictures(pack: ScenePack | null | undefined, sides: readonly (readonly { biome: Biome; stage: number }[])[], opts: { phone: boolean }): { src: string; src2x: string | null }[] {
  if (!pack?.bridges) return [];
  const out: { src: string; src2x: string | null }[] = [];
  const seen = new Set<string>();
  for (const slots of sides) {
    const live = slots.filter((s) => s.stage > 0);
    for (let i = 0; i < live.length; i++)
      for (let j = i + 1; j < live.length; j++) {
        const found = bridgeFor(pack, live[i]!.biome, live[j]!.biome);
        if (!found) continue;
        const p = opts.phone && found.bridge.phone ? found.bridge.phone : found.bridge.desktop;
        if (seen.has(p.src)) continue;
        seen.add(p.src);
        out.push({ src: p.src, src2x: p.src2x });
      }
  }
  return out;
}

/** Spec 1.8: the declared bytes of a pack's bridges. */
export function bridgeBytes(pack: ScenePack | null | undefined): number {
  return Object.values(pack?.bridges ?? {}).reduce((n, b) => n + (b?.bytes ?? 0), 0);
}
