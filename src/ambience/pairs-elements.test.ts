/*
 * ForgeCoach — ambience/pairs-elements.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.16, painted-in elements (the reader side, for the batch the painter
 * makes as `pairs/<a>-<b>/s<k>+<C>-panorama.webp` and `…-phone.webp`): a pair
 * stage's `elements[<colour>]` is that stage's panorama with the third
 * colour's feature painted into the place. The reader takes the panorama's
 * shape for what an entry leaves out, counts its bytes in the pair's budget,
 * and under `?pairfull=1` draws it instead of the panorama when the half's
 * third colour has one at the stage shown (falling back to the 1.14 cut-out
 * element when absent). Also review fault 7: the pack's 45 MB warning counts
 * only the files in its own ref.
 */
import { describe, expect, it } from 'vitest';
import { halfLayout } from './layout.ts';
import type { Biome, SlotState } from './model.ts';
import { pairFullCandidates, pairFullChoice, pairFullPlan, type PairFullPair } from './pairfull.ts';
import { MAX_PAIRS_PACK_BYTES, pairElementAt, pairPictures, pairsBytes, pairsRefBytes, validatePairs } from './pairs.ts';

const BASE = 'https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v5/';
const T = [1, 2, 3, 4, 5, 6];
const slot = (biome: Biome, index: number, weight: number): SlotState => ({ biome, index, weight, stage: Math.min(6, Math.ceil(weight)), peak: Math.min(6, Math.ceil(weight)) });

const panorama = (key: string, k: number) => ({
  src: `pairs/${key}/s${k}-panorama.webp`,
  width: 3277,
  height: 640,
  subjectBand: [0.38, 0.72],
  focal: { x: 0.5, y: 0.52 },
  safe: { x: 0.1875, y: 0.38, w: 0.625, h: 0.34 },
  horizon: 0.47,
  hour: 9,
  key: 'morning',
  bytes: 400000,
  phone: { src: `pairs/${key}/s${k}-panorama-phone.webp`, width: 1638, height: 1280, subjectBand: [0.33, 0.68], focal: { x: 0.5, y: 0.5 }, horizon: 0.47 },
});
/** The fixture: island+plains with a painted swamp (B) on stage 2 and a painted mountain (R) on stages 1–3; the halves at another tag. */
function fixture(extra: Record<string, unknown> = {}) {
  const key = 'island-plains';
  const stages = [1, 2, 3].map((k) => ({
    half: { src: `https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v2/pairs/${key}/s${k}-half.webp`, bytes: 300000 },
    panorama: panorama(key, k),
    elements: {
      R: { src: `pairs/${key}/s${k}+R-panorama.webp`, phone: `pairs/${key}/s${k}+R-panorama-phone.webp`, bytes: 420000 },
      ...(k === 2 ? { B: { src: `pairs/${key}/s2+B-panorama.webp`, phone: { src: `pairs/${key}/s2+B-panorama-phone.webp`, horizon: 0.5 }, bytes: 410000, horizon: 0.49 } } : {}),
    },
  }));
  return validatePairs({ schema: 1, spec: '1.16', pairs: { 'island+plains': { dual: 'Tundra', stages }, ...extra } }, `${BASE}pairs.json`);
}

