/*
 * ForgeCoach — ambience/storyboard.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The scenery's storyboard walk: for a side's lands (a mana state), what the
 * real board draws on that half -- at a desktop's and a phone's shape, with
 * `?pairfull=1` and without -- and which colours with lands on the
 * battlefield end up with nothing on screen. Written after Justin's phone
 * board of 2026-11-02 (Island 2, Swamp 2, Mountain 2, Forest 3 under
 * `?pairfull=1`) drew island+forest's seam cell only: the swamp (the third
 * colour, painted into the cell on a desktop but with no phone picture) and
 * the mountain (the fourth, dropped by makeup.ts) were invisible, and nobody
 * had walked the ordinary situations through.
 *
 * {@link storyboardHalf} composes the reader's own functions the way the board
 * does (SceneryLayer → SceneryStrip / ScenePieces), with every picture loaded
 * (the steady state: pairfull.ts's load gate shows its first candidate):
 *
 * - makeup.ts `pickFromSlots` with the previous pick (`showing`, MakeupMemory);
 * - layout.ts `halfLayout` (the three kept colours' panels);
 * - under the flag, pairfull.ts `pairFullPlan` → `pairFullCandidates` →
 *   `pairFullChoice` (the pair picture: a seam cell, a painted cell, a stage
 *   panorama, a painted stage panorama, a stage half) and ScenePieces' cut-out
 *   rule (`pairFullCutOutAllowed`, only with the pack's 1.14 elements);
 * - otherwise (no flag, or no plan) the 1.10 row: the panels, pairs.ts
 *   `pairBands` (bands and motifs) and bridges.ts `bridgePlacements`;
 * - the caption `#ambience` prints (AmbiencePage's `bandCaption`, mirrored
 *   here because it is not exported: `pairFullCaption` of a plan made with no
 *   `showing`, else the band list).
 *
 * It changes no rule: it reads them. Pure and DOM-free;
 * `storyboard.test.ts` walks every state through it.
 */
import { PIECE_COLOURS, type PieceColour, type ScenePack } from './manifest.ts';
import { pairKey, stageFor, stageProgress, type Biome, type SlotState } from './model.ts';
import { halfLayout } from './layout.ts';
import { BIOME_COLOUR, COLOUR_BIOME, pickFromSlots, type MakeupPick, type MakeupShowing } from './makeup.ts';
import { pairFullCandidates, pairFullCaption, pairFullChoice, pairFullCutOutAllowed, pairFullHeavierSide, pairFullPanelAspect, pairFullPlan, type PairFullCandidate, type PairFullPair } from './pairfull.ts';
import { bandedSeams, motifBands, pairBands, pairGridPaintedAt, panelBands, type PairsPack, type PairSide } from './pairs.ts';
import { bridgePlacements, phoneHalf } from './bridges.ts';
import { elementBiomes } from './pieces.ts';

/** The two screens walked: a desktop (1600 px wide, a half about 5 : 1) and a phone (375 px: phone-width, a half about 2.1 : 1). */
export type Shape = 'desktop' | 'phone';
export const SHAPES: Record<Shape, { widthPx: number; narrow: boolean; halfAspect: number }> = {
  desktop: { widthPx: 1600, narrow: false, halfAspect: 5 },
  phone: { widthPx: 375, narrow: true, halfAspect: 2.1 },
};

/** One side's lands: basic counts by colour, its dual lands (½ to each colour), and the order its colours arrived. */
export interface ManaState {
  counts: Partial<Record<PieceColour, number>>;
  duals: readonly (readonly [PieceColour, PieceColour])[];
  /** Colours in the order they first arrived; a colour with lands missing here goes last, in WUBRG order. */
  arrival: readonly PieceColour[];
}

/** The board's packs: ForgeCoach's scenery pack and the pairs each mode loads (pairs-v3.1 without the flag, pairs-v7.1 with it). */
export interface StoryboardPacks {
  pack: ScenePack;
  pairsOff: PairsPack | null;
  pairsFull: PairsPack | null;
}

/** One thing on the half: a biome's panel, the pair picture, the third colour painted in or cut out, a band, a motif, a bridge. */
export interface Drawn {
  kind: 'panel' | 'pair' | 'painted' | 'cutout' | 'band' | 'motif' | 'bridge';
  colours: PieceColour[];
  what: string;
}

