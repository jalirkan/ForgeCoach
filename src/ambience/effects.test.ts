/*
 * ForgeCoach — ambience/effects.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { BUILTIN_EFFECT, EffectQueue, MAX_REPLAY_STEP, SCRUB_MS, STALE_MS, creatureBiome, dominantBiome, effectCues, effectGate, resolveEffect, type EffectCue } from './effects.ts';
import { sceneryEvents } from './events.ts';
import { SceneryTracker, sceneryFromLog, type SlotState } from './model.ts';
import { validateManifest } from './manifest.ts';
import { SIM_PLAYERS, simLog, type SimPlay } from './sim.ts';
import type { GameStateBody } from '../protocol.ts';

const [ME, OPP] = SIM_PLAYERS;
const slot = (biome: SlotState['biome'], index: number, weight: number): SlotState => ({ biome, index, weight, stage: 1, peak: 1 });

/** Events and the scenery after the last play. */
function lastStep(plays: SimPlay[]) {
  const before = simLog(plays.slice(0, -1));
  const log = simLog(plays);
  const scenery = sceneryFromLog(log, Infinity);
  const events = sceneryEvents(sceneryFromLog(before, Infinity), scenery, log.frames.at(-1)!.body as GameStateBody);
  return { events, scenery };
}

describe('event → effect mapping', () => {
  it('a land gives landfall, and stage up when a claimed slot grows a stage', () => {
    const first = lastStep([{ kind: 'land', player: ME, name: 'Island' }]);
    expect(effectCues(first.events, first.scenery).map((c) => [c.event, c.player, c.biome])).toEqual([['landfall', ME, 'island']]);
    const second = lastStep([
      { kind: 'land', player: ME, name: 'Island' },
      { kind: 'land', player: ME, name: 'Island' },
    ]);
    expect(effectCues(second.events, second.scenery).map((c) => c.event)).toEqual(['landfall', 'stageUp']);
  });

  it('a creature plays in the biome of its colour when the player has it, else their largest', () => {
    expect(creatureBiome(['G'], [slot('island', 0, 3), slot('forest', 1, 1)])).toBe('forest');
    expect(creatureBiome(['R'], [slot('island', 0, 1), slot('forest', 1, 2)])).toBe('forest');
    expect(creatureBiome([], [slot('island', 0, 1), slot('wastes', 1, 1)])).toBe('wastes');
    expect(creatureBiome(['W'], [])).toBeNull();
    expect(dominantBiome([slot('island', 0, 2), slot('swamp', 1, 2)])).toBe('island');
    const s = lastStep([
      { kind: 'land', player: ME, name: 'Forest' },
      { kind: 'creature', player: ME },
    ]);
    const cues = effectCues(s.events, s.scenery);
    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({ event: 'creatureEnter', player: ME, biome: 'forest' });
    expect(cues[0]!.cardId).toBeGreaterThan(0);
  });

  it('an attack gives one attack for the attacker and merged damage for the defender', () => {
    const s = lastStep([
      { kind: 'land', player: ME, name: 'Mountain' },
      { kind: 'land', player: OPP, name: 'Plains' },
      { kind: 'creature', player: ME },
      { kind: 'creature', player: ME },
      { kind: 'attack', player: ME },
    ]);
    const cues = effectCues(s.events, s.scenery);
    expect(cues.map((c) => [c.event, c.player, c.biome])).toEqual([
      ['attack', ME, 'mountain'],
      ['damagePlayer', OPP, 'plains'],
    ]);
    expect(cues[1]!.amount).toBe(4);
  });

  it('merges damage per target, splits players from creatures, and drops what it cannot place', () => {
    const scenery = sceneryFromLog(simLog([{ kind: 'land', player: OPP, name: 'Swamp' }]), Infinity);
    const cues = effectCues(
      [
        { kind: 'damage', player: OPP, targetKind: 'player', targetId: OPP, amount: 2, combat: true, sourceCardId: 1 },
        { kind: 'damage', player: OPP, targetKind: 'player', targetId: OPP, amount: 3, combat: true, sourceCardId: 2 },
        { kind: 'damage', player: OPP, targetKind: 'card', targetId: 77, amount: 1, combat: true, sourceCardId: 2 },
        { kind: 'damage', player: null, targetKind: 'card', targetId: 78, amount: 1, combat: true, sourceCardId: 2 },
        { kind: 'attack', player: ME, attackerIds: [1], defender: OPP },
        { kind: 'attack', player: ME, attackerIds: [2], defender: OPP },
      ],
      scenery,
    );
    expect(cues.map((c) => [c.event, c.amount, c.cardId])).toEqual([
      ['damagePlayer', 5, null],
      ['damageCreature', 1, 77],
      ['attack', 0, null],
    ]);
  });

  it('resolves the pack’s biome effect, then its global one, then the built-in; skip honours reduced motion', () => {
    const r = validateManifest(
      {
        schema: 1,
        spec: '1.2',
        effects: { creatureEnter: { kind: 'particles', preset: 'motes' }, attack: { kind: 'particles', preset: 'ripple', reduced: 'skip' } },
        biomes: { island: { effects: { creatureEnter: { kind: 'sprite', src: 'fx/a.webp', frames: 4, cols: 4, fps: 12 } } } },
      },
      'http://127.0.0.1:8650/',
    );
    expect(r.errors).toEqual([]);
    const pack = r.pack!;
    const cue = (event: EffectCue['event'], biome: EffectCue['biome']): EffectCue => ({ event, player: ME, biome, cardId: null, amount: 0 });
    expect(resolveEffect(cue('creatureEnter', 'island'), pack, false)).toMatchObject({ source: 'pack', effect: { kind: 'sprite' }, color: '#9fd8ff' });
    expect(resolveEffect(cue('creatureEnter', 'forest'), pack, false)).toMatchObject({ source: 'pack', effect: { preset: 'motes' } });
    expect(resolveEffect(cue('damagePlayer', 'forest'), pack, false)).toMatchObject({ source: 'builtin', effect: { preset: 'flash' } });
    expect(resolveEffect(cue('attack', 'forest'), pack, true)).toBeNull();
    expect(resolveEffect(cue('attack', 'forest'), null, true)).toMatchObject({ source: 'builtin', effect: { preset: 'sweep', reduced: 'glow' } });
    expect(resolveEffect(cue('landfall', 'island'), null, false)).toBeNull();
    expect(resolveEffect(cue('stageUp', 'island'), null, false)).toBeNull();
  });

  it('built-in placeholders are all under 600 ms', () => {
    for (const ev of Object.keys(BUILTIN_EFFECT) as EffectCue['event'][]) {
      const r = resolveEffect({ event: ev, player: ME, biome: 'island', cardId: null, amount: 0 }, null, false);
      if (r) expect(r.effect.durationMs).toBeLessThan(600);
    }
  });
});

