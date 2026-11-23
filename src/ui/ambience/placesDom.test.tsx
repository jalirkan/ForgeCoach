/*
 * ForgeCoach — ui/ambience/placesDom.test.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.22, places on the board, rendered (sceneryDom.test.tsx's way:
 * react-dom/server, so no effect or timer runs -- what the first paint draws).
 * The frame holds the base and the right pieces at the right boxes; the phone
 * shape draws the phone base and the phone pieces; a stage step's pieces (the
 * state places.ts `pieceWant` gives PlaceLandPiece) keep the old beneath the
 * new fading in; a failed piece is skipped and marked; reduced motion is at
 * once; nothing stands over a place. The timing itself (the fade in, the old
 * one out, the place's cross-fade) is played in a real browser by
 * e2e/ambience.e2e.mjs.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Biome, SlotState } from '../../ambience/model.ts';
import { validateManifest, type ScenePack } from '../../ambience/manifest.ts';
import { markPicture, resetPictures } from '../../ambience/pack.ts';
import { pairFullPlan, planCandidates, type PairFullScene } from '../../ambience/pairfull.ts';
import { halfLayout, halfFrameCss } from '../../ambience/layout.ts';
import { elementBiomes } from '../../ambience/pieces.ts';
import { pieceWant, validatePlaces, type PlacesPack } from '../../ambience/places.ts';
import { synthPlaces } from '../../ambience/testdata/placesSynth.ts';
import { PlaceLandView, PlacePanel, SceneryStrip } from './SceneryStrip.tsx';
import { ScenePieces } from './ScenePieces.tsx';

const BASE = 'https://example.org/pack/';
const PLACES_URL = 'https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@places-v3/';
const slot = (biome: Biome, index: number, weight: number): SlotState => ({ biome, index, weight, stage: Math.min(6, Math.ceil(weight)), peak: Math.min(6, Math.ceil(weight)) });
const piece = (src: string) => ({ src, width: 600, height: 300 });
const biomeStages = (b: string) => [1, 2, 3, 4, 5, 6].map((k) => ({ layers: [], half: { src: `${b}/s${k}-half.webp` } }));
const manifest = {
  schema: 1,
  stageThresholds: [1, 2, 3, 4, 5, 6],
  biomes: Object.fromEntries(['plains', 'island', 'swamp', 'mountain', 'forest'].map((b) => [b, { stages: biomeStages(b) }])),
  pieces: { elements: Object.fromEntries(['W', 'U', 'B', 'R', 'G'].map((c) => [c, piece(`el/${c}.webp`)])), veils: { won: piece('veil/won.webp'), lost: piece('veil/lost.webp') }, empty: { src: 'empty/half.webp' } },
};
const PLACES: PlacesPack = validatePlaces(synthPlaces(), `${PLACES_URL}places.json`).places!;
const pack: ScenePack = { ...validateManifest(manifest, BASE).pack!, places: PLACES };
const ELEMENTS = elementBiomes(pack.pieces);
const BOX = { w: 1600, h: 500 };
const CARTAGENA = PLACES.places['island+swamp+plains+mountain']!;
// Board order is not the geography's: the place is found by its colours alone.
const SLOTS = [slot('mountain', 0, 1), slot('plains', 1, 3), slot('island', 2, 2), slot('swamp', 3, 1)];

const attrs = (html: string, name: string) => [...html.matchAll(new RegExp(`${name}="([^"]*)"`, 'g'))].map((m) => m[1]!);
const strip = (slots: SlotState[] = SLOTS, opts: { pairFull?: boolean; reduced?: boolean } = {}) =>
  renderToStaticMarkup(<SceneryStrip slots={slots} pack={pack} reduced={opts.reduced ?? true} fill="half" pairFull={opts.pairFull ?? true} elements={ELEMENTS} />);
/** Mark the base of a place and the pieces of a state loaded, at one shape. */
function load(p = CARTAGENA, stages: Partial<Record<Biome, number>> = { island: 2, swamp: 1, plains: 3, mountain: 1 }, phone = false) {
  markPicture(phone ? p.half.phone.src : p.half.src, true);
  for (const [b, k] of Object.entries(stages)) {
    const pc = p.layers[b as Biome]![k! - 1]!;
    const x = phone ? pc.phone : pc.half;
    if (x) markPicture(x.src, true);
  }
}

beforeAll(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => resetPictures());

