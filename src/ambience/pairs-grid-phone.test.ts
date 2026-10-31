/*
 * ForgeCoach — ambience/pairs-grid-phone.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.18 (draft): the seam grid's phone cells and painted-in cells, on
 * `testdata/pairs-v7.pairs.json` -- a HAND-MADE manifest (no file it names
 * exists) in the shape ~/scenery-packs/panoramas-v1/tools/make_pairs_v6_draft.py
 * writes with --phone-fragment and --pin-fragment, until the painters'
 * fragments exist and are merged into a tagged pack:
 *
 * - island+swamp (the key's order is the geography's: island left): cells
 *   1x1 … 4x4 within one stage; `phone` on 2x2, 3x2, 3x3, 4x3 only; painted
 *   in: 2x2 R both sides, 2x3 R right, 3x2 R left, 3x3 R left (with a phone
 *   picture) and right (without), 4x3 R left and W left (with a phone picture);
 * - forest+swamp (the geography puts the swamp LEFT, so the cell is mirrored
 *   against the key): 2x2, 2x3, 3x2, 3x3; `phone` on 3x2 and 3x3; W painted
 *   into 3x2 left (with a phone picture) and 2x3 right.
 *
 * Checked: the parse (shapes, sides in the cell's order, the side and colour
 * checks, bytes), the cell choice on a phone (the desktop's, phone picture or
 * give way), the third colour on a cell (the heavier half's painted picture,
 * else nothing; never a cut-out), the captions, the hold, and the warm set.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { halfLayout } from './layout.ts';
import { stageFor, type Biome, type SlotState } from './model.ts';
import { pairFullCandidates, pairFullCaption, pairFullChoice, pairFullCutOutAllowed, pairFullHold, pairFullPlan, type PairFullHold, type PairFullPair } from './pairfull.ts';
import { pairGridPaintedAt, pairGridPick, pairPictures, validatePairs } from './pairs.ts';

const BASE = 'https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v7/';
const T = [1, 2, 3, 4, 5, 6];
const slot = (biome: Biome, index: number, weight: number): SlotState => ({ biome, index, weight, stage: stageFor(weight, T), peak: stageFor(weight, T) });
const raw = () => JSON.parse(readFileSync(new URL('./testdata/pairs-v7.pairs.json', import.meta.url), 'utf8'));
const seam = (slug: string, file: string) => `${BASE}seams/${slug}/s${file}.webp`;

describe('spec 1.18: phone cells and painted-in cells', () => {
  const r = validatePairs(raw(), `${BASE}pairs.json`);
  const pairs = r.pairs!;
  const isw = pairs.pairs['island+swamp']!;
  const fsw = pairs.pairs['forest+swamp']!;
  const at = (slots: SlotState[], narrow = false) => {
    const layout = halfLayout(slots, null);
    const items = pairFullPlan(layout, pairs, { thresholds: T, slots, narrow });
    const p = items?.find((x): x is PairFullPair => x.kind === 'pair') ?? null;
    return { layout, items, p, cands: p ? pairFullCandidates(p, narrow ? 2.1 : 5, narrow) : [], caption: pairFullCaption(items) };
  };
  const warm = (slots: SlotState[], narrow = false) => pairPictures(pairs, [slots], { phone: narrow, full: { thresholds: T, narrow } }).map((w) => w.src);

  describe('the manifest', () => {
    it('reads with no error and no spec warning: this reader knows 1.18', () => {
      expect(r.errors).toEqual([]);
      expect(pairs.spec).toBe('1.18');
      expect(r.warnings.filter((w) => w.startsWith('spec:') || w.includes('.grid'))).toEqual([]);
    });

    it('a cell’s phone picture is read in its own shape, over the pair panorama phone’s for what it leaves out', () => {
      const c = isw.grid!.cells['4x3']!;
      expect(c.phone).toMatchObject({ src: seam('island-swamp', '4x3-panorama-phone'), width: 1638, height: 1280, subjectBand: [0.33, 0.68], focal: { x: 0.5, y: 0.5 }, horizon: 0.52 });
      expect(c.phoneBytes).toBe(120_000);
      expect(isw.grid!.cells['4x4']!.phone).toBeNull();
    });

    it('a cell’s painted-in entries are sided in the CELL’s order and take the cell’s shape', () => {
      const e = isw.grid!.cells['3x3']!.elements!.R!;
      expect(e.left).toMatchObject({ src: seam('island-swamp', '3x3+RL-panorama'), width: 3277, height: 640, horizon: 0.44, hour: 12, key: 'noon', bytes: 75_000 });
      expect(e.left!.phone).toMatchObject({ src: seam('island-swamp', '3x3+RL-panorama-phone'), width: 1638, height: 1280 });
      expect(e.right!.phone).toBeNull();
      expect(e.any).toBeNull();
      // forest+swamp: the key says forest first, the cell says swamp first; `left` is the swamp's ground.
      expect(fsw.grid!.left).toBe('swamp');
      expect(fsw.grid!.cells['3x2']!.elements!.W!.left!.src).toBe(seam('swamp-forest', '3x2+WL-panorama'));
    });

    it('counts phone and painted-in cells in the pair’s bytes and its ref', () => {
      const plain = raw();
      for (const c of Object.values(plain.pairs['island+swamp'].grid) as Record<string, unknown>[]) {
        delete c.phone;
        delete c.elements;
      }
      const base = validatePairs(plain, `${BASE}pairs.json`).pairs!.pairs['island+swamp']!;
      // Four phone cells at 120 KB; painted: 2x2 ×2, 2x3, 3x2, 3x3 ×2, 4x3 ×2 at 75 KB, and two of their phones at 125 KB.
      const more = 4 * 120_000 + 8 * 75_000 + 2 * 125_000;
      expect(isw.bytes - base.bytes).toBe(more);
      expect(isw.refBytes - base.refBytes).toBe(more);
    });

    it('drops a side never drawn (not the heavier half’s) and a pair colour alone, with a warning', () => {
      const bad = raw();
      const g = bad.pairs['island+swamp'].grid;
      g['2x3'].elements.R.left = { src: 'seams/island-swamp/s2x3+RL-panorama.webp', bytes: 1 };
      g['3x2'].elements.R.right = { src: 'seams/island-swamp/s3x2+RR-panorama.webp', bytes: 1 };
      g['4x3'].elements.U = { left: { src: 'seams/island-swamp/s4x3+UL-panorama.webp', bytes: 1 } };
      g['4x4'].elements = { B: { right: { src: 'x.webp' } } };
      const rb = validatePairs(bad, `${BASE}pairs.json`);
      const cells = rb.pairs!.pairs['island+swamp']!.grid!.cells;
      expect(cells['2x3']!.elements!.R).toMatchObject({ left: null, right: { src: seam('island-swamp', '2x3+RR-panorama') } });
      expect(cells['3x2']!.elements!.R).toMatchObject({ left: { src: seam('island-swamp', '3x2+RL-panorama') }, right: null });
      expect(cells['4x3']!.elements!.U).toBeUndefined();
      expect(cells['4x4']!.elements).toBeUndefined();
      expect(rb.warnings).toEqual(
        expect.arrayContaining([
          'pairs.island+swamp.grid.2x3.elements.R.left: the cell\'s right half is the heavier (2x3), so its left side is never drawn; ignored',
          'pairs.island+swamp.grid.3x2.elements.R.right: the cell\'s left half is the heavier (3x2), so its right side is never drawn; ignored',
          "pairs.island+swamp.grid.4x3.elements.U: U is one of the pair's own colours, not a third; ignored",
          "pairs.island+swamp.grid.4x4.elements.B: B is one of the pair's own colours, not a third; ignored",
        ]),
      );
    });

    it('pairGridPaintedAt: the side asked for (else an unsided picture), never the other side; on a phone only with its own phone picture', () => {
      const c33 = isw.grid!.cells['3x3']!;
      expect(pairGridPaintedAt(c33, 'R', 'left')!.src).toBe(seam('island-swamp', '3x3+RL-panorama'));
      expect(pairGridPaintedAt(c33, 'R', 'left', true)!.src).toBe(seam('island-swamp', '3x3+RL-panorama'));
      expect(pairGridPaintedAt(c33, 'R', 'right')!.src).toBe(seam('island-swamp', '3x3+RR-panorama'));
      expect(pairGridPaintedAt(c33, 'R', 'right', true)).toBeNull();
      expect(pairGridPaintedAt(c33, 'W', 'left')).toBeNull();
      expect(pairGridPaintedAt(isw.grid!.cells['3x2']!, 'R', 'right')).toBeNull();
      expect(pairGridPaintedAt(c33, null, 'left')).toBeNull();
    });
  });

  describe('a phone: the desktop’s cell when it has a phone picture, else the stages exactly as 1.17', () => {
    it('plans the cell, drawn from its phone picture, and the caption names the seam', () => {
      const desk = at([slot('island', 0, 4), slot('swamp', 1, 3)]);
      const phone = at([slot('island', 0, 4), slot('swamp', 1, 3)], true);
      expect(phone.p!.grid).toMatchObject({ cell: '4x3', clamped: false, mirror: false });
      expect(phone.p!.grid!.cell).toBe(desk.p!.grid!.cell);
      expect(phone.cands[0]).toMatchObject({ cell: '4x3', painted: null, mirror: false });
      expect(phone.cands[0]!.art).toMatchObject({ source: 'phone' });
      expect(phone.cands[0]!.art.picture!.src).toBe(seam('island-swamp', '4x3-panorama-phone'));
      expect(desk.cands[0]!.art.picture!.src).toBe(seam('island-swamp', '4x3-panorama'));
      expect(phone.caption).toMatch(/island s4 \| swamp s3, seam 4x3$/);
    });

    it('the same choice as the desktop through the clamp: the heavier half exact', () => {
      // island 4 | swamp 2: no 4x2, so 4x3 (the swamp raised to one below), which has a phone picture.
      const phone = at([slot('island', 0, 4), slot('swamp', 1, 2)], true);
      expect(phone.p!.grid).toMatchObject({ cell: '4x3', stages: [4, 2], shown: [4, 3], clamped: true });
      expect(phone.cands[0]!.art.picture!.src).toBe(seam('island-swamp', '4x3-panorama-phone'));
      expect(phone.caption).toMatch(/island s4 \| swamp s2→s3, seam 4x3 \(clamped\)$/);
      // forest+swamp mirrored: forest 2 | swamp 3 on the board is the cell 3x2, which has one.
      const m = at([slot('forest', 0, 2), slot('swamp', 1, 3)], true);
      expect(m.p!.grid).toMatchObject({ cell: '3x2', mirror: true });
      expect(m.cands[0]).toMatchObject({ cell: '3x2', mirror: true });
      expect(m.cands[0]!.art.picture!.src).toBe(seam('swamp-forest', '3x2-panorama-phone'));
    });

    it('a chosen cell with no phone picture gives way to the stages, never to a neighbour that has one', () => {
      // 4x4: no phone picture (3x3 and 4x3 beside it have one).
      const phone = at([slot('island', 0, 4), slot('swamp', 1, 4)], true);
      expect(at([slot('island', 0, 4), slot('swamp', 1, 4)]).p!.grid!.cell).toBe('4x4');
      expect(phone.p!.grid).toBeUndefined();
      expect(phone.cands.some((c) => c.cell)).toBe(false);
      expect(phone.cands[0]!.art.picture!.src).toBe(`${BASE}pairs/island-swamp/s3-panorama-phone.webp`);
      expect(phone.caption).toMatch(/whole half: island 50% \| swamp 50%, pair stage 3$/);
      // 2x3: none either.
      expect(at([slot('island', 0, 2), slot('swamp', 1, 3)], true).p!.grid).toBeUndefined();
      // No cell after the clamp (6x5 is not painted): the stages on both.
      expect(at([slot('island', 0, 6), slot('swamp', 1, 2)]).p!.grid).toBeUndefined();
      expect(at([slot('island', 0, 6), slot('swamp', 1, 2)], true).p!.grid).toBeUndefined();
    });

    it('a phone-shaped panel on a wide screen draws the cell’s phone picture where it has one, else the stages (the load gate’s rule)', () => {
      const p = at([slot('island', 0, 4), slot('swamp', 1, 3)]).p!;
      expect(pairFullCandidates(p, 0.8, false)[0]!.art.picture!.src).toBe(seam('island-swamp', '4x3-panorama-phone'));
      const q = at([slot('island', 0, 4), slot('swamp', 1, 4)]).p!;
      expect(pairFullCandidates(q, 0.8, false).some((c) => c.cell)).toBe(false);
    });
  });

  describe('a third colour on a cell: its painted-in picture on the heavier half, else nothing', () => {
    it('draws the cell’s painted picture for the heavier pair colour’s half, before the plain cell; no element, so no cut-out', () => {
      const t = at([slot('island', 0, 3), slot('swamp', 1, 2), slot('mountain', 2, 1)]);
      expect(t.p!.grid).toMatchObject({ cell: '3x2', painted: { colour: 'R', side: 'left' } });
      expect(t.p!.element).toBeUndefined();
      expect(t.cands.map((c) => [c.cell, c.painted, c.art.picture!.src])).toEqual([
        ['3x2', 'R', seam('island-swamp', '3x2+RL-panorama')],
        ['3x2', null, seam('island-swamp', '3x2-panorama')],
        [undefined, null, `${BASE}pairs/island-swamp/s3-panorama.webp`],
        [undefined, null, `${BASE}pairs/island-swamp/s3-half.webp`],
      ]);
      expect(t.caption).toMatch(/island s3 \| swamp s2, seam 3x2; R painted in, on island's ground$/);
      // Whatever has loaded, the cut-out is never allowed on the painted cell, and ScenePieces finds no `element` anyway.
      expect(pairFullCutOutAllowed(pairFullChoice(t.cands, () => 'ready'))).toBe(false);
    });

    it('the heavier half by weight, a tie the earlier arrival; and in the cell’s order on a mirrored pair', () => {
      // Both at stage 3: the swamp heavier (3.5) → the right side, RR.
      expect(at([slot('island', 0, 3), slot('swamp', 1, 3.5), slot('mountain', 2, 1)]).p!.grid).toMatchObject({ cell: '3x3', painted: { colour: 'R', side: 'right' } });
      // A tie: the island arrived first → RL.
      expect(at([slot('island', 0, 3), slot('swamp', 1, 3), slot('mountain', 2, 1)]).p!.grid!.painted).toMatchObject({ side: 'left' });
      expect(at([slot('swamp', 0, 3), slot('island', 1, 3), slot('mountain', 2, 1)]).p!.grid!.painted).toMatchObject({ side: 'right' });
      // forest 2 | swamp 3 | plains 1: the board's right (swamp) is the cell's left (the geography), so WL, mirrored.
      const m = at([slot('forest', 0, 2), slot('swamp', 1, 3), slot('plains', 2, 1)]);
      expect(m.p!.grid).toMatchObject({ cell: '3x2', mirror: true, painted: { colour: 'W', side: 'left' } });
      expect(m.cands[0]).toMatchObject({ cell: '3x2', painted: 'W', mirror: true });
      expect(m.caption).toMatch(/swamp s3 \| forest s2, seam 3x2; W painted in, on swamp's ground$/);
      // Another colour on the same cell: 4x3 has R and W.
      expect(at([slot('island', 0, 4), slot('swamp', 1, 3), slot('plains', 2, 1)]).p!.grid!.painted).toMatchObject({ colour: 'W', side: 'left' });
    });

    it('nothing when the cell has no picture for that colour (1.17’s rule): the plain cell, no element, no caption of it', () => {
      // 3x3 has R only: plains is W.
      const t = at([slot('island', 0, 3), slot('swamp', 1, 3), slot('plains', 2, 1)]);
      expect(t.p!.grid!.cell).toBe('3x3');
      expect(t.p!.grid!.painted).toBeUndefined();
      expect(t.p!.element).toBeUndefined();
      expect(t.cands[0]).toMatchObject({ cell: '3x3', painted: null });
      expect(t.cands.some((c) => c.painted)).toBe(false); // the stage's painted W is not a fallback on a cell
      expect(t.caption).not.toMatch(/painted|element/);
      // 4x4 has no painted picture at all.
      expect(at([slot('island', 0, 4), slot('swamp', 1, 4), slot('mountain', 2, 1)]).p!.grid!.painted).toBeUndefined();
    });

    it('on a phone, only a painted picture with a phone of its own; else the plain cell’s phone picture and nothing', () => {
      // 3x3 RL has a phone picture.
      const l = at([slot('island', 0, 3.5), slot('swamp', 1, 3), slot('mountain', 2, 1)], true);
      expect(l.p!.grid).toMatchObject({ cell: '3x3', painted: { colour: 'R', side: 'left' } });
      expect(l.cands[0]!.art.picture!.src).toBe(seam('island-swamp', '3x3+RL-panorama-phone'));
      expect(l.caption).toMatch(/; R painted in, on island's ground$/);
      // 3x3 RR has none: the phone draws the plain cell and says nothing of red.
      const rr = at([slot('island', 0, 3), slot('swamp', 1, 3.5), slot('mountain', 2, 1)], true);
      expect(rr.p!.grid!.cell).toBe('3x3');
      expect(rr.p!.grid!.painted).toBeUndefined();
      expect(rr.cands[0]).toMatchObject({ cell: '3x3', painted: null });
      expect(rr.cands[0]!.art.picture!.src).toBe(seam('island-swamp', '3x3-panorama-phone'));
      expect(rr.caption).not.toMatch(/painted/);
      // A phone-shaped panel on a wide screen skips a painted picture with no phone for the plain cell's phone picture.
      const wide = at([slot('island', 0, 3), slot('swamp', 1, 2), slot('mountain', 2, 1)]);
      expect(pairFullCandidates(wide.p!, 0.8, false)[0]).toMatchObject({ cell: '3x2', painted: null });
    });

    it('a cell that gives way on a phone takes the third colour with it: 1.16.1’s stage picture, as before the grid', () => {
      const t = at([slot('island', 0, 4), slot('swamp', 1, 4), slot('mountain', 2, 1)], true);
      expect(t.p!.grid).toBeUndefined();
      expect(t.p).toMatchObject({ element: 'mountain', elementSide: 'left' });
      expect(t.cands[0]).toMatchObject({ painted: 'R' });
      expect(t.cands[0]!.art.picture!.src).toBe(`${BASE}pairs/island-swamp/s3+RL-panorama-phone.webp`);
    });

    it('holds the plain cell while the painted cell loads, then shows it', () => {
      const two = at([slot('island', 0, 3), slot('swamp', 1, 2)]);
      const three = at([slot('island', 0, 3), slot('swamp', 1, 2), slot('mountain', 2, 1)]);
      const plain = seam('island-swamp', '3x2-panorama');
      const painted = seam('island-swamp', '3x2+RL-panorama');
      const status = (ready: readonly string[]) => (src: string) => (ready.includes(src) ? 'ready' : 'pending');
      const first = pairFullHold({ layout: two.layout, plan: two.items, choice: pairFullChoice(two.cands, status([plain])) }, { last: null, since: null } as PairFullHold<typeof two.layout>, 0);
      expect(first.draw.shown?.art.picture!.src).toBe(plain);
      const wait = pairFullHold({ layout: three.layout, plan: three.items, choice: pairFullChoice(three.cands, status([plain])) }, first.hold, 100);
      expect(wait.holding).toBe(true);
      expect(wait.draw).toBe(first.draw);
      const ready = pairFullHold({ layout: three.layout, plan: three.items, choice: pairFullChoice(three.cands, status([plain, painted])) }, wait.hold, 200);
      expect([ready.holding, ready.draw.shown?.painted, ready.draw.shown?.cell]).toEqual([false, 'R', '3x2']);
    });
  });

  describe('the warm set: the phone cell by 1.17’s rules, and the shown cell’s painted pictures only', () => {
    it('a phone warms a cell with a phone picture at that shape (shown, neighbours, the first cell), never a desktop cell', () => {
      const two = warm([slot('island', 0, 3), slot('swamp', 1, 2)], true).filter((s) => s.includes('/seams/'));
      // Shown 3x2; neighbours 4x2→4x3, 3x3, 2x2, 3x1→3x2: the ones with a phone picture, at the phone shape.
      expect(two.sort()).toEqual([seam('island-swamp', '2x2-panorama-phone'), seam('island-swamp', '3x2-panorama-phone'), seam('island-swamp', '3x3-panorama-phone'), seam('island-swamp', '4x3-panorama-phone')].sort());
      // A mono side: the first cell with a swamp (island 3 | swamp 1 → 3x2) at the phone shape; forest+swamp has no 3x1/2x1… cell.
      expect(warm([slot('island', 0, 3)], true).filter((s) => s.includes('/seams/'))).toEqual([seam('island-swamp', '3x2-panorama-phone')]);
      // The desktop warms the desktop cells.
      expect(warm([slot('island', 0, 3), slot('swamp', 1, 2)]).filter((s) => s.includes('/seams/')).every((s) => !s.includes('-phone'))).toBe(true);
    });

    it('with a third colour: the shown cell’s painted pictures for it, no neighbour’s and no other colour’s', () => {
      const painted = (s: readonly string[]) => s.filter((x) => x.includes('/seams/') && x.includes('+'));
      // island 3 | swamp 2 | mountain 1: the cell 3x2 has RL; its neighbours' (2x2 R, 3x3 R, 4x3 R and W) are not warmed.
      expect(painted(warm([slot('island', 0, 3), slot('swamp', 1, 2), slot('mountain', 2, 1)]))).toEqual([seam('island-swamp', '3x2+RL-panorama')]);
      // At i = j, both of the cell's sides (a land that turns the balance flips the side).
      expect(painted(warm([slot('island', 0, 3), slot('swamp', 1, 3), slot('mountain', 2, 1)]))).toEqual([seam('island-swamp', '3x3+RL-panorama'), seam('island-swamp', '3x3+RR-panorama')]);
      // A phone: only those with a phone picture, at the phone shape.
      expect(painted(warm([slot('island', 0, 3), slot('swamp', 1, 3), slot('mountain', 2, 1)], true))).toEqual([seam('island-swamp', '3x3+RL-panorama-phone')]);
      expect(painted(warm([slot('island', 0, 3), slot('swamp', 1, 2), slot('mountain', 2, 1)], true))).toEqual([]);
      // Not the pair drawn: mountain is heavier than both, so island+swamp's 2x2 R is never shown and not warmed.
      expect(painted(warm([slot('island', 0, 2), slot('swamp', 1, 2), slot('mountain', 2, 3)]))).toEqual([]);
      expect(painted(warm([slot('island', 0, 2), slot('swamp', 1, 2), slot('mountain', 2, 1)]))).toEqual([seam('island-swamp', '2x2+RL-panorama'), seam('island-swamp', '2x2+RR-panorama')]);
      // Two colours or one: no painted cell at all.
      expect(painted(warm([slot('island', 0, 3), slot('swamp', 1, 2)]))).toEqual([]);
      expect(painted(warm([slot('island', 0, 3)]))).toEqual([]);
    });

    it('the pick the warm set follows is the plan’s', () => {
      expect(pairGridPick(isw, 3, 2)!.picture.elements!.R!.left!.src).toBe(seam('island-swamp', '3x2+RL-panorama'));
    });
  });
});
