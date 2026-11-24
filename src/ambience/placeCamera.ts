/*
 * ForgeCoach — ambience/placeCamera.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.23, the place change is a camera move. A land of a new colour (or one
 * gone) changes a half's PLACE (spec 1.22: Araucanía + Island = Hawaii). The
 * two places are two paintings, but the lands they share stand in both, so the
 * change is drawn as a camera move: while the two pictures cross-fade, the
 * picture zooms and slides so every shared land travels from where it stands
 * in the old place to where it stands in the new one. One more land: the view
 * pulls back (or opens) and the new land is revealed in its own zone.
 *
 * - Where a land stands ({@link placeLandBox}): the union of the boxes of its
 *   six stage pieces at the shape drawn, fractions of that base.
 * - The map ({@link placeCamera}): `x' = s*x + tx`, `y' = s*y + ty`, fractions
 *   of the frame, one uniform scale. Two or more shared lands: the
 *   least-squares line through their centres (cxA, cxB); one: the ratio of its
 *   widths, its centre carried. Vertically A's horizon goes to B's.
 * - Refused (a plain cross-fade, as 1.22): no shared land, the two drawn at
 *   different shapes or base shapes, reduced motion, `s` outside [0.5, 2], or
 *   the shared lands in another left-to-right order (the pack is not yet
 *   re-laid everywhere: a flip is never animated).
 * - As CSS ({@link cameraCss}): the old frame goes from the identity to the
 *   full map, the new from the inverse of the full map to the identity, both
 *   `transform-origin: 0 0`, one CSS transition each over the place's
 *   cross-fade time and easing; both are linear in the progress, so a shared
 *   land of the new frame lies on the same land of the old at every moment.
 *
 * Pure and DOM-free; SceneryStrip's `PlacePanel` runs it.
 */
import type { Biome } from './model.ts';
import type { PackPlace, PlacePiece } from './places.ts';
import { halfFrameCss, type HalfArt } from './layout.ts';

/** The scale a camera move may use; outside it the change is a plain cross-fade. */
export const CAMERA_MIN_SCALE = 0.5;
export const CAMERA_MAX_SCALE = 2;
/** The soft edge a frame in motion fades out over, a fraction of its width and height at each side. */
export const CAMERA_EDGE = 0.08;
/** The mask's size once its soft edge lies wholly outside the frame (`(k - 1) / 2 >= CAMERA_EDGE * k`, so k >= 1.19). */
export const CAMERA_EDGE_OFF = 1.2;
/** The easing of the place's cross-fade (SceneryStrip's `Layer`), so the move and the fade run as one. */
export const CAMERA_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

/** A land's box in a place at one shape: fractions of the base of that shape. */
export interface LandBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Its centre's x. */
  cx: number;
}

/** Where a land stands in a place at one shape: the union of its six pieces' boxes there; null when it has no piece there (or is not the place's). */
export function placeLandBox(place: Pick<PackPlace, 'layers'>, biome: Biome, phone: boolean): LandBox | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const st of place.layers[biome] ?? []) {
    const p: PlacePiece | null = phone ? st.phone : st.half;
    if (!p) continue;
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x + p.w);
    y1 = Math.max(y1, p.y + p.h);
  }
  if (!(x1 > x0) || !(y1 > y0)) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2 };
}

/** The map of a camera move, fractions of the frame: `x' = s*x + tx`, `y' = s*y + ty`. */
export interface CameraMap {
  s: number;
  tx: number;
  ty: number;
  /** The lands both places have, with a box in both, in the geography's order. */
  shared: Biome[];
}

export type CameraRefusal = 'reduced' | 'shape' | 'none' | 'order' | 'scale';

/** One side of a place change: the place and the shape it is drawn at. */
export interface CameraSide {
  place: Pick<PackPlace, 'lands' | 'layers' | 'half'>;
  phone: boolean;
}

const horizonOf = (place: CameraSide['place'], phone: boolean): number => (phone ? place.half.phone.horizon : place.half.horizon) ?? 0.5;
const baseAspect = (place: CameraSide['place'], phone: boolean): number => (phone ? place.half.phone.width / place.half.phone.height : place.half.width / place.half.height);

/**
 * The camera move for a place change from `a` to `b` (spec 1.23), or why it is refused (then the change is 1.22's plain
 * cross-fade): `reduced` motion, `shape` (drawn at different shapes, or bases of different shapes: a uniform map in
 * fractions of one is not uniform in the other), `none` (no land with a box in both), `order` (the shared lands stand
 * in another left-to-right order, or two at the same centre), `scale` (`s` outside [0.5, 2], or no line through them).
 */
