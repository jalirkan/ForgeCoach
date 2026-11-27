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
 * - Tracked lands ({@link trackedCandidates}): the largest subset of the
 *   shared lands standing in the same left-to-right order in both (on a tie,
 *   the one whose boxes cover the most width in A) whose map's scale is in
 *   [0.5, 2]; when none of a size is, the next size down. A shared land left out (a flip:
 *   the pack is not yet re-laid everywhere, and two re-laid places keep one
 *   land out of order) simply cross-fades without being tracked.
 * - Refused (a plain cross-fade, as 1.22): no shared land, the two drawn at
 *   different shapes or base shapes, reduced motion, or `s` outside [0.5, 2].
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
import type { PlacedPiece } from './places.ts';

/** The scale a camera move may use; outside it the change is a plain cross-fade. */
export const CAMERA_MIN_SCALE = 0.5;
export const CAMERA_MAX_SCALE = 2;
/** The soft edge a frame in motion fades out over, a fraction of its width and height at each side. */
export const CAMERA_EDGE = 0.08;
/** The easing of the place's cross-fade (SceneryStrip's `Layer`), so the move and the fade run as one. */
export const CAMERA_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';
/**
 * Is a place change drawn as the camera move? No, since 2026-11-27: the move ran under a cross-fade, and two
 * unrelated paintings laid over each other read as a ghost of the old town over the new river whatever the camera
 * did (Justin, on the scenery page: "the transitions between lands suck"). The change is a wipe from the new land's
 * site now (SceneryStrip's `PlacePanelView`, `revealStyle`). The move's maths stays, pure and tested, behind this.
 */
export const PLACE_CHANGE_CAMERA = false;

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
  /** The lands the map is fitted on (tracked): the largest subset of the shared lands in one order, in the geography's order. */
  shared: Biome[];
  /** Shared lands left out of the fit (out of order): they cross-fade without being tracked. */
  untracked: Biome[];
}

export type CameraRefusal = 'reduced' | 'shape' | 'none' | 'scale';

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
 * fractions of one is not uniform in the other), `none` (no land with a box in both), `scale` (`s` outside [0.5, 2], or
 * no line through them, for every candidate). The map is fitted on the first of {@link trackedCandidates} whose scale
 * is in range; the other shared lands are not tracked.
 */
export function placeCamera(a: CameraSide, b: CameraSide, opts: { reduced?: boolean } = {}): CameraMap | { refused: CameraRefusal } {
  if (opts.reduced) return { refused: 'reduced' };
  if (a.phone !== b.phone || Math.abs(baseAspect(a.place, a.phone) - baseAspect(b.place, b.phone)) > 1e-3) return { refused: 'shape' };
  const all: { land: Biome; a: LandBox; b: LandBox }[] = [];
  for (const land of a.place.lands) {
    if (!b.place.lands.includes(land)) continue;
    const ba = placeLandBox(a.place, land, a.phone);
    const bb = placeLandBox(b.place, land, b.phone);
    if (ba && bb) all.push({ land, a: ba, b: bb });
  }
  if (!all.length) return { refused: 'none' };
  // The in-order subsets, largest first (then the most width covered in A, then the geography's order): the first
  // whose map's scale is inside [0.5, 2] is tracked.
  for (const kept of trackedCandidates(all)) {
    const fit = fitOf(kept.map((x) => x.a), kept.map((x) => x.b));
    // (To the boxes' rounding: a box's width is the difference of two fractions.)
    if (!fit || !(fit.s >= CAMERA_MIN_SCALE - 1e-9 && fit.s <= CAMERA_MAX_SCALE + 1e-9)) continue;
    const { s, tx } = fit;
    const shared = kept.map((x) => x.land);
    const untracked = all.filter((x) => !kept.includes(x)).map((x) => x.land);
    const ty = horizonOf(b.place, b.phone) - s * horizonOf(a.place, a.phone);
    return { s, tx, ty, shared, untracked };
  }
  return { refused: 'scale' };
}

/** The map's `s` and `tx` through the lands' centres: two or more, the least-squares line; one, its widths' ratio. Null: no line (one centre). */
function fitOf(pa: readonly LandBox[], pb: readonly LandBox[]): { s: number; tx: number } | null {
  if (pa.length === 1) {
    const s = pb[0]!.w / pa[0]!.w;
    return { s, tx: pb[0]!.cx - s * pa[0]!.cx };
  }
  const n = pa.length;
  const ma = pa.reduce((t, p) => t + p.cx, 0) / n;
  const mb = pb.reduce((t, p) => t + p.cx, 0) / n;
  let sab = 0;
  let saa = 0;
  for (let i = 0; i < n; i++) {
    sab += (pa[i]!.cx - ma) * (pb[i]!.cx - mb);
    saa += (pa[i]!.cx - ma) ** 2;
  }
  if (!(saa > 0)) return null;
  const s = sab / saa;
  return { s, tx: mb - s * ma };
}

/**
 * The candidate sets of tracked lands, best first: every subset of the shared lands whose left-to-right order by box
 * centre is the same in A and B (two lands at one centre in either are never both in one), largest first; within a
 * size, the most width covered in A (the union's length) first; then the geography's order. {@link placeCamera} tracks
 * the first whose map's scale is inside [0.5, 2]. At most five lands, so every subset is listed.
 */
