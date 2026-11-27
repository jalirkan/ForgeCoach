/*
 * ForgeCoach — ambience/places.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.22, places (places.ts): the key, the file, the composition, the plan's
 * precedence, the load gate and hold, the caption, the piece fade's state and
 * the loader. `synthPlaces()` builds a places manifest in places-v1's, places-v2's or places-v3's (places-v4's to places-v6's) shape for
 * all 31 colour sets with relative URLs (the shape tests); the real tagged file
 * is `testdata/places-v6.places.json`, hash-pinned in places-v6.test.ts.
 * Nothing here touches the network.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateManifest, type ScenePack } from './manifest.ts';
import { halfLayout } from './layout.ts';
import type { Biome, SlotState } from './model.ts';
import { validatePairs, type PairsPack } from './pairs.ts';
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
  neighbourPlaces,
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
  pieceKey,
  placesBytes,
  placeUsable,
  type PieceEntry,
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
    // Absolute URLs are kept as they are (places names each place's files at its own ref).
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
    expect(validatePlaces(huge, MANIFEST).warnings.some((w) => /^places: 4\d\.\d MB declared in https:\/\/cdn\.jsdelivr\.net\/gh.*|^places: .* MB declared in places-v\d/.test(w))).toBe(true);
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
    expect(FORGECOACH_PLACES_URL).toBe('https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@places-v6/');
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

  it('places loaded clean: carried as the pack’s `places`; the scenes fetch, started beside it, is cancelled and not carried', async () => {
    const asked: string[] = [];
    let scenesSignal: AbortSignal | undefined;
    const base = serve({ status: 200, body: JSON.stringify(synthPlaces()) }, asked);
    const fetch: FetchLike = async (u, init) => {
      if (u.endsWith('scenes.json')) scenesSignal = init?.signal ?? undefined;
      return base(u, init);
    };
    const got = (await quietly(() => resolveScenery(DEFAULT_PREFS, { fetch, load })))!;
    expect(got.source).toBe('pack');
    expect(Object.keys(got.pack!.places!.places)).toHaveLength(31);
    expect(got.pack!.scenes).toBeUndefined();
    expect(asked).toContain(MANIFEST);
    // Both started together (the review of #218: a failed places.json must not hold the scenes back), the scenes' cancelled.
    expect(asked.filter((u) => u.endsWith('scenes.json'))).toHaveLength(1);
    expect(scenesSignal?.aborted).toBe(true);
  });

  it('places with a place refused: the places AND the scenes carried (the refused colours draw their scenes)', async () => {
    const asked: string[] = [];
    const raw = synthPlaces();
    raw.places.island.lands = ['wastes'];
    const got = (await quietly(() => resolveScenery(DEFAULT_PREFS, { fetch: serve({ status: 200, body: JSON.stringify(raw) }, asked), load })))!;
    expect(Object.keys(got.pack!.places!.places)).toHaveLength(30);
    expect(Object.keys(got.pack!.scenes!.scenes)).toEqual(['island2+forest3+mountain2', 'plains2+forest4+mountain2']);
  });

  it('places.json slow and failing: the scenes were fetched beside it, not after it', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const base = serve({ status: 404, body: '' }, []);
    const fetch: FetchLike = async (u, init) => {
      order.push(u.split('/').pop()!);
      if (u.endsWith('places.json')) {
        await gate;
        return { ok: false, status: 404, text: async () => '' };
      }
      return base(u, init);
    };
    const p = quietly(() => resolveScenery(DEFAULT_PREFS, { fetch, load }));
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toContain('scenes.json');
    release();
    expect(Object.keys((await p)!.pack!.scenes!.scenes)).toHaveLength(2);
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
    const L = c.place.layers;
    expect(placePieces(c.lands, false).map((p) => p.piece)).toEqual([L.island![1]!.half, L.swamp![0]!.half, L.plains![2]!.half, L.mountain![0]!.half]);
    expect(placePieces(c.lands, true).map((p) => p.piece)).toEqual([L.island![1]!.phone, L.swamp![0]!.phone, L.plains![2]!.phone, L.mountain![0]!.phone]);
    expect(nextPlacePieces(c.place, c.lands, true)).toEqual([L.island![2]!.phone, L.swamp![1]!.phone, L.plains![3]!.phone, L.mountain![1]!.phone]);
    expect(nextPlacePieces(c.place, [{ biome: 'island', stage: 6 }], false)).toEqual([]);
    expect(placeWords(c)).toBe('Cartagena de Indias: Island 2, Swamp 1, Plains 3, Mountain 1');
    // A homeland's stage 1: its piece is null (the base is stage 1), and the land is still listed.
    const home = placeFor(PLACES, lands('forest1'))!;
    expect(placePieces(home.lands, false)).toEqual([{ biome: 'forest', stage: 1, piece: null }]);
  });

  it('the places one land away: a first land of each colour the state lacks, the others as they are', () => {
    const near = neighbourPlaces(PLACES, lands('plains3+mountain1'));
    // One for each of the three colours it lacks that the pack has a place for, that land at stage 1.
    expect(near.length).toBeGreaterThan(0);
    for (const c of near) {
      expect(c.lands).toHaveLength(3);
      const added = c.lands.filter((l) => l.biome !== 'plains' && l.biome !== 'mountain');
      expect(added).toHaveLength(1);
      expect(added[0]!.stage).toBe(1);
      expect(c.lands.find((l) => l.biome === 'plains')!.stage).toBe(3);
      expect(c.place.key).toBe(placeKeyOf(c.lands.map((l) => l.biome)));
    }
    expect(new Set(near.map((c) => c.place.key)).size).toBe(near.length);
    // All five colours: nothing left to add. No state, or no pack: nothing.
    expect(neighbourPlaces(PLACES, lands('island1+swamp1+plains1+forest1+mountain1'))).toEqual([]);
    expect(neighbourPlaces(PLACES, [])).toEqual([]);
    expect(neighbourPlaces(null, lands('plains1'))).toEqual([]);
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
    const piece = PLACES.places['island+forest+mountain']!.layers.island![1]!.half!.src;
    expect(sceneOf(planOf(STATE_A, { failed: (src) => src === piece }))!.place).toBeDefined();
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
    const L = PLACES.places['island+forest+mountain']!.layers;
    expect(desk[0]!.place!.pieces.map((p) => p.piece)).toEqual([L.island![1]!.half, L.forest![2]!.half, L.mountain![1]!.half]);
    const phone = planCandidates(plan, 0.8, true)!;
    expect(phone[0]!.art.source).toBe('phone');
    expect(phone[0]!.art.picture!.src).toBe(PLACES.places['island+forest+mountain']!.half.phone.src);
    expect(phone[0]!.place!.pieces.map((p) => p.piece)).toEqual([L.island![1]!.phone, L.forest![2]!.phone, L.mountain![1]!.phone]);
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

  it('first paint, the base loaded and a piece hung: the panels, reported as holding (so the caller wakes), then the place past the hold', () => {
    const b = planAt('island2+swamp1');
    const cb = candOf(b);
    const ready = new Set([cb[0]!.art.picture!.src]);
    const r1 = pairFullHold({ layout: 'L', plan: b, choice: pairFullChoice(cb, status(ready)) }, { last: null, since: null }, 0);
    expect(r1.draw.plan).toBeNull();
    expect(r1.holding).toBe(true);
    expect(r1.hold.since).toBe(0);
    const r2 = pairFullHold({ layout: 'L', plan: b, choice: pairFullChoice(cb, status(ready)) }, r1.hold, PAIR_FULL_HOLD_MS);
    expect(r2.draw.shown).toBe(cb[0]);
  });

  it('a stale draw is never taken for the place on screen: A, then B whose base hangs past the hold (panels), then A again with a piece pending -- A is not drawn by the fast path', () => {
    const a = planAt('island2+swamp1');
    const ca = candOf(a);
    const ready = new Set(srcs(ca[0]!));
    let hold: PairFullHold<string> = pairFullHold({ layout: 'L1', plan: a, choice: pairFullChoice(ca, status(ready)) }, { last: null, since: null }, 0).hold;
    const b = planAt('island2+swamp1+plains1');
    hold = pairFullHold({ layout: 'L2', plan: b, choice: pairFullChoice(candOf(b), status(ready)) }, hold, 10).hold;
    const panels = pairFullHold({ layout: 'L2', plan: b, choice: pairFullChoice(candOf(b), status(ready)) }, hold, 10 + PAIR_FULL_HOLD_MS);
    expect(panels.draw.plan).toBeNull();
    // The panels are now what is on screen: `last` says so.
    expect(panels.hold.last!.shown).toBeNull();
    const a2 = planAt('island3+swamp1');
    const r = pairFullHold({ layout: 'L3', plan: a2, choice: pairFullChoice(candOf(a2), status(ready)) }, panels.hold, 20 + PAIR_FULL_HOLD_MS);
    // Not the fast path's "same place on screen" (that remounted A with the island bare): A is waited for from the
    // panels, held, and drawn whole once its piece has loaded.
    expect(r.draw.plan).toBeNull();
    expect(r.holding).toBe(true);
    for (const x of srcs(candOf(a2)[0]!)) ready.add(x);
    const ca2 = candOf(a2);
    const r2 = pairFullHold({ layout: 'L3', plan: a2, choice: pairFullChoice(ca2, status(ready)) }, r.hold, 30 + PAIR_FULL_HOLD_MS);
    expect(r2.draw.shown).toBe(ca2[0]);
  });

  it('a half whose place is not usable (none for its colours, or a base that failed) is the one whose older pictures are warmed', () => {
    const slots = slotsOf(['island', 2], ['swamp', 1]);
    const c = PLACES.places['island+swamp']!;
    expect(placeUsable(PLACES, slots, T, () => false)).toBe(true);
    expect(placeUsable(PLACES, slots, T, (src) => src === c.half.src)).toBe(false);
    expect(placeUsable(PLACES, slots, T, (src) => src === c.half.phone.src)).toBe(false);
    expect(placeUsable(null, slots, T, () => false)).toBe(false);
    expect(placeUsable(PLACES, [...slots, slot('wastes', 2, 1)], T, () => false)).toBe(false);
  });

  it('nothing drawn before and the base not loaded: the panels meanwhile (never blank), as a scene', () => {
    const b = planAt('island2+swamp1');
    const r = pairFullHold({ layout: 'L', plan: b, choice: pairFullChoice(candOf(b), status(new Set())) }, { last: null, since: null }, 0);
    expect(r.draw.plan).toBeNull();
  });
});

describe('spec 1.22: a land’s piece across a stage change (the pure state PlaceLandPiece keeps)', () => {
  const p = (k: number, box: Partial<PlacePiece> = {}): PlacePiece => ({ src: `island-${k}.webp`, x: 0, y: 0, w: 0.1, h: 0.1, width: null, height: null, bytes: null, ...box });
  /** A stack in words: file@stage role from. */
  const words = (st: readonly PieceEntry[]) => st.map((e) => `${e.piece.src.replace('.webp', '')}@${e.stage} ${e.role} ${e.from}`);
  /** What PlaceLandPiece does: a change arrives only once its piece has loaded; a pending one changes nothing. */
  const step = (st: PieceEntry[], target: PlacePiece | null, stage: number, ready = true) => (ready || !target ? pieceWant(st, target, false, stage) : st);

  it('first paint and reduced motion: the target alone, at once (a step under reduced motion too)', () => {
    expect(words(pieceWant([], p(2), true, 2))).toEqual(['island-2@2 cur 1']);
    expect(pieceWant([], null, true)).toEqual([]);
    const mid = pieceWant(pieceWant([], p(2), true, 2), p(3), false, 3);
    expect(words(pieceWant(mid, p(4), true, 4))).toEqual(['island-4@4 cur 1']);
    expect(pieceWant(mid, null, true)).toEqual([]);
  });

  it('a step: the new fades in on top, the old kept beneath; once in, the old fades out, then goes', () => {
    const a = pieceWant([], p(2), true, 2);
    const b = pieceWant(a, p(3), false, 3);
    expect(words(b)).toEqual(['island-2@2 under 1', 'island-3@3 in 0']);
    expect(pieceWant(b, p(3), false, 3)).toEqual(b);
    const c = pieceSettleIn(b);
    expect(words(c)).toEqual(['island-2@2 out 1', 'island-3@3 cur 1']);
    expect(words(pieceSettleOut(c))).toEqual(['island-3@3 cur 1']);
    // Settling with nothing fading is a no-op.
    expect(pieceSettleIn(pieceSettleOut(c))).toEqual(pieceSettleOut(c));
  });

  it('a change arriving mid-fade: the piece fading in goes beneath too, the newest on top, at most three', () => {
    const a = pieceWant([], p(3), true, 3);
    const mid = pieceWant(pieceWant(a, p(4), false, 4), p(5), false, 5);
    expect(words(mid)).toEqual(['island-3@3 under 1', 'island-4@4 under 0', 'island-5@5 in 0']);
    // Once in, both beneath fade out together.
    expect(words(pieceSettleIn(mid))).toEqual(['island-3@3 out 1', 'island-4@4 out 0', 'island-5@5 cur 1']);
    // A fourth during the out-fade: the cap drops the oldest fading out first.
    const four = pieceWant(pieceSettleIn(mid), p(6), false, 6);
    expect(four.length).toBe(3);
    expect(words(four).at(-1)).toBe('island-6@6 in 0');
    expect(words(four)).toContain('island-5@5 under 1');
  });

  it('a step back down: a land destroyed fades its lower piece in over the higher; mid-fade, back to the one beneath comes in from full', () => {
    const a = pieceWant([], p(3), true, 3);
    expect(words(pieceWant(a, p(2), false, 2))).toEqual(['island-3@3 under 1', 'island-2@2 in 0']);
    const back = pieceWant(pieceWant(a, p(4), false, 4), p(3), false, 3);
    expect(words(back)).toEqual(['island-4@4 under 0', 'island-3@3 in 1']);
    // Down to a stage that adds nothing (a homeland back to stage 1): what was shown fades out.
    expect(words(pieceWant(a, null, false))).toEqual(['island-3@3 out 1']);
    expect(pieceWant([], null, false)).toEqual([]);
  });

  it('pending, then ready: the land keeps its piece while the next loads, then fades the next in', () => {
    const a = pieceWant([], p(2), true, 2);
    const pending = step(a, p(3), 3, false);
    expect(pending).toBe(a);
    expect(words(step(pending, p(3), 3, true))).toEqual(['island-2@2 under 1', 'island-3@3 in 0']);
    // A first piece arriving after the first paint (a homeland's stage 2, loaded late): it fades in from nothing.
    expect(words(step([], p(2), 2))).toEqual(['island-2@2 in 0']);
  });

  it('the same file at another box or another stage is another entry; the same file, box and stage is the same', () => {
    const a = pieceWant([], p(5), true, 5);
    expect(pieceKey(p(5), 5)).not.toBe(pieceKey(p(5, { y: 0.2 }), 5));
    expect(pieceKey(p(5), 5)).not.toBe(pieceKey(p(5), 6));
    expect(words(pieceWant(a, p(5, { y: 0.2 }), false, 5))).toEqual(['island-5@5 under 1', 'island-5@5 in 0']);
    expect(words(pieceWant(a, p(5), false, 6))).toEqual(['island-5@5 under 1', 'island-5@6 in 0']);
    expect(pieceWant(a, { ...p(5) }, false, 5)).toEqual(a);
  });
});

