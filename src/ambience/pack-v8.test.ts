/*
 * ForgeCoach — ambience/pack-v8.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * pack-v8 (spec 1.8: pack-v7.3 with a bridge across the seam for every one of
 * the ten biome pairs, a desktop and a phone piece each, and +0.02 of the
 * half's width per dual land up to 0.18) validates on this client: a snapshot
 * of its scenery.json, identical to what jsDelivr serves at the tag, taken
 * when FORGECOACH_PACK_URL moved to it. pack-v7.3 stays at its tag
 * (pack-v7-3.test.ts) as the fallback.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bridgeBytes, bridgeFor, bridgePlacements } from './bridges.ts';
import { MAX_BRIDGE_BYTES, validateManifest } from './manifest.ts';
import { halfLayout } from './layout.ts';
import { pairKey, type Biome, type SlotState } from './model.ts';
import { FORGECOACH_PACK_URL } from './prefs.ts';

const FIVE: Biome[] = ['plains', 'island', 'swamp', 'mountain', 'forest'];
const slot = (b: Biome, index: number): SlotState => ({ biome: b, index, weight: 2, stage: 2, peak: 2 });

describe('pack-v8', () => {
  const manifest = JSON.parse(readFileSync(new URL('./testdata/pack-v8.scenery.json', import.meta.url), 'utf8'));
  const old = JSON.parse(readFileSync(new URL('./testdata/pack-v7.3.scenery.json', import.meta.url), 'utf8'));
  const r = validateManifest(manifest, `${FORGECOACH_PACK_URL}scenery.json`);
  const pack = r.pack!;
  it('is the default pack URL', () => expect(FORGECOACH_PACK_URL).toContain('@pack-v8/pack/'));
  it('validates with no errors, no warning about its spec or its bridges, and is written for this spec', () => {
    expect(r.errors).toEqual([]);
    // pack-v7.3's one warning (swamp's full-area accents over their 3 MB) is unchanged; nothing new.
    expect(r.warnings).toEqual(validateManifest(old, `${FORGECOACH_PACK_URL}scenery.json`).warnings);
    expect(r.warnings.filter((w) => /spec|bridges/.test(w))).toEqual([]);
    expect(pack.spec).toBe('1.8');
  });
  it('is pack-v7.3 plus the bridges: every biome, stage and frame unchanged', () => {
    expect(manifest.biomes).toEqual(old.biomes);
    expect(manifest.half).toEqual(old.half);
    expect(manifest.stageThresholds).toEqual(old.stageThresholds);
  });
  it('has a bridge for each of the ten pairs, a desktop and a phone piece each, under the 3 MB budget', () => {
    const keys = Object.keys(pack.bridges!).sort();
    const want = FIVE.flatMap((a, i) => FIVE.slice(i + 1).map((b) => pairKey(a, b))).sort();
    expect(keys).toEqual(want);
    expect(keys).toHaveLength(10);
    for (const b of Object.values(pack.bridges!)) {
      expect(b!.desktop.src).toMatch(/\/bridges\/[a-z]+-[a-z]+\.webp$/);
      expect(b!.phone!.src).toMatch(/\/bridges\/[a-z]+-[a-z]+-phone\.webp$/);
      expect(b!.desktop.anchor).toEqual({ y: 0.725, width: 0.4 });
      expect(b!.phone!.anchor).toEqual({ y: 0.725, width: 0.6 });
      expect([b!.dualsWiden, b!.maxSeamRatio]).toEqual([0.02, 0.18]);
      expect(b!.left < b!.right).toBe(true);
    }
    expect(bridgeBytes(pack)).toBeGreaterThan(0);
    expect(bridgeBytes(pack)).toBeLessThanOrEqual(MAX_BRIDGE_BYTES);
  });
  it('draws a bridge between any two colours on one side, in either order', () => {
    for (const a of FIVE)
      for (const b of FIVE) {
        if (a === b) continue;
        const [p] = bridgePlacements(halfLayout([slot(a, 0), slot(b, 1)], pack), pack, {});
        expect(p, `${a} | ${b}`).toMatchObject({ key: pairKey(a, b), mirror: a > b });
        expect(bridgeFor(pack, a, b)!.bridge).toBe(bridgeFor(pack, b, a)!.bridge);
      }
  });
});
