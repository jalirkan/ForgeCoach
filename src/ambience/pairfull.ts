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
 * - Spec 1.18 (draft): a cell with a `phone` picture is planned on a
 *   phone-width screen too (the same cell; one without still gives way to
 *   the `stages`), and a third colour on a grid picture draws the cell's own
 *   painted-in picture on the heavier pair colour's half when the cell has
 *   one ({@link PairFullGrid}'s `painted`, pairs.ts `pairGridPaintedAt`),
 *   else nothing, as 1.17. Never a cut-out on a cell: the plan carries no
 *   `element` there -- with one exception, spec 1.18.1 (a phone): where
 *   the cell has the third colour painted in on that half but the picture
 *   has no `phone`, a phone-width screen draws the third colour's 1.14
 *   cut-out (its `phone` piece only, `opts.phoneElements`) on the plain
 *   cell's phone picture, as a pair without a grid draws it: the plan's
 *   `element`, and ScenePieces places it in {@link pairFullElementRegion}.
 *
 * - Spec 1.19 (draft, the owner's rules of 2026-11-02 after the storyboard):
 *   (a) every colour is visible -- the third is painted in where the picture
 *   shown has it, else its 1.14 cut-out, else (no element) 1.15's third
 *   panel; every colour past the third is a cut-out too (the plan's
 *   `extras`, pieces.ts `stackElements` stacks them), on a cell as on a stage
 *   picture, a phone drawing only the phone pieces; (b) makeup.ts keeps the
 *   pair showing as the base; (c) NO clamp: a grid with no cell for the two
 *   colours' own stages draws each colour's own mono picture side by side
 *   where the cell's halves would be (board order), at the pair's split,
 *   joined by the plain 1.10 seam, no band picture -- the plan's `apart`
 *   ({@link pairFullApart}); a cell painted later is preferred at once.
 *
 * - Spec 1.20, scenes (scenes.ts): before any of the above, when the scenes
 *   pack (`opts.scenes`) has a painting for the half's exact state (scenes.ts
 *   `sceneKey`, over the half's own slots), the plan is that one item, a
 *   {@link PairFullScene}: the whole half, at a desktop and on a phone alike,
 *   drawn as painted -- no pair, no element, no extras, no cut-out, no panel,
 *   no band. With or without the whole-half flag (a caller without it passes
 *   no pairs, and only a scene can come back).
 * - Spec 1.21, the nearest scene (scenes.ts `nearestScene`): a half of two or
 *   more colours with no scene of its own draws the NEAREST painted scene,
 *   alone, as a scene state draws it -- the same colours at the nearest
 *   stages, else with the lightest colour dropped, down to one colour and the
 *   pack's own picture of it (`opts.biomes`) -- its {@link PairFullScene}
 *   carrying `nearest` for the caption and the DOM. So with a scenes pack
 *   loaded, a half of two or more colours never reaches the pair logic below
 *   (unless every picture it could draw failed); a half of one colour does,
 *   as before. No scenes pack: everything above, unchanged.
 *
 * Pure and DOM-free; the drawing is ui/ambience/SceneryStrip.tsx's
 * `PairFullPanel` (and `ScenePanel` for a scene).
 */
import { DEFAULT_STAGE_THRESHOLDS, stageFor, type Biome, type SlotState } from './model.ts';
import { cropAxis, cropAxisCss, halfArtOf, horizonOf, type FrameRect, type HalfArt, type HalfSlotLayout } from './layout.ts';
import type { PackHalf, PieceColour } from './manifest.ts';
import { geographyOrder, gridCellKey, pairElementAt, pairFor, pairGridGivesWay, pairGridPaintedAt, pairGridPick, pairHalfAt, pairPanoramaAt, pairStageFor, pairWords, type PackPair, type PairGridPick, type PairSide, type PairsPack } from './pairs.ts';
import { BIOME_COLOUR, COLOUR_BIOME, pickFromSlots, type MakeupShowing } from './makeup.ts';
import { heaviestMono, nearestScene, nearestWords, sceneLands, sceneWords, type MonoBiomes, type NearestScene, type PackScene, type ScenesPack } from './scenes.ts';

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
  /**
   * Spec 1.14: the third biome, drawn as an element over the whole-half picture (ScenePieces), when the pack has one for
   * its colour. On a grid cell only by spec 1.18.1 (a phone, the cell's painted picture of it with no phone picture):
   * then a cut-out from its `phone` piece, never a painted picture.
   */
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
  /**
   * Spec 1.19 c (draft): the pair has a grid but no cell for the two colours' own stages (they differ by more than
   * one, and nobody has painted that cell): no clamp. The half is each colour's own mono picture at its own stage
   * (SceneryStrip's ordinary panels), side by side in board order -- where the cell's two halves would be, the
   * geography's order mirrored as the cell would be -- at {@link split}, joined by the plain 1.10 mist seam, no band
   * picture. A painted cell for those stages is drawn instead the day it exists.
   */
  apart?: PairFullApart;
  /**
   * Spec 1.19 a: the colours past the third (makeup.ts `extras`, heaviest first) that are drawn as 1.14 cut-outs at
   * this shape (the pack has an element for them; on a phone-width screen one with a `phone` piece).
   */
  extras?: Biome[];
}

/** Spec 1.19 c: a pair drawn as its two mono pictures, the grid having no cell for its stages. */
export interface PairFullApart {
  /** The missing cell, `"1x5"`, in the geography's order. */
  cell: string;
  /** The geography's left and right colour, and each one's own stage. */
  left: Biome;
  right: Biome;
  stages: [number, number];
}

/** Spec 1.17: the grid cell a whole-half pair draws, and how. */
export interface PairFullGrid extends PairGridPick {
  /** The picture's left and right halves' colours (pairs.ts `GEOGRAPHY`'s order). */
  left: Biome;
  right: Biome;
  /** The board has the pair the other way round from the geography (the cell is drawn mirrored). */
  mirror: boolean;
  /**
   * Spec 1.18 (draft): the third colour painted into this cell, drawn instead
   * of the plain cell: the colour, the side in the CELL's (geography) order
   * -- the heavier pair colour's half -- and the picture. Absent: the third
   * colour draws nothing on the cell (1.17), and no cut-out either.
   */
  painted?: { colour: PieceColour; side: PairSide; picture: PackHalf };
}

/** The third biome's panel (today's panel, a placeholder for a triple composition). */
export interface PairFullSlot {
  kind: 'slot';
  /** Its index in the half layout. */
  index: number;
  biome: Biome;
  share: number;
}

/**
 * Spec 1.20: the half's scene, a painting of its exact state, across the whole half (its `phone` picture on a phone,
 * by the rule a grid cell's follows), never mirrored. The plan's only item when it is there.
 */
export interface PairFullScene {
  kind: 'scene';
  /** scenes.ts `sceneKeyOf`: `island2+forest3+mountain2`. The key DRAWN (spec 1.21: the nearest scene's, when it stands in). */
  key: string;
  scene: PackScene;
  share: 1;
  /**
   * Spec 1.21: present when the scene stands in for a state with no scene of its own -- the state asked for (`for`),
   * the colours dropped and the colours clamped, and whether it is the pack's own picture of one colour (`mono`).
   */
  nearest?: Pick<NearestScene, 'for' | 'dropped' | 'clamped' | 'mono'>;
}

export type PairFullItem = PairFullPair | PairFullSlot | PairFullScene;

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
 * undefined (no grid, or no cell: the `stages`, or 1.19 c's
 * {@link pairFullApart}). Spec 1.19 c: the exact cell only, never a clamp.
 * `narrow` (a phone-width screen): undefined too for a cell that gives way
 * there (pairs.ts `pairGridGivesWay`).
 */
export function pairFullGrid(pair: PackPair, boardLeft: Biome, stageLeft: number, stageRight: number, narrow = false): PairFullGrid | undefined {
  const g = pair.grid;
  if (!g) return undefined;
  const mirror = boardLeft !== g.left;
  const pick = pairGridPick(pair, mirror ? stageRight : stageLeft, mirror ? stageLeft : stageRight);
  if (!pick || (narrow && pairGridGivesWay(pair, pick.picture))) return undefined;
  return { ...pick, left: g.left, right: g.right, mirror };
}

/**
 * Spec 1.19 c (draft): a pair with a seam grid but no cell for its two colours' own stages (both on the half, both on
 * the geography) is drawn apart: each colour's own mono picture, no clamp. Undefined when the pair has no grid or the
 * cell exists (the cell is drawn; one painted later is preferred with no code change).
 */
export function pairFullApart(pair: PackPair, boardLeft: Biome, boardRight: Biome, stageLeft: number, stageRight: number): PairFullApart | undefined {
  const g = pair.grid;
  if (!g || !(stageLeft > 0) || !(stageRight > 0) || !geographyOrder(boardLeft, boardRight)) return undefined;
  const mirror = boardLeft !== g.left;
  const i = Math.min(6, Math.round(mirror ? stageRight : stageLeft));
  const j = Math.min(6, Math.round(mirror ? stageLeft : stageRight));
  const cell = gridCellKey(i, j);
  if (g.cells[cell]) return undefined;
  return { cell, left: g.left, right: g.right, stages: [i, j] };
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
    /**
     * A phone-width screen (layout.ts `PHONE_VIEWPORT_MAX`, SceneryStrip's
     * `useNarrowScreen`): a seam grid cell with no phone picture is not
     * planned (pairs.ts `pairGridGivesWay`); the half is the pair's `stages`.
     * Spec 1.18: a cell with one is planned, the same cell as on a desktop;
     * its painted-in picture only with a phone picture of its own.
     */
    narrow?: boolean;
    /**
     * Spec 1.18.1: the biomes whose 1.14 element has a `phone` picture
     * (pieces.ts `phoneElementBiomes`). On a phone-width screen, a cell with
     * the third colour painted in on the heavier half but no phone picture of
     * it draws that colour's cut-out instead -- only one of these.
     */
    phoneElements?: ReadonlySet<Biome> | null;
    /** Spec 1.20: the scenes pack (scenes.ts); a scene for the half's exact state is the whole plan (spec 1.21: or its nearest). */
    scenes?: ScenesPack | null;
    /**
     * Spec 1.21: the scenery pack's biomes, for the nearest scene's last step (one colour left: the pack's own 1.5
     * picture of it, drawn as a scene) and the stand-in for a painting that failed. Absent: that step draws nothing
     * and the half goes on to today's plan.
     */
    biomes?: MonoBiomes | null;
    /**
     * Spec 1.20: has this picture failed to load (pack.ts `pictureStatus(src) === 'failed'`)? When the scene's chosen
     * picture at this shape ({@link sceneCandidates}: `narrow`, `halfAspect`) has, the half is planned as if there
     * were no scenes -- today's plan, the pair picture and its cut-outs -- never the bare panels. Absent: never failed
     * (the storyboard takes every picture as loaded).
     */
    sceneFailed?: ((src: string) => boolean) | null;
    /** The whole half's shape (width / height), for the scene's chosen picture; unknown: the desktop picture unless `narrow`. */
    halfAspect?: number | null;
  } = {},
): PairFullItem[] | null {
  // Spec 1.20: a scene for the half's exact state wins, whole, before any pair logic (and with no pairs pack at all).
  // The `showing` memory (makeup.ts MakeupMemory) is deliberately NOT moved to the scene: a scene is not a pick, so the
  // memory keeps folding the pair rule over every state as if no scene were drawn, and when the scene ends (a land
  // with no scene for its state, e.g. a fourth colour) the pair rule continues from its own last pick -- the pair it
  // would have been showing all along -- rather than from whatever the painting happened to contain.
  // Spec 1.21: no scene of its own, the nearest painted scene -- the same colours at the nearest stages, else fewer
  // colours, down to the pack's own picture of one -- drawn exactly as a scene; never the seam and its cut-outs.
  const lands = opts.scenes ? sceneLands(opts.slots ?? layout.map((l) => l.slot), opts.thresholds ?? DEFAULT_STAGE_THRESHOLDS) : [];
  const near = nearestScene(opts.scenes, lands, opts.biomes ?? null);
  if (near) {
    const failed = (item: PairFullScene) => {
      const chosen = sceneCandidates(item, pairFullPanelAspect(opts.halfAspect ?? null, 1), opts.narrow ?? false)[0];
      return !!opts.sceneFailed && !!chosen && opts.sceneFailed(chosen.art.picture!.src);
    };
    const item = sceneItem(near);
    if (!failed(item)) return [item];
    // The painting failed at this shape (the finding of the 1.20 review): spec 1.21, the heaviest colour's own picture
    // alone; a half of one colour, or that picture failing too, goes back to today's plan, with no scenes.
    const mono = near.mono ? null : heaviestMono(lands, opts.biomes ?? null);
    if (mono && !failed(sceneItem(mono))) return [sceneItem(mono)];
    return pairFullPlan(layout, pairs, { ...opts, scenes: null });
  }
  // Spec 1.19 a: a cut-out is drawn at this shape when the pack has one -- on a phone-width screen its phone piece only.
  const narrowScreen = opts.narrow ?? false;
  const cuttable = (b: Biome) => !!(narrowScreen ? opts.phoneElements : opts.elements)?.has(b);
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
    // The colours past the third (spec 1.19 a): each a cut-out where the pack has one at this shape.
    const extras = pick.extras.map((c) => COLOUR_BIOME[c]).filter(cuttable);
    // Spec 1.17 (draft): a cell for the two colours' own stages takes the whole half. Spec 1.19 c: no cell for them (and
    // a grid), no clamp: the two mono pictures apart.
    const grid = pairFullGrid(found.pair, x.l.slot.biome, x.l.stage, y.l.stage, narrowScreen);
    const apart = grid ? undefined : pairFullApart(found.pair, x.l.slot.biome, y.l.slot.biome, x.l.stage, y.l.stage);
    if (grid || apart) {
      const stage = pairFullStage(found.pair, third ? pick.total : wa + wb, thresholds, opts.stageOverride ?? null);
      const item: PairFullPair = { kind: 'pair', key: found.pair.key, pair: found.pair, mirror: found.mirror, left: x.l.slot.biome, right: y.l.slot.biome, weights: [wa, wb], split: pairFullSplit(wa, wb), share: 1, stage, ...(grid ? { grid } : { apart }), ...(extras.length ? { extras } : {}) };
      if (third && pick.third) {
        // Spec 1.18: the cell's painted-in picture of the third colour on the heavier pair colour's half (board order, a
        // tie the earlier arrival: 1.16.1's rule, turned into the cell's order), drawn instead of the plain cell.
        const board = pairFullHeavierSide(item, (b) => (b === x.l.slot.biome ? x.l.slot.index : y.l.slot.index));
        const side: PairSide = grid?.mirror ? (board === 'left' ? 'right' : 'left') : board;
        const picture = grid ? pairGridPaintedAt(grid.picture, pick.third, side, narrowScreen) : null;
        if (grid && picture) item.grid = { ...grid, painted: { colour: pick.third, side, picture } };
        // Spec 1.19 a (1.18.1 on a phone): no painted picture at this shape (a phone and a desktop-only painting, a cell
        // painted without it, or the two halves apart): the third colour's 1.14 cut-out, on the heavier colour's ground.
        else if (cuttable(third.l.slot.biome)) item.element = third.l.slot.biome;
        // No cut-out either (a pack without the colour's element): 1.15's third panel beside the pair, never nothing.
        else return withPanel(found, x, y, third, shareSum, thresholds, opts.stageOverride ?? null, narrowScreen, extras, item);
      }
      return [item];
    }
    if (third) {
      // Spec 1.14 / 1.16: the third colour inside the pair picture, which takes the whole half and grows with every coloured land.
      const stage = pairFullStage(found.pair, pick.total, thresholds, opts.stageOverride ?? null);
      const colour = pick.third!;
      const item: PairFullPair = { kind: 'pair', key: found.pair.key, pair: found.pair, mirror: found.mirror, left: x.l.slot.biome, right: y.l.slot.biome, weights: [wa, wb], split: pairFullSplit(wa, wb), share: 1, stage, element: third.l.slot.biome, ...(extras.length ? { extras } : {}) };
      // Spec 1.16.1: the painted picture is the heavier pair colour's side (the arrival order breaks a tie, as the cut-out's).
      const side = pairFullElementSide(item, (b) => (b === x.l.slot.biome ? x.l.slot.index : y.l.slot.index));
      if (opts.elements?.has(third.l.slot.biome) || pairElementAt(found.pair, stage, colour, side)) return [{ ...item, elementSide: side }];
    }
    return withPanel(found, x, y, third, shareSum, thresholds, opts.stageOverride ?? null, narrowScreen, extras);
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
  const extras = (pick?.extras ?? []).map((c) => COLOUR_BIOME[c]).filter(cuttable);
  return withPanel(pairFor(pairs, a.l.slot.biome, b.l.slot.biome)!, a, b, third, shareSum, thresholds, opts.stageOverride ?? null, narrowScreen, extras);
}

