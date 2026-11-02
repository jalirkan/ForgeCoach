/*
 * ForgeCoach — ambience/preview-ties-captions.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Two faults the storyboard of 2026-11-02 (pc-results scenery/STORYBOARD.md)
 * found on the `#ambience` preview, on the real pairs-v7.1 snapshot and
 * ForgeCoach's pack:
 *
 * 1. SYSTEM.md A5's tie rule ("on a tie, the pair already showing stays;
 *    failing that, the colours that arrived first win"). makeup.ts keeps it
 *    when it is told what was showing, and the board (SceneryLayer) tells it
 *    (MakeupMemory over the log's frames); the preview passed nothing, so a
 *    tie went back to the earlier arrivals: Island, Swamp, Mountain,
 *    Mountain, Island, Swamp redrew island+swamp at the sixth land (sheet 5,
 *    turn 6), and Tropical Island, Tundra, Island, Plains, Forest redrew
 *    island+forest at the fifth (sheet 7, turn 5). makeup.ts
 *    `sceneryWithShowing` folds the memory over the preview's log as the
 *    board does.
 * 2. The caption named the pack's dual for every pair ("Pair band · Tropical
 *    Island (Breeding Pool), …" on every island+forest half, sheet 2): a
 *    pair is named by its colours, and its dual or shock land only when one
 *    of that name is on the half (pairs.ts `pairWords`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateManifest } from './manifest.ts';
import { pickFromSlots, sceneryWithShowing } from './makeup.ts';
import { slotsOf } from './model.ts';
import { halfLayout } from './layout.ts';
import { pairFullCaption, pairFullPlan, type PairFullPair } from './pairfull.ts';
import { pairBands, pairWords, validatePairs } from './pairs.ts';
import { elementBiomes } from './pieces.ts';
import { FORGECOACH_PACK_URL, FORGECOACH_PAIRS_FULL_URL } from './prefs.ts';
import { SIM_PLAYERS, simLog, type SimLandName } from './sim.ts';

const json = (f: string) => JSON.parse(readFileSync(new URL(`./testdata/${f}`, import.meta.url), 'utf8'));
const pack = validateManifest(json('pack-v9.1.scenery.json'), `${FORGECOACH_PACK_URL}scenery.json`).pack!;
const pairs = validatePairs(json('pairs-v7.1.tag.pairs.json'), `${FORGECOACH_PAIRS_FULL_URL}pairs.json`).pairs!;
const elements = elementBiomes(pack.pieces);
const ME = SIM_PLAYERS[0];

/** The preview's half after each of `names` (one state frame a land), as AmbiencePage draws it under `?pairfull=1` on a desktop. */
function afterEach(names: SimLandName[], opts: { memory?: boolean } = {}) {
  return names.map((_, i) => {
    const log = simLog(names.slice(0, i + 1).map((name) => ({ kind: 'land' as const, player: ME, name })));
    const { scenery, memory } = sceneryWithShowing(log, Infinity, { thresholds: pack.stageThresholds ?? undefined });
    const slots = slotsOf(scenery, ME);
    const showing = opts.memory === false ? null : memory.showing(ME);
    const items = pairFullPlan(halfLayout(slots, pack, null, showing), pairs, { thresholds: pack.stageThresholds, elements, showing, slots, narrow: false });
    const p = items?.find((x): x is PairFullPair => x.kind === 'pair') ?? null;
    return { key: p?.key ?? null, cell: p?.grid?.cell ?? null, painted: p?.grid?.painted?.colour ?? null, pick: pickFromSlots(slots, showing), caption: pairFullCaption(items, new Set(names.slice(0, i + 1))) };
  });
}

