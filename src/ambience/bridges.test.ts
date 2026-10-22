/*
 * ForgeCoach — ambience/bridges.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.8, bridges across the seam: the pair key (both orders resolve to one
 * entry), the manifest's `bridges` (defaults, what is dropped and why, the
 * budget), the dual lands counted per pair (½ to each biome as before, and
 * once per pair), the seam each pair's duals widen, the anchor maths (the
 * seam's centre as the flex row lays it out, its CSS twin, the scale), the
 * phone piece, the pictures warmed with the split, the 1.7 fallback (no
 * bridges: today's seam, whatever the duals) and the spec's worked example.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bridgeFor, bridgePictures, bridgePlacements, halfSeams, phoneHalf, PHONE_HALF_ASPECT, seamCentre, seamCentreCss, seamRatioFor } from './bridges.ts';
import { DEFAULT_BRIDGE_ANCHOR, DEFAULT_DUALS_WIDEN, DEFAULT_MAX_SEAM_RATIO, validateManifest, type ScenePack } from './manifest.ts';
import { halfLayout, halfSpans } from './layout.ts';
import { biomeWeights, dualPairs, dualsOf, landBiomes, landPair, pairKey, stepScenery, type Biome, type SlotState } from './model.ts';
import { simCard, simState } from './sim.ts';

const BASE = 'http://127.0.0.1:8650/scenery.json';
const ROOT = 'http://127.0.0.1:8650/';
const stage = (b: string, n: number) => ({ layers: [], half: { src: `${b}/s${n}-half.webp`, phone: { src: `${b}/s${n}-phone.webp` } } });
const biome = (b: string) => ({ stages: [stage(b, 1), stage(b, 2)] });
const manifest = (bridges: unknown, extra: Record<string, unknown> = {}) => ({
  schema: 1,
  spec: '1.8',
  stageThresholds: [1, 2],
  biomes: { forest: biome('forest'), island: biome('island'), swamp: biome('swamp'), plains: biome('plains') },
  bridges,
  ...extra,
});
const read = (raw: unknown) => {
  const r = validateManifest(raw, BASE);
  expect(r.errors).toEqual([]);
  return { pack: r.pack!, warnings: r.warnings };
};
const river = { src: 'bridges/forest-island.webp', phone: { src: 'bridges/forest-island-phone.webp', anchor: { y: 0.725, width: 0.6 } }, anchor: { y: 0.725, width: 0.4 }, bytes: 230000 };
const slot = (b: Biome, index: number, weight: number, stage = weight > 0 ? 1 : 0): SlotState => ({ biome: b, index, weight, stage, peak: Math.max(1, stage) });
const land = (id: number, name: string, types: string, player = 1) => simCard(id, player, name, types);

describe('the pair key', () => {
  it('is the two biomes in alphabetical order, the same for both orders', () => {
    expect(pairKey('island', 'forest')).toBe('forest+island');
    expect(pairKey('forest', 'island')).toBe('forest+island');
    expect(pairKey('swamp', 'plains')).toBe('plains+swamp');
    expect(pairKey('mountain', 'island')).toBe('island+mountain');
  });
  it('finds one entry from either order, and mirrors the art when the board has the pair the other way round', () => {
    // Written in the reverse order ("island+forest"): the art has island on its left.
    const { pack, warnings } = read(manifest({ 'island+forest': river }));
    expect(warnings).toEqual([]);
    expect(Object.keys(pack.bridges!)).toEqual(['forest+island']);
    expect(pack.bridges!['forest+island']).toMatchObject({ key: 'forest+island', left: 'island', right: 'forest' });
    expect(bridgeFor(pack, 'island', 'forest')).toMatchObject({ mirror: false });
    expect(bridgeFor(pack, 'forest', 'island')).toMatchObject({ mirror: true });
    expect(bridgeFor(pack, 'forest', 'island')!.bridge).toBe(bridgeFor(pack, 'island', 'forest')!.bridge);
    expect(bridgeFor(pack, 'forest', 'swamp')).toBeNull();
    expect(bridgeFor(pack, 'forest', 'forest')).toBeNull();
  });
});

describe('the manifest’s bridges (spec 1.8)', () => {
  it('reads an entry, resolving its URLs against the pack', () => {
    const { pack, warnings } = read(manifest({ 'forest+island': { ...river, src2x: 'bridges/forest-island@2x.webp', dualsWiden: 0.03, maxSeamRatio: 0.2 } }));
    expect(warnings).toEqual([]);
    expect(pack.bridges!['forest+island']).toEqual({
      key: 'forest+island',
      left: 'forest',
      right: 'island',
      desktop: { src: `${ROOT}bridges/forest-island.webp`, src2x: `${ROOT}bridges/forest-island@2x.webp`, anchor: { y: 0.725, width: 0.4 } },
      phone: { src: `${ROOT}bridges/forest-island-phone.webp`, src2x: null, anchor: { y: 0.725, width: 0.6 } },
      dualsWiden: 0.03,
      maxSeamRatio: 0.2,
      bytes: 230000,
    });
  });
  it('defaults: the anchor, +0.02 a dual up to 0.18, and the phone piece taking the desktop anchor', () => {
    const { pack, warnings } = read(manifest({ 'plains+swamp': { src: 'b/ps.webp', phone: { src: 'b/ps-phone.webp' } } }));
    expect(warnings).toEqual([]);
    const b = pack.bridges!['plains+swamp']!;
    expect(b.desktop.anchor).toEqual(DEFAULT_BRIDGE_ANCHOR);
    expect(b.phone!.anchor).toEqual(DEFAULT_BRIDGE_ANCHOR);
    expect([b.dualsWiden, b.maxSeamRatio, b.bytes]).toEqual([DEFAULT_DUALS_WIDEN, DEFAULT_MAX_SEAM_RATIO, null]);
    expect([DEFAULT_DUALS_WIDEN, DEFAULT_MAX_SEAM_RATIO]).toEqual([0.02, 0.18]);
  });
  it('drops bad keys, repeats and entries without a usable src; a bad phone drops only the phone piece', () => {
    const { pack, warnings } = read(
      manifest({
        'forest+island': river,
        'island+forest': { src: 'b/again.webp' },
        'forest+forest': { src: 'b/x.webp' },
        'forest+lava': { src: 'b/x.webp' },
        'forest+island+swamp': { src: 'b/x.webp' },
        'island+swamp': { src: 'javascript:alert.webp' },
        'forest+swamp': { src: 'b/fs.webp', phone: { src: 'b/fs.gif' }, anchor: { y: 2, width: 0.01 }, dualsWiden: 0.5 },
        'plains+swamp': 'b/ps.webp',
      }),
    );
    expect(Object.keys(pack.bridges!).sort()).toEqual(['forest+island', 'forest+swamp']);
    expect(pack.bridges!['forest+island']!.desktop.src).toBe(`${ROOT}bridges/forest-island.webp`);
    const fs = pack.bridges!['forest+swamp']!;
    expect(fs.phone).toBeNull();
    expect(fs.desktop.anchor).toEqual(DEFAULT_BRIDGE_ANCHOR);
    expect(fs.dualsWiden).toBe(DEFAULT_DUALS_WIDEN);
    expect(warnings).toEqual([
      'bridges.island+forest: the pair forest+island is given twice; the first is kept',
      'bridges.forest+forest: not a pair of two different biomes joined by + ("forest+island"); ignored',
      'bridges.forest+lava: not a pair of two different biomes joined by + ("forest+island"); ignored',
      'bridges.forest+island+swamp: not a pair of two different biomes joined by + ("forest+island"); ignored',
      'bridges.island+swamp.src: the javascript: scheme is not allowed (http, https or relative only); bridge dropped',
      'bridges.forest+swamp.anchor.y: 2 is out of range 0–1; using 0.72',
      'bridges.forest+swamp.anchor.width: 0.01 is out of range 0.05–1; using 0.4',
      'bridges.forest+swamp.phone.src: expected .webp, .avif, .png or .jpg; phone picture dropped',
      'bridges.forest+swamp.dualsWiden: 0.5 is out of range 0–0.1; using 0.02',
      'bridges.plains+swamp: not an object { src, phone, anchor, dualsWiden }; ignored',
    ]);
  });
  it('warns past the 3 MB budget and keeps the bridges', () => {
    const { pack, warnings } = read(manifest({ 'forest+island': { ...river, bytes: 2_000_000 }, 'plains+swamp': { src: 'b/ps.webp', bytes: 1_500_000 } }));
    expect(Object.keys(pack.bridges!)).toHaveLength(2);
    expect(warnings).toEqual(['bridges: 3.3 MB of bridge files declared; their budget is 3 MB for the pack (bridges kept)']);
  });
  it('a pack without bridges (1.7) has none, and a bridges that is not an object is ignored', () => {
    expect(read(manifest(undefined, { spec: '1.7' })).pack.bridges).toBeUndefined();
    const r = read(manifest(['forest+island']));
    expect(r.pack.bridges).toBeUndefined();
    expect(r.warnings).toEqual(['bridges: not an object keyed by biome pairs ("forest+island"); ignored']);
  });
});

describe('dual lands (spec 1.8)', () => {
  it('a dual still counts ½ to each of its biomes', () => {
    expect(landBiomes(land(1, 'Breeding Pool', 'Land - Forest Island'))).toEqual({ forest: 0.5, island: 0.5 });
    const st = simState(new Map([[1, [land(1, 'Forest', 'Basic Land - Forest'), land(2, 'Breeding Pool', 'Land - Forest Island'), land(3, 'Island', 'Basic Land - Island')]]]), [], 1);
    expect(biomeWeights(st, 1)).toEqual({ forest: 1.5, island: 1.5 });
  });
  it('is counted once per pair: a two-type land or one tapping for exactly two colours; never a basic, a triome or a colourless land', () => {
    expect(landPair(landBiomes(land(1, 'Breeding Pool', 'Land - Forest Island')))).toBe('forest+island');
    const tap = simCard(2, 1, 'Karplusan Forest', 'Land', { abilities: [{ id: 1, text: '{T}: Add {R} or {G}.', canPlay: false, isSpell: false }] });
    expect(landPair(landBiomes(tap))).toBe('forest+mountain');
    expect(landPair(landBiomes(land(3, 'Forest', 'Basic Land - Forest')))).toBeNull();
    expect(landPair(landBiomes(land(4, 'Ketria Triome', 'Land - Forest Island Mountain')))).toBeNull();
    expect(landPair(landBiomes(land(5, 'Wastes', 'Basic Land - Wastes')))).toBeNull();
    expect(landPair(null)).toBeNull();
    const st = simState(
      new Map([
        [1, [land(1, 'Breeding Pool', 'Land - Forest Island'), land(2, 'Breeding Pool', 'Land - Forest Island'), land(3, 'Watery Grave', 'Land - Island Swamp'), land(4, 'Forest', 'Basic Land - Forest'), land(5, 'Ketria Triome', 'Land - Forest Island Mountain')]],
        [2, [land(6, 'Island', 'Basic Land - Island', 2)]],
      ]),
      [],
      1,
    );
    expect(dualPairs(st, 1)).toEqual({ 'forest+island': 2, 'island+swamp': 1 });
    expect(dualPairs(st, 2)).toEqual({});
    const sc = stepScenery(null, st);
    expect(dualsOf(sc, 1)).toEqual({ 'forest+island': 2, 'island+swamp': 1 });
    expect(dualsOf(sc, 2)).toEqual({});
    expect(sc.players.find((p) => p.playerId === 2)!.duals).toBeUndefined();
  });
});

describe('the seam and the anchor (spec 1.8)', () => {
  const { pack } = read(manifest({ 'forest+island': river, 'island+swamp': { src: 'b/is.webp', dualsWiden: 0.05 } }));
  const bridge = pack.bridges!['forest+island']!;

  it('widens a pair’s seam by dualsWiden per dual, up to maxSeamRatio, never below the base', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map((n) => seamRatioFor(0.1, bridge, n))).toEqual([0.1, 0.12, 0.14, 0.16, 0.18, 0.18, 0.18]);
    expect(seamRatioFor(0.1, null, 3)).toBe(0.1);
    expect(seamRatioFor(0.25, bridge, 2)).toBe(0.25);
  });
  it('gives each slot the seam on its left: a bridged pair’s widened by its duals, the rest the base', () => {
    const layout = halfLayout([slot('forest', 0, 3), slot('island', 1, 3), slot('plains', 2, 1)], pack);
    expect(halfSeams(layout, pack, { 'forest+island': 2, 'island+plains': 3 })).toEqual([0, 0.14, 0.1]);
    // A withered neighbour's seam is plain.
    expect(halfSeams(halfLayout([slot('forest', 0, 3), slot('island', 1, 0)], pack), pack, { 'forest+island': 2 })).toEqual([0, 0.1]);
  });
  it('places the bridge on the seam: its anchor, scaled by the duals, mirrored for the reverse order', () => {
    const layout = halfLayout([slot('island', 0, 2), slot('forest', 1, 2)], pack);
    const [p] = bridgePlacements(layout, pack, {});
    expect(p).toMatchObject({ key: 'forest+island', index: 1, left: 'island', right: 'forest', mirror: true, phone: false, seamRatio: 0.1, scale: 1, y: 0.725, width: 0.4 });
    const [w] = bridgePlacements(layout, pack, { 'forest+island': 2 });
    expect(w).toMatchObject({ seamRatio: 0.14, scale: 1.4, width: 0.56 });
    expect(bridgePlacements(layout, pack, { 'forest+island': 3 }, { phone: true })[0]).toMatchObject({ phone: true, scale: 1.6, width: 0.96, picture: { src: `${ROOT}bridges/forest-island-phone.webp` } });
    // No phone piece: the desktop one on a phone too.
    const is = bridgePlacements(halfLayout([slot('island', 0, 1), slot('swamp', 1, 1)], pack), pack, {}, { phone: true })[0]!;
    expect(is).toMatchObject({ phone: false, mirror: false, width: 0.4 });
  });
  it('draws none for a single biome, a withered neighbour, or a pair without a bridge', () => {
    expect(bridgePlacements(halfLayout([slot('forest', 0, 3)], pack), pack)).toEqual([]);
    expect(bridgePlacements(halfLayout([slot('forest', 0, 3), slot('island', 1, 0)], pack), pack)).toEqual([]);
    expect(bridgePlacements(halfLayout([slot('forest', 0, 3), slot('plains', 1, 2)], pack), pack)).toEqual([]);
    expect(bridgePlacements(halfLayout([slot('forest', 0, 3), slot('island', 1, 2)], pack), null)).toEqual([]);
  });
  it('one bridge per bridged seam on a three-biome side', () => {
    const layout = halfLayout([slot('forest', 0, 2), slot('island', 1, 2), slot('swamp', 2, 2)], pack);
    expect(bridgePlacements(layout, pack, { 'island+swamp': 1 }).map((p) => [p.key, p.index, p.seamRatio])).toEqual([
      ['forest+island', 1, 0.1],
      ['island+swamp', 2, 0.15],
    ]);
  });

  /** Evaluate seamCentreCss's CSS in a half `w` px wide in a viewport `vw` px wide. */
  const evalCss = (expr: string, w: number, vw: number): number =>
    new Function(`return ${expr.replace(/(\d+(?:\.\d+)?)cqw/g, `($1*${w}/100)`).replace(/(\d+(?:\.\d+)?)vw/g, `($1*${vw}/100)`).replace(/calc\(/g, '(').replace(/\bmin\(/g, 'Math.min(')};`)() as number;

  it('finds the seam’s centre as the flex row lays the slots out (halfSpans), and its CSS twin agrees, 14vw cap included', () => {
    const layout = halfLayout([slot('forest', 0, 3), slot('island', 1, 2), slot('swamp', 2, 1)], pack);
    const seams = halfSeams(layout, pack, { 'forest+island': 2, 'island+swamp': 1 });
    const spans = halfSpans(layout, 1000, seams);
    for (const i of [1, 2]) expect(seamCentre(layout, seams, i, 1000)).toBeCloseTo(spans[i]!.left + (seams[i]! * 1000) / 2, 0);
    for (const [w, vw] of [
      [1000, 1920],
      [1600, 1920],
      [390, 390],
      [700, 760],
    ] as const)
      for (const i of [1, 2]) expect(evalCss(seamCentreCss(layout, seams, i), w, vw), `${w}/${vw} seam ${i}`).toBeCloseTo(seamCentre(layout, seams, i, w, vw), 3);
    // On a phone the cap bites: a 0.15 seam of a 390 px half is 58.5 px, capped at 14vw = 54.6 px.
    expect(seamCentre(layout, [0, 0.15, 0.15], 1, 390, 390)).not.toBeCloseTo(seamCentre(layout, [0, 0.15, 0.15], 1, 390), 1);
  });
  it('takes the phone piece where the half is nearer 4:5 than 16:5', () => {
    expect(PHONE_HALF_ASPECT).toBeCloseTo(1.6, 6);
    expect([null, 0, 0.9, 1.3, 1.59, 1.61, 3.2].map((a) => phoneHalf(a))).toEqual([false, false, true, true, true, false, false]);
    // A phone-width screen: the phone pieces whatever the half's shape (a 390 × 844 phone's half is ~2.1 : 1).
    expect([null, 2.14, 3.2].map((a) => phoneHalf(a, { narrow: true }))).toEqual([true, true, true]);
  });
  it('warms a side’s bridge with its split’s pictures, at the board’s shape, each file once', () => {
    const sides = [
      [{ biome: 'island' as Biome, stage: 2 }, { biome: 'forest' as Biome, stage: 1 }],
      [{ biome: 'forest' as Biome, stage: 3 }, { biome: 'island' as Biome, stage: 1 }, { biome: 'swamp' as Biome, stage: 0 }],
    ];
    expect(bridgePictures(pack, sides, { phone: false })).toEqual([{ src: `${ROOT}bridges/forest-island.webp`, src2x: null }]);
    expect(bridgePictures(pack, sides, { phone: true })).toEqual([{ src: `${ROOT}bridges/forest-island-phone.webp`, src2x: null }]);
    expect(bridgePictures(pack, [[{ biome: 'forest', stage: 2 }]], { phone: false })).toEqual([]);
    expect(bridgePictures(null, sides, { phone: false })).toEqual([]);
  });
});

