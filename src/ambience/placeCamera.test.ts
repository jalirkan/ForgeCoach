/*
 * ForgeCoach — ambience/placeCamera.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.23, the place change is a camera move (placeCamera.ts): where a land
 * stands, the map for one and for several shared lands (hand-computed), every
 * refusal, the two frames' CSS (the new frame's shared land on the old one's at
 * every moment), the move across renders, and over the live pack's real file
 * (places-v4) how many of the 75 one-land steps move and how many are refused.
 * Nothing here touches the network.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Biome } from './model.ts';
import { GEOGRAPHY } from './pairs.ts';
import { FORGECOACH_PLACES_URL } from './prefs.ts';
import { validatePlaces, type PlacePiece, type PlaceStage } from './places.ts';
import { halfFrameCss, type HalfArt } from './layout.ts';
import { CAMERA_IDLE, cameraCss, cameraEnd, cameraMark, cameraStep, isCamera, placeCamera, placeLandBox, type CameraDrawn, type CameraMap, type CameraSide } from './placeCamera.ts';

type Box = [number, number, number, number] | null;
const pc = (b: Box): PlacePiece | null => (b ? { src: `p${b.join('_')}.webp`, x: b[0], y: b[1], w: b[2], h: b[3], width: null, height: null, bytes: null } : null);
/** A land's six stages, the same boxes at both shapes unless `phone` is given. */
const stages = (half: Box[], phone: Box[] = half): PlaceStage[] => half.map((b, i) => ({ half: pc(b), phone: pc(phone[i] ?? null) }));
/** A land standing at one box at every stage but the first (null, as a homeland's). */
const at = (x: number, w: number, y = 0.4, h = 0.3): PlaceStage[] => stages([null, [x, y, w, h], [x, y, w, h], [x, y, w, h], [x, y, w, h], [x, y, w, h]]);
function place(layers: Partial<Record<Biome, PlaceStage[]>>, horizon: number | null = null, size: [number, number] = [2560, 800]): CameraSide['place'] {
  const pic = (w: number, h: number) => ({ src: `base-${w}x${h}.webp`, src2x: null, width: w, height: h, subjectBand: [0.05, 0.7] as [number, number], focal: { x: 0.5, y: 0.5 }, safe: { x: 0, y: 0, w: 1, h: 1 }, ...(horizon === null ? {} : { horizon }) });
  return { lands: GEOGRAPHY.filter((b) => layers[b]), layers, half: { ...pic(size[0], size[1]), phone: pic(2560, 1408) } as CameraSide['place']['half'] };
}
const half = (p: CameraSide['place']): CameraSide => ({ place: p, phone: false });
const map = (c: ReturnType<typeof placeCamera>): CameraMap => {
  if (!isCamera(c)) throw new Error(`refused: ${c.refused}`);
  return c;
};

describe('spec 1.23: where a land stands', () => {
  it('the union of its six pieces’ boxes at the shape; a null piece adds nothing; all null: no box', () => {
    const p = place({
      forest: stages(
        [null, [0.3, 0.5, 0.1, 0.1], [0.25, 0.45, 0.2, 0.2], [0.25, 0.45, 0.2, 0.2], [0.2, 0.4, 0.3, 0.35], [0.1, 0.42, 0.25, 0.2]],
        [null, null, null, null, null, null],
      ),
    });
    const b = placeLandBox(p, 'forest', false)!;
    // x from 0.1 to 0.5, y from 0.4 to 0.75.
    expect(b.x).toBeCloseTo(0.1, 12);
    expect(b.y).toBeCloseTo(0.4, 12);
    expect(b.w).toBeCloseTo(0.4, 12);
    expect(b.h).toBeCloseTo(0.35, 12);
    expect(b.cx).toBeCloseTo(0.3, 12);
    expect(placeLandBox(p, 'forest', true)).toBeNull();
    expect(placeLandBox(p, 'island', false)).toBeNull();
  });
});

