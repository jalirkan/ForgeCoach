/*
 * ForgeCoach — ambience/pairs.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Pair bands (spec 1.9): when one side of the half board has two colours, the
 * seam between their two pictures becomes a third painted place, the colour
 * pair's own (named for its dual land), which widens with every land that is
 * both colours. The pictures come from a second, optional manifest,
 * `pairs.json`, fetched beside the pack's `scenery.json` (prefs.ts
 * `FORGECOACH_PAIRS_URL`), so the pair art can live in a CDN ref of its own.
 * Pure and DOM-free; the drawing is ui/ambience/SceneryStrip.tsx.
 *
 * - The pair's entry is found by {@link pairKey}, so both orders resolve to
 *   one; the art is mirrored when the board has the pair the other way round
 *   from the manifest key (the key's first biome is the art's left), as a
 *   bridge is (bridges.ts).
 * - The width: `band.min` of the half as soon as the side has both colours,
 *   `band.perDual` more per land that is both colours (model.ts `dualPairs`,
 *   the count the bridges widen by), at most `band.max` — the same rule as a
 *   bridge's seam ({@link widenedRatio}), with the band's own numbers.
 * - The two neighbouring panels each give up half the band's width (never
 *   more than half their own share: past that the band is narrower), and the
 *   band meets each of them in half the seam they met in, so a band of width
 *   0 is exactly the seam it replaces ({@link halfRow}).
 * - The stage: `stageMap` on the LOWER of the two neighbours' stages.
 *
 * Motifs (spec 1.12): a pair stage may carry a `motif`, a transparent picture
 * painted for the band's own narrow, full-height shape (pairs-v3: the road or
 * river both lands share, running from the foreground up the seam to the
 * horizon). A pair whose stages carry a motif and no `half` is a MOTIF pair:
 * its seam stays the plain 1.10 seam (the panels give up no width) and the
 * motif is drawn over it, centred on the seam, {@link motifWidth} of the half
 * wide and the half's full height, so its own soft banks are the band's edges.
 * A pair with `half` pictures is a BAND pair as in 1.9, and a motif on one of
 * its stages is drawn over the band's picture, in the band's box.
 *
 * The seam grid (spec 1.17, a draft behind `?pairfull=1`): a pair may carry a
 * `grid` of seam pictures keyed `"<i>x<j>"` by the stage of each half -- the
 * geography's LEFT colour's own mono stage `i` and the RIGHT colour's `j`
 * ({@link GEOGRAPHY}, SYSTEM.md C4: Island → Swamp → Plains → Forest →
 * Mountain, whatever the manifest key's order) -- so adding one land changes
 * one half, never the other ({@link pairGridPick}: the exact cell, else the
 * lighter half clamped to one stage of the heavier, else none and the pair's
 * `stages` as in 1.15).
 */
import { BIOMES, DEFAULT_STAGE_THRESHOLDS, MAX_STAGES, pairKey, stageFor, type Biome, type SlotState } from './model.ts';
import { cleanText, int } from '../lab/status.ts';
import { isObj, packBase, parseBytes, parseHalf, parseTransitions, PIECE_COLOURS, ranged, type PackHalf, type PackStage, type PackTransitions, type PieceColour, type ScenePack } from './manifest.ts';
import { halfLayout, type HalfSlotLayout } from './layout.ts';
import { BIOME_COLOUR, type MakeupShowing } from './makeup.ts';
import { halfSeams, SEAM_CAP_VW, widenedRatio } from './bridges.ts';

/** The pair pack's manifest, at the root of the pairs URL. */
export const PAIRS_MANIFEST_FILE = 'pairs.json';
/** The newest spec version this reader knows (1.9 added pair bands, 1.12 motifs, 1.15 whole-half panoramas, 1.16 painted-in elements, 1.16.1 sided ones, 1.17 the seam grid). */
export const PAIRS_SPEC = '1.17';

/** Is version `a` (1.x or 1.x.y) newer than `b`? */
function specNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 1; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}
const MAX_PAIRS_MANIFEST_BYTES = 256 * 1024;

/** How wide a pair's band is, as fractions of the half's width. */
export interface PairBand {
  /** As soon as the side has both colours. */
  min: number;
  /** More for each land that is both colours. */
  perDual: number;
  /** The widest it gets. */
  max: number;
}

/** Spec 1.9 defaults: the seam's width (0.10) at first, +0.04 per dual, a full middle third (0.34) at six duals. */
export const DEFAULT_PAIR_BAND: PairBand = { min: 0.1, perDual: 0.04, max: 0.34 };
/** Spec 1.9 default: neighbour stages 1–2 show pair stage 1, 3–4 stage 2, 5–6 stage 3. */
export const DEFAULT_STAGE_MAP: readonly (readonly [number, number])[] = [
  [1, 2],
  [3, 4],
  [5, 6],
];
/** Declared stage pictures per pair (desktop and phone, 1x and 2x) past this get a warning. */
export const MAX_PAIR_HALF_BYTES = 4 * 1024 * 1024;
/** Declared files of the whole pairs pack past this get a warning: jsDelivr serves a ref of at most 50 MB. */
export const MAX_PAIRS_PACK_BYTES = 45 * 1024 * 1024;

/**
 * Spec 1.12: a stage's motif, in the shape of a 1.5 `half` (`src`, `src2x`,
 * `phone`, `width` / `height` of the 1x file, `bytes`); its picture is
 * transparent and drawn stretched to its box (`fill`), never cropped.
 */
export type PairMotif = PackHalf;

/** A pair's stage: a 1.5 `half` (a band pair), a 1.12 `motif`, or both. */
export interface PairStage extends PackStage {
  motif?: PairMotif;
  /**
   * Spec 1.15: the stage's whole-half panorama, in the shape of a 1.5
   * `half` (`src`, `src2x`, `width` / `height` of the 1x file, `focal`,
   * `safe`, optional `phone`, `bytes`): one place about 1.6 × the half's
   * width, the first biome the ground at its left end and the second at its
   * right, the transition at `focal.x`. Read only under `?pairfull=1`
   * (pairfull.ts), where it is drawn instead of the stage's `half`.
   */
  panorama?: PackHalf;
  /**
   * Spec 1.16: painted-in elements. By colour (W U B R G), this stage's
   * panorama with that third colour's feature painted INTO the place (a
   * river through it, fire in it), in the panorama's own shape: an entry's
   * missing `width`, `height`, `subjectBand`, `focal`, `safe`, `horizon`,
   * `hour` and `key` (and its phone picture's) are the panorama's. Drawn
   * under `?pairfull=1` instead of the panorama when the half's third colour
   * has one at the stage shown ({@link pairElementAt}); the 1.14 cut-out
   * element is then not drawn over it. Spec 1.16.1: an entry may be SIDED
   * ({@link PairElement}), one picture with the feature on each pair
   * colour's ground.
   */
  elements?: Partial<Record<PieceColour, PairElement>>;
}

/**
 * Spec 1.16.1: which pair colour's ground, in the manifest KEY's order:
 * `left` the key's first biome (the ground at the panorama's left end),
 * `right` its second. The painter's `s<k>+<C>L` / `s<k>+<C>R` files.
 */
export type PairSide = 'left' | 'right';