describe('spec 1.22: places-v2’s phone shape (a 2.22:1 phone base whose pieces reuse the desktop files)', () => {
  const V2 = validatePlaces(synthPlaces('v2'), MANIFEST);
  it('validates clean; the phone pieces are the desktop files at their own boxes (stage 6 a file of its own)', () => {
    expect(V2.errors).toEqual([]);
    const c = V2.places!.places['island+swamp+plains+mountain']!;
    expect(c.half.phone).toMatchObject({ width: 2560, height: 1152 });
    const st = c.layers.island![2]!;
    expect(st.phone!.src).toBe(st.half!.src);
    expect(st.phone!.y).not.toBe(st.half!.y);
    expect(c.layers.island![5]!.phone!.src).not.toBe(c.layers.island![5]!.half!.src);
  });
  it('counts every file once, per place and per ref', () => {
    const one = validatePlaces({ ...synthPlaces('v2'), places: { forest: synthPlaces('v2').places.forest } }, MANIFEST).places!;
    // forest: two bases (180,000 + 200,000), desktop pieces at stages 2-6 (2,000..6,000 = 20,000), the phone's own stage 6 (777).
    expect(placesBytes(one)).toBe(180000 + 200000 + 20000 + 777);
    const fat = synthPlaces('v2');
    fat.places.forest.half.bytes = 4 * 1048576;
    // Five shared desktop pieces of 1.8 MB: counted once they stay under the 8 MB budget; counted twice they would not.
    for (const st of fat.places.forest.layers.forest.slice(1, 5)) st.half.bytes = st.phone.bytes = 0.9 * 1048576;
    expect(validatePlaces(fat, MANIFEST).warnings.filter((w) => w.startsWith('places.forest:'))).toEqual([]);
  });
  it('a phone half draws the phone base and those pieces at the phone boxes; a desktop half narrower than the cut-over (~2.67:1) draws them too', () => {
    const slots = slotsOf(['mountain', 1], ['plains', 3], ['island', 2], ['swamp', 1]);
    const plan = pairFullPlan(halfLayout(slots, PACK, null, null), null, { thresholds: T, slots, places: V2.places! });
    const L = V2.places!.places['island+swamp+plains+mountain']!.layers;
    const want = [L.island![1]!.phone, L.swamp![0]!.phone, L.plains![2]!.phone, L.mountain![0]!.phone];
    const phone = planCandidates(plan, 2.1, true)![0]!;
    expect(phone.art.source).toBe('phone');
    expect(phone.place!.pieces.map((x) => x.piece)).toEqual(want);
    expect(planCandidates(plan, 2.5, false)![0]!.art.source).toBe('phone');
    expect(planCandidates(plan, 2.8, false)![0]!.art.source).toBe('half');
  });
  it('a base or phone base without its pixel size is refused (never the 16:5 or 4:5 defaults)', () => {
    for (const [what, edit, re] of [
      ['no width', (p: any) => delete p.half.width, /half: width and height are required/],
      ['a bad height', (p: any) => (p.half.height = 'tall'), /half: width and height are required/],
      ['a phone base with no height', (p: any) => delete p.half.phone.height, /half\.phone: width and height are required/],
      ['a phone base 1:9', (p: any) => Object.assign(p.half.phone, { width: 100, height: 900 }), /half\.phone: width and height are required/],
    ] as const) {
      const raw = synthPlaces('v2');
      edit(raw.places.island);
      const r = validatePlaces(raw, MANIFEST);
      expect(r.errors, what).toHaveLength(1);
      expect(r.errors[0], what).toMatch(re);
    }
  });
  it('a phone base with no subject band takes the desktop band mapped into it as a full-width outpainting, not the 4:5 default', () => {
    const raw = synthPlaces('v2');
    delete raw.places.island.half.phone.subjectBand;
    delete raw.places.island.half.phone.focal;
    delete raw.places.island.half.phone.safe;
    const ph = validatePlaces(raw, MANIFEST).places!.places.island!.half.phone;
    // k = (800/2560) / (1152/2560) = 0.6944: [0.05, 0.65] -> [0.1875, 0.6042].
    expect(ph.subjectBand).toEqual([0.1875, 0.6042]);
    expect(ph.focal).toEqual({ x: 0.5, y: 0.3958 });
  });
});

