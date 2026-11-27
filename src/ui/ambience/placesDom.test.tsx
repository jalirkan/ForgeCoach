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
 * once; nothing stands over a place. Spec 1.23: a place change with a camera
 * draws three frames (the new place settled beneath, both moving frames under the move's transforms) (`data-camera` while it runs),
 * a refused one (no land shared) and a stage step none, the settled frame none and no mask. The
 * timing itself (the fade in, the old
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
import { PlaceLandView, PlacePanel, PlacePanelView, revealStyle, SceneryStrip, type PlacePayload } from './SceneryStrip.tsx';
import { readFileSync } from 'node:fs';
import { fadeStack, settleFades, type FadeEntry } from '../../ambience/growth.ts';
import { CAMERA_IDLE, cameraEnd, cameraMark, cameraStep, type CameraRun, type CameraState } from '../../ambience/placeCamera.ts';
import { placePieces } from '../../ambience/places.ts';
import { ScenePieces } from './ScenePieces.tsx';

const BASE = 'https://example.org/pack/';
const PLACES_URL = 'https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@places-v6/';
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

// ---------------------------------------------------------------------------
// Spec 1.23: the place change is a camera move, on the live pack's file (places-v6).

const V6: PlacesPack = validatePlaces(JSON.parse(readFileSync(new URL('../../ambience/testdata/places-v6.places.json', import.meta.url), 'utf8')), `${PLACES_URL}places.json`).places!;
const packV6: ScenePack = { ...pack, places: V6 };
/** A place's first paint for these slots, at the desktop shape: its key (the base's file), its payload and its camera input. */
function drawnOf(slots: SlotState[]) {
  const plan = pairFullPlan(halfLayout(slots, packV6), null, { thresholds: packV6.stageThresholds, slots, places: V6 });
  const s = plan![0] as PairFullScene;
  const shown = planCandidates(plan, 3.2, false)![0]!;
  for (const p of placePieces(s.place!.lands, false)) if (p.piece) markPicture(p.piece.src, true);
  const payload: PlacePayload = { art: shown.art, pieces: shown.place!.pieces };
  return { key: shown.art.picture!.src, payload, slug: s.place!.place.slug, scene: s.key, drawn: { key: shown.art.picture!.src, art: shown.art, place: s.place!.place } };
}
const CUSCO = [slot('plains', 0, 1), slot('mountain', 1, 1)];
const SICILY = [...CUSCO, slot('island', 2, 1)];
// Two homelands at stage 1: no land shared (and no piece), so no move.
const VENICE = [slot('island', 0, 1)];
const SWAMP_HOME = [slot('swamp', 0, 1)];
const MS = 1200;
/** The stack and the camera after a change from one place to the other (each first painted at once). */
function change(from: SlotState[], to: SlotState[]) {
  const a = drawnOf(from);
  const b = drawnOf(to);
  const s0: CameraState = cameraStep(CAMERA_IDLE, a.drawn, MS);
  const st: CameraState = cameraStep(s0, b.drawn, MS);
  const stack: FadeEntry<PlacePayload>[] = fadeStack(fadeStack<PlacePayload>([], { key: a.key, payload: a.payload }, null, 0, true), { key: b.key, payload: b.payload }, null, 0, false);
  return { a, b, run: st.run, stack, st };
}
const view = (b: ReturnType<typeof drawnOf>, stack: readonly FadeEntry<PlacePayload>[], camera: CameraRun | null) =>
  renderToStaticMarkup(<PlacePanelView slug={b.slug} sceneKey={b.scene} source="half" stack={stack} camera={camera} first ms={MS} reduced={false} />);
const frameStyles = (html: string) => [...html.matchAll(/<div class="scn-frame" style="([^"]*)"/g)].map((m) => m[1]!);
/** The frames being wiped away (a place leaving with no camera move): their styles. */
const wipedStyles = (html: string) => [...html.matchAll(/<div class="scn-frame scn-reveal-out" style="([^"]*)"/g)].map((m) => m[1]!);
const frameCss = (art: PlacePayload['art']) => Object.entries(halfFrameCss(art)).map(([k, v]) => `${k}:${v}`).join(';');

describe('spec 1.23: the place change is a camera move', () => {
  it('Cusco → Sicily: three frames under the move -- the new place settled beneath (no transform, no mask), the new one moving from the inverse map and the old one from the identity, both with the soft edge -- then run to the end under the cross-fade’s transition, `data-camera` set; settled, one frame, gone, with no transform and no mask', () => {
    const { a, b, run, stack } = change(CUSCO, SICILY);
    expect(run).not.toBeNull();
    expect(cameraMark(run!.map)).toBe('0.648,0.358,0.110');
    expect(stack.map((e) => [e.key, e.role])).toEqual([[b.key, 'cur'], [a.key, 'out']]);
    // The move's first paint: the start transforms, no transition yet.
    let html = view(b, stack, run);
    expect(attrs(html, 'data-camera')).toEqual(['0.648,0.358,0.110']);
    expect(attrs(html, 'data-camera-frame')).toEqual(['under', 'to', 'from']);
    let [under, nu, old] = frameStyles(html);
    // Beneath: exactly 1.22's settled frame of the new place.
    expect(under).toBe(frameCss(b.payload.art));
    expect(nu).toContain(`transform:${run!.css.new.from.transform};transform-origin:0 0`);
    expect(old).toContain('transform:translate(0px, 0px) scale(1);transform-origin:0 0');
    expect(html).not.toContain('transition:transform');
    // Both moving frames carry the soft edge for the whole move.
    for (const f of [nu, old]) {
      expect(f).toContain('mask-size:100% 100%, 100% 100%');
      expect(f).toMatch(/mask-image:linear-gradient\(to right, transparent 0, #000 8%, #000 92%, transparent 100%\)/);
    }
    // Every frame holds its base and its pieces: the new place twice (beneath and moving), the old once.
    expect(attrs(html, 'src').filter((x) => x === b.key)).toHaveLength(2);
    expect(attrs(html, 'src').filter((x) => x === a.key)).toHaveLength(1);
    expect(attrs(html, 'data-piece')).toEqual(['island1', 'plains1', 'mountain1', 'island1', 'plains1', 'mountain1', 'plains1', 'mountain1']);
    // Running: the end transforms, under the cross-fade's time and easing; the frame beneath never moves.
    html = view(b, stack, { ...run!, phase: 'run' });
    [under, nu, old] = frameStyles(html);
    expect(under).toBe(frameCss(b.payload.art));
    expect(nu).toContain('transform:translate(0px, 0px) scale(1)');
    expect(old).toContain(`transform:${run!.css.old.to.transform}`);
    for (const f of [nu, old]) {
      expect(f).toContain('mask-size:100% 100%, 100% 100%');
      expect(f).toContain('transition:transform 1200ms cubic-bezier(0.4, 0, 0.2, 1)');
    }
    // Settled: 1.22's frame byte for byte -- no transform, no mask, no data-camera.
    html = view(b, settleFades(stack), null);
    expect(attrs(html, 'data-camera')).toEqual([]);
    expect(attrs(html, 'data-camera-frame')).toEqual([]);
    expect(frameStyles(html)).toEqual([frameCss(b.payload.art)]);
    expect(html).not.toMatch(/transform|mask/);
  });

  it('a change straight back mid-move (Cusco → Sicily → Cusco): Sicily stays drawn under the move to its end, then Cusco comes back by a plain cross-fade, no frame transformed or masked', () => {
    const { a, b, st, stack } = change(CUSCO, SICILY);
    // Back to Cusco while the move runs: held, Sicily still drawn, the move's three frames unchanged.
    const held = cameraStep(st, a.drawn, MS);
    expect([held.drawn!.key, held.run]).toEqual([b.key, st.run]);
    expect(attrs(view(b, stack, { ...held.run!, phase: 'run' }), 'data-camera-frame')).toEqual(['under', 'to', 'from']);
    // The move ends and the stack settles on Sicily; then the held change: no camera, the plain 1.22 cross-fade.
    const after = cameraStep(cameraEnd(held), a.drawn, MS);
    expect([after.drawn!.key, after.run]).toEqual([a.key, null]);
    const back = fadeStack(settleFades(stack), { key: a.key, payload: a.payload }, null, 0, false);
    expect(back.map((e) => [e.key, e.role])).toEqual([[a.key, 'cur'], [b.key, 'out']]);
    const html = view(a, back, after.run);
    expect(attrs(html, 'data-camera')).toEqual([]);
    // (the place leaving is wiped away, below: its frame carries the wipe, never a transform)
    expect(frameStyles(html)).toEqual([frameCss(a.payload.art)]);
    expect(wipedStyles(html)).toHaveLength(1);
    expect(html).not.toMatch(/transform|data-camera/);
  });

  it('a change with no camera is a wipe (2026-11-27): the new place whole beneath, the old one opaque above it and wiped away from the new land’s site, neither transformed', () => {
    // Cusco (plains, mountain) → Sicily (island, plains, mountain): the island is the new land.
    const a = drawnOf(CUSCO);
    const b = drawnOf(SICILY);
    const stack = fadeStack(fadeStack<PlacePayload>([], { key: a.key, payload: a.payload }, null, 0, true), { key: b.key, payload: b.payload }, null, 0, false);
    expect(stack.map((e) => [e.key, e.role])).toEqual([[b.key, 'cur'], [a.key, 'out']]);
    const html = view(b, stack, null);
    expect(frameStyles(html)).toEqual([frameCss(b.payload.art)]);
    const [old] = wipedStyles(html);
    const island = b.payload.pieces.find((p) => p.biome === 'island')!.piece!;
    const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
    expect(old).toBe(`${frameCss(a.payload.art)};--scn-rx:${pct(island.x + island.w / 2)};--scn-ry:${pct(island.y + island.h / 2)};animation-duration:${MS}ms`);
    expect(revealStyle(a.payload, b.payload, MS)).toMatchObject({ animationDuration: `${MS}ms` });
    // Neither layer fades: every point shows one painting or the other (the old one's opacity is never lowered).
    expect(html).not.toMatch(/opacity:0/);
    expect(html).not.toMatch(/transform|data-camera/);
    // A land that left starts the wipe where it stood in the old place; no land changed: the middle.
    const left = a.payload.pieces.find((p) => p.biome === 'plains')!.piece!;
    expect(revealStyle(a.payload, { ...a.payload, pieces: a.payload.pieces.filter((p) => p.biome !== 'plains') }, MS)).toMatchObject({ '--scn-rx': pct(left.x + left.w / 2) });
    expect(revealStyle(a.payload, a.payload, MS)).toMatchObject({ '--scn-rx': '50%', '--scn-ry': '60%' });
    // Reduced motion (no time): the old place is not drawn at all.
    expect(wipedStyles(renderToStaticMarkup(<PlacePanelView slug={b.slug} sceneKey={b.scene} source="half" stack={fadeStack(fadeStack<PlacePayload>([], { key: a.key, payload: a.payload }, null, 0, true), { key: b.key, payload: b.payload }, null, 0, true)} camera={null} first ms={0} reduced />))).toEqual([]);
  });

  it('a refused change (no land shared: Venice → the swamp’s homeland) is exactly 1.22’s cross-fade: two frames, neither transformed, no data-camera', () => {
    const { b, run, stack } = change(VENICE, SWAMP_HOME);
    expect(run).toBeNull();
    const html = view(b, stack, run);
    expect(attrs(html, 'data-camera')).toEqual([]);
    expect(frameStyles(html)).toEqual([frameCss(b.payload.art)]);
    expect(wipedStyles(html)).toHaveLength(1);
    expect(html).not.toMatch(/transform/);
  });

  it('a stage step inside a place never sets a transform', () => {
    const one = drawnOf(SICILY);
    const two = drawnOf([slot('plains', 0, 2), slot('mountain', 1, 1), slot('island', 2, 1)]);
    expect(two.key).toBe(one.key);
    const st = cameraStep(cameraStep(CAMERA_IDLE, one.drawn, MS), two.drawn, MS);
    expect(st.run).toBeNull();
    const stack = fadeStack(fadeStack<PlacePayload>([], { key: one.key, payload: one.payload }, null, 0, true), { key: two.key, payload: two.payload }, null, 0, false);
    const html = view(two, stack, st.run);
    expect(frameStyles(html)).toHaveLength(1);
    expect(html).not.toMatch(/transform|mask|data-camera/);
  });
});