/**
 * Spec 1.16 / 1.16.1: one colour's painted-in element at a stage. 1.16's
 * unsided entry (`{ src, phone, bytes }`) is `any`; 1.16.1's sided entry
 * (`{ left: {...}, right: {...} }`) gives one picture per ground, the
 * feature grown on the key's left colour's ground or on its right's (SYSTEM.md
 * A5: the element sits on the HEAVIER pair colour's ground, so the reader
 * draws the heavier colour's side). A side the entry does not give falls back
 * to `any`; with neither, the colour is not painted in on that side.
 */
export interface PairElement {
  left: PackHalf | null;
  right: PackHalf | null;
  any: PackHalf | null;
}

/**
 * `band` (spec 1.9): the pair's pictures are an opaque panel between its two
 * biomes (a motif, where a stage has one, drawn over it). `motif` (1.12): no
 * stage has a `half`, the seam stays plain and the motif is drawn over it.
 */
export type PairKind = 'band' | 'motif';

/**
 * Spec 1.17 (draft): the one geography every seam picture is painted in
 * (SYSTEM.md C4): the land rises from the sea to the mountains, left to
 * right. In a pair the colour earlier here is the seam picture's LEFT half,
 * whatever the manifest key's (alphabetical) order.
 */
export const GEOGRAPHY: readonly Biome[] = ['island', 'swamp', 'plains', 'forest', 'mountain'];

/** Spec 1.17: two biomes in {@link GEOGRAPHY}'s order (left, right), or null when either is not on it (wastes). */
export function geographyOrder(a: Biome, b: Biome): [Biome, Biome] | null {
  const ia = GEOGRAPHY.indexOf(a);
  const ib = GEOGRAPHY.indexOf(b);
  if (ia < 0 || ib < 0 || ia === ib) return null;
  return ia < ib ? [a, b] : [b, a];
}

/**
 * Spec 1.17 (draft): a pair's seam grid. Each cell is one whole-half picture
 * in 1.15's panorama shape: the {@link left} colour's mono picture at stage
 * `i` as its left half, a painted seam, the {@link right} colour's mono
 * picture at stage `j` as its right half. Keyed `"<i>x<j>"`, 1..6 each.
 */
export interface PairGrid {
  /** The picture's left half: the pair's colour earlier in {@link GEOGRAPHY}. */
  left: Biome;
  right: Biome;
  cells: Partial<Record<string, PackHalf>>;
}

/** Spec 1.17: a grid cell's key, `"4x3"`. */
export function gridCellKey(i: number, j: number): string {
  return `${i}x${j}`;
}

/** Spec 1.17: what {@link pairGridPick} chose for a pair at its two halves' stages. */
export interface PairGridPick {
  /** The cell shown, `"4x3"`, in the grid's (geography) order. */
  cell: string;
  /** The stages each half shows, left then right (geography order). */
  shown: [number, number];
  /** The two colours' own stages, left then right: what the board's lands say. */
  stages: [number, number];
  /** The lighter half was raised to one stage below the heavier (no cell for the true pair). */
  clamped: boolean;
  picture: PackHalf;
}

/**
 * Spec 1.17 (draft): the seam picture for a pair whose geography-left colour
 * is at mono stage `left` and right colour at `right` (each colour's OWN land
 * count on the pack's mono thresholds; 0 = not on the half). The exact cell
 * when the grid has it; else, the two more than one stage apart, the LIGHTER
 * half (the lower stage) is raised to one stage below the heavier, which is
 * always shown exactly -- the heavier colour fills most of the half (the pan,
 * 1.15) and is what a land of it must visibly grow; else null (no grid, a
 * missing cell, a colour not on the half): the pair's `stages`, as in 1.15.
 */
export function pairGridPick(pair: PackPair | null | undefined, left: number, right: number): PairGridPick | null {
  const g = pair?.grid;
  if (!g || !(left > 0) || !(right > 0)) return null;
  const i0 = Math.min(Math.round(left), MAX_STAGES);
  const j0 = Math.min(Math.round(right), MAX_STAGES);
  const exact = g.cells[gridCellKey(i0, j0)];
  if (exact) return { cell: gridCellKey(i0, j0), shown: [i0, j0], stages: [i0, j0], clamped: false, picture: exact };
  if (Math.abs(i0 - j0) <= 1) return null;
  const [i, j] = i0 > j0 ? [i0, i0 - 1] : [j0 - 1, j0];
  const cell = g.cells[gridCellKey(i, j)];
  return cell ? { cell: gridCellKey(i, j), shown: [i, j], stages: [i0, j0], clamped: true, picture: cell } : null;
}

/**
 * Spec 1.17 on a phone-width screen (layout.ts `PHONE_VIEWPORT_MAX`): does a
 * grid cell give way to the pair's `stages`? When it has no phone picture and
 * the stage pictures have one -- pairfull.ts `pairFullArt`'s rule for a desktop-only
 * panorama: the cells are 5:1 desktop panoramas, and a cover crop of one in a
 * phone's half would show little but the seam. The half then is the stage
 * panorama, as before the grid (1.15 / 1.16.1, a third colour's element
 * included), and the plan carries no `grid`, so nothing names a seam the
 * phone is not shown (the review of #201, finding 3).
 */
export function pairGridGivesWay(pair: PackPair, cell: PackHalf): boolean {
  return !cell.phone && pair.stages.some((st) => !!st.half?.phone);
}

export interface PackPair {
  /** {@link pairKey}: the two biomes in alphabetical order, `forest+island`. */
  key: string;
  /** The biome the art has on its left, and on its right (the manifest key's order). */
  left: Biome;
  right: Biome;
  /** The dual land and the shock land the place is named for: for a caption only, never read by the rules. */
  dual: string | null;
  shock: string | null;
  /** Spec 1.12: how the pair is drawn ({@link PairKind}). */
  kind: PairKind;
  /** stages[0] is the pair's stage 1; each has a `half` (a band pair) or a `motif` (a motif pair), and no strip layers. */
  stages: PairStage[];
  /** Spec 1.7's in-betweens per stage step, or null (a step cross-fades). A motif pair's are its motif's (`motifTransitions`). */
  transitions: PackTransitions | null;
  band: PairBand;
  /** Index k (0-based) holds the neighbour stages [from, to] that show pair stage k + 1. */
  stageMap: [number, number][];
  /**
   * Spec 1.17 (draft): the seam grid, or null. Read only under `?pairfull=1`
   * (pairfull.ts), where a cell is drawn instead of the stage's panorama.
   */
  grid?: PairGrid | null;
  /** Declared bytes of the pair's stage pictures, motifs, panoramas, painted-in elements and grid cells (each file once) and frames. */
  bytes: number;
  /**
   * The part of {@link bytes} in the pairs manifest's own folder (its CDN
   * ref): a file named by an absolute URL elsewhere (pairs-v4 names pairs-v2's
   * halves and frames at their own tag) costs this ref nothing, so only these
   * count toward {@link MAX_PAIRS_PACK_BYTES}.
   */
  refBytes: number;
}

/** Spec 1.12: the motif a pair shows at a pair stage (the last stage it has past its end), or null. */
export function pairMotifAt(pair: PackPair | null | undefined, stage: number): PairMotif | null {
  if (!pair || stage <= 0 || !pair.stages.length) return null;
  return pair.stages[Math.min(stage, pair.stages.length) - 1]?.motif ?? null;
}

