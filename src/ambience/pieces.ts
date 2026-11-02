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
 * 5. Three or more: the pair (spec 1.19 b: the pair showing stays while both
 *    its colours are among the three heaviest; else the heaviest pair of the
 *    three, a tie the colours that arrived first) and the third colour's
 *    element, on the heavier pair colour's side, fading in with the third
 *    colour's share; four or five (spec 1.19 a: the fold to three is gone)
 *    draw every further colour as its cut-out too, stacked on the pair's
 *    grounds ({@link stackElements}); they weigh nothing in the pair or the
 *    pan, and the pair stage counts every coloured land. Steps 5 and 6 are
 *    makeup.ts `pickMakeup`, the one rule the strip (layout.ts `foldPanels`)
 *    and the pair picture (pairfull.ts) use too.
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
 * The third colour's element is drawn on the whole-half pair picture (spec
 * 1.15, pairfull.ts, behind `?pairfull=1`): there the third colour is the
 * pair's `element` and `pairFullView` / `pairFullElementRegion` give the
 * region it stands in. Today's board (the flag off) gives a third colour its
 * own panel (layout.ts `halfLayout`); spec 1.19 a puts a fourth and fifth
 * colour's cut-outs on the pair's panels there ({@link panelGround}).
 */
import type { GameStateBody } from '../protocol.ts';
import { hasType, visibleCard } from '../state.ts';
import { halfFrame, halfArtOf, halfSpans, horizonOf, DESKTOP_HORIZON, type FrameRect, type HalfSlotLayout } from './layout.ts';
import { halfAt, MAX_LANDMARKS_SHOWN, PIECE_COLOURS, type PackHalf, type PackPiece, type PackPieces, type PiecePlace, type PieceColour, type ScenePack, type VeilOutcome } from './manifest.ts';
import type { Biome } from './model.ts';
import { pairFullExtrasAllowed, pairFullThirdCutAllowed, type PairFullCandidate, type PairFullItem, type PairFullPair } from './pairfull.ts';
import type { LightOutcome } from './light.ts';
import type { TweenFrame } from './transitions.ts';
import { BIOME_COLOUR, COLOUR_BIOME, elementOpacity, pickMakeup, pickSplit, type Makeup, type MakeupPick, type MakeupShowing } from './makeup.ts';

export { BIOME_COLOUR, COLOUR_BIOME, elementOpacity, makeupFromSlots, makeupOf, pickMakeup, rankColours, type Makeup, type MakeupPick, type MakeupShowing } from './makeup.ts';

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
  /** Spec 1.19 a: the colours past the third, heaviest first, each a cut-out faded by its share ({@link stackElements} places them). */
  extras: { colour: PieceColour; opacity: number }[];
  /** Where the lighter pair colour's ground is (board order), or null without a pair. */
  lighterSide: 'left' | 'right' | null;
  /** Landmark card names to draw, earliest first, at most two. */
  landmarks: string[];
  veil: VeilOutcome | null;
  /** makeup.ts's pick this plan is made from (the strip and the pair picture draw the same one). */
  pick: MakeupPick;
}

export type Front = { colour: PieceColour; reverse: boolean } | { dissolve: true };

/** Step 5's heaviest pair, in pair-key order, or null with fewer than two colours (makeup.ts `pickMakeup`). */
export function heaviestPair(m: Makeup, prev: readonly PieceColour[] | null = null): [PieceColour, PieceColour] | null {
  return pickMakeup(m, prev ? { kept: prev, pair: prev } : null).pair;
}

/** The pair stage from the half's coloured lands (SYSTEM.md A4: 1–2 → 1, 3–4 → 2, 5+ → 3). */
export function pairStageOf(total: number): number {
  if (!(total > 0)) return 0;
  return total >= 5 - 1e-9 ? 3 : total >= 3 - 1e-9 ? 2 : 1;
}

/** The biomes a pack's pieces have an element for (pairfull.ts `pairFullPlan`'s `elements`), or null with none. */
export function elementBiomes(pieces: Pick<PackPieces, 'elements'> | null | undefined): ReadonlySet<Biome> | null {
  const out = new Set<Biome>();
  for (const c of PIECE_COLOURS) if (pieces?.elements[c]) out.add(COLOUR_BIOME[c]);
  return out.size ? out : null;
}

