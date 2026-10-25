/*
 * ForgeCoach — ambience/pairs-v5.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * pairs-v5, the first pack written to spec 1.16.1 (sided painted-in
 * elements), and the pairs FORGECOACH_PAIRS_FULL_URL points at under
 * `?pairfull=1` (pairs-v4 before it): a snapshot of its pairs.json, written by
 * ~/scenery-packs/panoramas-v1/tools/make_pairs_v5.py from pairs-v4's
 * manifest (the file at its tag) and the painter's 240 element files,
 * published as two jsDelivr refs:
 *
 * - `@pairs-v5`: this manifest, pairs-v4's 30 desktop panoramas (6,473,776
 *   bytes) and the 120 desktop element pictures (21,547,230 bytes), named
 *   relatively: 28,021,006 bytes of pictures, about 28 MB with the manifest;
 * - `@pairs-v5-phone`: the 120 element phone pictures (28,586,838 bytes),
 *   named by absolute URL (desktop + phone together are 50.1 MB, past one ref).
 *
 * The base panoramas' phone pictures stay at `@pairs-v4` and pairs-v2's
 * halves and frames at `@pairs-v2`, by absolute URL. For a pair a+b, stage k
 * (2 and 3 only) and each of the three other colours C: `left` is
 * `s<k>+<C>L` (the feature on a's ground), `right` is `s<k>+<C>R` (on b's).
 * The file jsDelivr serves at
 * https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v5/pairs.json
 * is byte for byte this one (the sha256 below; compared on 2026-10-24).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { halfLayout } from './layout.ts';
import { BIOME_COLOUR } from './makeup.ts';
import { pairKey, type Biome, type SlotState } from './model.ts';
import { pairFullCandidates, pairFullCaption, pairFullPlan, type PairFullPair } from './pairfull.ts';
import { MAX_PAIRS_PACK_BYTES, pairElementEntryAt, pairHalfAt, pairPanoramaAt, pairsRefBytes, validatePairs } from './pairs.ts';
import { elementBiomes } from './pieces.ts';
import type { PieceColour } from './manifest.ts';
import { DEFAULT_PREFS, effectivePrefs, FORGECOACH_PAIRS_FULL_URL, FORGECOACH_PAIRS_URL, pairsUrlOf } from './prefs.ts';

const FIVE: Biome[] = ['plains', 'island', 'swamp', 'mountain', 'forest'];
const CDN = 'https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery';
const V5 = `${CDN}@pairs-v5/`;
const V5_PHONE = `${CDN}@pairs-v5-phone/`;
const V4 = `${CDN}@pairs-v4/`;
const V2 = `${CDN}@pairs-v2/`;
const T = [1, 2, 3, 4, 5, 6];
const slot = (b: Biome, index: number, weight: number): SlotState => ({ biome: b, index, weight, stage: Math.min(6, Math.ceil(weight)), peak: Math.min(6, Math.ceil(weight)) });
const MB50 = 50 * 1024 * 1024;

describe('pairs-v5', () => {
  const bytes = readFileSync(new URL('./testdata/pairs-v5.pairs.json', import.meta.url));
  const raw = JSON.parse(bytes.toString('utf8'));
  const r = validatePairs(raw, `${V5}pairs.json`);
  const pairs = r.pairs!;
  const v4 = JSON.parse(readFileSync(new URL('./testdata/pairs-v4.pairs.json', import.meta.url), 'utf8'));

  it('is the flag’s pairs URL (the board without the flag keeps pairs-v3.1)', () => {
    expect(FORGECOACH_PAIRS_FULL_URL).toBe(V5);
    expect(pairsUrlOf(effectivePrefs(DEFAULT_PREFS, '?pairfull=1', ''))).toBe(V5);
    expect(pairsUrlOf(effectivePrefs(DEFAULT_PREFS, '', ''))).toBe(FORGECOACH_PAIRS_URL);
    expect(FORGECOACH_PAIRS_URL).toMatch(/@pairs-v3\.1\/$/);
  });

  it('is the file jsDelivr serves byte for byte, under the 256 KB a pairs manifest may be', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('31450e7f09443c35101f90e0d8fb8652acb330893098cbebb59793c5b375f8ca');
    expect(bytes.length).toBeLessThan(256 * 1024);
  });

  it('validates with no errors, written for 1.16.1, one warning per pair: painted elements take it past 4 MB, as expected', () => {
    expect(r.errors).toEqual([]);
    expect(pairs.spec).toBe('1.16.1');
    expect(pairs.name).toBe('ForgeCoach pair scenery, pairs-v5');
    expect(r.warnings).toHaveLength(10);
    for (const w of r.warnings) expect(w).toMatch(/^pairs\.[a-z]+\+[a-z]+: \d+\.\d MB of stage pictures declared, \d+\.\d MB of them painted-in elements; the budget is 4 MB per pair, and a set of painted-in elements \(1\.16\) is expected to exceed it/);
    // No 45 MB warning: only the desktop files are in this ref.
    expect(r.warnings.some((w) => w.startsWith('pairs: '))).toBe(false);
  });

  it('is pairs-v4 with the base panoramas’ phone pictures named at @pairs-v4 and its bytes split by shape', () => {
    for (const [key, p4] of Object.entries<{ stages: { half: unknown; panorama: { bytes: number; phone: Record<string, unknown> } & Record<string, unknown> }[] }>(v4.pairs)) {
      const p5 = raw.pairs[key];
      expect(Object.keys(p5)).toEqual(Object.keys(p4));
      p4.stages.forEach((s4, i) => {
        const s5 = p5.stages[i];
        expect(s5.half).toEqual(s4.half);
        const { bytes: b4, phone: ph4, ...rest4 } = s4.panorama;
        const { bytes: b5, phone: ph5, ...rest5 } = s5.panorama;
        expect(rest5).toEqual(rest4);
        expect({ ...ph5, src: undefined, bytes: undefined }).toEqual({ ...ph4, src: undefined });
        expect(ph5.src).toBe(`${V4}${ph4.src}`);
        expect(b5 + ph5.bytes).toBe(b4);
      });
    }
  });

  it('has the three other colours, both sides, at stages 2 and 3 of every pair, and none at stage 1', () => {
    let desk = 0;
    let phone = 0;
    let n = 0;
    expect(Object.keys(pairs.pairs).sort()).toEqual(FIVE.flatMap((a, i) => FIVE.slice(i + 1).map((b) => pairKey(a, b))).sort());
    for (const p of Object.values(pairs.pairs)) {
      const slug = `${p!.left}-${p!.right}`;
      const others = FIVE.filter((b) => b !== p!.left && b !== p!.right).map((b) => BIOME_COLOUR[b]!);
      expect(p!.stages[0]!.elements).toBeUndefined();
      expect(pairHalfAt(p, 1)!.src).toBe(`${V2}pairs/${slug}/s1-half.webp`);
      for (const k of [1, 2, 3]) {
        const pano = pairPanoramaAt(p, k)!;
        expect([pano.src, pano.phone!.src]).toEqual([`${V5}pairs/${slug}/s${k}-panorama.webp`, `${V4}pairs/${slug}/s${k}-panorama-phone.webp`]);
        desk += pano.bytes!;
      }
      for (const k of [2, 3]) {
        expect(Object.keys(p!.stages[k - 1]!.elements!).sort()).toEqual([...others].sort());
        for (const c of others) {
          const e = pairElementEntryAt(p, k, c as PieceColour)!;
          expect(e.any).toBeNull();
          for (const [side, s] of [['left', 'L'], ['right', 'R']] as const) {
            const h = e[side]!;
            expect([h.src, h.src2x, h.phone!.src]).toEqual([`${V5}pairs/${slug}/s${k}+${c}${s}-panorama.webp`, null, `${V5_PHONE}pairs/${slug}/s${k}+${c}${s}-panorama-phone.webp`]);
            // The canvas is the panorama's: inherited, not restated.
            const pano = pairPanoramaAt(p, k)!;
            expect([h.width, h.height, h.focal, h.horizon, h.hour, h.key]).toEqual([3277, 640, pano.focal, pano.horizon, pano.hour, pano.key]);
            expect([h.phone!.width, h.phone!.height, h.phone!.horizon]).toEqual([1638, 1280, pano.phone!.horizon]);
            expect(h.bytes).toBeGreaterThan(50000);
            expect(h.phoneBytes).toBeGreaterThan(50000);
            desk += h.bytes!;
            phone += h.phoneBytes!;
            n++;
          }
        }
      }
    }
    expect(n).toBe(120);
    // The two tags: @pairs-v5 holds every desktop file (6,473,776 of base panoramas + 21,547,230 of elements) and the
    // manifest; @pairs-v5-phone the 28,586,838 of element phone pictures. Each under a jsDelivr ref's 50 MB.
    expect(desk).toBe(6473776 + 21547230);
    expect(pairsRefBytes(pairs)).toBe(desk);
    expect(desk + bytes.length).toBeLessThan(MAX_PAIRS_PACK_BYTES);
    expect(phone).toBe(28586838);
    expect(phone).toBeLessThan(MB50);
  });

  describe('the board under ?pairfull=1', () => {
    const plan = (slots: SlotState[], elements: ReadonlySet<Biome> | null = null) => pairFullPlan(halfLayout(slots, null), pairs, { thresholds: T, elements, slots });
    const pairOf = (items: ReturnType<typeof plan>) => items?.find((x): x is PairFullPair => x.kind === 'pair') ?? null;
    const src = (p: PairFullPair, phone = false) => pairFullCandidates(p, phone ? 1.2 : 3.2, phone)[0]!;

    it('the worked example (Plateau, Plains, Island): island+plains at stage 2, red painted on plains’s ground (R), mirrored', () => {
      // #ambience's Three colours: Plateau first (mountain ½ + plains ½), then Plains, then Island.
      const items = plan([slot('mountain', 0, 0.5), slot('plains', 0, 1.5), slot('island', 2, 1)]);
      const p = pairOf(items)!;
      expect(items).toHaveLength(1);
      expect([p.key, p.left, p.right, p.mirror, p.stage, p.element, p.elementSide]).toEqual(['island+plains', 'plains', 'island', true, 2, 'mountain', 'right']);
      const c = src(p);
      expect([c.painted, c.art.picture!.src]).toEqual(['R', `${V5}pairs/island-plains/s2+RR-panorama.webp`]);
      expect(src(p, true).art.picture!.src).toBe(`${V5_PHONE}pairs/island-plains/s2+RR-panorama-phone.webp`);
      expect(pairFullCaption(items)).toContain("R painted in, on plains's ground");
    });

    it('the other side when the key’s first colour is the heavier; stage 3 at five lands', () => {
      const p = pairOf(plan([slot('island', 0, 3), slot('plains', 1, 1.5), slot('mountain', 2, 0.5)]))!;
      expect([p.mirror, p.stage, p.elementSide]).toEqual([false, 3, 'left']);
      expect(src(p).art.picture!.src).toBe(`${V5}pairs/island-plains/s3+RL-panorama.webp`);
    });

    it('four colours: the three heaviest kept, the fourth weighing nothing, its land still growing the stage', () => {
      // forest 2, swamp 1.5, island 1, plains 0.5: forest+swamp, island the third, plains dropped; six lands → stage 3.
      const p = pairOf(plan([slot('forest', 0, 2), slot('swamp', 1, 1.5), slot('island', 2, 1), slot('plains', 3, 0.5)]))!;
      expect([p.key, p.stage, p.element, p.elementSide]).toEqual(['forest+swamp', 3, 'island', 'left']);
      expect(src(p).art.picture!.src).toBe(`${V5}pairs/forest-swamp/s3+UL-panorama.webp`);
    });

    it('stage 1 (a third colour on two lands): no painted picture; the cut-out with a pack that has one, else the panel', () => {
      // Plateau and Tundra: plains 1, mountain ½, island ½ -- mountain+plains (mountain arrived first), island the third, two lands.
      const s = [slot('mountain', 0, 0.5), slot('plains', 0, 1), slot('island', 1, 0.5)];
      expect(pairElementEntryAt(pairs.pairs['mountain+plains'], 1, 'U')).toBeNull();
      expect(plan(s)!.map((x) => x.kind)).toEqual(['pair', 'slot']);
      const cut = pairOf(plan(s, elementBiomes({ elements: { U: {} } } as never)))!;
      expect([cut.key, cut.stage, cut.element]).toEqual(['mountain+plains', 1, 'island']);
      expect(pairFullCandidates(cut, 3.2, false)[0]!.painted).toBeNull();
    });
  });
});