export function trackedCandidates<T extends { a: Pick<LandBox, 'x' | 'w' | 'cx'>; b: Pick<LandBox, 'cx'> }>(shared: readonly T[]): T[][] {
  const n = shared.length;
  const out: { sub: T[]; cover: number; mask: number }[] = [];
  for (let mask = 1; mask < 1 << n; mask++) {
    const sub = shared.filter((_, i) => mask & (1 << i));
    let ok = true;
    for (let i = 0; ok && i < sub.length; i++) for (let j = i + 1; ok && j < sub.length; j++) ok = (sub[i]!.a.cx - sub[j]!.a.cx) * (sub[i]!.b.cx - sub[j]!.b.cx) > 0;
    if (ok) out.push({ sub, cover: coverOf(sub.map((x) => x.a)), mask });
  }
  // The geography's order within a size and cover: the subset whose first differing land comes earlier (lower bits).
  const geo = (p: number, q: number) => {
    const d = p ^ q;
    const low = d & -d;
    return p & low ? -1 : 1;
  };
  out.sort((p, q) => q.sub.length - p.sub.length || (Math.abs(q.cover - p.cover) > 1e-12 ? q.cover - p.cover : p.mask === q.mask ? 0 : geo(p.mask, q.mask)));
  return out.map((x) => x.sub);
}

/** The tracked lands when the scale allows the largest: {@link trackedCandidates}' first. */
export function trackedLands<T extends { a: Pick<LandBox, 'x' | 'w' | 'cx'>; b: Pick<LandBox, 'cx'> }>(shared: readonly T[]): T[] {
  return trackedCandidates(shared)[0] ?? [];
}

/** The length the union of boxes covers along x. */
function coverOf(boxes: readonly Pick<LandBox, 'x' | 'w'>[]): number {
  const iv = boxes.map((b) => [b.x, b.x + b.w] as const).sort((p, q) => p[0] - q[0]);
  let total = 0;
  let end = -Infinity;
  for (const [x0, x1] of iv) {
    if (x1 <= end) continue;
    total += x1 - Math.max(x0, end);
    end = x1;
  }
  return total;
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
  /** It carries the soft edge (both moving frames do, for the whole move). */
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
 * Both moving frames carry the soft edge for the whole move. They are drawn over a third frame, the new place at its
 * settled position, untransformed and opaque from the first moment (SceneryStrip's `PlacePanelView`): with a pan in
 * the map the moving frames cannot cover the half, and wherever they end they dissolve into the settled picture rather
 * than show an edge. At the settle the moving new frame is at the identity, exactly over the settled one, so removing
 * it (and its mask) changes no pixel.
 */
export function cameraCss(c: Pick<CameraMap, 's' | 'tx' | 'ty'>, artA: Pick<HalfArt, 'aspect' | 'focal' | 'safe' | 'focalTo'>, artB: Pick<HalfArt, 'aspect' | 'focal' | 'safe' | 'focalTo'>): { old: CameraFrameCss; new: CameraFrameCss } {
  const fa = halfFrameCss(artA);
  const fb = halfFrameCss(artB);
  const identity = 'translate(0px, 0px) scale(1)';
  const oldTo = `translate(${shift(fa.left, fb.left, 1, c.tx)}, ${shift(fa.top, fb.top, 1, c.ty)}) scale(${num(c.s)})`;
  const newFrom = `translate(${shift(fa.left, fb.left, -1, -c.tx / c.s)}, ${shift(fa.top, fb.top, -1, -c.ty / c.s)}) scale(${num(1 / c.s)})`;
  const edge = edgeSize(1);
  return {
    old: { from: { transform: identity, maskSize: edge }, to: { transform: oldTo, maskSize: edge }, masked: true },
    new: { from: { transform: newFrom, maskSize: edge }, to: { transform: identity, maskSize: edge }, masked: true },
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
  /** What the panel draws for it (its pieces, its marks), kept so a change held back can keep drawing it. */
  view?: { art: HalfArt; pieces: PlacedPiece[]; slug: string; scene: string };
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
  /**
   * A change back to the base a running move left, held: `drawn` stays the move's new place until the move ends, and
   * the next base change after it is a plain cross-fade (never a move).
   */
  plain?: boolean;
}

export const CAMERA_IDLE: CameraState = { drawn: null, run: null, n: 0 };

/** The move ended (the panel's timer, the cross-fade's time after it ran): the run goes; a held change stays plain. */
export function cameraEnd(prev: CameraState): CameraState {
  return { ...prev, run: null };
}

/**
 * The panel's camera after it drew `next` (`ms`: the place's cross-fade time; 0 under reduced motion). The same base
 * (a stage step, or nothing changed): no new move. Another base: a move from what was drawn when {@link placeCamera}
 * gives a map, else none (the plain cross-fade). The first paint never moves. A change while a move runs is a plain
 * cross-fade and leaves that move to finish (its frames keep their transitions), except a change back to the base it
 * left (A -> B -> A): that change is HELD -- `drawn` stays B and the move finishes undisturbed -- and once it has ended
 * ({@link cameraEnd}) the change to A is a plain cross-fade from B at rest. Dropping the move instead would snap A's
 * half-moved, half-faded frame to the identity: a visible pop.
 */
export function cameraStep(prev: CameraState, next: CameraDrawn, ms: number, reduced = false): CameraState {
  if (prev.drawn?.key === next.key) return { ...prev, drawn: next, plain: false };
  let run = prev.run;
  if (run && next.key === run.from) return { ...prev, plain: true };
  if (!run && prev.drawn && ms > 0 && !prev.plain) {
    const m = placeCamera({ place: prev.drawn.place, phone: prev.drawn.art.source === 'phone' }, { place: next.place, phone: next.art.source === 'phone' }, { reduced });
    if (isCamera(m)) run = { id: prev.n + 1, from: prev.drawn.key, to: next.key, map: m, css: cameraCss(m, prev.drawn.art, next.art), phase: 'start' };
  }
  return { drawn: next, run, n: run?.id ?? prev.n, plain: false };
}