/**
 * Spec 1.18.1: the biomes whose element has a `phone` picture (pairfull.ts `pairFullPlan`'s `phoneElements`), or
 * null with none. A phone-width screen draws one of these on a seam cell whose painted picture of the colour has no
 * phone picture; an element with no phone piece draws nothing there.
 */
export function phoneElementBiomes(pieces: Pick<PackPieces, 'elements'> | null | undefined): ReadonlySet<Biome> | null {
  const out = new Set<Biome>();
  for (const c of PIECE_COLOURS) if (pieces?.elements[c]?.phone) out.add(COLOUR_BIOME[c]);
  return out.size ? out : null;
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
  /**
   * What was showing before this state, for the tie rules (makeup.ts
   * `MakeupShowing`: SceneryLayer's previous pick, the same one the strip
   * gets). `prevPair` is the older form: the pair alone.
   */
  showing?: MakeupShowing | null;
  prevPair?: readonly PieceColour[] | null;
}

/** Steps 2–7 for one half; steps 5–6 are makeup.ts `pickMakeup`, the rule the strip and the pair picture use too. */
export function planHalf(i: PlanInput): HalfPlan {
  const m = i.makeup;
  const pick = pickMakeup(m, i.showing ?? (i.prevPair ? { kept: i.prevPair, pair: i.prevPair } : null));
  const pair = pick.pair;
  const split = pickSplit(pick);
  let mirror = false;
  let element: HalfPlan['element'] = null;
  let lighterSide: HalfPlan['lighterSide'] = null;
  if (pair) {
    const [a, b] = pair;
    // The half met b first: the board's order is the key's reversed.
    mirror = m.colours.indexOf(b) < m.colours.indexOf(a);
    const keyLeft = pick.heavier === a;
    const heavierSide = keyLeft !== mirror ? 'left' : 'right';
    lighterSide = heavierSide === 'left' ? 'right' : 'left';
    const third = pick.third;
    // Spec 1.19 a: an equal share of the half's colours is fully in; less fades it (three colours: an equal third).
    if (third) element = { colour: third, opacity: elementOpacity(pick, third), side: heavierSide };
  }
  const extras = pick.extras.map((colour) => ({ colour, opacity: elementOpacity(pick, colour) }));
  const known = new Set(i.landmarks ?? []);
  const landmarks: string[] = [];
  for (const n of i.landNames ?? []) {
    if (landmarks.length >= MAX_LANDMARKS_SHOWN) break;
    if (known.has(n) && !landmarks.includes(n)) landmarks.push(n);
  }
  const veil: VeilOutcome | null = i.outcome === 'won' || i.outcome === 'lost' ? i.outcome : null;
  return { makeup: m, empty: m.colours.length === 0, pair, split, mirror, pairStage: pair ? pairStageOf(pick.total) : 0, element, extras, lighterSide, landmarks, veil, pick };
}

/** The colours the picture is made of: the pair (or the one colour), the element's colour and (spec 1.19 a) every further colour's cut-out. */
function shown(p: HalfPlan): PieceColour[] {
  const out: PieceColour[] = p.pair ? [...p.pair] : p.makeup.colours.slice(0, 1);
  if (p.element) out.push(p.element.colour);
  for (const x of p.extras ?? []) out.push(x.colour);
  return out;
}

// ---------------------------------------------------------------------------
// Spec 1.19 a: every colour visible -- the elements stacked on the pair's grounds

/** How many elements the heavier pair colour's ground holds before the next goes on the lighter's. */
export const HEAVIER_GROUND_HOLDS = 2;

/** One element on one of the pair's grounds (spec 1.19 a). */
export interface StackedElement {
  colour: PieceColour;
  opacity: number;
  /** A cut-out to draw (false: the third colour painted into the picture, which only keeps its place in the stack). */
  cut: boolean;
  /** Whose ground: the heavier pair colour's or the lighter's, and which side of the half that is (board order). */
  ground: 'heavier' | 'lighter';
  side: 'left' | 'right';
  /** Its place on that ground, 0 at the half's outer edge, of `of` there. */
  slot: number;
  of: number;
}