describe('a 1.7 pack keeps today’s seam', () => {
  const live = JSON.parse(readFileSync(new URL('./testdata/pack-v7.3.scenery.json', import.meta.url), 'utf8'));
  const r = validateManifest(live, 'https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pack-v7.3/pack/scenery.json');
  const pack = r.pack as ScenePack;
  it('loads with no bridges, and every seam is the base whatever the duals', () => {
    expect(r.errors).toEqual([]);
    expect(pack.bridges).toBeUndefined();
    const layout = halfLayout([slot('forest', 0, 3), slot('island', 1, 2), slot('swamp', 2, 1)], pack);
    expect(halfSeams(layout, pack, { 'forest+island': 3, 'island+swamp': 2 })).toEqual([0, 0.1, 0.1]);
    expect(bridgePlacements(layout, pack, { 'forest+island': 3 })).toEqual([]);
    expect(bridgePictures(pack, [layout.map((l) => l.slot)], { phone: false })).toEqual([]);
    // The spans are exactly the 1.5 layout's.
    expect(halfSpans(layout, 1000, halfSeams(layout, pack))).toEqual(halfSpans(layout, 1000, 0.1));
  });
});

describe('the spec’s worked example', () => {
  it('validates with no warnings, and its numbers hold', () => {
    const md = readFileSync(new URL('../../docs/scenery-pack-spec.md', import.meta.url), 'utf8');
    const block = /<!-- example-bridges -->\s*```json\n([\s\S]*?)```/.exec(md);
    expect(block).not.toBeNull();
    const r = validateManifest(JSON.parse(block![1]!), BASE);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    const pack = r.pack!;
    // An Island, then a Forest: island | forest, the reverse of the key, so the river is mirrored, 40% wide at 72.5% down.
    const first = bridgePlacements(halfLayout([slot('island', 0, 1), slot('forest', 1, 1)], pack), pack, {});
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ mirror: true, y: 0.725, width: 0.4, seamRatio: 0.1 });
    // Two more of each and two Breeding Pools: 3 and 3, two duals. On a 1600 px desktop half the seam is 0.14 (224 px),
    // its middle at 800 px, and the river 0.56 of the half (896 px).
    const pools = [land(1, 'Island', 'Basic Land - Island'), land(2, 'Forest', 'Basic Land - Forest'), land(3, 'Island', 'Basic Land - Island'), land(4, 'Forest', 'Basic Land - Forest'), land(5, 'Breeding Pool', 'Land - Forest Island'), land(6, 'Breeding Pool', 'Land - Forest Island')];
    const sc = stepScenery(null, simState(new Map([[1, pools]]), [], 1));
    const slots = sc.players[0]!.slots;
    expect(slots.map((s) => [s.biome, s.weight])).toEqual([
      ['island', 3],
      ['forest', 3],
    ]);
    const layout = halfLayout(slots, pack);
    const duals = dualsOf(sc, 1);
    expect(duals).toEqual({ 'forest+island': 2 });
    const seams = halfSeams(layout, pack, duals);
    expect(seams).toEqual([0, 0.14]);
    expect(halfSpans(layout, 1600, seams)).toEqual([
      { left: 0, width: 912 },
      { left: 688, width: 912 },
    ]);
    expect(seamCentre(layout, seams, 1, 1600, 1920)).toBeCloseTo(800, 6);
    const [p] = bridgePlacements(layout, pack, duals);
    expect(p).toMatchObject({ seamRatio: 0.14, scale: 1.4, width: 0.56, mirror: true });
    expect(p!.width * 1600).toBeCloseTo(896, 6);
    // Two more pools: the 0.18 cap; a fifth adds nothing.
    expect(halfSeams(layout, pack, { 'forest+island': 4 })[1]).toBe(0.18);
    expect(halfSeams(layout, pack, { 'forest+island': 5 })[1]).toBe(0.18);
    // On a phone (a half about square) the phone piece, 60% wide at the plain seam.
    expect(bridgePlacements(halfLayout([slot('island', 0, 1), slot('forest', 1, 1)], pack), pack, {}, { phone: phoneHalf(1.05) })[0]).toMatchObject({ phone: true, width: 0.6 });
  });
});