export function placeCamera(a: CameraSide, b: CameraSide, opts: { reduced?: boolean } = {}): CameraMap | { refused: CameraRefusal } {
  if (opts.reduced) return { refused: 'reduced' };
  if (a.phone !== b.phone || Math.abs(baseAspect(a.place, a.phone) - baseAspect(b.place, b.phone)) > 1e-3) return { refused: 'shape' };
  const shared: Biome[] = [];
  const pa: LandBox[] = [];
  const pb: LandBox[] = [];
  for (const land of a.place.lands) {
    if (!b.place.lands.includes(land)) continue;
    const ba = placeLandBox(a.place, land, a.phone);
    const bb = placeLandBox(b.place, land, b.phone);
    if (!ba || !bb) continue;
    shared.push(land);
    pa.push(ba);
    pb.push(bb);
  }
  if (!shared.length) return { refused: 'none' };
  for (let i = 0; i < shared.length; i++)
    for (let j = i + 1; j < shared.length; j++) if (!((pa[i]!.cx - pa[j]!.cx) * (pb[i]!.cx - pb[j]!.cx) > 0)) return { refused: 'order' };
  let s: number;
  let tx: number;
  if (shared.length === 1) {
    s = pb[0]!.w / pa[0]!.w;
    tx = pb[0]!.cx - s * pa[0]!.cx;
  } else {
    const n = shared.length;
    const ma = pa.reduce((t, p) => t + p.cx, 0) / n;
    const mb = pb.reduce((t, p) => t + p.cx, 0) / n;
    let sab = 0;
    let saa = 0;
    for (let i = 0; i < n; i++) {
      sab += (pa[i]!.cx - ma) * (pb[i]!.cx - mb);
      saa += (pa[i]!.cx - ma) ** 2;
    }
    if (!(saa > 0)) return { refused: 'scale' };
    s = sab / saa;
    tx = mb - s * ma;
  }
  // (To the boxes' rounding: a box's width is the difference of two fractions.)
  if (!(s >= CAMERA_MIN_SCALE - 1e-9 && s <= CAMERA_MAX_SCALE + 1e-9)) return { refused: 'scale' };
  const ty = horizonOf(b.place, b.phone) - s * horizonOf(a.place, a.phone);
  return { s, tx, ty, shared };
}

/** Is it a map (not a refusal)? */
export const isCamera = (c: CameraMap | { refused: CameraRefusal }): c is CameraMap => 's' in c;

/** `data-camera`: "s,tx,ty" to three decimals. */
export function cameraMark(c: Pick<CameraMap, 's' | 'tx' | 'ty'>): string {
  return [c.s, c.tx, c.ty].map((n) => (Object.is(+n.toFixed(3), -0) ? 0 : n).toFixed(3)).join(',');
}

/** One frame's style while a camera move runs: where it starts, where it ends (each property list the same shape, so a CSS transition carries it). */
export interface CameraFrameCss {
  from: { transform: string; maskSize: string | null };
  to: { transform: string; maskSize: string | null };
  /** It carries the soft edge: the layer drawn smaller than the half at some moment of the move. */
  masked: boolean;
}

const num = (n: number) => `${+n.toFixed(6)}`;
const pct = (n: number) => `${+(n * 100).toFixed(4)}%`;

/**
 * A translation: the difference of the two frames' offsets (each base is cropped by its own focal point and safe rect,
 * layout.ts `halfFrameCss`) times `k`, plus `p` of the frame's own size (CSS translate percentages are of the element's
 * own box, which is the base picture's: exactly the fractions the map is written in).
 */
function shift(offA: string, offB: string, k: number, p: number): string {
  const terms: string[] = [];
  if (offA !== offB && Math.abs(k) > 1e-9) terms.push(`${num(k)} * ((${offB}) - (${offA}))`);
  if (Math.abs(p) > 1e-9) terms.push(pct(p));
  if (!terms.length) return '0px';
  return terms.length === 1 && !terms[0]!.includes('*') ? terms[0]! : `calc(${terms.join(' + ')})`;
}

const edgeSize = (k: number) => `${pct(k)} 100%, 100% ${pct(k)}`;

/**
 * The two frames' CSS for a camera move (frames A and B drawn by `halfFrameCss` of their arts, `transform-origin: 0 0`):
 * - A, the old: from the identity to the full map, `translate(OB - OA + tx*W, TB - TA + ty*H) scale(s)`;
 * - B, the new: from the inverse of the full map, `translate(-(OB - OA) - tx*W/s, -(TB - TA) - ty*H/s) scale(1/s)`, to
 *   the identity. Its translation and scale at progress e are exactly linear in e, so the transition's interpolation is
 *   the composition M(e) ∘ map⁻¹ at every moment, and the settled frame has no transform left.
 * The soft edge goes on the layer smaller than the half: the old when it shrinks (s < 1; its mask grows in from fully
 * outside it), else the new (its mask starts at the frame's edge and moves wholly outside it by the end), so neither
 * edge pops when the mask comes or goes.
 */
