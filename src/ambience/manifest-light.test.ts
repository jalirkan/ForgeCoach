/*
 * ForgeCoach — ambience/manifest-light.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.13: a stage's half picture may declare its painted `hour` (0–24) and
 * light `key`; bad values are warned and dropped, and a pack without them is
 * read as before.
 */
import { describe, expect, it } from 'vitest';
import { validateManifest } from './manifest.ts';

const BASE = 'https://example.org/pack/';
const pack = (half: Record<string, unknown>) => ({
  schema: 1,
  biomes: { island: { stages: [{ layers: [], half: { src: 'island/s1-half.webp', ...half } }] } },
});
const halfOf = (half: Record<string, unknown>) => {
  const r = validateManifest(pack(half), BASE);
  return { half: r.pack!.biomes.island!.stages[0]!.half!, warnings: r.warnings };
};

describe('spec 1.13 hour and key', () => {
  it('keeps a declared hour and key', () => {
    const { half, warnings } = halfOf({ hour: 19.5, key: 'dusk' });
    expect([half.hour, half.key]).toEqual([19.5, 'dusk']);
    expect(warnings).toEqual([]);
  });
  it('reads a pack without them as before', () => {
    const { half, warnings } = halfOf({});
    expect('hour' in half || 'key' in half).toBe(false);
    expect(warnings).toEqual([]);
  });
  it('warns and drops a bad hour or key', () => {
    const { half, warnings } = halfOf({ hour: 25, key: 'sunset' });
    expect([half.hour, half.key]).toEqual([undefined, undefined]);
    expect(warnings).toEqual(['biomes.island.stages[0].half.hour: the hour the stage is painted at, 0–24; ignored', 'biomes.island.stages[0].half.key: one of dawn, morning, noon, afternoon, dusk, night; ignored']);
  });
});
