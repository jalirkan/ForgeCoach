/*
 * ForgeCoach — ambience/pack-v9-1.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * pack-v9.1 (spec 1.13): pack-v9 with no picture changed, each stage's half
 * picture (and its phone picture) carrying the horizon the PC measured off
 * the painting, and the stage its painted hour and light key (pc-results
 * scenery/LIGHT.md, light.json, 2026-10-22: the estimate from the subject
 * band was off by more than 0.03 on 57 of 124 pictures). A snapshot of its
 * scenery.json, byte for byte what jsDelivr serves at the tag, taken when
 * FORGECOACH_PACK_URL moved to it. pack-v9 stays at its tag (pack-v9.test.ts).
 * (The default is pack-v9.2 now, pack-v9.1 plus the 1.14 pieces: pack-v9-2.test.ts.)
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIGHT_KEYS, validateManifest } from './manifest.ts';
import { halfArtOf, horizonOf } from './layout.ts';
import { FORGECOACH_PACK_URL } from './prefs.ts';

const json = (f: string) => JSON.parse(readFileSync(new URL(`./testdata/${f}`, import.meta.url), 'utf8'));
type Half = { horizon?: number; hour?: number; key?: string; phone: { horizon?: number } };
const halves = (m: { biomes: Record<string, { stages: { half?: Half }[] }> }) => Object.entries(m.biomes).flatMap(([b, bm]) => bm.stages.map((st, i) => ({ id: `${b} s${i + 1}`, half: st.half! })));

describe('pack-v9.1', () => {
  const bytes = readFileSync(new URL('./testdata/pack-v9.1.scenery.json', import.meta.url));
  const manifest = JSON.parse(bytes.toString('utf8'));
  const v9 = json('pack-v9.scenery.json');
  const r = validateManifest(manifest, `${FORGECOACH_PACK_URL}scenery.json`);
  const pack = r.pack!;

  it('the snapshot is the file jsDelivr serves', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('8e5f051b53211a5bcdb07710f14e99866f73ef85c5a34821978bfe099375fa38');
  });

  it('validates with no errors and exactly pack-v9’s warnings, written for spec 1.13', () => {
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual(validateManifest(v9, `${FORGECOACH_PACK_URL}scenery.json`).warnings);
    expect(pack.spec).toBe('1.13');
  });

  it('is pack-v9 plus horizon, hour and key on the half pictures, nothing else', () => {
    const drop = (m: unknown) => JSON.parse(JSON.stringify(m, (k, v) => (k === 'horizon' || k === 'hour' || k === 'key' || k === 'spec' || k === 'name' ? undefined : v)));
    expect(drop(manifest)).toEqual(drop(v9));
  });

  it('declares every stage’s horizons (desktop and phone), hour and key, and the reader keeps them', () => {
    const all = halves(manifest);
    expect(all).toHaveLength(30);
    for (const { id, half } of all) {
      expect(half.horizon, id).toBeGreaterThanOrEqual(0.4);
      expect(half.horizon, id).toBeLessThanOrEqual(0.55);
      expect(half.phone.horizon, id).toBeGreaterThanOrEqual(0.47);
      expect(half.phone.horizon, id).toBeLessThanOrEqual(0.55);
      expect(half.hour, id).toBeGreaterThanOrEqual(0);
      expect(half.hour, id).toBeLessThanOrEqual(24);
      expect(LIGHT_KEYS, id).toContain(half.key);
    }
    const island1 = pack.biomes.island!.stages[0]!.half!;
    expect([island1.horizon, island1.phone!.horizon, island1.hour, island1.key]).toEqual([0.43, 0.47, 6.5, 'dawn']);
    const mountain2 = pack.biomes.mountain!.stages[1]!.half!;
    // The mountain's ground line sits low (its peaks stand above it): the band's estimate put it at 0.43.
    expect(horizonOf(mountain2)).toBe(0.55);
    expect(halfArtOf(mountain2, 16 / 5, { horizon: true }).focalTo).toBeDefined();
  });

  it('the old reader’s view of a picture is unchanged (only the new fields are added)', () => {
    const p9 = validateManifest(v9, `${FORGECOACH_PACK_URL}scenery.json`).pack!;
    const plain = ({ horizon: _h, hour: _r, key: _k, phone, ...rest }: Record<string, unknown> & { phone: Record<string, unknown> | null }) => ({ ...rest, phone: phone && { ...phone, horizon: undefined } });
    for (const b of Object.keys(p9.biomes) as (keyof typeof p9.biomes)[])
      p9.biomes[b]!.stages.forEach((st, i) => expect(plain(pack.biomes[b]!.stages[i]!.half as never), `${b} s${i + 1}`).toEqual(plain(st.half as never)));
  });
});
