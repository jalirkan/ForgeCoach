/*
 * ForgeCoach — ambience/pieces.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.14's pieces, decided for one player's half (pc-results
 * scenery/SYSTEM.md, section A, steps 1–8, Justin's system of 2026-10-22):
 * what a half shows over (or instead of) its land pictures. Pure and DOM-free;
 * ui/ambience/ScenePieces.tsx draws it.
 *
 * 1. The makeup: each colour's land weight (model.ts's rules, unchanged: a
 *    dual ½ / ½, a Triome ⅓ each, a fetch nothing) in the order it arrived.
 * 2. No colour: the empty table (B8).
 * 3. One colour: its mono picture (the board's own slots).
 * 4. Two: the pair (`split` = the first colour of the pair key's share,
 *    clamped 0.2–0.8; `mirror` when the half met them the other way round;
 *    the pair stage by the half's whole weight: 1–2 lands 1, 3–4 2, 5+ 3).
 * 5. Three or more: the heaviest pair (a tie keeps the pair on screen, then
 *    the colours that arrived first) and the third colour's element, on the
 *    heavier pair colour's side, fading in with the third colour's share;
 *    four or five fold to the three heaviest, one element at a time.
 * 6. Landmarks (B6): a land whose exact name the pack has a landmark for, one
 *    per name, at most two, the earliest on the battlefield.
 * 7. The veil (B9) once the game is over: won or lost (a draw: none).
 * 8. Fronts (B7): a new makeup plays the arriving colour's front (a colour
 *    leaving plays its front backwards; a new heaviest pair, the colour that
 *    joined it); the empty table's first colour dissolves the mist instead.
 *
 * Only the viewing seat's redacted battlefield is read (model.ts
 * `visibleCard`: a hidden or face-down card is never a landmark).
 *
 * Today's board gives a third colour its own panel (layout.ts `halfLayout`),
 * so the element is planned but not drawn: it belongs to the whole-half pair
 * picture (spec 1.15, pairfull.ts, behind `?pairfull=1`), whose
 * `pairFullView` / `pairFullElementRegion` give the region it stands in.
 */
import type { GameStateBody } from '../protocol.ts';
import { hasType, visibleCard } from '../state.ts';
import { halfFrame, halfArtOf, horizonOf, DESKTOP_HORIZON, type FrameRect, type HalfSlotLayout } from './layout.ts';
import { halfAt, MAX_LANDMARKS_SHOWN, PIECE_COLOURS, type PackHalf, type PiecePlace, type PieceColour, type ScenePack, type VeilOutcome } from './manifest.ts';
import type { Biome, SlotState } from './model.ts';
import type { LightOutcome } from './light.ts';

export const BIOME_COLOUR: Partial<Record<Biome, PieceColour>> = { plains: 'W', island: 'U', swamp: 'B', mountain: 'R', forest: 'G' };
export const COLOUR_BIOME: Record<PieceColour, Biome> = { W: 'plains', U: 'island', B: 'swamp', R: 'mountain', G: 'forest' };

/** The colours a half's lands make, heaviest first is not implied: in the order they arrived. */
export interface Makeup {
  /** Colours with weight above zero, in arrival order. */
  colours: PieceColour[];
  weights: Partial<Record<PieceColour, number>>;
  /** Every coloured land's weight together (= the number of coloured lands). */
  total: number;
}

/** One half's plan. */
export interface HalfPlan {
  makeup: Makeup;
  /** No colour yet: the empty table. */
  empty: boolean;
  /** The pair on screen, in pair-key order (biome names alphabetical), or null with fewer than two colours. */
  pair: [PieceColour, PieceColour] | null;
  /** The pair key's first colour's share of the pair, 0.2–0.8. */
  split: number;
  /** The half met the pair the other way round from its key. */
  mirror: boolean;
  /** The pair stage, 1–3 (0 without a pair). */
  pairStage: number;
  /** The third colour's element, or null. `side` is where the heavier pair colour's ground is. */
  element: { colour: PieceColour; opacity: number; side: 'left' | 'right' } | null;
  /** Landmark card names to draw, earliest first, at most two. */
  landmarks: string[];
  veil: VeilOutcome | null;
}

export type Front = { colour: PieceColour; reverse: boolean } | { dissolve: true };

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Step 1: a half's makeup from its weights and arrival order (colours missing from `arrival` go last, in WUBRG order). */
export function makeupOf(weights: Partial<Record<PieceColour, number>>, arrival: readonly PieceColour[]): Makeup {
  const order = [...arrival.filter((c, i) => arrival.indexOf(c) === i), ...PIECE_COLOURS.filter((c) => !arrival.includes(c))];
  const colours = order.filter((c) => (weights[c] ?? 0) > 1e-9);
  const w: Partial<Record<PieceColour, number>> = {};
  for (const c of colours) w[c] = r3(weights[c]!);
  return { colours, weights: w, total: r3(colours.reduce((n, c) => n + w[c]!, 0)) };
}

