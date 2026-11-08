/*
 * ForgeCoach — ambience/scenes.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.20, scenes (scenes.ts): the key, the file, the plan, the gates, the
 * hold, the caption and the storyboard. `testdata/scenes-sample.scenes.json`
 * is a two-scene sample in scenes-v1's shape, for the shape tests;
 * `testdata/scenes-v1.4.scenes.json` is the scenes-v1.4 tag's `scenes.json`
 * byte for byte (1563 scenes, 2026-11-08), hash-pinned at the end as the pairs
 * file is. Nothing here touches the network (fetchScenes and resolveScenery
 * are given fakes).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateManifest, type ScenePack } from './manifest.ts';
import { halfLayout } from './layout.ts';
import { pickFromSlots, type MakeupShowing } from './makeup.ts';
import type { Biome, SlotState } from './model.ts';
import { validatePairs, type PairsPack } from './pairs.ts';
import {
  PAIR_FULL_HOLD_MS,
  pairFullCaption,
  pairFullCutOutAllowed,
  pairFullExtrasAllowed,
  pairFullHold,
  pairFullPlan,
  pairFullSceneDrawn,
  pairFullThirdCutAllowed,
  planCandidates,
  sceneCandidates,
  type PairFullCandidate,
  type PairFullHold,
  type PairFullItem,
  type PairFullScene,
} from './pairfull.ts';
import { elementBiomes, halfCutOuts, phoneElementBiomes, planHalf } from './pieces.ts';
import { DEFAULT_PREFS, effectivePrefs, FORGECOACH_PACK_URL, FORGECOACH_PAIRS_FULL_URL, FORGECOACH_PAIRS_URL, FORGECOACH_SCENES_URL, pairsUrlOf, scenesUrlOf } from './prefs.ts';
import { resolveScenery, type FetchLike } from './pack.ts';
import { fetchScenes, MAX_SCENE_BYTES, MAX_SCENES_MANIFEST_BYTES, nearestScene, nearestWords, sceneFor, sceneKey, sceneKeyOf, scenePictures, scenesBytes, scenesManifestUrl, sceneWords, validateScenes, type ScenesPack } from './scenes.ts';
import { enumerateStates, SHAPES, storyboardHalf, type Shape, type StoryboardPacks } from './storyboard.ts';

const json = (f: string) => JSON.parse(readFileSync(new URL(`./testdata/${f}`, import.meta.url), 'utf8'));
const SAMPLE = json('scenes-sample.scenes.json');
const MANIFEST = `${FORGECOACH_SCENES_URL}scenes.json`;
const scenesPack = (): ScenesPack => {
  const r = validateScenes(SAMPLE, MANIFEST);
  expect(r.errors).toEqual([]);
  return r.scenes!;
};
const PACK: ScenePack = validateManifest(json('pack-v10.scenery.json'), `${FORGECOACH_PACK_URL}scenery.json`).pack!;
const PAIRS_FULL: PairsPack = validatePairs(json('pairs-v8.tag.pairs.json'), `${FORGECOACH_PAIRS_FULL_URL}pairs.json`).pairs!;
const PAIRS_OFF: PairsPack = validatePairs(json('pairs-v3.1.pairs.json'), `${FORGECOACH_PAIRS_URL}pairs.json`).pairs!;
const T = PACK.stageThresholds ?? [1, 2, 3, 4, 5, 6];

/** A slot as model.ts's tracker holds it (index = arrival order). */
const slot = (biome: Biome, index: number, weight: number): SlotState => ({ biome, index, weight, stage: Math.min(6, Math.max(1, Math.floor(weight))), peak: Math.min(6, Math.max(1, Math.floor(weight))) });
/** Slots in the arrival order given. */
const slotsOf = (...xs: [Biome, number][]) => xs.map(([b, w], i) => slot(b, i, w));

/** A fresh copy of the sample with one scene edited (`edit` gets the scene object) or re-keyed. */
function sampleWith(edit: (scenes: Record<string, any>) => void): unknown {
  const raw = JSON.parse(JSON.stringify(SAMPLE));
  edit(raw.scenes);
  return raw;
}
const one = (key: string, lands: { biome: string; stage: unknown }[], half: unknown = SAMPLE.scenes['island2+forest3+mountain2'].half) => ({ [key]: { lands, half } });

// ---------------------------------------------------------------------------

