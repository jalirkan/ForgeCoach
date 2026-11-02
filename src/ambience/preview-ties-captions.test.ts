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
 *    board does. Since spec 1.19 b (the owner's rule after that storyboard)
 *    the memory matters more: the pair showing stays the base while both its
 *    colours are among the three heaviest, so both sequences keep their
 *    first pair throughout, and only a colour of it leaving the top three
 *    re-keys.
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
const pack = validateManifest(json('pack-v9.2.scenery.json'), `${FORGECOACH_PACK_URL}scenery.json`).pack!;
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

describe('the pair kept as the base on the preview (SYSTEM.md A5, spec 1.19 b)', () => {
  it('Island, Swamp, Mountain, Mountain, Island, Swamp: island+swamp from the second land on, red painted in (storyboard sheet 5)', () => {
    const steps = afterEach(['Island', 'Swamp', 'Mountain', 'Mountain', 'Island', 'Swamp']);
    // Before 1.19 b the second Mountain re-keyed to island+mountain (R2 outweighs B1): the swamp half became desert.
    expect(steps.map((s) => s.key)).toEqual([null, 'island+swamp', 'island+swamp', 'island+swamp', 'island+swamp', 'island+swamp']);
    // U2 B2 R2: the mountain is the third colour, painted in on the island's ground (the tie: the earlier arrival).
    expect(steps[5]!.pick.third).toBe('R');
    expect(steps[5]!.cell).toBe('2x2');
    expect(steps[5]!.painted).toBe('R');
    expect(steps[5]!.caption).toMatch(/^island \+ swamp, whole half: .*seam 2x2; R painted in, on island's ground$/);
  });

  it('without what was showing the fourth land would re-key to the heaviest pair, island+mountain', () => {
    const steps = afterEach(['Island', 'Swamp', 'Mountain', 'Mountain', 'Island', 'Swamp'], { memory: false });
    expect(steps[3]!.key).toBe('island+mountain');
  });

  it('Tropical Island, Tundra, Island, Plains, Forest: forest+island throughout, the plains the third colour (storyboard sheet 7)', () => {
    const steps = afterEach(['Tropical Island', 'Tundra', 'Island', 'Plains', 'Forest']);
    // Before 1.19 b the Plains re-keyed to island+plains (W1.5 outweighs G0.5) and threw the forest cliffs away.
    expect(steps.map((s) => s.key)).toEqual(['forest+island', 'forest+island', 'forest+island', 'forest+island', 'forest+island']);
    // U2 W1.5 G1.5: the plains is the third colour, painted in.
    expect(steps[4]!.pick.third).toBe('W');
    expect(steps[4]!.painted).toBe('W');
  });

  it('a pair colour leaving the top three re-keys (A8): Island, Swamp, Mountain ×2, Forest ×2, Plains ×2', () => {
    const steps = afterEach(['Island', 'Swamp', 'Mountain', 'Mountain', 'Forest', 'Forest', 'Plains', 'Plains']);
    // U1 B1 R2 G2 W1: two colours outweigh the island and the swamp, island+swamp stays. W2: three do -- the heaviest pair
    // of the top three (R G W tie at 2: the mountain showing, then the forest by arrival).
    expect(steps.map((s) => s.key)).toEqual([null, 'island+swamp', 'island+swamp', 'island+swamp', 'island+swamp', 'island+swamp', 'island+swamp', 'forest+mountain']);
    expect([steps[7]!.pick.third, ...steps[7]!.pick.extras]).toEqual(['W', 'U', 'B']);
    // Every colour named: the plains painted in, the island and the swamp as cut-outs (spec 1.19 a).
    expect(steps[7]!.caption).toMatch(/; W painted in, on [a-z]+'s ground; island and swamp as elements$/);
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