export function cameraCss(c: Pick<CameraMap, 's' | 'tx' | 'ty'>, artA: Pick<HalfArt, 'aspect' | 'focal' | 'safe' | 'focalTo'>, artB: Pick<HalfArt, 'aspect' | 'focal' | 'safe' | 'focalTo'>): { old: CameraFrameCss; new: CameraFrameCss } {
  const fa = halfFrameCss(artA);
  const fb = halfFrameCss(artB);
  const identity = 'translate(0px, 0px) scale(1)';
  const oldTo = `translate(${shift(fa.left, fb.left, 1, c.tx)}, ${shift(fa.top, fb.top, 1, c.ty)}) scale(${num(c.s)})`;
  const newFrom = `translate(${shift(fa.left, fb.left, -1, -c.tx / c.s)}, ${shift(fa.top, fb.top, -1, -c.ty / c.s)}) scale(${num(1 / c.s)})`;
  const oldMasked = c.s < 1;
  return {
    old: { from: { transform: identity, maskSize: oldMasked ? edgeSize(CAMERA_EDGE_OFF) : null }, to: { transform: oldTo, maskSize: oldMasked ? edgeSize(1) : null }, masked: oldMasked },
    new: { from: { transform: newFrom, maskSize: oldMasked ? null : edgeSize(1) }, to: { transform: identity, maskSize: oldMasked ? null : edgeSize(CAMERA_EDGE_OFF) }, masked: !oldMasked },
  };
}

/** The soft edge's picture: a horizontal and a vertical fade over {@link CAMERA_EDGE} of each side, intersected. */
export const CAMERA_MASK_IMAGE = `linear-gradient(to right, transparent 0, #000 ${pct(CAMERA_EDGE)}, #000 ${pct(1 - CAMERA_EDGE)}, transparent 100%), linear-gradient(to bottom, transparent 0, #000 ${pct(CAMERA_EDGE)}, #000 ${pct(1 - CAMERA_EDGE)}, transparent 100%)`;

// ---------------------------------------------------------------------------
// The move across renders (the drawing's state, pure; SceneryStrip's PlacePanel keeps it)

/** What a place panel draws: its base's key (the base picture's file), its art and its place. */
export interface CameraDrawn {
  key: string;
  art: Pick<HalfArt, 'aspect' | 'focal' | 'safe' | 'focalTo' | 'source'>;
  place: CameraSide['place'];
}

/** A camera move on screen: the old frame's key, the new one's, the map and both frames' CSS; `start` until its first paint, then `run`. */
export interface CameraRun {
  id: number;
  from: string;
  to: string;
  map: CameraMap;
  css: { old: CameraFrameCss; new: CameraFrameCss };
  phase: 'start' | 'run';
}

export interface CameraState {
  drawn: CameraDrawn | null;
  run: CameraRun | null;
  /** The last run's id. */
  n: number;
}

export const CAMERA_IDLE: CameraState = { drawn: null, run: null, n: 0 };

/**
 * The panel's camera after it drew `next` (`ms`: the place's cross-fade time; 0 under reduced motion). The same base
 * (a stage step, or nothing changed): no new move. Another base: a move from what was drawn when {@link placeCamera}
 * gives a map, else none (the plain cross-fade). The first paint never moves. A change while a move runs is a plain
 * cross-fade and leaves that move to finish (its frames keep their transitions), except a change back to the base it
 * left, which drops the move (its old frame is the one coming back, and must come back untransformed).
 */
export function cameraStep(prev: CameraState, next: CameraDrawn, ms: number, reduced = false): CameraState {
  if (prev.drawn?.key === next.key) return { ...prev, drawn: next };
  let run = prev.run;
  if (run && next.key === run.from) run = null;
  else if (!run && prev.drawn && ms > 0) {
    const m = placeCamera({ place: prev.drawn.place, phone: prev.drawn.art.source === 'phone' }, { place: next.place, phone: next.art.source === 'phone' }, { reduced });
    if (isCamera(m)) run = { id: prev.n + 1, from: prev.drawn.key, to: next.key, map: m, css: cameraCss(m, prev.drawn.art, next.art), phase: 'start' };
  }
  return { drawn: next, run, n: run?.id ?? prev.n };
}
