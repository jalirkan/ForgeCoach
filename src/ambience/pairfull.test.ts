/*
 * ForgeCoach — ambience/pairfull.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.15 (`?pairfull=1`): when the half has exactly two live biomes
 * and a pictured pair, the plan is the pair picture alone, its split the land
 * share and its stage from the total lands; three biomes put the heaviest
 * pictured pair beside the third's panel; anything else is null (the half as
 * today). The frame pans the transition to the split (and its CSS twin is the
 * same math); the flag is off unless the page asks, and with it ForgeCoach's
 * own pack defaults to the whole-half pairs.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { halfLayout } from './layout.ts';
import type { MakeupShowing } from './makeup.ts';
import { BIOME_COLOUR, makeupFromSlots, planHalf } from './pieces.ts';
import type { Biome, SlotState } from './model.ts';
import { pairHalfAt, pairPanoramaAt, validatePairs, type PairsPack } from './pairs.ts';
import { PAIR_FULL_ELEMENT_MARGIN, PAIR_FULL_MAX_ZOOM, pairFullArt, pairFullCaption, pairFullElementRegion, pairFullFrame, pairFullFrameCss, pairFullPlan, pairFullSplit, pairFullStage, pairFullView, pairFullZoom, type PairFullPair } from './pairfull.ts';
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

describe('spec 1.15: the plan', () => {
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

  it('four biomes fold to three first, the dropped colour weighing nothing (1.16, SYSTEM.md A6)', () => {
    // Case 4's opponent: Bayou, Island, Tundra → swamp ½, forest ½, island 1½, plains ½ → three panels.
    const layout = halfLayout([slot('swamp', 0, 0.5, 1), slot('forest', 1, 0.5, 1), slot('island', 2, 1.5, 1), slot('plains', 3, 0.5, 1)], null);
    expect(layout.map((l) => [l.slot.biome, l.slot.weight])).toEqual([
      ['swamp', 0.5],
      ['forest', 0.5],
      ['island', 1.5],
    ]);
    const items = pairFullPlan(layout, pairsPack(), { thresholds: T });
    expect(items).not.toBeNull();
    expect(items!.filter((x) => x.kind === 'pair')).toHaveLength(1);
  });
  it('captions the plan for the preview page', () => {
    expect(pairFullCaption(plan([slot('island', 0, 4, 4), slot('plains', 1, 1, 1)]))).toBe('Tundra (Hallowed Fountain), whole half: island 80% | plains 20%, pair stage 3');
    expect(pairFullCaption(null)).toBeNull();
  });
});

/**
 * Review fault 1 (2026-10-24): with four or five colours the strip panned the pair by a colour
 * that was not on screen and picked a different pair from the pieces, so the element did not draw
 * while the caption said it did. One rule now (makeup.ts): these play the strip (halfLayout →
 * pairFullPlan), the caption and the pieces (planHalf) on pairs-v4, where every pair is pictured.
 */
