/*
 * ForgeCoach — ambience/makeup.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ONE rule for what a half's colours show (pc-results scenery/SYSTEM.md,
 * section A, steps 1, 5 and 6), shared by everything that draws a half: the
 * half board's panels (layout.ts `halfLayout` / `foldPanels`), the whole-half
 * pair picture (pairfull.ts `pairFullPlan`, and its caption) and the pieces
 * (pieces.ts `planHalf`, drawn by ScenePieces). Before this file each kept
 * its own: `foldPanels` added a dropped colour's land weight to its nearest
 * kept panel, so the pair picture was panned by a colour that was not on
 * screen, while `planHalf` ranked the unfolded weights, so the strip and the
 * pieces could pick different pairs and the element silently did not draw
 * (the scenery critical review of 2026-10-24, fault 1).
 *
 * The rule ({@link pickMakeup}):
 *
 * 1. The makeup: each colour's land weight (model.ts's rules: a dual ½ / ½, a
 *    Triome ⅓ each, a fetch nothing), in the order the colours arrived.
 * 6. Four or five colours: keep the THREE heaviest by their own, unfolded
 *    weight (a tie: a colour already showing stays; else the earlier
 *    arrival). The colours dropped show NOTHING and add NO weight to what is
 *    shown: not to a panel's width, not to the pair's pan, not to the
 *    element's share.
 * 5. The heaviest pair is chosen from the kept colours by their own weights
 *    (a tie: the pair already showing stays; else the earlier arrivals); the
 *    pan uses the pair's own two weights; the third kept colour is the
 *    element. The stage counts EVERY coloured land on the half, dropped
 *    colours included (A5: "a growing third colour still grows the place";
 *    A1: a land's weight is the same in every row, so the half's total is
 *    its number of coloured lands).
 *
 * "Already showing" is the previous pick ({@link MakeupShowing}); a caller
 * with no memory passes none, and every caller given the same slots and the
 * same previous pick gets the same answer, so they cannot disagree.
 * SceneryLayer keeps the previous pick per player and hands it to the strip,
 * the pieces and the accents.
 *
 * Pure and DOM-free.
 */
import { PIECE_COLOURS, type PieceColour } from './manifest.ts';
import type { Biome, SlotState } from './model.ts';

export const BIOME_COLOUR: Partial<Record<Biome, PieceColour>> = { plains: 'W', island: 'U', swamp: 'B', mountain: 'R', forest: 'G' };
export const COLOUR_BIOME: Record<PieceColour, Biome> = { W: 'plains', U: 'island', B: 'swamp', R: 'mountain', G: 'forest' };

/** The most colours a half shows at once (SYSTEM.md A6: a pair and one element). */
export const MAX_SHOWN_COLOURS = 3;

