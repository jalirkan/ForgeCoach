/*
 * ForgeCoach — ambience/pairs-v6.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * pairs-v6 (spec 1.17): the pairs FORGECOACH_PAIRS_FULL_URL points at under
 * `?pairfull=1` -- pairs-v5's manifest with a seam `grid` on all ten pairs,
 * written by ~/scenery-packs/panoramas-v1/tools/make_pairs_v6_draft.py
 * (--out serve/pairs-v6) from the painter's 160 cells and tagged 2026-10-27:
 * `testdata/pairs-v6.pairs.json` is that file byte for byte (the sha256
 * below), https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v6/pairs.json.
 * `testdata/pairs-v6-draft.pairs.json` is the 2026-10-25 draft it grew from
 * (three grids: island+swamp, forest+swamp, mountain+plains), as jsDelivr
 * served it on 2026-10-26, kept for the shape's history.
 *
 * {@link v6Problems} is what the reader needs of the published manifest: on
 * the draft it finds exactly the seven pairs still to paint, on pairs-v6 none.
 *
 * Also here, on the real cells: the pair forming (its first cell warmed
 * ahead, and held for while it loads -- the #201 follow-up) and the phone
 * (a desktop-only cell never planned, warmed or captioned there).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { halfLayout } from './layout.ts';
import { stageFor, type Biome, type SlotState } from './model.ts';
import { PAIR_FULL_HOLD_MS, pairFullCandidates, pairFullCaption, pairFullChoice, pairFullHold, pairFullPlan, type PairFullHold, type PairFullPair } from './pairfull.ts';
import { geographyOrder, MAX_PAIRS_PACK_BYTES, pairPictures, pairsRefBytes, validatePairs } from './pairs.ts';
import { DEFAULT_PREFS, effectivePrefs, FORGECOACH_PAIRS_FULL_URL, FORGECOACH_PAIRS_URL, pairsUrlOf } from './prefs.ts';

const CDN = 'https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery';
const V6 = `${CDN}@pairs-v6/`;
const DRAFT = `${CDN}@pairs-v6-draft/`;
const T = [1, 2, 3, 4, 5, 6];
/** A slot as the tracker makes it: the stage from the weight on the pack's thresholds. */
const slot = (biome: Biome, index: number, weight: number): SlotState => ({ biome, index, weight, stage: stageFor(weight, T), peak: stageFor(weight, T) });

/** A pair key's seam folder: its two colours in the geography's order (island → swamp → plains → forest → mountain). */
const geographySlug = (key: string) => geographyOrder(...(key.split('+') as [Biome, Biome]))!.join('-');

/** What the reader needs of pairs-v6, one line per problem (none: it is ready to be the flag's default). */
function v6Problems(raw: Record<string, any>, v5: Record<string, any>): string[] {
  const out: string[] = [];
  if (raw.schema !== 1) out.push('schema: 1');
  if (raw.spec !== '1.17') out.push(`spec: "1.17" (is ${raw.spec})`);
  for (const key of Object.keys(v5.pairs)) {
    const p = raw.pairs?.[key];
    if (!p) {
      out.push(`${key}: missing`);
      continue;
    }
    const { grid, ...rest } = p;
    // The stages, band, stageMap, transitions, dual and shock are pairs-v5's, untouched: a phone and a missing cell draw them.
    if (JSON.stringify(rest) !== JSON.stringify(v5.pairs[key])) out.push(`${key}: not pairs-v5's entry apart from its grid`);
    if (!grid) {
      out.push(`${key}: no grid`);
      continue;
    }
    const slug = geographySlug(key);
    for (let i = 1; i <= 6; i++)
      for (let j = 1; j <= 6; j++) {
        if (Math.abs(i - j) > 1) continue;
        const c = grid[`${i}x${j}`];
        if (!c) out.push(`${key}: no cell ${i}x${j}`);
        else if (c.src !== `seams/${slug}/s${i}x${j}-panorama.webp` || c.width !== 3277 || c.height !== 640 || !(c.bytes > 0)) out.push(`${key}.${i}x${j}: not { src: "seams/${slug}/s${i}x${j}-panorama.webp", width: 3277, height: 640, bytes }`);
      }
  }
  return out;
}