/**
 * Spec 1.19 a: the elements a half stands on its pair's grounds, in weight order -- the third colour (when it is on a
 * ground: `third` says how, `'painted'` keeping its place, `'cut'` a cut-out; `null` when it has a panel of its own, the
 * board without the flag or 1.15's placeholder), then every further colour that `cuttable` says has a cut-out at this
 * shape. The heavier pair colour's ground takes the first {@link HEAVIER_GROUND_HOLDS}, the lighter's the rest; each
 * ground's elements stand side by side ({@link stackRegion}), the heaviest at the half's outer edge. Faded by each
 * colour's share (makeup.ts `elementOpacity`). Empty without a pair.
 */
export function stackElements(plan: Pick<HalfPlan, 'pair' | 'element' | 'extras' | 'lighterSide'>, third: 'painted' | 'cut' | null, cuttable: (c: PieceColour) => boolean): StackedElement[] {
  if (!plan.pair || !plan.lighterSide) return [];
  const heavierSide: 'left' | 'right' = plan.lighterSide === 'left' ? 'right' : 'left';
  const list: { colour: PieceColour; opacity: number; cut: boolean }[] = [];
  if (plan.element && third) list.push({ colour: plan.element.colour, opacity: plan.element.opacity, cut: third === 'cut' });
  for (const x of plan.extras) if (cuttable(x.colour)) list.push({ ...x, cut: true });
  const heavy = list.slice(0, HEAVIER_GROUND_HOLDS);
  const light = list.slice(HEAVIER_GROUND_HOLDS);
  return [
    ...heavy.map((x, slot) => ({ ...x, ground: 'heavier' as const, side: heavierSide, slot, of: heavy.length })),
    ...light.map((x, slot) => ({ ...x, ground: 'lighter' as const, side: plan.lighterSide!, slot, of: light.length })),
  ];
}

/** Spec 1.19 a: an element's share of its ground's region: the region split in `of` side by side, slot 0 at the half's outer edge. */
export function stackRegion(ground: Region, e: Pick<StackedElement, 'side' | 'slot' | 'of'>): Region {
  const r = (n: number) => Math.round(n * 10000) / 10000;
  const w = ground.width / Math.max(1, e.of);
  const left = e.side === 'left' ? ground.left + e.slot * w : ground.left + ground.width - (e.slot + 1) * w;
  return { left: r(left), width: r(w) };
}

/**
 * Spec 1.19 a on the board without the flag: a biome's panel as an element's ground -- its span across the half as
 * the row lays it out (layout.ts `halfSpans`, the seams overlapping), less the seam (`seamRatio` of the half, where
 * the mist, a band or a motif is) at each edge it shares with another panel. Null when the half has no such panel.
 */
export function panelGround(layout: readonly HalfSlotLayout[], biome: Biome, seamRatio: number): Region | null {
  const i = layout.findIndex((l) => l.slot.biome === biome);
  if (i < 0) return null;
  const W = 10000;
  const spans = halfSpans([...layout], W, seamRatio);
  const total = spans.length ? spans[spans.length - 1]!.left + spans[spans.length - 1]!.width : W;
  const s = spans[i]!;
  const inset = seamRatio * total;
  const left = s.left + (i > 0 ? inset : 0);
  const right = s.left + s.width - (i < layout.length - 1 ? inset : 0);
  const r = (n: number) => Math.round(n * 10000) / 10000;
  return { left: r(left / total), width: r(Math.max(0, right - left) / total) };
}

/** One cut-out a half draws (spec 1.19 a): its place in the stack, and the picture at the half's shape. */
export interface HalfCutOut extends StackedElement {
  /** The picture to draw (null for the third colour painted into the picture: it only keeps its place). */
  picture: { src: string; src2x: string | null; width: number; height: number } | null;
  place: PiecePlace;
}

