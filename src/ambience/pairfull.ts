/*
 * ForgeCoach — ambience/pairfull.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.13 DRAFT, behind `?pairfull=1` (prefs.ts; default off, nothing
 * changes for players): the whole half is the pair picture.
 *
 * Justin, 2026-10-22: "the space doesn't need to be a sliver: when two lands
 * are on the board, the space of BOTH lands is the space we have to
 * communicate (1) the type of land and (2) the transition between them".
 * So when a half holds exactly two live biomes and the pairs pack has a
 * picture for them (a 1.9 band pair: stages with `half`), that picture is
 * drawn across the whole half instead of two panels and a band between them,
 * and the land share between the two PANS it rather than widening a band:
 *
 * - The split. `split` is the left biome's share of the two biomes' land
 *   weight (board order), clamped to {@link PAIR_FULL_SPLIT} so the lighter
 *   colour always keeps a fifth of the frame.
 * - The pan. The pair picture's transition is its focal x (`t`, 0.5 unless
 *   the manifest says otherwise: the pairs were painted A | heart | B with the
 *   heart in the middle). The picture is drawn just wide enough
 *   ({@link pairFullZoom}: max(1, s / t, (1 − s) / (1 − t)) × the half's
 *   width, at most {@link PAIR_FULL_MAX_ZOOM}) that its transition can land at
 *   `split` of the half's width: 0.5 → the whole picture, its own focal in the
 *   middle; 0.8 → drawn 1.6× wide, the view panned 0.3 of the width toward the
 *   heavier side, so the transition sits at 0.8 and the heavier colour fills
 *   four fifths of the half. The horizontal safe rect is not kept (the
 *   transition is what is kept); the vertical one (the subject band) is, as
 *   in every 1.5 crop ({@link pairFullFrame}).
 * - The stage. From the TOTAL land weight of the two biomes, on the pack's
 *   own `stageThresholds` (the stage a mono half with that many lands would
 *   show), mapped through the pair's `stageMap`. Not 1.9's lower neighbour:
 *   with the picture as the whole half, a 6 : 1 half is a seven-land half, and
 *   the lower neighbour would hold it at pair stage 1 all game. Not the dual
 *   count: a pair picture without a dual is allowed under the flag, and would
 *   never grow.
 * - Three biomes (a placeholder for a future triple composition): the
 *   heaviest pair with a picture (by the two biomes' land weight; a tie, the
 *   earlier arrivals) takes the pair picture, the third biome keeps today's
 *   panel at its own `halfLayout` share and stage, on its side of the row (the
 *   left when it arrived before both, else the right), meeting the picture in
 *   a plain 1.10 seam.
 * - Anything else (one biome, a pair with no picture or a motif pair, no
 *   pairs pack): null, and the half is drawn exactly as today.
 *
 * Pure and DOM-free; the drawing is ui/ambience/SceneryStrip.tsx's
 * `PairFullPanel`.
 */
import { DEFAULT_STAGE_THRESHOLDS, stageFor, type Biome } from './model.ts';
import { cropAxis, cropAxisCss, halfArtOf, type FrameRect, type HalfArt, type HalfSlotLayout } from './layout.ts';
import type { PackHalf } from './manifest.ts';
import { pairFor, pairHalfAt, pairStageFor, type PackPair, type PairsPack } from './pairs.ts';

/** The narrowest and widest the left biome's share of the frame gets: the lighter colour always keeps a fifth. */
export const PAIR_FULL_SPLIT: readonly [number, number] = [0.2, 0.8];
/** The most the picture is drawn wider than the half (the split's clamp needs 1.6 with the transition in the middle). */
export const PAIR_FULL_MAX_ZOOM = 1.6;

/** The pair picture across the half (or across all of it but the third biome's panel). */
export interface PairFullPair {
  kind: 'pair';
  key: string;
  pair: PackPair;
  /** The board has the pair the other way round from the art (the art is drawn mirrored). */
  mirror: boolean;
  /** The two biomes as the board has them, left and right. */
  left: Biome;
  right: Biome;
  /** Their land weights (a dual ½ to each; a folded biome's weight included, spec 1.10). */
  weights: [number, number];
  /** The left biome's share of the two, clamped to {@link PAIR_FULL_SPLIT}. */
  split: number;
  /** Its share of the half's row. */
  share: number;
  /** The pair stage ({@link pairFullStage}), at most the pair's last pictured stage. */
  stage: number;
}

/** The third biome's panel (today's panel, a placeholder for a triple composition). */
export interface PairFullSlot {
  kind: 'slot';
  /** Its index in the half layout. */
  index: number;
  biome: Biome;
  share: number;
}

