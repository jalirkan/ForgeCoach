/*
 * ForgeCoach — ambience/pack-v10.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * pack-v10 (spec 1.14, tagged 2026-11-06): the pack FORGECOACH_PACK_URL points
 * at. Every stage's half and phone picture painted in oil (oil-v2: four lands
 * redesigned by Justin on 2026-11-05, the forest's tree houses oil-v1's byte
 * for byte), and the pack v9.2 pictures that drew over or beside them dropped
 * from `scenery.json`: every strip `sky` image layer, every full-area accent
 * (`overlay`), every biome's 1.7 `transitions`, the island's and the
 * mountain's stage-6 loops and the top-level `bridges`. The forest's, the
 * plains' and the swamp's stage-6 loops, every biome's `effects` and the
 * `pieces` block at `@pieces-v1` stay. A snapshot of its scenery.json, byte
 * for byte what jsDelivr serves at the tag
 * (https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pack-v10/pack/scenery.json),
 * taken when FORGECOACH_PACK_URL moved to it. pack-v9.2 stays at its tag
 * (pack-v9-2.test.ts).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pieceUrls, validateManifest } from './manifest.ts';
import { FORGECOACH_PACK_URL } from './prefs.ts';

const V10 = 'https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pack-v10/pack/';
const PIECES = 'https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pieces-v1/';

describe('pack-v10', () => {
  const bytes = readFileSync(new URL('./testdata/pack-v10.scenery.json', import.meta.url));
  const manifest = JSON.parse(bytes.toString('utf8'));
  const r = validateManifest(manifest, `${V10}scenery.json`);
  const pack = r.pack!;
  const biomes = Object.entries<Record<string, any>>(manifest.biomes);

  it('is the default pack URL, and the snapshot is the file jsDelivr serves', () => {
    expect(FORGECOACH_PACK_URL).toBe(V10);
    expect(bytes.length).toBe(30_431);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('59a688c1a725f8685fe8e5d0f36fe8bf8a62b37518d19196cc43a1ab36e3d666');
  });

  it('validates with no errors and no warnings, written for spec 1.14', () => {
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(pack.spec).toBe('1.14');
    expect(manifest.name).toMatch(/pack v10/);
  });

  it('names every piece at @pieces-v1', () => {
    const urls = [...pieceUrls(pack.pieces!, { phone: false }), ...pieceUrls(pack.pieces!, { phone: true })];
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u.startsWith(PIECES), u).toBe(true);
  });

  it('draws no pack v9.2 picture: no transitions, no overlay, no image layer, no bridges', () => {
    expect(manifest.bridges).toBeUndefined();
    expect(biomes.map(([b]) => b).sort()).toEqual(['forest', 'island', 'mountain', 'plains', 'swamp']);
    for (const [b, biome] of biomes) {
      expect(biome.transitions, b).toBeUndefined();
      expect(biome.stages, b).toHaveLength(6);
      for (const [i, st] of biome.stages.entries()) {
        expect(st.overlay, `${b} s${i + 1}`).toBeUndefined();
        expect((st.layers ?? []).filter((l: Record<string, unknown>) => l.kind !== 'video'), `${b} s${i + 1}`).toEqual([]);
      }
    }
  });

  it('keeps a stage-6 loop on the forest, the plains and the swamp only, and every biome its effects', () => {
    const loops = biomes.flatMap(([b, biome]) => biome.stages.flatMap((st: Record<string, any>, i: number) => (st.layers ?? []).map((l: Record<string, unknown>) => `${b} s${i + 1} ${l.id}`)));
    expect(loops.sort()).toEqual(['forest s6 fireflies', 'plains s6 motes', 'swamp s6 wisps']);
    for (const [b, biome] of biomes) expect(Object.keys(biome.effects ?? {}).length, b).toBeGreaterThan(0);
  });

  it('names every half’s four pictures relatively, in this tag', () => {
    let halves = 0;
    for (const [b, biome] of biomes) {
      for (const [i, st] of biome.stages.entries()) {
        const h = st.half;
        const srcs = [h.src, h.src2x, h.phone.src, h.phone.src2x];
        for (const s of srcs) {
          expect(typeof s, `${b} s${i + 1}`).toBe('string');
          expect(/^[a-z]+:|^\//.test(s), `${b} s${i + 1}: ${s}`).toBe(false);
          expect(s.startsWith(`${b}/s${i + 1}-`), `${b} s${i + 1}: ${s}`).toBe(true);
        }
        halves++;
      }
    }
    expect(halves).toBe(30);
  });
});