/**
 * Spec 1.19 a: every element a half stands on its pair's grounds, as ScenePieces draws them and the storyboard walk
 * counts them -- one rule for both. `full` is the flag's plan when the strip draws it (pairfull.ts `pairFullPlan`;
 * null: the half's panels -- the board without the flag, or the flag's load gate falling back to them) and `choice`
 * its load gate (`pairFullChoice`). On a pair picture: the third colour painted in (its place kept), cut out (the
 * plan's `element`, once `pairFullThirdCutAllowed`), or a panel of its own (not on a ground); then the plan's
 * `extras`, while `pairFullExtrasAllowed`. On the panels: the third has its panel, and every further colour is a
 * cut-out on the pair's panels. A colour with no picture at this shape ({@link cutOutPicture}) is left out.
 */
export function halfCutOuts(i: {
  plan: HalfPlan;
  pieces: Pick<PackPieces, 'elements'> | null;
  phone: boolean;
  narrow: boolean;
  full: readonly PairFullItem[] | null;
  choice: { show: PairFullCandidate | null; want: PairFullCandidate | null } | null;
}): HalfCutOut[] {
  const { plan, pieces, phone, narrow } = i;
  if (!pieces || !plan.pair) return [];
  const p = i.full?.find((x): x is PairFullPair => x.kind === 'pair') ?? null;
  const onPicture = !!p && (!!p.apart || !!i.choice?.show);
  // The flag's plan with nothing of it loaded yet (the strip holds what it drew, or its panels): no cut-out until it is.
  if (p && (!onPicture || !pairFullExtrasAllowed(p, i.choice))) return [];
  const third = plan.element?.colour ?? null;
  // The third colour on a stage picture keeps 1.14's phone-else-desktop piece; every other cut-out, 1.18.1's phone piece.
  const loose = (c: PieceColour) => !!p && c === third && !p.grid && !p.apart;
  const pic = (c: PieceColour) => cutOutPicture(pieces.elements[c], phone, narrow, loose(c));
  let thirdMode: 'painted' | 'cut' | null = null;
  if (onPicture && p && third) {
    const panel = i.full!.some((x) => x.kind === 'slot' && x.biome === COLOUR_BIOME[third]);
    const paintedNow = !!p.grid?.painted || !!i.choice?.show?.painted || !!i.choice?.want?.painted;
    if (panel) thirdMode = null;
    else if (p.element === COLOUR_BIOME[third] && pairFullThirdCutAllowed(p, i.choice) && pic(third)) thirdMode = 'cut';
    else if (paintedNow) thirdMode = 'painted';
  }
  const extras = onPicture ? new Set((p!.extras ?? []).map((b) => BIOME_COLOUR[b])) : null;
  const stack = stackElements(plan, thirdMode, (c) => (extras ? extras.has(c) : true) && !!pic(c));
  return stack.map((e) => ({ ...e, picture: e.cut ? pic(e.colour) : null, place: pieces.elements[e.colour]!.place }));
}

/**
 * Spec 1.19 a: the picture a cut-out draws at the half's shape, or null: on a phone-width screen (`narrow`) only its
 * `phone` piece (1.18.1's rule, for every cut-out but the 1.14 third on a stage picture, `loose`, which keeps 1.14's
 * phone-else-desktop); on a phone-shaped half its phone piece where it has one; else the desktop piece.
 */