/** A half's makeup from its scenery slots (model.ts: a slot per biome, `index` = arrival, `weight` now). */
export function makeupFromSlots(slots: readonly SlotState[]): Makeup {
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

const pairKeyOrder = (a: PieceColour, b: PieceColour): [PieceColour, PieceColour] => (COLOUR_BIOME[a] < COLOUR_BIOME[b] ? [a, b] : [b, a]);

/**
 * The colours ranked for the picture: heaviest first; a tie keeps a colour of
 * the pair on screen (`prev`) ahead, then the one that arrived first.
 */
export function rankColours(m: Makeup, prev: readonly PieceColour[] | null = null): PieceColour[] {
  const showing = (c: PieceColour) => (prev?.includes(c) ? 0 : 1);
  return [...m.colours].sort((a, b) => m.weights[b]! - m.weights[a]! || showing(a) - showing(b) || m.colours.indexOf(a) - m.colours.indexOf(b));
}

/** Step 5's heaviest pair, in pair-key order, or null with fewer than two colours. */
export function heaviestPair(m: Makeup, prev: readonly PieceColour[] | null = null): [PieceColour, PieceColour] | null {
  const r = rankColours(m, prev);
  return r.length >= 2 ? pairKeyOrder(r[0]!, r[1]!) : null;
}

/** The pair stage from the half's coloured lands (SYSTEM.md A4: 1–2 → 1, 3–4 → 2, 5+ → 3). */
export function pairStageOf(total: number): number {
  if (!(total > 0)) return 0;
  return total >= 5 - 1e-9 ? 3 : total >= 3 - 1e-9 ? 2 : 1;
}

/** Visible lands on a player's battlefield, by name, in the battlefield's order (the engine's: earliest first). */
export function landNamesOf(state: GameStateBody | null, playerId: number): string[] {
  const p = state?.players.find((x) => x.id === playerId);
  const out: string[] = [];
  for (const card of p?.zones.battlefield?.cards ?? []) {
    const c = visibleCard(card);
    if (c && !c.faceDown && hasType(c, 'Land')) out.push(c.name);
  }
  return out;
}

export interface PlanInput {
  makeup: Makeup;
  /** The half's visible land names, earliest first ({@link landNamesOf}). */
  landNames?: readonly string[];
  /** The names the pack has landmarks for. */
  landmarks?: Iterable<string>;
  outcome?: LightOutcome;
  /** The pair on screen before this state, for the tie rule. */
  prevPair?: readonly PieceColour[] | null;
}

/** Steps 2–7 for one half. */
export function planHalf(i: PlanInput): HalfPlan {
  const m = i.makeup;
  const ranked = rankColours(m, i.prevPair ?? null);
  const pair = ranked.length >= 2 ? pairKeyOrder(ranked[0]!, ranked[1]!) : null;
  let split = 0.5;
  let mirror = false;
  let element: HalfPlan['element'] = null;
  if (pair) {
    const [a, b] = pair;
    const wa = m.weights[a]!;
    const wb = m.weights[b]!;
    split = r3(Math.min(0.8, Math.max(0.2, wa / (wa + wb))));
    // The half met b first: the board's order is the key's reversed.
    mirror = m.colours.indexOf(b) < m.colours.indexOf(a);
    const third = ranked[2];
    if (third) {
      const three = ranked.slice(0, 3).reduce((n, c) => n + m.weights[c]!, 0);
      // An equal third (⅓ of the three) is fully in; less fades it.
      const opacity = r3(Math.min(1, Math.max(0, (3 * m.weights[third]!) / three)));
      const heavier = ranked[0]!;
      const keyLeft = heavier === a;
      element = { colour: third, opacity, side: keyLeft !== mirror ? 'left' : 'right' };
    }
  }
  const known = new Set(i.landmarks ?? []);
  const landmarks: string[] = [];
  for (const n of i.landNames ?? []) {
    if (landmarks.length >= MAX_LANDMARKS_SHOWN) break;
    if (known.has(n) && !landmarks.includes(n)) landmarks.push(n);
  }
  const veil: VeilOutcome | null = i.outcome === 'won' || i.outcome === 'lost' ? i.outcome : null;
  return { makeup: m, empty: m.colours.length === 0, pair, split, mirror, pairStage: pair ? pairStageOf(m.total) : 0, element, landmarks, veil };
}

/** The colours the picture is made of: the pair (or the one colour) and the element's colour. */
function shown(p: HalfPlan): PieceColour[] {
  const out: PieceColour[] = p.pair ? [...p.pair] : p.makeup.colours.slice(0, 1);
  if (p.element) out.push(p.element.colour);
  return out;
}

/**
 * Step 8: the front a change of plan plays, or null (the same makeup: a stage
 * step is the stage frames' work). The empty table's first colour dissolves
 * the mist; a colour arriving plays its front, one leaving its front
 * backwards; a new heaviest pair plays the colour that joined it.
 */
export function frontFor(prev: HalfPlan | null, next: HalfPlan): Front | null {
  if (!prev) return null;
  if (prev.empty && !next.empty) return { dissolve: true };
  const was = shown(prev);
  const now = shown(next);
  const arrived = next.makeup.colours.find((c) => !prev.makeup.colours.includes(c) && now.includes(c));
  if (arrived) return { colour: arrived, reverse: false };
  const left = prev.makeup.colours.find((c) => !next.makeup.colours.includes(c) && was.includes(c));
  if (left) return { colour: left, reverse: true };
  const samePair = (prev.pair?.join() ?? '') === (next.pair?.join() ?? '');
  if (!samePair && next.pair) {
    const joined = next.pair.find((c) => !prev.pair?.includes(c));
    if (joined) return { colour: joined, reverse: false };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Placement

/** A region of the half, as fractions of its width. */
export interface Region {
  left: number;
  width: number;
}

export const WHOLE: Region = { left: 0, width: 1 };

/**
 * Where a piece of `aspect` (width / height) goes in a half of `box` pixels,
 * as fractions of the half: `fill` covers the region (centred), `horizon` and
 * `ground` stand its foot on `horizonY` (a fraction of the half's height) or
 * on the bottom, raised by `lift`.
 */
export function piecePlacement(place: PiecePlace, aspect: number, region: Region, box: { w: number; h: number }, horizonY: number): FrameRect {
  const r = (n: number) => Math.round(n * 10000) / 10000;
  if (!(box.w > 0 && box.h > 0 && aspect > 0)) return { left: region.left, top: 0, width: region.width, height: 1 };
  if (place.sit === 'fill') {
    let width = region.width;
    let height = (width * box.w) / aspect / box.h;
    if (height < 1) {
      height = 1;
      width = (aspect * box.h) / box.w;
    }
    return { left: r(region.left + region.width / 2 - width / 2), top: r((1 - height) / 2), width: r(width), height: r(height) };
  }
  const width = place.w * region.width;
  const height = (width * box.w) / aspect / box.h;
  const foot = (place.sit === 'horizon' ? horizonY : 1) - place.lift;
  return { left: r(region.left + place.x * region.width - width / 2), top: r(foot - height), width: r(width), height: r(height) };
}

/**
 * Where the horizon is drawn at `x` (a fraction of the half's width), as a
 * fraction of the half's height: the panel under `x` (shares side by side),
 * its stage's half picture as SceneryStrip crops it (layout.ts `halfFrame`,
 * one horizon included), and that picture's declared or estimated horizon.
 * A half with no panel uses the empty table's picture, else the desktop
 * default.
 */
export function horizonAt(pack: ScenePack | null, layout: readonly HalfSlotLayout[], x: number, box: { w: number; h: number }, opts: { narrow?: boolean; horizon?: boolean; empty?: PackHalf | null } = {}): number {
  const live = layout.filter((l) => l.share > 0);
  const sum = live.reduce((n, l) => n + l.share, 0);
  let picked: { half: PackHalf | null; width: number } | null = null;
  if (sum > 0) {
    let at = 0;
    for (const l of live) {
      const w = l.share / sum;
      picked = { half: halfAt(pack?.biomes[l.slot.biome], Math.max(1, l.stage)), width: w };
      if (x <= at + w + 1e-9) break;
      at += w;
    }
  } else if (opts.empty) picked = { half: opts.empty, width: 1 };
  if (!picked || !(box.w > 0 && box.h > 0)) return DESKTOP_HORIZON;
  const pw = picked.width * box.w;
  const art = halfArtOf(picked.half, pw / box.h, { narrow: opts.narrow, horizon: opts.horizon });
  const f = halfFrame({ w: pw, h: box.h }, art);
  const hz = art.picture ? horizonOf(art.picture) : art.focal.y;
  return Math.round((f.top + hz * f.height) * 10000) / 10000;
}
