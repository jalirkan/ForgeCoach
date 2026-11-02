/*
 * ForgeCoach — ambience/pairs-v7.1.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * pairs-v7.1 (spec 1.18): the pairs FORGECOACH_PAIRS_FULL_URL points at under
 * `?pairfull=1` -- pairs-v6's manifest and desktop pictures with every one of
 * its 160 grid cells given a `phone` picture and the third colour painted in,
 * merged by ~/scenery-packs/panoramas-v1/tools/make_pairs_v6_draft.py
 * (--phone-fragment / --pin-fragment, --phone-base / --pin-base) from the two
 * painters' fragments, tagged 2026-11-02, three jsDelivr refs:
 *
 * - `@pairs-v7.1`: this manifest and pairs-v6's desktop files, named relatively;
 * - `@pairs-v7-phone`: the 160 cells' phone pictures (13.6 MB), by absolute URL;
 * - `@pairs-v7-pin`: the 660 painted-in cell pictures (48.3 MB), by absolute URL.
 *
 * `@pairs-v7`, tagged earlier the same day, is the same tree with the
 * manifest mislabelled "pairs-v6 draft" in its `name` and `note` (493,232
 * bytes, sha256 90060ba7080881557bf3cf13b0f756ca0502090c3c2baf79bc5b14694a77e559);
 * pairs-v7.1 supersedes it, its `name` and `note` written after its tag, and
 * nothing points at pairs-v7.
 *
 * `testdata/pairs-v7.1.tag.pairs.json` is the tagged manifest byte for byte
 * (493,264 bytes, the sha256 below),
 * https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v7.1/pairs.json:
 * past the 256 KB a pairs manifest could be until 1.18, under the 1 MB it may
 * be now (pairs.ts MAX_PAIRS_MANIFEST_BYTES).
 * `testdata/pairs-v7.pairs.json` is NOT this file: it is the HAND-MADE 1.18
 * fixture `pairs-grid-phone.test.ts` reads (two pairs on a small grid, no file
 * it names exists), written before the painters' fragments, and kept as it is.
 *
 * {@link v7Problems} is what the reader needs of it (none). Also here, on the
 * real cells: the flag's default, the pair forming (its first cell warmed and
 * held), a phone (it now has a cell picture: the desktop's cell, at the phone
 * shape) and the third colour on a cell (its painted picture on the heavier
 * half; on a phone, whose painted pictures have no phone picture, the plain
 * cell's phone picture and nothing), and the warm set of each.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { halfLayout } from './layout.ts';
import { BIOME_COLOUR } from './makeup.ts';
import { stageFor, type Biome, type SlotState } from './model.ts';
import { PAIR_FULL_HOLD_MS, pairFullCandidates, pairFullCaption, pairFullChoice, pairFullCutOutAllowed, pairFullHold, pairFullPlan, type PairFullHold, type PairFullPair } from './pairfull.ts';
import { fetchPairs, geographyOrder, MAX_PAIRS_MANIFEST_BYTES, MAX_PAIRS_PACK_BYTES, pairPictures, pairsRefBytes, validatePairs } from './pairs.ts';
import { DEFAULT_PREFS, effectivePrefs, FORGECOACH_PAIRS_FULL_URL, FORGECOACH_PAIRS_URL, pairsUrlOf } from './prefs.ts';

const CDN = 'https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery';
const V71 = `${CDN}@pairs-v7.1/`;
const V7 = `${CDN}@pairs-v7/`;
const V7_PHONE = `${CDN}@pairs-v7-phone/`;
const V7_PIN = `${CDN}@pairs-v7-pin/`;
const V6 = `${CDN}@pairs-v6/`;
const MB50 = 50 * 1024 * 1024;
const T = [1, 2, 3, 4, 5, 6];
const COLOURS = ['W', 'U', 'B', 'R', 'G'] as const;
/** A slot as the tracker makes it: the stage from the weight on the pack's thresholds. */
const slot = (biome: Biome, index: number, weight: number): SlotState => ({ biome, index, weight, stage: stageFor(weight, T), peak: stageFor(weight, T) });

