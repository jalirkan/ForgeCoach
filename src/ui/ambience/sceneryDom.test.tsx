/*
 * ForgeCoach — ui/ambience/sceneryDom.test.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The scenery review (2026-10-24) found three faults no test could see,
 * because nothing rendered the scenery: the strip and the pieces drew
 * different pairs at four colours while the caption promised an element
 * (fault 1), the pieces painted under the accents (fault 2), and a slow
 * panorama left a half blank (fault 4). These render the real components
 * (react-dom/server: no layout effect runs, so ScenePieces is handed its box)
 * and read what they drew.
 */
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Biome, SlotState } from '../../ambience/model.ts';
import { validateManifest, type PackPieces, type ScenePack } from '../../ambience/manifest.ts';
import { markPicture, resetPictures } from '../../ambience/pack.ts';
import { pairFullCaption, pairFullPlan } from '../../ambience/pairfull.ts';
import { pairPanoramaAt, validatePairs, type PairsPack } from '../../ambience/pairs.ts';
import { elementBiomes } from '../../ambience/pieces.ts';
import { halfLayout } from '../../ambience/layout.ts';
import { FORGECOACH_PAIRS_FULL_URL } from '../../ambience/prefs.ts';
import { SceneryStrip } from './SceneryStrip.tsx';
import { ScenePieces } from './ScenePieces.tsx';
import { HalfScenery } from './SceneryLayer.tsx';

const BASE = 'https://example.org/pack/';
const slot = (biome: Biome, index: number, weight: number): SlotState => ({ biome, index, weight, stage: Math.min(6, Math.ceil(weight)), peak: Math.min(6, Math.ceil(weight)) });
const piece = (src: string) => ({ src, width: 600, height: 300 });
const pairsV4: PairsPack = validatePairs(JSON.parse(readFileSync(new URL('../../ambience/testdata/pairs-v4.pairs.json', import.meta.url), 'utf8')), `${FORGECOACH_PAIRS_FULL_URL}pairs.json`).pairs!;
const biomeStages = (b: string) => [1, 2, 3, 4, 5, 6].map((k) => ({ layers: [], half: { src: `${b}/s${k}-half.webp` }, ...(k >= 2 ? { overlay: [{ id: `${b}-scatter`, anchor: 'area', src: `${b}/scatter.webp` }, { id: `${b}-vine`, anchor: 'bottom-left', src: `${b}/vine.webp` }] } : {}) }));
const manifest = {
  schema: 1,
  stageThresholds: [1, 2, 3, 4, 5, 6],
  half: { seamRatio: 0.1, minShare: 0.15, mist: 0.22 },
  biomes: Object.fromEntries(['plains', 'island', 'swamp', 'mountain', 'forest'].map((b) => [b, { stages: biomeStages(b) }])),
  pieces: {
    elements: Object.fromEntries(['W', 'U', 'B', 'R', 'G'].map((c) => [c, piece(`el/${c}.webp`)])),
    fronts: { U: { frames: [{ src: 'fr/u1.webp' }] } },
    veils: { won: piece('veil/won.webp'), lost: piece('veil/lost.webp') },
    empty: { src: 'empty/half.webp' },
  },
};
const read = validateManifest(manifest, BASE);
const pack: ScenePack = { ...read.pack!, pairs: pairsV4 };
const pieces: PackPieces = pack.pieces!;
const ELEMENTS = elementBiomes(pieces);
const BOX = { w: 1600, h: 500 };

/** Every `data-*` value an attribute takes in the markup. */
const attrs = (html: string, name: string) => [...html.matchAll(new RegExp(`${name}="([^"]*)"`, 'g'))].map((m) => m[1]!);