describe('spec 1.23: the map', () => {
  it('one shared land: s = wB / wA, its centre carried; the horizon of A to B’s', () => {
    // Forest: A at 0.2–0.4 (cx 0.3, w 0.2); B at 0.5–0.8 (cx 0.65, w 0.3). s = 1.5, tx = 0.65 - 1.5 * 0.3 = 0.2;
    // horizons 0.6 and 0.5: ty = 0.5 - 1.5 * 0.6 = -0.4.
    const a = place({ forest: at(0.2, 0.2) }, 0.6);
    const b = place({ island: at(0.05, 0.3), forest: at(0.5, 0.3) }, 0.5);
    const m = map(placeCamera(half(a), half(b)));
    expect(m.shared).toEqual(['forest']);
    expect(m.s).toBeCloseTo(1.5, 12);
    expect(m.tx).toBeCloseTo(0.2, 12);
    expect(m.ty).toBeCloseTo(-0.4, 12);
    expect(cameraMark(m)).toBe('1.500,0.200,-0.400');
  });

  it('two shared lands: the line through them (a null horizon is 0.5)', () => {
    // A: forest cx 0.25, mountain cx 0.75; B: forest cx 0.5, mountain cx 0.8. s = 0.3 / 0.5 = 0.6, tx = 0.5 - 0.6 * 0.25
    // = 0.35, ty = 0.5 - 0.6 * 0.5 = 0.2: one more land (the island, on the left) and the view pulls back.
    const a = place({ forest: at(0.15, 0.2), mountain: at(0.65, 0.2) });
    const b = place({ island: at(0.05, 0.25), forest: at(0.4, 0.2), mountain: at(0.7, 0.2) });
    const m = map(placeCamera(half(a), half(b)));
    expect(m.shared).toEqual(['forest', 'mountain']);
    expect(m.s).toBeCloseTo(0.6, 12);
    expect(m.tx).toBeCloseTo(0.35, 12);
    expect(m.ty).toBeCloseTo(0.2, 12);
    expect(cameraMark(m)).toBe('0.600,0.350,0.200');
  });

  it('three shared lands: the least-squares line', () => {
    // cxA 0.2, 0.5, 0.8; cxB 0.3, 0.5, 0.8. Means 0.5 and 1.6 / 3; Σ dA·dB = 0.07 + 0 + 0.08 = 0.15, Σ dA² = 0.18:
    // s = 5 / 6, tx = 1.6 / 3 - 5 / 12 = 0.116667; horizons 0.6 and 0.55: ty = 0.55 - 0.5 = 0.05.
    const a = place({ island: at(0.1, 0.2), swamp: at(0.4, 0.2), plains: at(0.7, 0.2) }, 0.6);
    const b = place({ island: at(0.2, 0.2), swamp: at(0.4, 0.2), plains: at(0.7, 0.2), mountain: at(0.92, 0.06) }, 0.55);
    const m = map(placeCamera(half(a), half(b)));
    expect(m.s).toBeCloseTo(5 / 6, 12);
    expect(m.tx).toBeCloseTo(1.6 / 3 - 5 / 12, 12);
    expect(m.ty).toBeCloseTo(0.05, 12);
    expect(cameraMark(m)).toBe('0.833,0.117,0.050');
  });

  it('one land out of order: the map is fitted on the largest subset in one order, the other left untracked', () => {
    // A: island cx 0.2, plains cx 0.5, mountain cx 0.8; B: plains cx 0.3, mountain cx 0.7, island cx 0.9 (right of both,
    // out of order). Largest subset in one order: plains, mountain. s = 0.4 / 0.3 = 4 / 3, tx = 0.3 - 4 / 3 * 0.5 = -0.36667;
    // null horizons: ty = 0.5 - 4 / 3 * 0.5 = -0.16667.
    const a = place({ island: at(0.1, 0.2), plains: at(0.4, 0.2), mountain: at(0.7, 0.2) });
    const b = place({ island: at(0.85, 0.1), plains: at(0.2, 0.2), mountain: at(0.6, 0.2) });
    const m = map(placeCamera(half(a), half(b)));
    expect(m.shared).toEqual(['plains', 'mountain']);
    expect(m.untracked).toEqual(['island']);
    expect(m.s).toBeCloseTo(4 / 3, 12);
    expect(m.tx).toBeCloseTo(0.3 - (4 / 3) * 0.5, 12);
    expect(m.ty).toBeCloseTo(0.5 - (4 / 3) * 0.5, 12);
    expect(cameraMark(m)).toBe('1.333,-0.367,-0.167');
  });

  it('two lands swapped: a tie of one land each, won by the box covering the most width in A (then the geography’s order)', () => {
    // A: forest 0.1-0.4 (cx 0.25, w 0.3), mountain 0.6-0.7 (cx 0.65); B: forest 0.7-0.9 (cx 0.8, w 0.2), mountain cx 0.2.
    // The forest covers more of A: one land, s = 0.2 / 0.3, tx = 0.8 - s * 0.25 = 0.63333, ty = 0.5 - s * 0.5 = 0.16667.
    const a = place({ forest: at(0.1, 0.3), mountain: at(0.6, 0.1) });
    const b = place({ forest: at(0.7, 0.2), mountain: at(0.15, 0.1) });
    const m = map(placeCamera(half(a), half(b)));
    expect([m.shared, m.untracked]).toEqual([['forest'], ['mountain']]);
    expect(cameraMark(m)).toBe('0.667,0.633,0.167');
    // Two lands at one centre in A are never both tracked; an equal cover goes to the first in the geography.
    const tie = place({ forest: at(0.4, 0.2), mountain: at(0.4, 0.2) });
    const m2 = map(placeCamera(half(tie), half(place({ forest: at(0.4, 0.2), mountain: at(0.7, 0.2) }))));
    expect([m2.shared, m2.untracked]).toEqual([['forest'], ['mountain']]);
  });

  it('a land with no box in one of them is not shared', () => {
    const a = place({ forest: at(0.2, 0.2), mountain: stages([null, null, null, null, null, null]) });
    const b = place({ forest: at(0.5, 0.3), mountain: at(0.8, 0.1) });
    const m = map(placeCamera(half(a), half(b)));
    expect([m.shared, m.untracked]).toEqual([['forest'], []]);
  });
});

