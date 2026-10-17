/*
 * ForgeCoach — ambience/pairs.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.9, pair bands: the pair key (both orders one entry, the art mirrored),
 * the `pairs.json` validator (defaults, what is dropped and why), the band's
 * width (min, + perDual per dual, the cap, the panels' floor), the stage map,
 * the row the half lays out (a band of no width is exactly the seam it
 * replaces; a bridge sits on the band's centre), three colours (two bands),
 * the warming, the 1.6 / 1.7 / 1.8-only fallback (no pairs: today's row
 * exactly), the loader and the prefs, and the spec's worked example — the
 * `forest+island` entry of docs/pairs-manifest-draft.json, the file the art
 * lane matches.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bridgePlacements, halfSeams, seamCentre } from './bridges.ts';
import { validateManifest } from './manifest.ts';
import { halfLayout, halfSpans, type HalfSlotLayout } from './layout.ts';
import { dualsOf, stepScenery, type Biome, type SlotState } from './model.ts';
import { simCard, simState } from './sim.ts';
import { resolveScenery, clearSceneryCache } from './pack.ts';
import { DEFAULT_PREFS, effectivePrefs, FORGECOACH_PACK_URL, FORGECOACH_PAIRS_URL, pairsUrlOf } from './prefs.ts';
import {
  bandWidth,
  DEFAULT_PAIR_BAND,
  DEFAULT_STAGE_MAP,
  halfRow,
  normalisePairKey,
  pairBands,
  pairFor,
  pairHalfAt,
  pairPictures,
  pairsManifestUrl,
  pairStageFor,
  rowCentre,
  rowCentreCss,
  validatePairs,
  type PairsPack,
} from './pairs.ts';

const BASE = 'http://127.0.0.1:8650/pairs.json';
const stage = (d: string, n: number) => ({ half: { src: `pairs/${d}/s${n}-half.webp`, phone: { src: `pairs/${d}/s${n}-phone.webp` } } });
const entry = (d: string, extra: Record<string, unknown> = {}) => ({ dual: 'D', shock: 'S', stages: [stage(d, 1), stage(d, 2), stage(d, 3)], ...extra });
const read = (pairs: unknown, extra: Record<string, unknown> = {}) => {
  const r = validatePairs({ schema: 1, spec: '1.9', pairs, ...extra }, BASE);
  expect(r.errors).toEqual([]);
  return { pairs: r.pairs!, warnings: r.warnings };
};
const slot = (b: Biome, index: number, weight: number, st = weight > 0 ? Math.min(6, Math.ceil(weight)) : 0): SlotState => ({ biome: b, index, weight, stage: st, peak: Math.max(1, st) });
const land = (id: number, name: string, types: string, player = 1) => simCard(id, player, name, types);
const SIX = [1, 2, 3, 4, 5, 6];

describe('the pair key', () => {
  it('normalises both orders to the alphabetical key, and refuses anything that is not two different biomes', () => {
    expect(normalisePairKey('island+forest')).toBe('forest+island');
    expect(normalisePairKey('forest+island')).toBe('forest+island');
    expect(normalisePairKey('swamp+plains')).toBe('plains+swamp');
    expect(normalisePairKey('forest+forest')).toBeNull();
    expect(normalisePairKey('forest+lava')).toBeNull();
    expect(normalisePairKey('forest+island+swamp')).toBeNull();
    expect(normalisePairKey('forest')).toBeNull();
  });
  it('finds one entry from either order, mirrored when the board has the pair the other way round from the key', () => {
    const { pairs, warnings } = read({ 'island+forest': entry('island-forest') });
    expect(warnings).toEqual([]);
    expect(Object.keys(pairs.pairs)).toEqual(['forest+island']);
    expect(pairs.pairs['forest+island']).toMatchObject({ key: 'forest+island', left: 'island', right: 'forest', dual: 'D', shock: 'S' });
    expect(pairFor(pairs, 'island', 'forest')).toMatchObject({ mirror: false });
    expect(pairFor(pairs, 'forest', 'island')).toMatchObject({ mirror: true });
    expect(pairFor(pairs, 'forest', 'island')!.pair).toBe(pairFor(pairs, 'island', 'forest')!.pair);
    expect(pairFor(pairs, 'forest', 'swamp')).toBeNull();
    expect(pairFor(pairs, 'forest', 'forest')).toBeNull();
  });
  it('keeps the first of a pair given in both orders', () => {
    const { pairs, warnings } = read({ 'forest+island': entry('a'), 'island+forest': entry('b') });
    expect(pairHalfAt(pairs.pairs['forest+island'], 1)!.src).toBe('http://127.0.0.1:8650/pairs/a/s1-half.webp');
    expect(warnings).toEqual(['pairs.island+forest: the pair forest+island is given twice; the first is kept']);
  });
});

describe('the pairs manifest', () => {
  it('reads the defaults: band 0.10 / 0.04 / 0.34, stage map [[1, 2], [3, 4], [5, 6]], no transitions', () => {
    const { pairs } = read({ 'forest+island': { stages: [stage('fi', 1)] } });
    const p = pairs.pairs['forest+island']!;
    expect(p.band).toEqual(DEFAULT_PAIR_BAND);
    expect(DEFAULT_PAIR_BAND).toEqual({ min: 0.1, perDual: 0.04, max: 0.34 });
    expect(p.stageMap).toEqual(DEFAULT_STAGE_MAP);
    expect(p.transitions).toBeNull();
    expect([p.dual, p.shock]).toEqual([null, null]);
    expect(pairs.base).toBe('http://127.0.0.1:8650/');
  });
  it('resolves every picture against pairs.json, phone pictures included, with 1.5’s half fields', () => {
    const { pairs } = read({ 'forest+island': entry('forest-island') });
    const h = pairHalfAt(pairs.pairs['forest+island'], 2)!;
    expect(h.src).toBe('http://127.0.0.1:8650/pairs/forest-island/s2-half.webp');
    expect(h.phone!.src).toBe('http://127.0.0.1:8650/pairs/forest-island/s2-phone.webp');
    expect([h.width, h.height, h.phone!.width, h.phone!.height]).toEqual([2048, 640, 1024, 1280]);
    // Past the last stage, the last.
    expect(pairHalfAt(pairs.pairs['forest+island'], 5)!.src).toMatch(/s3-half/);
    expect(pairHalfAt(pairs.pairs['forest+island'], 0)).toBeNull();
  });
  it('warns and falls back on bad fields, drops what cannot be drawn', () => {
    const { pairs, warnings } = read({
      'forest+island': entry('fi', { band: { min: 0.9, perDual: -1, max: 0.05 }, stageMap: [[1, 2], [4, 6]] }),
      'forest+lava': entry('x'),
      'island+swamp': { stages: [{ half: { src: 'data:image/webp,x' } }] },
      'plains+swamp': 'no',
    });
    expect(Object.keys(pairs.pairs)).toEqual(['forest+island']);
    const p = pairs.pairs['forest+island']!;
    expect(p.band).toEqual({ min: 0.1, perDual: 0.04, max: 0.1 });
    expect(p.stageMap).toEqual(DEFAULT_STAGE_MAP);
    expect(warnings).toEqual([
      'pairs.forest+island.stageMap: a list of [from, to] neighbour stages, from 1 up with no gap ([[1, 2], [3, 4], [5, 6]]); using the default',
      'pairs.forest+island.band.min: 0.9 is out of range 0–0.5; using 0.1',
      'pairs.forest+island.band.perDual: -1 is out of range 0–0.2; using 0.04',
      'pairs.forest+island.band.max: 0.05 is narrower than min 0.1; using 0.1',
      'pairs.forest+lava: not a pair of two different biomes joined by + ("forest+island"); ignored',
      'pairs.island+swamp.stages[0].half.src: the data: scheme is not allowed (http, https or relative only); picture dropped',
      'pairs.island+swamp.stages[0]: no usable half picture; stage dropped',
      'pairs.island+swamp: no stage with a usable half picture; pair dropped',
      'pairs.plains+swamp: not an object { dual, shock, stages, band, stageMap }; ignored',
    ]);
  });
  it('refuses a manifest with no usable pair, or that is not schema 1', () => {
    expect(validatePairs({ schema: 1, pairs: {} }, BASE).errors).toEqual(['No pair has a usable stage picture.']);
    expect(validatePairs({ schema: 2, pairs: {} }, BASE).errors[0]).toMatch(/schema: expected 1/);
    expect(validatePairs({ schema: 1 }, BASE).errors[0]).toMatch(/^pairs: missing/);
    expect(validatePairs([], BASE).errors[0]).toMatch(/not a JSON object/);
  });
  it('drops transitions whose stages no longer line up, and warns on a stage map longer than the pictures', () => {
    const t = { steps: [{ from: 1, frames: [{ src: 'pairs/fi/f1.webp' }] }] };
    const { pairs, warnings } = read({ 'forest+island': { stages: [stage('fi', 1), { half: { src: 'bad.gif' } }], transitions: t } });
    expect(pairs.pairs['forest+island']!.transitions).toBeNull();
    expect(warnings).toContain('pairs.forest+island.transitions: a stage of this biome was dropped, so the steps no longer match their stages; ignored');
    expect(warnings).toContain('pairs.forest+island.stageMap: 3 pair stages, 1 pictured; the later ones show the last stage');
  });
  it('finds pairs.json in a folder, or takes a .json URL as it is', () => {
    expect(pairsManifestUrl('https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v1/')).toBe('https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v1/pairs.json');
    expect(pairsManifestUrl('http://127.0.0.1:8650/pairs')).toBe('http://127.0.0.1:8650/pairs/pairs.json');
    expect(pairsManifestUrl('http://127.0.0.1:8650/my.json')).toBe('http://127.0.0.1:8650/my.json');
    expect(pairsManifestUrl('javascript:x')).toBeNull();
  });
});

describe('the band’s width and stage', () => {
  it('is min with no duals, min + perDual per dual, capped at max (6 duals reach it)', () => {
    const b = DEFAULT_PAIR_BAND;
    expect([0, 1, 2, 3, 6, 7, 20].map((n) => bandWidth(b, n))).toEqual([0.1, 0.14, 0.18, 0.22, 0.34, 0.34, 0.34]);
    expect(bandWidth({ min: 0.2, perDual: 0, max: 0.5 }, 4)).toBe(0.2);
  });
  it('maps the lower neighbour stage through stageMap: 1–2 → 1, 3–4 → 2, 5–6 → 3; past it the last; none 0', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((s) => pairStageFor(DEFAULT_STAGE_MAP, s))).toEqual([0, 1, 1, 2, 2, 3, 3, 3]);
    expect([1, 2, 3, 4].map((s) => pairStageFor([[1, 1], [2, 4]], s))).toEqual([1, 2, 2, 2]);
  });
  it('takes the lower of the two neighbours’ stages, and never a stage the pair has no picture for', () => {
    const { pairs } = read({ 'forest+island': entry('fi'), 'island+swamp': { stages: [stage('is', 1)] } });
    const bands = pairBands(halfLayout([slot('forest', 0, 6), slot('island', 1, 3), slot('swamp', 2, 5)], null), pairs);
    expect(bands.map((b) => [b.key, b.lower, b.stage])).toEqual([
      ['forest+island', 3, 2],
      ['island+swamp', 3, 1],
    ]);
  });
});

describe('the half’s row', () => {
  const { pairs } = (() => {
    const r = validatePairs({ schema: 1, pairs: { 'forest+island': entry('fi'), 'island+swamp': entry('is') } }, BASE);
    return { pairs: r.pairs! };
  })();
  const seams = (layout: HalfSlotLayout[]) => halfSeams(layout, null);

  it('takes the band’s width half from each panel, and meets each in half their seam', () => {
    const layout = halfLayout([slot('island', 0, 2), slot('forest', 1, 2)], null);
    const bands = pairBands(layout, pairs, { 'forest+island': 2 });
    expect(bands).toHaveLength(1);
    expect(bands[0]).toMatchObject({ key: 'forest+island', index: 1, left: 'island', right: 'forest', mirror: true, duals: 2, width: 0.18 });
    expect(halfRow(layout, seams(layout), bands).map((x) => [x.kind, x.key, x.share, x.seam])).toEqual([
      ['slot', 'island', 0.41, 0],
      ['band', 'forest+island', 0.18, 0.05],
      ['slot', 'forest', 0.41, 0.05],
    ]);
  });
  it('a band that is not open (its picture not loaded) has no width: the seam is exactly today’s, and the bridge’s centre with it', () => {
    const layout = halfLayout([slot('island', 0, 3), slot('forest', 1, 1)], null);
    const bands = pairBands(layout, pairs);
    const shut = halfRow(layout, seams(layout), bands, () => false);
    expect(shut.map((x) => [x.kind, x.share])).toEqual([
      ['slot', 0.75],
      ['band', 0],
      ['slot', 0.25],
    ]);
    // The band's centre is the old seam's middle; the two halves of the seam add up to it.
    const plain = halfRow(layout, seams(layout));
    for (const w of [1600, 390])
      expect(rowCentre(shut, 1, w, 1920)).toBeCloseTo(
        seamCentre(
          plain,
          plain.map((x) => x.seam),
          1,
          w,
          1920,
        ),
        6,
      );
  });
  it('never takes more than half a panel’s share: next to a panel at its floor, a 0.34 band is drawn 0.15 wide', () => {
    const layout = halfLayout([slot('island', 0, 6), slot('forest', 1, 0.5, 1)], null);
    expect(layout.map((l) => l.share)).toEqual([0.85, 0.15]);
    const bands = pairBands(layout, pairs, { 'forest+island': 6 });
    expect(bands[0]!.width).toBe(0.34);
    const row = halfRow(layout, seams(layout), bands);
    expect(row.map((x) => x.share)).toEqual([0.775, 0.15, 0.075]);
  });
  it('three colours: two seams, two bands, the middle panel giving half of each', () => {
    const layout = halfLayout([slot('forest', 0, 2), slot('island', 1, 2), slot('swamp', 2, 2)], null);
    const bands = pairBands(layout, pairs, { 'island+swamp': 1 });
    expect(bands.map((b) => [b.key, b.index, b.width, b.mirror])).toEqual([
      ['forest+island', 1, 0.1, false],
      ['island+swamp', 2, 0.14, false],
    ]);
    const row = halfRow(layout, seams(layout), bands);
    expect(row.map((x) => [x.kind, x.key, x.share])).toEqual([
      ['slot', 'forest', 0.283],
      ['band', 'forest+island', 0.1],
      ['slot', 'island', 0.213],
      ['band', 'island+swamp', 0.14],
      ['slot', 'swamp', 0.263],
    ]);
    expect(row.reduce((n, x) => n + x.share, 0)).toBeCloseTo(1, 2);
  });
  it('draws no band by a withered panel, nor for a pair without an entry', () => {
    const withered = halfLayout([slot('island', 0, 3), slot('forest', 1, 0)], null);
    expect(pairBands(withered, pairs)).toEqual([]);
    expect(pairBands(halfLayout([slot('mountain', 0, 2), slot('plains', 1, 2)], null), pairs)).toEqual([]);
  });
  it('without pairs (a 1.6, 1.7 or 1.8-only pack) the row is the layout exactly: the same shares, the same seams, the same spans', () => {
    const live = JSON.parse(readFileSync(new URL('./testdata/pack-v8.scenery.json', import.meta.url), 'utf8'));
    const pack = validateManifest(live, `${FORGECOACH_PACK_URL}scenery.json`).pack!;
    expect(pack.pairs).toBeUndefined();
    const layout = halfLayout([slot('forest', 0, 3), slot('island', 1, 2), slot('swamp', 2, 1)], pack);
    const duals = { 'forest+island': 2 };
    const s = halfSeams(layout, pack, duals);
    expect(pairBands(layout, pack.pairs, duals)).toEqual([]);
    const row = halfRow(layout, s, pairBands(layout, pack.pairs, duals));
    expect(row.map((x) => x.kind)).toEqual(['slot', 'slot', 'slot']);
    expect(row.map((x) => x.share)).toEqual(layout.map((l) => l.share));
    expect(row.map((x) => x.seam)).toEqual(s);
    expect(halfSpans(layout, 1600, row.map((x) => x.seam))).toEqual(halfSpans(layout, 1600, s));
    // The bridge is where 1.8 put it.
    const [b] = bridgePlacements(layout, pack, duals);
    expect(seamCentre(row, row.map((x) => x.seam), b!.index, 1600)).toBe(seamCentre(layout, s, b!.index, 1600));
  });
  it('its CSS twin follows the numbers (1600 px half, no cap)', () => {
    const layout = halfLayout([slot('island', 0, 3), slot('forest', 1, 3)], null);
    const row = halfRow(layout, seams(layout), pairBands(layout, pairs, { 'forest+island': 2 }));
    expect(rowCentreCss(row, 1)).toBe('calc(0.5 * (100cqw + min(5cqw, 14vw) + min(5cqw, 14vw)) - (min(5cqw, 14vw)))');
    expect(rowCentre(row, 1, 1600)).toBeCloseTo(800, 6);
    expect(rowCentreCss(row, 0)).toBe('calc(0.205 * (100cqw + min(5cqw, 14vw) + min(5cqw, 14vw)))');
  });
});

describe('warming', () => {
  it('warms each live pair’s picture at the stage its lower neighbour maps to, and the next, at the board’s shape, once each', () => {
    const { pairs } = read({ 'forest+island': entry('fi') });
    const sides = [[slot('forest', 0, 3), slot('island', 1, 2), slot('swamp', 2, 0)], [slot('island', 0, 1), slot('forest', 1, 1)]];
    expect(pairPictures(pairs, sides, { phone: false }).map((p) => p.src.replace('http://127.0.0.1:8650/pairs/fi/', ''))).toEqual(['s1-half.webp', 's2-half.webp']);
    expect(pairPictures(pairs, [[slot('forest', 0, 6), slot('island', 1, 6)]], { phone: true }).map((p) => p.src.replace('http://127.0.0.1:8650/pairs/fi/', ''))).toEqual(['s3-phone.webp']);
    expect(pairPictures(null, sides, { phone: false })).toEqual([]);
  });
});

describe('loading and prefs', () => {
  it('fetches ForgeCoach’s pairs with ForgeCoach’s pack, none with another pack, and takes ?pairs= for one page', () => {
    expect(FORGECOACH_PAIRS_URL).toBe('https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v1/');
    expect(pairsUrlOf(DEFAULT_PREFS)).toBe(FORGECOACH_PAIRS_URL);
    expect(pairsUrlOf({ ...DEFAULT_PREFS, packUrl: 'http://127.0.0.1:8650/' })).toBeNull();
    expect(pairsUrlOf({ ...DEFAULT_PREFS, mode: 'procedural' })).toBeNull();
    expect(pairsUrlOf(effectivePrefs(DEFAULT_PREFS, '?pairs=off', ''))).toBeNull();
    expect(pairsUrlOf(effectivePrefs({ ...DEFAULT_PREFS, packUrl: 'http://127.0.0.1:8650/' }, '', '#ambience?pairs=http://127.0.0.1:8651/'))).toBe('http://127.0.0.1:8651/');
    expect(pairsUrlOf(effectivePrefs({ ...DEFAULT_PREFS, packUrl: 'http://127.0.0.1:8650/' }, '?pairs=forgecoach', ''))).toBe(FORGECOACH_PAIRS_URL);
  });
  const manifest = { schema: 1, biomes: { island: { stages: [{ layers: [{ id: 'sky', kind: 'image', src: 'island/s1.webp' }] }] } } };
  const fetchOf = (pairsBody: unknown) => async (url: string) => {
    if (url.endsWith('/scenery.json')) return { ok: true, status: 200, text: async () => JSON.stringify(manifest) };
    if (url.endsWith('/pairs.json')) return pairsBody === null ? { ok: false, status: 404, text: async () => '' } : { ok: true, status: 200, text: async () => JSON.stringify(pairsBody) };
    throw new Error(url);
  };
  it('carries the pairs on the loaded pack; a pairs manifest that fails only means no bands', async () => {
    clearSceneryCache();
    const prefs = { ...DEFAULT_PREFS, pairsUrl: 'http://127.0.0.1:8651/' };
    const ok = await resolveScenery({ ...prefs, packUrl: 'http://127.0.0.1:8650/' }, { fetch: fetchOf({ schema: 1, pairs: { 'forest+island': entry('fi') } }), load: async () => {} });
    expect(ok!.source).toBe('pack');
    expect(Object.keys(ok!.pack!.pairs!.pairs)).toEqual(['forest+island']);
    const gone = await resolveScenery({ ...prefs, packUrl: 'http://127.0.0.1:8650/' }, { fetch: fetchOf(null), load: async () => {} });
    expect(gone!.source).toBe('pack');
    expect(gone!.pack!.pairs).toBeUndefined();
    expect(gone!.note).toBeNull();
  });
});

describe('the spec’s worked example', () => {
  const md = readFileSync(new URL('../../docs/scenery-pack-spec.md', import.meta.url), 'utf8');
  const block = /<!-- example-pairs -->\s*```json\n([\s\S]*?)```/.exec(md);
  const example = JSON.parse(block![1]!);
  const draft = JSON.parse(readFileSync(new URL('../../docs/pairs-manifest-draft.json', import.meta.url), 'utf8'));
  const V1 = 'https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v1/pairs.json';

  it('is the forest+island entry of the draft manifest the art lane matches, which has all ten pairs and validates clean', () => {
    const { pairs: _p, ...top } = draft;
    const { pairs: _q, ...exTop } = example;
    expect(exTop).toEqual(top);
    expect(example.pairs).toEqual({ 'forest+island': draft.pairs['forest+island'] });
    const r = validatePairs(draft, V1);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    const names = Object.fromEntries(Object.values(r.pairs!.pairs).map((p) => [p!.key, `${p!.dual} / ${p!.shock}`]));
    expect(names).toEqual({
      'forest+island': 'Tropical Island / Breeding Pool',
      'forest+mountain': 'Taiga / Stomping Ground',
      'forest+plains': 'Savannah / Temple Garden',
      'forest+swamp': 'Bayou / Overgrown Tomb',
      'island+mountain': 'Volcanic Island / Steam Vents',
      'island+plains': 'Tundra / Hallowed Fountain',
      'island+swamp': 'Underground Sea / Watery Grave',
      'mountain+plains': 'Plateau / Sacred Foundry',
      'mountain+swamp': 'Badlands / Blood Crypt',
      'plains+swamp': 'Scrubland / Godless Shrine',
    });
    for (const p of Object.values(r.pairs!.pairs)) {
      expect(p!.stages).toHaveLength(3);
      expect(p!.transitions!.steps.map((s) => [s.from, s.frames.length])).toEqual([
        [1, 2],
        [2, 2],
      ]);
      expect(p!.stages.every((s) => !!s.half!.src2x && !!s.half!.phone?.src2x)).toBe(true);
    }
  });

  it('validates with no warnings, and its numbers hold', () => {
    const r = validatePairs(example, V1);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    const pairs: PairsPack = r.pairs!;
    expect(pairHalfAt(pairs.pairs['forest+island'], 1)!.src).toBe('https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v1/pairs/forest-island/s1-half.webp');
    // An Island, then a Forest (ForgeCoach's thresholds, 1..6): the band opens mirrored at 0.10, the panels 0.45 each.
    const step = (cards: ReturnType<typeof land>[]) => stepScenery(null, simState(new Map([[1, cards]]), [], 1), { thresholds: SIX });
    const two = step([land(1, 'Island', 'Basic Land - Island'), land(2, 'Forest', 'Basic Land - Forest')]);
    const l1 = halfLayout(two.players[0]!.slots, null);
    const b1 = pairBands(l1, pairs, dualsOf(two, 1));
    expect(b1.map((b) => [b.key, b.mirror, b.width, b.stage])).toEqual([['forest+island', true, 0.1, 1]]);
    expect(halfRow(l1, halfSeams(l1, null), b1).map((x) => x.share)).toEqual([0.45, 0.1, 0.45]);
    // Another of each and two Breeding Pools: 3 and 3, two duals: 0.18, the panels 0.41, pair stage 2.
    const lands = [land(1, 'Island', 'Basic Land - Island'), land(2, 'Forest', 'Basic Land - Forest'), land(3, 'Island', 'Basic Land - Island'), land(4, 'Forest', 'Basic Land - Forest'), land(5, 'Breeding Pool', 'Land - Forest Island'), land(6, 'Breeding Pool', 'Land - Forest Island')];
    const sc = step(lands);
    expect(sc.players[0]!.slots.map((s) => [s.biome, s.weight, s.stage])).toEqual([
      ['island', 3, 3],
      ['forest', 3, 3],
    ]);
    const layout = halfLayout(sc.players[0]!.slots, null);
    const bands = pairBands(layout, pairs, dualsOf(sc, 1));
    expect(bands.map((b) => [b.duals, b.width, b.lower, b.stage])).toEqual([[2, 0.18, 3, 2]]);
    const row = halfRow(layout, halfSeams(layout, null), bands);
    expect(row.map((x) => [x.share, x.seam])).toEqual([
      [0.41, 0],
      [0.18, 0.05],
      [0.41, 0.05],
    ]);
    // A 1600 px half: the row is 1760 px, the band ≈ 317 px wide, centred at 800 px.
    expect(0.18 * (1600 + 2 * 80)).toBeCloseTo(316.8, 6);
    expect(rowCentre(row, 1, 1600, 1920)).toBeCloseTo(800, 6);
    // The 1 → 2 step: two frames, 200 ms each, then 180 ms.
    const t = pairs.pairs['forest+island']!.transitions!;
    expect([t.holdMs, t.fadeMs, t.steps[0]!.frames.length]).toEqual([200, 180, 2]);
    // Six duals reach the cap; a seventh adds nothing.
    expect(bandWidth(pairs.pairs['forest+island']!.band, 6)).toBe(0.34);
    expect(bandWidth(pairs.pairs['forest+island']!.band, 7)).toBe(0.34);
  });
});