export function cutOutPicture(piece: PackPiece | undefined, phone: boolean, narrow: boolean, loose = false): { src: string; src2x: string | null; width: number; height: number } | null {
  if (!piece) return null;
  if (narrow && !loose) return piece.phone ?? null;
  return phone && piece.phone ? piece.phone : piece;
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
// Fronts and the pieces' shape (review fault 3)

/**
 * Does a half of `box` px take its pieces' phone pictures (a front's frames,
 * a landmark's, a veil's, the empty table's)? On a phone-width screen always
 * (layout.ts `PHONE_VIEWPORT_MAX`), else when the half is nearer the phone's
 * 4 : 5 than the desktop's 16 : 5 on a log scale ({@link PIECES_PHONE_BELOW},
 * layout.ts `pickHalfPicture`'s rule). The ONE rule: ScenePieces both warms
 * ({@link pieceUrls}) and picks with it, from the half it measures -- before,
 * warming read `innerWidth` and picking the box, so a tall desktop half warmed
 * the desktop frames, picked the phone ones, and never played a front.
 */
export function piecesPhone(box: { w: number; h: number }, narrow: boolean): boolean {
  return narrow || (box.w > 0 && box.h > 0 && box.w / box.h < PIECES_PHONE_BELOW);
}

/** The geometric middle of 16 : 5 and 4 : 5 (√(3.2 × 0.8)): a half narrower than this is phone-shaped. */
export const PIECES_PHONE_BELOW = 1.6;

/** A front's frames at a shape, in play order (backwards when the colour leaves), or null (no front, the dissolve, no frames for the colour). */
export function frontFrameList(pieces: Pick<PackPieces, 'fronts'>, front: Front | null, phone: boolean): { frames: TweenFrame[]; fadeMs: number } | null {
  if (!front || 'dissolve' in front) return null;
  const f = pieces.fronts[front.colour];
  if (!f || !f.frames.length) return null;
  const frames = f.frames.map((x) => ({ src: phone && x.phone ? x.phone : x.src, holdMs: x.holdMs }));
  return { frames: front.reverse ? frames.reverse() : frames, fadeMs: f.fadeMs };
}

/**
 * The element pictures worth warming for a half (review fault 4: elements
 * were never warmed, so one popped in after its fade): with three or more
 * colours, each colour's element at the half's shape ({@link piecesPhone}),
 * whichever of them the plan will make the element.
 */
export function elementUrls(pieces: Pick<PackPieces, 'elements'>, colours: readonly PieceColour[], phone: boolean): { src: string; src2x: string | null }[] {
  if (colours.length < 3) return [];
  const out: { src: string; src2x: string | null }[] = [];
  for (const c of colours) {
    const piece = pieces.elements[c];
    if (!piece) continue;
    const pic = phone && piece.phone ? piece.phone : piece;
    out.push({ src: pic.src, src2x: pic.src2x });
  }
  return out;
}

/**
 * The veil a half draws (review fault 10): the plan's, else -- on a replay
 * scrub back past the game's end -- the one it drew last, `leaving` (faded
 * out, then dropped by ScenePieces once the fade is over).
 */
export function veilState(now: VeilOutcome | null, last: VeilOutcome | null): { veil: VeilOutcome; leaving: boolean } | null {
  if (now) return { veil: now, leaving: false };
  return last ? { veil: last, leaving: true } : null;
}

/** How long a front may wait for its frames to decode before it is skipped: later than this, the change it marks is old news. */
export const FRONT_WAIT_MS = 4000;

/**
 * Which front plays (review fault 3: a front played only if every frame was
 * decoded at the very render of the change, so on a cold cache the first
 * front of a colour never played). Each change of plan is a generation with
 * its front; the front starts as soon as its frames are all decoded -- at
 * once if they already are, else when the last arrives -- unless a newer
 * change came first or {@link FRONT_WAIT_MS} passed; each generation plays
 * at most once. {@link token} is what useTween keys on: it moves only when a
 * front starts. The front a token started is remembered with it, so a newer
 * change while it plays neither restarts it nor drops its fade (the review
 * of #198: useTween re-runs when its frames or fade change, and both went
 * null with the generation); only a newer front that starts replaces it.
 */
export class FrontGate {
  private gen = 0;
  private at = 0;
  private front: Front | null = null;
  private played = 0;
  private playedFront: Front | null = null;
  /** A new plan whose change plays `front` (null: none), seen at `now` (ms). */
  change(front: Front | null, now: number): void {
    this.gen++;
    this.front = front;
    this.at = now;
  }
  /** The front waiting to start, or null (none, started, superseded or timed out at `now`). */
  waiting(now: number): Front | null {
    return this.front && this.played < this.gen && now - this.at <= FRONT_WAIT_MS ? this.front : null;
  }
  /** Asked on every render: start the waiting front if its frames are all decoded (`ready`), and return the newest started generation. */
  token(ready: boolean, now: number): number {
    if (ready && this.waiting(now)) {
      this.played = this.gen;
      this.playedFront = this.front;
    }
    return this.played;
  }
  /** The front a token started (it keeps it through later changes), or null for a token that started none. */
  frontOf(token: number): Front | null {
    return token > 0 && token === this.played ? this.playedFront : null;
  }
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
