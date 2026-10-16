/*
 * ForgeCoach — ambience/pack-v7-2.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * pack-v7.2 (spec 1.7: pack-v7.1 with three in-between frames on the seven
 * steps that change most, so every cut of a growth is about the same size)
 * validates on this client: a snapshot of its scenery.json, identical to
 * what jsDelivr serves at the tag, taken when FORGECOACH_PACK_URL moved to
 * it. pack-v7 and pack-v7.1 stay at their tags (their tests are kept). (The
 * default is pack-v7.3 now, forest stage 6 redrawn over stage 5's view:
 * pack-v7-3.test.ts.)
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hasAreaPieces, MAX_TRANSITION_BYTES, validateManifest } from './manifest.ts';
import { FORGECOACH_PACK_URL } from './prefs.ts';
import { transitionFrames, tweenLength } from './transitions.ts';

/** The steps with three frames: the seven whose two stage pictures differ most. */
const THREE: Record<string, number[]> = { island: [1], mountain: [2], swamp: [2, 3], plains: [4, 5], forest: [2] };

describe('pack-v7.2', () => {
  const manifest = JSON.parse(readFileSync(new URL('./testdata/pack-v7.2.scenery.json', import.meta.url), 'utf8'));
  const r = validateManifest(manifest, `${FORGECOACH_PACK_URL}scenery.json`);
  it('validates with no errors, and is written for this spec', () => {
    expect(r.errors).toEqual([]);
    expect(r.pack!.spec).toBe('1.7');
    expect(r.warnings.filter((w) => /spec|transitions/.test(w))).toEqual([]);
  });
  it('has six stages, one per land, and the front layer', () => {
    expect(r.pack!.stageThresholds).toEqual([1, 2, 3, 4, 5, 6]);
    expect(hasAreaPieces(r.pack!)).toBe(true);
  });
  it('gives the seven big steps three frames and every other step two, desktop and phone, held 200 ms, in the v3 files', () => {
    let three = 0;
    for (const [name, b] of Object.entries(r.pack!.biomes)) {
      const t = b!.transitions!;
      expect(t.steps.map((s) => s.from)).toEqual([1, 2, 3, 4, 5]);
      expect(t).toMatchObject({ holdMs: 200, fadeMs: 180 });
      for (const s of t.steps) {
        const want = THREE[name]?.includes(s.from) ? 3 : 2;
        if (want === 3) three++;
        expect(s.frames).toHaveLength(want);
        expect(s.frames.every((f) => /-half-v3\.webp$/.test(f.src) && /-phone-v3\.webp$/.test(f.phone ?? ''))).toBe(true);
        expect(transitionFrames(b, s.from, s.from + 1, 'phone')).toHaveLength(want);
      }
      expect(t.steps.reduce((n, s) => n + (s.bytes ?? 0), 0)).toBeLessThan(MAX_TRANSITION_BYTES);
    }
    expect(three).toBe(7);
  });
  it('plays a big step in 780 ms (three frames of 200 ms, then the 180 ms fade) and the rest in 580 ms', () => {
    const swamp = r.pack!.biomes.swamp!;
    expect(tweenLength(transitionFrames(swamp, 2, 3, 'desktop')!, swamp.transitions!.fadeMs)).toBe(3 * 200 + 180);
    expect(tweenLength(transitionFrames(swamp, 4, 5, 'desktop')!, swamp.transitions!.fadeMs)).toBe(2 * 200 + 180);
  });
});
