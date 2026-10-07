/*
 * ForgeCoach — ambience/half.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.5, the half board: the manifest's `half` pictures and layout and
 * their validation; the split of a half by land count; the cover crop about a
 * focal point with a safe rect (and its CSS twin, evaluated here at many
 * sizes); the card-row scrim's rectangles and the contrast it guarantees on
 * every skin; the "Fill each side" preference; the spec's example; and the
 * golden layouts for pack-v2, the built-in scenery and the example pack.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_HALF_LAYOUT, halfAt, halfBytes, halfUrls, hasHalfArt, layersAt, MAX_HALF_BYTES, validateManifest } from './manifest.ts';
import { halfArt, halfArtOf, halfFrame, pickHalfPicture, halfFrameCss, halfLayout, halfSpans, STRIP_ART, type HalfArt } from './layout.ts';
import { contrast, hexRgb, over, scrimRects, SCRIM_EDGE_ALPHA, type Rgb } from './scrim.ts';
import { DEFAULT_PREFS, effectivePrefs, fillOn, loadSceneryPrefs } from './prefs.ts';
import { halfGolden } from './testdata/halfGolden.ts';
import type { Biome, SlotState } from './model.ts';

const BASE = 'http://127.0.0.1:8650/scenery.json';
const slot = (biome: Biome, index: number, weight: number, stage: number): SlotState => ({ biome, index, weight, stage, peak: stage });
const half = (extra: Record<string, unknown> = {}) => ({ src: 'island/s1-half.webp', ...extra });
const packWith = (stages: unknown[], top: Record<string, unknown> = {}) => ({ schema: 1, spec: '1.5', ...top, biomes: { island: { stages } } });

describe('spec 1.5: validation', () => {
  it('reads the art session’s shape: desktop and phone pictures and the subject band, with defaults', () => {
    const r = validateManifest(
      packWith([
        { half: half() },
        { half: half({ src: 'island/s2-half.webp', src2x: 'island/s2-half@2x.webp', phone: { src: 'island/s2-phone.webp', src2x: 'island/s2-phone@2x.webp' }, subjectBand: [0.3, 0.6], bytes: 900000 }) },
        { half: half({ width: 3456, height: 1152, focal: { x: 0.4, y: 0.5 }, safe: { x: 0.2, y: 0.3, w: 0.5, h: 0.3 }, phone: { src: 'p.webp', width: 1080, height: 1350, subjectBand: [0.4, 0.7] } }) },
      ]),
      BASE,
    );
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    const [s1, s2, s3] = r.pack!.biomes.island!.stages;
    expect(s1!.half).toEqual({ src: 'http://127.0.0.1:8650/island/s1-half.webp', src2x: null, width: 2048, height: 640, subjectBand: [0.35, 0.6], focal: { x: 0.5, y: 0.475 }, safe: { x: 0.25, y: 0.35, w: 0.5, h: 0.25 }, phone: null, bytes: null });
    expect(s2!.half).toEqual({
      src: 'http://127.0.0.1:8650/island/s2-half.webp',
      src2x: 'http://127.0.0.1:8650/island/s2-half@2x.webp',
      width: 2048,
      height: 640,
      subjectBand: [0.3, 0.6],
      focal: { x: 0.5, y: 0.45 },
      safe: { x: 0.25, y: 0.3, w: 0.5, h: 0.3 },
      // The phone picture: 4:5 by default, the desktop band mapped into its middle (even outpainting): y ↦ 0.25 + y / 2.
      phone: { src: 'http://127.0.0.1:8650/island/s2-phone.webp', src2x: 'http://127.0.0.1:8650/island/s2-phone@2x.webp', width: 1024, height: 1280, subjectBand: [0.4, 0.55], focal: { x: 0.5, y: 0.475 }, safe: { x: 0.25, y: 0.4, w: 0.5, h: 0.15 } },
      bytes: 900000,
    });
    expect(s3!.half).toMatchObject({ width: 3456, height: 1152, focal: { x: 0.4, y: 0.5 }, safe: { x: 0.2, y: 0.3, w: 0.5, h: 0.3 }, phone: { width: 1080, height: 1350, subjectBand: [0.4, 0.7], focal: { x: 0.5, y: 0.55 } } });
    expect(r.pack!.half).toEqual(DEFAULT_HALF_LAYOUT);
    expect(hasHalfArt(r.pack)).toBe(true);
  });

  it('gives a stage with only a half picture a strip layer of it, so the strip still draws', () => {
    const r = validateManifest(packWith([{ half: half() }, { half: half({ src: 'island/s4-half.webp' }), layers: [{ id: 'motes', kind: 'video', src: 'island/m.webm', blend: 'screen', z: 10 }] }]), BASE);
    expect(r.warnings).toEqual([]);
    const isl = r.pack!.biomes.island!;
    expect(layersAt(isl, 1).map((l) => [l.id, l.kind, l.src, l.fit])).toEqual([['half', 'image', 'http://127.0.0.1:8650/island/s1-half.webp', 'cover']]);
    expect(layersAt(isl, 2).map((l) => [l.id, l.kind, l.z])).toEqual([
      ['half', 'image', -1],
      ['motes', 'video', 10],
    ]);
    // A stage with its own strip art keeps it as is.
    const both = validateManifest(packWith([{ half: half(), layers: [{ id: 'sky', kind: 'image', src: 'island/s1-sky.webp' }] }]), BASE);
    expect(layersAt(both.pack!.biomes.island!, 1).map((l) => l.id)).toEqual(['sky']);
    expect(halfAt(both.pack!.biomes.island!, 3)!.src).toBe('http://127.0.0.1:8650/island/s1-half.webp');
  });

  it('drops what it cannot use, with the path', () => {
    const r = validateManifest(
      packWith(
        [
          { half: { src: 'javascript:alert' }, layers: [{ id: 'sky', kind: 'image', src: 'island/a.webp' }] },
          { half: half({ src: 'island/b.gif' }) },
          { half: half({ width: 100, height: 4000, focal: { x: 2 }, safe: { x: 0.8, w: 0.5 }, src2x: 'data:x', subjectBand: [0.6, 0.3], phone: { src: 'p.gif' } }) },
          { half: 'island.webp', layers: [{ id: 'sky', kind: 'image', src: 'island/a.webp' }] },
          { half: half({ phone: 'p.webp' }) },
        ],
        { half: { seamRatio: 0.9, minShare: 0.01, mist: -1 } },
      ),
      BASE,
    );
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([
      'biomes.island.stages[0].half.src: the javascript: scheme is not allowed (http, https or relative only); picture dropped',
      'biomes.island.stages[1].half.src: expected .webp, .avif, .png or .jpg; picture dropped',
      'biomes.island.stages[1]: needs a "layers" list or a usable "half" picture; stage dropped',
      'biomes.island.stages[2].half.src2x: the data: scheme is not allowed (http, https or relative only); ignored',
      "biomes.island.stages[2].half: width and height are the 1x file's pixels (64–16384, a shape between 1:4 and 8:1); using 2048 × 640",
      'biomes.island.stages[2].half.subjectBand: [top, bottom], fractions 0–1 of the height from the top, at least 0.05 apart; using [0.35, 0.6]',
      'biomes.island.stages[2].half.focal: { x, y }, fractions 0–1 of the picture from its top-left; using the subject band’s middle',
      'biomes.island.stages[2].half.safe: the rect runs past the picture (x + w and y + h at most 1); ignored',
      'biomes.island.stages[2].half.phone.src: expected .webp, .avif, .png or .jpg; picture dropped',
      'biomes.island.stages[3].half: not an object; ignored',
      'biomes.island.stages[4].half.phone: not an object { src, src2x }; ignored',
      'half.seamRatio: 0.9 is out of range 0–0.3; using 0.1',
      'half.minShare: 0.01 is out of range 0.05–0.3; using 0.15',
      'half.mist: -1 is out of range 0–0.4; using 0.16',
    ]);
    expect(r.pack!.biomes.island!.stages.map((s) => !!s.half)).toEqual([false, true, false, true]);
    expect(r.pack!.biomes.island!.stages[1]!.half!.phone).toBeNull();
  });

  it('warns past the 8 MB budget for half pictures, counting each file once', () => {
    const big = (src: string) => half({ src, bytes: 3_000_000 });
    const r = validateManifest(packWith([{ half: big('a.webp') }, { half: big('a.webp') }, { half: big('b.webp') }, { half: big('c.webp') }]), BASE);
    expect(halfBytes(r.pack!.biomes.island)).toBe(9_000_000);
    expect(r.warnings).toEqual([`biomes.island: 8.6 MB of half pictures declared; their budget is ${MAX_HALF_BYTES / 1048576} MB per biome (pictures kept)`]);
  });

  it('lists the half pictures, stage 1 first', () => {
    const r = validateManifest({ schema: 1, biomes: { island: { stages: [{ half: half() }, { half: half({ src: 'i2.webp' }) }] }, forest: { stages: [{ half: half({ src: 'f1.webp' }) }] } } }, BASE);
    expect(halfUrls(r.pack!).map((u) => `${u.biome}${u.stage}:${u.url.split('/').pop()}`)).toEqual(['island1:s1-half.webp', 'forest1:f1.webp', 'island2:i2.webp']);
  });

  it('reads spec 1.5 with no warning, and an accents-only biome stays the built-in scene', () => {
    expect(validateManifest(packWith([{ half: half() }]), BASE).warnings).toEqual([]);
    const accents = validateManifest({ schema: 1, spec: '1.5', biomes: { forest: { stages: [{ overlay: [] }] } } }, BASE);
    expect(accents.pack!.biomes.forest).toBeUndefined();
  });

  it('leaves pack-v2 (a 1.3 pack) without half pictures', () => {
    const manifest = JSON.parse(readFileSync(new URL('./testdata/pack-v2.scenery.json', import.meta.url), 'utf8'));
    const r = validateManifest(manifest, BASE);
    expect(r.warnings).toEqual([]);
    expect(hasHalfArt(r.pack)).toBe(false);
    expect(r.pack!.half).toEqual(DEFAULT_HALF_LAYOUT);
  });
});

describe('spec 1.5: the split of a half', () => {
  it('shares the width by land count, each biome at its own stage', () => {
    // §5: 5 Islands : 1 Mountain = a stage-3 island beside a stage-1 mountain.
    const l = halfLayout([slot('island', 0, 5, 3), slot('mountain', 1, 1, 1)], null);
    expect(l.map((x) => [x.slot.biome, x.stage, x.share])).toEqual([
      ['island', 3, 0.833],
      ['mountain', 1, 0.167],
    ]);
    expect(halfLayout([slot('island', 0, 3, 2), slot('mountain', 1, 2, 2)], null).map((x) => x.share)).toEqual([0.6, 0.4]);
    expect(halfLayout([slot('swamp', 0, 3, 2), slot('mountain', 1, 2, 2), slot('plains', 2, 2, 2)], null).map((x) => x.share)).toEqual([0.429, 0.286, 0.286]);
  });

  it('keeps every live biome at least minShare wide (§5: ~15%), a withered one half that', () => {
    const l = halfLayout([slot('forest', 0, 9, 4), slot('island', 1, 0.5, 1), slot('mountain', 2, 0.5, 1)], null);
    expect(l.map((x) => x.share)).toEqual([0.7, 0.15, 0.15]);
    const w = halfLayout([slot('forest', 0, 0, 0), slot('island', 1, 2, 2)], null);
    expect(w.map((x) => [x.slot.biome, x.stage, x.share])).toEqual([
      ['forest', 0, 0.075],
      ['island', 2, 0.925],
    ]);
    const custom = validateManifest({ schema: 1, half: { minShare: 0.25 }, biomes: { island: { stages: [{ half: half() }] } } }, BASE).pack!;
    expect(halfLayout([slot('island', 0, 9, 4), slot('plains', 1, 1, 1)], custom).map((x) => x.share)).toEqual([0.75, 0.25]);
    for (const b of [[slot('island', 0, 1, 1)], [slot('island', 0, 0.5, 1), slot('swamp', 1, 0.5, 1)], [slot('island', 0, 0, 0)]])
      expect(halfLayout(b, null).reduce((n, x) => n + x.share, 0)).toBeCloseTo(1, 2);
  });

  it('lays the slots out with their seams overlapping, as the flex row does', () => {
    const l = halfLayout([slot('island', 0, 3, 2), slot('mountain', 1, 2, 2)], null);
    // 1000 px with a 10% seam: 1100 px of slots, 660 + 440, the second starting 100 px before the first ends.
    expect(halfSpans(l, 1000)).toEqual([
      { left: 0, width: 660 },
      { left: 560, width: 440 },
    ]);
    expect(halfSpans(halfLayout([slot('island', 0, 3, 2)], null), 1000)).toEqual([{ left: 0, width: 1000 }]);
  });
});

/** Evaluate halfFrameCss's CSS in a box (cqw / cqh), to prove it is halfFrame's math. */
function evalCss(expr: string, w: number, h: number): number {
  const js = expr
    .replace(/(\d+(?:\.\d+)?)cqw/g, `($1*${w}/100)`)
    .replace(/(\d+(?:\.\d+)?)cqh/g, `($1*${h}/100)`)
    .replace(/0px/g, '0')
    .replace(/calc\(/g, '(')
    .replace(/clamp\(/g, 'CL(')
    .replace(/\bmin\(/g, 'Math.min(')
    .replace(/\bmax\(/g, 'Math.max(');
  return new Function('CL', `return ${js};`)((lo: number, v: number, hi: number) => Math.max(lo, Math.min(v, hi)));
}

describe('spec 1.5: the cover crop', () => {
  const art = (extra: Partial<HalfArt> = {}): HalfArt => ({ aspect: 3, focal: { x: 0.5, y: 0.5 }, safe: null, source: 'half', ...extra });

  it('covers the box, the focal point as near the middle as the picture allows', () => {
    // A phone half (1:1) of a 3:1 picture: full height, the middle third across.
    expect(halfFrame({ w: 300, h: 300 }, art())).toEqual({ left: -1, top: 0, width: 3, height: 1 });
    // The focal point off centre pulls the view across, but never past the picture's edge.
    expect(halfFrame({ w: 300, h: 300 }, art({ focal: { x: 0.3, y: 0.5 } }))).toEqual({ left: -0.4, top: 0, width: 3, height: 1 });
    expect(halfFrame({ w: 300, h: 300 }, art({ focal: { x: 0.05, y: 0.5 } })).left).toBe(0);
    // A wide half (5:1): full width, cropped top and bottom about the focal point.
    expect(halfFrame({ w: 1000, h: 200 }, art({ focal: { x: 0.5, y: 0.475 } }))).toEqual({ left: 0, top: -0.2917, width: 1, height: 1.6667 });
  });

  it('keeps the safe rect whole when the shape allows, and centres it when it cannot', () => {
    // Focal on the left, safe rect in the middle third: the view slides just enough to show all of it.
    const safe = { x: 1 / 3, y: 0.3, w: 1 / 3, h: 0.4 };
    expect(halfFrame({ w: 300, h: 300 }, art({ focal: { x: 0.2, y: 0.5 }, safe })).left).toBe(-1);
    // A phone half narrower than the safe rect: centred on it.
    const wide = { x: 0.2, y: 0.3, w: 0.6, h: 0.4 };
    const f = halfFrame({ w: 200, h: 400 }, art({ focal: { x: 0.1, y: 0.5 }, safe: wide }));
    expect(f.left).toBeCloseTo(-(0.5 * 3 * 2 - 0.5), 3);
  });

  it('anchors older strip art (4:1) at its horizon, ~57% up', () => {
    expect(STRIP_ART).toMatchObject({ aspect: 4, focal: { x: 0.5, y: 0.43 }, safe: null });
    // A 5:1 desktop half crops a 4:1 strip top and bottom: the horizon keeps near its height.
    const f = halfFrame({ w: 1000, h: 200 }, STRIP_ART);
    expect(f.width).toBe(1);
    expect(f.height).toBe(1.25);
    expect(f.top).toBeCloseTo(-0.0375, 4);
  });

  it('its CSS twin computes the same frame at every size', () => {
    const arts = [art(), art({ focal: { x: 0.2, y: 0.4 } }), art({ focal: { x: 0.9, y: 0.1 }, safe: { x: 0.25, y: 0.35, w: 0.5, h: 0.25 } }), art({ focal: { x: 0.1, y: 0.5 }, safe: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } }), STRIP_ART];
    const boxes = [
      [300, 300],
      [810, 285],
      [1660, 320],
      [374, 330],
      [120, 330],
      [374, 170],
      [2000, 120],
    ];
    for (const a of arts)
      for (const [w, h] of boxes) {
        const css = halfFrameCss(a);
        const n = halfFrame({ w: w!, h: h! }, a);
        expect(evalCss(css.width, w!, h!) / w!, `${w}x${h} width`).toBeCloseTo(n.width, 3);
        expect(evalCss(css.height, w!, h!) / h!, `${w}x${h} height`).toBeCloseTo(n.height, 3);
        expect(evalCss(css.left, w!, h!) / w!, `${w}x${h} left`).toBeCloseTo(n.left, 3);
        expect(evalCss(css.top, w!, h!) / h!, `${w}x${h} top`).toBeCloseTo(n.top, 3);
      }
  });

  it('uses the pack’s half picture where it has one, else the strip art', () => {
    const pack = validateManifest(packWith([{ half: half({ width: 2000, height: 1000, focal: { x: 0.6, y: 0.4 } }) }]), BASE).pack!;
    expect(halfArt(pack, 'island', 4)).toMatchObject({ aspect: 2, focal: { x: 0.6, y: 0.4 }, safe: { x: 0.25, y: 0.35, w: 0.5, h: 0.25 }, source: 'half' });
    expect(halfArt(pack, 'forest', 1)).toBe(STRIP_ART);
    expect(halfArt(null, 'island', 1)).toBe(STRIP_ART);
  });

  it('picks the phone picture for a panel nearer its shape, the desktop one otherwise', () => {
    const h = validateManifest(packWith([{ half: half({ phone: { src: 'p.webp' } }) }]), BASE).pack!.biomes.island!.stages[0]!.half!;
    // Desktop 16:5 (3.2), phone 4:5 (0.8): the log-midpoint is 1.6.
    expect(pickHalfPicture(h, 2.7).phone).toBe(false);
    expect(pickHalfPicture(h, 1.7).phone).toBe(false);
    expect(pickHalfPicture(h, 1.5).phone).toBe(true);
    expect(pickHalfPicture(h, 0.5).phone).toBe(true);
    expect(pickHalfPicture(h, null).phone).toBe(false);
    expect(halfArtOf(h, 1.1)).toMatchObject({ aspect: 0.8, source: 'phone', focal: { x: 0.5, y: 0.4875 } });
    // No phone picture: the desktop one, cropped, everywhere.
    const desk = validateManifest(packWith([{ half: half() }]), BASE).pack!.biomes.island!.stages[0]!.half!;
    expect(halfArtOf(desk, 0.9).source).toBe('half');
  });
});

describe('spec 1.5: the card-row scrim', () => {
  const host = { left: 100, top: 50, width: 800, height: 300 };
  it('bands each row’s cards, clipped to the row and the half, grown by the pad', () => {
    const rows = [
      // Three cards, centred.
      { box: { left: 100, top: 60, width: 800, height: 130 }, items: [{ left: 380, top: 65, width: 80, height: 112 }, { left: 470, top: 65, width: 80, height: 112 }, { left: 560, top: 65, width: 112, height: 80 }] },
      // An empty row is skipped; so is a zero-size gap.
      { box: { left: 100, top: 200, width: 800, height: 100 }, items: [{ left: 500, top: 210, width: 0, height: 0 }] },
      // A row scrolled sideways: cards past its box are cut.
      { box: { left: 120, top: 250, width: 760, height: 95 }, items: [{ left: 60, top: 255, width: 70, height: 90 }, { left: 850, top: 255, width: 70, height: 90 }] },
    ];
    expect(scrimRects(host, rows, 6)).toEqual([
      { left: 274, top: 9, width: 304, height: 124 },
      { left: 14, top: 199, width: 772, height: 101 },
    ]);
  });
});

/** A skin's custom property from the first block of `selector` in `css`. */
function token(css: string, selector: string, name: string): Rgb {
  const at = css.indexOf(`${selector} {`);
  const block = css.slice(at, css.indexOf('}', at));
  const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,6})`).exec(block);
  if (!m) throw new Error(`${selector} ${name}`);
  return hexRgb(m[1]!);
}

describe('spec 1.5: the scrim never lowers contrast', () => {
  const styles = readFileSync(new URL('../ui/styles.css', import.meta.url), 'utf8');
  const skins = readFileSync(new URL('../ui/skins.css', import.meta.url), 'utf8');
  const scenery = readFileSync(new URL('../ui/ambience/scenery.css', import.meta.url), 'utf8');
  /** A scrim token in scenery.css for a skin's block: a hex, or var(--surface) resolved from the skin. */
  const scrimToken = (sel: string, name: string, surface: Rgb): Rgb => {
    const blocks = scenery.split(`${sel} {`).slice(1).map((b) => b.slice(0, b.indexOf('}')));
    const block = blocks.find((b) => b.includes('--scn-scrim-top'))!;
    const m = new RegExp(`${name}:\\s*([^;]+);`).exec(block)!;
    return m[1]!.startsWith('var(--surface') ? surface : hexRgb(m[1]!.trim());
  };
  // The plain board's colour on each side (scenery off), measured from the board in Chromium at 1280 × 800.
  const SKINS: { name: string; css: string; sel: string; plain: { top: Rgb; me: Rgb } }[] = [
    { name: 'classic', css: styles, sel: ':root', plain: { top: [25, 30, 40], me: [30, 31, 33] } },
    { name: 'stack', css: skins, sel: ":root[data-skin='stack']", plain: { top: [23, 26, 30], me: [23, 26, 30] } },
    // Felt: rgba(14, 32, 27, 0.35) over --bg #1a312b.
    { name: 'felt', css: skins, sel: ":root[data-skin='felt']", plain: { top: over([14, 32, 27], 0.35, hexRgb('#1a312b')), me: over([14, 32, 27], 0.35, hexRgb('#1a312b')) } },
  ];
  const WHITE: Rgb = [255, 255, 255];

  it('paints the band’s core in the board’s own colour, per side', () => {
    expect(scenery).toMatch(/\.scn-scrim-in\s*{[^}]*background:\s*var\(--scn-scrim\)/);
    expect(scenery).toMatch(/\.player-top \.scn-scrims,[^{]*{\s*--scn-scrim:\s*var\(--scn-scrim-top\)/);
  });

  for (const { name, css, sel, plain } of SKINS)
    it(`${name}: text and card edges in the band read as on the plain board, and better than over today’s strip`, () => {
      const surface = token(css, sel, '--surface');
      for (const side of ['top', 'me'] as const) {
        const scrim = scrimToken(sel, `--scn-scrim-${side}`, surface);
        // Within a few levels of the plain board's colour on that side.
        for (let i = 0; i < 3; i++) expect(Math.abs(scrim[i]! - plain[side][i]!), `${side} channel ${i}`).toBeLessThanOrEqual(3);
        for (const t of ['--text', '--muted', '--faint']) {
          const ink = token(css, sel, t);
          const today = contrast(ink, plain[side]);
          // The core is opaque: whatever art lies under it, ink reads as on the plain board (within 3%).
          for (const art of [WHITE, [0, 0, 0] as Rgb, [255, 200, 0] as Rgb]) expect(contrast(ink, over(scrim, 1, art)) / today, `${side} ${t}`).toBeGreaterThan(0.97);
          // Today's land row sits on the strip's art with no band at all: art of the ink's own colour leaves 1:1.
          expect(contrast(ink, ink)).toBeLessThan(today);
        }
        // The feather's start (0.85) over the brightest art still keeps body text at WCAG AA.
        expect(contrast(token(css, sel, '--text'), over(scrim, SCRIM_EDGE_ALPHA, WHITE))).toBeGreaterThanOrEqual(4.5);
      }
    });
});

describe('spec 1.5: Fill each side', () => {
  it('is on by default, stored, and ?fill= overrides it for a page', () => {
    expect(DEFAULT_PREFS.fill).toBe(true);
    expect(fillOn(DEFAULT_PREFS)).toBe(true);
    expect(fillOn({ ...DEFAULT_PREFS, mode: 'off' })).toBe(false);
    const store = new Map<string, string>([['forgecoach.scenery', JSON.stringify({ mode: 'procedural', fill: false })]]);
    expect(loadSceneryPrefs({ getItem: (k) => store.get(k) ?? null, setItem: () => {} }).fill).toBe(false);
    expect(effectivePrefs(DEFAULT_PREFS, '?fill=off', '').fill).toBe(false);
    expect(effectivePrefs({ ...DEFAULT_PREFS, fill: false }, '', '#ambience?fill=on').fill).toBe(true);
    expect(effectivePrefs(DEFAULT_PREFS, '?fill=maybe', '')).toBe(DEFAULT_PREFS);
  });
});

describe('the spec’s half-board example', () => {
  it('validates with no errors or warnings', () => {
    const md = readFileSync(new URL('../../docs/scenery-pack-spec.md', import.meta.url), 'utf8');
    const block = /<!-- example-half -->\s*```json\n([\s\S]*?)```/.exec(md);
    expect(block).not.toBeNull();
    const r = validateManifest(JSON.parse(block![1]!), BASE);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    const isl = r.pack!.biomes.island!;
    expect(isl.stages.map((s) => !!s.half)).toEqual([true, true, true, true]);
    expect(halfBytes(isl)).toBeLessThanOrEqual(MAX_HALF_BYTES);
    expect(layersAt(isl, 4).map((l) => l.kind)).toEqual(['image', 'video']);
  });
});

describe('spec 1.5: golden half layouts', () => {
  const file = new URL('./testdata/half.golden.json', import.meta.url);
  const packV2 = JSON.parse(readFileSync(new URL('./testdata/pack-v2.scenery.json', import.meta.url), 'utf8'));
  const md = readFileSync(new URL('../../docs/scenery-pack-spec.md', import.meta.url), 'utf8');
  const example = JSON.parse(/<!-- example-half -->\s*```json\n([\s\S]*?)```/.exec(md)![1]!);
  const now = { packV2: halfGolden(packV2), builtin: halfGolden(null), example: halfGolden(example) };
  // UPDATE_GOLDEN=1 npx vitest run src/ambience/half.test.ts rewrites it (review the diff).
  if (process.env.UPDATE_GOLDEN === '1' || !existsSync(file)) writeFileSync(file, `${JSON.stringify(now)}\n`);
  const golden = JSON.parse(readFileSync(file, 'utf8'));
  it('pack-v2 fills the half with its strip art, as recorded', () => expect(now.packV2).toEqual(golden.packV2));
  it('the built-in scenery fills the half, as recorded', () => expect(now.builtin).toEqual(golden.builtin));
  it('the 1.5 example pack uses its half pictures, as recorded', () => expect(now.example).toEqual(golden.example));
});