describe('the tie rule on the preview: the pair already showing stays (SYSTEM.md A5)', () => {
  it('Island, Swamp, Mountain, Mountain, Island, Swamp: island+mountain from the fourth land on, swamp painted in (storyboard sheet 5)', () => {
    const steps = afterEach(['Island', 'Swamp', 'Mountain', 'Mountain', 'Island', 'Swamp']);
    expect(steps.map((s) => s.key)).toEqual([null, 'island+swamp', 'island+swamp', 'island+mountain', 'island+mountain', 'island+mountain']);
    // U2 B2 R2: all three tie, and the pair showing (island+mountain) stays; the swamp is the third colour.
    expect(steps[5]!.pick.third).toBe('B');
    expect(steps[5]!.cell).toBe('2x2');
    expect(steps[5]!.painted).toBe('B');
    expect(steps[5]!.caption).toMatch(/^island \+ mountain, whole half: .*seam 2x2; B painted in/);
  });

  it('without what was showing (the preview before the fix) the sixth land went back to island+swamp, the earlier arrivals', () => {
    const steps = afterEach(['Island', 'Swamp', 'Mountain', 'Mountain', 'Island', 'Swamp'], { memory: false });
    expect(steps[5]!.key).toBe('island+swamp');
    expect(steps[5]!.painted).toBe('R');
  });

  it('Tropical Island, Tundra, Island, Plains, Forest: island+plains stays when the forest ties the plains (storyboard sheet 7)', () => {
    const steps = afterEach(['Tropical Island', 'Tundra', 'Island', 'Plains', 'Forest']);
    expect(steps.map((s) => s.key)).toEqual(['forest+island', 'forest+island', 'forest+island', 'island+plains', 'island+plains']);
    // U2 G1.5 W1.5: the forest is the third colour, painted in.
    expect(steps[4]!.pick.third).toBe('G');
    expect(steps[4]!.painted).toBe('G');
    expect(afterEach(['Tropical Island', 'Tundra', 'Island', 'Plains', 'Forest'], { memory: false })[4]!.key).toBe('forest+island');
  });

  it('a strictly heavier pair still re-keys (A8): a third Swamp after U2 B2 R2 moves off island+mountain', () => {
    const steps = afterEach(['Island', 'Swamp', 'Mountain', 'Mountain', 'Island', 'Swamp', 'Swamp']);
    // U2 B3 R2: island+swamp and swamp+mountain tie at 5, both heavier than island+mountain (4), so the pair showing is
    // not among the heaviest; "failing that, the colours that arrived first win": the island.
    expect(steps[6]!.key).toBe('island+swamp');
  });
});

describe('the caption names a pair by its colours, and a dual only when it is on the half', () => {
  it('Island, Forest: "island + forest", no Tropical Island, no Breeding Pool (storyboard sheet 2, turn 2)', () => {
    const steps = afterEach(['Island', 'Forest']);
    expect(steps[1]!.caption).toMatch(/^island \+ forest, whole half: island 50% \| forest 50%, island s1 \| forest s1, seam 1x1$/);
    expect(steps[1]!.caption).not.toMatch(/Tropical Island|Breeding Pool/);
  });

  it('a Tropical Island on the half is named; its shock, not on the half, is not', () => {
    const steps = afterEach(['Tropical Island']);
    expect(steps[0]!.caption).toMatch(/^island \+ forest \(Tropical Island\), whole half: /);
    expect(steps[0]!.caption).not.toMatch(/Breeding Pool/);
  });

  it('pairWords: the board order, and only the names in play', () => {
    const p = pairs.pairs['forest+island']!;
    expect(pairWords('island', 'forest', p)).toBe('island + forest');
    expect(pairWords('forest', 'island', p, new Set(['Breeding Pool', 'Forest']))).toBe('forest + island (Breeding Pool)');
    expect(pairWords('island', 'forest', p, new Set(['Tropical Island', 'Breeding Pool']))).toBe('island + forest (Tropical Island, Breeding Pool)');
  });

  it('the band list without the flag names its pairs the same way', () => {
    const log = simLog((['Island', 'Swamp'] as SimLandName[]).map((name) => ({ kind: 'land' as const, player: ME, name })));
    const { scenery } = sceneryWithShowing(log, Infinity, { thresholds: pack.stageThresholds ?? undefined });
    const bands = pairBands(halfLayout(slotsOf(scenery, ME), pack, null), pairs, {});
    expect(bands.map((b) => pairWords(b.left, b.right, b.pair, new Set(['Island', 'Swamp'])))).toEqual(['island + swamp']);
  });
});
