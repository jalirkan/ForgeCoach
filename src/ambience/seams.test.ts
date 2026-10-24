/*
 * ForgeCoach — ambience/seams.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.10, the seams made calm (the four boards Justin played on 2026-10-17,
 * ~/scenery-packs/seams-v1/diag/DIAGNOSIS.md): a half shows at most three
 * panels, the rest folded into their nearest kept neighbour; a seam with a pair
 * band draws no bridge (and keeps the base seam); a half picture is never drawn
 * half over its next stage (two horizons); a full-area accent is drawn over its
 * own biome's panel only. Checked on pack-v8 and pairs-v2 as jsDelivr serves
 * them, and on the made-up lands of #ambience.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bridgePlacements, halfSeams } from './bridges.ts';
import { foldPanels, halfLayout, MAX_HALF_PANELS, slotLayout } from './layout.ts';
import { DEFAULT_GROWTH, validateManifest, type ScenePack } from './manifest.ts';
import { bandedSeams, halfPanelSpan, halfRow, pairBands, panelMaskCss, rowCentre, rowSpans, validatePairs } from './pairs.ts';
import { nextStageFade, slotStageFade } from './growth.ts';
import { dualsOf, sceneryFromLog, slotsOf, type Biome, type SlotState } from './model.ts';
import { simLog, SIM_PLAYERS, type SimLandName } from './sim.ts';
import { FORGECOACH_PACK_URL } from './prefs.ts';

const json = (f: string) => JSON.parse(readFileSync(new URL(`./testdata/${f}`, import.meta.url), 'utf8'));
const base = validateManifest(json('pack-v8.scenery.json'), `${FORGECOACH_PACK_URL}scenery.json`).pack!;
/** pairs-v2's own tag: the 1.10 rules are checked on the band pairs they were written for (pairs-v3's motif pairs take no width: pairs-v3.test.ts). */
const pairs = validatePairs(json('pairs-v2.pairs.json'), 'https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v2/pairs.json').pairs!;
const pack: ScenePack = { ...base, pairs };
const slot = (b: Biome, index: number, weight: number, stage = weight > 0 ? Math.max(1, Math.floor(weight)) : 0): SlotState => ({ biome: b, index, weight, stage, peak: Math.max(1, stage) });

/** A side as #ambience plays it, on ForgeCoach's thresholds. */
function side(lands: SimLandName[], player: number = SIM_PLAYERS[1]) {
  const sc = sceneryFromLog(simLog(lands.map((name) => ({ kind: 'land' as const, player, name }))), Infinity, { thresholds: pack.stageThresholds ?? undefined });
  return { slots: slotsOf(sc, player), duals: dualsOf(sc, player) };
}

describe('spec 1.10: at most three panels a half', () => {
  it('drops a fourth biome: it shows nothing and its weight goes nowhere (1.16, SYSTEM.md A6)', () => {
    // Case 4: Bayou, Island, Tundra — swamp ½, forest ½, island 1½, plains ½ in arrival order.
    const { slots } = side(['Bayou', 'Island', 'Tundra']);
    expect(slots.map((s) => s.biome)).toEqual(['swamp', 'forest', 'island', 'plains']);
    const l = halfLayout(slots, pack);
    expect(l.map((x) => x.slot.biome)).toEqual(['swamp', 'forest', 'island']);
    // Until 1.16 plains' ½ folded into the island (2); now each kept panel weighs its own lands.
    expect(l.map((x) => x.slot.weight)).toEqual([0.5, 0.5, 1.5]);
    expect(l.map((x) => x.stage)).toEqual([1, 1, 1]);
    expect(l.reduce((n, x) => n + x.share, 0)).toBeCloseTo(1, 2);
    expect(l.length).toBeLessThanOrEqual(MAX_HALF_PANELS);
  });
  it('keeps the heaviest three, ties to the colour showing then the earlier arrival, and drops withered panels first', () => {
    const five = [slot('forest', 0, 1), slot('island', 1, 3), slot('swamp', 2, 1), slot('mountain', 3, 2), slot('plains', 4, 1)];
    const f = foldPanels(slotLayout(five, null));
    expect(f.map((x) => x.slot.biome)).toEqual(['forest', 'island', 'mountain']);
    // swamp and plains are dropped: their weight is added to no panel (1.16).
    expect(f.map((x) => x.slot.weight)).toEqual([1, 3, 2]);
    // A tie for the third place keeps the colour already showing (makeup.ts), else the earlier arrival.
    expect(foldPanels(slotLayout(five, null), { kept: ['U', 'R', 'W'], pair: ['U', 'R'] }).map((x) => x.slot.biome)).toEqual(['island', 'mountain', 'plains']);
    const withered = [slot('forest', 0, 0), slot('island', 1, 1), slot('swamp', 2, 1), slot('mountain', 3, 1)];
    expect(foldPanels(slotLayout(withered, null)).map((x) => x.slot.biome)).toEqual(['island', 'swamp', 'mountain']);
  });
  it('leaves three or fewer alone, and the strip untouched', () => {
    const three = slotLayout([slot('forest', 0, 1), slot('island', 1, 1), slot('swamp', 2, 1)], null);
    expect(foldPanels(three)).toBe(three);
    expect(slotLayout([slot('forest', 0, 1), slot('island', 1, 1), slot('swamp', 2, 1), slot('plains', 3, 1)], null)).toHaveLength(4);
  });
});

