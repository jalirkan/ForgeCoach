/*
 * ForgeCoach — ambience/transitions.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.7, transition frames between stages: the manifest's per-biome
 * `transitions` (defaults, what is dropped and why, the budget), a 1.6 pack
 * reading as before (no transitions: the cross-fade), the frames a stage
 * change plays (forward, backwards, two steps chained, the phone shape, and
 * every case that falls back to the cross-fade), the hard-cut timeline, the
 * frames warmed for the next land, and the spec's worked example.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TRANSITION_FADE_MS, DEFAULT_TRANSITION_HOLD_MS, MAX_TRANSITION_FRAMES, validateManifest, type PackBiome } from './manifest.ts';
import { MAX_CHAINED_STEPS, nextStepFrames, transitionFrames, tweenAllowed, tweenAt, tweenLength, tweenTimeline } from './transitions.ts';
import { FORGECOACH_PACK_URL } from './prefs.ts';

const BASE = 'http://127.0.0.1:8650/scenery.json';
const ROOT = 'http://127.0.0.1:8650/';
const stage = (n: number) => ({ layers: [{ id: 'sky', kind: 'image', src: `island/s${n}-sky.webp` }], half: { src: `island/s${n}-half.webp`, phone: { src: `island/s${n}-phone.webp` } } });
const frame = (n: number, k: number, phone = true) => ({ src: `island/s${n}to${n + 1}-f${k}-half.webp`, ...(phone ? { phone: `island/s${n}to${n + 1}-f${k}-phone.webp` } : {}) });
const pack = (transitions: unknown, stages = 4) => ({
  schema: 1,
  spec: '1.7',
  stageThresholds: Array.from({ length: stages }, (_, i) => i + 1),
  biomes: { island: { stages: Array.from({ length: stages }, (_, i) => stage(i + 1)), transitions } },
});
const full = {
  holdMs: 120,
  fadeMs: 180,
  steps: [
    { from: 1, frames: [frame(1, 1), frame(1, 2), frame(1, 3)], bytes: 300000 },
    { from: 2, frames: [frame(2, 1), frame(2, 2)] },
    { from: 3, frames: [frame(3, 1), { ...frame(3, 2), holdMs: 160 }] },
  ],
};
const island = (raw: unknown): { b: PackBiome; warnings: string[] } => {
  const r = validateManifest(raw, BASE);
  expect(r.errors).toEqual([]);
  return { b: r.pack!.biomes.island!, warnings: r.warnings };
};
const names = (fr: { src: string }[] | null) => fr?.map((f) => f.src.replace(ROOT, '').replace(/^island\//, '')) ?? null;

describe('the manifest’s transitions (spec 1.7)', () => {
  it('reads every step, in order, with each frame’s hold and URLs resolved against the pack', () => {
    const { b, warnings } = island(pack({ ...full, steps: [...full.steps].reverse() }));
    expect(warnings).toEqual([]);
    const t = b.transitions!;
    expect(t.holdMs).toBe(120);
    expect(t.fadeMs).toBe(180);
    expect(t.steps.map((s) => s.from)).toEqual([1, 2, 3]);
    expect(t.steps[0]!.frames[0]).toEqual({ src: `${ROOT}island/s1to2-f1-half.webp`, phone: `${ROOT}island/s1to2-f1-phone.webp`, holdMs: 120 });
    expect(t.steps[2]!.frames.map((f) => f.holdMs)).toEqual([120, 160]);
    expect(t.steps[0]!.bytes).toBe(300000);
  });
  it('defaults: a hold of 120 ms and a fade of 180 ms; a frame need not have a phone picture', () => {
    const { b, warnings } = island(pack({ steps: [{ from: 1, frames: [frame(1, 1, false)] }] }));
    expect(warnings).toEqual([]);
    expect(b.transitions).toMatchObject({ holdMs: DEFAULT_TRANSITION_HOLD_MS, fadeMs: DEFAULT_TRANSITION_FADE_MS });
    expect(b.transitions!.steps[0]!.frames[0]!.phone).toBeNull();
  });
  it('a 1.6 pack (and pack-v6.1 itself) has none: every step cross-fades as before', () => {
    expect(island(pack(undefined)).b.transitions).toBeUndefined();
    const v6 = validateManifest(JSON.parse(readFileSync(new URL('./testdata/pack-v6.1.scenery.json', import.meta.url), 'utf8')), `${FORGECOACH_PACK_URL}scenery.json`);
    expect(v6.errors).toEqual([]);
    expect(Object.values(v6.pack!.biomes).every((b) => !b!.transitions)).toBe(true);
    expect(transitionFrames(v6.pack!.biomes.island, 1, 2, 'desktop')).toBeNull();
  });
  it('drops a step whole when one of its frames is unusable, a step that repeats, and one past the last stage', () => {
    const { b, warnings } = island(
      pack({
        steps: [
          { from: 1, frames: [frame(1, 1), { src: 'ftp://example.org/f.webp' }] },
          { from: 2, frames: [frame(2, 1)] },
          { from: 2, frames: [frame(2, 9)] },
          { from: 4, frames: [frame(4, 1)] },
          { from: 3, frames: [] },
          { from: 3, frames: [{ src: 'island/x.gif' }] },
        ],
      }),
    );
    expect(b.transitions!.steps.map((s) => s.from)).toEqual([2]);
    expect(warnings).toEqual([
      'biomes.island.transitions.steps[0].frames[1].src: the ftp: scheme is not allowed (http, https or relative only); step dropped',
      "biomes.island.transitions.steps[2]: stage 2's step repeats; step dropped",
      'biomes.island.transitions.steps[3].from: a stage 1–3 that has a next stage; step dropped',
      'biomes.island.transitions.steps[4].frames: 1–4 frames; step dropped',
      'biomes.island.transitions.steps[5].frames[0].src: expected .webp, .avif, .png or .jpg; step dropped',
    ]);
  });
  it(`keeps at most ${MAX_TRANSITION_FRAMES} frames a step, and range-checks the holds`, () => {
    const { b, warnings } = island(pack({ holdMs: 5, fadeMs: 4000, steps: [{ from: 1, frames: [1, 2, 3, 4, 5].map((k) => frame(1, k)) }] }));
    expect(b.transitions!.steps[0]!.frames).toHaveLength(MAX_TRANSITION_FRAMES);
    expect(b.transitions).toMatchObject({ holdMs: 120, fadeMs: 180 });
    expect(warnings).toEqual([
      'biomes.island.transitions.holdMs: 5 is out of range 40–1000; using 120',
      'biomes.island.transitions.fadeMs: 4000 is out of range 0–1000; using 180',
      'biomes.island.transitions.steps[0].frames: more than 4; the rest ignored',
    ]);
  });
  it('is ignored, with a warning, when it is not an object, has no steps list, or a stage was dropped (the numbers would not line up)', () => {
    expect(island(pack('fast')).warnings).toEqual(['biomes.island.transitions: not an object; ignored']);
    expect(island(pack({ frames: [] })).warnings).toEqual(['biomes.island.transitions.steps: a list of { from, frames }; ignored']);
    const raw = pack(full);
    (raw.biomes.island.stages as unknown[])[1] = { layers: 'nope' };
    const r = island(raw);
    expect(r.b.transitions).toBeUndefined();
    expect(r.warnings).toContain('biomes.island.transitions: a stage of this biome was dropped, so the steps no longer match their stages; ignored');
  });
  it('warns past 2 MB of declared frames per biome (the frames are kept)', () => {
    const { b, warnings } = island(pack({ steps: [{ from: 1, frames: [frame(1, 1)], bytes: 3 * 1024 * 1024 }] }));
    expect(b.transitions!.steps).toHaveLength(1);
    expect(warnings).toEqual(['biomes.island.transitions: 3.0 MB of transition frames declared; their budget is 2 MB per biome (frames kept)']);
  });
});

describe('the frames a stage change plays', () => {
  const { b } = island(pack(full));
  it('one land up: that step’s frames in order, each with its hold', () => {
    expect(names(transitionFrames(b, 1, 2, 'desktop'))).toEqual(['s1to2-f1-half.webp', 's1to2-f2-half.webp', 's1to2-f3-half.webp']);
    expect(transitionFrames(b, 3, 4, 'desktop')!.map((f) => f.holdMs)).toEqual([120, 160]);
  });
  it('the phone shape plays the phone pictures', () => {
    expect(names(transitionFrames(b, 2, 3, 'phone'))).toEqual(['s2to3-f1-phone.webp', 's2to3-f2-phone.webp']);
  });
  it('a land leaving plays the step backwards', () => {
    expect(names(transitionFrames(b, 3, 2, 'desktop'))).toEqual(['s2to3-f2-half.webp', 's2to3-f1-half.webp']);
  });
  it(`two stages at once chain both steps; more than ${MAX_CHAINED_STEPS} cross-fade`, () => {
    expect(names(transitionFrames(b, 2, 4, 'desktop'))).toEqual(['s2to3-f1-half.webp', 's2to3-f2-half.webp', 's3to4-f1-half.webp', 's3to4-f2-half.webp']);
    expect(names(transitionFrames(b, 4, 2, 'desktop'))).toEqual(['s3to4-f2-half.webp', 's3to4-f1-half.webp', 's2to3-f2-half.webp', 's2to3-f1-half.webp']);
    expect(transitionFrames(b, 1, 4, 'desktop')).toBeNull();
  });
  it('falls back to the cross-fade: no change, a missing step, a step with no picture at this shape, past the last stage, no biome', () => {
    expect(transitionFrames(b, 2, 2, 'desktop')).toBeNull();
    const gap = island(pack({ steps: [full.steps[0], full.steps[2]] })).b;
    expect(transitionFrames(gap, 2, 3, 'desktop')).toBeNull();
    expect(transitionFrames(gap, 1, 3, 'desktop')).toBeNull();
    const noPhone = island(pack({ steps: [{ from: 1, frames: [frame(1, 1), frame(1, 2, false)] }] })).b;
    expect(transitionFrames(noPhone, 1, 2, 'phone')).toBeNull();
    expect(transitionFrames(noPhone, 1, 2, 'desktop')).toHaveLength(2);
    expect(transitionFrames(b, 4, 5, 'desktop')).toBeNull();
    expect(transitionFrames(b, 0, 1, 'desktop')).toBeNull();
    expect(transitionFrames(undefined, 1, 2, 'desktop')).toBeNull();
  });
  it('plays only with motion, a pack’s transitions, and a stage seen before (never on the first paint)', () => {
    expect(tweenAllowed(b.transitions, false, 1)).toBe(true);
    expect(tweenAllowed(b.transitions, true, 1)).toBe(false);
    expect(tweenAllowed(b.transitions, false, null)).toBe(false);
    expect(tweenAllowed(null, false, 1)).toBe(false);
  });
});

describe('the hard-cut timeline', () => {
  const frames = [
    { src: 'a', holdMs: 120 },
    { src: 'b', holdMs: 120 },
    { src: 'c', holdMs: 160 },
  ];
  it('each frame starts where the last one’s hold ends; then the one fade into the stage', () => {
    expect(tweenTimeline(frames)).toEqual({ starts: [0, 120, 240], holdEnd: 400 });
    expect(tweenLength(frames, 180)).toBe(580);
  });
  it('cuts between frames (one at a time, never two blended), fades only after the last', () => {
    expect(tweenAt(frames, 180, 0)).toEqual({ index: 0, fading: false, done: false });
    expect(tweenAt(frames, 180, 119)).toEqual({ index: 0, fading: false, done: false });
    expect(tweenAt(frames, 180, 120)).toEqual({ index: 1, fading: false, done: false });
    expect(tweenAt(frames, 180, 399)).toEqual({ index: 2, fading: false, done: false });
    expect(tweenAt(frames, 180, 400)).toEqual({ index: 2, fading: true, done: false });
    expect(tweenAt(frames, 180, 580)).toEqual({ index: 2, fading: false, done: true });
    expect(tweenAt(frames, 0, 400)).toEqual({ index: 2, fading: false, done: true });
  });
});

describe('warming the next land’s frames', () => {
  const { b } = island(pack(full));
  it('the step from the slot’s stage to the next, at its shape', () => {
    expect(nextStepFrames(b, 2, 'desktop').map((u) => u.replace(ROOT, ''))).toEqual(['island/s2to3-f1-half.webp', 'island/s2to3-f2-half.webp']);
    expect(nextStepFrames(b, 1, 'phone')).toHaveLength(3);
  });
  it('nothing at the last stage, for a withered slot, or a pack with no transitions', () => {
    expect(nextStepFrames(b, 4, 'desktop')).toEqual([]);
    expect(nextStepFrames(b, 0, 'desktop')).toEqual([]);
    expect(nextStepFrames(island(pack(undefined)).b, 1, 'desktop')).toEqual([]);
  });
});

describe('the spec’s transitions example', () => {
  it('validates with no errors or warnings, and plays three frames then the stage', () => {
    const md = readFileSync(new URL('../../docs/scenery-pack-spec.md', import.meta.url), 'utf8');
    const block = /<!-- example-transitions -->\s*```json\n([\s\S]*?)```/.exec(md);
    expect(block).not.toBeNull();
    const r = validateManifest(JSON.parse(block![1]!), BASE);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    const b = r.pack!.biomes.island!;
    const fr = transitionFrames(b, 1, 2, 'desktop')!;
    expect(fr).toHaveLength(3);
    expect(tweenLength(fr, b.transitions!.fadeMs)).toBe(3 * 120 + 180);
    expect(transitionFrames(b, 1, 2, 'phone')).toHaveLength(3);
  });
});