describe('spec 1.16: the manifest', () => {
  it('reads each painted element in its stage panorama’s shape, `phone` a URL or an object', () => {
    const r = fixture();
    expect(r.errors).toEqual([]);
    const pair = r.pairs!.pairs['island+plains']!;
    const red = pairElementAt(pair, 2, 'R')!;
    expect(red).toMatchObject({ src: `${BASE}pairs/island-plains/s2+R-panorama.webp`, width: 3277, height: 640, subjectBand: [0.38, 0.72], focal: { x: 0.5, y: 0.52 }, horizon: 0.47, hour: 9, key: 'morning', bytes: 420000 });
    expect(red.phone).toMatchObject({ src: `${BASE}pairs/island-plains/s2+R-panorama-phone.webp`, width: 1638, height: 1280, subjectBand: [0.33, 0.68], horizon: 0.47 });
    // Its own horizon wins over the panorama's, on both shapes.
    const swamp = pairElementAt(pair, 2, 'B')!;
    expect([swamp.horizon, swamp.phone!.horizon]).toEqual([0.49, 0.5]);
    // Never borrowed from another stage; past the last stage, the last.
    expect(pairElementAt(pair, 1, 'B')).toBeNull();
    expect(pairElementAt(pair, 5, 'R')!.src).toBe(`${BASE}pairs/island-plains/s3+R-panorama.webp`);
    expect(pairElementAt(pair, 2, 'G')).toBeNull();
  });

  it('counts the painted elements in the pair’s budget (each file once) and in the ref', () => {
    const r = fixture();
    const pair = r.pairs!.pairs['island+plains']!;
    // 3 halves (300 kB) + 3 panoramas (400 kB) + 3 red (420 kB) + 1 swamp (410 kB).
    expect(pair.bytes).toBe(3 * 300000 + 3 * 400000 + 3 * 420000 + 410000);
    // Over the 4 MB per pair? 3.77 MB here: no warning. A full set (three colours × three stages) is not.
    expect(r.warnings).toEqual([]);
    // The halves are at pairs-v2's tag: not this ref's.
    expect(pair.refBytes).toBe(3 * 400000 + 3 * 420000 + 410000);
    expect(pairsRefBytes(r.pairs)).toBe(pair.refBytes);
  });

  it('warns and drops what it cannot use: a stage with no panorama, a bad colour, a bad entry', () => {
    const r = validatePairs(
      {
        schema: 1,
        pairs: {
          'island+plains': {
            stages: [
              { half: { src: 'pairs/a/s1-half.webp' }, elements: { R: { src: 'pairs/a/s1+R-panorama.webp' } } },
              { half: { src: 'pairs/a/s2-half.webp' }, panorama: panorama('a', 2), elements: { X: { src: 'x.webp' }, G: 'nope', R: { src: 'pairs/a/s2+R-panorama.webp' } } },
            ],
          },
        },
      },
      `${BASE}pairs.json`,
    );
    expect(r.warnings.filter((w) => w.includes('.elements'))).toEqual([
      "pairs.island+plains.stages[0].elements: painted-in elements are variants of the stage's panorama, and this stage has none; ignored",
      'pairs.island+plains.stages[1].elements.X: not a colour (W, U, B, R, G); ignored',
      'pairs.island+plains.stages[1].elements.G: not an object { src, phone, bytes }; ignored',
    ]);
    const pair = r.pairs!.pairs['island+plains']!;
    expect(pairElementAt(pair, 1, 'R')).toBeNull();
    expect(pairElementAt(pair, 2, 'R')!.width).toBe(3277);
  });

  it('the 45 MB warning counts only this ref’s files (fault 7): another tag’s halves cost it nothing', () => {
    // A pair whose files at pairs-v2's tag declare 46 MB: before the fix, a false "keep a pairs pack under 45 MB".
    const big = {
      'forest+swamp': { stages: [{ half: { src: 'https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v2/pairs/forest-swamp/s1-half.webp', bytes: 46 * 1048576 } }] },
    };
    const r = fixture(big);
    expect(pairsBytes(r.pairs)).toBeGreaterThan(MAX_PAIRS_PACK_BYTES);
    expect(pairsRefBytes(r.pairs)).toBeLessThan(MAX_PAIRS_PACK_BYTES);
    expect(r.warnings.filter((w) => w.startsWith('pairs: '))).toEqual([]);
    // The same bytes in this ref do warn.
    const own = fixture({ 'forest+swamp': { stages: [{ half: { src: 'pairs/forest-swamp/s1-half.webp', bytes: 46 * 1048576 } }] } });
    expect(own.warnings.some((w) => w.startsWith('pairs: ') && w.includes('own folder'))).toBe(true);
  });
});

