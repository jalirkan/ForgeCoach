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
 * Classification of one land (weights always sum to 1 per land):
 *   1. Basic land types on its type line (Island, Swamp, …, Wastes), split
 *      evenly: a "Land — Island Swamp" dual gives ½ island, ½ swamp.
 *   2. Else the colours it taps for (`manaColorsOf`: Scryfall data when the
 *      caller has it, else the wire's ability text), one or two colours split
 *      evenly.
 *   3. Else (colourless, unknown, or three or more colours) → wastes.
 *
 * Slots: a biome claims the next slot the first time its weight is above zero
 * and keeps it for the rest of the game, even if those lands later leave (the
 * slot then shows stage 0, a withered scene). Order needs history, so it is a
 * reducer ({@link stepScenery}) fed state by state, or {@link sceneryFromLog}.
 */
import type { AnyCard, GameStateBody } from '../protocol.ts';
import type { GameLog } from '../log.ts';
import type { CardInfo } from '../cards.ts';
import { hasType, manaColorsOf, visibleCard } from '../state.ts';

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
  Wastes: 'wastes',
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

/** How one land splits across biomes (weights sum to 1), or null when it is not a visible land. */
export function landBiomes(card: AnyCard, cards?: Map<string, CardInfo>): Partial<Record<Biome, number>> | null {
  const c = visibleCard(card);
  if (!c || c.faceDown || !hasType(c, 'Land')) return null;
  const typed = Object.keys(TYPE_BIOME).filter((t) => new RegExp(`\\b${t}\\b`).test(c.types));
  if (typed.length > 0) return split(typed.map((t) => TYPE_BIOME[t]!));
  const colors = (manaColorsOf(c, cards) ?? []).filter((x) => x in COLOR_BIOME);
  const uniq = [...new Set(colors)];
  if (uniq.length >= 1 && uniq.length <= 2) return split(uniq.map((x) => COLOR_BIOME[x]!));
  return { wastes: 1 };
}

function split(biomes: Biome[]): Partial<Record<Biome, number>> {
  const out: Partial<Record<Biome, number>> = {};
  const uniq = [...new Set(biomes)];
  for (const b of uniq) out[b] = 1 / uniq.length;
  return out;
}

/** Each biome's land weight on one player's battlefield (only biomes with weight > 0). */
export function biomeWeights(state: GameStateBody, playerId: number, cards?: Map<string, CardInfo>): Partial<Record<Biome, number>> {
  const out: Partial<Record<Biome, number>> = {};
  const p = state.players.find((x) => x.id === playerId);
  if (!p) return out;
  for (const card of p.zones.battlefield?.cards ?? []) {
    const w = landBiomes(card, cards);
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

export interface SlotState {
  biome: Biome;
  /** 0-based, left to right, in order of first appearance. */
  index: number;
  /** Land weight now (a dual counts ½ to each of its two biomes). */
  weight: number;
  stage: number;
  /** The highest stage this slot has reached (a destroyed land does not un-grow the memory). */
  peak: number;
}

export interface PlayerScenery {
  playerId: number;
  slots: SlotState[];
}

export interface Scenery {
  /** By player id, in the order the state lists players. */
  players: PlayerScenery[];
  thresholds: readonly number[];
}

export interface SceneryOptions {
  thresholds?: readonly number[];
  cards?: Map<string, CardInfo>;
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
    const weights = biomeWeights(state, p.id, opts.cards);
    const slots: SlotState[] = (before?.slots ?? []).map((s) => {
      const weight = weights[s.biome] ?? 0;
      const stage = stageFor(weight, thresholds);
      return { ...s, weight, stage, peak: Math.max(s.peak, stage) };
    });
    const have = new Set(slots.map((s) => s.biome));
    for (const b of firstSeenOrder(state, p.id, opts.cards)) {
      if (have.has(b) || !((weights[b] ?? 0) > 0)) continue;
      const stage = stageFor(weights[b]!, thresholds);
      slots.push({ biome: b, index: slots.length, weight: weights[b]!, stage, peak: stage });
      have.add(b);
    }
    players.push({ playerId: p.id, slots });
  }
  return { players, thresholds };
}

function firstSeenOrder(state: GameStateBody, playerId: number, cards?: Map<string, CardInfo>): Biome[] {
  const p = state.players.find((x) => x.id === playerId);
  const out: Biome[] = [];
  for (const card of p?.zones.battlefield?.cards ?? []) {
    const w = landBiomes(card, cards);
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
    this.opts = opts;
    this.first = null;
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

/** A player's slots, or [] when the scenery does not know them. */
export function slotsOf(s: Scenery | null | undefined, playerId: number): SlotState[] {
  return s?.players.find((p) => p.playerId === playerId)?.slots ?? [];
}