describe('pairs-v6: the flag’s default', () => {
  it('?pairfull=1 with no ?pairs= is pairs-v6; the board without the flag stays on pairs-v3.1; ?pairs= wins', () => {
    expect(FORGECOACH_PAIRS_FULL_URL).toBe(V6);
    expect(pairsUrlOf(effectivePrefs(DEFAULT_PREFS, '?pairfull=1', ''))).toBe(V6);
    expect(pairsUrlOf(effectivePrefs(DEFAULT_PREFS, '', '#ambience?pairfull=on'))).toBe(V6);
    expect(pairsUrlOf(effectivePrefs(DEFAULT_PREFS, '', ''))).toBe(FORGECOACH_PAIRS_URL);
    expect(pairsUrlOf(effectivePrefs(DEFAULT_PREFS, '?pairfull=0', ''))).toBe(FORGECOACH_PAIRS_URL);
    expect(FORGECOACH_PAIRS_URL).toBe(`${CDN}@pairs-v3.1/`);
    expect(pairsUrlOf(effectivePrefs(DEFAULT_PREFS, `?pairfull=1&pairs=${encodeURIComponent(DRAFT)}`, ''))).toBe(DRAFT);
    expect(pairsUrlOf(effectivePrefs(DEFAULT_PREFS, '?pairfull=1&pairs=off', ''))).toBeNull();
    // A pack of your own brings no ForgeCoach pairs, flag or not.
    expect(pairsUrlOf({ ...effectivePrefs(DEFAULT_PREFS, '?pairfull=1', ''), packUrl: 'https://example.org/pack/' })).toBeNull();
  });
});

describe('pairs-v6-draft: the shape pairs-v6 is written to', () => {
  const bytes = readFileSync(new URL('./testdata/pairs-v6-draft.pairs.json', import.meta.url));
  const raw = JSON.parse(bytes.toString('utf8'));
  const v5 = JSON.parse(readFileSync(new URL('./testdata/pairs-v5.pairs.json', import.meta.url), 'utf8'));
  const r = validatePairs(raw, `${DRAFT}pairs.json`);
  const pairs = r.pairs!;

  it('is the file jsDelivr serves byte for byte, under the 256 KB a pairs manifest may be', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('f21fbe49e3fc88e9c9ff0533d65a7ad3b35d0518fbc4a790fee4e9706e303650');
    expect(bytes.length).toBeLessThan(256 * 1024);
  });

  it('validates with no errors, written for 1.17; one budget warning a pair, the grid named where there is one', () => {
    expect(r.errors).toEqual([]);
    expect(pairs.spec).toBe('1.17');
    expect(r.warnings).toHaveLength(10);
    expect(r.warnings.filter((w) => /of them the seam grid \(1\.17\)/.test(w)).map((w) => w.split(':')[0])).toEqual(['pairs.forest+swamp', 'pairs.island+swamp', 'pairs.mountain+plains']);
    // No 45 MB warning; and ten grids at the draft's ~70 KB a cell stay under it (pairs-v5's 28 MB + 160 cells).
    expect(r.warnings.some((w) => w.startsWith('pairs: '))).toBe(false);
    const perCell = (['forest+swamp', 'island+swamp', 'mountain+plains'] as const).reduce((n, k) => n + Object.values<{ bytes: number }>(raw.pairs[k].grid).reduce((m, c) => m + c.bytes, 0), 0) / 48;
    expect(pairsRefBytes(pairs) + 7 * 16 * perCell).toBeLessThan(MAX_PAIRS_PACK_BYTES);
  });

  it('is pairs-v5 with a grid; what pairs-v6 still needs is the seven other pairs’ grids', () => {
    expect(v6Problems(raw, v5)).toEqual(Object.keys(v5.pairs).filter((k) => !['forest+swamp', 'island+swamp', 'mountain+plains'].includes(k)).map((k) => `${k}: no grid`));
    // Each painted grid: the sixteen cells |i − j| ≤ 1, desktop only, in the geography's order.
    for (const k of ['forest+swamp', 'island+swamp', 'mountain+plains']) {
      const g = pairs.pairs[k]!.grid!;
      expect(Object.keys(g.cells)).toHaveLength(16);
      expect(Object.values(g.cells).every((c) => c!.phone === null)).toBe(true);
      expect(`${g.left}-${g.right}`).toBe(geographySlug(k));
    }
  });
});

