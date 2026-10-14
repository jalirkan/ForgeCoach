/*
 * ForgeCoach — ambience/pack-v7.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * pack-v7 (spec 1.7: pack-v6.1's six-picture ladder plus transition frames
 * between stages) validates on this client: a snapshot of its scenery.json,
 * taken when FORGECOACH_PACK_URL moved to it. Every biome has frames for all
 * five steps, at both shapes, within the 2 MB budget.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hasAreaPieces, MAX_TRANSITION_BYTES, validateManifest } from './manifest.ts';
import { FORGECOACH_PACK_URL } from './prefs.ts';
import { transitionFrames, tweenLength } from './transitions.ts';

describe('pack-v7', () => {
  const manifest = JSON.parse(readFileSync(new URL('./testdata/pack-v7.scenery.json', import.meta.url), 'utf8'));
  const r = validateManifest(manifest, `${FORGECOACH_PACK_URL}scenery.json`);
  it('is the default pack URL', () => expect(FORGECOACH_PACK_URL).toContain('@pack-v7/pack/'));
  it('validates with no errors, and is written for this spec', () => {
    expect(r.errors).toEqual([]);
    expect(r.pack!.spec).toBe('1.7');
    expect(r.warnings.filter((w) => /spec|transitions/.test(w))).toEqual([]);
  });
  it('has six stages, one per land, and the front layer', () => {
    expect(r.pack!.stageThresholds).toEqual([1, 2, 3, 4, 5, 6]);
    expect(hasAreaPieces(r.pack!)).toBe(true);
  });
  it('gives every biome two or three frames for each of its five steps, desktop and phone, held 120 ms', () => {
    for (const b of Object.values(r.pack!.biomes)) {
      const t = b!.transitions!;
      expect(t.steps.map((s) => s.from)).toEqual([1, 2, 3, 4, 5]);
      expect(t.holdMs).toBe(120);
      for (const s of t.steps) {
        expect(s.frames.length === 2 || s.frames.length === 3).toBe(true);
        expect(s.frames.every((f) => f.src.startsWith(FORGECOACH_PACK_URL) && f.phone?.startsWith(FORGECOACH_PACK_URL))).toBe(true);
        expect(transitionFrames(b, s.from, s.from + 1, 'phone')).toHaveLength(s.frames.length);
      }
      expect(t.steps.reduce((n, s) => n + (s.bytes ?? 0), 0)).toBeLessThan(MAX_TRANSITION_BYTES);
    }
  });
  it('plays a step in well under a second', () => {
    const island = r.pack!.biomes.island!;
    expect(tweenLength(transitionFrames(island, 1, 2, 'desktop')!, island.transitions!.fadeMs)).toBe(3 * 120 + 180);
  });
});
