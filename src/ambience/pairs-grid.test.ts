/*
 * ForgeCoach — ambience/pairs-grid.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.17 (draft): the seam grid. A fixture manifest -- pairs-v5's
 * snapshot with a `grid` written into three pairs the way
 * ~/scenery-packs/panoramas-v1/tools/make_pairs_v6_draft.py writes them:
 *
 * - island+swamp: the key's order IS the geography's (island left), 16 cells;
 * - forest+swamp: the key is alphabetical (forest first) but the geography
 *   puts the swamp LEFT, 16 cells -- the case where the cell's mirror and the
 *   stage pictures' mirror differ;
 * - mountain+plains: a partial grid (cells missing), for the fallback.
 *
 * Checked: the reader's parse (orientation, the cell's shape from the pair's
 * panorama, bytes, warnings), the pick for every (i, j) in 1..6² with the
 * clamp, the plan (mirror, split, a third colour drawing nothing, the
 * `stages` fallback), the candidates, the caption, the warming.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { halfLayout } from './layout.ts';
import type { Biome, SlotState } from './model.ts';
import { gridCaption, PAIR_FULL_HOLD_MS, pairFullCandidates, pairFullCaption, pairFullChoice, pairFullGrid, pairFullHold, pairFullPlan, pairFullView, type PairFullHold, type PairFullPair } from './pairfull.ts';
import { GEOGRAPHY, geographyOrder, gridCellKey, pairGridPick, pairPictures, validatePairs } from './pairs.ts';

const CDN = 'https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery';
const BASE = `${CDN}@pairs-v6-draft/`;
const T = [1, 2, 3, 4, 5, 6];
const CELL_BYTES = 200_000;
const slot = (b: Biome, index: number, weight: number): SlotState => ({ biome: b, index, weight, stage: Math.min(6, Math.ceil(weight)), peak: Math.min(6, Math.ceil(weight)) });

/** The 16 cells |i − j| ≤ 1 the draft paints. */
const NEAR: [number, number][] = [];
for (let i = 1; i <= 6; i++) for (let j = 1; j <= 6; j++) if (Math.abs(i - j) <= 1) NEAR.push([i, j]);

function gridOf(slug: string, cells: readonly [number, number][]) {
  return Object.fromEntries(cells.map(([i, j]) => [`${i}x${j}`, { src: `seams/${slug}/s${i}x${j}-panorama.webp`, width: 3277, height: 640, bytes: CELL_BYTES }]));
}

function fixture() {
  const raw = JSON.parse(readFileSync(new URL('./testdata/pairs-v5.pairs.json', import.meta.url), 'utf8'));
  raw.spec = '1.17';
  raw.name = 'ForgeCoach pair scenery, pairs-v6 draft (seam grid)';
  raw.pairs['island+swamp'].grid = gridOf('island-swamp', NEAR);
  raw.pairs['forest+swamp'].grid = gridOf('swamp-forest', NEAR);
  raw.pairs['mountain+plains'].grid = gridOf('plains-mountain', [[1, 1], [2, 2], [3, 2]]);
  return raw;
}

/** The cell the draft's rule shows for true stages (i, j): exact within one stage, else the lighter half one below the heavier. */
const expected = (i: number, j: number): [number, number] => (Math.abs(i - j) <= 1 ? [i, j] : i > j ? [i, i - 1] : [j - 1, j]);