/** A pair key's seam folder: its two colours in the geography's order (island → swamp → plains → forest → mountain). */
const geographySlug = (key: string) => geographyOrder(...(key.split('+') as [Biome, Biome]))!.join('-');
const cell = (slug: string, c: string) => `${V71}seams/${slug}/s${c}-panorama.webp`;
const phoneCell = (slug: string, c: string) => `${V7_PHONE}seams/${slug}/s${c}-panorama-phone.webp`;
const pin = (slug: string, c: string, colour: string, side: 'L' | 'R') => `${V7_PIN}seams/${slug}/s${c}+${colour}${side}-panorama.webp`;

const bytes = readFileSync(new URL('./testdata/pairs-v7.1.tag.pairs.json', import.meta.url));
const raw = JSON.parse(bytes.toString('utf8'));
const v6 = JSON.parse(readFileSync(new URL('./testdata/pairs-v6.pairs.json', import.meta.url), 'utf8'));

/** What the reader needs of pairs-v7.1, one line per problem (none: it is ready to be the flag's default). */
function v7Problems(m: Record<string, any>, prev: Record<string, any>): string[] {
  const out: string[] = [];
  if (m.schema !== 1) out.push('schema: 1');
  if (m.spec !== '1.18') out.push(`spec: "1.18" (is ${m.spec})`);
  if (Object.keys(m.pairs ?? {}).sort().join() !== Object.keys(prev.pairs).sort().join()) out.push('not pairs-v6’s ten pairs');
  for (const key of Object.keys(prev.pairs)) {
    const p = m.pairs?.[key];
    if (!p?.grid) {
      out.push(`${key}: no grid`);
      continue;
    }
    // pairs-v6's entry, its grid included, apart from each cell's `phone` and `elements`: a missing picture draws as 1.17.
    const bare = structuredClone(p);
    for (const c of Object.values<Record<string, unknown>>(bare.grid)) {
      delete c.phone;
      delete c.elements;
    }
    if (JSON.stringify(bare) !== JSON.stringify(prev.pairs[key])) out.push(`${key}: not pairs-v6’s entry apart from its cells’ phone and elements`);
    const slug = geographySlug(key);
    const own = key.split('+').map((b) => BIOME_COLOUR[b as Biome]);
    const third = COLOURS.filter((c) => !own.includes(c));
    if (Object.keys(p.grid).length !== 16) out.push(`${key}: ${Object.keys(p.grid).length} cells, not 16`);
    for (const [k, c] of Object.entries<Record<string, any>>(p.grid)) {
      const [i, j] = k.split('x').map(Number) as [number, number];
      const ph = c.phone;
      if (!ph || ph.src !== phoneCell(slug, k) || ph.width !== 1638 || ph.height !== 1280 || !(ph.bytes > 0) || !Array.isArray(ph.subjectBand) || ph.subjectBand.length !== 2)
        out.push(`${key}.${k}: phone not { src: "${phoneCell(slug, k)}", width: 1638, height: 1280, bytes, subjectBand }`);
      const els = c.elements ?? {};
      if (Object.keys(els).sort().join() !== [...third].sort().join()) out.push(`${key}.${k}: elements ${Object.keys(els).join()}, not the three other colours ${third.join()}`);
      // The heavier half's side only: left where i ≥ j, right where i ≤ j (both at i = j), in the cell's order.
      const sides = [...(i >= j ? ['left'] : []), ...(i <= j ? ['right'] : [])];
      for (const [colour, e] of Object.entries<Record<string, any>>(els)) {
        if (Object.keys(e).sort().join() !== sides.join()) out.push(`${key}.${k}.${colour}: sides ${Object.keys(e).join()}, not ${sides.join()}`);
        for (const s of sides) {
          const pic = e[s];
          const want = pin(slug, k, colour, s === 'left' ? 'L' : 'R');
          if (!pic || pic.src !== want || !(pic.bytes > 0) || pic.phone !== undefined) out.push(`${key}.${k}.${colour}.${s}: not { src: "${want}", bytes } (no phone)`);
        }
      }
    }
  }
  return out;
}