beforeAll(() => {
  // react-dom/server warns that layout effects do nothing on the server; that is the point here.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => resetPictures());

function drawHalf(slots: SlotState[]) {
  const strip = renderToStaticMarkup(<SceneryStrip slots={slots} pack={pack} reduced={true} fill="half" pairFull={true} elements={ELEMENTS} />);
  const pcs = renderToStaticMarkup(<ScenePieces pack={pack} pieces={pieces} slots={slots} landNames={[]} outcome={null} edge="bottom" reduced={true} pairFull={true} initialBox={BOX} />);
  const caption = pairFullCaption(pairFullPlan(halfLayout(slots, pack), pack.pairs, { thresholds: pack.stageThresholds, elements: ELEMENTS, slots }));
  return { strip, pcs, caption };
}

/** Mark every panorama of a pair, and every element, loaded. */
function loadAll() {
  for (const p of Object.values(pairsV4.pairs)) for (let k = 1; k <= p!.stages.length; k++) markPicture(pairPanoramaAt(p, k)!.src, true);
  for (const c of ['W', 'U', 'B', 'R', 'G'] as const) markPicture(pieces.elements[c]!.src, true);
}

describe('the strip, the caption and the pieces draw the same pair and element (fault 1)', () => {
  const cases: [string, SlotState[], string, string][] = [
    // name, slots, the pair, the element's biome
    ['1 + 1 + 1 + 1', [slot('plains', 0, 1), slot('island', 1, 1), slot('swamp', 2, 1), slot('mountain', 3, 1)], 'island+plains', 'swamp'],
    ['one Mountain and one Swamp beside a heavy pair (the live case: 33/67)', [slot('island', 0, 2), slot('plains', 1, 2), slot('mountain', 2, 1), slot('swamp', 3, 1)], 'island+plains', 'mountain'],
    ['four unequal', [slot('mountain', 0, 1), slot('plains', 1, 3), slot('island', 2, 2), slot('swamp', 3, 1.5)], 'island+plains', 'swamp'],
    ['five', [slot('forest', 0, 1), slot('swamp', 1, 1), slot('plains', 2, 2), slot('island', 3, 2), slot('mountain', 4, 1)], 'island+plains', 'forest'],
  ];
  for (const [name, slots, pair, element] of cases)
    it(name, () => {
      loadAll();
      const { strip, pcs, caption } = drawHalf(slots);
      expect(attrs(strip, 'data-pairfull')).toEqual([pair]);
      expect(attrs(strip, 'data-pairfull-element')).toEqual([element]);
      // The pair is panned by its own two weights: 50/50 here whatever the dropped colours weigh.
      expect(caption).toContain(`; ${element} as an element`);
      const colour = { plains: 'W', island: 'U', swamp: 'B', mountain: 'R', forest: 'G' }[element];
      expect(attrs(pcs, 'data-pc-colour')).toEqual([colour]);
      expect(attrs(pcs, 'data-pieces-element')).toEqual([colour]);
      expect(attrs(pcs, 'data-pieces-pair')[0]!.split('').sort().join('')).toBe(pair.split('+').map((b) => ({ plains: 'W', island: 'U', swamp: 'B', mountain: 'R', forest: 'G' })[b as 'plains']).sort().join(''));
    });

  it('the live case is panned 50/50, not 33/67', () => {
    loadAll();
    const { strip, caption } = drawHalf([slot('island', 0, 2), slot('plains', 1, 2), slot('mountain', 2, 1), slot('swamp', 3, 1)]);
    expect(attrs(strip, 'data-pairfull-split')).toEqual(['0.5']);
    expect(caption).toContain('island 50% | plains 50%');
  });
});

describe('the panorama’s load gate (fault 4)', () => {
  const two = [slot('island', 0, 4), slot('plains', 1, 1)];
  // A half that drew something before HOLDS it while the pair picture loads (pairfull.ts `pairFullHold`, tested in
  // pairs-elements.test.ts); react-dom/server draws every half for the first time, so this is the half with nothing before.
  it('a first draw with nothing loaded: the half is drawn as without the flag (its panels), never blank', () => {
    const html = renderToStaticMarkup(<SceneryStrip slots={two} pack={pack} reduced={true} fill="half" pairFull={true} />);
    expect(attrs(html, 'data-pairfull')).toEqual([]);
    expect(html).toContain('island/s4-half.webp');
    expect(html).toContain('plains/s1-half.webp');
  });
  it('the panorama loaded: the pair picture across the half', () => {
    const pano = pairPanoramaAt(pairsV4.pairs['island+plains'], 3)!;
    markPicture(pano.src, true);
    const html = renderToStaticMarkup(<SceneryStrip slots={two} pack={pack} reduced={true} fill="half" pairFull={true} />);
    expect(attrs(html, 'data-pairfull')).toEqual(['island+plains']);
    expect(attrs(html, 'data-pairfull-panorama')).toEqual(['yes']);
    expect(html).toContain(pano.src);
  });
  it('the panorama failed: the stage’s 1.9 half once it loads, the panels until then', () => {
    const p = pairsV4.pairs['island+plains']!;
    markPicture(pairPanoramaAt(p, 3)!.src, false);
    expect(attrs(renderToStaticMarkup(<SceneryStrip slots={two} pack={pack} reduced={true} fill="half" pairFull={true} />), 'data-pairfull')).toEqual([]);
    markPicture(p.stages[2]!.half!.src, true);
    const html = renderToStaticMarkup(<SceneryStrip slots={two} pack={pack} reduced={true} fill="half" pairFull={true} />);
    expect(attrs(html, 'data-pairfull')).toEqual(['island+plains']);
    expect(attrs(html, 'data-pairfull-panorama')).toEqual([]);
  });
  it('an element is not drawn until its picture has loaded', () => {
    for (const p of Object.values(pairsV4.pairs)) for (let k = 1; k <= 3; k++) markPicture(pairPanoramaAt(p, k)!.src, true);
    const slots = [slot('plains', 0, 1.5), slot('island', 1, 1), slot('mountain', 2, 0.5)];
    expect(attrs(drawHalf(slots).pcs, 'data-pc-colour')).toEqual([]);
    markPicture(pieces.elements.R!.src, true);
    expect(attrs(drawHalf(slots).pcs, 'data-pc-colour')).toEqual(['R']);
  });
});

describe('spec 1.16: a painted-in element replaces the cut-out', () => {
  it('the strip draws the painted panorama and the pieces draw no cut-out over it', () => {
    const p = pairsV4.pairs['island+plains']!;
    // pairs-v4 has none yet: give stage 2 a painted red, as the batch being painted will.
    const painted = { ...p.stages[1]!.panorama!, src: `${FORGECOACH_PAIRS_FULL_URL}pairs/island-plains/s2+R-panorama.webp` };
    const withPainted: PairsPack = { ...pairsV4, pairs: { ...pairsV4.pairs, 'island+plains': { ...p, stages: p.stages.map((st, i) => (i === 1 ? { ...st, elements: { R: { left: null, right: null, any: painted } } } : st)) } } };
    const local: ScenePack = { ...pack, pairs: withPainted };
    loadAll();
    markPicture(painted.src, true);
    const slots = [slot('plains', 0, 1.5), slot('island', 1, 1), slot('mountain', 2, 0.5)];
    const strip = renderToStaticMarkup(<SceneryStrip slots={slots} pack={local} reduced={true} fill="half" pairFull={true} elements={ELEMENTS} />);
    expect(attrs(strip, 'data-pairfull-painted')).toEqual(['R']);
    expect(strip).toContain(painted.src);
    const pcs = renderToStaticMarkup(<ScenePieces pack={local} pieces={pieces} slots={slots} landNames={[]} outcome={null} edge="bottom" reduced={true} pairFull={true} initialBox={BOX} />);
    expect(attrs(pcs, 'data-pc-colour')).toEqual([]);
    // Not loaded yet: the base panorama and the cut-out element meanwhile.
    resetPictures();
    loadAll();
    expect(attrs(renderToStaticMarkup(<SceneryStrip slots={slots} pack={local} reduced={true} fill="half" pairFull={true} elements={ELEMENTS} />), 'data-pairfull-painted')).toEqual([]);
    expect(attrs(renderToStaticMarkup(<ScenePieces pack={local} pieces={pieces} slots={slots} landNames={[]} outcome={null} edge="bottom" reduced={true} pairFull={true} initialBox={BOX} />), 'data-pc-colour')).toEqual(['R']);
  });
});

describe('spec 1.16.1: pairs-v5’s sided pictures on the worked example (#ambience → Three colours)', () => {
  const V5 = 'https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v5/';
  const pairsV5: PairsPack = validatePairs(JSON.parse(readFileSync(new URL('../../ambience/testdata/pairs-v5.pairs.json', import.meta.url), 'utf8')), `${V5}pairs.json`).pairs!;
  const local: ScenePack = { ...pack, pairs: pairsV5 };
  // Plateau, Plains, Island: plains 1.5 (the board's left), island 1, mountain ½ -- island+plains at stage 2, mirrored.
  const slots = [slot('mountain', 0, 0.5), slot('plains', 0, 1.5), slot('island', 2, 1)];
  const strip = () => renderToStaticMarkup(<SceneryStrip slots={slots} pack={local} reduced={true} fill="half" pairFull={true} elements={ELEMENTS} />);
  const pcs = () => renderToStaticMarkup(<ScenePieces pack={local} pieces={pieces} slots={slots} landNames={[]} outcome={null} edge="bottom" reduced={true} pairFull={true} initialBox={BOX} />);
  const base = `${V5}pairs/island-plains/s2-panorama.webp`;
  const painted = `${V5}pairs/island-plains/s2+RR-panorama.webp`;

  it('draws the heavier colour’s painted picture (R: on plains’s ground), mirrored with the panorama, and no cut-out', () => {
    markPicture(base, true);
    markPicture(painted, true);
    for (const c of ['W', 'U', 'B', 'R', 'G'] as const) markPicture(pieces.elements[c]!.src, true);
    const html = strip();
    expect(attrs(html, 'data-pairfull')).toEqual(['island+plains']);
    expect(attrs(html, 'data-pairfull-painted')).toEqual(['R']);
    expect(attrs(html, 'data-pairfull-painted-side')).toEqual(['right']);
    expect(html).toContain('is-mirrored');
    expect(html).toContain(painted);
    expect(html).not.toContain(`${V5}pairs/island-plains/s2+RL-panorama.webp`);
    expect(attrs(pcs(), 'data-pc')).not.toContain('element');
  });

  it('until the painted picture has loaded: the base panorama and the cut-out meanwhile', () => {
    markPicture(base, true);
    markPicture(pieces.elements.R!.src, true);
    const html = strip();
    expect(attrs(html, 'data-pairfull-painted')).toEqual([]);
    expect(html).toContain(base);
    expect(attrs(pcs(), 'data-pc-colour')).toEqual(['R']);
  });
});

/**
 * Fault 2: the stacking on the half board. A mini cascade over scenery.css's
 * z-index rules (compound class selectors; the most classes win, then the
 * later rule), applied to the root elements SceneryLayer's own `HalfScenery`
 * renders, painted in (z-index, then DOM order) as in the host's isolated
 * stacking context.
 */
describe('stacking on the half board (fault 2)', () => {
  const css = readFileSync(new URL('./scenery.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: { sel: string[]; z: number; order: number }[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const z = /(?:^|;)\s*z-index:\s*(-?\d+)/.exec(m[2]!);
    if (!z) continue;
    for (const s of m[1]!.split(',')) {
      const sel = s.trim();
      if (/^(\.[\w-]+)+$/.test(sel)) rules.push({ sel: sel.split('.').filter(Boolean), z: Number(z[1]), order: rules.length });
    }
  }
  const zOf = (classes: string[]) => {
    const hits = rules.filter((r) => r.sel.every((c) => classes.includes(c))).sort((a, b) => a.sel.length - b.sel.length || a.order - b.order);
    return hits.length ? hits[hits.length - 1]!.z : null;
  };
  /** The top-level elements of a fragment's markup, in DOM order, with their classes. */
  const roots = (html: string) => {
    const out: string[][] = [];
    let depth = 0;
    for (const m of html.matchAll(/<(\/?)(\w+)([^>]*?)(\/?)>/g)) {
      const [, close, tag, rest, self] = m;
      const voidTag = /^(img|br|input|source)$/.test(tag!);
      if (close) {
        depth--;
        continue;
      }
      if (depth === 0) out.push((/class="([^"]*)"/.exec(rest!)?.[1] ?? '').split(/\s+/));
      if (!self && !voidTag) depth++;
    }
    return out;
  };
  const LAYERS: [string, (c: string[]) => boolean][] = [
    ['strip', (c) => c.includes('scn')],
    ['effects', (c) => c.includes('scn-fxs')],
    ['area', (c) => c.includes('scn-ovl-area')],
    ['accents', (c) => c.includes('scn-ovl') && !c.includes('scn-ovl-area')],
    ['pieces', (c) => c.includes('scn-pieces')],
  ];
  /** The layers HalfScenery draws, bottom to top. */
  const paintOrder = (html: string) => {
    const els = roots(html).map((c, dom) => ({ name: LAYERS.find(([, f]) => f(c))?.[0] ?? c.join('.'), z: zOf(c) ?? 0, dom }));
    return els.sort((a, b) => a.z - b.z || a.dom - b.dom);
  };
  const props = { pack, edge: 'bottom' as const, reduced: true, duals: {}, horizon: false, pairFull: false, elements: null, showing: null, scrimHost: null, version: 0, pieces, landNames: [], outcome: null, accents: true, measured: BOX };
  const slots = [slot('island', 0, 3), slot('plains', 1, 2)];

  it('the pieces paint over every scenery layer -- the land, every accent, the scrim and the effects -- and under the cards', () => {
    const order = paintOrder(renderToStaticMarkup(<HalfScenery {...props} slots={slots} fill={true} />));
    expect(order.map((x) => x.name)).toEqual(['strip', 'area', 'accents', 'pieces']);
    // All beneath the cards (z-index auto / 0 in the host's isolated context).
    expect(Math.max(...order.map((x) => x.z))).toBeLessThan(0);
    // The card-row scrim (HalfScenery's first child) and the effects (the strip's second root, before the accents) are -1
    // layers too, so earlier in the DOM at the pieces' z-index: beneath them.
    expect([zOf(['scn-scrims']), zOf(['scn-fxs', 'scn-bottom']), zOf(['scn-pieces'])]).toEqual([-1, -1, -1]);
  });

  it('the stacking the board had before is kept: land, full-area accent, then the -1 layers in DOM order', () => {
    expect([zOf(['scn', 'scn-half']), zOf(['scn-ovl', 'scn-ovl-area']), zOf(['scn-ovl']), zOf(['scn-scrims']), zOf(['scn-fxs'])]).toEqual([-3, -2, -1, -1, -1]);
    // Fill each side off: no pieces, and the strip's own order (the full-area accent under it).
    const order = paintOrder(renderToStaticMarkup(<HalfScenery {...props} slots={slots} fill={false} />));
    expect(order.map((x) => x.name)).toEqual(['area', 'strip', 'accents']);
  });

  it('the pieces fade into the mist at the pack’s own depth (fault 8)', () => {
    const html = renderToStaticMarkup(<ScenePieces pack={pack} pieces={pieces} slots={[slot('island', 0, 1)]} landNames={[]} outcome={null} edge="bottom" reduced={true} initialBox={BOX} />);
    expect(html).toMatch(/class="scn-pieces[^"]*" style="--scn-mist:22%"/);
  });
});