describe('pairs-v6: the published manifest, the flag’s default', () => {
  const bytes = readFileSync(new URL('./testdata/pairs-v6.pairs.json', import.meta.url));
  const raw = JSON.parse(bytes.toString('utf8'));
  const v5 = JSON.parse(readFileSync(new URL('./testdata/pairs-v5.pairs.json', import.meta.url), 'utf8'));
  const r = validatePairs(raw, `${V6}pairs.json`);
  const pairs = r.pairs!;

  it('is the file jsDelivr serves byte for byte (the pairs-v6 tag, 2026-10-27), under the 256 KB a pairs manifest may be', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('f53f658f10a95ac0d00b349b796e14e5d895ecf8f6139072115726e1805ae80d');
    expect(bytes.length).toBeLessThan(256 * 1024);
  });

  it('validates with no errors, written for 1.17; one budget warning a pair, every one naming its grid; the ref under 45 MB', () => {
    expect(r.errors).toEqual([]);
    expect(pairs.spec).toBe('1.17');
    expect(r.warnings).toHaveLength(10);
    expect(r.warnings.filter((w) => /of them the seam grid \(1\.17\)/.test(w)).map((w) => w.split(':')[0]).sort()).toEqual(Object.keys(v5.pairs).map((k) => `pairs.${k}`).sort());
    expect(r.warnings.some((w) => w.startsWith('pairs: '))).toBe(false);
    expect(pairsRefBytes(pairs)).toBeLessThan(MAX_PAIRS_PACK_BYTES);
  });

  it('is pairs-v5 with a grid on all ten pairs: nothing left for the reader to want', () => {
    expect(v6Problems(raw, v5)).toEqual([]);
    for (const k of Object.keys(v5.pairs)) {
      const g = pairs.pairs[k]!.grid!;
      expect(Object.keys(g.cells)).toHaveLength(16);
      expect(Object.values(g.cells).every((c) => c!.phone === null)).toBe(true);
      expect(`${g.left}-${g.right}`).toBe(geographySlug(k));
    }
  });
});