export type PairFullItem = PairFullPair | PairFullSlot;

const r4 = (n: number) => Math.round(n * 10000) / 10000;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The left biome's share of two land weights, clamped to {@link PAIR_FULL_SPLIT}; 0.5 with no weight. */
export function pairFullSplit(left: number, right: number): number {
  const total = Math.max(0, left) + Math.max(0, right);
  if (!(total > 0)) return 0.5;
  return r4(clamp(Math.max(0, left) / total, PAIR_FULL_SPLIT[0], PAIR_FULL_SPLIT[1]));
}

/**
 * The pair stage for a whole-half pair picture: the stage the pack's
 * thresholds give the two biomes' TOTAL land weight (`stageOverride`, the
 * preview's slider, instead when set), through the pair's `stageMap`, at most
 * its last pictured stage.
 */
export function pairFullStage(pair: PackPair, total: number, thresholds: readonly number[] = DEFAULT_STAGE_THRESHOLDS, stageOverride: number | null = null): number {
  const st = stageOverride !== null && stageOverride > 0 ? stageOverride : stageFor(total, thresholds);
  return Math.min(pairStageFor(pair.stageMap, st), pair.stages.length);
}

/** A pair with a whole-half picture: a 1.9 band pair (a motif pair has no `half`, 1.12). */
function pictured(pair: PackPair): boolean {
  return pair.kind === 'band' && !!pairHalfAt(pair, 1);
}

/**
 * The half's row under spec 1.13 (draft), or null when the half is drawn as
 * today: exactly two live biomes with a pictured pair → the pair picture
 * alone; three → the heaviest pictured pair and the third biome's panel on
 * its side. Withered panels are left out (the picture is the half).
 */
export function pairFullPlan(
  layout: readonly HalfSlotLayout[],
  pairs: PairsPack | null | undefined,
  opts: { thresholds?: readonly number[] | null; stageOverride?: number | null } = {},
): PairFullItem[] | null {
  if (!pairs) return null;
  const live = layout.map((l, i) => ({ l, i })).filter(({ l }) => l.stage > 0 && l.slot.weight > 0);
  if (live.length < 2 || live.length > 3) return null;
  const shareSum = live.reduce((n, x) => n + x.l.share, 0) || 1;
  // Candidate pairs in row order (a, b with a before b); the heaviest pictured one wins, a tie the earlier arrivals.
  const cands: { a: (typeof live)[number]; b: (typeof live)[number]; w: number; arrival: number }[] = [];
  for (let x = 0; x < live.length; x++)
    for (let y = x + 1; y < live.length; y++) {
      const a = live[x]!;
      const b = live[y]!;
      const found = pairFor(pairs, a.l.slot.biome, b.l.slot.biome);
      if (found && pictured(found.pair)) cands.push({ a, b, w: a.l.slot.weight + b.l.slot.weight, arrival: a.l.slot.index + b.l.slot.index });
    }
  if (!cands.length) return null;
  cands.sort((p, q) => q.w - p.w || p.arrival - q.arrival);
  const { a, b } = cands[0]!;
  const found = pairFor(pairs, a.l.slot.biome, b.l.slot.biome)!;
  const third = live.find((x) => x !== a && x !== b) ?? null;
  const thirdShare = third ? r4(third.l.share / shareSum) : 0;
  const wa = a.l.slot.weight;
  const wb = b.l.slot.weight;
  const item: PairFullPair = {
    kind: 'pair',
    key: found.pair.key,
    pair: found.pair,
    mirror: found.mirror,
    left: a.l.slot.biome,
    right: b.l.slot.biome,
    weights: [wa, wb],
    split: pairFullSplit(wa, wb),
    share: r4(1 - thirdShare),
    stage: pairFullStage(found.pair, wa + wb, opts.thresholds ?? DEFAULT_STAGE_THRESHOLDS, opts.stageOverride ?? null),
  };
  if (!third) return [item];
  const slot: PairFullSlot = { kind: 'slot', index: third.i, biome: third.l.slot.biome, share: thirdShare };
  return third.i < a.i && third.i < b.i ? [slot, item] : [item, slot];
}

/**
 * The picture a whole-half pair panel draws: the stage's 1.13 `panorama` when
 * it has one, else its 1.9 `half`. A panorama with no phone picture gives way
 * to the half wherever the half would draw its phone picture (a phone, or a
 * phone-shaped panel), so a desktop-only panorama never lands on a phone.
 */
