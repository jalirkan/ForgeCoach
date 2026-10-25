/*
 * ForgeCoach — ambience/elements.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.14's elements on spec 1.15's whole-half pair picture (`?pairfull=1`):
 * with three colours the picture is pieces.ts's heaviest pair, the third
 * colour an element on the heavier pair colour's ground (pc-results
 * scenery/SYSTEM.md A5), at the plan's opacity; without an element for that
 * colour, or with the flag off, the third colour keeps its panel as before.
 * On pairs-v4's snapshot (pairs-v4.test.ts).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { halfLayout } from './layout.ts';
import type { Biome, SlotState } from './model.ts';
import { pairFullArt, pairFullElementRegion, pairFullHeavierSide, pairFullPlan, pairFullView, type PairFullPair } from './pairfull.ts';
import { pairHalfAt, pairPanoramaAt, validatePairs } from './pairs.ts';
import { BIOME_COLOUR, elementBiomes, makeupFromSlots, piecePlacement, planHalf } from './pieces.ts';

const THRESHOLDS = [1, 2, 3, 4, 5, 6];
const PAIRS_V4 = 'https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v4/';
const slot = (b: Biome, index: number, weight: number): SlotState => ({ biome: b, index, weight, stage: Math.min(6, Math.ceil(weight)), peak: Math.min(6, Math.ceil(weight)) });
const pairs = validatePairs(JSON.parse(readFileSync(new URL('./testdata/pairs-v4.pairs.json', import.meta.url), 'utf8')), `${PAIRS_V4}pairs.json`).pairs!;
const ALL: ReadonlySet<Biome> = new Set<Biome>(['plains', 'island', 'swamp', 'mountain', 'forest']);
const pairOf = (items: ReturnType<typeof pairFullPlan>): PairFullPair => {
  const p = items?.find((x): x is PairFullPair => x.kind === 'pair');
  if (!p) throw new Error('no pair');
  return p;
};

describe('elements on the whole-half pair picture', () => {
  // SYSTEM.md's worked example, Evan's half at turn 8: Plateau (R ½, W ½), Plains, Island -> W 1½, U 1, R ½.
  const t8 = [slot('mountain', 0, 0.5), slot('plains', 1, 1.5), slot('island', 2, 1)];

  it('turn 8: island+plains across the whole half, red as the element on the plains side, the stage from every coloured land', () => {
    const items = pairFullPlan(halfLayout(t8, null), pairs, { thresholds: THRESHOLDS, elements: ALL })!;
    expect(items).toHaveLength(1);
    const p = pairOf(items);
    expect([p.key, p.left, p.right, p.element, p.share, p.split, p.stage]).toEqual(['island+plains', 'plains', 'island', 'mountain', 1, 0.6, 2]);
    const indexOf = (b: Biome) => t8.find((s) => s.biome === b)!.index;
    expect(pairFullHeavierSide(p, indexOf)).toBe('left');
    // The planner agrees: the same pair, red's element at 3 × ½ / 3, on the left (plains) ground.
    const plan = planHalf({ makeup: makeupFromSlots(t8) });
    expect(plan.pair).toEqual(['U', 'W']);
    expect(plan.element).toEqual({ colour: 'R', opacity: 0.5, side: 'left' });
    expect(BIOME_COLOUR[p.element!]).toBe(plan.element!.colour);
  });

  it('turn 10: + Tundra (W 2, U 1½, R ½) keeps island+plains, the pan eased toward the island (plains 0.60 -> 0.57)', () => {
    const t10 = [slot('mountain', 0, 0.5), slot('plains', 1, 2), slot('island', 2, 1.5)];
    const p = pairOf(pairFullPlan(halfLayout(t10, null), pairs, { thresholds: THRESHOLDS, elements: ALL }));
    expect([p.key, p.element, p.split]).toEqual(['island+plains', 'mountain', 0.5714]);
  });

  it('places the element in the heavier ground, short of the transition, standing on the ground by default', () => {
    const items = pairFullPlan(halfLayout(t8, null), pairs, { thresholds: THRESHOLDS, elements: ALL })!;
    const p = pairOf(items);
    const box = { w: 1600, h: 500 };
    const art = pairFullArt(pairHalfAt(p.pair, p.stage), pairPanoramaAt(p.pair, p.stage), box.w / box.h, false)!;
    const view = pairFullView(items, box, art)!;
    expect(view.seamAt).toBeCloseTo(0.6, 3);
    const region = pairFullElementRegion(view, 'left');
    expect(region.left).toBe(0);
    expect(region.width).toBeCloseTo(0.55, 3);
    // A 600 × 300 piece, the default ground sit (x 0.5, w 0.6): centred in the region, its foot on the bottom.
    const f = piecePlacement({ sit: 'ground', x: 0.5, w: 0.6, lift: 0 }, 2, region, box, view.horizonY);
    expect(f.left).toBeCloseTo(0.55 * 0.2, 3);
    expect(f.width).toBeCloseTo(0.55 * 0.6, 3);
    expect(f.top + f.height).toBeCloseTo(1, 4);
    expect(f.left + f.width).toBeLessThanOrEqual(view.seamAt - 0.05 + 1e-9);
    // A horizon sit stands on the panorama's horizon through the crop.
    const h = piecePlacement({ sit: 'horizon', x: 0.5, w: 0.4, lift: 0 }, 2, region, box, view.horizonY);
    expect(h.top + h.height).toBeCloseTo(view.horizonY, 4);
  });

  it('the heavier colour on the right puts the region on the right, the element never mirrored with the picture', () => {
    const s = [slot('island', 0, 1), slot('mountain', 1, 0.5), slot('plains', 2, 2.5)];
    const items = pairFullPlan(halfLayout(s, null), pairs, { thresholds: THRESHOLDS, elements: ALL })!;
    const p = pairOf(items);
    expect([p.left, p.right, p.element]).toEqual(['island', 'plains', 'mountain']);
    expect(pairFullHeavierSide(p, (b) => s.find((x) => x.biome === b)!.index)).toBe('right');
    const view = pairFullView(items, { w: 1600, h: 500 }, pairFullArt(pairHalfAt(p.pair, p.stage), pairPanoramaAt(p.pair, p.stage), 3.2, false))!;
    const r = pairFullElementRegion(view, 'right');
    expect(r.left).toBeCloseTo(view.seamAt + 0.05, 4);
    expect(r.left + r.width).toBeCloseTo(1, 4);
    expect(planHalf({ makeup: makeupFromSlots(s) }).element?.side).toBe('right');
  });

  it('a three-way tie: the earlier arrivals make the pair, in pairfull and in the planner alike', () => {
    const s = [slot('mountain', 0, 1), slot('plains', 1, 1), slot('island', 2, 1)];
    const p = pairOf(pairFullPlan(halfLayout(s, null), pairs, { thresholds: THRESHOLDS, elements: ALL }));
    expect([p.key, p.element]).toEqual(['mountain+plains', 'island']);
    const plan = planHalf({ makeup: makeupFromSlots(s) });
    expect(plan.pair).toEqual(['R', 'W']);
    expect(plan.element?.colour).toBe('U');
  });

  it('without an element for the third colour (or no pieces), the third keeps its panel: the 1.15 placeholder unchanged', () => {
    const layout = halfLayout(t8, null);
    const without = pairFullPlan(layout, pairs, { thresholds: THRESHOLDS })!;
    const onlyBlue = pairFullPlan(layout, pairs, { thresholds: THRESHOLDS, elements: new Set<Biome>(['island']) })!;
    for (const items of [without, onlyBlue]) {
      expect(items.map((x) => x.kind)).toEqual(['slot', 'pair']);
      expect(pairOf(items).element).toBeUndefined();
    }
    expect(elementBiomes(null)).toBeNull();
    expect(elementBiomes({ elements: {} })).toBeNull();
    expect([...elementBiomes({ elements: { R: {} as never, U: {} as never } })!].sort()).toEqual(['island', 'mountain']);
  });

  it('two colours are unchanged by the elements set', () => {
    const layout = halfLayout([slot('island', 0, 3), slot('plains', 1, 1)], null);
    expect(pairFullPlan(layout, pairs, { thresholds: THRESHOLDS, elements: ALL })).toEqual(pairFullPlan(layout, pairs, { thresholds: THRESHOLDS }));
  });
});