describe('spec 1.23: refused -- a plain cross-fade', () => {
  const a = place({ forest: at(0.15, 0.2), mountain: at(0.65, 0.2) });
  const b = place({ island: at(0.05, 0.25), forest: at(0.4, 0.2), mountain: at(0.7, 0.2) });
  it('no shared land', () => {
    expect(placeCamera(half(place({ island: at(0.2, 0.2) })), half(place({ swamp: at(0.2, 0.2) })))).toEqual({ refused: 'none' });
  });
  it('s out of [0.5, 2]', () => {
    // One land: wB / wA = 0.08 / 0.2 = 0.4, and 0.45 / 0.2 = 2.25.
    expect(placeCamera(half(place({ forest: at(0.2, 0.2) })), half(place({ forest: at(0.5, 0.08) })))).toEqual({ refused: 'scale' });
    expect(placeCamera(half(place({ forest: at(0.2, 0.2) })), half(place({ forest: at(0.5, 0.45) })))).toEqual({ refused: 'scale' });
    // At the bounds themselves: moved.
    expect(map(placeCamera(half(place({ forest: at(0.2, 0.2) })), half(place({ forest: at(0.5, 0.1) })))).s).toBeCloseTo(0.5, 12);
    expect(map(placeCamera(half(place({ forest: at(0.2, 0.2) })), half(place({ forest: at(0.5, 0.4) })))).s).toBeCloseTo(2, 12);
  });
  it('the shapes differ: one drawn on the phone base and the other on the desktop base, or two bases of other shapes', () => {
    expect(placeCamera({ place: a, phone: false }, { place: b, phone: true })).toEqual({ refused: 'shape' });
    expect(placeCamera(half(a), half(place({ forest: at(0.4, 0.2), mountain: at(0.7, 0.2) }, null, [2048, 800])))).toEqual({ refused: 'shape' });
    expect(isCamera(placeCamera({ place: a, phone: true }, { place: b, phone: true }))).toBe(true);
  });
  it('reduced motion', () => {
    expect(placeCamera(half(a), half(b), { reduced: true })).toEqual({ refused: 'reduced' });
  });
});

// ---------------------------------------------------------------------------