describe('pairs-v7.1: the flag’s default', () => {
  it('?pairfull=1 with no ?pairs= is pairs-v7.1 (never the mislabelled pairs-v7); the board without the flag stays on pairs-v3.1; ?pairs= wins', () => {
    expect(FORGECOACH_PAIRS_FULL_URL).toBe(V71);
    expect(FORGECOACH_PAIRS_FULL_URL).not.toBe(V7);
    expect(pairsUrlOf(effectivePrefs(DEFAULT_PREFS, '?pairfull=1', ''))).toBe(V71);
    expect(pairsUrlOf(effectivePrefs(DEFAULT_PREFS, '', '#ambience?pairfull=on'))).toBe(V71);
    expect(pairsUrlOf(effectivePrefs(DEFAULT_PREFS, '', ''))).toBe(FORGECOACH_PAIRS_URL);
    expect(pairsUrlOf(effectivePrefs(DEFAULT_PREFS, '?pairfull=0', ''))).toBe(FORGECOACH_PAIRS_URL);
    expect(FORGECOACH_PAIRS_URL).toBe(`${CDN}@pairs-v3.1/`);
    expect(pairsUrlOf(effectivePrefs(DEFAULT_PREFS, `?pairfull=1&pairs=${encodeURIComponent(V6)}`, ''))).toBe(V6);
    expect(pairsUrlOf(effectivePrefs(DEFAULT_PREFS, '?pairfull=1&pairs=off', ''))).toBeNull();
    // A pack of your own brings no ForgeCoach pairs, flag or not.
    expect(pairsUrlOf({ ...effectivePrefs(DEFAULT_PREFS, '?pairfull=1', ''), packUrl: 'https://example.org/pack/' })).toBeNull();
  });
});

