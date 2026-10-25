/*
 * ForgeCoach — ambience/pairfull.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.15, behind `?pairfull=1` (prefs.ts; default off, nothing changes
 * for players until the flag's default is flipped): the whole half is the
 * pair picture -- the stage's `panorama` (pairs-v4) where it has one.
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
 * - Three biomes: the pair is makeup.ts's (`pickMakeup`: the two heaviest
 *   kept colours by their own weights, a tie the pair already showing, then
 *   the earlier arrivals -- one rule for the strip, this picture and spec
 *   1.14's element). When the pack has an element for the third colour
 *   (`opts.elements`), or the pair's stage has that colour painted in (spec
 *   1.16, pairs.ts `pairElementAt`), the pair picture takes the whole half,
 *   its stage from every coloured land on the half, and the third biome is the pair's
 *   `element` -- drawn into the picture (1.16; 1.16.1's sided pictures, the
 *   heavier colour's side, {@link pairFullElementSide}) or by ScenePieces on the
 *   heavier colour's ground (1.14, SYSTEM.md A5). Without either (a
 *   placeholder for a triple composition), the third biome keeps today's
 *   panel at its own `halfLayout` share and stage, on its side of the row
 *   (the left when it arrived before both, else the right), meeting the
 *   picture in a plain 1.10 seam. If makeup.ts's pair has no picture, the
 *   heaviest pictured pair is drawn beside the third's panel, with no
 *   element. Four or five colours reach here as three: layout.ts
 *   `foldPanels` keeps makeup.ts's three, and the dropped colours weigh
 *   nothing.
 * - Anything else (one biome, a pair with no picture or a motif pair, no
 *   pairs pack): null, and the half is drawn exactly as today.
 *
 * - For spec 1.14's pieces: {@link pairFullView} says where the transition
 *   lands across the half, each colour's ground and the picture's horizon,
 *   and {@link pairFullElementRegion} the region an element stands in (the
 *   heavier colour's ground, stopping {@link PAIR_FULL_ELEMENT_MARGIN} short
 *   of the transition; the piece is never mirrored with the picture).
 *
 * - The seam grid (spec 1.17, a draft): when the pair has a `grid`
 *   (pairs.ts), each half is its colour's mono picture at that colour's OWN
 *   stage (Justin's one-world rule, SYSTEM.md C, Option A of 2026-10-25), so
 *   the picture is the cell for the two colours' own stages in the
 *   geography's order ({@link pairFullGrid}, pairs.ts `pairGridPick`: the
 *   exact cell, else the lighter half clamped to one stage of the heavier),
 *   drawn in the geography's orientation (mirrored when the board has the
 *   pair the other way round from the GEOGRAPHY, not from the key), panned by
 *   the share as 1.15. A third colour on a grid picture draws nothing in the
 *   draft (no cut-out, no 1.16 painted picture: those are painted on the old
 *   whole-place panoramas). A missing cell: the pair's `stages`, as 1.15 and
 *   1.16.1 say.
 *
 * Pure and DOM-free; the drawing is ui/ambience/SceneryStrip.tsx's
 * `PairFullPanel`.
 */
import { DEFAULT_STAGE_THRESHOLDS, stageFor, type Biome, type SlotState } from './model.ts';
import { cropAxis, cropAxisCss, halfArtOf, horizonOf, type FrameRect, type HalfArt, type HalfSlotLayout } from './layout.ts';
import type { PackHalf, PieceColour } from './manifest.ts';
import { pairElementAt, pairFor, pairGridPick, pairHalfAt, pairPanoramaAt, pairStageFor, type PackPair, type PairGridPick, type PairSide, type PairsPack } from './pairs.ts';
import { BIOME_COLOUR, COLOUR_BIOME, pickFromSlots, type MakeupShowing } from './makeup.ts';

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
  /** Their own land weights (a dual ½ to each; a dropped fourth or fifth colour adds nothing, makeup.ts). */
  weights: [number, number];
  /** The left biome's share of the two, clamped to {@link PAIR_FULL_SPLIT}. */
  split: number;
  /** Its share of the half's row. */
  share: number;
  /** The pair stage ({@link pairFullStage}), at most the pair's last pictured stage. */
  stage: number;
  /** Spec 1.14: the third biome, drawn as an element over the whole-half picture (ScenePieces), when the pack has one for its colour. */
  element?: Biome;
  /**
   * Spec 1.16.1: with an element, which painted-in picture the half draws, in
   * the manifest KEY's order ({@link pairFullElementSide}: the heavier pair
   * colour's ground, the key's colours before any mirroring).
   */
  elementSide?: PairSide;
  /**
   * Spec 1.17 (draft): the seam grid's cell the half draws, when the pair has
   * a grid with a cell for the two colours' own stages ({@link pairFullGrid}).
   * Its orientation is the geography's, so it carries its own `mirror`;
   * {@link mirror} above stays the key's, for the `stages` pictures it falls
   * back to.
   */
  grid?: PairFullGrid;
}