/**
 * The pair picture beside the third biome's panel (its own `halfLayout` share and stage, at its end of the row), or
 * alone. `base` (spec 1.19 a): a cell or an apart pair already planned for the whole half, whose third colour has
 * neither a painted picture nor a cut-out, narrowed to make room for the panel.
 */
function withPanel(
  found: { pair: PackPair; mirror: boolean },
  a: { l: HalfSlotLayout; i: number },
  b: { l: HalfSlotLayout; i: number },
  third: { l: HalfSlotLayout; i: number } | null,
  shareSum: number,
  thresholds: readonly number[],
  stageOverride: number | null,
  narrow: boolean,
  extras: Biome[] = [],
  base?: PairFullPair,
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
    ...(extras.length ? { extras } : {}),
  };
  const grid = base ? base.grid : pairFullGrid(found.pair, a.l.slot.biome, a.l.stage, b.l.stage, narrow);
  const apart = base ? base.apart : grid ? undefined : pairFullApart(found.pair, a.l.slot.biome, b.l.slot.biome, a.l.stage, b.l.stage);
  if (grid) item.grid = grid;
  else if (apart) item.apart = apart;
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
  /** Spec 1.20: the scene this picture is (its key), when it is one. */
  scene?: string;
}

/**
 * Spec 1.20: the picture a scene draws -- its one painting, the `phone` picture on a phone-width screen or a
 * phone-shaped panel (layout.ts `pickHalfPicture`, the rule a grid cell's picture follows through {@link pairFullArt}),
 * the horizon pinned as every panel's when `horizon` (spec 1.13). Never mirrored: a scene is drawn as painted.
 */