describe('pairs-v7.1: the published manifest', () => {
  const r = validatePairs(raw, `${V71}pairs.json`);
  const pairs = r.pairs!;

  it('is the file jsDelivr serves byte for byte (the pairs-v7.1 tag, 2026-11-02): past 256 KB, under the 1 MB a pairs manifest may be', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('b59cf90776d7c0a419f4442661f02d7c4761128680f29535d1f72b91c06cd125');
    expect(bytes.length).toBe(493_264);
    expect(bytes.length).toBeGreaterThan(256 * 1024);
    expect(MAX_PAIRS_MANIFEST_BYTES).toBe(1024 * 1024);
    expect(bytes.length).toBeLessThan(MAX_PAIRS_MANIFEST_BYTES);
  });

  it('fetchPairs reads it (refused before 1.18 as over 256 KB); a manifest past 1 MB is still refused unread', async () => {
    const serve = (text: string) => async () => ({ ok: true, status: 200, text: async () => text });
    const ok = await fetchPairs(V71, { fetch: serve(bytes.toString('utf8')) });
    expect(ok.manifestUrl).toBe(`${V71}pairs.json`);
    expect(ok.errors).toEqual([]);
    expect(ok.pairs?.spec).toBe('1.18');
    const big = await fetchPairs(V71, { fetch: serve(' '.repeat(MAX_PAIRS_MANIFEST_BYTES + 1)) });
    expect(big.pairs).toBeNull();
    expect(big.errors).toEqual(['The pairs manifest is over 1 MB.']);
  });

  it('validates with no errors, written for 1.18; one budget warning a pair, naming its grid and painted-in pictures; its own ref under 45 MB', () => {
    expect(r.errors).toEqual([]);
    expect(raw.schema).toBe(1);
    expect(pairs.spec).toBe('1.18');
    expect(r.warnings).toHaveLength(10);
    expect(r.warnings.filter((w) => /of them the seam grid \(1\.17\) and [\d.]+ MB painted-in elements/.test(w)).map((w) => w.split(':')[0]).sort()).toEqual(Object.keys(v6.pairs).map((k) => `pairs.${k}`).sort());
    // No side or colour dropped, no spec warning: every phone and painted picture reads.
    expect(r.warnings.some((w) => w.startsWith('pairs: ') || w.startsWith('spec') || /\.grid/.test(w))).toBe(false);
    // The phone and painted pictures lie at their own tags (absolute URLs): this ref holds pairs-v6's desktop files only.
    expect(pairsRefBytes(pairs)).toBeLessThan(MAX_PAIRS_PACK_BYTES);
  });

  it('is pairs-v6 with a phone picture and the three other colours painted in on every cell: nothing left for the reader to want', () => {
    expect(v7Problems(raw, v6)).toEqual([]);
    // The check finds what it is for: a cell without a phone picture, and a side never drawn.
    const bad = structuredClone(raw);
    delete bad.pairs['island+swamp'].grid['4x3'].phone;
    bad.pairs['island+swamp'].grid['4x3'].elements.R.right = { src: pin('island-swamp', '4x3', 'R', 'R'), bytes: 1 };
    expect(v7Problems(bad, v6)).toEqual([expect.stringMatching(/^island\+swamp\.4x3: phone not/), 'island+swamp.4x3.R: sides left,right, not left']);
  });

  it('reads every cell’s phone picture in its shape and every painted side in the cell’s order: 160 and 660, at their tags', () => {
    let phones = 0;
    let phoneBytes = 0;
    let painted = 0;
    let paintedBytes = 0;
    for (const k of Object.keys(v6.pairs)) {
      const g = pairs.pairs[k]!.grid!;
      expect(`${g.left}-${g.right}`).toBe(geographySlug(k));
      expect(Object.keys(g.cells)).toHaveLength(16);
      for (const [key, c] of Object.entries(g.cells)) {
        expect(c!.phone).toMatchObject({ src: phoneCell(geographySlug(k), key), width: 1638, height: 1280 });
        expect(c!.phone!.subjectBand).toHaveLength(2);
        expect(c!.phoneBytes).toBeGreaterThan(0);
        phones++;
        phoneBytes += c!.phoneBytes!;
        for (const [colour, e] of Object.entries(c!.elements!)) {
          for (const side of ['left', 'right'] as const) {
            const pic = e![side];
            if (!pic) continue;
            expect(pic.src).toBe(pin(geographySlug(k), key, colour, side === 'left' ? 'L' : 'R'));
            expect([pic.width, pic.height, pic.phone]).toEqual([3277, 640, null]);
            painted++;
            paintedBytes += pic.bytes!;
          }
        }
      }
    }
    expect([phones, painted]).toEqual([160, 660]);
    // 13.6 and 48.3 million bytes: each in a ref of its own, under jsDelivr's 50 MB.
    expect([(phoneBytes / 1e6).toFixed(1), (paintedBytes / 1e6).toFixed(1)]).toEqual(['13.6', '48.3']);
    expect(phoneBytes).toBeLessThan(MB50);
    expect(paintedBytes).toBeLessThan(MB50);
  });

  it('names itself after its tag (pairs-v7 said “pairs-v6 draft”); its note says the cells have phone pictures, never “a phone draws the stages”', () => {
    expect(raw.name).toBe('ForgeCoach pair scenery, pairs-v7.1 (seam grid, phone cells and painted-in cells, sketch)');
    expect(raw.note).toMatch(/^pairs-v7\.1 \(spec 1\.18, /);
    expect(`${raw.name} ${raw.note}`).not.toMatch(/pairs-v6/);
    expect(raw.note).toMatch(/each with a phone picture/);
    expect(raw.note).toMatch(/painted into 160 cells \(660 pictures\)/);
    expect(raw.note).not.toMatch(/a phone draws the stages/);
  });
});

