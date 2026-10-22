/*
 * ForgeCoach — ambience/pairfull.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.13 draft (`?pairfull=1`): when the half has exactly two live biomes
 * and a pictured pair, the plan is the pair picture alone, its split the land
 * share and its stage from the total lands; three biomes put the heaviest
 * pictured pair beside the third's panel; anything else is null (the half as
 * today). The frame pans the transition to the split (and its CSS twin is the
 * same math); the flag is off unless the page asks, and with it ForgeCoach's
 * own pack defaults to the whole-half pairs.
 */
import { describe, expect, it } from 'vitest';
import { halfLayout } from './layout.ts';
import type { Biome, SlotState } from './model.ts';
import { pairHalfAt, pairPanoramaAt, validatePairs, type PairsPack } from './pairs.ts';
import { PAIR_FULL_MAX_ZOOM, pairFullArt, pairFullCaption, pairFullFrame, pairFullFrameCss, pairFullPlan, pairFullSplit, pairFullStage, pairFullZoom, type PairFullPair } from './pairfull.ts';
import { DEFAULT_PREFS, effectivePrefs, FORGECOACH_PAIRS_FULL_URL, FORGECOACH_PAIRS_URL, pairsUrlOf } from './prefs.ts';

const BASE = 'http://127.0.0.1:8654/pairs-v2/';
const slot = (biome: Biome, index: number, weight: number, stage: number): SlotState => ({ biome, index, weight, stage, peak: stage });
const stages = (key: string) => [1, 2, 3].map((n) => ({ half: { src: `pairs/${key}/s${n}-half.webp`, phone: { src: `pairs/${key}/s${n}-phone.webp` } } }));
const motifStages = (key: string) => [1, 2, 3].map((n) => ({ motif: { src: `pairs/${key}/s${n}-motif.webp`, width: 532, height: 640 } }));

function pairsPack(): PairsPack {
  const r = validatePairs(
    {
      schema: 1,
      pairs: {
        'island+plains': { dual: 'Tundra', shock: 'Hallowed Fountain', stages: stages('island-plains') },
        'island+mountain': { dual: 'Volcanic Island', shock: 'Steam Vents', stages: stages('island-mountain') },
        'forest+swamp': { dual: 'Bayou', shock: 'Overgrown Tomb', stages: stages('forest-swamp') },
        'forest+island': { dual: 'Tropical Island', stages: motifStages('forest-island') },
      },
    },
    BASE,
  );
  expect(r.errors).toEqual([]);
  return r.pairs!;
}
/** ForgeCoach's own pack's thresholds: one stage per land. */
const T = [1, 2, 3, 4, 5, 6];
const plan = (slots: SlotState[], opts: { stageOverride?: number | null } = {}) => pairFullPlan(halfLayout(slots, null), pairsPack(), { thresholds: T, ...opts });
const pairOf = (items: ReturnType<typeof plan>) => items?.find((x): x is PairFullPair => x.kind === 'pair') ?? null;

