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
import { PAIR_FULL_HOLD_MS, pairFullCandidates, pairFullCaption, pairFullChoice, pairFullElementSide, pairFullHeavierSide, pairFullHold, pairFullPlan, type PairFullHold, type PairFullPair } from './pairfull.ts';
import { FORGECOACH_PAIRS_FULL_URL } from './prefs.ts';
import { readFileSync } from 'node:fs';
import { MAX_PAIRS_PACK_BYTES, pairElementAt, pairElementEntryAt, pairPictures, pairsBytes, pairsRefBytes, validatePairs } from './pairs.ts';

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
      'pairs.island+plains.stages[1].elements.G: not an object { src, phone, bytes } or { left, right }; ignored',
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

/**
 * The review of #198: on a cold cache the gate's fallback was a layout jump -- one colour's panel, then two panels and a
 * band, then the panorama. A half now holds what it drew last while the pair picture it wants loads.
 */
describe('the load gate holds the previous picture (no band flash)', () => {
  const pairs = fixture().pairs!;
  const pairOf = (items: ReturnType<typeof pairFullPlan>) => items?.find((x): x is PairFullPair => x.kind === 'pair') ?? null;
  const two = halfLayout([slot('plains', 0, 1), slot('island', 1, 1)], null);
  const mono = halfLayout([slot('plains', 0, 1)], null);
  const plan = pairFullPlan(two, pairs, { thresholds: T });
  const cands = pairFullCandidates(pairOf(plan)!, 3.2, false);
  const st = (m: Record<string, 'ready' | 'failed'>) => (src: string) => m[src] ?? 'pending';
  const pano = cands[0]!.art.picture!.src;

  it('a second colour arrives with its panorama cold: the mono picture stays, then the panorama, never the band', () => {
    let hold: PairFullHold<typeof mono> = { last: null, since: null };
    const step = (layout: typeof mono, p: typeof plan, status: ReturnType<typeof st>, now: number) => {
      const r = pairFullHold({ layout, plan: p, choice: p ? pairFullChoice(cands, status) : null }, hold, now);
      hold = r.hold;
      return r;
    };
    expect(step(mono, null, st({}), 0).draw).toMatchObject({ layout: mono, plan: null });
    const waiting = step(two, plan, st({}), 1000);
    expect([waiting.holding, waiting.draw.layout === mono, waiting.draw.plan]).toEqual([true, true, null]);
    expect(step(two, plan, st({}), 3000).draw.layout).toBe(mono);
    const ready = step(two, plan, st({ [pano]: 'ready' }), 3500);
    expect([ready.holding, ready.draw.layout === two, ready.draw.plan === plan, ready.draw.shown === cands[0]]).toEqual([false, true, true, true]);
  });

  it('a stage change with a cold panorama holds the previous stage’s picture', () => {
    const shown = { layout: two, plan, shown: cands[0]! };
    const three = halfLayout([slot('plains', 0, 2), slot('island', 1, 1)], null);
    const next = pairFullPlan(three, pairs, { thresholds: T });
    const c3 = pairFullCandidates(pairOf(next)!, 3.2, false);
    const r = pairFullHold({ layout: three, plan: next, choice: pairFullChoice(c3, st({})) }, { last: shown, since: null }, 0);
    expect(r.draw).toBe(shown);
  });

  it('no picture drawn before, the hold run out, or every picture failed: the panels', () => {
    expect(pairFullHold({ layout: two, plan, choice: pairFullChoice(cands, st({})) }, { last: null, since: null }, 0).draw).toEqual({ layout: two, plan: null, shown: null });
    const last = { layout: mono, plan: null, shown: null };
    const timedOut = pairFullHold({ layout: two, plan, choice: pairFullChoice(cands, st({})) }, { last, since: 0 }, PAIR_FULL_HOLD_MS);
    expect([timedOut.holding, timedOut.draw.layout === two, timedOut.draw.plan]).toEqual([false, true, null]);
    const failed = Object.fromEntries(cands.map((c) => [c.art.picture!.src, 'failed' as const]));
    expect(pairFullHold({ layout: two, plan, choice: pairFullChoice(cands, st(failed)) }, { last, since: null }, 0).draw).toEqual({ layout: two, plan: null, shown: null });
  });

  it('pre-warms, under the flag, each live colour’s stage-1 pair panoramas with the colours it lacks (at most four)', () => {
    const v4 = validatePairs(JSON.parse(readFileSync(new URL('./testdata/pairs-v4.pairs.json', import.meta.url), 'utf8')), `${FORGECOACH_PAIRS_FULL_URL}pairs.json`).pairs!;
    const one = pairPictures(v4, [[{ biome: 'island', stage: 1, weight: 1 }]], { phone: false, full: { thresholds: T } }).map((x) => x.src.replace(FORGECOACH_PAIRS_FULL_URL, ''));
    expect(one.sort()).toEqual(['pairs/forest-island/s1-panorama.webp', 'pairs/island-mountain/s1-panorama.webp', 'pairs/island-plains/s1-panorama.webp', 'pairs/island-swamp/s1-panorama.webp']);
    expect(pairPictures(v4, [[{ biome: 'island', stage: 1, weight: 1 }]], { phone: false })).toEqual([]);
    const phone = pairPictures(v4, [[{ biome: 'island', stage: 1, weight: 1 }]], { phone: true, full: { thresholds: T } });
    expect(phone).toHaveLength(4);
    expect(phone.every((x) => x.src.endsWith('-panorama-phone.webp'))).toBe(true);
  });
});

