/*
 * ForgeCoach — ambience/places.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.22, places (places.ts): the key, the file, the composition, the plan's
 * precedence, the load gate and hold, the caption, the piece fade's state and
 * the loader. `synthPlaces()` builds a places manifest in places-v1's shape for
 * all 31 colour sets with relative URLs (the shape tests); the real tagged file
 * is `testdata/places-v1.places.json`, hash-pinned in places-v1.test.ts.
 * Nothing here touches the network.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateManifest, type ScenePack } from './manifest.ts';
import { halfLayout } from './layout.ts';
import type { Biome, SlotState } from './model.ts';
import { GEOGRAPHY, validatePairs, type PairsPack } from './pairs.ts';
import {
  PAIR_FULL_HOLD_MS,
  pairFullCaption,
  pairFullChoice,
  pairFullCutOutAllowed,
  pairFullHold,
  pairFullPlan,
  pairFullSceneDrawn,
  planCandidates,
  type PairFullCandidate,
  type PairFullHold,
  type PairFullItem,
  type PairFullScene,
} from './pairfull.ts';
import { elementBiomes, halfCutOuts, makeupFromSlots, phoneElementBiomes, planHalf } from './pieces.ts';
import { DEFAULT_PREFS, effectivePrefs, FORGECOACH_PACK_URL, FORGECOACH_PAIRS_FULL_URL, FORGECOACH_PLACES_URL, FORGECOACH_SCENES_URL, placesUrlOf, scenesUrlOf } from './prefs.ts';
import { resolveScenery, type FetchLike } from './pack.ts';
import { validateScenes } from './scenes.ts';
import {
  fetchPlaces,
  MAX_PLACES_MANIFEST_BYTES,
  nextPlacePieces,
  pieceSettleIn,
  pieceSettleOut,
  pieceWant,
  placeFor,
  placeForSlots,
  placeKeyOf,
  placePieces,
  placesManifestUrl,
  placeWords,
  validatePlaces,
  type PlacePiece,
  type PlacesPack,
} from './places.ts';

import { colourSets, synthPlaces } from './testdata/placesSynth.ts';

const json = (f: string) => JSON.parse(readFileSync(new URL(`./testdata/${f}`, import.meta.url), 'utf8'));
const MANIFEST = `${FORGECOACH_PLACES_URL}places.json`;
const PACK: ScenePack = validateManifest(json('pack-v10.scenery.json'), `${FORGECOACH_PACK_URL}scenery.json`).pack!;
const PAIRS: PairsPack = validatePairs(json('pairs-v8.tag.pairs.json'), `${FORGECOACH_PAIRS_FULL_URL}pairs.json`).pairs!;
const SCENES = validateScenes(json('scenes-sample.scenes.json'), `${FORGECOACH_SCENES_URL}scenes.json`).scenes!;
const T = PACK.stageThresholds ?? [1, 2, 3, 4, 5, 6];

const synthPack = (): PlacesPack => {
  const r = validatePlaces(synthPlaces(), MANIFEST);
  expect(r.errors).toEqual([]);
  return r.places!;
};
const PLACES = synthPack();

const slot = (biome: Biome, index: number, weight: number): SlotState => ({ biome, index, weight, stage: Math.min(6, Math.max(1, Math.floor(weight))), peak: Math.min(6, Math.max(1, Math.floor(weight))) });
const slotsOf = (...xs: [Biome, number][]) => xs.map(([b, w], i) => slot(b, i, w));
const lands = (key: string) => key.split('+').map((k) => ({ biome: k.replace(/\d$/, '') as Biome, stage: Number(k.slice(-1)) }));

/** The synthetic manifest with one place edited. */
function withPlace(key: string, edit: (p: any) => void): unknown {
  const raw = synthPlaces();
  edit(raw.places[key]);
  return raw;
}

// ---------------------------------------------------------------------------

describe('spec 1.22: the key', () => {
  it('is the lands in the geography’s order joined by +, with no stages', () => {
    expect(placeKeyOf(['mountain', 'island', 'plains', 'swamp'])).toBe('island+swamp+plains+mountain');
    expect(placeKeyOf(['forest'])).toBe('forest');
    expect(placeKeyOf([])).toBeNull();
    expect(placeKeyOf(['island', 'island'])).toBeNull();
    expect(placeKeyOf(['wastes'])).toBeNull();
  });
});

