/*
 * ForgeCoach — ambience/pack-v7-1.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * pack-v7.1 (spec 1.7: pack-v7 with its transition frames repainted, two per
 * step, held 200 ms) validates on this client: a snapshot of its
 * scenery.json, identical to what jsDelivr serves at the tag, taken when
 * FORGECOACH_PACK_URL moved to it. pack-v7 stays at its own tag
 * (pack-v7.test.ts), so the two can be compared by flipping the URL.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hasAreaPieces, MAX_TRANSITION_BYTES, validateManifest } from './manifest.ts';
import { FORGECOACH_PACK_URL } from './prefs.ts';
import { transitionFrames, tweenLength } from './transitions.ts';

describe('pack-v7.1', () => {
  const manifest = JSON.parse(readFileSync(new URL('./testdata/pack-v7.1.scenery.json', import.meta.url), 'utf8'));
  const r = validateManifest(manifest, `${FORGECOACH_PACK_URL}scenery.json`);
  it('is the default pack URL', () => expect(FORGECOACH_PACK_URL).toContain('@pack-v7.1/pack/'));
  it('validates with no errors, and is written for this spec', () => {
    expect(r.errors).toEqual([]);
    expect(r.pack!.spec).toBe('1.7');
    expect(r.warnings.filter((w) => /spec|transitions/.test(w))).toEqual([]);
  });
  it('has six stages, one per land, and the front layer', () => {
    expect(r.pack!.stageThresholds).toEqual([1, 2, 3, 4, 5, 6]);
    expect(hasAreaPieces(r.pack!)).toBe(true);
  });
  it('gives every biome two frames for each of its five steps, desktop and phone, held 200 ms, in the v2 files', () => {
    for (const b of Object.values(r.pack!.biomes)) {
      const t = b!.transitions!;
      expect(t.steps.map((s) => s.from)).toEqual([1, 2, 3, 4, 5]);
      expect(t.holdMs).toBe(200);
      expect(t.fadeMs).toBe(180);
      for (const s of t.steps) {
        expect(s.frames).toHaveLength(2);
        expect(s.frames.every((f) => /-half-v2\.webp$/.test(f.src) && /-phone-v2\.webp$/.test(f.phone ?? ''))).toBe(true);
        expect(transitionFrames(b, s.from, s.from + 1, 'phone')).toHaveLength(2);
      }
      expect(t.steps.reduce((n, s) => n + (s.bytes ?? 0), 0)).toBeLessThan(MAX_TRANSITION_BYTES);
    }
  });
  it('plays a step in 580 ms: two frames of 200 ms, then the 180 ms fade', () => {
    const island = r.pack!.biomes.island!;
    expect(tweenLength(transitionFrames(island, 1, 2, 'desktop')!, island.transitions!.fadeMs)).toBe(2 * 200 + 180);
  });
});