const ART: HalfArt = { aspect: 3.2, focal: { x: 0.5, y: 0.5 }, safe: null, source: 'half' };
/** The translate (in % of the frame) and scale of a transform with no frame-offset term. */
function parse(t: string): { x: number; y: number; s: number } {
  const m = /^translate\(([-\d.]+)(?:%|px), ([-\d.]+)(?:%|px)\) scale\(([-\d.]+)\)$/.exec(t);
  if (!m) throw new Error(`not a plain transform: ${t}`);
  return { x: +m[1]! / 100, y: +m[2]! / 100, s: +m[3]! };
}

describe('spec 1.23: the two frames’ CSS', () => {
  it('the old frame from the identity to the map; the new from its inverse to the identity; a shared land of the new on the old one’s at every moment', () => {
    const c = { s: 0.6, tx: 0.35, ty: 0.2 };
    const css = cameraCss(c, ART, ART);
    expect(css.old.from.transform).toBe('translate(0px, 0px) scale(1)');
    expect(css.old.to.transform).toBe('translate(35%, 20%) scale(0.6)');
    expect(css.new.to.transform).toBe('translate(0px, 0px) scale(1)');
    // The inverse: x = (x' - tx) / s, so translate(-tx / s, -ty / s) scale(1 / s).
    expect(css.new.from.transform).toBe('translate(-58.3333%, -33.3333%) scale(1.666667)');
    // A CSS transition interpolates each function linearly: at progress e both frames are at their linear mix, and a
    // point x of A (its land) and its image x' = s*x + tx in B land on the same spot of the half.
    const lerp = (f: { x: number; y: number; s: number }, t: { x: number; y: number; s: number }, e: number) => ({ x: f.x + (t.x - f.x) * e, y: f.y + (t.y - f.y) * e, s: f.s + (t.s - f.s) * e });
    for (const e of [0, 0.25, 0.5, 0.9, 1]) {
      const o = lerp(parse(css.old.from.transform), parse(css.old.to.transform), e);
      const n = lerp(parse(css.new.from.transform), parse(css.new.to.transform), e);
      for (const x of [0.1, 0.45, 0.8]) expect(n.x + n.s * (c.s * x + c.tx)).toBeCloseTo(o.x + o.s * x, 5);
      for (const y of [0.3, 0.6]) expect(n.y + n.s * (c.s * y + c.ty)).toBeCloseTo(o.y + o.s * y, 5);
    }
  });

  it('the soft edge: on both moving frames, at their edges, for the whole move (they lie over the new place settled)', () => {
    for (const c of [{ s: 0.6, tx: 0.35, ty: 0.2 }, { s: 1.5, tx: 0.2, ty: -0.4 }]) {
      const css = cameraCss(c, ART, ART);
      expect([css.old.masked, css.new.masked]).toEqual([true, true]);
      for (const f of [css.old.from, css.old.to, css.new.from, css.new.to]) expect(f.maskSize).toBe('100% 100%, 100% 100%');
    }
  });

  it('two bases cropped differently: the translation carries the difference of the two frames’ offsets too', () => {
    const b = { ...ART, focal: { x: 0.6, y: 0.4 } };
    const css = cameraCss({ s: 0.6, tx: 0.35, ty: 0.2 }, ART, b);
    const [fa, fb] = [halfFrameCss(ART), halfFrameCss(b)];
    expect(css.old.to.transform).toBe(`translate(calc(1 * ((${fb.left}) - (${fa.left})) + 35%), calc(1 * ((${fb.top}) - (${fa.top})) + 20%)) scale(0.6)`);
    expect(css.new.from.transform).toBe(`translate(calc(-1 * ((${fb.left}) - (${fa.left})) + -58.3333%), calc(-1 * ((${fb.top}) - (${fa.top})) + -33.3333%)) scale(1.666667)`);
  });
});