describe('spec 1.16: the reader', () => {
  const pairs = fixture().pairs!;
  const plan = (slots: SlotState[], elements: ReadonlySet<Biome> | null = null) => pairFullPlan(halfLayout(slots, null), pairs, { thresholds: T, elements });
  const pairOf = (items: ReturnType<typeof plan>) => items?.find((x): x is PairFullPair => x.kind === 'pair') ?? null;

  it('a third colour painted in at the stage shown: the whole half, the painted panorama first, even with no cut-out element', () => {
    // Plains 1.5, island 1, mountain ½: island+plains, stage 2 (three lands), red painted at every stage.
    const items = plan([slot('mountain', 0, 0.5), slot('plains', 1, 1.5), slot('island', 2, 1)]);
    expect(items).toHaveLength(1);
    const p = pairOf(items)!;
    expect([p.key, p.stage, p.element]).toEqual(['island+plains', 2, 'mountain']);
    const c = pairFullCandidates(p, 3.2, false);
    expect(c.map((x) => [x.art.picture!.src.replace(BASE, ''), x.painted])).toEqual([
      ['pairs/island-plains/s2+R-panorama.webp', 'R'],
      ['pairs/island-plains/s2-panorama.webp', null],
      ['https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v2/pairs/island-plains/s2-half.webp', null],
    ]);
    // On a phone, the painted phone picture.
    expect(pairFullCandidates(p, 1.2, true)[0]!.art.picture!.src).toBe(`${BASE}pairs/island-plains/s2+R-panorama-phone.webp`);
  });

  it('absent at that stage: the 1.14 cut-out element over the panorama, or the third colour’s panel without one', () => {
    // Swamp is painted on stage 2 only: at stage 3 (five lands) it is not.
    const s = [slot('plains', 0, 2.5), slot('island', 1, 2), slot('swamp', 2, 0.5)];
    expect(pairOf(plan(s))!.element).toBeUndefined();
    expect(plan(s)!.map((x) => x.kind)).toEqual(['pair', 'slot']);
    const withCutOut = pairOf(plan(s, new Set<Biome>(['swamp'])))!;
    expect([withCutOut.stage, withCutOut.element]).toEqual([3, 'swamp']);
    expect(pairFullCandidates(withCutOut, 3.2, false).map((x) => x.painted)).toEqual([null, null]);
    // At stage 2 swamp is painted in.
    const s2 = [slot('plains', 0, 1.5), slot('island', 1, 1), slot('swamp', 2, 0.5)];
    expect(pairFullCandidates(pairOf(plan(s2))!, 3.2, false)[0]!.painted).toBe('B');
  });

  it('the load gate: the base panorama stays on screen until the painted one has loaded, then the painted one; a failed one is passed over', () => {
    const p = pairOf(plan([slot('mountain', 0, 0.5), slot('plains', 1, 1.5), slot('island', 2, 1)]))!;
    const c = pairFullCandidates(p, 3.2, false);
    const [painted, pano, half] = c.map((x) => x.art.picture!.src);
    const st = (m: Record<string, 'ready' | 'failed'>) => (src: string) => m[src] ?? 'pending';
    // Nothing loaded: nothing to show (the half falls back to its panels), the painted one wanted.
    expect(pairFullChoice(c, st({}))).toEqual({ show: null, want: c[0] });
    // The panorama is on screen; the painted one still loading.
    expect(pairFullChoice(c, st({ [pano!]: 'ready' })).show).toBe(c[1]);
    expect(pairFullChoice(c, st({ [pano!]: 'ready', [painted!]: 'ready' })).show).toBe(c[0]);
    // The painted one failed: the panorama is wanted and shown.
    expect(pairFullChoice(c, st({ [pano!]: 'ready', [painted!]: 'failed' }))).toEqual({ show: c[1], want: c[1] });
    // Everything failed: nothing to show, nothing to wait for.
    expect(pairFullChoice(c, st({ [painted!]: 'failed', [pano!]: 'failed', [half!]: 'failed' }))).toEqual({ show: null, want: null });
  });

  it('pairPictures warms the panorama and the painted elements under the flag, and nothing new without it (fault 4)', () => {
    const side = [{ biome: 'plains' as Biome, stage: 2, weight: 1.5 }, { biome: 'island' as Biome, stage: 1, weight: 1 }, { biome: 'mountain' as Biome, stage: 1, weight: 0.5 }];
    const plain = pairPictures(pairs, [side], { phone: false }).map((x) => x.src.replace(BASE, ''));
    expect(plain.some((s) => s.includes('panorama'))).toBe(false);
    const full = pairPictures(pairs, [side], { phone: false, full: { thresholds: T } }).map((x) => x.src.replace(BASE, ''));
    // The pair's own two (2.5 lands → pair stage 1) and the next; red painted at the stage of every land (3 → pair stage 2) and the next.
    expect(full.filter((s) => s.includes('panorama'))).toEqual(['pairs/island-plains/s1-panorama.webp', 'pairs/island-plains/s2-panorama.webp', 'pairs/island-plains/s2+R-panorama.webp', 'pairs/island-plains/s3+R-panorama.webp']);
    const phone = pairPictures(pairs, [side], { phone: true, full: { thresholds: T } }).map((x) => x.src.replace(BASE, ''));
    expect(phone).toContain('pairs/island-plains/s2+R-panorama-phone.webp');
  });
});
