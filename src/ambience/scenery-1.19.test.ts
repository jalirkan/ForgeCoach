/*
 * ForgeCoach — ambience/scenery-1.19.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.19 (draft, the owner's four rules of 2026-11-02 after the storyboard
 * review, pc-results scenery/STORYBOARD.md) on the real packs the board loads:
 * pack-v9.2 (1.19 d, the default: five elements with phone pieces), the
 * tagged pairs-v7.1 under `?pairfull=1` and pairs-v3.1 without it, through
 * storyboard.ts `storyboardHalf` (the board's own functions composed as
 * SceneryLayer composes them) at a desktop's and a phone's shape.
 *
 * - a. Every colour visible: four and five colours -- every colour on
 *   screen, the cut-outs stacked (the heavier pair colour's ground holds
 *   two, the lighter's the rest), each faded by its share, the caption
 *   naming them.
 * - b. The pair kept as the base: the storyboard's sequences 5 (Island,
 *   Swamp, Mountain, Mountain, Island, Swamp, Forest ×3) and 6 (W U B R G ×2,
 *   then Forest, Island), the memory carried land by land: the pair at every
 *   step.
 * - c. No clamp: a pair whose cell is not painted is its two mono pictures
 *   apart, a plain seam between, "no seam cell" in the caption, and the
 *   third colour as a cut-out over them.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateManifest, type PieceColour } from './manifest.ts';
import { validatePairs } from './pairs.ts';
import { FORGECOACH_PACK_URL, FORGECOACH_PAIRS_FULL_URL, FORGECOACH_PAIRS_URL } from './prefs.ts';
import { addLand, storyboardHalf, type HalfStoryboard, type ManaState, type Shape, type StoryboardPacks } from './storyboard.ts';
import type { MakeupShowing } from './makeup.ts';

const json = (f: string) => JSON.parse(readFileSync(new URL(`./testdata/${f}`, import.meta.url), 'utf8'));
const PACKS: StoryboardPacks = {
  pack: validateManifest(json('pack-v9.2.scenery.json'), `${FORGECOACH_PACK_URL}scenery.json`).pack!,
  pairsOff: validatePairs(json('pairs-v3.1.pairs.json'), `${FORGECOACH_PAIRS_URL}pairs.json`).pairs,
  pairsFull: validatePairs(json('pairs-v7.1.tag.pairs.json'), `${FORGECOACH_PAIRS_FULL_URL}pairs.json`).pairs,
};
const SHAPES: readonly Shape[] = ['desktop', 'phone'];
const EMPTY: ManaState = { counts: {}, duals: [], arrival: [] };
const LAND: Record<string, PieceColour> = { I: 'U', S: 'B', M: 'R', F: 'G', P: 'W', W: 'W', U: 'U', B: 'B', R: 'R', G: 'G' };

/** A side's lands played one by one, each step drawn with what the half showed before (MakeupMemory's pick). */
function play(lands: string, shape: Shape, pairfull = true): HalfStoryboard[] {
  const out: HalfStoryboard[] = [];
  let state = EMPTY;
  let showing: MakeupShowing | null = null;
  for (const l of lands.split(' ')) {
    state = addLand(state, LAND[l]!);
    const h = storyboardHalf(state, shape, pairfull, PACKS, showing);
    out.push(h);
    showing = h.pick.kept.length ? h.pick : null;
  }
  return out;
}
const cutOuts = (h: HalfStoryboard) => h.drawn.filter((d) => d.kind === 'cutout').map((d) => d.what);
const side = (counts: Partial<Record<PieceColour, number>>, arrival: PieceColour[]): ManaState => ({ counts, duals: [], arrival });

