/*
 * ForgeCoach — ambience/pack-retry.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * One slow file must not cost a biome the whole game. 2026-10-15: on a new
 * pack tag jsDelivr's cold cache took 3–67 s a file against a 15 s timeout,
 * and two biomes drew the built-in scenery for the rest of the game. Now a
 * stage-1 asset that fails or times out is tried once more after a short
 * pause (the first attempt still counting if it lands meanwhile); only an
 * asset still missing then fails its biome; and a failed biome whose files
 * arrive later comes back (`SceneryLoad.later`). Timing on a fake clock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateManifest, type LayerKind } from './manifest.ts';
import { PRELOAD_RETRY_DELAY_MS, PRELOAD_TIMEOUT_MS, preloadPack, resolveScenery, type AssetLoader, type FetchLike } from './pack.ts';
import { DEFAULT_PREFS } from './prefs.ts';

const BASE = 'https://cdn.example.test/pack/';
const manifest = {
  schema: 1,
  biomes: {
    island: { stages: [{ layers: [{ id: 'sky', kind: 'image', src: 'island/sky.webp' }] }] },
    swamp: { stages: [{ layers: [{ id: 'mire', kind: 'image', src: 'swamp/mire.webp' }] }] },
  },
};
const scenePack = () => {
  const v = validateManifest(manifest, `${BASE}scenery.json`);
  if (!v.pack) throw new Error(v.errors.join('; '));
  return v.pack;
};
const serve: FetchLike = async () => ({ ok: true, status: 200, text: async () => JSON.stringify(manifest) });
const prefs = { ...DEFAULT_PREFS, mode: 'pack' as const, packUrl: BASE };

/** What one attempt at a file does: land after `ms`, fail after `ms`, or never answer. */
type Plan = { land: number } | { fail: number } | 'hang';

/** A loader whose swamp file follows `plans`, one per attempt (island always lands at once); it counts swamp's attempts. */
function loader(plans: Plan[]): AssetLoader & { calls: () => number } {
  let n = 0;
  const load = ((url: string, _kind: LayerKind) => {
    if (!url.includes('swamp')) return Promise.resolve();
    const plan = plans[Math.min(n++, plans.length - 1)]!;
    if (plan === 'hang') return new Promise<void>(() => {});
    return new Promise<void>((resolve, reject) => {
      if ('land' in plan) setTimeout(resolve, plan.land);
      else setTimeout(() => reject(new Error('error')), plan.fail);
    });
  }) as AssetLoader & { calls: () => number };
  load.calls = () => n;
  return load;
}

/** Settles a promise on the fake clock, reporting when it did. */
function watch<T>(p: Promise<T>) {
  const out: { value?: T; done: boolean } = { done: false };
  p.then((v) => {
    out.value = v;
    out.done = true;
  });
  return out;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('preloadPack: one retry before a biome fails', () => {
  it('a file that fails once and then loads: tried again after the pause, no biome failed', async () => {
    const load = loader([{ fail: 100 }, { land: 100 }]);
    const run = watch(preloadPack(scenePack(), load));
    await vi.advanceTimersByTimeAsync(100 + PRELOAD_RETRY_DELAY_MS - 1);
    expect(load.calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load.calls()).toBe(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(run.done).toBe(true);
    expect(run.value!.failed).toEqual([]);
    expect(run.value!.reasons).toEqual([]);
    expect(await run.value!.recovered).toEqual([]);
  });

  it('a file that times out once and then loads: no biome failed', async () => {
    const load = loader(['hang', { land: 5000 }]);
    const run = watch(preloadPack(scenePack(), load));
    await vi.advanceTimersByTimeAsync(PRELOAD_TIMEOUT_MS + PRELOAD_RETRY_DELAY_MS + 4999);
    expect(load.calls()).toBe(2);
    expect(run.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(run.done).toBe(true);
    expect(run.value!.failed).toEqual([]);
  });

  it('a slow first attempt that lands during the retry still counts', async () => {
    const load = loader([{ land: 20_000 }, 'hang']);
    const run = watch(preloadPack(scenePack(), load));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(load.calls()).toBe(2);
    expect(run.done).toBe(true);
    expect(run.value!.failed).toEqual([]);
  });

  it('a file that fails twice: its biome failed, and only its biome', async () => {
    const load = loader([{ fail: 10 }, { fail: 10 }]);
    const run = watch(preloadPack(scenePack(), load));
    await vi.advanceTimersByTimeAsync(10 + PRELOAD_RETRY_DELAY_MS + 10);
    expect(run.done).toBe(true);
    expect(load.calls()).toBe(2);
    expect(run.value!.failed).toEqual(['swamp']);
    expect(run.value!.reasons).toEqual(['swamp: swamp/mire.webp did not load']);
    expect(await run.value!.recovered).toEqual([]);
  });

  it('a file that times out twice: failed after both attempts, not before', async () => {
    const load = loader(['hang', 'hang']);
    const run = watch(preloadPack(scenePack(), load));
    await vi.advanceTimersByTimeAsync(2 * PRELOAD_TIMEOUT_MS + PRELOAD_RETRY_DELAY_MS - 1);
    expect(run.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(run.done).toBe(true);
    expect(run.value!.failed).toEqual(['swamp']);
    expect(run.value!.reasons).toEqual(['swamp: swamp/mire.webp timed out']);
  });
});

describe('resolveScenery: a failed biome comes back when its files arrive', () => {
  it('the first load draws swamp built-in; the later one puts the pack back', async () => {
    // The first attempt takes 67 s (the slowest file measured): past both attempts' timeouts.
    const load = loader([{ land: 67_000 }, 'hang']);
    const run = watch(resolveScenery(prefs, { fetch: serve, load }));
    await vi.advanceTimersByTimeAsync(2 * PRELOAD_TIMEOUT_MS + PRELOAD_RETRY_DELAY_MS);
    expect(run.done).toBe(true);
    const first = run.value!;
    expect(first!.source).toBe('pack');
    expect(Object.keys(first!.pack!.biomes)).toEqual(['island']);
    expect(first!.failed).toEqual(['swamp']);
    expect(first!.note).toMatch(/swamp/);
    expect(first!.later).toBeDefined();
    const later = watch(first!.later!);
    await vi.advanceTimersByTimeAsync(67_000);
    expect(later.done).toBe(true);
    expect(later.value!.source).toBe('pack');
    expect(Object.keys(later.value!.pack!.biomes).sort()).toEqual(['island', 'swamp']);
    expect(later.value!.failed).toEqual([]);
    expect(later.value!.note).toBeNull();
    expect(later.value!.warnings).toEqual([]);
  });

  it('a biome whose file never arrives: the later load is null', async () => {
    const load = loader([{ fail: 10 }, { fail: 10 }]);
    const run = watch(resolveScenery(prefs, { fetch: serve, load }));
    await vi.advanceTimersByTimeAsync(10 + PRELOAD_RETRY_DELAY_MS + 10);
    expect(run.value!.failed).toEqual(['swamp']);
    expect(await run.value!.later).toBeNull();
  });

  it('nothing failed: nothing to wait for', async () => {
    const load = loader([{ land: 10 }]);
    const run = watch(resolveScenery(prefs, { fetch: serve, load }));
    await vi.advanceTimersByTimeAsync(10);
    expect(run.value!.failed).toEqual([]);
    expect(run.value!.later).toBeUndefined();
  });
});
