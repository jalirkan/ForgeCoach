/*
 * ForgeCoach — ambience/effects.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * One-shot scenery effects (spec 1.2): which scenery events become effects,
 * what each one plays (the pack's art, or a built-in placeholder), a queue
 * that caps how many play at once, and the gate that keeps a replay scrubber
 * from firing a burst of them. Pure and DOM-free; the clock is passed in.
 *
 * Only the viewing seat's redacted states feed this (events.ts): an effect
 * never says more than the board does.
 */
import type { Biome, Scenery, SlotState } from './model.ts';
import { slotsOf } from './model.ts';
import type { SceneryEvent } from './events.ts';
import { DEFAULT_CONCURRENT_EFFECTS, MAX_CONCURRENT_EFFECTS, packEffect, PRESET_MS, type EffectAt, type EffectEvent, type PackEffect, type ParticlePreset, type ScenePack } from './manifest.ts';

/** Each biome's light, for built-in effects and glows. */
export const BIOME_COLOR: Record<Biome, string> = {
  island: '#9fd8ff',
  swamp: '#c7a8ff',
  mountain: '#ffad7a',
  forest: '#b5f29a',
  plains: '#fff3c4',
  wastes: '#ddd5c6',
};

/** A colour letter's biome. */
const COLOR_BIOME: Record<string, Biome> = { W: 'plains', U: 'island', B: 'swamp', R: 'mountain', G: 'forest' };

/** Something that should play: an event, on a player's strip, in a biome. */
export interface EffectCue {
  event: EffectEvent;
  /** Whose strip it plays on. */
  player: number;
  /** The biome whose art (and colour) it uses; null when the player has no slot yet. */
  biome: Biome | null;
  /** The card it is about (creature entered, creature damaged), for anchoring near it. */
  cardId: number | null;
  /** Damage dealt, merged per target. */
  amount: number;
}

/** The biome with the most land weight (the earliest slot on a tie), or null. */
export function dominantBiome(slots: SlotState[]): Biome | null {
  let best: SlotState | null = null;
  for (const s of slots) if (s.weight > 0 && (!best || s.weight > best.weight + 1e-9 || (Math.abs(s.weight - best.weight) < 1e-9 && s.index < best.index))) best = s;
  return best?.biome ?? slots[0]?.biome ?? null;
}

/** A creature's biome: the first of its colours the player has a slot for, else their dominant biome. */
export function creatureBiome(colors: string[], slots: SlotState[]): Biome | null {
  for (const c of colors) {
    const b = COLOR_BIOME[c];
    if (b && slots.some((s) => s.biome === b)) return b;
  }
  if (!colors.length && slots.some((s) => s.biome === 'wastes')) return 'wastes';
  return dominantBiome(slots);
}

/**
 * Scenery events → effect cues, against the scenery after them. Lands give
 * `landfall` (and `stageUp` when a claimed slot grew a stage); creatures
 * give `creatureEnter`; attacks one `attack` per attacking player; damage is
 * merged per damaged player (`damagePlayer`) and per damaged card
 * (`damageCreature`). Damage whose target the viewer cannot place is dropped.
 */
export function effectCues(events: SceneryEvent[], scenery: Scenery): EffectCue[] {
  const out: EffectCue[] = [];
  const attackers = new Set<number>();
  const damage = new Map<string, EffectCue>();
  for (const e of events) {
    if (e.kind === 'land') {
      out.push({ event: 'landfall', player: e.player, biome: e.biome, cardId: null, amount: 0 });
      if (e.prevStage > 0 && e.stage > e.prevStage) out.push({ event: 'stageUp', player: e.player, biome: e.biome, cardId: null, amount: 0 });
    } else if (e.kind === 'creature') {
      if (e.player < 0) continue;
      out.push({ event: 'creatureEnter', player: e.player, biome: creatureBiome(e.colors, slotsOf(scenery, e.player)), cardId: e.cardId, amount: 0 });
    } else if (e.kind === 'attack') {
      if (attackers.has(e.player)) continue;
      attackers.add(e.player);
      out.push({ event: 'attack', player: e.player, biome: dominantBiome(slotsOf(scenery, e.player)), cardId: null, amount: 0 });
    } else if (e.kind === 'damage') {
      if (e.player === null) continue;
      const key = e.targetKind === 'player' ? `p${e.targetId}` : `c${e.targetId}`;
      const cur = damage.get(key);
      if (cur) {
        cur.amount += e.amount;
        continue;
      }
      const cue: EffectCue = {
        event: e.targetKind === 'player' ? 'damagePlayer' : 'damageCreature',
        player: e.player,
        biome: dominantBiome(slotsOf(scenery, e.player)),
        cardId: e.targetKind === 'card' ? e.targetId : null,
        amount: e.amount,
      };
      damage.set(key, cue);
      out.push(cue);
    }
  }
  return out;
}