describe('pairs-v7.1 on the board', () => {
  const pairs = validatePairs(raw, `${V71}pairs.json`).pairs!;
  const at = (slots: SlotState[], narrow = false) => {
    const layout = halfLayout(slots, null);
    const items = pairFullPlan(layout, pairs, { thresholds: T, slots, narrow });
    const p = items?.find((x): x is PairFullPair => x.kind === 'pair') ?? null;
    return { layout, items, p, cands: p ? pairFullCandidates(p, narrow ? 2.1 : 5, narrow) : [], caption: pairFullCaption(items) };
  };
  const warm = (slots: SlotState[], narrow = false) => pairPictures(pairs, [slots], { phone: narrow, full: { thresholds: T, narrow } }).map((w) => w.src);
  const seams = (s: readonly string[]) => s.filter((x) => x.includes('/seams/'));

  describe('the pair forming: its first cell warm before the second colour arrives, and held while it loads', () => {
    it('one colour warms each of its four grid pairs’ first cell, the arriving colour at stage 1, clamped as the pick clamps', () => {
      // Island at stage 3: each other colour's first land shows island s3 | <colour> s1 → 3x2 (the island is every pair's left).
      expect(seams(warm([slot('island', 0, 3)])).sort()).toEqual(['island-swamp', 'island-plains', 'island-forest', 'island-mountain'].map((s) => cell(s, '3x2')).sort());
      // Mountain at stage 4: the mountain is every pair's right, so <colour> s1 | mountain s4 → 3x4.
      expect(seams(warm([slot('mountain', 0, 4)])).sort()).toEqual(['island-mountain', 'swamp-mountain', 'plains-mountain', 'forest-mountain'].map((s) => cell(s, '3x4')).sort());
      // No painted picture is warmed for a pair not yet formed.
      expect(warm([slot('island', 0, 3)]).some((s) => s.includes('+'))).toBe(false);
    });

    it('so the pair’s first frame is its cell: the panels, then the cell -- never the whole-place panorama between', () => {
      const before = at([slot('island', 0, 3)]);
      expect(before.items).toBeNull();
      const after = at([slot('island', 0, 3), slot('swamp', 1, 1)]);
      expect(after.cands[0]).toMatchObject({ cell: '3x2', mirror: false });
      expect(after.cands[0]!.art.picture!.src).toBe(cell('island-swamp', '3x2'));
      const pano = after.cands.find((c) => !c.cell)!.art.picture!.src;
      const status = (ready: readonly string[]) => (src: string) => (ready.includes(src) ? 'ready' : 'pending');
      const mono = pairFullHold({ layout: before.layout, plan: null, choice: null }, { last: null, since: null } as PairFullHold<typeof before.layout>, 0);
      // Warmed ahead: the first frame of the pair is the cell.
      const warmed = warm([slot('island', 0, 3)]);
      const w = pairFullHold({ layout: after.layout, plan: after.items, choice: pairFullChoice(after.cands, status(warmed)) }, mono.hold, 100);
      expect([w.holding, w.draw.shown?.cell]).toEqual([false, '3x2']);
      // Cold: the panels are held while the cell loads, though the panorama is warm; past 8 s, what has loaded.
      const c = pairFullHold({ layout: after.layout, plan: after.items, choice: pairFullChoice(after.cands, status([pano])) }, mono.hold, 100);
      expect(c.holding).toBe(true);
      expect(c.draw.plan).toBeNull();
      const late = pairFullHold({ layout: after.layout, plan: after.items, choice: pairFullChoice(after.cands, status([pano])) }, c.hold, 100 + PAIR_FULL_HOLD_MS);
      expect([late.holding, late.draw.shown?.art.picture!.src]).toEqual([false, pano]);
    });
  });

  describe('a phone: the desktop’s cell, drawn from its phone picture (every pairs-v7.1 cell has one)', () => {
    it('plans the cell the desktop plans, at the phone shape, and the caption names the seam', () => {
      const desk = at([slot('island', 0, 4), slot('swamp', 1, 3)]);
      const phone = at([slot('island', 0, 4), slot('swamp', 1, 3)], true);
      expect(desk.p!.grid!.cell).toBe('4x3');
      expect(phone.p!.grid).toMatchObject({ cell: '4x3', clamped: false, mirror: false });
      expect(phone.cands[0]).toMatchObject({ cell: '4x3', painted: null, mirror: false });
      expect(phone.cands[0]!.art).toMatchObject({ source: 'phone' });
      expect(phone.cands[0]!.art.picture!.src).toBe(phoneCell('island-swamp', '4x3'));
      expect(desk.cands[0]!.art.picture!.src).toBe(cell('island-swamp', '4x3'));
      expect(phone.caption).toMatch(/whole half: island 57% \| swamp 43%, island s4 \| swamp s3, seam 4x3$/);
    });

    it('through the clamp and mirrored as on the desktop', () => {
      const clamped = at([slot('island', 0, 6), slot('swamp', 1, 2)], true);
      expect(clamped.p!.grid).toMatchObject({ cell: '6x5', clamped: true });
      expect(clamped.cands[0]!.art.picture!.src).toBe(phoneCell('island-swamp', '6x5'));
      expect(clamped.caption).toMatch(/island s6 \| swamp s2→s5, seam 6x5 \(clamped\)$/);
      const m = at([slot('forest', 0, 2), slot('swamp', 1, 3)], true);
      expect(m.p!.grid).toMatchObject({ cell: '3x2', mirror: true });
      expect(m.cands[0]).toMatchObject({ cell: '3x2', mirror: true });
      expect(m.cands[0]!.art.picture!.src).toBe(phoneCell('swamp-forest', '3x2'));
    });

    it('warms the phone cells (shown, neighbours, a mono side’s first cells) at the phone shape, never a desktop cell', () => {
      const two = seams(warm([slot('island', 0, 4), slot('swamp', 1, 3)], true));
      expect(two).toContain(phoneCell('island-swamp', '4x3'));
      expect(two.every((s) => s.startsWith(V7_PHONE) && s.endsWith('-panorama-phone.webp'))).toBe(true);
      expect(seams(warm([slot('island', 0, 3)], true)).sort()).toEqual(['island-swamp', 'island-plains', 'island-forest', 'island-mountain'].map((s) => phoneCell(s, '3x2')).sort());
      // The desktop warms the desktop cells.
      expect(seams(warm([slot('island', 0, 4), slot('swamp', 1, 3)])).every((s) => s.startsWith(`${V71}seams/`) && !s.includes('-phone'))).toBe(true);
    });
  });

  describe('a third colour on a cell: its painted-in picture on the heavier half', () => {
    it('draws the cell with the colour painted in on the heavier half, before the plain cell; no element, so no cut-out', () => {
      const t = at([slot('island', 0, 3), slot('swamp', 1, 2), slot('mountain', 2, 1)]);
      expect(t.p!.grid).toMatchObject({ cell: '3x2', painted: { colour: 'R', side: 'left' } });
      expect(t.p!.element).toBeUndefined();
      expect(t.cands.slice(0, 2).map((c) => [c.cell, c.painted, c.art.picture!.src])).toEqual([
        ['3x2', 'R', pin('island-swamp', '3x2', 'R', 'L')],
        ['3x2', null, cell('island-swamp', '3x2')],
      ]);
      expect(t.cands.slice(2).some((c) => c.cell || c.painted)).toBe(false);
      expect(t.caption).toMatch(/island s3 \| swamp s2, seam 3x2; R painted in, on island's ground$/);
      expect(pairFullCutOutAllowed(pairFullChoice(t.cands, () => 'ready'))).toBe(false);
    });

    it('the worked example (Plains, Island, Plateau): island+plains’ cell 1x1 with red on the plains’ side, mirrored', () => {
      const t = at([slot('plains', 0, 1.5), slot('island', 1, 1), slot('mountain', 2, 0.5)]);
      expect(t.p!.grid).toMatchObject({ cell: '1x1', mirror: true, painted: { colour: 'R', side: 'right' } });
      expect(t.cands[0]).toMatchObject({ cell: '1x1', painted: 'R', mirror: true });
      expect(t.cands[0]!.art.picture!.src).toBe(pin('island-plains', '1x1', 'R', 'R'));
      expect(t.caption).toMatch(/seam 1x1; R painted in, on plains's ground$/);
    });

    it('in the cell’s order on a mirrored pair: forest 2 | swamp 3 | plains 1 is swamp+forest’s 3x2 with W on the swamp’s (left) side', () => {
      const m = at([slot('forest', 0, 2), slot('swamp', 1, 3), slot('plains', 2, 1)]);
      expect(m.p!.grid).toMatchObject({ cell: '3x2', mirror: true, painted: { colour: 'W', side: 'left' } });
      expect(m.cands[0]).toMatchObject({ cell: '3x2', painted: 'W', mirror: true });
      expect(m.cands[0]!.art.picture!.src).toBe(pin('swamp-forest', '3x2', 'W', 'L'));
      expect(m.caption).toMatch(/swamp s3 \| forest s2, seam 3x2; W painted in, on swamp's ground$/);
    });

    it('on a phone (no painted picture has a phone picture): the plain cell’s phone picture, nothing painted, nothing said of it', () => {
      const t = at([slot('island', 0, 3), slot('swamp', 1, 2), slot('mountain', 2, 1)], true);
      expect(t.p!.grid!.cell).toBe('3x2');
      expect(t.p!.grid!.painted).toBeUndefined();
      expect(t.p!.element).toBeUndefined();
      expect(t.cands[0]).toMatchObject({ cell: '3x2', painted: null });
      expect(t.cands[0]!.art.picture!.src).toBe(phoneCell('island-swamp', '3x2'));
      expect(t.cands.some((c) => c.painted)).toBe(false);
      expect(t.caption).toMatch(/seam 3x2$/);
      expect(t.caption).not.toMatch(/painted/);
    });

    it('warms the shown cell’s painted pictures for the colour on the board only; on a phone none', () => {
      const painted = (s: readonly string[]) => s.filter((x) => x.includes('/seams/') && x.includes('+'));
      expect(painted(warm([slot('island', 0, 3), slot('swamp', 1, 2), slot('mountain', 2, 1)]))).toEqual([pin('island-swamp', '3x2', 'R', 'L')]);
      // At i = j both of the cell's sides: a land that turns the balance flips the side.
      expect(painted(warm([slot('island', 0, 3), slot('swamp', 1, 3), slot('mountain', 2, 1)])).sort()).toEqual([pin('island-swamp', '3x3', 'R', 'L'), pin('island-swamp', '3x3', 'R', 'R')]);
      expect(painted(warm([slot('island', 0, 3), slot('swamp', 1, 3), slot('mountain', 2, 1)], true))).toEqual([]);
      expect(painted(warm([slot('island', 0, 3), slot('swamp', 1, 2)]))).toEqual([]);
    });
  });

  describe('spec 1.18.1: a phone draws the third colour’s cut-out where the cell’s painted picture has no phone picture', () => {
    // pack-v9.2's pieces: every colour's element has a phone piece (pieces-v1).
    const ALL = new Set<Biome>(['plains', 'island', 'swamp', 'mountain', 'forest']);
    const plan = (slots: SlotState[], narrow: boolean, phoneElements: ReadonlySet<Biome> | null = ALL) => {
      const items = pairFullPlan(halfLayout(slots, null), pairs, { thresholds: T, slots, narrow, elements: ALL, phoneElements });
      const p = items?.find((x): x is PairFullPair => x.kind === 'pair') ?? null;
      return { items, p, cands: p ? pairFullCandidates(p, narrow ? 2.1 : 5, narrow) : [], caption: pairFullCaption(items) };
    };
    // Justin's phone, 2026-11-02: Island 2, Swamp 2, Mountain 2, Forest 3 -- the three heaviest kept (the tie by
    // arrival), forest+island the pair, the swamp its third; island s2 | forest s3 is the cell 2x3, the forest heavier.
    const justin = [slot('island', 0, 2), slot('swamp', 1, 2), slot('mountain', 2, 2), slot('forest', 3, 3)];

    it('the phone: the plain cell’s phone picture with the swamp’s cut-out on the forest’s ground, and the caption says so', () => {
      const t = plan(justin, true);
      expect(t.p!.grid).toMatchObject({ cell: '2x3', mirror: false });
      expect(t.p!.grid!.painted).toBeUndefined();
      expect(t.p!.element).toBe('swamp');
      expect(t.p!.elementSide).toBeUndefined();
      // The cell's phone picture first; never a painted picture, the cell's or the stage's (1.18 rule 3).
      expect(t.cands[0]).toMatchObject({ cell: '2x3', painted: null, mirror: false });
      expect(t.cands[0]!.art.picture!.src).toBe(phoneCell('island-forest', '2x3'));
      expect(t.cands.some((c) => c.painted)).toBe(false);
      expect(t.caption).toMatch(/island s2 \| forest s3, seam 2x3; swamp as an element$/);
      expect(t.caption).not.toMatch(/painted/);
      // The cut-out stands once the cell is on screen, and not over another picture while the cell loads (the hold).
      expect(pairFullCutOutAllowed(pairFullChoice(t.cands, () => 'ready'))).toBe(true);
      const cellSrc = t.cands[0]!.art.picture!.src;
      expect(pairFullCutOutAllowed(pairFullChoice(t.cands, (src) => (src === cellSrc ? 'pending' : 'ready')))).toBe(false);
      // The cell failed: what the half falls back to (the stage's pictures) still takes the cut-out, as a pair without a grid.
      expect(pairFullCutOutAllowed(pairFullChoice(t.cands, (src) => (src === cellSrc ? 'failed' : 'ready')))).toBe(true);
    });

    it('the desktop keeps the painted picture: the swamp painted into the cell on the forest’s ground, no element, no cut-out', () => {
      const t = plan(justin, false);
      expect(t.p!.grid).toMatchObject({ cell: '2x3', mirror: false, painted: { colour: 'B', side: 'right' } });
      expect(t.p!.element).toBeUndefined();
      expect(t.cands[0]).toMatchObject({ cell: '2x3', painted: 'B', mirror: false });
      expect(t.cands[0]!.art.picture!.src).toBe(pin('island-forest', '2x3', 'B', 'R'));
      expect(t.caption).toMatch(/seam 2x3; B painted in, on forest's ground$/);
      expect(pairFullCutOutAllowed(pairFullChoice(t.cands, () => 'ready'))).toBe(false);
    });

    it('likewise for three colours, on any pair: island 3 | swamp 2 | mountain 1 on a phone is 3x2 with the mountain as an element', () => {
      const t = plan([slot('island', 0, 3), slot('swamp', 1, 2), slot('mountain', 2, 1)], true);
      expect(t.p!.grid).toMatchObject({ cell: '3x2', mirror: false });
      expect(t.p!.grid!.painted).toBeUndefined();
      expect(t.p!.element).toBe('mountain');
      expect(t.cands[0]!.art.picture!.src).toBe(phoneCell('island-swamp', '3x2'));
      expect(t.caption).toMatch(/seam 3x2; mountain as an element$/);
      // The desktop: the painted picture, as before.
      const d = plan([slot('island', 0, 3), slot('swamp', 1, 2), slot('mountain', 2, 1)], false);
      expect(d.p!.grid!.painted).toMatchObject({ colour: 'R', side: 'left' });
      expect(d.p!.element).toBeUndefined();
      // Mirrored (the board has forest | swamp, the geography swamp | forest): swamp+forest's 3x2, the plains as an element.
      const m = plan([slot('forest', 0, 2), slot('swamp', 1, 3), slot('plains', 2, 1)], true);
      expect(m.p!.grid).toMatchObject({ cell: '3x2', mirror: true });
      expect([m.p!.grid!.painted, m.p!.element]).toEqual([undefined, 'plains']);
      expect(m.cands[0]).toMatchObject({ cell: '3x2', painted: null, mirror: true });
      expect(m.caption).toMatch(/swamp s3 \| forest s2, seam 3x2; plains as an element$/);
    });

    it('a colour whose element has no phone piece draws nothing on the phone, and the caption says nothing of it', () => {
      for (const none of [null, new Set<Biome>(['plains', 'island', 'mountain', 'forest'])]) {
        const t = plan(justin, true, none);
        expect(t.p!.grid!.cell).toBe('2x3');
        expect(t.p!.element).toBeUndefined();
        expect(t.p!.grid!.painted).toBeUndefined();
        expect(t.caption).toMatch(/seam 2x3$/);
      }
    });

    it('two colours, or a cell with no painted picture of the third: no element (1.17’s rule is unchanged)', () => {
      expect(plan([slot('island', 0, 2), slot('forest', 1, 3)], true).p!.element).toBeUndefined();
      // A cell with the colour painted only on the lighter half's side: nothing, phone or desktop (pairs-v7.1 has none such;
      // drop the forest's side of the swamp's entry on 2x3).
      const bad = structuredClone(raw);
      delete bad.pairs['forest+island'].grid['2x3'].elements.B;
      const local = validatePairs(bad, `${V71}pairs.json`).pairs!;
      const items = pairFullPlan(halfLayout(justin, null), local, { thresholds: T, slots: justin, narrow: true, elements: ALL, phoneElements: ALL });
      const p = items!.find((x): x is PairFullPair => x.kind === 'pair')!;
      expect([p.grid?.cell, p.grid?.painted, p.element]).toEqual(['2x3', undefined, undefined]);
    });
  });
});