/** Spec 1.17: the grid cell a whole-half pair draws, and how. */
export interface PairFullGrid extends PairGridPick {
  /** The picture's left and right halves' colours (pairs.ts `GEOGRAPHY`'s order). */
  left: Biome;
  right: Biome;
  /** The board has the pair the other way round from the geography (the cell is drawn mirrored). */
  mirror: boolean;
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

/**
 * Spec 1.17 (draft): the seam grid's cell for a pair whose board-left biome
 * is at mono stage `stageLeft` and board-right at `stageRight` (each
 * colour's own stage: layout.ts's, the preview's slider when set), or
 * undefined (no grid, or no cell even after the clamp: the `stages`).
 */
export function pairFullGrid(pair: PackPair, boardLeft: Biome, stageLeft: number, stageRight: number): PairFullGrid | undefined {
  const g = pair.grid;
  if (!g) return undefined;
  const mirror = boardLeft !== g.left;
  const pick = pairGridPick(pair, mirror ? stageRight : stageLeft, mirror ? stageLeft : stageRight);
  return pick ? { ...pick, left: g.left, right: g.right, mirror } : undefined;
}

/** A pair with a whole-half picture: a 1.9 band pair (a motif pair has no `half`, 1.12). */
function pictured(pair: PackPair): boolean {
  return pair.kind === 'band' && !!pairHalfAt(pair, 1);
}

/**
 * The half's row under spec 1.15, or null when the half is drawn as
 * today: exactly two live biomes with a pictured pair → the pair picture
 * alone; three → makeup.ts's pair (the one rule the pieces use) across the
 * whole half with the third as its element (`elements`, or a painted-in
 * element at that stage, spec 1.16), else beside the third biome's panel.
 * Withered panels are left out (the picture is the half). `layout` is
 * layout.ts `halfLayout`'s, already down to the three kept biomes, whose
 * weights are their own (a dropped fourth or fifth colour weighs nothing);
 * `showing` is what was on screen before, for the tie rule.
 */
export function pairFullPlan(
  layout: readonly HalfSlotLayout[],
  pairs: PairsPack | null | undefined,
  opts: {
    thresholds?: readonly number[] | null;
    stageOverride?: number | null;
    elements?: ReadonlySet<Biome> | null;
    showing?: MakeupShowing | null;
    /** The half's own slots, before layout.ts dropped a fourth or fifth colour: the stage counts EVERY coloured land (SYSTEM.md A5). Without them, the layout's. */
    slots?: readonly SlotState[] | null;
  } = {},
): PairFullItem[] | null {
  if (!pairs) return null;
  const live = layout.map((l, i) => ({ l, i })).filter(({ l }) => l.stage > 0 && l.slot.weight > 0);
  if (live.length < 2 || live.length > 3) return null;
  const thresholds = opts.thresholds ?? DEFAULT_STAGE_THRESHOLDS;
  const shareSum = live.reduce((n, x) => n + x.l.share, 0) || 1;
  const byBiome = (b: Biome) => live.find((x) => x.l.slot.biome === b) ?? null;
  // The pair: makeup.ts's rule on the live biomes (every one has a colour since 1.11; one without takes the old path below).
  const coloured = live.every((x) => !!BIOME_COLOUR[x.l.slot.biome]);
  const pick = coloured ? pickFromSlots(opts.slots ?? live.map((x) => x.l.slot), opts.showing ?? null) : null;
  const picked = pick?.pair ? pairFor(pairs, COLOUR_BIOME[pick.pair[0]], COLOUR_BIOME[pick.pair[1]]) : null;
  if (pick?.pair && picked && pictured(picked.pair)) {
    // The two in row order (the left one the board's left).
    const [x, y] = [byBiome(COLOUR_BIOME[pick.pair[0]])!, byBiome(COLOUR_BIOME[pick.pair[1]])!].sort((p, q) => p.i - q.i) as [(typeof live)[number], (typeof live)[number]];
    const found = pairFor(pairs, x.l.slot.biome, y.l.slot.biome)!;
    const wa = x.l.slot.weight;
    const wb = y.l.slot.weight;
    const third = pick.third ? byBiome(COLOUR_BIOME[pick.third]) : null;
    // Spec 1.17 (draft): a cell for the two colours' own stages takes the whole half; a third colour shows nothing on it.
    const grid = pairFullGrid(found.pair, x.l.slot.biome, x.l.stage, y.l.stage);
    if (grid) {
      const stage = pairFullStage(found.pair, third ? pick.total : wa + wb, thresholds, opts.stageOverride ?? null);
      return [{ kind: 'pair', key: found.pair.key, pair: found.pair, mirror: found.mirror, left: x.l.slot.biome, right: y.l.slot.biome, weights: [wa, wb], split: pairFullSplit(wa, wb), share: 1, stage, grid }];
    }
    if (third) {
      // Spec 1.14 / 1.16: the third colour inside the pair picture, which takes the whole half and grows with every coloured land.
      const stage = pairFullStage(found.pair, pick.total, thresholds, opts.stageOverride ?? null);
      const colour = pick.third!;
      const item: PairFullPair = { kind: 'pair', key: found.pair.key, pair: found.pair, mirror: found.mirror, left: x.l.slot.biome, right: y.l.slot.biome, weights: [wa, wb], split: pairFullSplit(wa, wb), share: 1, stage, element: third.l.slot.biome };
      // Spec 1.16.1: the painted picture is the heavier pair colour's side (the arrival order breaks a tie, as the cut-out's).
      const side = pairFullElementSide(item, (b) => (b === x.l.slot.biome ? x.l.slot.index : y.l.slot.index));
      if (opts.elements?.has(third.l.slot.biome) || pairElementAt(found.pair, stage, colour, side)) return [{ ...item, elementSide: side }];
    }
    return withPanel(found, x, y, third, shareSum, thresholds, opts.stageOverride ?? null);
  }
  // No picture for makeup.ts's pair: the heaviest pictured pair (a tie, the earlier arrivals), the third as a panel; no element.
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
  const third = live.find((x) => x !== a && x !== b) ?? null;
  return withPanel(pairFor(pairs, a.l.slot.biome, b.l.slot.biome)!, a, b, third, shareSum, thresholds, opts.stageOverride ?? null);
}

/** The pair picture beside the third biome's panel (its own `halfLayout` share and stage, at its end of the row), or alone. */
function withPanel(
  found: { pair: PackPair; mirror: boolean },
  a: { l: HalfSlotLayout; i: number },
  b: { l: HalfSlotLayout; i: number },
  third: { l: HalfSlotLayout; i: number } | null,
  shareSum: number,
  thresholds: readonly number[],
  stageOverride: number | null,
): PairFullItem[] {
  const wa = a.l.slot.weight;
  const wb = b.l.slot.weight;
  const thirdShare = third ? r4(third.l.share / shareSum) : 0;
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
    stage: pairFullStage(found.pair, wa + wb, thresholds, stageOverride),
  };
  const grid = pairFullGrid(found.pair, a.l.slot.biome, a.l.stage, b.l.stage);
  if (grid) item.grid = grid;
  if (!third) return [item];
  const slot: PairFullSlot = { kind: 'slot', index: third.i, biome: third.l.slot.biome, share: thirdShare };
  return third.i < a.i && third.i < b.i ? [slot, item] : [item, slot];
}