export function pairFullArt(half: PackHalf | null, panorama: PackHalf | null, panelAspect: number | null, narrow: boolean): HalfArt | null {
  const fromHalf = half ? halfArtOf(half, panelAspect, { narrow }) : null;
  if (!panorama) return fromHalf;
  if (!panorama.phone && fromHalf?.source === 'phone') return fromHalf;
  return halfArtOf(panorama, panelAspect, { narrow });
}

/** How much wider than the half the picture is drawn so its transition (`t`) can land at `split` ({@link PAIR_FULL_MAX_ZOOM} at most). */
export function pairFullZoom(split: number, t: number): number {
  const s = clamp(split, PAIR_FULL_SPLIT[0], PAIR_FULL_SPLIT[1]);
  const tt = clamp(t, 0.1, 0.9);
  return r4(Math.min(PAIR_FULL_MAX_ZOOM, Math.max(1, s / tt, (1 - s) / (1 - tt))));
}

/**
 * Where the pair picture sits in a panel of `box` px (fractions of the box,
 * as layout.ts `halfFrame`), for the left biome's share `split` IN THE
 * PICTURE'S OWN ORDER (1 − the board's split when the art is mirrored): drawn
 * {@link pairFullZoom} × the box's width (or taller, to cover), panned so the
 * picture's focal x lands at `split` of the box as near as the picture's
 * edges allow; vertically the 1.5 crop (the focal y, the safe rect's band kept
 * whole when it fits). `seamAt` is where the transition lands, 0..1 across
 * the box. {@link pairFullFrameCss} is its CSS twin.
 */
export function pairFullFrame(box: { w: number; h: number }, art: Pick<HalfArt, 'aspect' | 'focal' | 'safe'>, split: number): FrameRect & { seamAt: number } {
  if (!(box.w > 0 && box.h > 0 && art.aspect > 0)) return { left: 0, top: 0, width: 1, height: 1, seamAt: 0.5 };
  const s = clamp(split, PAIR_FULL_SPLIT[0], PAIR_FULL_SPLIT[1]);
  const t = art.focal.x;
  const z = pairFullZoom(s, t);
  const dw = Math.max(z * box.w, box.h * art.aspect);
  const dh = dw / art.aspect;
  const left = clamp(s * box.w - t * dw, box.w - dw, 0);
  const safe = art.safe;
  const oy = cropAxis(box.h, dh, art.focal.y, safe ? safe.y : null, safe ? safe.h : null);
  return { left: r4(left / box.w) || 0, top: r4(-oy / box.h) || 0, width: r4(dw / box.w), height: r4(dh / box.h), seamAt: r4((left + t * dw) / box.w) };
}

/** {@link pairFullFrame} as CSS for an element inside a size container (the panel: `cqw` / `cqh`), so the crop follows the panel as it grows. */
export function pairFullFrameCss(art: Pick<HalfArt, 'aspect' | 'focal' | 'safe'>, split: number): { left: string; top: string; width: string; height: string } {
  const f = (n: number) => String(r4(n));
  const s = clamp(split, PAIR_FULL_SPLIT[0], PAIR_FULL_SPLIT[1]);
  const t = art.focal.x;
  const dw = `max(${f(pairFullZoom(s, t))} * 100cqw, ${f(art.aspect)} * 100cqh)`;
  const dh = `(${dw} / ${f(art.aspect)})`;
  const safe = art.safe;
  return {
    left: `clamp(100cqw - ${dw}, ${f(s)} * 100cqw - ${f(t)} * ${dw}, 0px)`,
    top: `calc(-1 * ${cropAxisCss('100cqh', dh, art.focal.y, safe ? safe.y : null, safe ? safe.h : null)})`,
    width: dw,
    height: `calc(${dh})`,
  };
}

/** A caption for the preview page: "Tundra, whole half: island 80% | plains 20%, pair stage 2". */
export function pairFullCaption(items: readonly PairFullItem[] | null): string | null {
  const p = items?.find((x): x is PairFullPair => x.kind === 'pair');
  if (!p) return null;
  const third = items!.find((x): x is PairFullSlot => x.kind === 'slot');
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return `${p.pair.dual ?? p.key}${p.pair.shock ? ` (${p.pair.shock})` : ''}, ${third ? `${pct(p.share)} of the half` : 'whole half'}: ${p.left} ${pct(p.split)} | ${p.right} ${pct(1 - p.split)}, pair stage ${p.stage}${third ? `; ${third.biome} ${pct(third.share)} panel (placeholder)` : ''}`;
}
