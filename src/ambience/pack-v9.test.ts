/*
 * ForgeCoach — ambience/pack-v9.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * pack-v9 (spec 1.8, as pack-v8: the ten bridges repainted as one picture
 * across the seam, with no outline, and two full-area accent artefacts
 * painted out — the island's sky shell at stages 4–6 and the plains' golden
 * streaks at stages 2–6) validates on this client: a snapshot of its
 * scenery.json, byte for byte what jsDelivr serves at the tag, taken when
 * FORGECOACH_PACK_URL moved to it. pack-v8 stays at its tag
 * (pack-v8.test.ts) as the fallback. Why: ~/scenery-packs/seams-v1/diag/DIAGNOSIS.md.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bridgeBytes, bridgeFor, bridgePlacements } from './bridges.ts';
import { MAX_BRIDGE_BYTES, validateManifest } from './manifest.ts';
import { halfLayout } from './layout.ts';
import { pairKey, type Biome, type SlotState } from './model.ts';
import { FORGECOACH_PACK_URL } from './prefs.ts';

const FIVE: Biome[] = ['plains', 'island', 'swamp', 'mountain', 'forest'];
const slot = (b: Biome, index: number): SlotState => ({ biome: b, index, weight: 2, stage: 2, peak: 2 });
const json = (f: string) => JSON.parse(readFileSync(new URL(`./testdata/${f}`, import.meta.url), 'utf8'));

describe('pack-v9', () => {
  const bytes = readFileSync(new URL('./testdata/pack-v9.scenery.json', import.meta.url));
  const manifest = JSON.parse(bytes.toString('utf8'));
  const v8 = json('pack-v8.scenery.json');
  const r = validateManifest(manifest, `${FORGECOACH_PACK_URL}scenery.json`);
  const pack = r.pack!;
  it('is the default pack URL, and the snapshot is the file jsDelivr serves', () => {
    expect(FORGECOACH_PACK_URL).toBe('https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pack-v9/pack/');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('da512a3fa06433700f50f45d48ccab79e1cfdf9df9b2428903edb1cbc99fdbd1');
  });
  it('validates with no errors and exactly pack-v8’s warnings, written for spec 1.8', () => {
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual(validateManifest(v8, `${FORGECOACH_PACK_URL}scenery.json`).warnings);
    expect(pack.spec).toBe('1.8');
  });
  it('is pack-v8 with new bridge files and the island and plains full-area accents’ bytes, nothing else', () => {
    expect(manifest.half).toEqual(v8.half);
    expect(manifest.stageThresholds).toEqual(v8.stageThresholds);
    expect(Object.keys(manifest.bridges).sort()).toEqual(Object.keys(v8.bridges).sort());
    for (const [k, b] of Object.entries<Record<string, unknown>>(manifest.bridges)) {
      const old = v8.bridges[k];
      expect({ ...b, bytes: 0 }, k).toEqual({ ...old, bytes: 0 });
    }
    const strip = (m: { biomes: Record<string, { stages: { overlay?: { anchor?: string; bytes?: number }[] }[] }> }) =>
      JSON.parse(JSON.stringify(m.biomes, (key, v) => (key === 'bytes' ? 0 : v)));
    expect(strip(manifest)).toEqual(strip(v8));
    // Only the island's and the plains' full-area accents changed size.
    const sizes = (m: typeof v8) => Object.fromEntries(Object.entries<{ stages: { overlay?: { anchor?: string; src: string; bytes?: number }[] }[] }>(m.biomes).flatMap(([, bm]) => bm.stages.flatMap((st) => (st.overlay ?? []).filter((o) => o.anchor === 'area').map((o) => [o.src, o.bytes]))));
    const a = sizes(manifest);
    const b = sizes(v8);
    const changed = Object.keys(a).filter((k) => a[k] !== b[k]).sort();
    expect(changed).toEqual(['island/front-s4.webp', 'island/front-s5.webp', 'island/front-s6.webp', 'plains/front-s2.webp', 'plains/front-s3.webp', 'plains/front-s4.webp', 'plains/front-s5.webp', 'plains/front-s6.webp']);
  });
  it('has a bridge for each of the ten pairs at v8’s anchors, under the 3 MB budget', () => {
    expect(Object.keys(pack.bridges!)).toHaveLength(10);
    for (const b of Object.values(pack.bridges!)) {
      expect(b!.desktop.anchor).toEqual({ y: 0.725, width: 0.4 });
      expect(b!.phone!.anchor).toEqual({ y: 0.725, width: 0.6 });
    }
    expect(bridgeBytes(pack)).toBeGreaterThan(0);
    expect(bridgeBytes(pack)).toBeLessThanOrEqual(MAX_BRIDGE_BYTES);
  });
  it('draws a bridge between any two colours on one side, in either order (with no pair band)', () => {
    for (const a of FIVE)
      for (const b of FIVE) {
        if (a === b) continue;
        const [p] = bridgePlacements(halfLayout([slot(a, 0), slot(b, 1)], pack), pack, {});
        expect(p, `${a} | ${b}`).toMatchObject({ key: pairKey(a, b), mirror: a > b });
        expect(bridgeFor(pack, a, b)!.bridge).toBe(bridgeFor(pack, b, a)!.bridge);
      }
  });
});
