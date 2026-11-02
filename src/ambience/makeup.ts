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
 * 5. The pair is the base (spec 1.19 b, the owner's rule of 2026-11-02): the
 *    pair showing STAYS while both its colours are among the three heaviest
 *    by weight (fewer than three colours strictly outweigh each), whatever
 *    else grows; it changes only when one of its colours leaves the top
 *    three, and then the heaviest pair among the top three (a tie: a colour
 *    of the pair showing, then the earlier arrivals). With nothing showing,
 *    the two heaviest. Before 1.19 every land re-chose the heaviest pair, so
 *    a second Mountain beside an Island and a Swamp redrew the whole half
 *    (the storyboard of 2026-11-02, gap 3). The pan uses the pair's own two
 *    weights. The third colour (the heaviest other one; a tie: the one
 *    showing, then the earlier arrival) is the element, painted in or cut
 *    out; it may outweigh the pair now.
 * 6. Every colour is shown (spec 1.19 a: the fold to three is gone): the
 *    pair and the third are the {@link MakeupPick.kept} colours (a panel or
 *    the pair picture and its element), and every further colour, the
 *    {@link MakeupPick.extras}, draws as its 1.14 cut-out element (pieces.ts
 *    `stackElements`). The extras weigh nothing in the pair, the pan or a
 *    panel's width. The stage counts EVERY coloured land on the half (A5:
 *    "a growing third colour still grows the place"; A1: a land's weight is
 *    the same in every row, so the half's total is its number of coloured
 *    lands).
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
import { SceneryTracker, type Biome, type Scenery, type SceneryObserver, type SceneryOptions, type SlotState } from './model.ts';
import type { GameLog } from '../log.ts';

export const BIOME_COLOUR: Partial<Record<Biome, PieceColour>> = { plains: 'W', island: 'U', swamp: 'B', mountain: 'R', forest: 'G' };
export const COLOUR_BIOME: Record<PieceColour, Biome> = { W: 'plains', U: 'island', B: 'swamp', R: 'mountain', G: 'forest' };

/** The colours a half keeps as its picture: the pair and the third (a panel, or the element painted in or cut out); spec 1.19 a draws the rest as cut-outs. */
export const MAX_KEPT_COLOURS = 3;

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
  /** The kept colours (at most {@link MAX_KEPT_COLOURS}), ranked for the pair: the heavier pair colour first, the element last. */
  kept: PieceColour[];
  /**
   * Spec 1.19 a: the colours past the third, heaviest first (a tie: the earlier arrival). Each draws as its 1.14
   * cut-out element (pieces.ts `stackElements`); they weigh nothing in the pair, the pan or a panel (their lands count
   * in `total`, the stage, and their own share fades their cut-out). Until 1.19 they were dropped and showed nothing.
   */
  extras: PieceColour[];
  /** The pair, in pair-key order, or null with fewer than two colours. */
  pair: [PieceColour, PieceColour] | null;
  /** The heavier pair colour (a tie: the one showing, then the earlier arrival), or the one colour, or null. */
  heavier: PieceColour | null;
  /** The third kept colour (the element), or null. */
  third: PieceColour | null;
  /** Every colour's own weight (the makeup's). */
  weights: Partial<Record<PieceColour, number>>;
  /** Every coloured land on the half (the makeup's total, dropped colours included): the pair stage counts these. */
  total: number;
  /** The kept colours' own weights together: the element's share of the three is its weight over this. */
  keptTotal: number;
}

const EPS = 1e-9;

/** Spec 1.19 b: is `c` among the three heaviest colours (fewer than three colours strictly outweigh it)? */
function inTopThree(m: Makeup, c: PieceColour): boolean {
  const w = m.weights[c] ?? 0;
  return w > EPS && m.colours.filter((x) => (m.weights[x] ?? 0) > w + EPS).length < MAX_KEPT_COLOURS;
}