/**
 * Spec 1.12: a motif pair's drawn width, as a fraction of the half: the band's
 * width for the side's duals ({@link bandWidth}), but never wider than either
 * neighbour's share, so it covers at most half of each panel beside it (the
 * floor a band keeps, {@link halfRow}).
 */
export function motifWidth(width: number, leftShare: number, rightShare: number): number {
  return r4(Math.max(0, Math.min(width, leftShare, rightShare)));
}

export interface PairsPack {
  schema: 1;
  spec: string | null;
  name: string;
  author: string | null;
  license: string | null;
  /** The pack's own note (a draft says so). */
  note: string | null;
  /** The base every relative file was resolved against. */
  base: string;
  /** Keyed by {@link pairKey}. */
  pairs: Partial<Record<string, PackPair>>;
}

export interface PairsResult {
  pairs: PairsPack | null;
  errors: string[];
  warnings: string[];
}

/** A manifest key (`island+forest` or `forest+island`) as its {@link pairKey}, or null when it is not two different biomes. */
export function normalisePairKey(raw: string): string | null {
  const parts = raw.split('+');
  if (parts.length !== 2) return null;
  const [a, b] = parts as [string, string];
  if (!(BIOMES as readonly string[]).includes(a) || !(BIOMES as readonly string[]).includes(b) || a === b) return null;
  return pairKey(a as Biome, b as Biome);
}

/** A band's width for `duals` lands that are both colours: min + perDual × duals, at most max ({@link widenedRatio}). */
export function bandWidth(band: PairBand, duals: number): number {
  return widenedRatio(band.min, band.perDual, band.max, duals);
}

/** The pair stage for the lower neighbour's stage: the map's entry holding it (past the last, the last; under the first, the first); 0 with no stage. */
export function pairStageFor(map: readonly (readonly [number, number])[], lower: number): number {
  if (!(lower > 0) || !map.length) return 0;
  for (let k = 0; k < map.length; k++) if (lower >= map[k]![0] && lower <= map[k]![1]) return k + 1;
  return lower > map[map.length - 1]![1] ? map.length : 1;
}

/** Spec 1.15: the panorama a pair's stage carries (the last stage past its end), or null: never borrowed from another stage. */
export function pairPanoramaAt(pair: PackPair | null | undefined, stage: number): PackHalf | null {
  if (!pair || stage <= 0 || !pair.stages.length) return null;
  return pair.stages[Math.min(stage, pair.stages.length) - 1]?.panorama ?? null;
}

/**
 * Spec 1.16: the painted-in element panorama for `colour` at a pair stage
 * (the last stage past its end, as {@link pairPanoramaAt}), or null: never
 * borrowed from another stage. Spec 1.16.1: `side` (the KEY's order,
 * {@link PairSide}) is explicit: a side picks a sided entry's picture, else
 * its unsided one; `undefined` (no side decided) gives the unsided picture
 * only, never a side's -- a caller that wants a side says which.
 */
export function pairElementAt(pair: PackPair | null | undefined, stage: number, colour: PieceColour | null | undefined, side: PairSide | undefined): PackHalf | null {
  const e = pairElementEntryAt(pair, stage, colour);
  if (!e) return null;
  return side ? (e[side] ?? e.any) : e.any;
}

/** Spec 1.16.1: a colour's whole painted-in entry at a pair stage (both sides), or null. */
export function pairElementEntryAt(pair: PackPair | null | undefined, stage: number, colour: PieceColour | null | undefined): PairElement | null {
  if (!pair || !colour || stage <= 0 || !pair.stages.length) return null;
  return pair.stages[Math.min(stage, pair.stages.length) - 1]?.elements?.[colour] ?? null;
}

/** Spec 1.16.1: every picture of a painted-in entry, each once (for the budget and warming). */
export function pairElementPictures(e: PairElement | null | undefined): PackHalf[] {
  const out: PackHalf[] = [];
  for (const h of [e?.any, e?.left, e?.right]) if (h && !out.some((x) => x.src === h.src)) out.push(h);
  return out;
}

/** The half picture a pair shows at a pair stage (the last stage it has past its end), or null. */
export function pairHalfAt(pair: PackPair | null | undefined, stage: number): PackHalf | null {
  if (!pair || stage <= 0 || !pair.stages.length) return null;
  return pair.stages[Math.min(stage, pair.stages.length) - 1]?.half ?? null;
}

/** The pair pack's entry for two biomes in either order, and whether to mirror it (the board has them the other way round). */
export function pairFor(pairs: PairsPack | null | undefined, left: Biome, right: Biome): { pair: PackPair; mirror: boolean } | null {
  if (left === right) return null;
  const pair = pairs?.pairs[pairKey(left, right)];
  return pair ? { pair, mirror: pair.left !== left } : null;
}

// ---------------------------------------------------------------------------
// The manifest

function parseStageMap(v: unknown, path: string, warn: string[]): [number, number][] {
  const dflt = DEFAULT_STAGE_MAP.map(([a, b]) => [a, b] as [number, number]);
  if (v === undefined || v === null) return dflt;
  const rows: unknown[] = Array.isArray(v) ? v : [];
  const out: [number, number][] = [];
  let next = 1;
  for (const row of rows) {
    const lo = Array.isArray(row) && row.length === 2 ? int(row[0], 1, MAX_STAGES) : null;
    const hi = Array.isArray(row) && row.length === 2 ? int(row[1], 1, MAX_STAGES) : null;
    if (lo === null || hi === null || lo !== next || hi < lo) {
      out.length = 0;
      break;
    }
    out.push([lo, hi]);
    next = hi + 1;
  }
  if (!out.length || out.length > MAX_STAGES) {
    warn.push(`${path}: a list of [from, to] neighbour stages, from 1 up with no gap ([[1, 2], [3, 4], [5, 6]]); using the default`);
    return dflt;
  }
  return out;
}

function parseBand(v: unknown, path: string, warn: string[]): PairBand {
  const d = DEFAULT_PAIR_BAND;
  if (v === undefined || v === null) return { ...d };
  if (!isObj(v)) {
    warn.push(`${path}: not an object { min, perDual, max }; using ${d.min}, ${d.perDual}, ${d.max}`);
    return { ...d };
  }
  const min = ranged(v.min, 0, 0.5, d.min, `${path}.min`, warn);
  const perDual = ranged(v.perDual, 0, 0.2, d.perDual, `${path}.perDual`, warn);
  let max = ranged(v.max, 0, 0.6, Math.max(d.max, min), `${path}.max`, warn);
  if (max < min) {
    warn.push(`${path}.max: ${max} is narrower than min ${min}; using ${min}`);
    max = min;
  }
  return { min, perDual, max };
}