export function sceneCandidates(s: PairFullScene, panelAspect: number | null, narrow: boolean, horizon = false): PairFullCandidate[] {
  const art = halfArtOf(s.scene.half, panelAspect, { narrow, horizon });
  return art.picture ? [{ art, painted: null, mirror: false, scene: s.key }] : [];
}

/**
 * The candidates for whatever a plan draws across the half: a scene's ({@link sceneCandidates}) or the pair's
 * ({@link pairFullCandidates}, at the pair panel's own shape); null for a plan with neither (or none). `halfAspect`
 * is the whole half's shape.
 */
export function planCandidates(plan: readonly PairFullItem[] | null | undefined, halfAspect: number | null, narrow: boolean, horizon = false): PairFullCandidate[] | null {
  const s = plan?.find((x): x is PairFullScene => x.kind === 'scene');
  if (s) return sceneCandidates(s, pairFullPanelAspect(halfAspect, 1), narrow, horizon);
  const p = plan?.find((x): x is PairFullPair => x.kind === 'pair');
  return p ? pairFullCandidates(p, pairFullPanelAspect(halfAspect, p.share), narrow, horizon) : null;
}

/** Spec 1.20: the plan's scene, or null. */
export function planScene(plan: readonly PairFullItem[] | null | undefined): PairFullScene | null {
  return plan?.find((x): x is PairFullScene => x.kind === 'scene') ?? null;
}