/** SYSTEM.md steps 5 and 6 for one half, as spec 1.19 a and b amend them ({@link makeup.ts}'s header). */
export function pickMakeup(m: Makeup, showing: MakeupShowing | null = null): MakeupPick {
  const prev = showing?.pair && showing.pair.length === 2 ? showing.pair : null;
  let pairCols: PieceColour[];
  if (prev && prev.every((c) => inTopThree(m, c))) {
    // Rule b: the pair showing is the base while both its colours stay among the three heaviest.
    pairCols = rankColours(m, prev, prev);
  } else {
    // A colour of the pair left the top three (or none showed): the heaviest pair among the top three.
    const top = rankColours(m, showing?.kept ?? showing?.pair ?? null).slice(0, MAX_KEPT_COLOURS);
    pairCols = rankColours(m, showing?.pair ?? null, top).slice(0, 2);
  }
  // The rest, heaviest first; a tie keeps the colour already showing (the third), then the earlier arrival.
  const rest = rankColours(m, showing?.kept ?? null, m.colours.filter((c) => !pairCols.includes(c)));
  const kept = pairCols.length === 2 ? [...pairCols, ...rest.slice(0, 1)] : pairCols;
  const extras = pairCols.length === 2 ? rest.slice(1) : [];
  const weights: Partial<Record<PieceColour, number>> = { ...m.weights };
  const pair = kept.length >= 2 ? pairKeyOrder(kept[0]!, kept[1]!) : null;
  return { makeup: m, kept, extras, pair, heavier: kept[0] ?? null, third: kept[2] ?? null, weights, total: m.total, keptTotal: r3(kept.reduce((n, c) => n + weights[c]!, 0)) };
}

/**
 * Spec 1.19 a: how faded a colour's element is, by its share of the half: n × its weight over every coloured land,
 * at most 1, with n the colours on the half -- an equal share is fully in. With three colours this is 1.14's rule (an
 * equal third fully in); a one-land fifth colour beside four three-land ones is at 5 / 13.
 */
export function elementOpacity(p: Pick<MakeupPick, 'makeup' | 'weights' | 'total'>, c: PieceColour): number {
  const n = p.makeup.colours.length;
  return p.total > 0 ? r3(Math.min(1, Math.max(0, (n * (p.weights[c] ?? 0)) / p.total))) : 0;
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

/**
 * What each half showed last, for the tie rules (`showing`), folded over the
 * game's state frames in order (a {@link SceneryObserver} on model.ts's
 * `SceneryTracker`): a player's pick at a frame is `pickMakeup` of that
 * frame's slots given the pick at the previous state frame. So it is the same
 * whether the board stepped there or a replay scrubbed there (the tracker
 * starts over on a jump back and folds again), it starts empty on a new log
 * (Reset, New Game), and a half with no coloured land forgets (the review of
 * #198, LOW 4: SceneryLayer kept the previous pick of whatever it had last
 * rendered). A player's pick object changes only when its kept colours, its
 * pair or its extras do, so a memoised strip is not re-rendered for nothing.
 */
export class MakeupMemory implements SceneryObserver {
  private picks = new Map<number, MakeupPick>();
  reset(): void {
    this.picks.clear();
  }
  step(s: Scenery): void {
    for (const p of s.players) {
      const prev = this.picks.get(p.playerId) ?? null;
      const pick = pickFromSlots(p.slots, prev);
      if (!pick.kept.length) this.picks.delete(p.playerId);
      else if (!prev || prev.kept.join() !== pick.kept.join() || prev.pair?.join() !== pick.pair?.join() || prev.extras.join() !== pick.extras.join()) this.picks.set(p.playerId, pick);
    }
  }
  /** The pick a player's half shows at the tracker's frame, or null (no coloured land yet). */
  showing(playerId: number): MakeupPick | null {
    return this.picks.get(playerId) ?? null;
  }
}

/**
 * model.ts `sceneryFromLog` with a {@link MakeupMemory} folded over the same
 * state frames: the scenery at `frameIndex` and what each half shows there
 * (`memory.showing(playerId)`, the tie rules' "already showing"), as
 * SceneryLayer has them for the board. For a page that rebuilds its log on
 * every play (`#ambience`, sim.ts `simLog`): before this, the preview drew
 * every half with no `showing`, so a tie went back to the earlier-arrived
 * colours (I S M M I S drew island+swamp again at the sixth land, where the
 * board keeps island+mountain; the storyboard of 2026-11-02, sheets 5 and 7).
 */
export function sceneryWithShowing(log: GameLog, frameIndex: number, opts: SceneryOptions = {}): { scenery: Scenery; memory: MakeupMemory } {
  const memory = new MakeupMemory();
  const tracker = new SceneryTracker(opts);
  tracker.observe(memory);
  return { scenery: tracker.at(log, frameIndex), memory };
}