describe('spec 1.17: the seam grid', () => {
  const raw = fixture();
  const r = validatePairs(raw, `${BASE}pairs.json`);
  const pairs = r.pairs!;
  const isw = pairs.pairs['island+swamp']!;
  const fsw = pairs.pairs['forest+swamp']!;
  const mpl = pairs.pairs['mountain+plains']!;
  const plan = (slots: SlotState[], stageOverride: number | null = null) => pairFullPlan(halfLayout(slots, null, stageOverride), pairs, { thresholds: T, slots, stageOverride });
  const pairOf = (items: ReturnType<typeof plan>) => items?.find((x): x is PairFullPair => x.kind === 'pair') ?? null;

  it('reads the grid in the geography’s order, whatever the key’s', () => {
    expect(r.errors).toEqual([]);
    expect(GEOGRAPHY).toEqual(['island', 'swamp', 'plains', 'forest', 'mountain']);
    expect(geographyOrder('forest', 'swamp')).toEqual(['swamp', 'forest']);
    expect(geographyOrder('mountain', 'plains')).toEqual(['plains', 'mountain']);
    expect(geographyOrder('island', 'wastes')).toBeNull();
    expect(isw.grid).toMatchObject({ left: 'island', right: 'swamp' });
    expect(fsw.grid).toMatchObject({ left: 'swamp', right: 'forest' });
    expect(fsw.left).toBe('forest'); // the stage pictures keep the key's order
    expect(mpl.grid).toMatchObject({ left: 'plains', right: 'mountain' });
    expect(Object.keys(isw.grid!.cells).sort()).toEqual(NEAR.map(([i, j]) => gridCellKey(i, j)).sort());
    expect(pairs.pairs['island+plains']!.grid).toBeUndefined();
  });

  it('a cell takes what it leaves out from the pair’s panorama, and its src resolves against the manifest', () => {
    const c = isw.grid!.cells['4x3']!;
    const pano = raw.pairs['island+swamp'].stages[0].panorama;
    expect(c.src).toBe(`${BASE}seams/island-swamp/s4x3-panorama.webp`);
    expect([c.width, c.height]).toEqual([3277, 640]);
    expect(c.focal).toEqual(pano.focal);
    expect(c.subjectBand).toEqual(pano.subjectBand);
    expect(c.horizon).toBe(pano.horizon);
    expect(c.phone).toBeNull(); // desktop only in the draft
    expect(c.bytes).toBe(CELL_BYTES);
  });

  it('counts every cell in its pair’s bytes and, in its own folder, in the ref; the warning names the grid', () => {
    const v5 = validatePairs(JSON.parse(readFileSync(new URL('./testdata/pairs-v5.pairs.json', import.meta.url), 'utf8')), `${BASE}pairs.json`).pairs!;
    expect(isw.bytes - v5.pairs['island+swamp']!.bytes).toBe(16 * CELL_BYTES);
    expect(isw.refBytes - v5.pairs['island+swamp']!.refBytes).toBe(16 * CELL_BYTES);
    expect(mpl.bytes - v5.pairs['mountain+plains']!.bytes).toBe(3 * CELL_BYTES);
    const w = r.warnings.find((x) => x.startsWith('pairs.island+swamp:'))!;
    expect(w).toMatch(/3\.1 MB of them the seam grid \(1\.17\) and \d+\.\d MB painted-in elements; .*a grid is expected to exceed it/);
    // A pair with no grid keeps 1.16.1's wording.
    expect(r.warnings.find((x) => x.startsWith('pairs.island+plains:'))).toMatch(/of them painted-in elements; the budget is 4 MB per pair, and a set of painted-in elements/);
    // No spec warning: this reader knows 1.17.
    expect(r.warnings.some((x) => x.startsWith('spec:'))).toBe(false);
  });

  it('warns about and drops a bad key or cell alone; a far cell is kept with a note; a motif pair or a pair off the geography has none', () => {
    const bad = fixture();
    bad.pairs['island+swamp'].grid = { '7x1': { src: 'a.webp' }, ax2: { src: 'b.webp' }, '2x2': 'c.webp', '1x1': { src: 'd.txt' }, '6x2': { src: 'e.webp', width: 3277, height: 640 }, '3x3': { src: 'f.webp', width: 3277, height: 640 } };
    const rb = validatePairs(bad, `${BASE}pairs.json`);
    const g = rb.pairs!.pairs['island+swamp']!.grid!;
    expect(Object.keys(g.cells).sort()).toEqual(['3x3', '6x2']);
    const ws = rb.warnings.filter((x) => x.startsWith('pairs.island+swamp.grid'));
    expect(ws.some((x) => x.includes('.grid.7x1: not "<i>x<j>"'))).toBe(true);
    expect(ws.some((x) => x.includes('.grid.ax2: not "<i>x<j>"'))).toBe(true);
    expect(ws.some((x) => x.includes('.grid.2x2: not an object'))).toBe(true);
    expect(ws.some((x) => x.includes('.grid.1x1'))).toBe(true);
    expect(ws.some((x) => x.includes('1 cell more than one stage apart'))).toBe(true);
    // The far cell is shown for exactly its stages, before any clamp.
    expect(pairGridPick(rb.pairs!.pairs['island+swamp'], 6, 2)).toMatchObject({ cell: '6x2', clamped: false });
    const none = fixture();
    none.pairs['island+swamp'].grid = { '1x1': 'x' };
    const rn = validatePairs(none, `${BASE}pairs.json`);
    expect(rn.pairs!.pairs['island+swamp']!.grid).toBeUndefined();
    expect(rn.warnings).toContain('pairs.island+swamp.grid: no usable cell; ignored');
    const motif = {
      schema: 1,
      pairs: {
        'island+swamp': { stages: [{ motif: { src: 'm1.webp' } }], grid: gridOf('island-swamp', [[1, 1]]) },
        'island+wastes': { stages: [{ half: { src: 'h1.webp' } }], grid: gridOf('island-wastes', [[1, 1]]) },
      },
    };
    const rm = validatePairs(motif, `${BASE}pairs.json`);
    expect(rm.pairs!.pairs['island+swamp']!.grid).toBeUndefined();
    expect(rm.warnings.some((x) => x.startsWith('pairs.island+swamp.grid: a seam grid needs a band pair'))).toBe(true);
    expect(rm.pairs!.pairs['island+wastes']!.grid).toBeUndefined();
    expect(rm.warnings.some((x) => x.startsWith("pairs.island+wastes.grid: a seam grid is painted in the five colours' geography"))).toBe(true);
  });

  it('picks the cell for every (i, j) in 1..6²: exact within one stage, else the lighter half raised to one below the heavier', () => {
    for (let i = 1; i <= 6; i++)
      for (let j = 1; j <= 6; j++) {
        const pick = pairGridPick(isw, i, j)!;
        const [ei, ej] = expected(i, j);
        expect(pick, `${i}x${j}`).not.toBeNull();
        expect(pick.cell, `${i}x${j}`).toBe(gridCellKey(ei, ej));
        expect(pick.shown).toEqual([ei, ej]);
        expect(pick.stages).toEqual([i, j]);
        expect(pick.clamped).toBe(Math.abs(i - j) > 1);
        // The heavier half is always exact.
        if (i > j) expect(pick.shown[0]).toBe(i);
        if (j > i) expect(pick.shown[1]).toBe(j);
        expect(pick.picture.src).toBe(`${BASE}seams/island-swamp/s${ei}x${ej}-panorama.webp`);
      }
    // Past stage 6 is stage 6; no colour, or no grid, is no pick.
    expect(pairGridPick(isw, 7, 6)?.cell).toBe('6x6');
    expect(pairGridPick(isw, 0, 3)).toBeNull();
    expect(pairGridPick(pairs.pairs['island+plains'], 3, 3)).toBeNull();
    // A missing cell, even after the clamp, is no pick.
    expect(pairGridPick(mpl, 3, 2)?.cell).toBe('3x2');
    expect(pairGridPick(mpl, 2, 3)).toBeNull();
    expect(pairGridPick(mpl, 5, 2)).toBeNull(); // clamped to 5x4, not painted
  });

  it('draws the cell for the two colours’ own stages across the whole half, panned by the share, not mirrored in the geography’s order', () => {
    const items = plan([slot('island', 0, 4), slot('swamp', 1, 3)])!;
    expect(items).toHaveLength(1);
    const p = pairOf(items)!;
    expect(p.grid).toMatchObject({ cell: '4x3', shown: [4, 3], stages: [4, 3], clamped: false, left: 'island', right: 'swamp', mirror: false });
    expect(p.share).toBe(1);
    expect(p.split).toBeCloseTo(4 / 7, 4);
    expect(p.element).toBeUndefined();
    const cands = pairFullCandidates(p, 5, false);
    expect(cands[0]).toMatchObject({ cell: '4x3', mirror: false, painted: null });
    expect(cands[0]!.art.picture!.src).toBe(`${BASE}seams/island-swamp/s4x3-panorama.webp`);
    // Then the stage pictures, should the cell fail to load: 1.15's stage from the total (7 lands → pair stage 3).
    expect(p.stage).toBe(3);
    expect(cands.slice(1).map((c) => [c.cell, c.mirror])).toEqual([
      [undefined, false],
      [undefined, false],
    ]);
    expect(pairFullCaption(items)).toMatch(/whole half: island 57% \| swamp 43%, island s4 \| swamp s3, seam 4x3$/);
  });

  it('mirrors the cell when the board has the pair against the geography: swamp | island', () => {
    const p = pairOf(plan([slot('swamp', 0, 3), slot('island', 1, 4)]))!;
    expect(p.left).toBe('swamp');
    expect(p.grid).toMatchObject({ cell: '4x3', mirror: true });
    expect(p.mirror).toBe(true); // the key's order is the geography's here
    expect(pairFullCandidates(p, 5, false)[0]).toMatchObject({ cell: '4x3', mirror: true });
  });

  it('forest+swamp: the cell’s orientation is the geography’s (swamp left), the stage pictures’ the key’s (forest left)', () => {
    // Board forest | swamp: against the geography, with the key.
    const p = pairOf(plan([slot('forest', 0, 2), slot('swamp', 1, 3)]))!;
    expect(p.mirror).toBe(false);
    expect(p.grid).toMatchObject({ cell: '3x2', shown: [3, 2], left: 'swamp', right: 'forest', mirror: true });
    const cands = pairFullCandidates(p, 5, false);
    expect(cands.map((c) => [c.cell, c.mirror])).toEqual([
      ['3x2', true],
      [undefined, false],
      [undefined, false],
    ]);
    expect(pairFullCaption([p])).toMatch(/swamp s3 \| forest s2, seam 3x2$/);
    // Board swamp | forest: with the geography, against the key.
    const q = pairOf(plan([slot('swamp', 0, 3), slot('forest', 1, 2)]))!;
    expect(q.mirror).toBe(true);
    expect(q.grid).toMatchObject({ cell: '3x2', mirror: false });
    expect(pairFullGrid(fsw, 'swamp', 3, 2)).toMatchObject({ cell: '3x2', mirror: false });
    expect(pairFullGrid(fsw, 'forest', 2, 3)).toMatchObject({ cell: '3x2', mirror: true });
  });

  it('pairFullView follows the picture’s own mirror', () => {
    const items = plan([slot('forest', 0, 2), slot('swamp', 1, 3)])!;
    const p = pairOf(items)!;
    const art = pairFullCandidates(p, 5, false)[0]!.art;
    const box = { w: 1000, h: 320 };
    const asCell = pairFullView(items, box, art, true)!;
    const asKey = pairFullView(items, box, art)!;
    // The transition lands at the board's split either way; the frame is the picture's own (its left colour's share).
    expect(asCell.seamAt).toBeCloseTo(p.split, 2);
    expect(asKey.seamAt).toBeCloseTo(p.split, 2);
    expect(asCell.frame.left).not.toBe(asKey.frame.left);
  });

  it('clamps the lighter half when the two are more than one stage apart, the heavier exact', () => {
    const items = plan([slot('island', 0, 6), slot('swamp', 1, 2)])!;
    const p = pairOf(items)!;
    expect(p.grid).toMatchObject({ cell: '6x5', shown: [6, 5], stages: [6, 2], clamped: true });
    expect(pairFullCaption(items)).toMatch(/island s6 \| swamp s2→s5, seam 6x5 \(clamped\)$/);
    expect(gridCaption(p.grid!)).toBe('island s6 | swamp s2→s5, seam 6x5 (clamped)');
    const q = pairOf(plan([slot('island', 0, 1), slot('swamp', 1, 5)]))!;
    expect(q.grid).toMatchObject({ cell: '4x5', shown: [4, 5], stages: [1, 5], clamped: true });
  });

  it('one half stepping changes one index of the cell, never the other', () => {
    const a = pairOf(plan([slot('island', 0, 3), slot('swamp', 1, 3)]))!.grid!;
    const b = pairOf(plan([slot('island', 0, 4), slot('swamp', 1, 3)]))!.grid!;
    const c = pairOf(plan([slot('island', 0, 4), slot('swamp', 1, 4)]))!.grid!;
    expect([a.cell, b.cell, c.cell]).toEqual(['3x3', '4x3', '4x4']);
  });

  it('falls back to the pair’s stages where the cell is missing, exactly as 1.15 / 1.16.1', () => {
    const has = pairOf(plan([slot('plains', 0, 3), slot('mountain', 1, 2)]))!;
    expect(has.grid?.cell).toBe('3x2');
    const missing = pairOf(plan([slot('plains', 0, 2), slot('mountain', 1, 3)]))!;
    expect(missing.grid).toBeUndefined();
    expect(missing.stage).toBe(3);
    expect(pairFullCandidates(missing, 5, false)[0]!.cell).toBeUndefined();
    expect(pairFullCaption([missing])).toMatch(/pair stage 3$/);
    // A pair with no grid: unchanged.
    const ip = pairOf(plan([slot('island', 0, 2), slot('plains', 1, 2)]))!;
    expect(ip.grid).toBeUndefined();
  });

  it('a third colour on a grid picture draws nothing in the draft: the whole half, no element, no painted picture', () => {
    const items = plan([slot('island', 0, 3), slot('swamp', 1, 2), slot('mountain', 2, 1)])!;
    expect(items).toHaveLength(1);
    const p = pairOf(items)!;
    expect(p.grid?.cell).toBe('3x2');
    expect(p.share).toBe(1);
    expect(p.element).toBeUndefined();
    expect(p.elementSide).toBeUndefined();
    expect(pairFullCandidates(p, 5, false).some((c) => c.painted)).toBe(false);
    expect(pairFullCaption(items)).not.toMatch(/painted in|as an element/);
    // The same third colour on a pair with no grid still has its painted picture (1.16.1).
    const ip = pairOf(plan([slot('island', 0, 3), slot('plains', 1, 2), slot('mountain', 2, 1)]))!;
    expect(ip.element).toBe('mountain');
  });

  it('the preview’s stage slider shows the cell (s, s)', () => {
    expect(pairOf(plan([slot('island', 0, 6), slot('swamp', 1, 1)], 2))!.grid?.cell).toBe('2x2');
  });

  it('a phone-shaped panel skips a cell with no phone picture (the draft is desktop only) for the stage pictures', () => {
    const p = pairOf(plan([slot('island', 0, 4), slot('swamp', 1, 3)]))!;
    const cands = pairFullCandidates(p, 0.8, true);
    expect(cands.every((c) => !c.cell)).toBe(true);
  });

  it('warms the cell shown and the cell either half’s next land would show', () => {
    const side = [slot('island', 0, 4), slot('swamp', 1, 3)];
    const full = pairPictures(pairs, [side], { phone: false, full: { thresholds: T } }).map((x) => x.src.replace(BASE, ''));
    // A fifth Island makes 5 : 3, which shows 5x4 (the heavier exact); a fourth Swamp 4x4; an Island leaving 3x3; a Swamp
    // leaving 4 : 2, which shows 4x3 again (the review of #201: both directions, so a step down is warm too).
    expect(full.filter((x) => x.startsWith('seams/'))).toEqual(['seams/island-swamp/s4x3-panorama.webp', 'seams/island-swamp/s5x4-panorama.webp', 'seams/island-swamp/s4x4-panorama.webp', 'seams/island-swamp/s3x3-panorama.webp']);
    // Without the flag, no cell.
    expect(pairPictures(pairs, [side], { phone: false }).some((x) => x.src.includes('/seams/'))).toBe(false);
  });

  describe('the load gate holds a cell while the next cell loads (the review of #201)', () => {
    const at = (i: number, j: number) => {
      const layout = halfLayout([slot('island', 0, i), slot('swamp', 1, j)], null);
      const items = pairFullPlan(layout, pairs, { thresholds: T })!;
      return { layout, items, cands: pairFullCandidates(pairOf(items)!, 5, false) };
    };
    const st = (ready: readonly string[], failed: readonly string[] = []) => (src: string) => (failed.includes(src) ? 'failed' : ready.includes(src) ? 'ready' : 'pending');
    const cellSrc = (c: string) => `${BASE}seams/island-swamp/s${c}-panorama.webp`;
    const step = (from: ReturnType<typeof at>, to: ReturnType<typeof at>, toCell: string) => {
      // The old cell on screen, and the stage panoramas warm (pairPictures warms them): only the new cell is cold.
      const warm = [...from.cands, ...to.cands].filter((c) => !c.cell).map((c) => c.art.picture!.src);
      const fromCell = from.cands[0]!.cell!;
      let hold: PairFullHold<typeof from.layout> = { last: null, since: null };
      const run = (cur: ReturnType<typeof at>, ready: readonly string[], now: number, failed: readonly string[] = []) => {
        const r = pairFullHold({ layout: cur.layout, plan: cur.items, choice: pairFullChoice(cur.cands, st(ready, failed)) }, hold, now);
        hold = r.hold;
        return r;
      };
      const first = run(from, [...warm, cellSrc(fromCell)], 0);
      expect(first.draw.shown?.cell).toBe(fromCell);
      return { run, warm, fromCell, toCell, first };
    };

    for (const [name, a, b, c] of [
      ['a half stepping up (3x3 → 4x3)', [3, 3], [4, 3], '4x3'],
      ['a half stepping down (4x4 → 3x4)', [4, 4], [3, 4], '3x4'],
      ['both halves in one frame (3x3 → 4x4)', [3, 3], [4, 4], '4x4'],
    ] as const)
      it(`${name}: the shown cell is held, never the old panorama, then the new cell once loaded`, () => {
        const from = at(a[0], a[1]);
        const to = at(b[0], b[1]);
        expect(to.cands[0]!.cell).toBe(c);
        const { run, warm, fromCell, first } = step(from, to, c);
        const waiting = run(to, [...warm, cellSrc(fromCell)], 1000);
        expect(waiting.holding).toBe(true);
        expect(waiting.draw).toBe(first.draw);
        expect(waiting.draw.shown?.cell).toBe(fromCell);
        // Without the rule the load gate's `show` would be the warm stage panorama.
        expect(pairFullChoice(to.cands, st([...warm, cellSrc(fromCell)])).show?.cell).toBeUndefined();
        const loaded = run(to, [...warm, cellSrc(fromCell), cellSrc(c)], 2000);
        expect([loaded.holding, loaded.draw.shown?.cell, loaded.draw.plan === to.items]).toEqual([false, c, true]);
      });

    it('the hold runs out after PAIR_FULL_HOLD_MS (what has loaded is drawn), and a failed cell gives way at once', () => {
      const from = at(3, 3);
      const to = at(4, 3);
      const { run, warm, fromCell } = step(from, to, '4x3');
      expect(run(to, [...warm, cellSrc(fromCell)], 1000).holding).toBe(true);
      const late = run(to, [...warm, cellSrc(fromCell)], 1000 + PAIR_FULL_HOLD_MS);
      expect(late.holding).toBe(false);
      expect(late.draw.shown?.cell).toBeUndefined();
      const again = step(from, to, '4x3');
      const failed = again.run(to, [...again.warm, cellSrc(fromCell)], 500, [cellSrc('4x3')]);
      expect(failed.holding).toBe(false);
      expect(failed.draw.shown?.cell).toBeUndefined();
    });
  });
});