/**
 * Why a colour with lands has nothing on screen:
 * - `dropped`: a fourth or fifth colour (makeup.ts keeps the three heaviest; "the rest show nothing");
 * - `third-on-cell-phone`: the third colour on a seam cell on a phone -- the cell has it painted in for the
 *   desktop, but that picture has no phone picture, so 1.18 draws the plain cell and nothing of it;
 * - `third-on-cell-unpainted`: the third colour on a seam cell with no painted-in picture for it on the heavier half;
 * - `third-element-unpainted`: the third colour as a stage picture's element whose picture is not the one drawn;
 * - `unexplained`: none of these (a bug in this walk or a new rule).
 */
export type GapReason = 'dropped' | 'third-on-cell-phone' | 'third-on-cell-unpainted' | 'third-element-unpainted' | 'unexplained';

/** What one half draws for one mana state, at one shape, with or without the flag. */
export interface HalfStoryboard {
  shape: Shape;
  pairfull: boolean;
  /** Colours with lands, in arrival order. */
  colours: PieceColour[];
  visible: PieceColour[];
  invisible: { colour: PieceColour; reason: GapReason }[];
  /** The pair picture's colours (pair-key order) when the half is one pair picture (the flag), else null. */
  picturePair: [PieceColour, PieceColour] | null;
  /** The pair picture's identity (its key and cell / stage, painted colour), or the row's panels: for the flip count. */
  picture: string;
  drawn: Drawn[];
  /** `#ambience`'s caption for the side, or null (none). */
  caption: string | null;
  /** The colours the caption names (biome words, dual and shock names, "R painted in"). */
  captionNames: PieceColour[];
  /** makeup.ts's pick (what MakeupMemory holds after this state). */
  pick: MakeupPick;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** The slots model.ts's tracker would hold for a state (first appearance = arrival order) and its duals per pair. */
export function slotsFor(state: ManaState, thresholds: readonly number[]): { slots: SlotState[]; duals: Record<string, number> } {
  const weight: Partial<Record<PieceColour, number>> = {};
  for (const c of PIECE_COLOURS) if ((state.counts[c] ?? 0) > 0) weight[c] = state.counts[c]!;
  const duals: Record<string, number> = {};
  for (const [a, b] of state.duals) {
    weight[a] = (weight[a] ?? 0) + 0.5;
    weight[b] = (weight[b] ?? 0) + 0.5;
    const k = pairKey(COLOUR_BIOME[a], COLOUR_BIOME[b]);
    duals[k] = (duals[k] ?? 0) + 1;
  }
  const order = [...state.arrival.filter((c, i) => state.arrival.indexOf(c) === i), ...PIECE_COLOURS.filter((c) => !state.arrival.includes(c))].filter((c) => (weight[c] ?? 0) > 0);
  const slots = order.map((c, index): SlotState => {
    const w = r3(weight[c]!);
    const stage = stageFor(w, thresholds);
    return { biome: COLOUR_BIOME[c], index, weight: w, stage, progress: stageProgress(w, thresholds), peak: stage };
  });
  return { slots, duals };
}

const colourOf = (b: Biome): PieceColour | null => BIOME_COLOUR[b] ?? null;
const BIOME_WORDS = /\b(island|swamp|plains|forest|mountain)\b/g;

/** The colours a caption names: biome words, a pair's dual or shock name (both its colours), "R painted in". */
export function captionColours(caption: string | null, pairs: PairsPack | null): PieceColour[] {
  if (!caption) return [];
  const out = new Set<PieceColour>();
  for (const m of caption.matchAll(BIOME_WORDS)) out.add(BIOME_COLOUR[m[1] as Biome]!);
  for (const m of caption.matchAll(/\b([WUBRG]) painted in\b/g)) out.add(m[1] as PieceColour);
  for (const p of Object.values(pairs?.pairs ?? {})) {
    if (!p) continue;
    for (const name of [p.dual, p.shock]) {
      if (name && caption.includes(name)) {
        out.add(BIOME_COLOUR[p.left]!);
        out.add(BIOME_COLOUR[p.right]!);
      }
    }
  }
  return PIECE_COLOURS.filter((c) => out.has(c));
}

/** AmbiencePage's `bandCaption` (not exported there): the pair picture's caption under the flag, else the bands in words. */
function bandCaption(pack: ScenePack, pairs: PairsPack | null, slots: SlotState[], duals: Record<string, number>, pairfull: boolean, narrow: boolean): string | null {
  const elements = pairfull ? elementBiomes(pack.pieces) : null;
  const full = pairfull && pairs ? pairFullCaption(pairFullPlan(halfLayout(slots, pack, null), pairs, { thresholds: pack.stageThresholds, stageOverride: null, elements, slots, narrow })) : null;
  if (full) return full;
  if (!pairs) return null;
  const bands = pairBands(halfLayout(slots, pack, null), pairs, duals);
  if (!bands.length) return null;
  return bands.map((b) => `${b.pair.dual ?? b.key}${b.pair.shock ? ` (${b.pair.shock})` : ''}: ${b.pair.kind === 'motif' ? 'motif ' : ''}${Math.round(b.width * 100)}% wide, ${b.duals} dual${b.duals === 1 ? '' : 's'}, pair stage ${b.stage}`).join('   ');
}

const file = (src: string) => src.slice(src.lastIndexOf('/') + 1).replace(/\.webp$/, '');

function describeShown(p: PairFullPair, shown: PairFullCandidate): string {
  const pic = shown.art.picture ? file(shown.art.picture.src) : 'strip';
  if (shown.cell) return `${p.key} cell ${shown.cell}${p.grid?.clamped ? ' (clamped)' : ''}${shown.painted ? ` +${shown.painted}` : ''} [${pic}]`;
  return `${p.key} pair stage ${p.stage}${shown.painted ? ` +${shown.painted}` : ''} [${pic}]`;
}

/**
 * What the board draws on one half for `state`, at `shape`, with the flag or
 * not, given what the half showed before (`showing`: MakeupMemory's pick at
 * the previous state frame; null for a state with no history). `caption:
 * false` skips the caption (it plans the half a second time).
 */
export function storyboardHalf(state: ManaState, shape: Shape, pairfull: boolean, packs: StoryboardPacks, showing: MakeupShowing | null = null, opts: { caption?: boolean } = {}): HalfStoryboard {
  const { pack } = packs;
  const thresholds = pack.stageThresholds ?? [1, 2, 4, 6];
  const { narrow, halfAspect } = SHAPES[shape];
  const { slots, duals } = slotsFor(state, thresholds);
  const pick = pickFromSlots(slots, showing);
  // SceneryLayer hands the strip MakeupMemory's pick AT this frame (the previous one folded with this state).
  const memory: MakeupShowing | null = pick.kept.length ? pick : null;
  const layout = halfLayout(slots, pack, null, memory);
  const pairs = pairfull ? packs.pairsFull : packs.pairsOff;
  const elements = pairfull ? elementBiomes(pack.pieces) : null;
  const drawn: Drawn[] = [];
  let picturePair: [PieceColour, PieceColour] | null = null;
  let picture = '';
  let thirdReason: GapReason | null = null;

  const plan = pairfull && pairs ? pairFullPlan(layout, pairs, { thresholds, elements, showing: memory, slots, narrow }) : null;
  const p = plan?.find((x): x is PairFullPair => x.kind === 'pair') ?? null;
  const choice = p ? pairFullChoice(pairFullCandidates(p, pairFullPanelAspect(halfAspect, p.share), narrow, false), () => 'ready') : null;
  const shown = choice?.show ?? null;
  if (plan && p && shown) {
    const parts: string[] = [];
    for (const it of plan) {
      if (it.kind === 'slot') {
        const l = layout[it.index]!;
        const c = colourOf(it.biome);
        drawn.push({ kind: 'panel', colours: c ? [c] : [], what: `${it.biome} s${l.stage} panel ${Math.round(it.share * 100)}%` });
        parts.push(`${it.biome} s${l.stage} panel`);
        continue;
      }
      const cs = [colourOf(it.left), colourOf(it.right)].filter((c): c is PieceColour => !!c);
      const what = describeShown(it, shown);
      drawn.push({ kind: 'pair', colours: cs, what });
      parts.push(what);
      picturePair = cs.length === 2 ? (BIOME_COLOUR[it.pair.left] === cs[0] ? [cs[0]!, cs[1]!] : [cs[1]!, cs[0]!]) : null;
      if (shown.painted) drawn.push({ kind: 'painted', colours: [shown.painted], what: `${shown.painted} painted in` });
      if (it.element && elements?.has(it.element) && pairFullCutOutAllowed(choice)) {
        const c = colourOf(it.element);
        drawn.push({ kind: 'cutout', colours: c ? [c] : [], what: `${it.element} cut-out` });
      }
    }
    picture = parts.join(' | ');
    const third = pick.third;
    if (third && !drawn.some((d) => d.colours.includes(third))) {
      if (p.grid) {
        // The side the plan would paint on (pairfull.ts: the heavier pair colour, in the cell's order).
        const xi = (b: Biome) => slots.find((s) => s.biome === b)?.index ?? 99;
        const board = pairFullHeavierSide(p, xi);
        const side: PairSide = p.grid.mirror ? (board === 'left' ? 'right' : 'left') : board;
        thirdReason = narrow && pairGridPaintedAt(p.grid.picture, third, side, false) ? 'third-on-cell-phone' : 'third-on-cell-unpainted';
      } else if (p.element) thirdReason = 'third-element-unpainted';
    }
  } else {
    // The 1.10 row: the kept colours' panels, the pair bands (pictures or motifs) and the bridges between them.
    const parts: string[] = [];
    for (const l of layout) {
      if (!(l.stage > 0 && l.slot.weight > 0)) continue;
      const c = colourOf(l.slot.biome);
      drawn.push({ kind: 'panel', colours: c ? [c] : [], what: `${l.slot.biome} s${l.stage} panel ${Math.round(l.share * 100)}%` });
      parts.push(`${l.slot.biome} s${l.stage}`);
    }
    const bands = pairs ? pairBands(layout, pairs, duals) : [];
    for (const b of panelBands(bands)) drawn.push({ kind: 'band', colours: [colourOf(b.left), colourOf(b.right)].filter((c): c is PieceColour => !!c), what: `${b.key} band, pair stage ${b.stage}` });
    for (const b of motifBands(bands)) drawn.push({ kind: 'motif', colours: [colourOf(b.left), colourOf(b.right)].filter((c): c is PieceColour => !!c), what: `${b.key} motif, pair stage ${b.stage}` });
    for (const br of bridgePlacements(layout, pack, duals, { phone: phoneHalf(halfAspect, { narrow }), banded: bandedSeams(bands) }))
      drawn.push({ kind: 'bridge', colours: [colourOf(br.left), colourOf(br.right)].filter((c): c is PieceColour => !!c), what: `${br.key} bridge` });
    picture = parts.join(' | ');
  }

  const on = new Set(drawn.flatMap((d) => d.colours));
  const colours = pick.makeup.colours;
  const visible = colours.filter((c) => on.has(c));
  const invisible = colours.filter((c) => !on.has(c)).map((colour) => ({ colour, reason: pick.dropped.includes(colour) ? ('dropped' as const) : colour === pick.third && thirdReason ? thirdReason : ('unexplained' as const) }));
  const caption = opts.caption === false ? null : bandCaption(pack, pairs, slots, duals, pairfull, narrow);
  return { shape, pairfull, colours, visible, invisible, picturePair, picture, drawn, caption, captionNames: captionColours(caption, pairs), pick };
}

/** "U2 B2 R2 G3 (+U/B dual; arrived U B R G)": a state in a line. */
export function stateLabel(state: ManaState): string {
  const counts = PIECE_COLOURS.filter((c) => (state.counts[c] ?? 0) > 0).map((c) => `${c}${state.counts[c]}`);
  const duals = state.duals.map(([a, b]) => `+${a}/${b} dual`);
  const present = new Set([...PIECE_COLOURS.filter((c) => (state.counts[c] ?? 0) > 0), ...state.duals.flat()]);
  const arrived = [...state.arrival.filter((c) => present.has(c)), ...PIECE_COLOURS.filter((c) => present.has(c) && !state.arrival.includes(c))];
  return `${[...counts, ...duals].join(' ')} (arrived ${arrived.join(' ')})`;
}

/** A colour's land weight in a state (a dual ½). */
export const weightOf = (state: ManaState, c: PieceColour): number => (state.counts[c] ?? 0) + state.duals.filter((d) => d.includes(c)).length / 2;

/** The number of lands in a state (a dual is one land). */
export const landCount = (state: ManaState): number => PIECE_COLOURS.reduce((n, c) => n + (state.counts[c] ?? 0), 0) + state.duals.length;

/** The number of colours with lands in a state. */
export const colourCount = (state: ManaState): number => new Set([...PIECE_COLOURS.filter((c) => (state.counts[c] ?? 0) > 0), ...state.duals.flat()]).size;

/** The ten two-colour pairs, in WUBRG order. */
export const COLOUR_PAIRS: readonly (readonly [PieceColour, PieceColour])[] = PIECE_COLOURS.flatMap((a, i) => PIECE_COLOURS.slice(i + 1).map((b) => [a, b] as const));

/** The arrival orders walked: WUBRG, its reverse, and the heaviest colour last (lighter first, a tie in WUBRG order). */
export type ArrivalOrder = 'natural' | 'reverse' | 'heaviest-last';

/** A state's arrival for an order. */
export function arrivalFor(counts: Partial<Record<PieceColour, number>>, order: ArrivalOrder): PieceColour[] {
  if (order === 'natural') return [...PIECE_COLOURS];
  if (order === 'reverse') return [...PIECE_COLOURS].reverse();
  return [...PIECE_COLOURS].sort((a, b) => (counts[a] ?? 0) - (counts[b] ?? 0) || PIECE_COLOURS.indexOf(a) - PIECE_COLOURS.indexOf(b));
}

/**
 * Every state the walk covers: each colour 0–`max` basics (the owner's
 * 2026-11-02 scope: "assume any and every colour can be on the board, up to 6
 * lands each; soup decks play every colour"), every non-empty vector, in each
 * of `orders` (an order that gives the colours present the same arrival as
 * one already listed is left out: it draws the same); and, with `duals`, each
 * vector of at most `dualMax` a colour plus one dual of any of the ten pairs
 * (every pair in ForgeCoach's pairs packs names its dual), in `dualOrders`.
 */
export function enumerateStates(
  opts: { max?: number; orders?: readonly ArrivalOrder[]; duals?: boolean; dualMax?: number; dualOrders?: readonly ArrivalOrder[] } = {},
): { state: ManaState; order: ArrivalOrder }[] {
  const max = opts.max ?? 6;
  const orders = opts.orders ?? ['natural', 'reverse', 'heaviest-last'];
  const dualOrders = opts.dualOrders ?? ['natural'];
  const out: { state: ManaState; order: ArrivalOrder }[] = [];
  const vec = [0, 0, 0, 0, 0];
  const push = (counts: Partial<Record<PieceColour, number>>, duals: readonly (readonly [PieceColour, PieceColour])[], os: readonly ArrivalOrder[]) => {
    const present = new Set([...PIECE_COLOURS.filter((c) => (counts[c] ?? 0) > 0), ...duals.flat()]);
    if (!present.size) return;
    const seen = new Set<string>();
    for (const order of os) {
      const arrival = arrivalFor(counts, order);
      const key = arrival.filter((c) => present.has(c)).join('');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ state: { counts, duals, arrival }, order });
    }
  };
  const rec = (i: number) => {
    if (i === 5) {
      const counts: Partial<Record<PieceColour, number>> = {};
      PIECE_COLOURS.forEach((c, k) => {
        if (vec[k]! > 0) counts[c] = vec[k]!;
      });
      push(counts, [], orders);
      if (opts.duals && vec.every((v) => v <= (opts.dualMax ?? max))) for (const d of COLOUR_PAIRS) push(counts, [d], dualOrders);
      return;
    }
    for (let v = 0; v <= max; v++) {
      vec[i] = v;
      rec(i + 1);
    }
    vec[i] = 0;
  };
  rec(0);
  return out;
}

/** The state one basic land of `c` later: a new colour arrives after every colour already there. */
export function addLand(state: ManaState, c: PieceColour): ManaState {
  const present = PIECE_COLOURS.filter((x) => (state.counts[x] ?? 0) > 0 || state.duals.some((d) => d.includes(x)));
  const arrival = [...state.arrival.filter((x) => present.includes(x)), ...present.filter((x) => !state.arrival.includes(x))];
  return { counts: { ...state.counts, [c]: (state.counts[c] ?? 0) + 1 }, duals: state.duals, arrival: arrival.includes(c) ? arrival : [...arrival, c] };
}