describe('spec 1.20: the key', () => {
  it('is the live biomes in the geography’s order, each with its stage, joined by +', () => {
    expect(sceneKey(slotsOf(['mountain', 2], ['island', 2], ['forest', 3]), T)).toBe('island2+forest3+mountain2');
    expect(sceneKey(slotsOf(['forest', 4]), T)).toBe('forest4');
    expect(sceneKey(slotsOf(['plains', 1], ['swamp', 1], ['island', 1]), T)).toBe('island1+swamp1+plains1');
  });

  it('does not depend on board order or arrival order: every permutation gives one key', () => {
    const lands: [Biome, number][] = [['island', 2], ['forest', 3], ['mountain', 2]];
    const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    for (const p of perms) expect(sceneKey(slotsOf(...p.map((i) => lands[i]!)), T)).toBe('island2+forest3+mountain2');
    // The order the scene's own lands are listed in does not matter either.
    expect(sceneKeyOf([{ biome: 'mountain', stage: 2 }, { biome: 'island', stage: 2 }, { biome: 'forest', stage: 3 }])).toBe('island2+forest3+mountain2');
  });

  it('gives a dual ½ to each colour, and a lone half-land is stage 1', () => {
    // One Island, one Forest, one island/forest dual: island 1.5, forest 1.5 -> stage 1 each on [1..6].
    expect(sceneKey(slotsOf(['island', 1.5], ['forest', 1.5]), T)).toBe('island1+forest1');
    // A lone dual: ½ each, rounded up to stage 1.
    expect(sceneKey(slotsOf(['swamp', 0.5], ['forest', 0.5]), T)).toBe('swamp1+forest1');
    // Two Forests and a forest/mountain dual beside two Islands: forest 2.5 (stage 2), mountain 0.5 (stage 1).
    expect(sceneKey(slotsOf(['island', 2], ['forest', 2.5], ['mountain', 0.5]), T)).toBe('island2+forest2+mountain1');
  });

  it('clamps the stage at 6, and uses the pack’s own thresholds (the default ones without)', () => {
    expect(sceneKey(slotsOf(['island', 9], ['swamp', 6]), T)).toBe('island6+swamp6');
    expect(sceneKey(slotsOf(['island', 12]), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe('island6');
    // The default thresholds [1, 2, 4, 6]: three lands are stage 2.
    expect(sceneKey(slotsOf(['island', 3]), null)).toBe('island2');
    expect(sceneKey(slotsOf(['island', 3]))).toBe('island2');
  });

  it('leaves out a withered slot, and has no key with no live slot or with a wastes slot', () => {
    expect(sceneKey([slot('island', 0, 2), { ...slot('swamp', 1, 0), stage: 0 }], T)).toBe('island2');
    expect(sceneKey([], T)).toBeNull();
    const withered: SlotState[] = [{ ...slot('island', 0, 0), stage: 0 }];
    expect(sceneKey(withered, T)).toBeNull();
    expect(sceneKey(slotsOf(['island', 2], ['wastes', 1]), T)).toBeNull();
  });

  it('sceneKeyOf refuses what no scene can be', () => {
    expect(sceneKeyOf([])).toBeNull();
    expect(sceneKeyOf([{ biome: 'wastes', stage: 1 }])).toBeNull();
    expect(sceneKeyOf([{ biome: 'island', stage: 0 }])).toBeNull();
    expect(sceneKeyOf([{ biome: 'island', stage: 7 }])).toBeNull();
    expect(sceneKeyOf([{ biome: 'island', stage: 1.5 }])).toBeNull();
    expect(sceneKeyOf([{ biome: 'island', stage: 1 }, { biome: 'island', stage: 2 }])).toBeNull();
  });
});

describe('spec 1.20: the scenes file', () => {
  it('reads the sample: two scenes, their pictures resolved against the file’s URL, a phone picture each', () => {
    const r = validateScenes(SAMPLE, MANIFEST);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    const s = r.scenes!;
    expect(s).toMatchObject({ schema: 1, spec: '1.20', name: 'scenes-v1', author: 'jalirkan', base: FORGECOACH_SCENES_URL });
    expect(Object.keys(s.scenes)).toEqual(['island2+forest3+mountain2', 'plains2+forest4+mountain2']);
    const a = s.scenes['island2+forest3+mountain2']!;
    expect(a.lands).toEqual([{ biome: 'island', stage: 2 }, { biome: 'forest', stage: 3 }, { biome: 'mountain', stage: 2 }]);
    expect(a.half).toMatchObject({ src: `${FORGECOACH_SCENES_URL}scenes/island2+forest3+mountain2/half.webp`, width: 2048, height: 640, subjectBand: [0.05, 0.95], horizon: 0.6, hour: 15, key: 'afternoon', focal: { x: 0.5, y: 0.55 }, safe: { x: 0, y: 0.3, w: 1, h: 0.4 }, bytes: 0 });
    expect(a.half.phone).toMatchObject({ src: `${FORGECOACH_SCENES_URL}scenes/island2+forest3+mountain2/phone.webp`, src2x: `${FORGECOACH_SCENES_URL}scenes/island2+forest3+mountain2/phone@2x.webp`, width: 1024, height: 1280, subjectBand: [0.25, 0.75], horizon: 0.6 });
    expect(sceneWords(a)).toBe('island 2, forest 3, mountain 2');
    expect(scenesBytes(s)).toBe(0);
  });

  it('refuses a key that does not match its lands (out of the geography’s order, or another stage)', () => {
    const lands = [{ biome: 'island', stage: 2 }, { biome: 'forest', stage: 3 }, { biome: 'mountain', stage: 2 }];
    for (const key of ['forest3+island2+mountain2', 'island2+forest4+mountain2', 'island2+forest3', 'island2+forest3+mountain2+swamp1', 'nonsense']) {
      const r = validateScenes(sampleWith((sc) => Object.assign(sc, one(key, lands))), MANIFEST);
      expect(r.errors, key).toEqual([`scenes.${key}: the key does not match its lands, which make "island2+forest3+mountain2" (each <biome><stage> in the order island, swamp, plains, forest, mountain, joined by +); scene refused`]);
      expect(Object.keys(r.scenes!.scenes)).toEqual(['island2+forest3+mountain2', 'plains2+forest4+mountain2']);
    }
  });

  it('refuses a biome outside the five', () => {
    for (const biome of ['wastes', 'desert', 'Island', 3]) {
      const r = validateScenes(sampleWith((sc) => Object.assign(sc, one('island2+x1', [{ biome: 'island', stage: 2 }, { biome: biome as string, stage: 1 }]))), MANIFEST);
      expect(r.errors, String(biome)).toHaveLength(1);
      expect(r.errors[0]).toMatch(/^scenes\.island2\+x1: lands\[1\]\.biome: ".*" is not one of the five \(island, swamp, plains, forest, mountain\); scene refused$/);
      expect(Object.keys(r.scenes!.scenes)).toHaveLength(2);
    }
  });

  it('refuses a stage outside 1–6 (or not a whole number)', () => {
    for (const stage of [0, 7, -1, 2.5, '2', null]) {
      const r = validateScenes(sampleWith((sc) => Object.assign(sc, one('island2', [{ biome: 'island', stage }]))), MANIFEST);
      expect(r.errors, String(stage)).toHaveLength(1);
      expect(r.errors[0]).toMatch(/^scenes\.island2: lands\[0\]\.stage: .* is not a whole stage 1–6; scene refused$/);
    }
  });

  it('refuses a scene without a phone picture, or with one that is unusable', () => {
    const half = { ...SAMPLE.scenes['island2+forest3+mountain2'].half };
    delete half.phone;
    let r = validateScenes(sampleWith((sc) => (sc['island2+forest3+mountain2'].half = half)), MANIFEST);
    expect(r.errors).toEqual(['scenes.island2+forest3+mountain2: half.phone: missing or unusable -- a scene must look right on a desktop and a phone; scene refused']);
    expect(Object.keys(r.scenes!.scenes)).toEqual(['plains2+forest4+mountain2']);
    r = validateScenes(sampleWith((sc) => (sc['island2+forest3+mountain2'].half.phone = { src: 'scenes/x/phone.gif' })), MANIFEST);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/^scenes\.island2\+forest3\+mountain2: half\.phone: missing or unusable \(.*phone\.src: expected \.webp, \.avif, \.png or \.jpg; picture dropped\) -- a scene must look right/);
    r = validateScenes(sampleWith((sc) => (sc['island2+forest3+mountain2'].half.phone = 'phone.webp')), MANIFEST);
    expect(r.errors[0]).toMatch(/half\.phone: missing or unusable/);
  });

  it('refuses the other wrong shapes: not an object, no lands, a biome twice, no half, an unusable half', () => {
    const cases: [string, unknown, RegExp][] = [
      ['island2', 'a string', /: not an object \{ lands, half \}; scene refused$/],
      ['island2', { half: SAMPLE.scenes['island2+forest3+mountain2'].half }, /: lands: a list of \{ biome, stage \}/],
      ['island2', { lands: [], half: SAMPLE.scenes['island2+forest3+mountain2'].half }, /: lands: a list of \{ biome, stage \}/],
      ['island2', { lands: ['island'], half: SAMPLE.scenes['island2+forest3+mountain2'].half }, /: lands\[0\]: not an object/],
      ['island2+island1', { lands: [{ biome: 'island', stage: 2 }, { biome: 'island', stage: 1 }], half: SAMPLE.scenes['island2+forest3+mountain2'].half }, /: lands\[1\]\.biome: island is named twice/],
      ['island2', { lands: [{ biome: 'island', stage: 2 }] }, /: half: missing/],
      ['island2', { lands: [{ biome: 'island', stage: 2 }], half: { src: 'javascript:alert', phone: { src: 'p.webp' } } }, /^scenes\.island2\.half\.src: the javascript: scheme is not allowed .*; picture dropped; scene refused$/],
    ];
    for (const [key, entry, re] of cases) {
      const r = validateScenes(sampleWith((sc) => (sc[key] = entry)), MANIFEST);
      expect(r.errors, JSON.stringify(entry)).toHaveLength(1);
      expect(r.errors[0]).toMatch(re);
      expect(Object.keys(r.scenes!.scenes)).toHaveLength(2);
    }
  });

  it('is an error and no scenes for a file that is not a scenes manifest', () => {
    expect(validateScenes(null, MANIFEST)).toEqual({ scenes: null, errors: ['The scenes manifest is not a JSON object.'], warnings: [] });
    expect(validateScenes([], MANIFEST).scenes).toBeNull();
    expect(validateScenes({ ...SAMPLE, schema: 2 }, MANIFEST).errors).toEqual(['schema: expected 1, found 2.']);
    expect(validateScenes({ ...SAMPLE, scenes: undefined }, MANIFEST).errors[0]).toMatch(/^scenes: missing/);
    expect(validateScenes(SAMPLE, 'file:///etc/scenes.json').errors[0]).toMatch(/must be http/);
    // An empty scenes object is a file with no scenes, not an error.
    expect(validateScenes({ ...SAMPLE, scenes: {} }, MANIFEST)).toMatchObject({ errors: [], warnings: [] });
  });

  it('warns on budgets and a newer spec, and keeps the scenes', () => {
    const big = validateScenes(sampleWith((sc) => (sc['island2+forest3+mountain2'].half.bytes = MAX_SCENE_BYTES + 1)), MANIFEST);
    expect(big.errors).toEqual([]);
    expect(big.warnings).toEqual(['scenes.island2+forest3+mountain2: 4.0 MB declared; a scene\'s budget is 4 MB (desktop and phone, 1x and 2x; kept)']);
    expect(Object.keys(big.scenes!.scenes)).toHaveLength(2);
    const huge = validateScenes(
      sampleWith((sc) => {
        sc['island2+forest3+mountain2'].half.bytes = 3e7;
        sc['plains2+forest4+mountain2'].half.bytes = 3e7;
      }),
      MANIFEST,
    );
    expect(huge.warnings.some((w) => /^scenes: 57\.2 MB declared in this pack's own folder/.test(w))).toBe(true);
    expect(validateScenes({ ...SAMPLE, spec: '1.21' }, MANIFEST).warnings).toEqual(['spec: the scenes are written for 1.21; this ForgeCoach reads 1.20, so newer fields are ignored']);
    expect(validateScenes({ ...SAMPLE, spec: 'two' }, MANIFEST).warnings).toEqual(['spec: "two" is not a 1.x version; ignored']);
  });

  it('is fetched beside the pack, never throwing: a missing or broken file is "no scenes"', async () => {
    expect(scenesManifestUrl(FORGECOACH_SCENES_URL)).toBe(MANIFEST);
    expect(scenesManifestUrl('https://example.org/x/my.json')).toBe('https://example.org/x/my.json');
    expect(scenesManifestUrl('ftp://example.org/')).toBeNull();
    const asked: string[] = [];
    const serve = (status: number, body: string): FetchLike => async (u) => {
      asked.push(u);
      return { ok: status === 200, status, text: async () => body };
    };
    const ok = await fetchScenes(FORGECOACH_SCENES_URL, { fetch: serve(200, JSON.stringify(SAMPLE)) });
    expect(asked).toEqual([MANIFEST]);
    expect(Object.keys(ok.scenes!.scenes)).toHaveLength(2);
    expect(await fetchScenes(FORGECOACH_SCENES_URL, { fetch: serve(404, '') })).toMatchObject({ scenes: null, errors: [`${MANIFEST} answered HTTP 404.`] });
    expect(await fetchScenes(FORGECOACH_SCENES_URL, { fetch: serve(200, '{nope') })).toMatchObject({ scenes: null, errors: ['The scenes manifest is not valid JSON.'] });
    expect(await fetchScenes(FORGECOACH_SCENES_URL, { fetch: async () => Promise.reject(new Error('offline')) })).toMatchObject({ scenes: null, errors: [`${MANIFEST} is unreachable.`] });
  });

  it('is loaded with ForgeCoach’s own pack, with the whole-half flag or without, and with no other pack', () => {
    expect(FORGECOACH_SCENES_URL).toBe('https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@scenes-v1.4/');
    expect(scenesUrlOf(DEFAULT_PREFS)).toBe(FORGECOACH_SCENES_URL);
    expect(scenesUrlOf({ ...DEFAULT_PREFS, pairFull: false })).toBe(FORGECOACH_SCENES_URL);
    expect(pairsUrlOf({ ...DEFAULT_PREFS, pairFull: false })).toBe(FORGECOACH_PAIRS_URL);
    expect(scenesUrlOf({ ...DEFAULT_PREFS, packUrl: 'http://127.0.0.1:8650/' })).toBeNull();
    expect(scenesUrlOf({ ...DEFAULT_PREFS, mode: 'procedural' })).toBeNull();
    expect(scenesUrlOf({ ...DEFAULT_PREFS, mode: 'off' })).toBeNull();
    // Spec 1.21: `?scenes=off` (or 0) loads none for the page -- the 1.15–1.19 halves, for checking them -- and nothing else
    // changes; `?scenes=on` is the default.
    expect(scenesUrlOf(effectivePrefs(DEFAULT_PREFS, '?scenes=off', ''))).toBeNull();
    expect(scenesUrlOf(effectivePrefs(DEFAULT_PREFS, '', '#ambience?scenes=0'))).toBeNull();
    expect(scenesUrlOf(effectivePrefs(DEFAULT_PREFS, '?scenes=on', ''))).toBe(FORGECOACH_SCENES_URL);
    expect(pairsUrlOf(effectivePrefs(DEFAULT_PREFS, '?scenes=off', ''))).toBe(FORGECOACH_PAIRS_FULL_URL);
    expect(effectivePrefs(DEFAULT_PREFS, '?scenes=on', '')).toBe(DEFAULT_PREFS);
  });

  it('resolveScenery carries the scenes as the pack’s `scenes`; a failed scenes file leaves the pack whole, with none', async () => {
    const pack = JSON.stringify(json('pack-v10.scenery.json'));
    const serve = (scenes: { status: number; body: string }): FetchLike => async (u) => {
      if (u.endsWith('scenery.json')) return { ok: true, status: 200, text: async () => pack };
      if (u.endsWith('scenes.json')) return { ok: scenes.status === 200, status: scenes.status, text: async () => scenes.body };
      return { ok: false, status: 404, text: async () => '' };
    };
    const load = async () => undefined;
    const quiet = { ...console };
    console.info = () => undefined;
    try {
      const got = (await resolveScenery(DEFAULT_PREFS, { fetch: serve({ status: 200, body: JSON.stringify(SAMPLE) }), load }))!;
      expect(got.source).toBe('pack');
      expect(Object.keys(got.pack!.scenes!.scenes)).toEqual(['island2+forest3+mountain2', 'plains2+forest4+mountain2']);
      const none = (await resolveScenery(DEFAULT_PREFS, { fetch: serve({ status: 404, body: '' }), load }))!;
      expect(none.source).toBe('pack');
      expect(none.pack!.scenes).toBeUndefined();
      expect(none.note).toBeNull();
    } finally {
      console.info = quiet.info;
    }
  });
});

// ---------------------------------------------------------------------------

const SCENES = scenesPack();
const ELEMENTS = elementBiomes(PACK.pieces);
const PHONE_ELEMENTS = phoneElementBiomes(PACK.pieces);
const planOf = (slots: SlotState[], o: { scenes?: ScenesPack | null; pairs?: PairsPack | null; narrow?: boolean; showing?: MakeupShowing | null } = {}) =>
  pairFullPlan(halfLayout(slots, PACK, null, o.showing ?? null), o.pairs === undefined ? PAIRS_FULL : o.pairs, { thresholds: T, elements: ELEMENTS, phoneElements: PHONE_ELEMENTS, showing: o.showing ?? null, slots, narrow: o.narrow ?? false, scenes: o.scenes === undefined ? SCENES : o.scenes, biomes: PACK.biomes });
const sceneOf = (plan: PairFullItem[] | null) => plan?.find((x): x is PairFullScene => x.kind === 'scene') ?? null;

/** The two sample states, in board orders that are not the geography's. */
const STATE_A = slotsOf(['mountain', 2], ['forest', 3], ['island', 2]);
const STATE_B = slotsOf(['forest', 4], ['plains', 2], ['mountain', 2]);

describe('spec 1.20: the plan', () => {
  it('is the scene alone for each sample state, before any pair logic, at a desktop and on a phone', () => {
    for (const [slots, key] of [[STATE_A, 'island2+forest3+mountain2'], [STATE_B, 'plains2+forest4+mountain2']] as const)
      for (const narrow of [false, true]) {
        const plan = planOf(slots, { narrow });
        expect(plan).toEqual([{ kind: 'scene', key, scene: SCENES.scenes[key], share: 1 }]);
        // No pair, no element, no extras, no panel.
        expect(plan!.some((x) => x.kind !== 'scene')).toBe(false);
      }
  });

  it('wins without a pairs pack (the board with `?pairfull=0`) and whatever the showing memory says', () => {
    expect(sceneOf(planOf(STATE_A, { pairs: null }))?.key).toBe('island2+forest3+mountain2');
    const showing = pickFromSlots(slotsOf(['island', 2], ['mountain', 2]));
    expect(sceneOf(planOf(STATE_A, { showing }))?.key).toBe('island2+forest3+mountain2');
  });

  it('spec 1.21: a state with no scene of its own draws its nearest, alone (one more Swamp; a stage off by one; two colours); no scenes at all is the old plan', () => {
    // [slots, the key drawn, the key asked for, dropped, clamped, mono]
    const cases: [SlotState[], string, string, Biome[], { biome: Biome; from: number; to: number }[], boolean][] = [
      [[...STATE_A, slot('swamp', 3, 1)], 'island2+forest3+mountain2', 'island2+swamp1+forest3+mountain2', ['swamp'], [], false],
      [slotsOf(['mountain', 2], ['forest', 4], ['island', 2]), 'island2+forest3+mountain2', 'island2+forest4+mountain2', [], [{ biome: 'forest', from: 4, to: 3 }], false],
      // The sample has no pair: the lighter colour is dropped and the forest's own picture is drawn as a scene.
      [slotsOf(['island', 2], ['forest', 3]), 'forest3', 'island2+forest3', ['island'], [], true],
    ];
    for (const [slots, key, asked, dropped, clamped, mono] of cases)
      for (const pairs of [PAIRS_FULL, null]) {
        const plan = planOf(slots, { pairs });
        expect(plan).toHaveLength(1);
        expect(sceneOf(plan)).toMatchObject({ kind: 'scene', key, share: 1, nearest: { for: asked, dropped, clamped, mono } });
      }
    // The forest's own picture is the pack's stage-3 half, phone and all.
    expect(sceneOf(planOf(cases[2]![0]))!.scene.half).toMatchObject({ src: PACK.biomes.forest!.stages[2]!.half!.src, phone: PACK.biomes.forest!.stages[2]!.half!.phone });
    // An exact scene carries no `nearest`.
    expect(sceneOf(planOf(STATE_A))!.nearest).toBeUndefined();
    // One colour: today's picture, not a scene state.
    expect(planOf(slotsOf(['forest', 3]))).toEqual(planOf(slotsOf(['forest', 3]), { scenes: null }));
    // No scenes at all: the old plan, unchanged.
    expect(sceneOf(planOf(STATE_A, { scenes: null }))).toBeNull();
    expect(planOf([...STATE_A, slot('swamp', 3, 1)], { scenes: null, pairs: null })).toBeNull();
  });

  it('gives a scene whose chosen painting failed back to today’s plan (the plan with no scenes), at the shape it draws -- spec 1.21: with the pack’s biomes, to the heaviest colour’s own picture first', () => {
    const a = SCENES.scenes['island2+forest3+mountain2']!;
    const failed = (bad: string) => (src: string) => src === bad;
    // Spec 1.21: given the pack's biomes, the failed painting gives way to the forest's own picture, as a scene.
    for (const narrow of [false, true]) {
      const viaMono = pairFullPlan(halfLayout(STATE_A, PACK), PAIRS_FULL, { thresholds: T, elements: ELEMENTS, slots: STATE_A, narrow, scenes: SCENES, biomes: PACK.biomes, sceneFailed: failed(narrow ? a.half.phone.src : a.half.src) });
      expect(sceneOf(viaMono)).toMatchObject({ key: 'forest3', nearest: { for: 'island2+forest3+mountain2', dropped: ['mountain', 'island'], clamped: [], mono: true } });
      const forest = PACK.biomes.forest!.stages[2]!.half!;
      const both = (src: string) => src === a.half.src || src === a.half.phone.src || src === forest.src || src === forest.phone!.src;
      expect(pairFullPlan(halfLayout(STATE_A, PACK), PAIRS_FULL, { thresholds: T, elements: ELEMENTS, phoneElements: PHONE_ELEMENTS, slots: STATE_A, narrow, scenes: SCENES, biomes: PACK.biomes, sceneFailed: both })).toEqual(planOf(STATE_A, { scenes: null, narrow }));
    }
    // Without the biomes (a caller with no pack), 1.20's rule: today's plan.
    const plan = (narrow: boolean, bad: string, halfAspect: number | null = null) =>
      pairFullPlan(halfLayout(STATE_A, PACK), PAIRS_FULL, { thresholds: T, elements: ELEMENTS, phoneElements: PHONE_ELEMENTS, slots: STATE_A, narrow, scenes: SCENES, sceneFailed: failed(bad), halfAspect });
    for (const narrow of [false, true]) {
      const today = planOf(STATE_A, { scenes: null, narrow });
      expect(sceneOf(today)).toBeNull();
      expect(today!.some((x) => x.kind === 'pair')).toBe(true);
      // The picture this shape draws failed: today's plan, exactly.
      expect(plan(narrow, narrow ? a.half.phone.src : a.half.src)).toEqual(today);
      // The other shape's picture failed: the scene stands.
      expect(sceneOf(plan(narrow, narrow ? a.half.src : a.half.phone.src))?.key).toBe(a.key);
    }
    // A phone-shaped half on a desktop draws the phone painting, so its failure is the one that counts.
    expect(sceneOf(plan(false, a.half.phone.src, 0.8))).toBeNull();
    expect(sceneOf(plan(false, a.half.src, 0.8))?.key).toBe(a.key);
    // Without the flag (no pairs): no scene, no plan -- the half as today without the flag.
    expect(pairFullPlan(halfLayout(STATE_A, PACK), null, { thresholds: T, slots: STATE_A, scenes: SCENES, sceneFailed: failed(a.half.src) })).toBeNull();
  });

  it('leaves the showing memory as it was: after a scene, the pair rule continues from its own last pick', () => {
    // Played land by land, the memory folded as MakeupMemory folds it (pickFromSlots of each state with the last pick).
    const seq: SlotState[][] = [slotsOf(['island', 1]), slotsOf(['island', 2]), slotsOf(['island', 2], ['forest', 1]), slotsOf(['island', 2], ['forest', 2]), slotsOf(['island', 2], ['forest', 3]), slotsOf(['island', 2], ['forest', 3], ['mountain', 1]), slotsOf(['island', 2], ['forest', 3], ['mountain', 2]), slotsOf(['island', 2], ['forest', 3], ['mountain', 2], ['swamp', 1])];
    let memory: MakeupShowing | null = null;
    const plans: (PairFullItem[] | null)[] = [];
    const memories: (MakeupShowing | null)[] = [];
    for (const slots of seq) {
      const pick = pickFromSlots(slots, memory);
      memory = pick.kept.length ? pick : null;
      memories.push(memory);
      plans.push(planOf(slots, { showing: memory }));
    }
    expect(sceneOf(plans[6]!)?.key).toBe('island2+forest3+mountain2');
    // The memory at the scene is the pair rule's pick (island+forest), not the scene's three colours.
    expect([...memories[6]!.pair!].sort()).toEqual(['G', 'U']);
    // The fourth colour, no scene for it: spec 1.21, its nearest (this scene, the Swamp dropped) -- and the memory went on
    // folding the pair rule under it, so with the scenes gone the board draws the pair it would have shown all along.
    expect(sceneOf(plans[7]!)).toMatchObject({ key: 'island2+forest3+mountain2', nearest: { for: 'island2+swamp1+forest3+mountain2', dropped: ['swamp'] } });
    expect([...memories[7]!.pair!].sort()).toEqual(['G', 'U']);
    expect(planOf(seq[7]!, { showing: memories[7]!, scenes: null })!.find((x) => x.kind === 'pair')).toMatchObject({ key: 'forest+island' });
  });
});

describe('spec 1.20: the picture, the gates and the hold', () => {
  const plan = planOf(STATE_A)!;
  const s = sceneOf(plan)!;

  it('draws the desktop painting on a desktop and the phone painting on a phone (or a phone-shaped panel), never mirrored', () => {
    const desk = sceneCandidates(s, 5, false);
    expect(desk).toHaveLength(1);
    expect(desk[0]).toMatchObject({ painted: null, mirror: false, scene: 'island2+forest3+mountain2' });
    expect(desk[0]!.art.picture!.src).toBe(s.scene.half.src);
    expect(desk[0]!.art.source).toBe('half');
    // A phone-width screen: the phone picture whatever the panel's shape (layout.ts pickHalfPicture), as a cell's.
    expect(sceneCandidates(s, 2.1, true)[0]!.art.picture!.src).toBe(s.scene.half.phone.src);
    // A phone-shaped panel on a desktop: the phone picture by the shape rule.
    expect(sceneCandidates(s, 0.8, false)[0]!.art.picture!.src).toBe(s.scene.half.phone.src);
    // One horizon: the horizon pinned as every panel's.
    expect(sceneCandidates(s, 5, false, true)[0]!.art).toMatchObject({ focal: { x: 0.5, y: 0.6 }, focalTo: 0.43 });
    expect(planCandidates(plan, 5, false)).toEqual(desk);
  });

  it('draws no cut-out, no extra and no third’s cut-out over a scene, shown or loading', () => {
    const [cand] = sceneCandidates(s, 5, false) as [PairFullCandidate];
    for (const choice of [{ show: cand, want: cand }, { show: null, want: cand }]) {
      expect(pairFullCutOutAllowed(choice)).toBe(false);
      expect(pairFullExtrasAllowed(s, choice)).toBe(false);
      expect(pairFullThirdCutAllowed(s, choice)).toBe(false);
      expect(pairFullSceneDrawn(plan, choice)).toBe(true);
      const pick = pickFromSlots(STATE_A);
      expect(halfCutOuts({ plan: planHalf({ makeup: pick.makeup, showing: pick }), pieces: PACK.pieces ?? null, phone: false, narrow: false, full: plan, choice })).toEqual([]);
    }
    // The scene's picture failed: the strip draws the panels, and the panels' pieces stand on them as ever.
    const failed = { show: null, want: null };
    expect(pairFullSceneDrawn(plan, failed)).toBe(false);
    const four = [...STATE_A, slot('swamp', 3, 1)];
    const pick = pickFromSlots(four);
    expect(halfCutOuts({ plan: planHalf({ makeup: pick.makeup, showing: pick }), pieces: PACK.pieces ?? null, phone: false, narrow: false, full: plan, choice: failed }).length).toBeGreaterThan(0);
  });

  it('holds what the half drew while the scene loads (PAIR_FULL_HOLD_MS at most), and holds the scene while the next picture loads', () => {
    const [cand] = sceneCandidates(s, 5, false) as [PairFullCandidate];
    const before = planOf(slotsOf(['island', 2], ['forest', 3]))!;
    const beforeCand = planCandidates(before, 5, false)![0]!;
    // The pair on screen.
    let hold: PairFullHold<string> = { last: null, since: null };
    let r = pairFullHold({ layout: 'L1', plan: before, choice: { show: beforeCand, want: beforeCand } }, hold, 0);
    hold = r.hold;
    // The Mountains arrive: the scene wanted, not loaded -- the pair is held.
    r = pairFullHold({ layout: 'L2', plan, choice: { show: null, want: cand } }, hold, 100);
    expect(r).toMatchObject({ holding: true, draw: { layout: 'L1', plan: before, shown: beforeCand } });
    hold = r.hold;
    // Past the hold: the panels (no plan), never blank.
    expect(pairFullHold({ layout: 'L2', plan, choice: { show: null, want: cand } }, hold, 100 + PAIR_FULL_HOLD_MS).draw).toMatchObject({ layout: 'L2', plan: null, shown: null });
    // Loaded: the scene.
    r = pairFullHold({ layout: 'L2', plan, choice: { show: cand, want: cand } }, hold, 200);
    expect(r).toMatchObject({ holding: false, draw: { plan, shown: cand } });
    hold = r.hold;
    // The plan moves on to the pair (a Swamp, planned with no scenes: since spec 1.21 only a half whose every scene
    // picture failed gets here), its cell wanted and not loaded, its warm panorama ready -- the scene is held, not the panorama.
    const after = planOf([...STATE_A, slot('swamp', 3, 1)], { showing: pickFromSlots(STATE_A), scenes: null })!;
    const cands = planCandidates(after, 5, false)!;
    const warm = cands[cands.length - 1]!;
    expect(cands[0]).not.toBe(warm);
    r = pairFullHold({ layout: 'L3', plan: after, choice: { show: warm, want: cands[0]! } }, hold, 300);
    expect(r).toMatchObject({ holding: true, draw: { plan, shown: cand } });
  });
});

describe('spec 1.20: the caption and the storyboard', () => {
  it('captions a scene “Scene · island 2, forest 3, mountain 2 — one painting”', () => {
    expect(pairFullCaption(planOf(STATE_A))).toBe('Scene · island 2, forest 3, mountain 2 — one painting');
    expect(pairFullCaption(planOf(STATE_B, { pairs: null }))).toBe('Scene · plains 2, forest 4, mountain 2 — one painting');
  });

  const PACKS: StoryboardPacks = { pack: PACK, pairsOff: PAIRS_OFF, pairsFull: PAIRS_FULL, scenes: SCENES };
  const NO_SCENES: StoryboardPacks = { ...PACKS, scenes: null };
  const combos: { shape: Shape; pairfull: boolean }[] = (['desktop', 'phone'] as const).flatMap((shape) => [false, true].map((pairfull) => ({ shape, pairfull })));

  it('makes every colour of a scene visible (the scene names it), with nothing over it, at both shapes, with the flag and without', () => {
    for (const [counts, arrival, key] of [[{ U: 2, G: 3, R: 2 }, ['R', 'G', 'U'], 'island2+forest3+mountain2'], [{ W: 2, G: 4, R: 2 }, ['G', 'W', 'R'], 'plains2+forest4+mountain2']] as const)
      for (const c of combos) {
        const h = storyboardHalf({ counts, duals: [], arrival }, c.shape, c.pairfull, PACKS);
        expect(h.drawn.map((d) => d.kind), `${key} ${c.shape} ${c.pairfull}`).toEqual(['scene']);
        expect(h.drawn[0]!.what).toBe(`scene ${key} [${c.shape === 'phone' ? 'phone' : 'half'}]`);
        expect([...h.visible].sort()).toEqual([...h.colours].sort());
        expect(h.invisible).toEqual([]);
        expect(h.picturePair).toBeNull();
        expect(h.caption).toBe(`Scene · ${SCENES.scenes[key]!.lands.map((l) => `${l.biome} ${l.stage}`).join(', ')} — one painting`);
        expect([...h.captionNames].sort()).toEqual([...h.colours].sort());
      }
    // A shape's half is ~2.1 : 1 on the phone: the walk's phone shape is phone-width, so the phone painting.
    expect(SHAPES.phone.narrow).toBe(true);
  });

  it('walks every state of 0–3 lands a colour (and a dual) with the sample scenes: every colour on screen or named not painted yet, honest captions, every state of two or more colours a scene (spec 1.21), every state of one drawn as without scenes', { timeout: 120_000 }, () => {
    let exact = 0;
    for (const { state } of enumerateStates({ max: 3, duals: true, dualMax: 2 }))
      for (const c of combos) {
        const h = storyboardHalf(state, c.shape, c.pairfull, PACKS);
        expect(h.invisible.filter((x) => x.reason !== 'not-painted'), JSON.stringify(state)).toEqual([]);
        const notPainted = h.invisible.map((x) => x.colour);
        if (h.caption) {
          expect(h.captionNames.filter((x) => !h.visible.includes(x) && !notPainted.includes(x)), h.caption).toEqual([]);
          expect(h.visible.filter((x) => !h.captionNames.includes(x)), h.caption).toEqual([]);
        }
        const scene = h.drawn.find((d) => d.kind === 'scene');
        if (h.colours.length >= 2) {
          expect(h.drawn.map((d) => d.kind), JSON.stringify(state)).toEqual(['scene']);
          if (!scene!.what.includes(' for ')) exact++;
          continue;
        }
        const without = storyboardHalf(state, c.shape, c.pairfull, NO_SCENES);
        expect(h).toEqual(without);
      }
    // Each sample state is reached with max 3 in every order walked, at four combos; the A state also with a dual.
    expect(exact).toBeGreaterThanOrEqual(8);
  });

  it('warms each half’s scene and those one land away, at the shape it draws', () => {
    const near = slotsOf(['island', 2], ['forest', 3], ['mountain', 1]);
    expect(scenePictures(SCENES, [near], { phone: false, thresholds: T })).toEqual([{ src: SCENES.scenes['island2+forest3+mountain2']!.half.src, src2x: SCENES.scenes['island2+forest3+mountain2']!.half.src2x }]);
    expect(scenePictures(SCENES, [STATE_A], { phone: true, thresholds: T }).map((x) => x.src)).toEqual([SCENES.scenes['island2+forest3+mountain2']!.half.phone.src]);
    expect(scenePictures(SCENES, [slotsOf(['swamp', 4])], { phone: false, thresholds: T })).toEqual([]);
    expect(scenePictures(null, [STATE_A], { phone: false })).toEqual([]);
    expect(sceneFor(SCENES, STATE_B, T)?.key).toBe('plains2+forest4+mountain2');
  });
});

describe('the scenes-v1.4 tag (2026-11-08)', () => {
  const bytes = readFileSync(new URL('./testdata/scenes-v1.4.scenes.json', import.meta.url));
  it('is the file jsDelivr serves byte for byte', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('ec5372d7348a79bbbf99a7622a5b4346a8d4701eb7baa61126a5eb6e81253060');
    expect(bytes.length).toBe(2_594_290);
  });
  it('holds 1563 scenes (thirty regions at forty region tags, and three of the first drafts), every one with a phone picture, and validates clean', () => {
    const r = validateScenes(JSON.parse(bytes.toString('utf8')), `${FORGECOACH_SCENES_URL}scenes.json`);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    const keys = Object.keys(r.scenes!.scenes ?? r.scenes!);
    expect(keys.length).toBe(1563);
    const raw = JSON.parse(bytes.toString('utf8')) as { scenes: Record<string, { region?: string }> };
    const byRegion = new Map<string, number>();
    for (const sc of Object.values(raw.scenes)) byRegion.set(sc.region ?? '', (byRegion.get(sc.region ?? '') ?? 0) + 1);
    expect(Object.fromEntries(byRegion)).toEqual({
      '': 3,
      amazon: 64, 'amazon-steppe': 64, anatolia: 64, 'anatolia-marsh': 64, cascades: 64, 'cascades-bog': 64, patagonia: 64, 'patagonia-forest': 64, santorini: 64, 'santorini-steppe': 64,
      'amazon-volcano': 52, 'anatolia-coast': 52, kamchatka: 52, 'kamchatka-steppe': 52, mesopotamia: 52, polynesia: 52, 'polynesia-steppe': 52, 'polynesia-volcano': 52, serengeti: 52, 'serengeti-crag': 52,
      'cascades-steppe': 40, 'kamchatka-forest': 40, 'mesopotamia-forest': 40, 'mesopotamia-volcano': 40, 'nile-delta': 40, 'nile-delta-crag': 40, 'nile-delta-grove': 40, 'patagonia-crag': 40, 'santorini-forest': 40, 'serengeti-coast': 40,
    });
    expect(keys).toContain('island2+forest3+mountain2');
    expect(keys).toContain('swamp4+plains4+forest4');
  });
  it('fetchScenes reads it (past the 1 MB a scenes manifest could be until 2026-11-08, under the 4 MB it may be); a manifest past 4 MB is still refused unread', async () => {
    expect(bytes.length).toBeGreaterThan(1024 * 1024);
    expect(MAX_SCENES_MANIFEST_BYTES).toBe(4 * 1024 * 1024);
    expect(bytes.length).toBeLessThan(MAX_SCENES_MANIFEST_BYTES);
    const serve = (text: string) => async () => ({ ok: true, status: 200, text: async () => text });
    const ok = await fetchScenes(FORGECOACH_SCENES_URL, { fetch: serve(bytes.toString('utf8')) });
    expect(ok.errors).toEqual([]);
    expect(Object.keys(ok.scenes!.scenes).length).toBe(1563);
    const big = await fetchScenes(FORGECOACH_SCENES_URL, { fetch: serve(' '.repeat(MAX_SCENES_MANIFEST_BYTES + 1)) });
    expect(big.scenes).toBeNull();
    expect(big.errors).toEqual(['The scenes manifest is over 4 MB.']);
  });
});

// ---------------------------------------------------------------------------
// Spec 1.21, the nearest scene (2026-11-08)

describe('spec 1.21: the nearest scene on scenes-v1.4', () => {
  const V14 = validateScenes(json('scenes-v1.4.scenes.json'), `${FORGECOACH_SCENES_URL}scenes.json`).scenes!;
  const lands = (key: string) => key.split('+').map((k) => ({ biome: k.replace(/\d$/, '') as Biome, stage: Number(k.slice(-1)) }));
  const near = (key: string, scenes: ScenesPack = V14) => nearestScene(scenes, lands(key), PACK.biomes);
  // the state asked for, the key drawn, the colours dropped (in the order dropped), the colours clamped (biome:from>to), mono
  const TABLE: [string, string, string[], string[], boolean][] = [
    // The owner's screenshot (2026-11-08): one of each, no scene -- the same colours, the mountain one stage up (the
    // three candidates one stage away are tied; the heavier colours, island then swamp, keep their stage).
    ['island1+swamp1+mountain1', 'island1+swamp1+mountain2', [], ['mountain:1>2'], false],
    // Two colours: no pair has a scene at v1.4, so the lighter is dropped (a tie: the later in the geography) and the
    // heavier's own picture is drawn alone. A pair scene painted (v1.5) resolves to itself: below.
    ['island6+swamp6', 'island6', ['swamp'], [], true],
    ['island1+swamp1', 'island1', ['swamp'], [], true],
    ['swamp3+forest3', 'swamp3', ['forest'], [], true],
    ['forest4+mountain2', 'forest4', ['mountain'], [], true],
    ['island1+mountain5', 'mountain5', ['island'], [], true],
    // Three colours with a scene of their own: exact.
    ['island1+swamp1+plains1', 'island1+swamp1+plains1', [], [], false],
    ['island2+forest3+mountain2', 'island2+forest3+mountain2', [], [], false],
    ['island6+plains1+mountain1', 'island6+plains1+mountain1', [], [], false],
    ['island3+swamp2+mountain6', 'island3+swamp2+mountain6', [], [], false],
    // Three colours, no scene: the nearest stages. At an even tie the lighter of the tied colours moves, and down
    // rather than up.
    ['island1+plains1+mountain1', 'island1+plains1+mountain2', [], ['mountain:1>2'], false],
    ['island2+swamp2+mountain2', 'island2+swamp2+mountain1', [], ['mountain:2>1'], false],
    ['island3+swamp3+mountain3', 'island3+swamp3+mountain2', [], ['mountain:3>2'], false],
    ['island4+swamp4+mountain4', 'island4+swamp4+mountain3', [], ['mountain:4>3'], false],
    ['island1+swamp6+mountain6', 'island1+swamp6+mountain5', [], ['mountain:6>5'], false],
    ['island6+swamp6+mountain6', 'island6+swamp5+mountain1', [], ['swamp:6>5', 'mountain:6>1'], false],
    ['plains6+forest6+mountain6', 'plains6+forest5+mountain1', [], ['forest:6>5', 'mountain:6>1'], false],
    // Four colours: no four-colour scene, so the lightest is dropped, then step 1 on the three left.
    ['island1+swamp1+plains1+mountain1', 'island1+swamp1+plains1', ['mountain'], [], false],
    ['island2+swamp2+forest3+mountain2', 'island2+swamp2+forest3', ['mountain'], [], false],
    ['swamp1+plains1+forest1+mountain1', 'swamp1+plains1+forest2', ['mountain'], ['forest:1>2'], false],
    ['island2+swamp1+forest3+mountain2', 'island2+forest3+mountain2', ['swamp'], [], false],
    // Five colours: the two lightest dropped.
    ['island1+swamp1+plains1+forest1+mountain1', 'island1+swamp1+plains1', ['mountain', 'forest'], [], false],
    ['island2+swamp2+plains2+forest3+mountain3', 'island2+forest3+mountain3', ['plains', 'swamp'], [], false],
    ['island6+swamp6+plains6+forest6+mountain6', 'island6+swamp5+plains1', ['mountain', 'forest'], ['swamp:6>5', 'plains:6>1'], false],
  ];
  for (const [asked, drawn, dropped, clamped, mono] of TABLE)
    it(`${asked} → ${drawn}`, () => {
      const n = near(asked)!;
      expect(n.for).toBe(asked);
      expect(n.key).toBe(drawn);
      expect(n.scene.key).toBe(drawn);
      expect(n.dropped).toEqual(dropped);
      expect(n.clamped.map((c) => `${c.biome}:${c.from}>${c.to}`)).toEqual(clamped);
      expect(n.mono).toBe(mono);
      // A painted scene is the manifest's own; the pack's own picture is the colour's 1.5 half at its stage.
      if (!mono) expect(n.scene).toBe(V14.scenes[drawn]);
      else expect(n.scene.half.src).toBe(PACK.biomes[n.scene.lands[0]!.biome]!.stages[n.scene.lands[0]!.stage - 1]!.half!.src);
      // Deterministic: the same answer from the lands in any order.
      expect(nearestScene(V14, [...lands(asked)].reverse(), PACK.biomes)!.key).toBe(drawn);
    });

  it('the owner’s caption: the state, the painting drawn and why', () => {
    expect(nearestWords(near('island1+swamp1+mountain1')!)).toBe('Scene · island 1, swamp 1, mountain 1 — nearest painting: island 1, swamp 1, mountain 2 (mountain not yet painted at this stage)');
    expect(nearestWords(near('island6+swamp6')!)).toBe('Scene · island 6, swamp 6 — nearest painting: island 6 alone (swamp not yet painted in)');
    expect(nearestWords(near('swamp1+plains1+forest1+mountain1')!)).toBe('Scene · swamp 1, plains 1, forest 1, mountain 1 — nearest painting: swamp 1, plains 1, forest 2 (mountain not yet painted in; forest not yet painted at this stage)');
    expect(nearestWords(near('island6+swamp6+mountain6')!)).toBe('Scene · island 6, swamp 6, mountain 6 — nearest painting: island 6, swamp 5, mountain 1 (swamp and mountain not yet painted at these stages)');
  });

  it('one colour is not a scene state: no nearest, today’s single-colour picture (unless a scene of it is painted)', () => {
    expect(near('island1')).toBeNull();
    expect(near('forest6')).toBeNull();
    expect(nearestScene(V14, [], PACK.biomes)).toBeNull();
    expect(nearestScene(null, lands('island1+swamp1+mountain1'), PACK.biomes)).toBeNull();
  });

  it('a pair scene painted (scenes-v1.5) resolves a pair to itself; a three-colour state still prefers its own colour set', () => {
    const half = SAMPLE.scenes['island2+forest3+mountain2'].half;
    const raw = JSON.parse(JSON.stringify(json('scenes-v1.4.scenes.json')));
    raw.scenes['island6+swamp6'] = { lands: [{ biome: 'island', stage: 6 }, { biome: 'swamp', stage: 6 }], half };
    raw.scenes['island5+swamp6'] = { lands: [{ biome: 'island', stage: 5 }, { biome: 'swamp', stage: 6 }], half };
    const v15 = validateScenes(raw, MANIFEST).scenes!;
    expect(near('island6+swamp6', v15)).toMatchObject({ key: 'island6+swamp6', dropped: [], clamped: [], mono: false });
    // A pair state with no scene of its own, beside a painted pair of the same colours: the nearest pair, not one colour.
    expect(near('island4+swamp6', v15)).toMatchObject({ key: 'island5+swamp6', dropped: [], clamped: [{ biome: 'island', from: 4, to: 5 }], mono: false });
    expect(near('island1+swamp1+mountain1', v15)!.key).toBe('island1+swamp1+mountain2');
  });

  it('without the pack’s biomes, a state the rule takes down to one colour has no nearest (the board then keeps today’s plan)', () => {
    expect(nearestScene(V14, lands('island6+swamp6'), null)).toBeNull();
    expect(nearestScene(V14, lands('island1+swamp1+mountain1'), null)!.key).toBe('island1+swamp1+mountain2');
  });

  it('the tie rules, on a hand-made file: the heavier colours keep their stage, then down rather than up, then the key', () => {
    const half = SAMPLE.scenes['island2+forest3+mountain2'].half;
    const make = (...keys: string[]) => validateScenes({ schema: 1, scenes: Object.fromEntries(keys.map((k) => [k, { lands: lands(k), half }])) }, MANIFEST).scenes!;
    // island 3, forest 3: both one stage away; the forest is the lighter at equal stages (later in the geography), so it moves.
    expect(nearestScene(make('island2+forest3+mountain1', 'island3+forest2+mountain1'), lands('island3+forest3+mountain1'))!.key).toBe('island3+forest2+mountain1');
    // The heavier colour by stage keeps it, whatever the geography.
    expect(nearestScene(make('island1+forest4+mountain1', 'island2+forest3+mountain1'), lands('island2+forest4+mountain1'))!.key).toBe('island1+forest4+mountain1');
    // One colour one stage either way: down.
    expect(nearestScene(make('island2+forest4+mountain1', 'island4+forest4+mountain1'), lands('island3+forest4+mountain1'))!.key).toBe('island2+forest4+mountain1');
    // Distance first: a scene two stages from the heavier colour loses to one a stage from the lighter.
    expect(nearestScene(make('island1+forest1+mountain1', 'island3+forest3+mountain2'), lands('island3+forest3+mountain1'))!.key).toBe('island3+forest3+mountain2');
  });

  it('warms the scene a state with none would draw (its nearest), and the pack’s own picture of one colour', () => {
    const owner = slotsOf(['mountain', 1], ['island', 1], ['swamp', 1]);
    const srcs = scenePictures(V14, [owner], { phone: false, thresholds: T, biomes: PACK.biomes }).map((x) => x.src);
    expect(srcs[0]).toBe(V14.scenes['island1+swamp1+mountain2']!.half.src);
    const pair = scenePictures(V14, [slotsOf(['island', 6], ['swamp', 6])], { phone: true, thresholds: T, biomes: PACK.biomes }).map((x) => x.src);
    expect(pair[0]).toBe(PACK.biomes.island!.stages[5]!.half!.phone!.src);
  });
});