describe('pairs-v6-draft on the board', () => {
  const raw = JSON.parse(readFileSync(new URL('./testdata/pairs-v6-draft.pairs.json', import.meta.url), 'utf8'));
  const pairs = validatePairs(raw, `${DRAFT}pairs.json`).pairs!;
  const cell = (slug: string, c: string) => `${DRAFT}seams/${slug}/s${c}-panorama.webp`;
  const at = (slots: SlotState[], narrow = false) => {
    const layout = halfLayout(slots, null);
    const items = pairFullPlan(layout, pairs, { thresholds: T, slots, narrow });
    const p = items?.find((x): x is PairFullPair => x.kind === 'pair') ?? null;
    return { layout, items, p, cands: p ? pairFullCandidates(p, narrow ? 2.1 : 5, narrow) : [] };
  };
  const warm = (slots: SlotState[], narrow = false) => pairPictures(pairs, [slots], { phone: narrow, full: { thresholds: T, narrow } }).map((w) => w.src);

  describe('the pair forming: its first cell is warm before the second colour arrives (the #201 follow-up)', () => {
    it('one colour on the half warms each grid pair’s first cell: the arriving colour at stage 1, clamped as the pick clamps', () => {
      // Island at stage 3: Swamp's first land shows island s3 | swamp s1 → 3x2 (the lighter half one below the heavier).
      const cells = warm([slot('island', 0, 3)]).filter((s) => s.includes('/seams/'));
      expect(cells).toEqual([cell('island-swamp', '3x2')]);
      // Swamp at stage 1: an Island first is 1x1, a Forest first 1x1 of swamp+forest (swamp left).
      expect(warm([slot('swamp', 0, 1)]).filter((s) => s.includes('/seams/'))).toEqual([cell('island-swamp', '1x1'), cell('swamp-forest', '1x1')]);
      // Forest at stage 4: swamp's first land is swamp s1 | forest s4 → 3x4.
      expect(warm([slot('forest', 0, 4)]).filter((s) => s.includes('/seams/'))).toEqual([cell('swamp-forest', '3x4')]);
      // The stage-1 panoramas are still warmed: the fallback, should the cell fail.
      expect(warm([slot('island', 0, 3)])).toContain(`${DRAFT}pairs/island-swamp/s1-panorama.webp`);
    });

    it('and the cell a dual of the two would show, when its half land steps the live colour up', () => {
      // Island 2.5 (stage 2): Watery Grave makes island 3 | swamp ½ → 3x2, beside a Swamp's 2x1.
      expect(warm([slot('island', 0, 2.5)]).filter((s) => s.includes('/seams/'))).toEqual([cell('island-swamp', '2x1'), cell('island-swamp', '3x2')]);
    });

    it('so the pair’s first frame is its cell: the panels, then the cell -- never the whole-place panorama between', () => {
      const before = at([slot('island', 0, 3)]);
      expect(before.items).toBeNull();
      const after = at([slot('island', 0, 3), slot('swamp', 1, 1)]);
      expect(after.cands[0]).toMatchObject({ cell: '3x2', mirror: false });
      const pano = after.cands.find((c) => !c.cell)!.art.picture!.src;
      const status = (ready: readonly string[]) => (src: string) => (ready.includes(src) ? 'ready' : 'pending');
      const run = (ready: readonly string[], now: number, hold: PairFullHold<typeof before.layout>) => {
        const mono = pairFullHold({ layout: before.layout, plan: null, choice: null }, hold, now);
        return { mono, next: pairFullHold({ layout: after.layout, plan: after.items, choice: pairFullChoice(after.cands, status(ready)) }, mono.hold, now + 100) };
      };
      // Warmed ahead (pairPictures above): the first frame of the pair is the cell.
      const warmed = warm([slot('island', 0, 3)]);
      expect(warmed).toContain(after.cands[0]!.art.picture!.src);
      const w = run(warmed, 0, { last: null, since: null });
      expect([w.next.holding, w.next.draw.shown?.cell]).toEqual([false, '3x2']);
      // Cold (a slow network): the half keeps its panels while the cell loads, though the panorama is warm...
      const c = run([pano], 0, { last: null, since: null });
      expect(pairFullChoice(after.cands, status([pano])).show?.cell).toBeUndefined();
      expect(c.next.holding).toBe(true);
      expect(c.next.draw).toBe(c.mono.draw);
      expect(c.next.draw.plan).toBeNull();
      // ...then the cell, once loaded.
      const ready = pairFullHold({ layout: after.layout, plan: after.items, choice: pairFullChoice(after.cands, status([pano, after.cands[0]!.art.picture!.src])) }, c.next.hold, 600);
      expect([ready.holding, ready.draw.shown?.cell]).toEqual([false, '3x2']);
      // The hold is the 8 s one: past it, what has loaded (the panorama), never blank.
      const late = pairFullHold({ layout: after.layout, plan: after.items, choice: pairFullChoice(after.cands, status([pano])) }, c.next.hold, 100 + PAIR_FULL_HOLD_MS);
      expect([late.holding, late.draw.shown?.art.picture!.src]).toEqual([false, pano]);
    });
  });

  describe('a phone: the stage panoramas, as before the grid', () => {
    it('plans no desktop-only cell, so the half is the stage panorama’s phone picture and the caption names no seam', () => {
      const desk = at([slot('island', 0, 4), slot('swamp', 1, 3)]);
      expect(desk.p!.grid?.cell).toBe('4x3');
      expect(pairFullCaption(desk.items)).toMatch(/whole half: island 57% \| swamp 43%, island s4 \| swamp s3, seam 4x3$/);
      const phone = at([slot('island', 0, 4), slot('swamp', 1, 3)], true);
      expect(phone.p!.grid).toBeUndefined();
      expect(phone.cands[0]!.cell).toBeUndefined();
      expect(phone.cands[0]!.art.picture!.src).toBe(`${CDN}@pairs-v4/pairs/island-swamp/s3-panorama-phone.webp`);
      const caption = pairFullCaption(phone.items)!;
      expect(caption).toMatch(/whole half: island 57% \| swamp 43%, pair stage 3$/);
      expect(caption).not.toMatch(/seam/);
    });

    it('a third colour keeps its painted-in picture there (the grid drops it on the desktop, in the draft)', () => {
      const s = [slot('island', 0, 3), slot('swamp', 1, 2), slot('plains', 2, 1)];
      expect(at(s).p!.grid?.cell).toBe('3x2');
      expect(at(s).p!.element).toBeUndefined();
      const phone = at(s, true);
      expect(phone.p).toMatchObject({ element: 'plains', elementSide: 'left' });
      expect(phone.p!.grid).toBeUndefined();
      expect(phone.cands[0]!.painted).toBe('W');
      expect(pairFullCaption(phone.items)).toMatch(/pair stage \d; W painted in, on island's ground$/);
    });

    it('warms no seam cell on a phone-width screen (the #201 review: desktop cells were fetched there)', () => {
      expect(warm([slot('island', 0, 4), slot('swamp', 1, 3)], true).some((s) => s.includes('/seams/'))).toBe(false);
      expect(warm([slot('island', 0, 3)], true).some((s) => s.includes('/seams/'))).toBe(false);
      expect(warm([slot('island', 0, 4), slot('swamp', 1, 3)]).filter((s) => s.includes('/seams/')).length).toBeGreaterThan(0);
    });
  });
});