describe('spec 1.10: the band wins its seam', () => {
  it('draws no bridge on a seam with a pair band, and keeps the base seam there', () => {
    // Case 3: mountains and islands with a Volcanic Island.
    const { slots, duals } = side(['Mountain', 'Island', 'Mountain', 'Island', 'Mountain', 'Island', 'Volcanic Island'], SIM_PLAYERS[0]);
    const layout = halfLayout(slots, pack);
    const bands = pairBands(layout, pairs, duals);
    expect(bands.map((b) => [b.key, b.duals])).toEqual([['island+mountain', 1]]);
    const banded = bandedSeams(bands);
    expect(bridgePlacements(layout, pack, duals, { banded })).toEqual([]);
    expect(halfSeams(layout, pack, duals, banded)).toEqual([0, 0.1]);
    // Without pairs the bridge comes back, its seam widened by the dual as in 1.8.
    expect(bridgePlacements(layout, pack, duals).map((p) => p.key)).toEqual(['island+mountain']);
    expect(halfSeams(layout, pack, duals)).toEqual([0, 0.12]);
  });
});

describe('spec 1.10: no half picture half over the next', () => {
  it('a half picture shows its own stage between thresholds; strip layers still cross-fade', () => {
    expect(nextStageFade(0.5, true, DEFAULT_GROWTH)).toBe(0.5);
    expect(slotStageFade(0.5, true, DEFAULT_GROWTH, true)).toBe(0);
    expect(slotStageFade(0.5, true, DEFAULT_GROWTH, false)).toBe(0.5);
    expect(slotStageFade(1, true, DEFAULT_GROWTH, false)).toBe(0);
  });
});

describe('spec 1.10: a full-area accent over its own panel', () => {
  it('rowSpans lays the row out as rowCentre does', () => {
    const items = [{ share: 0.45, seam: 0 }, { share: 0.1, seam: 0.05 }, { share: 0.45, seam: 0.05 }];
    const spans = rowSpans(items, 1000);
    spans.forEach((s, i) => expect(s.left + s.width / 2).toBeCloseTo(rowCentre(items, i, 1000), 0));
    expect(spans.map((s) => s.seam)).toEqual([0, 50, 50]);
    expect(spans.at(-1)!.left + spans.at(-1)!.width).toBeCloseTo(1000, 0);
  });
  it('spans the dominant biome’s panel and its ramps; whole half when unsplit; none when folded away', () => {
    // Case 1's upper half: three Islands and three Plains, the Tundra band between.
    const { slots, duals } = side(['Island', 'Plains', 'Island', 'Plains', 'Island', 'Plains']);
    const span = halfPanelSpan(slots, pack, 'island', 958, { duals });
    expect(span).toEqual({ left: 0, right: 474.2, fadeLeft: 0, fadeRight: 47.9 }); // the browser measured the island at 0–474 px (diag/after-b)
    const right = halfPanelSpan(slots, pack, 'plains', 958, { duals });
    expect(right).toMatchObject({ right: 958, fadeLeft: 47.9, fadeRight: 0 });
    expect(halfPanelSpan(side(['Island']).slots, pack, 'island', 958)).toBeNull();
    expect(halfPanelSpan(side(['Bayou', 'Island', 'Tundra']).slots, pack, 'plains', 958)).toBe('none');
    expect(panelMaskCss({ left: 0, right: 474, fadeLeft: 0, fadeRight: 47.9 })).toBe('linear-gradient(to right, transparent 0px, #000 0px, #000 426px, transparent 474px)');
  });
  it('the band row the accent follows is the board’s', () => {
    const { slots, duals } = side(['Island', 'Plains', 'Island', 'Plains', 'Island', 'Plains']);
    const layout = halfLayout(slots, pack);
    const bands = pairBands(layout, pairs, duals);
    const row = halfRow(layout, halfSeams(layout, pack, duals, bandedSeams(bands)), bands);
    expect(row.map((it) => it.key)).toEqual(['island', 'island+plains', 'plains']);
  });
});