/**
 * The picture a whole-half pair panel draws: the stage's 1.15 `panorama` when
 * it has one, else its 1.9 `half`. A panorama with no phone picture gives way
 * to the half wherever the half would draw its phone picture (a phone, or a
 * phone-shaped panel), so a desktop-only panorama never lands on a phone.
 * `horizon` (spec 1.13's one horizon): the crop pins the picture's horizon at
 * layout.ts `HORIZON_AT`, as every other panel's.
 */
export function pairFullArt(half: PackHalf | null, panorama: PackHalf | null, panelAspect: number | null, narrow: boolean, horizon = false): HalfArt | null {
  const fromHalf = half ? halfArtOf(half, panelAspect, { narrow, horizon }) : null;
  if (!panorama) return fromHalf;
  if (!panorama.phone && fromHalf?.source === 'phone') return fromHalf;
  return halfArtOf(panorama, panelAspect, { narrow, horizon });
}

/** One picture a whole-half pair panel can draw: its art, and the colour painted into it (spec 1.16), or null. */
export interface PairFullCandidate {
  art: HalfArt;
  painted: PieceColour | null;
  /** Drawn mirrored: the board has the pair the other way round from this picture's own order (the key's; a grid cell's, the geography's). */
  mirror: boolean;
  /** Spec 1.17: the grid cell this picture is (`"4x3"`), when it is one. */
  cell?: string;
}