function parsePair(rawKey: string, e: unknown, base: string, warn: string[]): PackPair | null {
  const path = `pairs.${cleanText(rawKey, 40)}`;
  const key = normalisePairKey(rawKey);
  if (!key) {
    warn.push(`${path}: not a pair of two different biomes joined by + ("forest+island"); ignored`);
    return null;
  }
  if (!isObj(e)) {
    warn.push(`${path}: not an object { dual, shock, stages, band, stageMap }; ignored`);
    return null;
  }
  const [left, right] = rawKey.split('+') as [Biome, Biome];
  const rawStages: unknown[] = Array.isArray(e.stages) ? e.stages : [];
  if (rawStages.length > MAX_STAGES) warn.push(`${path}.stages: more than ${MAX_STAGES}; the rest ignored`);
  // Spec 1.12: a pair none of whose stages names a `half` is a motif pair; any `half` makes it a band pair.
  const kind: PairKind = rawStages.some((st) => isObj(st) && st.half !== undefined && st.half !== null) ? 'band' : 'motif';
  const stages: PairStage[] = [];
  rawStages.slice(0, MAX_STAGES).forEach((st, i) => {
    const sp = `${path}.stages[${i}]`;
    if (!isObj(st)) return void warn.push(`${sp}: not an object { half, motif }; stage dropped`);
    const motif = parseHalf(st.motif, base, `${sp}.motif`, warn);
    if (kind === 'motif') {
      if (!motif) return void warn.push(`${sp}: no usable motif (and the pair has no half pictures); stage dropped`);
      return void stages.push({ layers: [], motif });
    }
    const half = parseHalf(st.half, base, `${sp}.half`, warn);
    if (!half) return void warn.push(`${sp}: no usable half picture; stage dropped`);
    const panorama = parseHalf(st.panorama, base, `${sp}.panorama`, warn);
    const elements = parseStageElements(st.elements, panorama ? st.panorama : null, base, `${sp}.elements`, warn);
    stages.push({ layers: [], half, ...(motif ? { motif } : {}), ...(panorama ? { panorama } : {}), ...(elements ? { elements } : {}) });
  });
  if (!stages.length) {
    warn.push(`${path}: no stage with a usable ${kind === 'motif' ? 'motif' : 'half picture'}; pair dropped`);
    return null;
  }
  const intact = stages.length === Math.min(rawStages.length, MAX_STAGES);
  if (kind === 'motif' && e.transitions !== undefined && e.transitions !== null) warn.push(`${path}.transitions: a motif pair has no half pictures to step between (its frames are \`motifTransitions\`); ignored`);
  if (kind === 'band' && e.motifTransitions !== undefined && e.motifTransitions !== null) warn.push(`${path}.motifTransitions: only a motif pair plays motif frames (a band pair's motif cross-fades with its stage); ignored`);
  const transitions = kind === 'motif' ? parseTransitions(e.motifTransitions, base, `${path}.motifTransitions`, warn, stages.length, intact) : parseTransitions(e.transitions, base, `${path}.transitions`, warn, stages.length, intact);
  const stageMap = parseStageMap(e.stageMap, `${path}.stageMap`, warn);
  const grid = parseGrid(e.grid, kind, rawStages, left, right, base, `${path}.grid`, warn);
  if (stageMap.length > stages.length) warn.push(`${path}.stageMap: ${stageMap.length} pair stages, ${stages.length} pictured; the later ones show the last stage`);
  const seen = new Set<string>();
  let halfBytes = 0;
  let refBytes = 0;
  let paintedBytes = 0;
  let gridBytes = 0;
  const inRef = (src: string) => src.startsWith(base);
  // Spec 1.16.1: a picture whose phone declares its own `bytes` has its `bytes` for the desktop files alone, and each part
  // counts in this ref by where its own file is (pairs-v5's phone pictures are at a tag of their own).
  const count = (h: PackHalf | null | undefined, painted: boolean, cell = false) => {
    if (!h || seen.has(h.src)) return;
    seen.add(h.src);
    const own = (h.bytes ?? 0) + (h.phoneBytes ?? 0);
    halfBytes += own;
    if (painted) paintedBytes += own;
    if (cell) gridBytes += own;
    if (inRef(h.src)) refBytes += h.bytes ?? 0;
    if (h.phoneBytes !== undefined && h.phone && inRef(h.phone.src)) refBytes += h.phoneBytes;
  };
  for (const s of stages) {
    for (const h of [s.half, s.motif, s.panorama]) count(h, false);
    for (const e of Object.values(s.elements ?? {})) for (const h of pairElementPictures(e)) count(h, true);
  }
  // Spec 1.17: a grid cell counts in the pair's stage pictures and, in this folder, in the ref's.
  for (const h of Object.values(grid?.cells ?? {})) count(h, false, true);
  if (halfBytes > MAX_PAIR_HALF_BYTES)
    warn.push(
      gridBytes > 0
        ? `${path}: ${(halfBytes / 1048576).toFixed(1)} MB of stage pictures declared, ${(gridBytes / 1048576).toFixed(1)} MB of them the seam grid (1.17)${paintedBytes > 0 ? ` and ${(paintedBytes / 1048576).toFixed(1)} MB painted-in elements` : ''}; the budget is ${MAX_PAIR_HALF_BYTES / 1048576} MB per pair, and a grid is expected to exceed it: a half loads only the cell it shows and its two neighbours (pictures kept)`
        : paintedBytes > 0
        ? `${path}: ${(halfBytes / 1048576).toFixed(1)} MB of stage pictures declared, ${(paintedBytes / 1048576).toFixed(1)} MB of them painted-in elements; the budget is ${MAX_PAIR_HALF_BYTES / 1048576} MB per pair, and a set of painted-in elements (1.16) is expected to exceed it: a half loads only the picture it shows and the next stage's (pictures kept)`
        : `${path}: ${(halfBytes / 1048576).toFixed(1)} MB of stage pictures declared; their budget is ${MAX_PAIR_HALF_BYTES / 1048576} MB per pair (pictures kept)`,
    );
  const frameBytes = (transitions?.steps ?? []).reduce((n, s) => n + (s.bytes ?? 0), 0);
  const frameRefBytes = (transitions?.steps ?? []).reduce((n, s) => n + (s.frames.every((f) => inRef(f.src)) ? (s.bytes ?? 0) : 0), 0);
  const ownBytes = parseBytes(e, path, warn) ?? 0;
  return {
    key,
    left,
    right,
    dual: cleanText(e.dual, 60),
    shock: cleanText(e.shock, 60),
    kind,
    stages,
    transitions,
    band: parseBand(e.band, `${path}.band`, warn),
    stageMap,
    ...(grid ? { grid } : {}),
    bytes: halfBytes + frameBytes + ownBytes,
    refBytes: refBytes + frameRefBytes + ownBytes,
  };
}

/** Spec 1.17: a grid cell's key. */
const GRID_KEY = /^([1-9])x([1-9])$/;

/**
 * Spec 1.17 (draft): a pair's `grid`, `{ "<i>x<j>": { src, phone?, bytes, horizon?, … } }`,
 * `i` the stage of the pair's {@link GEOGRAPHY}-left colour and `j` the
 * right's, 1..6 each. A cell is read as a 1.5 `half` in the shape of the
 * pair's first stage panorama (what a cell leaves out -- `width`, `height`,
 * `subjectBand`, `focal`, `safe`, `horizon`, `hour`, `key` -- is that
 * panorama's, as 1.16's painted-in elements take theirs), so a painter that
 * keeps 1.15's canvas writes `src` and `bytes`. Null when there is none. Only
 * a band pair has one (a motif pair has no whole-half picture); a bad key or
 * cell is warned and dropped alone; a cell more than one stage apart is kept
 * (it is shown for exactly those stages) with a note that the draft paints
 * |i − j| ≤ 1.
 */
