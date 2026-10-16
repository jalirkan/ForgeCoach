/*
 * ForgeCoach — ambience/pack-v7-3.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * pack-v7.3 (spec 1.7: pack-v7.2 with forest stage 6 redrawn over stage 5's
 * own view at night, so the last forest step grows instead of replacing the
 * picture, and that step given three in-between frames) validates on this
 * client: a snapshot of its scenery.json, identical to what jsDelivr serves
 * at the tag, taken when FORGECOACH_PACK_URL moved to it. pack-v7.2 stays at
 * its tag (pack-v7-2.test.ts), so the old and new stage 6 can be compared by
 * flipping the URL. (The default is pack-v8 now, which adds a bridge across
 * the seam for every biome pair, spec 1.8: pack-v8.test.ts. pack-v7.3 stays
 * at its tag as the fallback, this snapshot with it.)
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hasAreaPieces, MAX_TRANSITION_BYTES, validateManifest } from './manifest.ts';
import { FORGECOACH_PACK_URL } from './prefs.ts';
import { transitionFrames, tweenLength } from './transitions.ts';

/** The steps with three frames: pack-v7.2's seven, and forest's last step (s5 -> s6). */
const THREE: Record<string, number[]> = { island: [1], mountain: [2], swamp: [2, 3], plains: [4, 5], forest: [2, 5] };

describe('pack-v7.3', () => {
  const manifest = JSON.parse(readFileSync(new URL('./testdata/pack-v7.3.scenery.json', import.meta.url), 'utf8'));
  const r = validateManifest(manifest, `${FORGECOACH_PACK_URL}scenery.json`);
  it('validates with no errors, and is written for this spec', () => {
    expect(r.errors).toEqual([]);
    expect(r.pack!.spec).toBe('1.7');
    expect(r.pack!.bridges).toBeUndefined();
    expect(r.warnings.filter((w) => /spec|transitions/.test(w))).toEqual([]);
  });
  it('has six stages, one per land, and the front layer', () => {
    expect(r.pack!.stageThresholds).toEqual([1, 2, 3, 4, 5, 6]);
    expect(hasAreaPieces(r.pack!)).toBe(true);
  });
  it('keeps forest stage 6 its sky, fireflies loop and front layer', () => {
    const s6 = manifest.biomes.forest.stages[5];
    expect(s6.layers.map((l: { id: string }) => l.id)).toEqual(['sky', 'fireflies']);
    expect(s6.layers[1].src).toBe('forest/s6-fireflies.webm');
    expect(s6.overlay.map((o: { id: string }) => o.id)).toEqual(['front']);
    expect(s6.half.src).toBe('forest/s6-half.webp');
    expect(s6.half.phone.src).toBe('forest/s6-phone.webp');
  });
  it('gives the eight big steps three frames and every other step two, desktop and phone, held 200 ms, in the v4 files', () => {
    let three = 0;
    for (const [name, b] of Object.entries(r.pack!.biomes)) {
      const t = b!.transitions!;
      expect(t.steps.map((s) => s.from)).toEqual([1, 2, 3, 4, 5]);
      expect(t).toMatchObject({ holdMs: 200, fadeMs: 180 });
      for (const s of t.steps) {
        const want = THREE[name]?.includes(s.from) ? 3 : 2;
        if (want === 3) three++;
        expect(s.frames).toHaveLength(want);
        expect(s.frames.every((f) => /-half-v4\.webp$/.test(f.src) && /-phone-v4\.webp$/.test(f.phone ?? ''))).toBe(true);
        expect(transitionFrames(b, s.from, s.from + 1, 'phone')).toHaveLength(want);
      }
      expect(t.steps.reduce((n, s) => n + (s.bytes ?? 0), 0)).toBeLessThan(MAX_TRANSITION_BYTES);
    }
    expect(three).toBe(8);
  });
  it("plays forest's last step in 780 ms (three frames of 200 ms, then the 180 ms fade)", () => {
    const forest = r.pack!.biomes.forest!;
    expect(tweenLength(transitionFrames(forest, 5, 6, 'desktop')!, forest.transitions!.fadeMs)).toBe(3 * 200 + 180);
  });
});