/**
 * The pictures a whole-half pair panel can draw, best first, each once: the
 * seam grid's cell (spec 1.17, in its own orientation), the stage's painted-in
 * element panorama for the pair's element colour (spec 1.16), the stage's
 * panorama (1.15), the stage's 1.9 `half`. Each goes
 * through {@link pairFullArt}, so a desktop-only panorama never reaches a
 * phone-shaped panel. `panelAspect` is the pair panel's own shape.
 */
export function pairFullCandidates(p: PairFullPair, panelAspect: number | null, narrow: boolean, horizon = false): PairFullCandidate[] {
  const half = pairHalfAt(p.pair, p.stage);
  const pano = pairPanoramaAt(p.pair, p.stage);
  const colour = p.element ? (BIOME_COLOUR[p.element] ?? null) : null;
  // Spec 1.16.1: the side the plan picked (the heavier pair colour's ground); a sided entry without it falls back to the base panorama.
  const painted = colour ? pairElementAt(p.pair, p.stage, colour, p.elementSide) : null;
  const out: PairFullCandidate[] = [];
  const add = (art: HalfArt | null, from: PackHalf | null, c: PieceColour | null, grid?: PairFullGrid) => {
    const pic = art?.picture;
    if (!art || !pic || out.some((x) => x.art.picture!.src === pic.src)) return;
    // pairFullArt fell back to the half: not this candidate's own picture.
    if (from && pic.src !== from.src && pic.src !== from.phone?.src) return;
    out.push({ art, painted: c, mirror: grid ? grid.mirror : p.mirror, ...(grid ? { cell: grid.cell } : {}) });
  };
  // Spec 1.17: a cell with no phone picture gives way to the stage's pictures on a phone-shaped panel, as a panorama does.
  if (p.grid) add(pairFullArt(half, p.grid.picture, panelAspect, narrow, horizon), p.grid.picture, null, p.grid);
  if (painted) add(pairFullArt(half, painted, panelAspect, narrow, horizon), painted, colour);
  if (pano) add(pairFullArt(half, pano, panelAspect, narrow, horizon), pano, null);
  add(pairFullArt(half, null, panelAspect, narrow, horizon), half, null);
  return out;
}

/**
 * The load gate (review fault 4): which candidate to draw now and which to
 * wait for. `want` is the best candidate that has not failed; `show` is the
 * best one that has loaded (so a stage change or a painted-in element keeps
 * the picture on screen until its own is ready, then cross-fades). `show`
 * null: nothing has loaded yet, or everything failed -- the half is drawn as
 * without the flag (its panels and band), never blank, while `want` (if
 * any) loads.
 */
export function pairFullChoice(cands: readonly PairFullCandidate[], status: (src: string) => 'ready' | 'failed' | 'pending'): { show: PairFullCandidate | null; want: PairFullCandidate | null } {
  const want = cands.find((c) => status(c.art.picture!.src) !== 'failed') ?? null;
  const show = cands.find((c) => status(c.art.picture!.src) === 'ready') ?? null;
  return { show, want };
}

/**
 * Spec 1.16.1 (the review of #199): may the 1.14 cut-out element be drawn over
 * the pair picture? Only when the half has no painted picture for its third
 * colour at all: none shown, and none wanted (one still loading, or held by
 * the strip). A painted picture that failed is not wanted, so the cut-out
 * stands in for it.
 */
export function pairFullCutOutAllowed(choice: { show: PairFullCandidate | null; want: PairFullCandidate | null } | null): boolean {
  return !!choice?.show && !choice.show.painted && !choice.want?.painted;
}

/** How long a half holds its previous picture while the pair picture it now wants loads, before it draws its panels instead. */
export const PAIR_FULL_HOLD_MS = 8000;