describe('spec 1.22: the file', () => {
  it('validates the 31-place synthetic file clean, every URL resolved against the manifest (relative) or kept (absolute)', () => {
    expect(Object.keys(PLACES.places)).toHaveLength(31);
    const c = PLACES.places['island+swamp+plains+mountain']!;
    expect(c).toMatchObject({ slug: 'cartagena', name: 'Cartagena de Indias', ref: 'places-v1-p0', lands: ['island', 'swamp', 'plains', 'mountain'] });
    expect(c.half.src).toBe(`${FORGECOACH_PLACES_URL}places/cartagena/d/base.webp`);
    expect(c.half.phone.src).toBe(`${FORGECOACH_PLACES_URL}places/cartagena/p/base.webp`);
    expect(c.layers.island![2]!.half).toEqual({ src: `${FORGECOACH_PLACES_URL}places/cartagena/d/island-3.webp`, x: 0, y: 0.25, w: 0.1, h: 0.25, width: 103, height: 83, bytes: 3000 });
    // Absolute URLs are kept as they are (places-v1 names each place's files at its own ref).
    const abs = withPlace('forest', (p) => (p.layers.forest[1].half.src = 'https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@places-v1-p9/places/x/d/forest-2.webp'));
    expect(validatePlaces(abs, MANIFEST).places!.places.forest!.layers.forest![1]!.half!.src).toBe('https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@places-v1-p9/places/x/d/forest-2.webp');
    // The homelands' stage 1 is null at both shapes; the land still has six stages.
    expect(PLACES.places.forest!.layers.forest![0]).toEqual({ half: null, phone: null });
  });

  const refusals: [string, string, (p: any) => void, RegExp][] = [
    ['a key that is not its lands', 'island+swamp', (p) => (p.lands = ['swamp', 'island', 'plains']), /the key does not match its lands, which make "island\+swamp\+plains"/],
    ['lands in another order still make the key', 'island+swamp', (p) => (p.lands = ['swamp', 'island']), /^$/],
    ['a land off the geography (wastes)', 'island', (p) => (p.lands = ['wastes']), /lands\[0\]: "wastes" is not one of the five/],
    ['a land named twice', 'island', (p) => (p.lands = ['island', 'island']), /island is named twice/],
    ['no base', 'island', (p) => delete p.half, /half: missing/],
    ['a base with no phone picture', 'island', (p) => delete p.half.phone, /half\.phone: missing or unusable/],
    ['a base with an unusable src', 'island', (p) => (p.half.src = 'ftp://example.org/base.webp'), /places\.island\.half\.src: the ftp: scheme is not allowed/],
    ['no layers', 'island', (p) => delete p.layers, /layers: missing/],
    ['a land without layers', 'island+swamp', (p) => delete p.layers.swamp, /layers\.swamp: exactly 6 stages \(stage 1 first\), found none/],
    ['five stages', 'island+swamp', (p) => p.layers.swamp.pop(), /layers\.swamp: exactly 6 stages \(stage 1 first\), found 5/],
    ['layers of a land not in the place', 'island', (p) => (p.layers.swamp = p.layers.island), /layers: swamp is not one of the place's lands/],
    ['a stage that is not { half, phone }', 'island', (p) => (p.layers.island[2] = 'x'), /layers\.island\[2\]: not an object/],
    ['a stage without its phone key', 'island', (p) => delete p.layers.island[2].phone, /layers\.island\[2\]\.phone: missing/],
    ['a piece with no src', 'island', (p) => delete p.layers.island[2].half.src, /layers\.island\[2\]\.half\.src: missing/],
    ['a piece with a data: src', 'island', (p) => (p.layers.island[2].half.src = 'data:image/png;base64,AAAA'), /the data: scheme is not allowed/],
    ['a piece that is not a picture with alpha', 'island', (p) => (p.layers.island[2].half.src = 'places/x/d/island-3.jpg'), /expected \.webp, \.avif or \.png/],
    ['a negative x', 'island', (p) => (p.layers.island[2].half.x = -0.01), /x and y must be 0 or more/],
    ['a zero w', 'island', (p) => (p.layers.island[2].phone.w = 0), /w and h must be above 0/],
    ['a box past the right edge', 'island', (p) => Object.assign(p.layers.island[2].half, { x: 0.95, w: 0.0511 }), /reaches past the base picture/],
    ['a box past the bottom', 'island', (p) => Object.assign(p.layers.island[2].half, { y: 0.5, h: 0.502 }), /reaches past the base picture/],
    ['a box that is not numbers', 'island', (p) => (p.layers.island[2].half.h = '0.2'), /x, y, w and h must be numbers/],
    ['no slug', 'island', (p) => delete p.slug, /slug: a short lowercase name/],
    ['no name', 'island', (p) => (p.name = ''), /name: the place's name/],
  ];
  for (const [what, key, edit, re] of refusals)
    it(`refuses a place with ${what}; the rest load`, () => {
      const r = validatePlaces(withPlace(key, edit), MANIFEST);
      if (re.source === '^$') {
        expect(r.errors).toEqual([]);
        return;
      }
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toMatch(re);
      expect(r.errors[0]).toMatch(/; place refused$/);
      expect(Object.keys(r.places!.places)).toHaveLength(30);
      expect(r.places!.places[key]).toBeUndefined();
    });

  it('a box within the rounding slack (x + w = 1.0008) is kept', () => {
    const r = validatePlaces(withPlace('island', (p) => Object.assign(p.layers.island[5].half, { x: 0.9, w: 0.1008 })), MANIFEST);
    expect(r.errors).toEqual([]);
  });

  it('a file that is not a places manifest is no places, with why', () => {
    expect(validatePlaces([], MANIFEST)).toMatchObject({ places: null, errors: ['The places manifest is not a JSON object.'] });
    expect(validatePlaces({ ...synthPlaces(), schema: 2 }, MANIFEST)).toMatchObject({ places: null, errors: ['schema: expected 1, found 2.'] });
    expect(validatePlaces({ schema: 1, scenes: {} }, MANIFEST).places).toBeNull();
    expect(validatePlaces(synthPlaces(), 'ftp://x/').places).toBeNull();
  });

  it('warns on a newer spec and on budgets, and keeps the places', () => {
    expect(validatePlaces({ ...synthPlaces(), spec: '1.23' }, MANIFEST).warnings).toEqual(['spec: the places are written for 1.23; this ForgeCoach reads 1.22, so newer fields are ignored']);
    const fat = withPlace('island', (p) => (p.half.bytes = 9 * 1048576));
    const r = validatePlaces(fat, MANIFEST);
    expect(r.errors).toEqual([]);
    expect(r.warnings.some((w) => /^places\.island: 9\.\d MB declared; a place's budget is 8 MB/.test(w))).toBe(true);
    expect(r.warnings.some((w) => /^places: .* MB declared in /.test(w))).toBe(false);
    const huge = withPlace('island', (p) => (p.half.bytes = 46 * 1048576));
    expect(validatePlaces(huge, MANIFEST).warnings.some((w) => /^places: 4\d\.\d MB declared in https:\/\/cdn\.jsdelivr\.net\/gh.*|^places: .* MB declared in places-v1/.test(w))).toBe(true);
  });

  it('is fetched never throwing: missing, broken, unreachable or over 2 MB is no places', async () => {
    expect(placesManifestUrl(FORGECOACH_PLACES_URL)).toBe(MANIFEST);
    expect(placesManifestUrl('https://example.org/x/my.json')).toBe('https://example.org/x/my.json');
    expect(placesManifestUrl('ftp://example.org/')).toBeNull();
    const asked: string[] = [];
    const serve = (status: number, body: string): FetchLike => async (u) => {
      asked.push(u);
      return { ok: status === 200, status, text: async () => body };
    };
    const ok = await fetchPlaces(FORGECOACH_PLACES_URL, { fetch: serve(200, JSON.stringify(synthPlaces())) });
    expect(asked).toEqual([MANIFEST]);
    expect(Object.keys(ok.places!.places)).toHaveLength(31);
    expect(await fetchPlaces(FORGECOACH_PLACES_URL, { fetch: serve(404, '') })).toMatchObject({ places: null, errors: [`${MANIFEST} answered HTTP 404.`] });
    expect(await fetchPlaces(FORGECOACH_PLACES_URL, { fetch: serve(200, '{nope') })).toMatchObject({ places: null, errors: ['The places manifest is not valid JSON.'] });
    expect(await fetchPlaces(FORGECOACH_PLACES_URL, { fetch: async () => Promise.reject(new Error('offline')) })).toMatchObject({ places: null, errors: [`${MANIFEST} is unreachable.`] });
    expect(MAX_PLACES_MANIFEST_BYTES).toBe(2 * 1024 * 1024);
    expect(await fetchPlaces(FORGECOACH_PLACES_URL, { fetch: serve(200, ' '.repeat(MAX_PLACES_MANIFEST_BYTES + 1)) })).toMatchObject({ places: null, errors: ['The places manifest is over 2 MB.'] });
  });

  it('is loaded with ForgeCoach’s own pack on the scenes’ condition; ?places=off and ?scenes=off load none', () => {
    expect(FORGECOACH_PLACES_URL).toBe('https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@places-v1/');
    expect(placesUrlOf(DEFAULT_PREFS)).toBe(FORGECOACH_PLACES_URL);
    expect(placesUrlOf({ ...DEFAULT_PREFS, pairFull: false })).toBe(FORGECOACH_PLACES_URL);
    expect(placesUrlOf({ ...DEFAULT_PREFS, packUrl: 'http://127.0.0.1:8650/' })).toBeNull();
    expect(placesUrlOf({ ...DEFAULT_PREFS, mode: 'procedural' })).toBeNull();
    expect(placesUrlOf({ ...DEFAULT_PREFS, mode: 'off' })).toBeNull();
    expect(placesUrlOf(effectivePrefs(DEFAULT_PREFS, '?places=off', ''))).toBeNull();
    expect(scenesUrlOf(effectivePrefs(DEFAULT_PREFS, '?places=off', ''))).toBe(FORGECOACH_SCENES_URL);
    expect(placesUrlOf(effectivePrefs(DEFAULT_PREFS, '', '#ambience?scenes=off'))).toBeNull();
    expect(effectivePrefs(DEFAULT_PREFS, '?places=on', '')).toBe(DEFAULT_PREFS);
  });
});

describe('spec 1.22: the loader', () => {
  const pack = JSON.stringify(json('pack-v10.scenery.json'));
  const scenes = JSON.stringify(json('scenes-sample.scenes.json'));
  const serve = (places: { status: number; body: string }, asked: string[]): FetchLike => async (u) => {
    asked.push(u);
    if (u.endsWith('scenery.json')) return { ok: true, status: 200, text: async () => pack };
    if (u.endsWith('places.json')) return { ok: places.status === 200, status: places.status, text: async () => places.body };
    if (u.endsWith('scenes.json')) return { ok: true, status: 200, text: async () => scenes };
    return { ok: false, status: 404, text: async () => '' };
  };
  const load = async () => undefined;
  const quietly = async <X,>(f: () => Promise<X>) => {
    const info = console.info;
    console.info = () => undefined;
    try {
      return await f();
    } finally {
      console.info = info;
    }
  };

  it('places loaded: carried as the pack’s `places`, and scenes.json is never fetched', async () => {
    const asked: string[] = [];
    const got = (await quietly(() => resolveScenery(DEFAULT_PREFS, { fetch: serve({ status: 200, body: JSON.stringify(synthPlaces()) }, asked), load })))!;
    expect(got.source).toBe('pack');
    expect(Object.keys(got.pack!.places!.places)).toHaveLength(31);
    expect(got.pack!.scenes).toBeUndefined();
    expect(asked).toContain(MANIFEST);
    expect(asked.some((u) => u.endsWith('scenes.json'))).toBe(false);
  });

  for (const [why, places] of [
    ['missing', { status: 404, body: '' }],
    ['broken', { status: 200, body: '{nope' }],
    ['every place refused', { status: 200, body: JSON.stringify({ schema: 1, places: { island: { slug: 'x' } } }) }],
  ] as const)
    it(`places ${why}: today’s behaviour exactly -- the scenes fetched and carried, no places`, async () => {
      const asked: string[] = [];
      const got = (await quietly(() => resolveScenery(DEFAULT_PREFS, { fetch: serve(places, asked), load })))!;
      expect(got.source).toBe('pack');
      expect(got.pack!.places).toBeUndefined();
      expect(Object.keys(got.pack!.scenes!.scenes)).toEqual(['island2+forest3+mountain2', 'plains2+forest4+mountain2']);
      expect(asked.filter((u) => u.endsWith('scenes.json'))).toEqual([`${FORGECOACH_SCENES_URL}scenes.json`]);
      expect(got.note).toBeNull();
    });

  it('a pack of your own fetches neither', async () => {
    const asked: string[] = [];
    await quietly(() => resolveScenery({ ...DEFAULT_PREFS, packUrl: 'https://example.org/pack/' }, { fetch: serve({ status: 200, body: JSON.stringify(synthPlaces()) }, asked), load }));
    expect(asked.some((u) => u.endsWith('places.json') || u.endsWith('scenes.json'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('spec 1.22: a state composed', () => {
  it('every state of every colour set (1-5 colours, stages 1-6) has its place and a composition; the piece is the stage’s', () => {
    let states = 0;
    for (const set of colourSets()) {
      const n = set.length;
      for (let code = 0; code < 6 ** n; code++) {
        const st = set.map((biome, i) => ({ biome, stage: (Math.floor(code / 6 ** i) % 6) + 1 }));
        const c = placeFor(PLACES, st)!;
        expect(c.place.key).toBe(set.join('+'));
        expect(c.key).toBe(st.map((l) => `${l.biome}${l.stage}`).join('+'));
        expect(c.lands.map((l) => [l.biome, l.stage])).toEqual(st.map((l) => [l.biome, l.stage]));
        for (const l of c.lands) expect(l.piece).toBe(c.place.layers[l.biome]![l.stage - 1]);
        states++;
      }
    }
    expect(states).toBe(5 * 6 + 10 * 36 + 10 * 216 + 5 * 1296 + 7776);
  });

  it('reads a half’s slots in any board order; a half with a wastes slot, or none, has no place', () => {
    const c = placeForSlots(PLACES, slotsOf(['mountain', 1], ['plains', 3], ['island', 2], ['swamp', 1]), T)!;
    expect(c.place.slug).toBe('cartagena');
    expect(c.key).toBe('island2+swamp1+plains3+mountain1');
    expect(placeForSlots(PLACES, [...slotsOf(['island', 2]), slot('wastes', 1, 1)], T)).toBeNull();
    expect(placeForSlots(PLACES, [], T)).toBeNull();
    expect(placeForSlots(null, slotsOf(['island', 2]), T)).toBeNull();
    // A lone half-land (a dual's half) is stage 1; seven lands are stage 6.
    expect(placeForSlots(PLACES, slotsOf(['island', 0.5], ['forest', 7]), T)!.key).toBe('island1+forest6');
  });

  it('the pieces at a shape, the next stage’s to warm, and the caption', () => {
    const c = placeFor(PLACES, lands('island2+swamp1+plains3+mountain1'))!;
    expect(placePieces(c.lands, false).map((p) => p.piece!.src.split('/').slice(-3).join('/'))).toEqual(['cartagena/d/island-2.webp', 'cartagena/d/swamp-1.webp', 'cartagena/d/plains-3.webp', 'cartagena/d/mountain-1.webp']);
    expect(placePieces(c.lands, true).map((p) => p.piece!.src.split('/').slice(-2).join('/'))).toEqual(['p/island-2.webp', 'p/swamp-1.webp', 'p/plains-3.webp', 'p/mountain-1.webp']);
    expect(nextPlacePieces(c.place, c.lands, true).map((p) => p.src.split('/').slice(-1)[0])).toEqual(['island-3.webp', 'swamp-2.webp', 'plains-4.webp', 'mountain-2.webp']);
    expect(nextPlacePieces(c.place, [{ biome: 'island', stage: 6 }], false)).toEqual([]);
    expect(placeWords(c)).toBe('Cartagena de Indias: Island 2, Swamp 1, Plains 3, Mountain 1');
    // A homeland's stage 1: its piece is null (the base is stage 1), and the land is still listed.
    const home = placeFor(PLACES, lands('forest1'))!;
    expect(placePieces(home.lands, false)).toEqual([{ biome: 'forest', stage: 1, piece: null }]);
  });
});

// ---------------------------------------------------------------------------

const ELEMENTS = elementBiomes(PACK.pieces);
const PHONE_ELEMENTS = phoneElementBiomes(PACK.pieces);
type PlanOpts = { places?: PlacesPack | null; scenes?: typeof SCENES | null; pairs?: PairsPack | null; narrow?: boolean; failed?: (src: string) => boolean };
const planOf = (slots: SlotState[], o: PlanOpts = {}) =>
  pairFullPlan(halfLayout(slots, PACK, null, null), o.pairs === undefined ? PAIRS : o.pairs, { thresholds: T, elements: ELEMENTS, phoneElements: PHONE_ELEMENTS, showing: null, slots, narrow: o.narrow ?? false, scenes: o.scenes === undefined ? SCENES : o.scenes, places: o.places === undefined ? PLACES : o.places, biomes: PACK.biomes, sceneFailed: o.failed ?? null });
const sceneOf = (plan: PairFullItem[] | null) => plan?.find((x): x is PairFullScene => x.kind === 'scene') ?? null;
const STATE_A = slotsOf(['mountain', 2], ['forest', 3], ['island', 2]);

describe('spec 1.22: the plan', () => {
  it('a place comes before an exact scene, a nearest scene, a pair and the panels -- with the flag and without', () => {
    for (const pairs of [PAIRS, null])
      for (const narrow of [false, true]) {
        const plan = planOf(STATE_A, { pairs, narrow });
        expect(plan).toHaveLength(1);
        const s = sceneOf(plan)!;
        expect(s.place!.place.slug).toBe('island-forest-mountain');
        expect(s.key).toBe('island2+forest3+mountain2');
        expect(s.nearest).toBeUndefined();
        expect(s.scene.half).toBe(PLACES.places['island+forest+mountain']!.half);
        expect(s.scene.lands).toEqual(lands('island2+forest3+mountain2'));
      }
    // Without places: the scene (1.20), as before.
    expect(sceneOf(planOf(STATE_A, { places: null }))!.scene).toBe(SCENES.scenes['island2+forest3+mountain2']);
  });

  it('one colour draws its homeland, every number of colours its place', () => {
    for (const set of colourSets()) {
      const slots = set.map((b, i) => slot(b, i, 1 + (i % 3)));
      const s = sceneOf(planOf(slots))!;
      expect(s.place!.place.key).toBe(set.join('+'));
      expect(s.place!.lands.map((l) => l.biome)).toEqual(set);
    }
    // Two colours at a stage pairs-v8 has a seam cell for: still the place, never the cell.
    const pair = planOf(slotsOf(['island', 2], ['swamp', 2]));
    expect(pair!.map((x) => x.kind)).toEqual(['scene']);
  });

  it('the base failed at this shape: the half is planned as if there were no places', () => {
    const base = PLACES.places['island+forest+mountain']!.half;
    const failed = (src: string) => src === base.src;
    // The scenes (when loaded) are what then draws -- here the sample's exact scene.
    expect(sceneOf(planOf(STATE_A, { failed }))!.scene).toBe(SCENES.scenes['island2+forest3+mountain2']);
    // With no scenes loaded (the real case: places loaded means no scenes fetched), today's 1.15-1.19 plan, exactly.
    expect(planOf(STATE_A, { failed, scenes: null })).toEqual(planOf(STATE_A, { places: null, scenes: null }));
    // Only the shape drawn counts: the phone base fine, a phone draws the place.
    expect(sceneOf(planOf(STATE_A, { failed, scenes: null, narrow: true }))!.place).toBeDefined();
    // A piece failing never changes the plan.
    expect(sceneOf(planOf(STATE_A, { failed: (src) => src.endsWith('/d/island-2.webp') }))!.place).toBeDefined();
  });

  it('no cut-out, element or piece of 1.14 over a place; its caption names the place and the lands', () => {
    const slots = slotsOf(['mountain', 1], ['plains', 3], ['island', 2], ['swamp', 1]);
    const plan = planOf(slots);
    const cands = planCandidates(plan, 3.2, false)!;
    const ready = pairFullChoice(cands, () => 'ready');
    expect(pairFullSceneDrawn(plan, ready)).toBe(true);
    expect(pairFullCutOutAllowed(ready)).toBe(false);
    expect(halfCutOuts({ plan: planHalf({ makeup: makeupFromSlots(slots) }), pieces: PACK.pieces!, phone: false, narrow: false, full: plan, choice: ready })).toEqual([]);
    expect(pairFullCaption(plan)).toBe('Cartagena de Indias: Island 2, Swamp 1, Plains 3, Mountain 1');
  });

  it('its candidate is the base framed as a scene, with the pieces of the base’s shape', () => {
    const plan = planOf(STATE_A);
    const desk = planCandidates(plan, 3.2, false)!;
    expect(desk).toHaveLength(1);
    expect(desk[0]!).toMatchObject({ scene: 'island2+forest3+mountain2', mirror: false, painted: null });
    expect(desk[0]!.art.source).toBe('half');
    expect(desk[0]!.place!.pieces.map((p) => p.piece!.src.split('/').slice(-2).join('/'))).toEqual(['d/island-2.webp', 'd/forest-3.webp', 'd/mountain-2.webp']);
    const phone = planCandidates(plan, 0.8, true)!;
    expect(phone[0]!.art.source).toBe('phone');
    expect(phone[0]!.art.picture!.src).toBe(PLACES.places['island+forest+mountain']!.half.phone.src);
    expect(phone[0]!.place!.pieces.map((p) => p.piece!.src.split('/').slice(-2).join('/'))).toEqual(['p/island-2.webp', 'p/forest-3.webp', 'p/mountain-2.webp']);
  });
});

describe('spec 1.22: the load gate and the hold', () => {
  const planAt = (key: string) => planOf(lands(key).map((l, i) => slot(l.biome, i, l.stage)));
  const candOf = (plan: PairFullItem[] | null) => planCandidates(plan, 3.2, false)!;
  const status = (ready: Set<string>, failed: Set<string> = new Set()) => (src: string) => (ready.has(src) ? 'ready' : failed.has(src) ? 'failed' : 'pending') as 'ready' | 'failed' | 'pending';
  const srcs = (c: PairFullCandidate) => [c.art.picture!.src, ...c.place!.pieces.map((p) => p.piece!.src)];

  it('a place is shown once its base AND the pieces of its state have settled; a failed piece counts as settled', () => {
    const c = candOf(planAt('island2+swamp1'));
    const [base, isl, sw] = srcs(c[0]!);
    expect(pairFullChoice(c, status(new Set())).show).toBeNull();
    // The base alone: not shown (it would appear bare and pop its buildings in), but `base` says it could be.
    const baseOnly = pairFullChoice(c, status(new Set([base!])));
    expect(baseOnly.show).toBeNull();
    expect(baseOnly.base).toBe(c[0]);
    expect(pairFullChoice(c, status(new Set([base!, isl!]))).show).toBeNull();
    expect(pairFullChoice(c, status(new Set([base!, isl!, sw!]))).show).toBe(c[0]);
    expect(pairFullChoice(c, status(new Set([base!, isl!]), new Set([sw!]))).show).toBe(c[0]);
    // The base failed: not wanted (the plan, with sceneFailed, goes elsewhere).
    expect(pairFullChoice(c, status(new Set([isl!, sw!]), new Set([base!]))).want).toBeNull();
  });

  it('a homeland’s stage 1 (a null piece) waits for nothing but its base', () => {
    const c = candOf(planAt('forest1'));
    expect(c[0]!.place!.pieces).toEqual([{ biome: 'forest', stage: 1, piece: null }]);
    expect(pairFullChoice(c, status(new Set([c[0]!.art.picture!.src]))).show).toBe(c[0]);
  });

  it('the same place, a land’s stage changed with its piece still loading: drawn at once (the panel waits for the piece)', () => {
    const a = planAt('island2+swamp1');
    const ca = candOf(a);
    const loaded = new Set(srcs(ca[0]!));
    let hold: PairFullHold<string> = { last: null, since: null };
    hold = pairFullHold({ layout: 'L1', plan: a, choice: pairFullChoice(ca, status(loaded)) }, hold, 0).hold;
    expect(hold.last!.shown).toBe(ca[0]);
    const b = planAt('island3+swamp1');
    const cb = candOf(b);
    const r = pairFullHold({ layout: 'L2', plan: b, choice: pairFullChoice(cb, status(loaded)) }, hold, 10);
    expect(r.holding).toBe(false);
    expect(r.draw.plan).toBe(b);
    expect(r.draw.shown).toBe(cb[0]);
  });

  it('a place change waits for the new base and its pieces (the old place held), then swaps; past the hold, the base with its pieces arriving', () => {
    const a = planAt('island2+swamp1');
    const ca = candOf(a);
    const ready = new Set(srcs(ca[0]!));
    let hold: PairFullHold<string> = { last: null, since: null };
    hold = pairFullHold({ layout: 'L1', plan: a, choice: pairFullChoice(ca, status(ready)) }, hold, 0).hold;
    const b = planAt('island2+swamp1+plains1');
    const cb = candOf(b);
    ready.add(cb[0]!.art.picture!.src); // the new base, not its pieces
    const r1 = pairFullHold({ layout: 'L2', plan: b, choice: pairFullChoice(cb, status(ready)) }, hold, 100);
    expect(r1.holding).toBe(true);
    expect(r1.draw.plan).toBe(a);
    // Past the hold with a piece still out: the new place (its base loaded), never the panels.
    const r2 = pairFullHold({ layout: 'L2', plan: b, choice: pairFullChoice(cb, status(ready)) }, r1.hold, 100 + PAIR_FULL_HOLD_MS);
    expect(r2.draw.plan).toBe(b);
    expect(r2.draw.shown).toBe(cb[0]);
    // Every piece settled within the hold: swapped in whole.
    for (const s of srcs(cb[0]!)) ready.add(s);
    const r3 = pairFullHold({ layout: 'L2', plan: b, choice: pairFullChoice(cb, status(ready)) }, r1.hold, 200);
    expect(r3.holding).toBe(false);
    expect(r3.draw.shown).toBe(cb[0]);
  });

  it('nothing drawn before and the base not loaded: the panels meanwhile (never blank), as a scene', () => {
    const b = planAt('island2+swamp1');
    const r = pairFullHold({ layout: 'L', plan: b, choice: pairFullChoice(candOf(b), status(new Set())) }, { last: null, since: null }, 0);
    expect(r.draw.plan).toBeNull();
  });
});

describe('spec 1.22: a land’s piece across a stage change', () => {
  const p = (k: number): PlacePiece => ({ src: `island-${k}.webp`, x: 0, y: 0, w: 0.1, h: 0.1, width: null, height: null, bytes: null });
  it('first paint and reduced motion: at once', () => {
    expect(pieceWant([], p(2), true, 2)).toEqual([{ key: 'island-2.webp', piece: p(2), role: 'cur', stage: 2, from: 1 }]);
    expect(pieceWant([], null, true)).toEqual([]);
  });
  it('a step: the new fades in on top, the old kept beneath; once in, the old fades out, then goes', () => {
    const a = pieceWant([], p(2), true, 2);
    const b = pieceWant(a, p(3), false, 3);
    expect(b.map((e) => [e.key, e.role, e.from])).toEqual([['island-2.webp', 'under', 1], ['island-3.webp', 'in', 0]]);
    expect(pieceWant(b, p(3), false, 3)).toEqual(b);
    const c = pieceSettleIn(b);
    expect(c.map((e) => [e.key, e.role])).toEqual([['island-2.webp', 'out'], ['island-3.webp', 'cur']]);
    expect(pieceSettleOut(c).map((e) => [e.key, e.role])).toEqual([['island-3.webp', 'cur']]);
  });
  it('down a stage (a land destroyed), a null stage, and a second step mid-fade', () => {
    const a = pieceWant([], p(3), true, 3);
    expect(pieceWant(a, p(2), false, 2).map((e) => [e.key, e.role])).toEqual([['island-3.webp', 'under'], ['island-2.webp', 'in']]);
    expect(pieceWant(a, null, false).map((e) => [e.key, e.role])).toEqual([['island-3.webp', 'out']]);
    const mid = pieceWant(pieceWant(a, p(4), false, 4), p(5), false, 5);
    expect(mid.map((e) => [e.key, e.role])).toEqual([['island-3.webp', 'under'], ['island-4.webp', 'under'], ['island-5.webp', 'in']]);
    // Back to a piece still beneath: it comes in from where it is (no flash to nothing).
    const back = pieceWant(pieceWant(a, p(4), false, 4), p(3), false, 3);
    expect(back.map((e) => [e.key, e.role, e.from])).toEqual([['island-4.webp', 'under', 0], ['island-3.webp', 'in', 1]]);
    expect(pieceWant([...mid, { ...mid[0]!, key: 'x', role: 'out' }], p(6), false, 6).length).toBeLessThanOrEqual(3);
  });
});
