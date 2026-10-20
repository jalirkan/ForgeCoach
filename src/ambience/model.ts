/*
 * ForgeCoach — ambience/model.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The scenery's state: per player, which biomes (island, swamp, …) their
 * lands have claimed, in the order they first appeared, and how far each has
 * grown. Pure and DOM-free.
 *
 * Only the battlefield is read, and only cards the viewer may see (a hidden or
 * face-down card is never classified), so the scenery shows nothing the
 * viewing seat's redacted state does not already show.
 *
 * Classification of one land (spec 1.11; weights always sum to 1 per land),
 * by the coloured mana it makes. A land that makes no coloured mana is not
 * scenery: `null`, like a mana rock.
 *   1. Basic land types on its type line (Island, Swamp, Mountain, Forest,
 *      Plains), split evenly: a "Land — Island Swamp" dual gives ½ island,
 *      ½ swamp, a Triome ⅓ each. The basic Wastes is not a colour: `null`.
 *   2. A "choose a colour as it enters" land (the Thriving lands: "Add {W} or
 *      one mana of the chosen color"): its fixed colour plus the colour chosen
 *      for it, when the caller knows it (state.ts `chosenColors`, the viewing
 *      seat's own answers), ½ / ½; its fixed colour alone while the choice is
 *      unknown (an opponent's, or before the answer).
 *   3. A multi-face card (a Pathway, an MDFC with a land face): the face in
 *      play only, by the colours its own text adds (`CardInfo.faces`), so a
 *      Pathway is one colour and not a dual.
 *   4. Else the colours it taps for (`manaColorsOf`: Scryfall data when the
 *      caller has it, else the wire's ability text): one, two or three
 *      colours split evenly (a fixed three-colour land, Seaside Citadel, in
 *      thirds as a Triome is).
 *   5. Else `null`: no coloured mana (a fetch land until it fetches, Ancient
 *      Tomb, the Landscapes, Mutavault, Urza's Saga), any colour (City of
 *      Brass, Exotic Orchard: four or five colours say nothing about the
 *      deck), or no card data. The wire never carries a land's mana ability,
 *      so a typeless land with no Scryfall data waits quietly (logged once per
 *      card in dev) instead of opening a slot; the data's arrival restarts the
 *      tracker. Before 1.11 all of these went to `wastes`, the built-in
 *      procedural scene, and kept that slot for the rest of the game. No land
 *      claims `wastes` now; the biome stays in {@link BIOMES} so a pack that
 *      paints one still validates.
 *
 * Growth: a biome's land weight sets its integer stage (1 / 2–3 / 4–5 / 6+
 * lands by default) and, between two thresholds, its progress toward the
 * next stage (0..1), so the renderer can grow the scene a little with every
 * land instead of only at the thresholds.
 *
 * Duals (spec 1.8): a land that counts ½ to each of exactly two biomes (a
 * "Land — Forest Island", or a land that taps for exactly those two colours)
 * is also counted per pair ({@link dualPairs}): a pack's bridge for that pair
 * widens the seam between them by it.
 *
 * Slots: a biome claims the next slot the first time its weight is above zero
 * and keeps it for the rest of the game, even if those lands later leave (the
 * slot then shows stage 0, a withered scene). Order needs history, so it is a
 * reducer ({@link stepScenery}) fed state by state, or {@link sceneryFromLog}.
 */
import type { AnyCard, GameStateBody } from '../protocol.ts';
import type { GameLog } from '../log.ts';
import type { CardInfo } from '../cards.ts';
import { keyOf } from '../cards.ts';
import { chosenColorSource, hasType, infoFor, manaColorsInText, manaColorsOf, visibleCard, type ChosenColors } from '../state.ts';

export const BIOMES = ['island', 'swamp', 'mountain', 'forest', 'plains', 'wastes'] as const;
export type Biome = (typeof BIOMES)[number];

export const BIOME_LABEL: Record<Biome, string> = {
  island: 'Island',
  swamp: 'Swamp',
  mountain: 'Mountain',
  forest: 'Forest',
  plains: 'Plains',
  wastes: 'Wastes',
};