/** What a half draws: its layout, and the whole-half pair plan with the picture shown (null: the half as without the flag). */
export interface PairFullDraw<L> {
  layout: L;
  plan: PairFullItem[] | null;
  shown: PairFullCandidate | null;
}

/** {@link pairFullHold}'s memory: the last thing drawn, and since when the half has been waiting (null: not waiting). */
export interface PairFullHold<L> {
  last: PairFullDraw<L> | null;
  since: number | null;
}

/**
 * The load gate's hold (the review of #198: falling back to the panels while
 * a cold panorama loaded was a layout jump -- one colour's panel, then two
 * panels and a band, then the panorama). While the half wants a pair picture
 * that has not loaded (and has not failed), it keeps drawing what it drew
 * last -- the mono picture, or the previous stage's panorama -- for at most
 * {@link PAIR_FULL_HOLD_MS}; then, or with nothing drawn before, or when
 * every picture failed, its panels. Once a picture is ready it is drawn.
 * Spec 1.16.1: likewise while a painted picture is on screen and another
 * painted one is wanted and still loading (a flipped side, a stage change):
 * the painted one is held, never the base panorama in between.
 * Spec 1.17 (the review of #201): likewise while a grid cell is on screen and
 * another cell is wanted and still loading (a half stepping down, two halves
 * in one frame, a step of two, a slow network): the cell is held, never the
 * pair's old whole-place panorama in between (it is always warm, so the load
 * gate's `show` would otherwise be it: cell → panorama → cell).
 * Pure: `hold` in, the new memory out (SceneryStrip keeps it in a ref).
 */
export function pairFullHold<L>(
  cur: { layout: L; plan: PairFullItem[] | null; choice: { show: PairFullCandidate | null; want: PairFullCandidate | null } | null },
  hold: PairFullHold<L>,
  now: number,
  holdMs = PAIR_FULL_HOLD_MS,
): { draw: PairFullDraw<L>; hold: PairFullHold<L>; holding: boolean } {
  const cold = !!cur.plan && !!cur.choice && !cur.choice.show && !!cur.choice.want;
  // Spec 1.16.1 (the review of #199): a painted picture on screen and another painted one wanted but not loaded (the
  // side flipped, or the stage changed): hold the painted one rather than drop to the base panorama for a fetch.
  const paintedNext = !!cur.plan && !!cur.choice?.want?.painted && cur.choice.show !== cur.choice.want && !!hold.last?.shown?.painted;
  // Spec 1.17 (the review of #201): a grid cell on screen and another cell wanted but not loaded: hold the cell.
  const gridNext = !!cur.plan && !!cur.choice?.want?.cell && cur.choice.show !== cur.choice.want && !!hold.last?.shown?.cell;
  if (cold || paintedNext || gridNext) {
    const since = hold.since ?? now;
    if (hold.last && now - since < holdMs) return { draw: hold.last, hold: { last: hold.last, since }, holding: true };
    if (cold) return { draw: { layout: cur.layout, plan: null, shown: null }, hold: { last: hold.last, since }, holding: false };
    // The painted (or grid) hold ran out: what has loaded (the base panorama), drawn below.
  }
  const draw: PairFullDraw<L> = { layout: cur.layout, plan: cur.choice?.show ? cur.plan : null, shown: cur.choice?.show ?? null };
  const same = hold.last && hold.last.layout === draw.layout && hold.last.plan === draw.plan && hold.last.shown === draw.shown;
  return { draw: same ? hold.last! : draw, hold: { last: same ? hold.last : draw, since: null }, holding: false };
}