/**
 * Spec 1.20: does the half draw a scene, or hold what it drew while its picture loads (pairFullHold)? Either way no
 * piece is drawn over it. False for a plan with no scene -- which is what a scene whose painting failed becomes
 * (`pairFullPlan`'s `sceneFailed`: today's plan) -- and, for a caller that planned without `sceneFailed`, when the
 * choice says the painting failed.
 */
export function pairFullSceneDrawn(plan: readonly PairFullItem[] | null | undefined, choice: { show: PairFullCandidate | null; want: PairFullCandidate | null } | null): boolean {
  if (!planScene(plan)) return false;
  return !choice || !!choice.show || !!choice.want;
}

/**
 * The pictures a whole-half pair panel can draw, best first, each once: the
 * seam grid cell's painted-in picture for the third colour (spec 1.18), the
 * seam grid's cell (spec 1.17, in its own orientation), the stage's painted-in
 * element panorama for the pair's element colour (spec 1.16), the stage's
 * panorama (1.15), the stage's 1.9 `half`. Each goes
 * through {@link pairFullArt}, so a desktop-only panorama never reaches a
 * phone-shaped panel. `panelAspect` is the pair panel's own shape.
 */
export function pairFullCandidates(p: PairFullPair, panelAspect: number | null, narrow: boolean, horizon = false): PairFullCandidate[] {
  // Spec 1.19 c: an apart pair is the two mono panels (SceneryStrip's own Slots, warmed as every slot is): no picture.
  if (p.apart) return [];
  const half = pairHalfAt(p.pair, p.stage);
  const pano = pairPanoramaAt(p.pair, p.stage);
  // Spec 1.18 rule 3: a cell never falls back to the stage's 1.16.1 painted picture (1.18.1's element on a cell is a cut-out).
  const colour = p.element && !p.grid ? (BIOME_COLOUR[p.element] ?? null) : null;
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
  // Spec 1.18: the cell's painted-in picture first (no phone picture: a phone-shaped panel skips it for the plain cell).
  if (p.grid?.painted) add(pairFullArt(half, p.grid.painted.picture, panelAspect, narrow, horizon), p.grid.painted.picture, p.grid.painted.colour, p.grid);
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
 * stands in for it. Spec 1.18.1: and while a grid cell is wanted, only over
 * that cell (the strip holds what it drew while the cell loads, 1.17's hold,
 * so the cut-out never stands on a picture the half is not showing).
 */
export function pairFullCutOutAllowed(choice: { show: PairFullCandidate | null; want: PairFullCandidate | null } | null): boolean {
  // Spec 1.20: never over a scene (shown, or loading while the strip holds what it drew).
  if (choice?.show?.scene || choice?.want?.scene) return false;
  if (choice?.want?.cell && choice.show !== choice.want) return false;
  return !!choice?.show && !choice.show.painted && !choice.want?.painted;
}

/**
 * Spec 1.19 a: may a colour past the third (a cut-out whatever the picture) be drawn? Over an apart pair always (its
 * panels are the strip's own); over a picture once one is shown and, while a cell is wanted, only over that cell
 * (the strip holds what it drew while the cell loads, so a cut-out never stands on a picture the half is not showing).
 */
export function pairFullExtrasAllowed(p: (Pick<PairFullPair, 'apart'> & { kind?: PairFullItem['kind'] }) | null, choice: { show: PairFullCandidate | null; want: PairFullCandidate | null } | null): boolean {
  // Spec 1.20: a scene is the whole half, every colour painted in: no cut-out at all.
  if (p?.kind === 'scene' || choice?.show?.scene || choice?.want?.scene) return false;
  if (p?.apart) return true;
  if (choice?.want?.cell && choice.show !== choice.want) return false;
  return !!choice?.show;
}

/** {@link pairFullCutOutAllowed} for the plan's third colour, an apart pair included (no picture to wait for). */
export function pairFullThirdCutAllowed(p: (Pick<PairFullPair, 'apart'> & { kind?: PairFullItem['kind'] }) | null, choice: { show: PairFullCandidate | null; want: PairFullCandidate | null } | null): boolean {
  if (p?.kind === 'scene' || choice?.show?.scene || choice?.want?.scene) return false;
  return p?.apart ? true : pairFullCutOutAllowed(choice);
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
 * And when a pair FORMS (one colour, then a second: the half drew its
 * panels, no pair picture) and its first cell is wanted and still loading:
 * the panels are held, never the warm whole-place panorama for a moment
 * before the cell (the #201 follow-up; `pairPictures` warms the first cells
 * ahead, so this is the slow-network case).
 * Spec 1.20: a scene is one picture, so a scene wanted and not loaded is the
 * `cold` case: the half holds what it drew (a cell, a pair, the panels, the
 * previous scene). And when a scene is on screen and the plan moves on (a
 * land with no scene for its state) to a picture not loaded yet, the scene is
 * held, never a warm panorama in between.
 * Pure: `hold` in, the new memory out (SceneryStrip keeps it in a ref).
 */
export function pairFullHold<L>(
  cur: { layout: L; plan: PairFullItem[] | null; choice: { show: PairFullCandidate | null; want: PairFullCandidate | null } | null },
  hold: PairFullHold<L>,
  now: number,
  holdMs = PAIR_FULL_HOLD_MS,
): { draw: PairFullDraw<L>; hold: PairFullHold<L>; holding: boolean } {
  // Spec 1.19 c: an apart pair is its two mono panels, nothing to load: drawn at once.
  if (planApart(cur.plan)) {
    const draw: PairFullDraw<L> = { layout: cur.layout, plan: cur.plan, shown: null };
    const same = hold.last && hold.last.layout === draw.layout && hold.last.plan === draw.plan && !hold.last.shown;
    return { draw: same ? hold.last! : draw, hold: { last: same ? hold.last : draw, since: null }, holding: false };
  }
  const cold = !!cur.plan && !!cur.choice && !cur.choice.show && !!cur.choice.want;
  // Spec 1.16.1 (the review of #199): a painted picture on screen and another painted one wanted but not loaded (the
  // side flipped, or the stage changed): hold the painted one rather than drop to the base panorama for a fetch.
  const paintedNext = !!cur.plan && !!cur.choice?.want?.painted && cur.choice.show !== cur.choice.want && !!hold.last?.shown?.painted;
  // Spec 1.17 (the review of #201): a grid cell on screen and another cell wanted but not loaded: hold the cell.
  const gridNext = !!cur.plan && !!cur.choice?.want?.cell && cur.choice.show !== cur.choice.want && !!hold.last?.shown?.cell;
  // The pair forming (the #201 follow-up): the half drew no pair picture before and wants its first cell, not loaded yet.
  // Spec 1.19 c: likewise from an apart pair (its panels) to a cell: the panels are held, never the panorama between.
  const gridFirst = !!cur.plan && !!cur.choice?.want?.cell && cur.choice.show !== cur.choice.want && !!hold.last && (!hold.last.plan || planApart(hold.last.plan));
  // Spec 1.20: a scene on screen and the next plan's best picture not loaded yet: hold the scene.
  const sceneNext = !!cur.plan && !!cur.choice?.want && cur.choice.show !== cur.choice.want && !!hold.last?.shown?.scene;
  if (cold || paintedNext || gridNext || gridFirst || sceneNext) {
    const since = hold.since ?? now;
    if (hold.last && now - since < holdMs) return { draw: hold.last, hold: { last: hold.last, since }, holding: true };
    if (cold) return { draw: { layout: cur.layout, plan: null, shown: null }, hold: { last: hold.last, since }, holding: false };
    // The painted (or grid) hold ran out: what has loaded (the base panorama), drawn below.
  }
  const draw: PairFullDraw<L> = { layout: cur.layout, plan: cur.choice?.show ? cur.plan : null, shown: cur.choice?.show ?? null };
  const same = hold.last && hold.last.layout === draw.layout && hold.last.plan === draw.plan && hold.last.shown === draw.shown;
  return { draw: same ? hold.last! : draw, hold: { last: same ? hold.last : draw, since: null }, holding: false };
}

/** Spec 1.19 c: is the plan's pair drawn apart (its two mono panels)? */
export function planApart(plan: readonly PairFullItem[] | null | undefined): boolean {
  return !!plan?.some((x) => x.kind === 'pair' && !!x.apart);
}

/** Spec 1.20 / 1.21: the plan's scene item for a scene drawn, exact or nearest (with what it stands in for). */
function sceneItem(n: NearestScene): PairFullScene {
  const exact = n.key === n.for;
  return { kind: 'scene', key: n.key, scene: n.scene, share: 1, ...(exact ? {} : { nearest: { for: n.for, dropped: n.dropped, clamped: n.clamped, mono: n.mono } }) };
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

/** How far short of the transition an element's region stops at least (spec 1.14's elements on a whole-half picture). */
export const PAIR_FULL_ELEMENT_MARGIN = 0.05;
/**
 * Spec 1.19 a: the seam core, as a fraction of the pair picture's own width either side of its transition: the
 * painter's core is the middle 0.43–0.57 of a cell (spec 1.17), and every pair picture is painted A | heart | B about
 * its focal x. No element stands in it.
 */
export const PAIR_FULL_SEAM_CORE = 0.07;

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
  /**
   * Spec 1.19 a: the seam core across the half (board order): {@link PAIR_FULL_SEAM_CORE} of the picture's drawn
   * width either side of the transition; for an apart pair, the plain seam's width. No element overlaps it.
   */
  core: { left: number; right: number };
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
  const core = PAIR_FULL_SEAM_CORE * frame.width * panel.width;
  return {
    panel,
    seamAt,
    ground: { left: { left: panel.left, width: r4(seamAt - panel.left) }, right: { left: seamAt, width: r4(panel.left + panel.width - seamAt) } },
    horizonY: r4(frame.top + hz * frame.height),
    frame: { left: frame.left, top: frame.top, width: frame.width, height: frame.height },
    core: { left: r4(seamAt - core), right: r4(seamAt + core) },
  };
}

/**
 * Spec 1.19 c: {@link PairFullView} for an apart pair -- its two mono panels side by side at the split (board order),
 * the pair panel the half (or all of it but a third panel), the core the plain seam between them (`seamRatio` of the
 * half, the pack's `half.seamRatio`), `horizonY` the one given (the caller's: pieces.ts `horizonAt` over the panels).
 * Null without an apart pair.
 */
export function pairFullApartView(items: readonly PairFullItem[] | null, seamRatio: number, horizonY: number): PairFullView | null {
  const p = items?.find((x): x is PairFullPair => x.kind === 'pair');
  if (!p?.apart) return null;
  const pairFirst = items![0] === p;
  const panel = { left: r4(pairFirst ? 0 : 1 - p.share), width: r4(p.share) };
  const seamAt = r4(panel.left + p.split * panel.width);
  const half = seamRatio / 2;
  return {
    panel,
    seamAt,
    ground: { left: { left: panel.left, width: r4(seamAt - panel.left) }, right: { left: seamAt, width: r4(panel.left + panel.width - seamAt) } },
    horizonY,
    frame: { left: 0, top: 0, width: 1, height: 1 },
    core: { left: r4(seamAt - half), right: r4(seamAt + half) },
  };
}

/**
 * The region spec 1.14's element stands in on a whole-half pair picture: a
 * pair colour's ground (`side`; the third colour's is the heavier's, pieces.ts
 * `HalfPlan.element.side`), stopping short of the transition by the seam core
 * (spec 1.19 a, {@link PairFullView.core}) and at least `margin` of the half,
 * so the element stays on its own ground. Never narrower than 0. Spec 1.19 a's
 * stack splits it between the elements on that ground (pieces.ts `stackRegion`).
 */
export function pairFullElementRegion(view: PairFullView, side: 'left' | 'right', margin = PAIR_FULL_ELEMENT_MARGIN): PairFullSpan {
  const g = view.ground[side];
  const core = side === 'left' ? view.seamAt - view.core.left : view.core.right - view.seamAt;
  const width = r4(Math.max(0, g.width - Math.max(margin, core)));
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

/**
 * A caption for the preview page: "island + plains, whole half: island 80% |
 * plains 20%, pair stage 2" -- the pair by its colours, with its dual or shock
 * land's name only when a land of that name is on the half (`lands`,
 * pairs.ts `pairWords`).
 */
export function pairFullCaption(items: readonly PairFullItem[] | null, lands: ReadonlySet<string> | null = null): string | null {
  // Spec 1.20: "Scene · island 2, forest 3, mountain 2 — one painting".
  const scene = planScene(items);
  if (scene) return sceneCaption(scene);
  const p = items?.find((x): x is PairFullPair => x.kind === 'pair');
  if (!p) return null;
  const third = items!.find((x): x is PairFullSlot => x.kind === 'slot');
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const where = p.grid ? gridCaption(p.grid) : p.apart ? apartCaption(p.apart) : `pair stage ${p.stage}`;
  return `${pairWords(p.left, p.right, p.pair, lands)}, ${third ? `${pct(p.share)} of the half` : 'whole half'}: ${p.left} ${pct(p.split)} | ${p.right} ${pct(1 - p.split)}, ${where}${third ? `; ${third.biome} ${pct(third.share)} panel (placeholder)` : ''}${elementCaption(p)}`;
}

/**
 * Spec 1.20: a scene's caption, its lands in the geography's order. Spec 1.21: a scene standing in for a state with
 * none names the state, the scene drawn and what is missing -- "Scene · island 1, swamp 1, mountain 1 — nearest
 * painting: island 1, swamp 1, mountain 2 (mountain not yet painted at this stage)".
 */
export function sceneCaption(s: Pick<PairFullScene, 'scene' | 'nearest'>): string {
  if (s.nearest) return nearestWords({ scene: s.scene, ...s.nearest });
  return `Scene · ${sceneWords(s.scene)} — one painting`;
}

/** Spec 1.19 c: "island s1 | forest s5, no seam cell", in the geography's order, each colour at its own stage. */
export function apartCaption(a: PairFullApart): string {
  return `${a.left} s${a.stages[0]} | ${a.right} s${a.stages[1]}, no seam cell`;
}

/** Spec 1.19 a: "; swamp as an element", "; swamp and mountain as elements", "; swamp, mountain and plains as elements" (none: ""). */
export function cutOutWords(biomes: readonly Biome[]): string {
  if (!biomes.length) return '';
  const list = biomes.length === 1 ? biomes[0]! : `${biomes.slice(0, -1).join(', ')} and ${biomes[biomes.length - 1]}`;
  return `; ${list} as ${biomes.length === 1 ? 'an element' : 'elements'}`;
}

/**
 * Spec 1.17: "island s4 | swamp s3, seam 4x3", in the picture's (the
 * geography's) order (spec 1.19 c: a cell is always exact, never clamped;
 * no cell is {@link apartCaption}'s "no seam cell"). Spec 1.18: a cell with its
 * third colour painted in adds "; R painted in, on island's ground" (the
 * plan names it only where it is drawn: never on a phone without its phone
 * picture).
 */
export function gridCaption(g: PairFullGrid): string {
  const painted = g.painted ? `; ${g.painted.colour} painted in, on ${g.painted.side === 'left' ? g.left : g.right}'s ground` : '';
  return `${g.left} s${g.stages[0]} | ${g.right} s${g.stages[1]}, seam ${g.cell}${painted}`;
}

/**
 * The caption's elements: "; R painted in, on plains's ground" (spec 1.16.1) or "; mountain as an element" (the 1.14
 * cut-out; on a grid cell only the cut-out, spec 1.18.1: "island s2 | forest s3, seam 2x3; swamp as an element"), and
 * spec 1.19 a's colours past the third, cut-outs too: "; swamp and mountain as elements". Nothing for none.
 */
function elementCaption(p: PairFullPair): string {
  const cut: Biome[] = [];
  let painted = '';
  if (p.element) {
    const colour = BIOME_COLOUR[p.element];
    const side = p.elementSide;
    if (colour && !p.grid && !p.apart && pairElementAt(p.pair, p.stage, colour, side)) painted = side ? `; ${colour} painted in, on ${side === 'left' ? p.pair.left : p.pair.right}'s ground` : `; ${colour} painted in`;
    else cut.push(p.element);
  }
  return `${painted}${cutOutWords([...cut, ...(p.extras ?? [])])}`;
}