describe('spec 1.23: the move across renders', () => {
  const a = place({ forest: at(0.15, 0.2), mountain: at(0.65, 0.2) });
  const b = place({ island: at(0.05, 0.25), forest: at(0.4, 0.2), mountain: at(0.7, 0.2) });
  const c = place({ island: at(0.05, 0.25), forest: at(0.4, 0.2), mountain: at(0.7, 0.2), swamp: at(0.2, 0.1) });
  const d = (key: string, p: CameraSide['place'], source: HalfArt['source'] = 'half'): CameraDrawn => ({ key, art: { ...ART, source }, place: p });

  it('the first paint never moves; a stage step (the same base) never moves; another base with a map starts a move', () => {
    let st = cameraStep(CAMERA_IDLE, d('A', a), 1200);
    expect(st.run).toBeNull();
    st = cameraStep(st, d('A', a), 1200);
    expect(st.run).toBeNull();
    st = cameraStep(st, d('B', b), 1200);
    expect(st.run).toMatchObject({ id: 1, from: 'A', to: 'B', phase: 'start' });
    expect(cameraMark(st.run!.map)).toBe('0.600,0.350,0.200');
    // A stage step inside the new place while it runs: the same move.
    const same = cameraStep(st, d('B', b), 1200);
    expect(same.run).toBe(st.run);
  });

  it('refused, reduced motion (ms 0 or the flag), or another shape: no move', () => {
    const st = cameraStep(CAMERA_IDLE, d('A', a), 1200);
    expect(cameraStep(st, d('B', b), 0).run).toBeNull();
    expect(cameraStep(st, d('B', b), 1200, true).run).toBeNull();
    expect(cameraStep(st, d('B', b, 'phone'), 1200).run).toBeNull();
    expect(cameraStep(st, d('X', place({ island: at(0.3, 0.2) })), 1200).run).toBeNull();
  });

  it('a change while a move runs is plain and lets the move finish', () => {
    let st = cameraStep(cameraStep(CAMERA_IDLE, d('A', a), 1200), d('B', b), 1200);
    const run = st.run;
    st = cameraStep(st, d('C', c), 1200);
    expect(st.run).toBe(run);
    expect(st.drawn!.key).toBe('C');
  });

  it('a change straight back mid-move (A -> B -> A) is held until the move ends, then a plain cross-fade from B at rest', () => {
    let st = cameraStep(cameraStep(CAMERA_IDLE, d('A', a), 1200), d('B', b), 1200);
    const run = st.run!;
    expect(run).toMatchObject({ from: 'A', to: 'B' });
    // Back to A while it runs: B stays drawn, the move runs on untouched.
    st = cameraStep(st, d('A', a), 1200);
    expect(st.drawn!.key).toBe('B');
    expect(st.run).toBe(run);
    expect(st.plain).toBe(true);
    // Rendered again before the end (the same wish): still held.
    st = cameraStep(st, d('A', a), 1200);
    expect([st.drawn!.key, st.run]).toEqual(['B', run]);
    // The move ends: then A is drawn, with no move (a plain cross-fade), and the next change may move again.
    st = cameraStep(cameraEnd(st), d('A', a), 1200);
    expect([st.drawn!.key, st.run, st.plain]).toEqual(['A', null, false]);
    expect(cameraStep(st, d('B', b), 1200).run).toMatchObject({ from: 'A', to: 'B' });
    // Back to B again before the end (A -> B -> A -> B): B is drawn as it was, the move unchanged, nothing held.
    let st2 = cameraStep(cameraStep(CAMERA_IDLE, d('A', a), 1200), d('B', b), 1200);
    const run2 = st2.run;
    st2 = cameraStep(cameraStep(st2, d('A', a), 1200), d('B', b), 1200);
    expect([st2.drawn!.key, st2.run, st2.plain]).toEqual(['B', run2, false]);
  });
});