/** The built-in placeholder for each event (none for landfall and stage up: the slot glow and the bloom already show them). */
export const BUILTIN_EFFECT: Record<EffectEvent, ParticlePreset | null> = {
  creatureEnter: 'shimmer',
  attack: 'sweep',
  damagePlayer: 'flash',
  damageCreature: 'crack',
  landfall: null,
  stageUp: null,
};

const BUILTIN_AT: Record<EffectEvent, EffectAt> = { creatureEnter: 'card', attack: 'slot', damagePlayer: 'strip', damageCreature: 'card', landfall: 'slot', stageUp: 'slot' };

/** What a cue plays: the pack's effect, or a built-in preset. */
export interface ResolvedEffect {
  cue: EffectCue;
  source: 'pack' | 'builtin';
  /** The pack's effect, or a built-in one shaped like it (particles). */
  effect: PackEffect;
  /** The colour for presets and glows. */
  color: string;
}

/** A built-in effect as a particles preset. */
export function builtinEffect(event: EffectEvent): PackEffect | null {
  const preset = BUILTIN_EFFECT[event];
  if (!preset) return null;
  return {
    kind: 'particles',
    src: null,
    src2x: null,
    fallback: null,
    poster: null,
    frames: 1,
    cols: 1,
    rows: 1,
    fps: 0,
    preset,
    color: event === 'damagePlayer' || event === 'damageCreature' ? '#ffb347' : null,
    durationMs: PRESET_MS[preset],
    blend: 'screen',
    scale: event === 'damagePlayer' ? 1 : event === 'attack' ? 1.1 : 1.2,
    // The flash spans the side (the strip clips it); the others sit at their anchor, wider than a card so they show around it.
    aspect: event === 'creatureEnter' ? 1.4 : event === 'damageCreature' ? 1.3 : event === 'damagePlayer' ? 6 : 2.2,
    y: 0,
    at: BUILTIN_AT[event],
    mirror: event === 'attack',
    reduced: 'glow',
    bytes: null,
  };
}

/**
 * What a cue plays, or null for nothing: the pack's effect for the biome (or
 * its global one), else the built-in placeholder. With reduced motion an
 * effect whose `reduced` is `skip` plays nothing.
 */
export function resolveEffect(cue: EffectCue, pack: ScenePack | null | undefined, reduced: boolean): ResolvedEffect | null {
  const own = packEffect(pack, cue.event, cue.biome);
  const effect = own ?? builtinEffect(cue.event);
  if (!effect) return null;
  if (reduced && effect.reduced === 'skip') return null;
  const color = effect.color ?? (cue.biome ? BIOME_COLOR[cue.biome] : '#e9f2ff');
  return { cue, source: own ? 'pack' : 'builtin', effect, color };
}

// ---------------------------------------------------------------------------
// The queue

export interface QueuedFx {
  durationMs: number;
}

export interface ActiveFx<T extends QueuedFx> {
  key: number;
  item: T;
  startedAt: number;
  endsAt: number;
}

/** Pending effects older than this are dropped: a late effect would point at nothing. */
export const STALE_MS = 900;

/**
 * At most `maxConcurrent` effects at once; the rest wait (a few, briefly) and
 * start as slots free up. Time is passed in, so it tests without timers.
 * Pausing (a hidden tab) freezes everything; resuming shifts every clock by
 * the pause, so nothing is skipped or bunched.
 */
