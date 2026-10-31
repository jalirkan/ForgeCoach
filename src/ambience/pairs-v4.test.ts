/*
 * ForgeCoach — ambience/pairs-v4.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * pairs-v4, the whole-half panoramas (spec 1.15) that PAIRS_V4
 * pointed at under `?pairfull=1` until pairs-v5 (`pairs-v5.test.ts`) took its
 * place; the tag stays up, and pairs-v5 is this manifest painted in: a snapshot of its pairs.json, byte for byte
 * what jsDelivr serves at
 * https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v4/pairs.json
 * (sha256 67b27eb08b1d3ebbefd8455a18ef65d2fd4ecb148b1c49023fe6c116aff25c33,
 * compared with `cmp` against the CDN's copy on 2026-10-23, and every picture
 * it names warmed from the CDN with no failure). pairs-v2's ten band pairs --
 * their halves and frames still at `@pairs-v2`, by absolute URL -- with a
 * `panorama` on every stage: one place 1.6 × the half's 16:5 (3277 × 640, the
 * key's first biome the ground at the left end, the second at the right, the
 * transition at focal.x) and a 1.28:1 phone panorama (1638 × 1280), each with
 * its measured horizon and the stage's painted hour and key. Justin judged the
 * pictures "really, really awesome" (2026-10-22) and had them published
 * (2026-10-23).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { halfLayout } from './layout.ts';
import { pairKey, type Biome, type SlotState } from './model.ts';
import { pairFullArt, pairFullElementRegion, pairFullFrame, pairFullPlan, pairFullView } from './pairfull.ts';
import { DEFAULT_STAGE_MAP, MAX_PAIRS_PACK_BYTES, pairHalfAt, pairPanoramaAt, pairsBytes, pairsRefBytes, validatePairs, PAIRS_SPEC } from './pairs.ts';

const FIVE: Biome[] = ['plains', 'island', 'swamp', 'mountain', 'forest'];
const V2 = 'https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v2/';
const PAIRS_V4 = 'https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v4/';
const PACK_V9_THRESHOLDS = [1, 2, 3, 4, 5, 6];
const slot = (b: Biome, index: number, weight: number): SlotState => ({ biome: b, index, weight, stage: Math.min(6, Math.ceil(weight)), peak: Math.min(6, Math.ceil(weight)) });

describe('pairs-v4', () => {
  const bytes = readFileSync(new URL('./testdata/pairs-v4.pairs.json', import.meta.url));
  const raw = JSON.parse(bytes.toString('utf8'));
  const r = validatePairs(raw, `${PAIRS_V4}pairs.json`);
  const pairs = r.pairs!;

  it('is the file jsDelivr serves at its own tag', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('67b27eb08b1d3ebbefd8455a18ef65d2fd4ecb148b1c49023fe6c116aff25c33');
  });

  it('validates with no errors, written for spec 1.15, and one budget warning: mountain+swamp’s stage pictures (its pairs-v2 halves counted)', () => {
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual(['pairs.mountain+swamp: 4.1 MB of stage pictures declared; their budget is 4 MB per pair (pictures kept)']);
    // The reader knows 1.16 (painted-in elements) since the scenery fixes, 1.16.1 (sided ones) since pairs-v5, 1.17 (the seam grid, a draft) since the grid, 1.18 (its phone and painted-in cells) since grid-phone; pairs-v4 is written for 1.15.
    expect(PAIRS_SPEC).toBe('1.18');
    expect(pairs.spec).toBe('1.15');
    expect(pairs.name).toBe('ForgeCoach pair scenery, pairs-v4');
    expect(pairs.note).toBe(raw.note);
  });

  it('has the ten pairs, every one a band pair with pairs-v2’s halves and a panorama on each of its three stages', () => {
    expect(Object.keys(pairs.pairs).sort()).toEqual(FIVE.flatMap((a, i) => FIVE.slice(i + 1).map((b) => pairKey(a, b))).sort());
    for (const p of Object.values(pairs.pairs)) {
      const slug = `${p!.left}-${p!.right}`;
      expect(p!.kind).toBe('band');
      expect(p!.stageMap).toEqual(DEFAULT_STAGE_MAP);
      expect(p!.stages).toHaveLength(3);
      p!.stages.forEach((s, i) => {
        expect(pairHalfAt(p, i + 1)!.src).toBe(`${V2}pairs/${slug}/s${i + 1}-half.webp`);
        const pano = pairPanoramaAt(p, i + 1)!;
        expect([pano.src, pano.src2x, pano.phone!.src]).toEqual([`${PAIRS_V4}pairs/${slug}/s${i + 1}-panorama.webp`, null, `${PAIRS_V4}pairs/${slug}/s${i + 1}-panorama-phone.webp`]);
        expect([pano.width, pano.height, pano.phone!.width, pano.phone!.height]).toEqual([3277, 640, 1638, 1280]);
        expect(pano.focal.x).toBe(0.5);
        expect(pano.horizon).toBeGreaterThan(0.4);
        expect(pano.horizon).toBeLessThan(0.55);
        expect(pano.phone!.horizon).toBeGreaterThan(0.4);
        expect(s.half!.hour).toBeUndefined();
        expect(pano.bytes).toBeGreaterThan(0);
      });
      expect(p!.transitions!.steps.every((st) => st.frames.every((f) => f.src.startsWith(V2)))).toBe(true);
    }
  });

  it('carries each panorama’s painted hour and light key, morning or dawn at stage 1 to dusk or night at stage 3', () => {
    for (const p of Object.values(pairs.pairs)) {
      const [a, b, c] = [1, 2, 3].map((k) => pairPanoramaAt(p, k)! as { hour?: number; key?: string });
      expect(['dawn', 'morning']).toContain(a!.key);
      expect(['afternoon', 'dusk']).toContain(b!.key);
      expect(['dusk', 'night']).toContain(c!.key);
      expect(a!.hour! < b!.hour! && b!.hour! < c!.hour!).toBe(true);
    }
  });

  it('declares 47,094,486 bytes (pairs-v2’s halves and frames included), inside the reader’s pairs budget; the tag itself holds 14.6 MB', () => {
    expect(pairsBytes(pairs)).toBe(47094486);
    expect(pairsBytes(pairs)).toBeLessThan(MAX_PAIRS_PACK_BYTES);
    const own = Object.values(raw.pairs as Record<string, { stages: { panorama: { bytes: number } }[] }>).reduce((n, p) => n + p.stages.reduce((m, s) => m + s.panorama.bytes, 0), 0);
    expect(own).toBe(14530662);
    // The 45 MB warning counts only the tag's own files (review fault 7): pairs-v2's halves and frames, named at their own tag, cost it nothing.
    expect(pairsRefBytes(pairs)).toBe(own);
  });

  it('draws the panorama across the whole half at every share, its transition landing at the share, the pair stage from the total lands', () => {
    const cases: [number, number, number][] = [
      // island lands, plains lands, pair stage
      [1, 1, 1],
      [3, 1, 2],
      [4, 1, 3],
      [6, 1, 3],
    ];
    for (const [i, p, stage] of cases) {
      const layout = halfLayout([slot('island', 0, i), slot('plains', 1, p)], null);
      const plan = pairFullPlan(layout, pairs, { thresholds: PACK_V9_THRESHOLDS })!;
      expect(plan).toHaveLength(1);
      const it0 = plan[0]!;
      if (it0.kind !== 'pair') throw new Error('pair');
      expect([it0.key, it0.mirror, it0.stage]).toEqual(['island+plains', false, stage]);
      const art = pairFullArt(pairHalfAt(it0.pair, it0.stage), pairPanoramaAt(it0.pair, it0.stage), 16 / 5, false)!;
      expect(art.picture!.src).toBe(`${PAIRS_V4}pairs/island-plains/s${stage}-panorama.webp`);
      const f = pairFullFrame({ w: 1600, h: 500 }, art, it0.split);
      expect(f.width).toBeCloseTo(1.6, 3);
      expect(f.seamAt).toBeCloseTo(it0.split, 3);
    }
  });

  it('exposes the split and pan 1.14’s pieces stand on: each colour’s ground, the horizon through the crop, an element’s region short of the transition', () => {
    // Five Plains and two Islands, Plains first: the board has the pair the other way round from its key (mirrored).
    const layout = halfLayout([slot('plains', 0, 5), slot('island', 1, 2)], null);
    const plan = pairFullPlan(layout, pairs, { thresholds: PACK_V9_THRESHOLDS })!;
    const p = plan[0]!;
    if (p.kind !== 'pair') throw new Error('pair');
    expect([p.left, p.right, p.mirror, p.split, p.stage]).toEqual(['plains', 'island', true, 0.7143, 3]);
    const box = { w: 1600, h: 500 };
    const art = pairFullArt(pairHalfAt(p.pair, 3), pairPanoramaAt(p.pair, 3), box.w / box.h, false)!;
    const v = pairFullView(plan, box, art)!;
    expect(v.panel).toEqual({ left: 0, width: 1 });
    expect(v.seamAt).toBeCloseTo(0.7143, 3);
    expect(v.ground.left).toEqual({ left: 0, width: v.seamAt });
    expect(v.ground.right.left).toBe(v.seamAt);
    expect(v.ground.left.width + v.ground.right.width).toBeCloseTo(1, 4);
    expect(v.horizonY).toBeGreaterThan(0.3);
    expect(v.horizonY).toBeLessThan(0.7);
    // The heavier colour (plains, on the left here) holds the element, stopping 0.05 short of the transition.
    const el = pairFullElementRegion(v, 'left');
    expect(el.left).toBe(0);
    expect(el.width).toBeCloseTo(v.seamAt - 0.05, 4);
    const er = pairFullElementRegion(v, 'right');
    expect(er.left).toBeCloseTo(v.seamAt + 0.05, 4);
    expect(er.left + er.width).toBeCloseTo(1, 4);
  });

  it('draws the phone panorama on a phone, through the same pan', () => {
    const layout = halfLayout([slot('forest', 0, 2), slot('swamp', 1, 2)], null);
    const plan = pairFullPlan(layout, pairs, { thresholds: PACK_V9_THRESHOLDS })!;
    const p = plan[0]!;
    if (p.kind !== 'pair') throw new Error('pair');
    const art = pairFullArt(pairHalfAt(p.pair, p.stage), pairPanoramaAt(p.pair, p.stage), 356 / 170, true)!;
    expect(art.source).toBe('phone');
    expect(art.picture!.src).toBe(`${PAIRS_V4}pairs/forest-swamp/s2-panorama-phone.webp`);
    expect(pairFullFrame({ w: 356, h: 170 }, art, 0.5).seamAt).toBeCloseTo(0.5, 3);
  });
});