describe('spec 1.22: a place on the board', () => {
  it('nothing loaded yet: the half’s panels (never blank), no place', () => {
    const html = strip();
    expect(attrs(html, 'data-place')).toEqual([]);
    expect(html).toContain('plains/s3-half.webp');
  });

  it('its base alone loaded: still not drawn (it would appear bare and pop its buildings in)', () => {
    markPicture(CARTAGENA.half.src, true);
    expect(attrs(strip(), 'data-place')).toEqual([]);
  });

  it('the base and the pieces of the state loaded: one frame holds the base and, above it, each live land’s piece at its box, in the geography’s order', () => {
    load();
    for (const pairFull of [true, false]) {
      const html = strip(SLOTS, { pairFull });
      expect(attrs(html, 'data-place')).toEqual(['cartagena']);
      expect(attrs(html, 'data-scene')).toEqual(['island2+swamp1+plains3+mountain1']);
      expect(attrs(html, 'data-art')).toEqual(['half']);
      expect(attrs(html, 'data-pairfull')).toEqual([]);
      expect(html).not.toContain('is-mirrored');
      expect(html).not.toContain('-half.webp');
      expect(attrs(html, 'data-piece')).toEqual(['island2', 'swamp1', 'plains3', 'mountain1']);
      // One frame: the base first, then the pieces, all inside the one .scn-frame.
      const frame = /<div class="scn-frame"[^>]*>(.*?)<\/div>/.exec(html)![1]!;
      expect(frame.indexOf(CARTAGENA.half.src)).toBe(frame.indexOf('<img') + frame.slice(frame.indexOf('<img')).indexOf(CARTAGENA.half.src));
      expect([...frame.matchAll(/<img /g)]).toHaveLength(5);
      // Each piece stretched to its box: left x, top y, width w, height h, as percentages of the frame.
      const isl = CARTAGENA.layers.island![1]!.half!;
      expect(frame).toContain(`style="left:${+(isl.x * 100).toFixed(4)}%;top:${+(isl.y * 100).toFixed(4)}%;width:${+(isl.w * 100).toFixed(4)}%;height:${+(isl.h * 100).toFixed(4)}%;opacity:1"`);
      expect(frame).toContain(`src="${isl.src}"`);
      const pl = CARTAGENA.layers.plains![2]!.half!;
      expect(frame).toContain(`left:${+(pl.x * 100).toFixed(4)}%;top:${+(pl.y * 100).toFixed(4)}%;width:${+(pl.w * 100).toFixed(4)}%;height:${+(pl.h * 100).toFixed(4)}%`);
    }
  });

  it('a homeland at stage 1 draws its base alone (a null piece adds nothing); at stage 2 its piece', () => {
    const home = PLACES.places.forest!;
    markPicture(home.half.src, true);
    let html = strip([slot('forest', 0, 1)]);
    expect(attrs(html, 'data-place')).toEqual(['forest']);
    expect(attrs(html, 'data-scene')).toEqual(['forest1']);
    expect(attrs(html, 'data-piece')).toEqual([]);
    markPicture(home.layers.forest![1]!.half!.src, true);
    html = strip([slot('forest', 0, 2)]);
    expect(attrs(html, 'data-piece')).toEqual(['forest2']);
  });

  // The phone shape, on places-v1's (a 4:5 phone base, its own piece files), places-v2's and places-v3's (a 2.22:1 / 1.82:1 phone base whose
  // pieces are the desktop files at other boxes): the manifest's own phone files and phone boxes, never a folder name.
  for (const [name, places, aspect] of [
    ['places-v1’s shape', PLACES, 0.8],
    ['places-v2’s shape', validatePlaces(synthPlaces('v2'), `${PLACES_URL}places.json`).places!, 2.1],
    ['places-v3’s shape', validatePlaces(synthPlaces('v3'), `${PLACES_URL}places.json`).places!, 1.61],
  ] as const)
    it(`the phone shape (${name}): the phone base and every land’s phone piece at its phone box`, () => {
      const C = places.places['island+swamp+plains+mountain']!;
      const want = ([['island', 2], ['swamp', 1], ['plains', 3], ['mountain', 1]] as const).map(([b, k]) => C.layers[b]![k - 1]!.phone!);
      for (const p of [C.half.phone, ...want]) markPicture(p.src, true);
      const plan = pairFullPlan(halfLayout(SLOTS, pack), null, { thresholds: pack.stageThresholds, slots: SLOTS, narrow: true, places });
      const s = plan![0] as PairFullScene;
      const shown = planCandidates(plan, aspect, true)![0]!;
      const html = renderToStaticMarkup(<PlacePanel s={s} shown={shown} first ms={0} reduced />);
      expect(attrs(html, 'data-art')).toEqual(['phone']);
      expect(html).toContain(`src="${C.half.phone.src}"`);
      expect(html).not.toContain(`src="${C.half.src}"`);
      expect(html).toContain(`style="${Object.entries(halfFrameCss(shown.art)).map(([k, v]) => `${k}:${v}`).join(';')}"`);
      expect(attrs(html, 'src')).toEqual([C.half.phone.src, ...want.map((p) => p.src)]);
      for (const p of want) expect(html).toContain(`left:${+(p.x * 100).toFixed(4)}%;top:${+(p.y * 100).toFixed(4)}%;width:${+(p.w * 100).toFixed(4)}%;height:${+(p.h * 100).toFixed(4)}%`);
    });

  // What this renders is PlaceLandView's markup for stacks the pure functions give (their timing and the state across a
  // change are places.test.ts's; the live fade is e2e/ambience.e2e.mjs step 8's).
  it('PlaceLandView draws a stack as given: the piece fading in at 0 on top, the one beneath at full, an out-fade over half the time, a reduced-motion stack alone', () => {
    const old = CARTAGENA.layers.island![1]!.half!;
    const nxt = CARTAGENA.layers.island![2]!.half!;
    const step = pieceWant(pieceWant([], old, true, 2), nxt, false, 3);
    const html = renderToStaticMarkup(<PlaceLandView biome="island" stage={3} stack={step} failed={false} ms={1200} />);
    expect(attrs(html, 'data-piece')).toEqual(['island2', 'island3']);
    expect(attrs(html, 'data-piece-role')).toEqual(['under', 'in']);
    const styles = attrs(html, 'style');
    expect(styles[0]).toMatch(/opacity:1;transition:opacity 1200ms ease/);
    expect(styles[1]).toMatch(/opacity:0;transition:opacity 1200ms ease/);
    // Once in, the old fades out over half the growth time.
    const out = renderToStaticMarkup(<PlaceLandView biome="island" stage={3} stack={step.map((e) => (e.role === 'in' ? { ...e, role: 'cur' as const, from: 1 } : { ...e, role: 'out' as const }))} failed={false} ms={1200} />);
    // (react-dom/server paints an element's first frame: the browser then carries it to 0 over the transition.)
    expect(attrs(out, 'data-piece-role')).toEqual(['out', 'cur']);
    expect(attrs(out, 'style')[0]).toMatch(/transition:opacity 600ms ease/);
    // Reduced motion: the step is the new piece alone, at once.
    const now = renderToStaticMarkup(<PlaceLandView biome="island" stage={3} stack={pieceWant(step, nxt, true, 3)} failed={false} ms={0} />);
    expect(attrs(now, 'data-piece')).toEqual(['island3']);
    expect(attrs(now, 'style')[0]).toMatch(/opacity:1"?$/);
  });

  it('a piece that failed to load is skipped and marked; the place is still drawn, never blank', () => {
    load(CARTAGENA, { island: 2, swamp: 1, mountain: 1 });
    markPicture(CARTAGENA.layers.plains![2]!.half!.src, false);
    const html = strip();
    expect(attrs(html, 'data-place')).toEqual(['cartagena']);
    expect(attrs(html, 'data-piece')).toEqual(['island2', 'swamp1', 'plains3', 'mountain1']);
    expect(attrs(html, 'data-piece-failed')).toEqual(['1']);
    expect(html).not.toContain(`src="${CARTAGENA.layers.plains![2]!.half!.src}"`);
    expect(html).toMatch(/<span hidden="" data-piece="plains3" data-piece-failed="1"><\/span>/);
  });

  it('the base failed: the half is planned as if the pack had no places (its panels here), never blank', () => {
    markPicture(CARTAGENA.half.src, false);
    for (const [b, k] of [['island', 2], ['swamp', 1], ['plains', 3], ['mountain', 1]] as const) markPicture(CARTAGENA.layers[b]![k - 1]!.half!.src, true);
    const html = strip();
    expect(attrs(html, 'data-place')).toEqual([]);
    expect(html).toContain('plains/s3-half.webp');
  });

  it('no piece of 1.14 over a place: no element, no cut-out, no veil -- with every element loaded', () => {
    load();
    for (const c of ['W', 'U', 'B', 'R', 'G'] as const) markPicture(pack.pieces!.elements[c]!.src, true);
    for (const pairFull of [true, false]) {
      const html = renderToStaticMarkup(<ScenePieces pack={pack} pieces={pack.pieces!} slots={SLOTS} landNames={[]} outcome="won" edge="bottom" reduced={true} pairFull={pairFull} initialBox={BOX} />);
      expect(attrs(html, 'data-pc-colour')).toEqual([]);
    }
  });
});