function parseGrid(v: unknown, kind: PairKind, rawStages: unknown[], keyLeft: Biome, keyRight: Biome, base: string, path: string, warn: string[]): PairGrid | null {
  if (v === undefined || v === null) return null;
  if (!isObj(v)) {
    warn.push(`${path}: not an object keyed by the two halves' stages ("4x3"); ignored`);
    return null;
  }
  if (kind !== 'band') {
    warn.push(`${path}: a seam grid needs a band pair (stages with \`half\`), as a whole-half panorama does; ignored`);
    return null;
  }
  const order = geographyOrder(keyLeft, keyRight);
  if (!order) {
    warn.push(`${path}: a seam grid is painted in the five colours' geography (${GEOGRAPHY.join(' → ')}), and this pair is not on it; ignored`);
    return null;
  }
  const first = rawStages.find((st) => isObj(st) && isObj(st.panorama)) as Record<string, unknown> | undefined;
  const shape = shapeOf(first?.panorama, PANORAMA_SHAPE);
  const phoneShape = shapeOf(isObj(first?.panorama) ? (first!.panorama as Record<string, unknown>).phone : undefined, PANORAMA_PHONE_SHAPE);
  const cells: Partial<Record<string, PackHalf>> = {};
  let far = 0;
  for (const k of Object.keys(v)) {
    const m = GRID_KEY.exec(k);
    const i = m ? Number(m[1]) : 0;
    const j = m ? Number(m[2]) : 0;
    if (!m || i > MAX_STAGES || j > MAX_STAGES) {
      warn.push(`${path}.${cleanText(k, 20)}: not "<i>x<j>", the left half's stage and the right's, 1–${MAX_STAGES} ("4x3"); ignored`);
      continue;
    }
    const e = v[k];
    if (!isObj(e)) {
      warn.push(`${path}.${k}: not an object { src, phone, bytes }; ignored`);
      continue;
    }
    const merged: Record<string, unknown> = { ...shape, ...e };
    if (typeof e.phone === 'string') merged.phone = { ...phoneShape, src: e.phone };
    else if (isObj(e.phone)) merged.phone = { ...phoneShape, ...e.phone };
    const cell = parseHalf(merged, base, `${path}.${k}`, warn);
    if (!cell) continue;
    if (Math.abs(i - j) > 1) far++;
    cells[gridCellKey(i, j)] = cell;
  }
  if (far) warn.push(`${path}: ${far} cell${far === 1 ? '' : 's'} more than one stage apart (kept, shown for exactly those stages; the draft paints |i − j| ≤ 1 and clamps the lighter half)`);
  if (!Object.keys(cells).length) {
    warn.push(`${path}: no usable cell; ignored`);
    return null;
  }
  return { left: order[0], right: order[1], cells };
}

/** The fields a painted-in element (spec 1.16) takes from its stage's panorama when it does not give its own. */
const PANORAMA_SHAPE = ['width', 'height', 'subjectBand', 'focal', 'safe', 'horizon', 'hour', 'key'] as const;
const PANORAMA_PHONE_SHAPE = ['width', 'height', 'subjectBand', 'focal', 'safe', 'horizon'] as const;

function shapeOf(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (isObj(raw)) for (const k of keys) if (raw[k] !== undefined) out[k] = raw[k];
  return out;
}

/**
 * Spec 1.16: a stage's `elements`, `{ "<colour>": { src, phone?, bytes, horizon?, … } }`,
 * each read as a 1.5 `half` in its stage panorama's shape (`rawPanorama`,
 * the stage's raw `panorama`: its geometry fills what the entry leaves out;
 * `phone` may be a URL or an object). Spec 1.16.1: an entry may instead (or
 * as well) give `left` and `right`, each `{ src, phone, bytes, … }` read the
 * same way, the entry's own shape fields (`horizon`, …) between the
 * panorama's and the side's. Null when there are none. A stage with no
 * usable panorama has none (they are its variants); a bad colour, entry or
 * side is warned and dropped alone.
 */