const TYPE_BIOME: Record<string, Biome> = {
  Island: 'island',
  Swamp: 'swamp',
  Mountain: 'mountain',
  Forest: 'forest',
  Plains: 'plains',
};
const COLOR_BIOME: Record<string, Biome> = { W: 'plains', U: 'island', B: 'swamp', R: 'mountain', G: 'forest' };

/**
 * Growth thresholds: stage n is reached at weight ≥ thresholds[n-1]. The
 * default is 1 / 2–3 / 4–5 / 6+ lands → stages 1 / 2 / 3 / 4.
 */
export const DEFAULT_STAGE_THRESHOLDS: readonly number[] = [1, 2, 4, 6];
export const MAX_STAGES = 6;

export function isBiome(v: unknown): v is Biome {
  return typeof v === 'string' && (BIOMES as readonly string[]).includes(v);
}

/** How one land splits across biomes (weights sum to 1), or null when it is not a visible land or makes no coloured mana (spec 1.11). `chosen`: the colours chosen for "choose a colour" lands, by card id. */
export function landBiomes(card: AnyCard, cards?: Map<string, CardInfo>, chosen?: ChosenColors): Partial<Record<Biome, number>> | null {
  const c = visibleCard(card);
  if (!c || c.faceDown || !hasType(c, 'Land')) return null;
  const typed = Object.keys(TYPE_BIOME).filter((t) => new RegExp(`\\b${t}\\b`).test(c.types));
  if (typed.length > 0) return split(typed.map((t) => TYPE_BIOME[t]!));
  const cc = chosenColorSource(c, cards);
  if (cc) {
    const pick = chosen?.get(c.id);
    return byColours([...cc.fixed, ...(pick ? [pick] : [])]);
  }
  const info = infoFor(c.name, cards);
  const face = info?.faces?.length ? info.faces.find((f) => keyOf(f.name) === keyOf(c.name)) : undefined;
  if (face) return byColours(manaColorsInText(face.oracleText) ?? []);
  const got = byColours(manaColorsOf(c, cards) ?? []);
  if (!got && !info) noCardData(c.name);
  return got;
}

/** One to three colours split evenly; none, or four or five (an any-colour land), is not scenery. */
function byColours(colours: readonly string[]): Partial<Record<Biome, number>> | null {
  const uniq = [...new Set(colours.filter((x) => x in COLOR_BIOME))];
  return uniq.length >= 1 && uniq.length <= 3 ? split(uniq.map((x) => COLOR_BIOME[x]!)) : null;
}

const quietNoData = new Set<string>();
/** Spec 1.11: a typeless land with no card data draws nothing; say so once per card, in dev only. */
function noCardData(name: string) {
  if (quietNoData.has(name)) return;
  quietNoData.add(name);
  if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) console.info(`[scenery] no card data for the land "${name}": it draws no biome until its data loads (spec 1.11)`);
}

/**
 * A biome pair's key, the same for both orders: the two names in
 * alphabetical order joined by `+` (`forest+island`). Spec 1.8's `bridges`
 * are keyed by it.
 */
export function pairKey(a: Biome, b: Biome): string {
  return a < b ? `${a}+${b}` : `${b}+${a}`;
}

/** The pair a land belongs to both of (½ to each of exactly two biomes, {@link landBiomes}), or null. */
export function landPair(w: Partial<Record<Biome, number>> | null): string | null {
  if (!w) return null;
  const bs = (Object.keys(w) as Biome[]).filter((b) => (w[b] ?? 0) > 0);
  return bs.length === 2 && Math.abs(w[bs[0]!]! - 0.5) < 1e-9 && Math.abs(w[bs[1]!]! - 0.5) < 1e-9 ? pairKey(bs[0]!, bs[1]!) : null;
}