describe('spec 1.23 over the live pack (places-v4, re-laid)', () => {
  const P = validatePlaces(JSON.parse(readFileSync(new URL('./testdata/places-v4.places.json', import.meta.url), 'utf8')), `${FORGECOACH_PLACES_URL}places.json`).places!;
  const of = (lands: Biome[]) => P.places[GEOGRAPHY.filter((b) => lands.includes(b)).join('+')]!;
  const bySlug = (slug: string) => Object.values(P.places).find((p) => p!.slug === slug)!;
  const step = (from: string, to: string, phone = false) => placeCamera({ place: bySlug(from), phone }, { place: bySlug(to), phone });

  it('of the 75 one-land steps (one colour more), 74 move (12 with a shared land left untracked) and 1 is refused for the scale, at both shapes', () => {
    for (const phone of [false, true]) {
      const tally: Record<string, number> = {};
      const partial: string[] = [];
      const refused: string[] = [];
      let n = 0;
      for (let m = 1; m < 32; m++)
        for (const extra of GEOGRAPHY) {
          const set = GEOGRAPHY.filter((_, i) => m & (1 << i));
          if (set.includes(extra)) continue;
          const [a, b] = [of(set), of([...set, extra])];
          const c = placeCamera({ place: a, phone }, { place: b, phone });
          const k = isCamera(c) ? 'move' : c.refused;
          tally[k] = (tally[k] ?? 0) + 1;
          if (isCamera(c) && c.untracked.length) partial.push(`${a.slug}->${b.slug}`);
          if (!isCamera(c)) refused.push(`${a.slug}->${b.slug}`);
          n++;
        }
      expect(n).toBe(75);
      expect(tally).toEqual({ move: 74, scale: 1 });
      // A homeland's one land, 0.4 times as wide in Santorini: no subset can pass.
      expect(refused).toEqual(['valley-of-mexico->santorini']);
      // Every step that leaves a land untracked reaches Cape Town, Zanzibar, Kathmandu (the three four-land places that
      // keep one land out of order) or Istanbul.
      expect(partial).toHaveLength(12);
      for (const x of partial) expect(x).toMatch(/->(cape-town|zanzibar|kathmandu|istanbul)$/);
    }
  });

  it('links in one order move on every shared land: Cusco → Sicily, Lisbon → Sicily, Angkor → Cambodia, Kyoto → Cambodia, Venice → Lisbon, Araucanía → Hawaii, Tahiti → Hawaii', () => {
    const marks: [string, string, string][] = [
      ['cusco', 'sicily', '0.669,0.346,0.144'],
      ['lisbon', 'sicily', '0.741,-0.021,0.084'],
      ['angkor', 'cambodia', '1.593,-0.337,-0.501'],
      ['kyoto', 'cambodia', '0.594,0.373,0.036'],
      ['venice', 'lisbon', '0.545,-0.023,0.312'],
      ['araucania', 'hawaii', '0.837,0.298,-0.196'],
      ['tahiti', 'hawaii', '0.817,-0.088,-0.177'],
    ];
    for (const [a, b, mark] of marks) {
      const m = map(step(a, b));
      expect(cameraMark(m), `${a} -> ${b}`).toBe(mark);
      expect(m.untracked, `${a} -> ${b}`).toEqual([]);
    }
    // The phone base's own horizons: Cusco → Sicily 0.157, Araucanía → Hawaii -0.074.
    expect(cameraMark(map(step('cusco', 'sicily', true)))).toBe('0.669,0.346,0.157');
    expect(cameraMark(map(step('araucania', 'hawaii', true)))).toBe('0.837,0.298,-0.074');
  });

  it('a land kept out of order is left untracked: Sicily → Cape Town moves on its island and plains, its mountain cross-fades', () => {
    const m = map(step('sicily', 'cape-town'));
    expect([m.shared, m.untracked]).toEqual([['island', 'plains'], ['mountain']]);
    expect(cameraMark(m)).toBe('1.317,-0.085,-0.270');
  });

  it('a subset of the largest size out of scale gives way to another of that size: Kolkata → Zanzibar, Alexandria → Zanzibar', () => {
    // Kolkata → Zanzibar: {swamp, forest} covers the most width but its s is about 2.2; {island, forest} gives 0.792.
    let m = map(step('kolkata', 'zanzibar'));
    expect([m.shared, m.untracked]).toEqual([['island', 'forest'], ['swamp']]);
    expect(cameraMark(m)).toBe('0.792,0.213,0.087');
    // Alexandria → Zanzibar: {island, plains} would be s 0.43; {swamp, plains} gives 1.359.
    m = map(step('alexandria', 'zanzibar'));
    expect([m.shared, m.untracked]).toEqual([['swamp', 'plains'], ['island']]);
    expect(cameraMark(m)).toBe('1.359,-0.471,-0.227');
  });

  it('refused on the scale when no subset passes: Valley of Mexico → Santorini', () => {
    expect(step('valley-of-mexico', 'santorini')).toEqual({ refused: 'scale' });
    expect(step('valley-of-mexico', 'santorini', true)).toEqual({ refused: 'scale' });
  });
});