describe('one makeup rule for the strip, the caption and the pieces', () => {
  const v4 = validatePairs(JSON.parse(readFileSync(new URL('./testdata/pairs-v4.pairs.json', import.meta.url), 'utf8')), `${FORGECOACH_PAIRS_FULL_URL}pairs.json`).pairs!;
  const ALL: ReadonlySet<Biome> = new Set<Biome>(['plains', 'island', 'swamp', 'mountain', 'forest']);
  const strip = (slots: SlotState[], showing: MakeupShowing | null = null) => {
    const items = pairFullPlan(halfLayout(slots, null, null, showing), v4, { thresholds: T, elements: ALL, showing })!;
    expect(items).toHaveLength(1);
    return items[0] as PairFullPair;
  };
  /** The strip's pair and element in colours, and the pieces' plan, for the same half. */
  const both = (slots: SlotState[], showing: MakeupShowing | null = null) => {
    const p = strip(slots, showing);
    const plan = planHalf({ makeup: makeupFromSlots(slots), showing });
    return { p, plan, stripPair: [BIOME_COLOUR[p.left], BIOME_COLOUR[p.right]].sort(), planPair: [...plan.pair!].sort(), stripElement: BIOME_COLOUR[p.element!] };
  };

  it('1 + 1 + 1 + 1: island+plains at 50/50, swamp the element (before: mountain folded into swamp and the pair moved)', () => {
    const s = [slot('plains', 0, 1, 1), slot('island', 1, 1, 1), slot('swamp', 2, 1, 1), slot('mountain', 3, 1, 1)];
    const { p, plan, stripPair, planPair, stripElement } = both(s);
    expect([p.key, p.split, p.weights, p.element]).toEqual(['island+plains', 0.5, [1, 1], 'swamp']);
    expect(stripPair).toEqual(planPair);
    expect(plan.element).toMatchObject({ colour: 'B', opacity: 1 });
    expect(stripElement).toBe(plan.element!.colour);
    // The stage counts the three kept lands: three lands, pair stage 2.
    expect([p.stage, plan.pairStage]).toEqual([2, 2]);
    expect(pairFullCaption([p])).toBe('Tundra (Hallowed Fountain), whole half: plains 50% | island 50%, pair stage 2; swamp as an element');
  });

  it('four unequal colours: the lightest dropped, the pan by the pair’s own weights (before: 4 : 2, panned by the mountain)', () => {
    const s = [slot('mountain', 0, 1, 1), slot('plains', 1, 3, 3), slot('island', 2, 2, 2), slot('swamp', 3, 1.5, 2)];
    const { p, plan, stripPair, planPair, stripElement } = both(s);
    expect([p.key, p.left, p.right, p.weights, p.split, p.element]).toEqual(['island+plains', 'plains', 'island', [3, 2], 0.6, 'swamp']);
    expect(stripPair).toEqual(planPair);
    expect(stripElement).toBe(plan.element!.colour);
    expect(plan.element!.opacity).toBeCloseTo((3 * 1.5) / 6.5, 3);
    // 6.5 kept lands: pair stage 3.
    expect([p.stage, plan.pairStage]).toEqual([3, 3]);
  });

  it('five colours: the three heaviest, a tie for third to the earliest arrival; the other two nowhere', () => {
    const s = [slot('forest', 0, 1, 1), slot('swamp', 1, 1, 1), slot('plains', 2, 2, 2), slot('island', 3, 2, 2), slot('mountain', 4, 1, 1)];
    expect(halfLayout(s, null).map((l) => [l.slot.biome, l.slot.weight])).toEqual([
      ['forest', 1],
      ['plains', 2],
      ['island', 2],
    ]);
    const { p, plan, stripPair, planPair, stripElement } = both(s);
    expect([p.key, p.split, p.element]).toEqual(['island+plains', 0.5, 'forest']);
    expect(stripPair).toEqual(planPair);
    expect(stripElement).toBe(plan.element!.colour);
  });

  it('ties: the pair and the third already showing stay, in the strip and the pieces alike', () => {
    const four = [slot('plains', 0, 2, 2), slot('island', 1, 2, 2), slot('swamp', 2, 1, 1), slot('mountain', 3, 1, 1)];
    expect(both(four).stripElement).toBe('B');
    const r = both(four, { kept: ['W', 'U', 'R'], pair: ['U', 'W'] });
    expect([r.p.element, r.plan.element!.colour]).toEqual(['mountain', 'R']);
    const three = [slot('plains', 0, 1, 1), slot('island', 1, 1, 1), slot('swamp', 2, 1, 1)];
    expect(both(three).p.key).toBe('island+plains');
    const shown = both(three, { kept: ['U', 'B', 'W'], pair: ['U', 'B'] });
    expect([shown.p.key, shown.p.element]).toEqual(['island+swamp', 'plains']);
    expect(shown.planPair).toEqual(shown.stripPair);
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

describe('spec 1.15: the frame pans the transition to the land share', () => {
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
    for (const art of [desktop, phone, { ...desktop, safe: null }, { ...desktop, focal: { x: 0.4, y: 0.5 } }, { ...desktop, focal: { x: 0.5, y: 0.45 }, focalTo: 0.43 }])
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

describe('spec 1.15: the flag', () => {
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
    expect(FORGECOACH_PAIRS_FULL_URL).toMatch(/@pairs-v4\/$/);
  });
});

describe('spec 1.15: the stage panorama (pairs-panorama)', () => {
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

describe('spec 1.15: the view the pieces (1.14) stand on', () => {
  const art = { aspect: 3277 / 640, focal: { x: 0.5, y: 0.52 }, safe: { x: 0.1875, y: 0.38, w: 0.625, h: 0.34 }, picture: null };

  it('is null without a pair, a box or an art', () => {
    expect(pairFullView(null, { w: 1600, h: 500 }, art)).toBeNull();
    const items = plan([slot('island', 0, 2, 2), slot('plains', 1, 2, 2)]);
    expect(pairFullView(items, { w: 0, h: 500 }, art)).toBeNull();
    expect(pairFullView(items, { w: 1600, h: 500 }, null)).toBeNull();
  });

  it('puts the transition at the board’s split, mirrored or not, and each colour’s ground on its side of it', () => {
    for (const [slots, seam] of [
      [[slot('island', 0, 3, 3), slot('plains', 1, 1, 1)], 0.75],
      [[slot('plains', 0, 1, 1), slot('island', 1, 3, 3)], 0.25],
    ] as const) {
      const v = pairFullView(plan([...slots]), { w: 1600, h: 500 }, art)!;
      expect(v.seamAt).toBeCloseTo(seam, 3);
      expect(v.ground.left).toEqual({ left: 0, width: v.seamAt });
      expect(v.ground.right.left + v.ground.right.width).toBeCloseTo(1, 4);
      expect(v.frame.width).toBeCloseTo(1.6, 3);
    }
  });

  it('with a third biome’s panel (the placeholder) on the left, measures in the whole half', () => {
    const items = plan([slot('forest', 0, 1, 1), slot('island', 1, 3, 3), slot('plains', 2, 1, 1)])!;
    expect(items.map((x) => x.kind)).toEqual(['slot', 'pair']);
    const p = pairOf(items)!;
    const v = pairFullView(items, { w: 1600, h: 500 }, art)!;
    expect(v.panel.left).toBeCloseTo(1 - p.share, 4);
    expect(v.panel.width).toBeCloseTo(p.share, 4);
    expect(v.seamAt).toBeCloseTo(v.panel.left + p.split * p.share, 3);
    expect(v.ground.left.left).toBe(v.panel.left);
  });

  it('an element’s region is the heavier colour’s ground, stopping the margin short of the transition, never negative', () => {
    expect(PAIR_FULL_ELEMENT_MARGIN).toBe(0.05);
    const v = pairFullView(plan([slot('island', 0, 4, 4), slot('plains', 1, 1, 1)]), { w: 1600, h: 500 }, art)!;
    expect(pairFullElementRegion(v, 'left')).toEqual({ left: 0, width: 0.75 });
    expect(pairFullElementRegion(v, 'right')).toEqual({ left: 0.85, width: 0.15 });
    expect(pairFullElementRegion(v, 'right', 0.5).width).toBe(0);
  });
});