/** Spec 1.8: how many of one player's lands are duals of each pair (only pairs with one or more), keyed by {@link pairKey}. */
export function dualPairs(state: GameStateBody, playerId: number, cards?: Map<string, CardInfo>, chosen?: ChosenColors): Record<string, number> {
  const out: Record<string, number> = {};
  const p = state.players.find((x) => x.id === playerId);
  for (const card of p?.zones.battlefield?.cards ?? []) {
    const k = landPair(landBiomes(card, cards, chosen));
    if (k) out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function split(biomes: Biome[]): Partial<Record<Biome, number>> {
  const out: Partial<Record<Biome, number>> = {};
  const uniq = [...new Set(biomes)];
  for (const b of uniq) out[b] = 1 / uniq.length;
  return out;
}

/** Each biome's land weight on one player's battlefield (only biomes with weight > 0). */
export function biomeWeights(state: GameStateBody, playerId: number, cards?: Map<string, CardInfo>, chosen?: ChosenColors): Partial<Record<Biome, number>> {
  const out: Partial<Record<Biome, number>> = {};
  const p = state.players.find((x) => x.id === playerId);
  if (!p) return out;
  for (const card of p.zones.battlefield?.cards ?? []) {
    const w = landBiomes(card, cards, chosen);
    if (!w) continue;
    for (const [b, v] of Object.entries(w) as [Biome, number][]) out[b] = round((out[b] ?? 0) + v);
  }
  return out;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** The growth stage for a weight: 0 when nothing is there, else 1..thresholds.length. */
export function stageFor(weight: number, thresholds: readonly number[] = DEFAULT_STAGE_THRESHOLDS): number {
  if (!(weight > 0)) return 0;
  let s = 0;
  for (const t of thresholds) if (weight + 1e-9 >= t) s++;
  // A half-land (one dual) still shows something.
  return Math.max(1, s);
}

/**
 * How far a weight has grown from its stage toward the next, 0..1: the
 * fraction of the way between the stage's threshold and the next one (3 lands
 * between thresholds 2 and 4 is stage 2 at 0.5). 0 with no weight, or below
 * the first threshold (a lone dual's half-land shows stage 1 at 0); 1 at or
 * past the last threshold (fully grown: there is no next stage). The integer
 * {@link stageFor} is unchanged; this only fills in the space between.
 */
export function stageProgress(weight: number, thresholds: readonly number[] = DEFAULT_STAGE_THRESHOLDS): number {
  if (!(weight > 0) || !thresholds.length || weight + 1e-9 < thresholds[0]!) return 0;
  const stage = stageFor(weight, thresholds);
  if (stage >= thresholds.length) return 1;
  const from = thresholds[stage - 1]!;
  const to = thresholds[stage]!;
  if (!(to > from)) return 0;
  return round(Math.min(1, Math.max(0, (weight - from) / (to - from))));
}

/** A weight's stage and its progress toward the next ({@link stageFor}, {@link stageProgress}). */
export function growthFor(weight: number, thresholds: readonly number[] = DEFAULT_STAGE_THRESHOLDS): { stage: number; progress: number } {
  return { stage: stageFor(weight, thresholds), progress: stageProgress(weight, thresholds) };
}

/**
 * The growth as one continuous number: the stage plus the progress toward a
 * next stage (3 lands on the default thresholds → 2.5), equal to the stage at
 * each threshold and at the last stage (6 lands → 4, not 5), so it never
 * jumps as a land arrives. For smooth sizes (a slot's width).
 */
export function growthLevel(slot: Pick<SlotState, 'stage' | 'progress'>): number {
  if (slot.stage <= 0) return 0;
  // Progress is below 1 between thresholds; it is 1 only past the last one, where there is no next stage.
  const p = slot.progress ?? 0;
  return p < 1 ? slot.stage + Math.max(0, p) : slot.stage;
}

export interface SlotState {
  biome: Biome;
  /** 0-based, left to right, in order of first appearance. */
  index: number;
  /** Land weight now (a dual counts ½ to each of its two biomes). */
  weight: number;
  stage: number;
  /**
   * The progress toward the next stage, 0..1 ({@link stageProgress}): between
   * two thresholds the scene grows a little with every land. Absent is 0 (a
   * slot made by hand, e.g. in a test, grows only in steps).
   */
  progress?: number;
  /** The highest stage this slot has reached (a destroyed land does not un-grow the memory). */
  peak: number;
}

export interface PlayerScenery {
  playerId: number;
  slots: SlotState[];
  /** Spec 1.8: this player's dual lands per biome pair ({@link dualPairs}); absent is none. */
  duals?: Record<string, number>;
}

export interface Scenery {
  /** By player id, in the order the state lists players. */
  players: PlayerScenery[];
  thresholds: readonly number[];
}

export interface SceneryOptions {
  thresholds?: readonly number[];
  cards?: Map<string, CardInfo>;
  /** The colours chosen for "choose a colour" lands (the Thriving lands), by card id: state.ts `chosenColors`. */
  chosen?: ChosenColors;
}

export function emptyScenery(thresholds: readonly number[] = DEFAULT_STAGE_THRESHOLDS): Scenery {
  return { players: [], thresholds };
}

/**
 * The reducer: the scenery after `state`, given the scenery before it. Slots
 * keep their order; a biome seen for the first time takes the next slot.
 * Within one state, new biomes are ordered by where their first land sits on
 * the battlefield (the engine's order), then by biome order.
 */
export function stepScenery(prev: Scenery | null, state: GameStateBody, opts: SceneryOptions = {}): Scenery {
  const thresholds = opts.thresholds ?? prev?.thresholds ?? DEFAULT_STAGE_THRESHOLDS;
  const players: PlayerScenery[] = [];
  for (const p of state.players ?? []) {
    const before = prev?.players.find((x) => x.playerId === p.id);
    const weights = biomeWeights(state, p.id, opts.cards, opts.chosen);
    const slots: SlotState[] = (before?.slots ?? []).map((s) => {
      const weight = weights[s.biome] ?? 0;
      const { stage, progress } = growthFor(weight, thresholds);
      return { ...s, weight, stage, progress, peak: Math.max(s.peak, stage) };
    });
    const have = new Set(slots.map((s) => s.biome));
    for (const b of firstSeenOrder(state, p.id, opts.cards, opts.chosen)) {
      if (have.has(b) || !((weights[b] ?? 0) > 0)) continue;
      const { stage, progress } = growthFor(weights[b]!, thresholds);
      slots.push({ biome: b, index: slots.length, weight: weights[b]!, stage, progress, peak: stage });
      have.add(b);
    }
    const duals = dualPairs(state, p.id, opts.cards, opts.chosen);
    players.push(Object.keys(duals).length ? { playerId: p.id, slots, duals } : { playerId: p.id, slots });
  }
  return { players, thresholds };
}

function firstSeenOrder(state: GameStateBody, playerId: number, cards?: Map<string, CardInfo>, chosen?: ChosenColors): Biome[] {
  const p = state.players.find((x) => x.id === playerId);
  const out: Biome[] = [];
  for (const card of p?.zones.battlefield?.cards ?? []) {
    const w = landBiomes(card, cards, chosen);
    if (!w) continue;
    for (const b of BIOMES) if ((w[b] ?? 0) > 0 && !out.includes(b)) out.push(b);
  }
  return out;
}

/** The scenery at `frameIndex` of a log: every state frame up to and including it, reduced. */
export function sceneryFromLog(log: GameLog, frameIndex: number, opts: SceneryOptions = {}): Scenery {
  let s: Scenery | null = null;
  const end = Math.min(frameIndex, log.frames.length - 1);
  for (let i = 0; i <= end; i++) {
    const f = log.frames[i]!;
    if (f.type === 'state') s = stepScenery(s, f.body as GameStateBody, opts);
  }
  return s ?? emptyScenery(opts.thresholds);
}

/**
 * Incremental {@link sceneryFromLog} for a board that moves forward one frame
 * at a time (a live seat) and sometimes jumps (a replay scrubber): continues
 * from where it was when it can, starts over when it cannot.
 */
/** One state frame the tracker stepped over: the scenery before and after it. */
export interface SceneryStep {
  frameIndex: number;
  prev: Scenery | null;
  next: Scenery;
  state: GameStateBody;
}

/** Steps kept from one `at` call (a live burst of frames, or a replay step). */
export const MAX_TRACKED_STEPS = 16;

export class SceneryTracker {
  /**
   * The log it follows, known by its frames rather than its object: a live session hands the board a new
   * snapshot (a new object, a new array of the same frames) on every frame, and starting over on each was
   * the board's biggest cost in a long game (J109: seconds behind the wire by turn 60).
   */
  private first: unknown = null;
  private atUpto: unknown = null;
  private lastSteps: SceneryStep[] = [];
  private upto = -1;
  private scenery: Scenery | null = null;
  private prevScenery: Scenery | null = null;
  private lastState: GameStateBody | null = null;
  private prevState: GameStateBody | null = null;
  constructor(private opts: SceneryOptions = {}) {}

  /** Change options (thresholds, card data); the next `at` starts over. */
  setOptions(opts: SceneryOptions) {
    this.opts = { ...opts, chosen: opts.chosen ?? this.opts.chosen };
    this.first = null;
  }

  /**
   * The colours chosen for "choose a colour" lands so far, without starting
   * over: a choice is made once, as its land enters, so only the states still
   * to come need it (each state's weights are counted afresh).
   */
  setChosen(chosen: ChosenColors | undefined) {
    this.opts = { ...this.opts, chosen };
  }

  at(log: GameLog, frameIndex: number): Scenery {
    const end = Math.min(frameIndex, log.frames.length - 1);
    // The same log, only grown (its first frame, and the frame it stopped at, where they were): go on.
    const same = this.first !== null && log.frames[0] === this.first && log.frames[this.upto] === this.atUpto;
    if (!same || end < this.upto || !this.scenery) {
      this.first = log.frames[0] ?? null;
      this.upto = -1;
      this.scenery = null;
      this.prevScenery = null;
      this.lastState = null;
      this.prevState = null;
    }
    const steps: SceneryStep[] = [];
    for (let i = this.upto + 1; i <= end; i++) {
      const f = log.frames[i]!;
      if (f.type !== 'state') continue;
      const st = f.body as GameStateBody;
      this.prevScenery = this.scenery;
      this.prevState = this.lastState;
      this.scenery = stepScenery(this.scenery, st, this.opts);
      this.lastState = st;
      steps.push({ frameIndex: i, prev: this.prevScenery, next: this.scenery, state: st });
      if (steps.length > MAX_TRACKED_STEPS) steps.shift();
    }
    if (steps.length || end !== this.upto) this.lastSteps = steps;
    this.upto = Math.max(this.upto, end);
    this.atUpto = log.frames[this.upto];
    return this.scenery ?? emptyScenery(this.opts.thresholds);
  }

  /**
   * The state frames the last `at` call stepped over (at most
   * {@link MAX_TRACKED_STEPS}, the newest), each with its frame index, so a
   * caller can turn only the frames it has not seen yet into events.
   */
  steps(): readonly SceneryStep[] {
    return this.lastSteps;
  }

  /** The scenery and state one state frame before the last `at` (for {@link sceneryEvents}). */
  previous(): { scenery: Scenery | null; state: GameStateBody | null } {
    return { scenery: this.prevScenery, state: this.prevState };
  }

  current(): { scenery: Scenery | null; state: GameStateBody | null } {
    return { scenery: this.scenery, state: this.lastState };
  }
}

const NO_DUALS: Readonly<Record<string, number>> = Object.freeze({});

/** A player's dual lands per biome pair (spec 1.8), or none. */
export function dualsOf(s: Scenery | null | undefined, playerId: number): Readonly<Record<string, number>> {
  return s?.players.find((p) => p.playerId === playerId)?.duals ?? NO_DUALS;
}

/** A player's slots, or [] when the scenery does not know them. */
export function slotsOf(s: Scenery | null | undefined, playerId: number): SlotState[] {
  return s?.players.find((p) => p.playerId === playerId)?.slots ?? [];
}