/** A pair panel's shape from the half's (rounded as SceneryStrip measures it: to 0.05), or null when unknown. */
export function pairFullPanelAspect(halfAspect: number | null, share: number): number | null {
  if (!(halfAspect && halfAspect > 0 && share > 0)) return null;
  return Math.round(halfAspect * share * 20) / 20;
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
export function pairFullFrame(box: { w: number; h: number }, art: Pick<HalfArt, 'aspect' | 'focal' | 'safe' | 'focalTo'>, split: number): FrameRect & { seamAt: number } {
  if (!(box.w > 0 && box.h > 0 && art.aspect > 0)) return { left: 0, top: 0, width: 1, height: 1, seamAt: 0.5 };
  const s = clamp(split, PAIR_FULL_SPLIT[0], PAIR_FULL_SPLIT[1]);
  const t = art.focal.x;
  const z = pairFullZoom(s, t);
  const dw = Math.max(z * box.w, box.h * art.aspect);
  const dh = dw / art.aspect;
  const left = clamp(s * box.w - t * dw, box.w - dw, 0);
  const safe = art.safe;
  const oy = cropAxis(box.h, dh, art.focal.y, safe ? safe.y : null, safe ? safe.h : null, art.focalTo ?? 0.5);
  return { left: r4(left / box.w) || 0, top: r4(-oy / box.h) || 0, width: r4(dw / box.w), height: r4(dh / box.h), seamAt: r4((left + t * dw) / box.w) };
}

/** {@link pairFullFrame} as CSS for an element inside a size container (the panel: `cqw` / `cqh`), so the crop follows the panel as it grows. */
export function pairFullFrameCss(art: Pick<HalfArt, 'aspect' | 'focal' | 'safe' | 'focalTo'>, split: number): { left: string; top: string; width: string; height: string } {
  const f = (n: number) => String(r4(n));
  const s = clamp(split, PAIR_FULL_SPLIT[0], PAIR_FULL_SPLIT[1]);
  const t = art.focal.x;
  const dw = `max(${f(pairFullZoom(s, t))} * 100cqw, ${f(art.aspect)} * 100cqh)`;
  const dh = `(${dw} / ${f(art.aspect)})`;
  const safe = art.safe;
  return {
    left: `clamp(100cqw - ${dw}, ${f(s)} * 100cqw - ${f(t)} * ${dw}, 0px)`,
    top: `calc(-1 * ${cropAxisCss('100cqh', dh, art.focal.y, safe ? safe.y : null, safe ? safe.h : null, art.focalTo ?? 0.5)})`,
    width: dw,
    height: `calc(${dh})`,
  };
}

/** How far short of the transition an element's region stops (spec 1.14's elements on a whole-half picture). */
export const PAIR_FULL_ELEMENT_MARGIN = 0.05;

/** A span of the half's width, as fractions of it (pieces.ts `Region`'s shape). */
export interface PairFullSpan {
  left: number;
  width: number;
}

/**
 * Where a whole-half pair picture puts things, in the HALF's own fractions
 * and board order (the mirror applied): what spec 1.14's pieces stand on.
 */
export interface PairFullView {
  /** The pair panel: the whole half, or all of it but the third biome's panel (the placeholder). */
  panel: PairFullSpan;
  /** Where the transition lands across the half (board order: the left biome's ground ends here). */
  seamAt: number;
  /** Each biome's ground: the left biome from the panel's left edge to the transition, the right biome from there to the panel's right edge. */
  ground: { left: PairFullSpan; right: PairFullSpan };
  /** The picture's horizon, a fraction of the half's height from its top (declared, else estimated: layout.ts `horizonOf`), through the crop. */
  horizonY: number;
  /** The picture's frame in the pair panel (pairFullFrame, the picture's own order; the panel flips it when mirrored). */
  frame: FrameRect;
}

/**
 * {@link PairFullView} for a plan's pair in a half of `box` px drawing `art`
 * (pairFullArt's). Null without a pair, a box or an art. The pair panel's
 * pixel width is its share of the half (the seam between it and a third
 * panel is ignored: a placeholder).
 */
export function pairFullView(items: readonly PairFullItem[] | null, box: { w: number; h: number }, art: Pick<HalfArt, 'aspect' | 'focal' | 'safe' | 'focalTo' | 'picture'> | null, mirrored?: boolean): PairFullView | null {
  const p = items?.find((x): x is PairFullPair => x.kind === 'pair');
  if (!p || !art || !(box.w > 0 && box.h > 0)) return null;
  // The picture's own orientation (pairFullCandidates' `mirror`: a grid cell's is the geography's), else the key's.
  const mirror = mirrored ?? p.mirror;
  const pairFirst = items![0] === p;
  const panel = { left: r4(pairFirst ? 0 : 1 - p.share), width: r4(p.share) };
  const frame = pairFullFrame({ w: box.w * p.share, h: box.h }, art, mirror ? 1 - p.split : p.split);
  const seamInPanel = mirror ? 1 - frame.seamAt : frame.seamAt;
  const seamAt = r4(panel.left + seamInPanel * panel.width);
  const hz = art.picture ? horizonOf(art.picture) : art.focal.y;
  return {
    panel,
    seamAt,
    ground: { left: { left: panel.left, width: r4(seamAt - panel.left) }, right: { left: seamAt, width: r4(panel.left + panel.width - seamAt) } },
    horizonY: r4(frame.top + hz * frame.height),
    frame: { left: frame.left, top: frame.top, width: frame.width, height: frame.height },
  };
}

/**
 * The region spec 1.14's element stands in on a whole-half pair picture: the
 * heavier pair colour's ground (`side`, pieces.ts `HalfPlan.element.side`),
 * stopping {@link PAIR_FULL_ELEMENT_MARGIN} of the half short of the
 * transition, so the element stays on its own ground. Never narrower than 0.
 */
export function pairFullElementRegion(view: PairFullView, side: 'left' | 'right', margin = PAIR_FULL_ELEMENT_MARGIN): PairFullSpan {
  const g = view.ground[side];
  const width = r4(Math.max(0, g.width - margin));
  return side === 'left' ? { left: g.left, width } : { left: r4(g.left + g.width - width), width };
}

/**
 * Which ground the heavier pair colour has, in board order: the heavier
 * weight, a tie the biome that arrived first (`indexOf`: a biome's arrival
 * index), as pieces.ts `rankColours` ranks them.
 */
export function pairFullHeavierSide(p: PairFullPair, indexOf: (b: Biome) => number): 'left' | 'right' {
  const [wl, wr] = p.weights;
  if (wl !== wr) return wl > wr ? 'left' : 'right';
  return indexOf(p.left) <= indexOf(p.right) ? 'left' : 'right';
}

/**
 * Spec 1.16.1: which sided painted-in picture a pair with an element draws,
 * in the manifest KEY's order: SYSTEM.md A5 puts the element on the HEAVIER
 * pair colour's ground, so `left` (the painter's `s<k>+<C>L`, the feature on
 * the key's first colour's ground) when that colour is the heavier, else
 * `right`. The weights are the board's ({@link pairFullHeavierSide}, a tie the
 * earlier arrival); when the board has the pair the other way round the rule
 * is applied to the key's colours and the picture is then mirrored with the
 * panorama, so the feature still lands on the heavier colour's ground.
 */
export function pairFullElementSide(p: PairFullPair, indexOf: (b: Biome) => number): PairSide {
  const board = pairFullHeavierSide(p, indexOf);
  if (!p.mirror) return board;
  return board === 'left' ? 'right' : 'left';
}

/** A caption for the preview page: "Tundra, whole half: island 80% | plains 20%, pair stage 2". */
export function pairFullCaption(items: readonly PairFullItem[] | null): string | null {
  const p = items?.find((x): x is PairFullPair => x.kind === 'pair');
  if (!p) return null;
  const third = items!.find((x): x is PairFullSlot => x.kind === 'slot');
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return `${p.pair.dual ?? p.key}${p.pair.shock ? ` (${p.pair.shock})` : ''}, ${third ? `${pct(p.share)} of the half` : 'whole half'}: ${p.left} ${pct(p.split)} | ${p.right} ${pct(1 - p.split)}, ${p.grid ? gridCaption(p.grid) : `pair stage ${p.stage}`}${third ? `; ${third.biome} ${pct(third.share)} panel (placeholder)` : ''}${p.element ? elementCaption(p) : ''}`;
}

/**
 * Spec 1.17: "island s4 | swamp s3, seam 4x3", in the picture's (the
 * geography's) order; a clamped half says its own stage and the one shown:
 * "island s6 | swamp s2→s5, seam 6x5 (clamped)".
 */
export function gridCaption(g: PairFullGrid): string {
  const half = (b: Biome, own: number, shown: number) => `${b} s${own}${own !== shown ? `→s${shown}` : ''}`;
  return `${half(g.left, g.stages[0], g.shown[0])} | ${half(g.right, g.stages[1], g.shown[1])}, seam ${g.cell}${g.clamped ? ' (clamped)' : ''}`;
}

/** The caption's element: "; R painted in, on plains's ground" (spec 1.16.1) or "; mountain as an element" (the 1.14 cut-out). */
function elementCaption(p: PairFullPair): string {
  const colour = BIOME_COLOUR[p.element!];
  const side = p.elementSide;
  if (colour && pairElementAt(p.pair, p.stage, colour, side)) return side ? `; ${colour} painted in, on ${side === 'left' ? p.pair.left : p.pair.right}'s ground` : `; ${colour} painted in`;
  return `; ${p.element} as an element`;
}