export class EffectQueue<T extends QueuedFx> {
  private active: ActiveFx<T>[] = [];
  private pending: { item: T; at: number }[] = [];
  private seq = 1;
  private pausedAt: number | null = null;
  private max: number;
  constructor(maxConcurrent = DEFAULT_CONCURRENT_EFFECTS, private maxPending = 6) {
    this.max = clampMax(maxConcurrent);
  }

  setMax(n: number) {
    this.max = clampMax(n);
  }

  get maxConcurrent() {
    return this.max;
  }

  /** Queue effects; returns whether the active set changed. */
  push(items: T[], now: number): boolean {
    if (!items.length) return false;
    for (const item of items) this.pending.push({ item, at: now });
    const changed = this.advance(now);
    // Too many waiting: keep the newest.
    if (this.pending.length > this.maxPending) this.pending.splice(0, this.pending.length - this.maxPending);
    return changed;
  }

  /** Retire finished effects, start waiting ones. Returns whether the active set changed. */
  advance(now: number): boolean {
    if (this.pausedAt !== null) return false;
    const before = this.active.length;
    this.active = this.active.filter((a) => a.endsAt > now);
    let changed = this.active.length !== before;
    this.pending = this.pending.filter((p) => now - p.at <= STALE_MS);
    while (this.active.length < this.max && this.pending.length) {
      const { item } = this.pending.shift()!;
      this.active.push({ key: this.seq++, item, startedAt: now, endsAt: now + item.durationMs });
      changed = true;
    }
    return changed;
  }

  /** The effects playing now. */
  current(): readonly ActiveFx<T>[] {
    return this.active;
  }

  pendingCount(): number {
    return this.pending.length;
  }

  /** When `advance` next has something to do, or null. */
  nextWake(): number | null {
    if (this.pausedAt !== null) return null;
    if (!this.active.length) return null;
    return Math.min(...this.active.map((a) => a.endsAt));
  }

  /** Drop everything (unmount, a jump, scrubbing). Returns whether anything was playing or waiting. */
  clear(): boolean {
    const had = this.active.length > 0 || this.pending.length > 0;
    this.active = [];
    this.pending = [];
    return had;
  }

  pause(now: number) {
    if (this.pausedAt === null) this.pausedAt = now;
  }

  resume(now: number) {
    if (this.pausedAt === null) return;
    const d = now - this.pausedAt;
    this.pausedAt = null;
    for (const a of this.active) {
      a.startedAt += d;
      a.endsAt += d;
    }
    for (const p of this.pending) p.at += d;
  }

  get paused() {
    return this.pausedAt !== null;
  }
}

function clampMax(n: number): number {
  return Math.max(1, Math.min(MAX_CONCURRENT_EFFECTS, Math.round(Number.isFinite(n) ? n : DEFAULT_CONCURRENT_EFFECTS)));
}

// ---------------------------------------------------------------------------
// The gate

/** A replay step longer than this many state frames is a jump, not play. */
export const MAX_REPLAY_STEP = 8;
/** Board moves closer together than this are scrubbing (a held key, a dragged slider). */
export const SCRUB_MS = 250;

export interface BoardMove {
  /** The frame index before and after. */
  from: number;
  to: number;
  /** State frames stepped over. */
  stateSteps: number;
  /** The log grew and the board follows its end (a live seat or a live watch). */
  live: boolean;
  now: number;
  /** When the board last moved, or null. */
  lastMoveAt: number | null;
}

/**
 * Should a board move fire effects? `fire` for live play and normal replay
 * steps; `cancel` (and clear what is playing) for going back, jumping ahead,
 * or moves faster than {@link SCRUB_MS}; `idle` when nothing moved.
 */
export function effectGate(m: BoardMove): 'fire' | 'cancel' | 'idle' {
  if (m.to === m.from) return 'idle';
  if (m.to < m.from) return 'cancel';
  if (m.live) return 'fire';
  if (m.stateSteps > MAX_REPLAY_STEP) return 'cancel';
  if (m.lastMoveAt !== null && m.now - m.lastMoveAt < SCRUB_MS) return 'cancel';
  return 'fire';
}