describe('spec 1.19 b: the pair kept as the base (the storyboard’s sequences 5 and 6)', () => {
  for (const shape of SHAPES) {
    it(`sequence 5, I S M M I S F F F (${shape}): island+swamp from the second land to the last, every colour on screen`, () => {
      const steps = play('I S M M I S F F F', shape);
      // 1.17/1.18 re-keyed at the second Mountain (island+mountain), back at the second Swamp, then to island+forest.
      expect(steps.map((h) => h.picturePair?.join('') ?? null)).toEqual([null, 'UB', 'UB', 'UB', 'UB', 'UB', 'UB', 'UB', 'UB']);
      for (const h of steps) expect(h.invisible, h.picture).toEqual([]);
      // U2 B2 R2 G3: the forest (3) is the third colour now, the mountain past it a cut-out.
      const last = steps[8]!;
      expect([last.pick.third, last.pick.extras]).toEqual(['G', ['R']]);
      if (shape === 'desktop') {
        expect(last.picture).toBe('island+swamp cell 2x2 +G [s2x2+GL-panorama] + cut-outs R');
        expect(last.caption).toMatch(/^island \+ swamp, whole half: island 50% \| swamp 50%, island s2 \| swamp s2, seam 2x2; G painted in, on island's ground; mountain as an element$/);
      } else {
        // The painted forest has no phone picture: its cut-out (1.18.1), stacked with the mountain's on the island's ground.
        expect(last.picture).toBe('island+swamp cell 2x2 [s2x2-panorama-phone] + cut-outs GR');
        expect(cutOuts(last)).toEqual(['forest cut-out (heavier ground 1/2, 1)', 'mountain cut-out (heavier ground 2/2, 0.889)']);
        expect(last.caption).toMatch(/seam 2x2; forest and mountain as elements$/);
      }
    });

    it(`sequence 6, W U B R G ×2 then Forest, Island (${shape}): island+plains from the second land to the last, every colour on screen`, () => {
      const steps = play('W U B R G W U B R G G U', shape);
      expect(steps.map((h) => h.picturePair?.join('') ?? null)).toEqual([null, ...Array(11).fill('UW')]);
      for (const h of steps) expect(h.invisible, h.picture).toEqual([]);
      // W1 U1 B1 R1 G1: the swamp the third (painted in on the desktop), the mountain and the forest cut-outs -- the
      // mountain on the plains' ground (the heavier pair colour's: the earlier arrival on a tie) beside the swamp's place, the forest on the island's.
      const five = steps[4]!;
      expect([five.pick.third, five.pick.extras]).toEqual(['B', ['R', 'G']]);
      expect(five.drawn.filter((d) => d.kind === 'cutout').map((d) => d.what.replace(/, [\d.]+\)$/, ')'))).toEqual(
        shape === 'desktop' ? ['mountain cut-out (heavier ground 2/2)', 'forest cut-out (lighter ground 1/1)'] : ['swamp cut-out (heavier ground 1/2)', 'mountain cut-out (heavier ground 2/2)', 'forest cut-out (lighter ground 1/1)'],
      );
      // The last, W2 U3 B2 R2 G3: the forest (3) the third; the swamp and the mountain past it.
      const last = steps[11]!;
      expect([last.pick.third, last.pick.extras]).toEqual(['G', ['B', 'R']]);
      expect(last.caption).toMatch(shape === 'desktop' ? /island s3 \| plains s2, seam 3x2; G painted in, on island's ground; swamp and mountain as elements$/ : /island s3 \| plains s2, seam 3x2; forest, swamp and mountain as elements$/);
    });
  }

  it('the board without the flag keeps the same base: its panels are the pair and the third, the rest cut-outs on them', () => {
    for (const shape of SHAPES) {
      const steps = play('I S M M I S F F F', shape, false);
      for (const h of steps) expect(h.invisible, h.picture).toEqual([]);
      expect(steps[8]!.picture).toBe('island s2 | swamp s2 | forest s3 + cut-outs R');
      expect(steps[8]!.caption).toMatch(/; mountain as an element$/);
    }
  });
});

describe('spec 1.19 a: four and five colours, every one on screen', () => {
  const cases: [string, ManaState][] = [
    ['four even (U2 B2 R2 G2)', side({ U: 2, B: 2, R: 2, G: 2 }, ['U', 'B', 'R', 'G'])],
    ['four with a splash (W4 U3 B1 G1)', side({ W: 4, U: 3, B: 1, G: 1 }, ['W', 'U', 'B', 'G'])],
    ['five even (1 of each)', side({ W: 1, U: 1, B: 1, R: 1, G: 1 }, ['W', 'U', 'B', 'R', 'G'])],
    ['five skewed (W6 U5 B4 R3 G2)', side({ W: 6, U: 5, B: 4, R: 3, G: 2 }, ['W', 'U', 'B', 'R', 'G'])],
    ['five with one heavy (G6, one of each other)', side({ W: 1, U: 1, B: 1, R: 1, G: 6 }, ['W', 'U', 'B', 'R', 'G'])],
  ];
  for (const [name, state] of cases)
    for (const shape of SHAPES)
      for (const pairfull of [true, false])
        it(`${name}, ${shape}, ${pairfull ? '?pairfull=1' : 'the default board'}: every colour drawn and named, the stack in weight order`, () => {
          const h = storyboardHalf(state, shape, pairfull, PACKS);
          expect(h.invisible).toEqual([]);
          expect([...h.visible].sort()).toEqual([...h.colours].sort());
          // The caption names every colour it draws (the storyboard's caption check, here per case).
          for (const c of h.visible) expect(h.captionNames, h.caption ?? '').toContain(c);
          // The cut-outs: the extras always (and the third where nothing is painted in), heaviest first, the heavier
          // pair colour's ground first (two), then the lighter's.
          const cuts = h.drawn.filter((d) => d.kind === 'cutout');
          const extras = h.pick.extras;
          expect(cuts.slice(-extras.length).map((d) => d.colours[0])).toEqual(extras);
          const grounds = cuts.map((d) => /\((heavier|lighter) ground (\d)\/(\d)/.exec(d.what)!.slice(1));
          const heavy = grounds.filter((g) => g[0] === 'heavier');
          expect(heavy.length).toBeLessThanOrEqual(2);
          expect(grounds.map((g) => g[0])).toEqual([...grounds.map((g) => g[0])].sort());
        });

  it('each cut-out faded by its share: n × its weight over every coloured land, at most 1', () => {
    const h = storyboardHalf(side({ W: 6, U: 5, B: 4, R: 3, G: 2 }, ['W', 'U', 'B', 'R', 'G']), 'phone', true, PACKS);
    // 20 lands, five colours: the swamp 5 × 4 / 20 = 1, the mountain 0.75, the forest 0.5.
    expect(cutOuts(h)).toEqual(['swamp cut-out (heavier ground 1/2, 1)', 'mountain cut-out (heavier ground 2/2, 0.75)', 'forest cut-out (lighter ground 1/1, 0.5)']);
  });
});

describe('spec 1.19 c: no clamp -- a missing cell is the two mono pictures apart', () => {
  for (const shape of SHAPES)
    it(`Forest ×3 then an Island (${shape}): island s1 | forest s3 has no cell, so each colour’s own picture, a plain seam, and the caption says so`, () => {
      const steps = play('F F F I', shape);
      const h = steps[3]!;
      // 1.17 drew the cell 2x3 here, the lone Island raised to stage 2 (and to 4 by the fifth Forest: the storyboard's gap 4).
      expect(h.drawn.map((d) => d.kind)).toEqual(['apart']);
      expect(h.picture).toBe('forest+island apart, no cell 1x3: island s1 | forest s3');
      expect(h.picturePair).toEqual(['G', 'U']);
      expect(h.caption).toMatch(/^forest \+ island, whole half: forest 75% \| island 25%, island s1 \| forest s3, no seam cell$/);
      // Two more Forests: still apart, the island still at its own stage 1; the next Island makes 2x5, still apart.
      const more = play('F F F I F F I', shape);
      expect(more.map((x) => x.picture.replace(/ \+ cut-outs.*/, ''))).toEqual([
        'forest s1',
        'forest s2',
        'forest s3',
        'forest+island apart, no cell 1x3: island s1 | forest s3',
        'forest+island apart, no cell 1x4: island s1 | forest s4',
        'forest+island apart, no cell 1x5: island s1 | forest s5',
        'forest+island apart, no cell 2x5: island s2 | forest s5',
      ]);
    });

  it('a third colour over a pair apart is its cut-out (no painted picture for those stages), on the heavier colour’s ground', () => {
    for (const shape of SHAPES) {
      const h = storyboardHalf(side({ G: 5, U: 1, B: 1 }, ['G', 'U', 'B']), shape, true, PACKS);
      expect(h.picture).toBe('forest+island apart, no cell 1x5: island s1 | forest s5 + cut-outs B');
      expect(cutOuts(h)).toEqual(['swamp cut-out (heavier ground 1/1, 0.429)']);
      expect(h.caption).toMatch(/island s1 \| forest s5, no seam cell; swamp as an element$/);
      expect(h.invisible).toEqual([]);
    }
  });

  it('a cell, when it exists, is always preferred: forest 3 | island 2 is the cell 2x3', () => {
    const h = storyboardHalf(side({ G: 3, U: 2 }, ['G', 'U']), 'desktop', true, PACKS);
    expect(h.picture).toMatch(/^forest\+island cell 2x3 \[s2x3-panorama\]$/);
  });
});