/** The colours a half's lands make, in the order they arrived (heaviest first is not implied). */
export interface Makeup {
  /** Colours with weight above zero, in arrival order. */
  colours: PieceColour[];
  weights: Partial<Record<PieceColour, number>>;
  /** Every coloured land's weight together (= the number of coloured lands). */
  total: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Step 1: a half's makeup from its weights and arrival order (colours missing from `arrival` go last, in WUBRG order). */
export function makeupOf(weights: Partial<Record<PieceColour, number>>, arrival: readonly PieceColour[]): Makeup {
  const order = [...arrival.filter((c, i) => arrival.indexOf(c) === i), ...PIECE_COLOURS.filter((c) => !arrival.includes(c))];
  const colours = order.filter((c) => (weights[c] ?? 0) > 1e-9);
  const w: Partial<Record<PieceColour, number>> = {};
  for (const c of colours) w[c] = r3(weights[c]!);
  return { colours, weights: w, total: r3(colours.reduce((n, c) => n + w[c]!, 0)) };
}

/** A half's makeup from its scenery slots (model.ts: a slot per biome, `index` = arrival, `weight` now; a withered slot has none). */
export function makeupFromSlots(slots: readonly Pick<SlotState, 'biome' | 'index' | 'weight'>[]): Makeup {
  const weights: Partial<Record<PieceColour, number>> = {};
  const arrival: PieceColour[] = [];
  for (const s of [...slots].sort((a, b) => a.index - b.index)) {
    const c = BIOME_COLOUR[s.biome];
    if (!c) continue;
    weights[c] = (weights[c] ?? 0) + s.weight;
    arrival.push(c);
  }
  return makeupOf(weights, arrival);
}

/**
 * Colours ranked heaviest first; a tie puts a colour in `showing` ahead, then
 * the one that arrived first (its place in the makeup).
 */
export function rankColours(m: Makeup, showing: readonly PieceColour[] | null = null, among: readonly PieceColour[] = m.colours): PieceColour[] {
  const shown = (c: PieceColour) => (showing?.includes(c) ? 0 : 1);
  return [...among].sort((a, b) => (m.weights[b] ?? 0) - (m.weights[a] ?? 0) || shown(a) - shown(b) || m.colours.indexOf(a) - m.colours.indexOf(b));
}

/** Two colours in pair-key order (biome names alphabetical: pairs.ts `pairKey`). */
export const pairKeyOrder = (a: PieceColour, b: PieceColour): [PieceColour, PieceColour] => (COLOUR_BIOME[a] < COLOUR_BIOME[b] ? [a, b] : [b, a]);

/** What was showing before this state: the previous pick, for the tie rules. */
export interface MakeupShowing {
  /** The colours kept (the pair and the element). */
  kept: readonly PieceColour[];
  /** The pair on screen, in either order, or null. */
  pair: readonly PieceColour[] | null;
}

/** {@link pickMakeup}'s answer for one half. */
export interface MakeupPick extends MakeupShowing {
  /** The whole makeup, unfolded. */
  makeup: Makeup;
  /** The kept colours (at most {@link MAX_SHOWN_COLOURS}), ranked for the pair: the heavier pair colour first, the element last. */
  kept: PieceColour[];
  /** Colours past the third: they show nothing and weigh nothing in the pair, the pan or the element's share (their lands still count in `total`, the stage). */
  dropped: PieceColour[];
  /** The pair, in pair-key order, or null with fewer than two colours. */
  pair: [PieceColour, PieceColour] | null;
  /** The heavier pair colour (a tie: the one showing, then the earlier arrival), or the one colour, or null. */
  heavier: PieceColour | null;
  /** The third kept colour (the element), or null. */
  third: PieceColour | null;
  /** The kept colours' own weights (the dropped ones absent). */
  weights: Partial<Record<PieceColour, number>>;
  /** Every coloured land on the half (the makeup's total, dropped colours included): the pair stage counts these. */
  total: number;
  /** The kept colours' own weights together: the element's share of the three is its weight over this. */
  keptTotal: number;
}

/** SYSTEM.md steps 5 and 6 for one half ({@link makeup.ts}'s header). */
export function pickMakeup(m: Makeup, showing: MakeupShowing | null = null): MakeupPick {
  const keptSet = rankColours(m, showing?.kept ?? showing?.pair ?? null).slice(0, MAX_SHOWN_COLOURS);
  const kept = rankColours(m, showing?.pair ?? null, keptSet);
  const dropped = m.colours.filter((c) => !kept.includes(c));
  const weights: Partial<Record<PieceColour, number>> = {};
  for (const c of kept) weights[c] = m.weights[c]!;
  const pair = kept.length >= 2 ? pairKeyOrder(kept[0]!, kept[1]!) : null;
  return { makeup: m, kept, dropped, pair, heavier: kept[0] ?? null, third: kept[2] ?? null, weights, total: m.total, keptTotal: r3(kept.reduce((n, c) => n + weights[c]!, 0)) };
}

/** {@link pickMakeup} on a half's slots (only the live ones weigh: a withered slot has no weight). */
export function pickFromSlots(slots: readonly Pick<SlotState, 'biome' | 'index' | 'weight'>[], showing: MakeupShowing | null = null): MakeupPick {
  return pickMakeup(makeupFromSlots(slots), showing);
}

/** The biomes a pick keeps. */
export function keptBiomes(p: Pick<MakeupPick, 'kept'>): Set<Biome> {
  return new Set(p.kept.map((c) => COLOUR_BIOME[c]));
}

/** The pair's left colour's share of its two weights (pair-key order), clamped 0.2–0.8; 0.5 without a pair. */
export function pickSplit(p: Pick<MakeupPick, 'pair' | 'weights'>): number {
  if (!p.pair) return 0.5;
  const wa = p.weights[p.pair[0]] ?? 0;
  const wb = p.weights[p.pair[1]] ?? 0;
  return wa + wb > 0 ? r3(Math.min(0.8, Math.max(0.2, wa / (wa + wb)))) : 0.5;
}