describe('EffectQueue', () => {
  const item = (durationMs = 500) => ({ durationMs });

  it('plays at most maxConcurrent, starting the rest as slots free up', () => {
    const q = new EffectQueue<{ durationMs: number }>(2);
    expect(q.push([item(), item(), item(), item()], 0)).toBe(true);
    expect(q.current()).toHaveLength(2);
    expect(q.pendingCount()).toBe(2);
    expect(q.nextWake()).toBe(500);
    expect(q.advance(400)).toBe(false);
    expect(q.advance(500)).toBe(true);
    expect(q.current()).toHaveLength(2);
    expect(q.current().map((a) => a.startedAt)).toEqual([500, 500]);
    expect(q.pendingCount()).toBe(0);
  });

  it('drops waiting effects that went stale, and caps the waiting list', () => {
    const q = new EffectQueue<{ durationMs: number }>(1, 3);
    q.push([item(2000), item(), item(), item(), item(), item()], 0);
    expect(q.pendingCount()).toBe(3);
    q.advance(2000);
    expect(STALE_MS).toBeLessThan(2000);
    expect(q.current()).toHaveLength(0);
    expect(q.pendingCount()).toBe(0);
  });

  it('clamps maxConcurrent to 1–6', () => {
    expect(new EffectQueue(0).maxConcurrent).toBe(1);
    expect(new EffectQueue(40).maxConcurrent).toBe(6);
  });

  it('clear drops everything; pause freezes the clock and resume shifts it', () => {
    const q = new EffectQueue<{ durationMs: number }>(3);
    q.push([item(500)], 0);
    q.pause(100);
    expect(q.nextWake()).toBeNull();
    expect(q.advance(10_000)).toBe(false);
    q.resume(10_100);
    expect(q.current()[0]!.endsAt).toBe(10_500);
    expect(q.advance(10_400)).toBe(false);
    expect(q.advance(10_500)).toBe(true);
    q.push([item(), item()], 11_000);
    expect(q.clear()).toBe(true);
    expect(q.current()).toHaveLength(0);
    expect(q.clear()).toBe(false);
  });
});