describe('spec 1.13 draft: the plan', () => {
  it('draws the pair picture across the whole half for exactly two live biomes with a pictured pair', () => {
    const items = plan([slot('island', 0, 4, 4), slot('plains', 1, 1, 1)]);
    expect(items).toHaveLength(1);
    const p = pairOf(items)!;
    expect(p).toMatchObject({ kind: 'pair', key: 'island+plains', left: 'island', right: 'plains', mirror: false, weights: [4, 1], split: 0.8, share: 1 });
    // The board the other way round from the key: mirrored, the split still the board's left biome's.
    const m = pairOf(plan([slot('plains', 0, 1, 1), slot('island', 1, 4, 4)]))!;
    expect(m).toMatchObject({ mirror: true, left: 'plains', right: 'island', split: 0.2 });
  });

  it('takes the stage from the total lands, not the lower neighbour (1.9) and not the duals', () => {
    // 6 Islands : 1 Plains is a seven-land half: pair stage 3 (1.9's lower neighbour would say 1).
    expect(pairOf(plan([slot('island', 0, 6, 6), slot('plains', 1, 1, 1)]))!.stage).toBe(3);
    // One of each: two lands, pair stage 1; 2 + 1: three lands, pair stage 2; no dual needed.
    expect(pairOf(plan([slot('island', 0, 1, 1), slot('plains', 1, 1, 1)]))!.stage).toBe(1);
    expect(pairOf(plan([slot('island', 0, 2, 2), slot('plains', 1, 1, 1)]))!.stage).toBe(2);
    // A lone Tundra: ½ + ½, one land, stage 1.
    expect(pairOf(plan([slot('island', 0, 0.5, 1), slot('plains', 1, 0.5, 1)]))!.stage).toBe(1);
    // The preview's stage slider wins.
    expect(pairOf(plan([slot('island', 0, 1, 1), slot('plains', 1, 1, 1)], { stageOverride: 5 }))!.stage).toBe(3);
    const pair = pairsPack().pairs['island+plains']!;
    expect([1, 2, 3, 4, 5, 6, 9].map((n) => pairFullStage(pair, n, T))).toEqual([1, 1, 2, 2, 3, 3, 3]);
  });

  it('clamps the split so the lighter colour keeps a fifth', () => {
    expect(pairFullSplit(1, 1)).toBe(0.5);
    expect(pairFullSplit(4, 1)).toBe(0.8);
    expect(pairFullSplit(9, 1)).toBe(0.8);
    expect(pairFullSplit(1, 9)).toBe(0.2);
    expect(pairFullSplit(3, 1)).toBe(0.75);
    expect(pairFullSplit(0, 0)).toBe(0.5);
  });

  it('is null where the half is drawn as today', () => {
    // One biome, no pairs pack, a pair with no entry, a motif pair (no `half` to fill a half with).
    expect(plan([slot('island', 0, 3, 3)])).toBeNull();
    expect(pairFullPlan(halfLayout([slot('island', 0, 1, 1), slot('plains', 1, 1, 1)], null), null)).toBeNull();
    expect(plan([slot('plains', 0, 1, 1), slot('forest', 1, 1, 1)])).toBeNull();
    expect(plan([slot('forest', 0, 1, 1), slot('island', 1, 1, 1)])).toBeNull();
  });

  it('leaves a withered biome out: the picture is the half', () => {
    const items = plan([slot('island', 0, 2, 2), slot('mountain', 1, 0, 0), slot('plains', 2, 2, 2)]);
    expect(items).toHaveLength(1);
    expect(pairOf(items)).toMatchObject({ key: 'island+plains', share: 1, split: 0.5 });
  });

  it('three biomes: the heaviest pictured pair, the third as a panel on its side', () => {
    // Island 3, plains 2, mountain 1 (arrival island, plains, mountain): island+plains is heaviest; mountain on the right.
    const a = plan([slot('island', 0, 3, 3), slot('plains', 1, 2, 2), slot('mountain', 2, 1, 1)])!;
    expect(a.map((x) => x.kind)).toEqual(['pair', 'slot']);
    expect(pairOf(a)).toMatchObject({ key: 'island+plains', left: 'island', right: 'plains', split: 0.6, stage: 3 });
    const third = a[1]!;
    expect(third).toMatchObject({ kind: 'slot', biome: 'mountain', index: 2 });
    // The third keeps its halfLayout share (1 of 6 lands), the picture the rest.
    expect(third.share).toBeCloseTo(1 / 6, 2);
    expect(pairOf(a)!.share).toBeCloseTo(5 / 6, 2);
    // A sliver of a third is floored at minShare (0.15), as today.
    const f = plan([slot('island', 0, 6, 6), slot('plains', 1, 3, 3), slot('mountain', 2, 0.5, 1)])!;
    expect(f[1]!.share).toBeCloseTo(0.15, 3);
    // The third arrived first: its panel on the left.
    const b = plan([slot('mountain', 0, 1, 1), slot('island', 1, 3, 3), slot('plains', 2, 2, 2)])!;
    expect(b.map((x) => (x.kind === 'pair' ? x.key : x.biome))).toEqual(['mountain', 'island+plains']);
    // The heaviest pair with no picture loses to a pictured one: forest+island is a motif pair.
    const c = plan([slot('forest', 0, 4, 4), slot('island', 1, 3, 3), slot('plains', 2, 1, 1)])!;
    expect(pairOf(c)!.key).toBe('island+plains');
    expect(c.map((x) => (x.kind === 'pair' ? x.key : x.biome))).toEqual(['forest', 'island+plains']);
  });

  it('four biomes fold to three first (1.10), the folded weight counted in the pair', () => {
    // Case 4's opponent: Bayou, Island, Tundra → swamp ½, forest ½, island 1½, plains ½ → three panels.
    const layout = halfLayout([slot('swamp', 0, 0.5, 1), slot('forest', 1, 0.5, 1), slot('island', 2, 1.5, 1), slot('plains', 3, 0.5, 1)], null);
    expect(layout).toHaveLength(3);
    const items = pairFullPlan(layout, pairsPack(), { thresholds: T });
    expect(items).not.toBeNull();
    expect(items!.filter((x) => x.kind === 'pair')).toHaveLength(1);
  });

  it('captions the plan for the preview page', () => {
    expect(pairFullCaption(plan([slot('island', 0, 4, 4), slot('plains', 1, 1, 1)]))).toBe('Tundra (Hallowed Fountain), whole half: island 80% | plains 20%, pair stage 3');
    expect(pairFullCaption(null)).toBeNull();
  });
});