function parseStageElements(v: unknown, rawPanorama: unknown, base: string, path: string, warn: string[]): Partial<Record<PieceColour, PairElement>> | null {
  if (v === undefined || v === null) return null;
  if (!isObj(v)) {
    warn.push(`${path}: not an object keyed by colour (${PIECE_COLOURS.join(', ')}); ignored`);
    return null;
  }
  if (!isObj(rawPanorama)) {
    warn.push(`${path}: painted-in elements are variants of the stage's panorama, and this stage has none; ignored`);
    return null;
  }
  const panoShape = shapeOf(rawPanorama, PANORAMA_SHAPE);
  const panoPhone = shapeOf(rawPanorama.phone, PANORAMA_PHONE_SHAPE);
  // One picture: `e` over `shape` (the panorama's, then the entry's), its phone over the panorama phone's shape.
  const picture = (e: Record<string, unknown>, shape: Record<string, unknown>, phoneShape: Record<string, unknown>, p: string): PackHalf | null => {
    const merged: Record<string, unknown> = { ...shape, ...e };
    if (typeof e.phone === 'string') merged.phone = { ...phoneShape, src: e.phone };
    else if (isObj(e.phone)) merged.phone = { ...phoneShape, ...e.phone };
    return parseHalf(merged, base, p, warn);
  };
  const out: Partial<Record<PieceColour, PairElement>> = {};
  for (const k of Object.keys(v)) {
    if (!(PIECE_COLOURS as readonly string[]).includes(k)) {
      warn.push(`${path}.${cleanText(k, 30)}: not a colour (${PIECE_COLOURS.join(', ')}); ignored`);
      continue;
    }
    const e = v[k];
    if (!isObj(e)) {
      warn.push(`${path}.${k}: not an object { src, phone, bytes } or { left, right }; ignored`);
      continue;
    }
    const sided = e.left !== undefined || e.right !== undefined;
    const entryShape = { ...panoShape, ...shapeOf(e, PANORAMA_SHAPE) };
    const entryPhone = { ...panoPhone, ...(isObj(e.phone) ? shapeOf(e.phone, PANORAMA_PHONE_SHAPE) : {}) };
    const side = (s: PairSide): PackHalf | null => {
      const raw = e[s];
      if (raw === undefined || raw === null) return null;
      if (!isObj(raw)) {
        warn.push(`${path}.${k}.${s}: not an object { src, phone, bytes }; ignored`);
        return null;
      }
      return picture(raw, entryShape, entryPhone, `${path}.${k}.${s}`);
    };
    const left = side('left');
    const right = side('right');
    // 1.16's unsided picture: an entry's own `src` (a sided entry may keep one for a side it leaves out).
    const any = !sided || e.src !== undefined ? picture(sided ? Object.fromEntries(Object.entries(e).filter(([x]) => x !== 'left' && x !== 'right')) : e, panoShape, panoPhone, `${path}.${k}`) : null;
    if (!left && !right && !any) {
      if (sided) warn.push(`${path}.${k}: no usable side (left or right); ignored`);
      continue;
    }
    out[k as PieceColour] = { left, right, any };
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Spec 1.9: validate a `pairs.json`. Strict like `validateManifest`: every
 * string cleaned, every number range-checked, every URL http(s) or relative to
 * the manifest; a bad pair drops that pair (a warning), and only a manifest
 * that is not a schema-1 pair pack with at least one usable pair is an error.
 */
export function validatePairs(raw: unknown, base: string): PairsResult {
  const warnings: string[] = [];
  const b = packBase(base);
  if (!b) return { pairs: null, errors: ['The pairs URL must be http:// or https:// (no user name or password).'], warnings };
  if (!isObj(raw)) return { pairs: null, errors: ['The pairs manifest is not a JSON object.'], warnings };
  if (raw.schema !== 1) return { pairs: null, errors: [`schema: expected 1, found ${cleanText(raw.schema, 20) ?? 'nothing'}.`], warnings };
  if (!isObj(raw.pairs)) return { pairs: null, errors: ['pairs: missing (an object keyed by biome pairs, "forest+island").'], warnings };
  const pairs: Partial<Record<string, PackPair>> = {};
  for (const rawKey of Object.keys(raw.pairs)) {
    const p = parsePair(rawKey, raw.pairs[rawKey], b, warnings);
    if (!p) continue;
    if (pairs[p.key]) {
      warnings.push(`pairs.${cleanText(rawKey, 40)}: the pair ${p.key} is given twice; the first is kept`);
      continue;
    }
    pairs[p.key] = p;
  }
  if (!Object.keys(pairs).length) return { pairs: null, errors: ['No pair has a usable stage picture or motif.'], warnings };
  let spec: string | null = null;
  if (raw.spec !== undefined) {
    // Spec 1.16.1: an amendment may carry a third number (1.16.1); a newer version is compared number by number.
    spec = typeof raw.spec === 'string' && /^1\.\d{1,2}(\.\d{1,2})?$/.test(raw.spec) ? raw.spec : null;
    if (!spec) warnings.push(`spec: "${cleanText(raw.spec, 20) ?? typeof raw.spec}" is not a 1.x version; ignored`);
    else if (specNewer(spec, PAIRS_SPEC)) warnings.push(`spec: the pairs are written for ${spec}; this ForgeCoach reads ${PAIRS_SPEC}, so newer fields are ignored`);
  }
  // Only the files in this manifest's own ref count: a file named at another tag's URL costs this ref nothing (review fault 7).
  const total = Object.values(pairs).reduce((n, p) => n + (p?.refBytes ?? 0), 0);
  if (total > MAX_PAIRS_PACK_BYTES) warnings.push(`pairs: ${(total / 1048576).toFixed(1)} MB declared in this pack's own folder; a jsDelivr ref holds at most 50 MB, so keep a pairs pack under ${MAX_PAIRS_PACK_BYTES / 1048576} MB (files named at another tag's URL are not counted)`);
  return {
    pairs: { schema: 1, spec, name: cleanText(raw.name, 80) ?? 'Untitled pairs', author: cleanText(raw.author, 80), license: cleanText(raw.license, 80), note: cleanText(raw.note, 400), base: b, pairs },
    errors: [],
    warnings,
  };
}

/** The pairs manifest URL for what was given: a `.json` URL as is, else `<folder>/pairs.json`. */
export function pairsManifestUrl(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    u.hash = '';
    if (!/\.json$/i.test(u.pathname)) u.pathname = `${u.pathname.replace(/\/?$/, '/')}${PAIRS_MANIFEST_FILE}`;
    return u.href;
  } catch {
    return null;
  }
}

type FetchText = (url: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'text'>>;

/** Fetch and validate a pairs manifest. Never throws: problems come back as `errors`. */
export async function fetchPairs(input: string, deps: { fetch: FetchText; signal?: AbortSignal }): Promise<PairsResult & { manifestUrl: string | null }> {
  const manifestUrl = pairsManifestUrl(input);
  if (!manifestUrl) return { manifestUrl: null, pairs: null, errors: ['The pairs URL must start with http:// or https:// (no user name or password).'], warnings: [] };
  let text: string;
  try {
    const res = await deps.fetch(manifestUrl, { cache: 'no-cache', signal: deps.signal, credentials: 'omit' });
    if (!res.ok) return { manifestUrl, pairs: null, errors: [`${manifestUrl} answered HTTP ${res.status}.`], warnings: [] };
    text = await res.text();
  } catch {
    return { manifestUrl, pairs: null, errors: [`${manifestUrl} is unreachable.`], warnings: [] };
  }
  if (text.length > MAX_PAIRS_MANIFEST_BYTES) return { manifestUrl, pairs: null, errors: [`The pairs manifest is over ${MAX_PAIRS_MANIFEST_BYTES / 1024} KB.`], warnings: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { manifestUrl, pairs: null, errors: ['The pairs manifest is not valid JSON.'], warnings: [] };
  }
  return { manifestUrl, ...validatePairs(raw, manifestUrl) };
}

// ---------------------------------------------------------------------------
// The band on the half board

/** One band to draw: between which two slots, which pair, its width and its stage. */
export interface PairBandPlacement {
  key: string;
  /** The slot right of the band (its index in the layout); the band is between it and the slot before. */
  index: number;
  /** The two biomes as the board has them, left and right. */
  left: Biome;
  right: Biome;
  pair: PackPair;
  mirror: boolean;
  /** Lands on the side that are both colours (model.ts `dualPairs`). */
  duals: number;
  /** The band's width as a fraction of the half's ({@link bandWidth}), before the panels' floor ({@link halfRow}). */
  width: number;
  /** The lower of the two neighbours' stages, and the pair stage it maps to (at most the pair's last pictured stage). */
  lower: number;
  stage: number;
}

/**
 * The bands a side draws: one per neighbouring pair of live slots (both with
 * lands; a withered panel's seam has none) that the pairs pack has an entry
 * for.
 */
export function pairBands(layout: readonly HalfSlotLayout[], pairs: PairsPack | null | undefined, duals: Readonly<Record<string, number>> = {}): PairBandPlacement[] {
  if (!pairs || layout.length < 2) return [];
  const out: PairBandPlacement[] = [];
  for (let i = 1; i < layout.length; i++) {
    const l = layout[i - 1]!;
    const r = layout[i]!;
    if (!(l.stage > 0 && r.stage > 0 && l.slot.weight > 0 && r.slot.weight > 0)) continue;
    const found = pairFor(pairs, l.slot.biome, r.slot.biome);
    if (!found) continue;
    const n = duals[found.pair.key] ?? 0;
    const lower = Math.min(l.stage, r.stage);
    out.push({
      key: found.pair.key,
      index: i,
      left: l.slot.biome,
      right: r.slot.biome,
      pair: found.pair,
      mirror: found.mirror,
      duals: n,
      width: bandWidth(found.pair.band, n),
      lower,
      stage: Math.min(pairStageFor(found.pair.stageMap, lower), found.pair.stages.length),
    });
  }
  return out;
}

/** Spec 1.12: the bands that are panels of the half's row (band pairs); a motif pair's seam stays plain and its motif is drawn over it. */
export function panelBands<T extends Pick<PairBandPlacement, 'pair'>>(bands: readonly T[]): T[] {
  return bands.filter((b) => b.pair.kind !== 'motif');
}

/** Spec 1.12: the bands drawn as a motif over a plain seam. */
export function motifBands<T extends Pick<PairBandPlacement, 'pair'>>(bands: readonly T[]): T[] {
  return bands.filter((b) => b.pair.kind === 'motif');
}

/** Spec 1.10: the seams (the index of the slot right of each) that have a pair band, so they draw no bridge (bridges.ts). A motif pair's seam counts (1.12). */
export function bandedSeams(bands: readonly Pick<PairBandPlacement, 'index'>[]): ReadonlySet<number> {
  return new Set(bands.map((b) => b.index));
}

/** One item of the half's flex row: a biome's panel, or a pair's band between two. */
export interface RowItem {
  kind: 'slot' | 'band';
  /** The biome, or the pair key. */
  key: string;
  /** The slot's index in the layout; a band's is the slot right of it. */
  index: number;
  /** Its share of the half (the flex row's grow). */
  share: number;
  /** How far it overlaps the item before it, as a fraction of the half's width (0 for the first). */
  seam: number;
  band?: PairBandPlacement;
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * The half's row with its bands. `seams[i]` is the seam left of slot i
 * (bridges.ts `halfSeams`). A band in `bands` that is `open` (its picture has
 * loaded) takes its width from the two panels beside it, half from each, but
 * never more than half a panel's share (a narrow panel next to a wide band
 * keeps half its room and the band is narrower); a band not open has no width
 * (it is still in the row, so its element and its fade survive). Either way
 * the band meets each neighbour in half the seam they met in, so a band of no
 * width is exactly that seam.
 */
export function halfRow(layout: readonly HalfSlotLayout[], seams: readonly number[], bands: readonly PairBandPlacement[] = [], open: (key: string) => boolean = () => true): RowItem[] {
  const at = new Map<number, PairBandPlacement>();
  for (const b of bands) if (b.index > 0 && b.index < layout.length && !at.has(b.index)) at.set(b.index, b);
  const want = new Map<number, number>();
  for (const [i, b] of at) want.set(i, open(b.key) ? Math.max(0, b.width) : 0);
  // Each panel gives up half of each band beside it, at most half its own share.
  const factor = layout.map((l, j) => {
    const give = ((want.get(j) ?? 0) + (want.get(j + 1) ?? 0)) / 2;
    return give > l.share / 2 && give > 0 ? l.share / 2 / give : 1;
  });
  const width = new Map<number, number>();
  for (const [i, w] of want) width.set(i, w * Math.min(factor[i - 1]!, factor[i]!));
  const out: RowItem[] = [];
  layout.forEach((l, j) => {
    const b = at.get(j);
    const seam = j === 0 ? 0 : (seams[j] ?? 0);
    if (b) out.push({ kind: 'band', key: b.key, index: j, share: r4(width.get(j)!), seam: r4(seam / 2), band: b });
    out.push({ kind: 'slot', key: l.slot.biome, index: j, share: r4(Math.max(0, l.share - ((width.get(j) ?? 0) + (width.get(j + 1) ?? 0)) / 2)), seam: r4(b ? seam / 2 : seam) });
  });
  return out;
}

/**
 * The centre of row item `i`, in px across a half `width` px wide in a
 * viewport `vw` px wide, as the flex row lays it out: each item its share of
 * the width plus every seam, each later item pulled left by its own seam, each
 * seam capped at 14vw (scenery.css). The numeric twin of {@link rowCentreCss}.
 */
export function rowCentre(items: readonly Pick<RowItem, 'share' | 'seam'>[], i: number, width: number, vw = Infinity): number {
  const px = (k: number) => (k === 0 ? 0 : Math.min(items[k]!.seam * width, SEAM_CAP_VW * vw));
  const total = width + items.reduce((n, _, k) => n + px(k), 0);
  const sum = items.reduce((n, x) => n + x.share, 0) || 1;
  const before = items.slice(0, i).reduce((n, x) => n + x.share, 0) / sum;
  let pulled = 0;
  for (let k = 1; k <= i; k++) pulled += px(k);
  return (before + items[i]!.share / sum / 2) * total - pulled;
}

/** Each row item's span across a half `width` px wide in a viewport `vw` px wide, as the flex row lays it out (rowCentre's rule): its left edge, its width, and the seam it overlaps the item before in (px, capped at 14vw). */
export function rowSpans(items: readonly Pick<RowItem, 'share' | 'seam'>[], width: number, vw = Infinity): { left: number; width: number; seam: number }[] {
  const px = (k: number) => (k === 0 ? 0 : Math.min(items[k]!.seam * width, SEAM_CAP_VW * vw));
  const total = width + items.reduce((n, _, k) => n + px(k), 0);
  const sum = items.reduce((n, x) => n + x.share, 0) || 1;
  let x = 0;
  return items.map((it, k) => {
    const w = (it.share / sum) * total;
    const left = x - px(k);
    x = left + w;
    return { left: Math.round(left * 10) / 10, width: Math.round(w * 10) / 10, seam: Math.round(px(k) * 10) / 10 };
  });
}

/**
 * Spec 1.10: where a biome's own panel lies across its half, for drawing
 * something of that biome's over its panel only (the full-area accent): the
 * panel's span and the ramps it shares with its neighbours (px), from the same
 * row the half board lays out (folded to three panels, the bands as wide as
 * when open). Null when the half is not split (the biome fills it), or when the
 * biome has no panel (folded away).
 */
export function halfPanelSpan(
  slots: SlotState[],
  pack: ScenePack | null,
  biome: Biome,
  width: number,
  opts: { duals?: Readonly<Record<string, number>>; stageOverride?: number | null; vw?: number; showing?: MakeupShowing | null } = {},
): { left: number; right: number; fadeLeft: number; fadeRight: number } | 'none' | null {
  const layout = halfLayout(slots, pack, opts.stageOverride ?? null, opts.showing ?? null);
  if (layout.length < 2 || !(width > 0)) return layout.some((l) => l.slot.biome === biome) || !layout.length ? null : 'none';
  const duals = opts.duals ?? {};
  const bands = pairBands(layout, pack?.pairs ?? null, duals);
  const seams = halfSeams(layout, pack, duals, bandedSeams(bands));
  const items = halfRow(layout, seams, panelBands(bands));
  const at = items.findIndex((it) => it.kind === 'slot' && it.key === biome);
  if (at < 0) return 'none';
  const spans = rowSpans(items, width, opts.vw);
  const me = spans[at]!;
  const next = spans[at + 1];
  return { left: Math.max(0, me.left), right: Math.min(width, me.left + me.width), fadeLeft: at === 0 ? 0 : me.seam, fadeRight: next ? next.seam : 0 };
}

/** Spec 1.10: a mask that keeps a panel's span, eased in and out over the seams it shares (px). */
export function panelMaskCss(s: { left: number; right: number; fadeLeft: number; fadeRight: number }): string {
  const r = (n: number) => `${Math.round(n)}px`;
  return `linear-gradient(to right, transparent ${r(s.left)}, #000 ${r(s.left + s.fadeLeft)}, #000 ${r(s.right - s.fadeRight)}, transparent ${r(s.right)})`;
}

/** {@link rowCentre} as CSS for an element inside the half (a size container: `cqw` is the half's width). */
export function rowCentreCss(items: readonly Pick<RowItem, 'share' | 'seam'>[], i: number): string {
  const f = (n: number) => String(r4(n));
  const s = (k: number) => `min(${f(items[k]!.seam * 100)}cqw, ${f(SEAM_CAP_VW * 100)}vw)`;
  const sum = items.reduce((n, x) => n + x.share, 0) || 1;
  const at = items.slice(0, i).reduce((n, x) => n + x.share, 0) / sum + items[i]!.share / sum / 2;
  const all = items.map((_, k) => k).filter((k) => k > 0).map(s);
  const pulled = Array.from({ length: i }, (_, k) => s(k + 1));
  return `calc(${f(at)} * (100cqw${all.map((x) => ` + ${x}`).join('')})${pulled.length ? ` - (${pulled.join(' + ')})` : ''})`;
}

/**
 * The band pictures worth warming with a side's split pictures: for every two
 * live biomes on a side with an entry, the pair's picture at the stage their
 * lower stage maps to, and the next pair stage's, at the shape the board
 * shows. Each file once.
 *
 * `full` (spec 1.15, `?pairfull=1`): the whole-half pictures too -- for each
 * pair, its 1.15 `panorama` and, spec 1.16, the painted-in element
 * panoramas of the side's other colours, at the stage the pair picture shows
 * (the pair's two biomes' total lands, and every live land for an element,
 * on `thresholds`) and the next one; the review's fault 4 found the
 * panorama never warmed, so a half waited on it cold. And, ahead of a
 * second colour arriving (the review of #198), each live colour's pair
 * panoramas at pair stage 1 with every colour it does not have yet -- at
 * most four a colour -- so the first pair picture is usually there when its
 * land is played. Spec 1.17 likewise: the seam grid's FIRST cell with each
 * colour the side does not have yet -- that colour at stage 1 and the live
 * one at its own stage (`1xj` / `ix1`, clamped as `pairGridPick` clamps),
 * and at the stage a dual of the two would give it -- so the pair's first
 * frame is its cell, not the whole-place panorama for a moment (the #201
 * follow-up). `full.narrow` (a phone-width screen): a cell with no phone
 * picture is never drawn there ({@link pairGridGivesWay}), so
 * none is warmed (the #201 review: desktop cells were fetched on a phone).
 */
export function pairPictures(
  pairs: PairsPack | null | undefined,
  sides: readonly (readonly { biome: Biome; stage: number; weight?: number }[])[],
  opts: { phone: boolean; full?: { thresholds?: readonly number[] | null; narrow?: boolean } | null },
): { src: string; src2x: string | null }[] {
  if (!pairs) return [];
  const out: { src: string; src2x: string | null }[] = [];
  const seen = new Set<string>();
  const add = (h: PackHalf | null) => {
    if (!h) return;
    const p = opts.phone && h.phone ? h.phone : h;
    if (seen.has(p.src)) return;
    seen.add(p.src);
    out.push({ src: p.src, src2x: p.src2x });
  };
  // Spec 1.17: a grid cell, unless a phone-width screen would never draw it.
  const addCell = (pair: PackPair, left: number, right: number) => {
    const pick = pairGridPick(pair, Math.min(left, MAX_STAGES), Math.min(right, MAX_STAGES));
    if (pick && !(opts.full?.narrow && pairGridGivesWay(pair, pick.picture))) add(pick.picture);
  };
  for (const slots of sides) {
    const live = slots.filter((s) => s.stage > 0);
    const sideTotal = live.reduce((n, s) => n + (s.weight ?? 0), 0);
    if (opts.full)
      for (const s of live)
        for (const other of Object.keys(BIOME_COLOUR) as Biome[]) {
          if (other === s.biome || !BIOME_COLOUR[s.biome] || live.some((x) => x.biome === other)) continue;
          const found = pairFor(pairs, s.biome, other);
          if (!found) continue;
          add(pairPanoramaAt(found.pair, 1));
          // The first cell: the arriving colour at stage 1, the live one at its own stage -- and at the stage a dual of
          // the two (½ to each) would give it, when that is a step up.
          const g = found.pair.grid;
          if (!g) continue;
          const thresholds = opts.full.thresholds ?? DEFAULT_STAGE_THRESHOLDS;
          const withDual = s.weight !== undefined ? Math.max(s.stage, stageFor(s.weight + 0.5, thresholds)) : s.stage;
          for (const own of new Set([s.stage, withDual])) addCell(found.pair, g.left === s.biome ? own : 1, g.left === s.biome ? 1 : own);
        }
    for (let i = 0; i < live.length; i++)
      for (let j = i + 1; j < live.length; j++) {
        const found = pairFor(pairs, live[i]!.biome, live[j]!.biome);
        if (!found) continue;
        const stage = pairStageFor(found.pair.stageMap, Math.min(live[i]!.stage, live[j]!.stage));
        for (const st of [stage, stage + 1]) {
          if (st > found.pair.stages.length) continue;
          for (const h of [pairHalfAt(found.pair, st), pairMotifAt(found.pair, st)]) add(h);
        }
        if (!opts.full) continue;
        const thresholds = opts.full.thresholds ?? DEFAULT_STAGE_THRESHOLDS;
        const fullStage = (total: number) => pairStageFor(found.pair.stageMap, stageFor(total, thresholds));
        const own = fullStage((live[i]!.weight ?? 0) + (live[j]!.weight ?? 0));
        for (const st of [own, own + 1]) if (st > 0 && st <= found.pair.stages.length) add(pairPanoramaAt(found.pair, st));
        // Spec 1.17: the seam grid's cell for the two halves' own stages, and the cell either half's next land -- or its
        // last one leaving -- would show (the review of #201: a cold cell held the old cell, so warm both directions).
        const g = found.pair.grid;
        if (g) {
          const si = live.find((x) => x.biome === g.left)?.stage ?? 0;
          const sj = live.find((x) => x.biome === g.right)?.stage ?? 0;
          for (const [a, b] of [
            [si, sj],
            [si + 1, sj],
            [si, sj + 1],
            [si - 1, sj],
            [si, sj - 1],
          ] as const)
            addCell(found.pair, a, b);
        }
        const others = live.filter((_, k) => k !== i && k !== j).map((s) => BIOME_COLOUR[s.biome]).filter((c): c is PieceColour => !!c);
        if (!others.length) continue;
        const withThird = fullStage(sideTotal);
        // Spec 1.16.1: BOTH sides (about 180 KB each on the desktop): a land that turns the pair's balance flips the side
        // drawn, and a cold flip would fall back to the base panorama for a fetch (the review of #199).
        for (const st of [withThird, withThird + 1]) if (st > 0 && st <= found.pair.stages.length) for (const c of others) for (const e of pairElementPictures(pairElementEntryAt(found.pair, st, c))) add(e);
      }
  }
  return out;
}

/** Spec 1.9: the declared bytes of a pairs pack in its own folder (its CDN ref), the figure its 45 MB warning is about. */
export function pairsRefBytes(pairs: PairsPack | null | undefined): number {
  return Object.values(pairs?.pairs ?? {}).reduce((n, p) => n + (p?.refBytes ?? 0), 0);
}

/** Spec 1.9: the declared bytes of a pairs pack. */
export function pairsBytes(pairs: PairsPack | null | undefined): number {
  return Object.values(pairs?.pairs ?? {}).reduce((n, p) => n + (p?.bytes ?? 0), 0);
}