describe('effectGate: no bursts while scrubbing', () => {
  const move = (o: Partial<Parameters<typeof effectGate>[0]>) => effectGate({ from: 10, to: 11, stateSteps: 1, live: false, now: 10_000, lastMoveAt: null, ...o });

  it('fires for a normal replay step and for live play', () => {
    expect(move({})).toBe('fire');
    expect(move({ lastMoveAt: 10_000 - SCRUB_MS - 1 })).toBe('fire');
    expect(move({ live: true, to: 40, stateSteps: 16, lastMoveAt: 9_990 })).toBe('fire');
  });

  it('cancels going back, jumping ahead, and fast stepping; idles when nothing moved', () => {
    expect(move({ to: 9 })).toBe('cancel');
    expect(move({ to: 200, stateSteps: MAX_REPLAY_STEP + 1 })).toBe('cancel');
    expect(move({ lastMoveAt: 10_000 - 60 })).toBe('cancel');
    expect(move({ to: 10 })).toBe('idle');
  });

  it('a held arrow key over a replay fires at most once', () => {
    const plays: SimPlay[] = [];
    for (let i = 0; i < 6; i++) plays.push({ kind: 'land', player: ME, name: 'Island' }, { kind: 'creature', player: ME }, { kind: 'attack', player: ME });
    const log = simLog(plays);
    const tracker = new SceneryTracker();
    tracker.at(log, 0);
    let last: number | null = null;
    let from = 0;
    let fired = 0;
    for (let to = 1; to < log.frames.length; to++) {
      tracker.at(log, to);
      const steps = tracker.steps().filter((s) => s.frameIndex > from && s.frameIndex <= to);
      const now = to * 40; // 25 steps a second
      const v = effectGate({ from, to, stateSteps: steps.length, live: false, now, lastMoveAt: last });
      if (v !== 'idle') last = now;
      from = to;
      if (v === 'fire') fired += effectCues(steps.flatMap((s) => sceneryEvents(s.prev, s.next, s.state)), tracker.current().scenery!).length;
    }
    expect(fired).toBeLessThanOrEqual(1);
  });

  it('a slider drag to the end is one jump: nothing fires', () => {
    const plays: SimPlay[] = Array.from({ length: 12 }, () => ({ kind: 'creature', player: ME }) as SimPlay);
    const log = simLog(plays);
    const tracker = new SceneryTracker();
    tracker.at(log, 0);
    tracker.at(log, log.frames.length - 1);
    const steps = tracker.steps().filter((s) => s.frameIndex > 0);
    expect(steps.length).toBeGreaterThan(MAX_REPLAY_STEP);
    expect(effectGate({ from: 0, to: log.frames.length - 1, stateSteps: steps.length, live: false, now: 5000, lastMoveAt: null })).toBe('cancel');
  });

  it('the tracker reports each state frame of a live burst, so none is lost', () => {
    const plays: SimPlay[] = [
      { kind: 'land', player: OPP, name: 'Forest' },
      { kind: 'creature', player: OPP },
      { kind: 'creature', player: OPP },
    ];
    const log = simLog(plays);
    const tracker = new SceneryTracker();
    tracker.at(log, 0);
    tracker.at(log, 3);
    const steps = tracker.steps().filter((s) => s.frameIndex > 0);
    const cues = steps.flatMap((s) => effectCues(sceneryEvents(s.prev, s.next, s.state), s.next));
    expect(cues.map((c) => c.event)).toEqual(['landfall', 'creatureEnter', 'creatureEnter']);
  });
});