/** Evaluate a CSS length in a box (cqw / cqh), as half.test.ts does for halfFrameCss. */
function evalCss(expr: string, w: number, h: number): number {
  const js = expr
    .replace(/(\d+(?:\.\d+)?)cqw/g, `($1*${w}/100)`)
    .replace(/(\d+(?:\.\d+)?)cqh/g, `($1*${h}/100)`)
    .replace(/0px/g, '0')
    .replace(/calc\(/g, '(')
    .replace(/clamp\(/g, 'CL(')
    .replace(/\bmin\(/g, 'Math.min(')
    .replace(/\bmax\(/g, 'Math.max(');
  return new Function('CL', `return ${js};`)((lo: number, v: number, hi: number) => Math.max(lo, Math.min(v, hi)));
}

describe('spec 1.13 draft: the frame pans the transition to the land share', () => {
  const desktop = { aspect: 3.2, focal: { x: 0.5, y: 0.475 }, safe: { x: 0.25, y: 0.35, w: 0.5, h: 0.25 } };
  const phone = { aspect: 0.8, focal: { x: 0.5, y: 0.475 }, safe: { x: 0.25, y: 0.425, w: 0.5, h: 0.125 } };

  it('zooms just enough for the transition to land at the split', () => {
    expect(pairFullZoom(0.5, 0.5)).toBe(1);
    expect(pairFullZoom(0.8, 0.5)).toBe(1.6);
    expect(pairFullZoom(0.2, 0.5)).toBe(1.6);
    expect(pairFullZoom(0.6, 0.5)).toBe(1.2);
    expect(pairFullZoom(0.95, 0.5)).toBe(1.6);
    // A transition painted off centre: capped.
    expect(pairFullZoom(0.8, 0.3)).toBe(PAIR_FULL_MAX_ZOOM);
  });

  it('0.5 shows the whole picture about its own focal; 0.8 pans 0.3 of the width toward the heavier side', () => {
    // A desktop half, 1600 × 400 (4 : 1): the 16 : 5 picture covers it at full width.
    const even = pairFullFrame({ w: 1600, h: 400 }, desktop, 0.5);
    expect(even).toMatchObject({ left: 0, width: 1, seamAt: 0.5 });
    const heavy = pairFullFrame({ w: 1600, h: 400 }, desktop, 0.8);
    expect(heavy.width).toBe(1.6);
    expect(heavy.left).toBe(0);
    expect(heavy.seamAt).toBe(0.8);
    // The view's centre is 0.3125 into the picture: the heavier (left) colour fills four fifths of the half.
    expect((0.5 - heavy.left) / heavy.width).toBeCloseTo(0.3125, 4);
    const light = pairFullFrame({ w: 1600, h: 400 }, desktop, 0.2);
    expect(light).toMatchObject({ left: -0.6, width: 1.6, seamAt: 0.2 });
    // The subject band stays whole vertically (the 1.5 crop): 0.35–0.6 of the picture inside the box.
    const top = -heavy.top / heavy.height;
    const shown = 1 / heavy.height;
    expect(top).toBeLessThanOrEqual(0.35 + 1e-4);
    expect(top + shown).toBeGreaterThanOrEqual(0.6 - 1e-4);
  });

  it('pans the phone picture the same way on a phone-shaped half', () => {
    const f = pairFullFrame({ w: 376, h: 176 }, phone, 0.75);
    expect(f.seamAt).toBeCloseTo(0.75, 3);
    expect(f.width).toBeCloseTo(1.5, 3);
  });

  it('its CSS twin is the same math', () => {
    const boxes = [
      [1600, 400],
      [1600, 640],
      [900, 500],
      [376, 176],
      [300, 300],
    ];
    for (const art of [desktop, phone, { ...desktop, safe: null }, { ...desktop, focal: { x: 0.4, y: 0.5 } }])
      for (const split of [0.2, 0.35, 0.5, 0.65, 0.8])
        for (const [w, h] of boxes) {
          const css = pairFullFrameCss(art, split);
          const n = pairFullFrame({ w: w!, h: h! }, art, split);
          const at = `${w}x${h} split ${split}`;
          expect(evalCss(css.width, w!, h!) / w!, `${at} width`).toBeCloseTo(n.width, 3);
          expect(evalCss(css.height, w!, h!) / h!, `${at} height`).toBeCloseTo(n.height, 3);
          expect(evalCss(css.left, w!, h!) / w!, `${at} left`).toBeCloseTo(n.left, 3);
          expect(evalCss(css.top, w!, h!) / h!, `${at} top`).toBeCloseTo(n.top, 3);
        }
  });
});

describe('spec 1.13 draft: the flag', () => {
  it('is off unless the page asks, and never changes the stored prefs', () => {
    expect(effectivePrefs(DEFAULT_PREFS, '', '').pairFull).toBeUndefined();
    expect(effectivePrefs(DEFAULT_PREFS, '?pairfull=0', '').pairFull).toBeUndefined();
    expect(effectivePrefs(DEFAULT_PREFS, '?pairfull=1', '').pairFull).toBe(true);
    expect(effectivePrefs(DEFAULT_PREFS, '', '#ambience?pairfull=on').pairFull).toBe(true);
  });

  it('with it, ForgeCoach’s own pack defaults to the whole-half pairs; ?pairs= still wins', () => {
    expect(pairsUrlOf(effectivePrefs(DEFAULT_PREFS, '', ''))).toBe(FORGECOACH_PAIRS_URL);
    expect(pairsUrlOf(effectivePrefs(DEFAULT_PREFS, '?pairfull=1', ''))).toBe(FORGECOACH_PAIRS_FULL_URL);
    expect(pairsUrlOf(effectivePrefs(DEFAULT_PREFS, '?pairfull=1&pairs=http://127.0.0.1:8654/pairs-v2/', ''))).toBe('http://127.0.0.1:8654/pairs-v2/');
    expect(FORGECOACH_PAIRS_FULL_URL).toMatch(/@pairs-v2\/$/);
  });
});

describe('spec 1.13 draft: the stage panorama (pairs-panorama)', () => {
  const PANO = { src: 'pairs/island-plains/s3-panorama.webp', src2x: 'pairs/island-plains/s3-panorama@2x.webp', width: 3277, height: 640, subjectBand: [0.38, 0.72], focal: { x: 0.5, y: 0.52 }, safe: { x: 0.1875, y: 0.38, w: 0.625, h: 0.34 }, bytes: 1000 };
  const withPano = () => {
    const st = stages('island-plains') as Record<string, unknown>[];
    st[2] = { ...st[2], panorama: PANO };
    const r = validatePairs({ schema: 1, pairs: { 'island+plains': { dual: 'Tundra', stages: st } } }, BASE);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    return r.pairs!.pairs['island+plains']!;
  };

  it('reads a stage panorama as a half-shaped picture, on its own stage only', () => {
    const pair = withPano();
    const p = pairPanoramaAt(pair, 3)!;
    expect(p.src).toBe(`${BASE}pairs/island-plains/s3-panorama.webp`);
    expect(p.src2x).toBe(`${BASE}pairs/island-plains/s3-panorama@2x.webp`);
    expect([p.width, p.height, p.focal.x]).toEqual([3277, 640, 0.5]);
    expect(pairPanoramaAt(pair, 2)).toBeNull();
    expect(pairPanoramaAt(pair, 9)).toBe(p); // past the end: the last stage's
    expect(pair.bytes).toBeGreaterThanOrEqual(1000);
  });

  it('draws the panorama instead of the half on a desktop panel, the half wherever the half would go to its phone picture', () => {
    const pair = withPano();
    const half = pairHalfAt(pair, 3);
    const pano = pairPanoramaAt(pair, 3);
    const desk = pairFullArt(half, pano, 16 / 5, false)!;
    expect(desk.picture!.src).toBe(pano!.src);
    expect(desk.aspect).toBeCloseTo(3277 / 640, 4);
    expect(pairFullArt(half, pano, 16 / 5, true)!.source).toBe('phone');
    expect(pairFullArt(half, pano, 4 / 5, false)!.source).toBe('phone');
    expect(pairFullArt(half, null, 16 / 5, false)!.picture!.src).toBe(half!.src);
  });

  it('pans a 1.6 panorama at every share: the whole width at 0.5 is its middle 62.5%, an end at 0.2 and 0.8', () => {
    const art = pairFullArt(null, pairPanoramaAt(withPano(), 3), 16 / 5, false)!;
    const box = { w: 1600, h: 500 };
    for (const [split, left] of [[0.5, -0.3], [0.8, 0], [0.2, -0.6], [0.3, -0.5], [0.7, -0.1]] as const) {
      const f = pairFullFrame(box, art, split);
      expect(f.width).toBeCloseTo(1.6, 3);
      expect(f.left).toBeCloseTo(left, 3);
      expect(f.seamAt).toBeCloseTo(split, 3);
    }
  });
});