/**
 * Spec 1.16.1: sided entries. The painter's set is one picture per pair colour's ground -- `s<k>+<C>L` (the feature on the
 * key's left colour's ground) and `s<k>+<C>R` -- and SYSTEM.md A5 puts the element on the heavier pair colour's ground.
 */
describe('spec 1.16.1: sided painted-in elements', () => {
  const P5 = 'https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v5-phone/';
  const sideOf = (key: string, k: number, c: string, s: 'L' | 'R') => ({
    src: `pairs/${key}/s${k}+${c}${s}-panorama.webp`,
    bytes: 180000,
    phone: { src: `${P5}pairs/${key}/s${k}+${c}${s}-panorama-phone.webp`, bytes: 280000 },
  });
  /** island+plains (the key's left: island, its right: plains); red sided at stages 2 and 3, swamp at stage 2 with its left only and an unsided src. */
  function sided(extra: Record<string, unknown> = {}) {
    const key = 'island-plains';
    const stages = [1, 2, 3].map((k) => ({
      half: { src: `https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v2/pairs/${key}/s${k}-half.webp`, bytes: 300000 },
      panorama: { ...panorama(key, k), bytes: 150000, phone: { ...panorama(key, k).phone, src: `https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v4/pairs/${key}/s${k}-panorama-phone.webp`, bytes: 250000 } },
      ...(k >= 2
        ? {
            elements: {
              R: { left: sideOf(key, k, 'R', 'L'), right: sideOf(key, k, 'R', 'R'), horizon: 0.48 },
              ...(k === 2 ? { B: { src: `pairs/${key}/s2+B-panorama.webp`, phone: `pairs/${key}/s2+B-panorama-phone.webp`, bytes: 400000, left: { ...sideOf(key, 2, 'B', 'L'), horizon: 0.5 } } } : {}),
            },
          }
        : {}),
    }));
    return validatePairs({ schema: 1, spec: '1.16.1', pairs: { 'island+plains': { dual: 'Tundra', stages }, ...extra } }, `${BASE}pairs.json`);
  }
  const pairs = sided().pairs!;
  const pair = pairs.pairs['island+plains']!;
  const plan = (slots: SlotState[], elements: ReadonlySet<Biome> | null = null) => pairFullPlan(halfLayout(slots, null), pairs, { thresholds: T, elements });
  const pairOf = (items: ReturnType<typeof plan>) => items?.find((x): x is PairFullPair => x.kind === 'pair') ?? null;
  const first = (p: PairFullPair) => pairFullCandidates(p, 3.2, false)[0]!;

  it('reads both sides in the panorama’s shape, the entry’s own fields between the panorama’s and the side’s', () => {
    const r = sided();
    expect(r.errors).toEqual([]);
    expect(r.pairs!.spec).toBe('1.16.1');
    const red = pairElementEntryAt(pair, 2, 'R')!;
    expect(red.any).toBeNull();
    expect(red.left).toMatchObject({ src: `${BASE}pairs/island-plains/s2+RL-panorama.webp`, width: 3277, height: 640, focal: { x: 0.5, y: 0.52 }, horizon: 0.48, hour: 9, bytes: 180000, phoneBytes: 280000 });
    expect(red.right!.phone).toMatchObject({ src: `${P5}pairs/island-plains/s2+RR-panorama-phone.webp`, width: 1638, height: 1280, horizon: 0.47 });
    expect(pairElementAt(pair, 2, 'R', 'left')!.src).toBe(`${BASE}pairs/island-plains/s2+RL-panorama.webp`);
    expect(pairElementAt(pair, 3, 'R', 'right')!.src).toBe(`${BASE}pairs/island-plains/s3+RR-panorama.webp`);
    // Swamp gives its left side and an unsided src: the right side falls back to the unsided picture.
    expect(pairElementAt(pair, 2, 'B', 'left')!.horizon).toBe(0.5);
    expect(pairElementAt(pair, 2, 'B', 'right')!.src).toBe(`${BASE}pairs/island-plains/s2+B-panorama.webp`);
    // Stage 1 has none.
    expect(pairElementEntryAt(pair, 1, 'R')).toBeNull();
  });

  it('a 1.16 unsided entry still reads as before, both sides its one picture', () => {
    const one = fixture().pairs!.pairs['island+plains']!;
    for (const s of ['left', 'right'] as const) expect(pairElementAt(one, 2, 'R', s)!.src).toBe(`${BASE}pairs/island-plains/s2+R-panorama.webp`);
  });

  it('warns and drops a bad side, and an entry with no usable side', () => {
    const r = validatePairs(
      {
        schema: 1,
        pairs: {
          'island+plains': {
            stages: [
              { half: { src: 'pairs/a/s1-half.webp' } },
              { half: { src: 'pairs/a/s2-half.webp' }, panorama: panorama('a', 2), elements: { R: { left: 'nope', right: { src: 'pairs/a/s2+RR-panorama.webp' } }, G: { left: { bytes: 1 } } } },
            ],
          },
        },
      },
      `${BASE}pairs.json`,
    );
    expect(r.warnings.filter((w) => w.includes('.elements'))).toEqual([
      'pairs.island+plains.stages[1].elements.R.left: not an object { src, phone, bytes }; ignored',
      expect.stringContaining('pairs.island+plains.stages[1].elements.G.left.src'),
      'pairs.island+plains.stages[1].elements.G: no usable side (left or right); ignored',
    ]);
    const p = r.pairs!.pairs['island+plains']!;
    expect(pairElementAt(p, 2, 'R', 'left')).toBeNull();
    expect(pairElementAt(p, 2, 'R', 'right')!.src).toBe(`${BASE}pairs/a/s2+RR-panorama.webp`);
    expect(pairElementEntryAt(p, 2, 'G')).toBeNull();
  });

  it('counts each shape in the ref its own file lies in (phone.bytes), and says painted elements are expected past 4 MB', () => {
    // halves 3 × 300 kB (pairs-v2's tag), panoramas 3 × (150 + 250) kB (phone at pairs-v4's), red 4 × (180 + 280) kB (phone at pairs-v5-phone),
    // swamp's unsided 400 kB and its left (180 + 280) kB.
    expect(pair.bytes).toBe(3 * 300000 + 3 * 400000 + 4 * 460000 + 400000 + 460000);
    expect(pair.refBytes).toBe(3 * 150000 + 4 * 180000 + 400000 + 180000);
    // Past 4 MB with 2.6 MB of painted pictures: the warning says painted elements are expected to take a pair past it.
    expect(sided().warnings).toEqual([
      "pairs.island+plains: 4.6 MB of stage pictures declared, 2.6 MB of them painted-in elements; the budget is 4 MB per pair, and a set of painted-in elements (1.16) is expected to exceed it: a half loads only the picture it shows and the next stage's (pictures kept)",
    ]);
    // A full sided set (three colours, two sides, three stages):
    const stages = [1, 2, 3].map((k) => ({ half: { src: `pairs/x/s${k}-half.webp`, bytes: 300000 }, panorama: panorama('x', k), elements: Object.fromEntries(['R', 'B', 'G'].map((c) => [c, { left: sideOf('x', k, c, 'L'), right: sideOf('x', k, c, 'R') }])) }));
    const w = validatePairs({ schema: 1, pairs: { 'island+plains': { stages } } }, `${BASE}pairs.json`).warnings;
    expect(w).toEqual([
      'pairs.island+plains: 9.9 MB of stage pictures declared, 7.9 MB of them painted-in elements; the budget is 4 MB per pair, and a set of painted-in elements (1.16) is expected to exceed it: a half loads only the picture it shows and the next stage\'s (pictures kept)',
    ]);
  });

  it('the pick: the heavier pair colour’s side, in the key’s order', () => {
    // Plateau, Plains, Island (SYSTEM.md's worked example): plains 1.5 > island 1. The key's right colour is plains: R.
    const heavyRight = pairOf(plan([slot('mountain', 0, 0.5), slot('island', 1, 1), slot('plains', 2, 1.5)]))!;
    expect([heavyRight.mirror, heavyRight.elementSide, first(heavyRight).art.picture!.src]).toEqual([false, 'right', `${BASE}pairs/island-plains/s2+RR-panorama.webp`]);
    expect(pairFullElementSide(heavyRight, () => 0)).toBe('right');
    // Island the heavier: L.
    const heavyLeft = pairOf(plan([slot('mountain', 0, 0.5), slot('island', 1, 1.5), slot('plains', 2, 1)]))!;
    expect([heavyLeft.elementSide, first(heavyLeft).art.picture!.src.replace(BASE, '')]).toEqual(['left', 'pairs/island-plains/s2+RL-panorama.webp']);
  });

  it('mirrored: the rule on the key’s colours before mirroring, so the feature still lands on the heavier ground', () => {
    // Plains arrived first, so the board has plains | island: the art is mirrored. Plains heavier → the key's right (R),
    // drawn mirrored onto the board's left, where plains is.
    const p = pairOf(plan([slot('plains', 0, 1.5), slot('island', 1, 1), slot('mountain', 2, 0.5)]))!;
    expect([p.left, p.right, p.mirror]).toEqual(['plains', 'island', true]);
    expect(pairFullHeavierSide(p, () => 0)).toBe('left');
    expect(p.elementSide).toBe('right');
    expect(first(p).art.picture!.src.replace(BASE, '')).toBe('pairs/island-plains/s2+RR-panorama.webp');
    // Island heavier on the same board: the key's left (L).
    const q = pairOf(plan([slot('plains', 0, 1), slot('island', 1, 1.5), slot('mountain', 2, 0.5)]))!;
    expect([q.mirror, q.elementSide]).toEqual([true, 'left']);
  });

  it('a tie: the colour that arrived first, as the cut-out’s side', () => {
    const p = pairOf(plan([slot('plains', 0, 1), slot('island', 1, 1), slot('mountain', 2, 1)]))!;
    // Board plains | island (mirrored), tied: plains arrived first, its ground: the key's right.
    expect([p.mirror, p.elementSide]).toEqual([true, 'right']);
    const q = pairOf(plan([slot('island', 0, 1), slot('plains', 1, 1), slot('mountain', 2, 1)]))!;
    expect([q.mirror, q.elementSide]).toEqual([false, 'left']);
  });

  it('the fallback: no picture on the side picked → the base panorama with the 1.14 cut-out, or the third colour’s panel', () => {
    // Swamp at stage 2 has its left and an unsided src: plains heavier (right) takes the unsided picture.
    const s2 = [slot('swamp', 0, 0.5), slot('island', 1, 1), slot('plains', 2, 1.5)];
    expect(first(pairOf(plan(s2))!).art.picture!.src.replace(BASE, '')).toBe('pairs/island-plains/s2+B-panorama.webp');
    // A pack with sides only: the right side absent → no painted picture; the cut-out stands in, or the panel.
    const leftOnly = validatePairs(
      { schema: 1, pairs: { 'island+plains': { stages: [1, 2].map((k) => ({ half: { src: `pairs/ip/s${k}-half.webp` }, panorama: panorama('ip', k), ...(k === 2 ? { elements: { R: { left: sideOf('ip', 2, 'R', 'L') } } } : {}) })) } } },
      `${BASE}pairs.json`,
    ).pairs!;
    const lay = halfLayout([slot('mountain', 0, 0.5), slot('island', 1, 1), slot('plains', 2, 1.5)], null);
    expect(pairFullPlan(lay, leftOnly, { thresholds: T })!.map((x) => x.kind)).toEqual(['slot', 'pair']);
    const cut = pairOf(pairFullPlan(lay, leftOnly, { thresholds: T, elements: new Set<Biome>(['mountain']) }))!;
    expect([cut.element, cut.elementSide]).toEqual(['mountain', 'right']);
    expect(pairFullCandidates(cut, 3.2, false).map((x) => [x.art.picture!.src.replace(BASE, ''), x.painted])).toEqual([['pairs/ip/s2-panorama.webp', null], ['pairs/ip/s2-half.webp', null]]);
    // Island heavier: its left side is painted.
    const left = pairOf(pairFullPlan(halfLayout([slot('mountain', 0, 0.5), slot('island', 1, 1.5), slot('plains', 2, 1)], null), leftOnly, { thresholds: T }))!;
    expect(first(left).painted).toBe('R');
  });

  it('the caption says the colour is painted in, and on whose ground', () => {
    expect(pairFullCaption(plan([slot('mountain', 0, 0.5), slot('island', 1, 1), slot('plains', 2, 1.5)]))).toContain('; R painted in, on plains\'s ground');
    expect(pairFullCaption(plan([slot('plains', 0, 2.5), slot('island', 1, 2), slot('swamp', 2, 0.5)], new Set<Biome>(['swamp'])))).toContain('; swamp as an element');
  });

  it('a land that turns the balance changes the picture (the strip cross-fades on a new src)', () => {
    const a = first(pairOf(plan([slot('mountain', 0, 0.5), slot('island', 1, 1), slot('plains', 2, 1.5)]))!);
    const b = first(pairOf(plan([slot('mountain', 0, 0.5), slot('island', 1, 2), slot('plains', 2, 1.5)]))!);
    expect([a.painted, b.painted]).toEqual(['R', 'R']);
    expect(a.art.picture!.src).not.toBe(b.art.picture!.src);
  });

  it('pairPictures warms the side the half would draw (both on a tie with no arrival order)', () => {
    const warm = (side: { biome: Biome; stage: number; weight: number; index?: number }[]) =>
      pairPictures(pairs, [side], { phone: false, full: { thresholds: T } })
        .map((x) => x.src.replace(BASE, ''))
        .filter((s) => s.includes('+'));
    expect(warm([{ biome: 'mountain', stage: 1, weight: 0.5 }, { biome: 'island', stage: 1, weight: 1 }, { biome: 'plains', stage: 2, weight: 1.5 }])).toEqual(['pairs/island-plains/s2+RR-panorama.webp', 'pairs/island-plains/s3+RR-panorama.webp']);
    expect(warm([{ biome: 'mountain', stage: 1, weight: 1 }, { biome: 'island', stage: 1, weight: 1 }, { biome: 'plains', stage: 1, weight: 1 }])).toEqual([
      'pairs/island-plains/s2+RL-panorama.webp',
      'pairs/island-plains/s2+RR-panorama.webp',
      'pairs/island-plains/s3+RL-panorama.webp',
      'pairs/island-plains/s3+RR-panorama.webp',
    ]);
    expect(warm([{ biome: 'mountain', stage: 1, weight: 1, index: 0 }, { biome: 'plains', stage: 1, weight: 1, index: 1 }, { biome: 'island', stage: 1, weight: 1, index: 2 }])).toEqual(['pairs/island-plains/s2+RR-panorama.webp', 'pairs/island-plains/s3+RR-panorama.webp']);
  });
});