describe('spec 1.22: places-v3’s to places-v6’s phone shape (1.82:1, 2560 × 1408, the desktop base 320 px down it)', () => {
  // Measured at 390 × 844: a phone's half is 376 × 176 (2.14:1) with one row of cards and 376 × 234 (1.61:1) with two;
  // places-v2's 2.22:1 base was too wide for the second.
  const V3 = validatePlaces(synthPlaces('v3'), MANIFEST);
  const slots = slotsOf(['mountain', 1], ['plains', 3], ['island', 2], ['swamp', 1]);
  const plan = pairFullPlan(halfLayout(slots, PACK, null, null), null, { thresholds: T, slots, places: V3.places! });
  it('validates clean; a phone piece is its desktop piece’s file, its box moved 320 px down a 1408 px base', () => {
    expect(V3.errors).toEqual([]);
    const c = V3.places!.places['island+swamp+plains+mountain']!;
    expect(c.half.phone).toMatchObject({ width: 2560, height: 1408 });
    const st = c.layers.plains![2]!;
    expect(st.phone!.src).toBe(st.half!.src);
    expect(st.phone!.y).toBeCloseTo((320 + st.half!.y * 800) / 1408, 4);
    expect(st.phone!.h).toBeCloseTo((st.half!.h * 800) / 1408, 4);
  });
  it('both measured phone halves draw the phone base and its pieces; on a desktop the cut-over is near 2.41:1', () => {
    for (const aspect of [2.14, 1.61]) {
      for (const narrow of [true, false]) {
        const c = planCandidates(plan, aspect, narrow)![0]!;
        expect(c.art.source, `${aspect} ${narrow}`).toBe('phone');
        expect(c.art.picture!.height).toBe(1408);
      }
    }
    expect(planCandidates(plan, 2.35, false)![0]!.art.source).toBe('phone');
    expect(planCandidates(plan, 2.5, false)![0]!.art.source).toBe('half');
  });
  it('a phone base with no subject band: the desktop band mapped 320 px down (k = 800 / 1408)', () => {
    const raw = synthPlaces('v3');
    delete raw.places.island.half.phone.subjectBand;
    delete raw.places.island.half.phone.focal;
    delete raw.places.island.half.phone.safe;
    const ph = validatePlaces(raw, MANIFEST).places!.places.island!.half.phone;
    expect(ph.subjectBand).toEqual([0.2443, 0.5852]);
    expect(ph.focal).toEqual({ x: 0.5, y: 0.4148 });
  });
});
