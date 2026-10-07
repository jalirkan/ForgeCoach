/*
 * ForgeCoach — ambience/overlay.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.3 board accents: the `overlay` fields and their validation, the
 * stage replace / add rules, the budgets, mirroring on the opponent's side,
 * blending several biomes (split by slot), the width fit, and the prefs.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { combineOverlayStages, hasOverlays, MAX_OVERLAY_ANIMATED, MAX_OVERLAY_PIECES, overlayAt, overlayUrls, validateManifest, type OverlayPiece } from './manifest.ts';
import { anchorGroup, biomeOverlay, BUILTIN_OVERLAY, mirrorAnchor, overlayFit, overlayPieces, OVERLAY_CORNERS_ONLY_PX, OVERLAY_HIDDEN_PX } from './overlay.ts';
import { preloadOverlays } from './pack.ts';
import { builtinOverlaySrc } from '../ui/ambience/overlayArt.ts';
import { accentsOn, DEFAULT_PREFS, effectivePrefs } from './prefs.ts';
import type { Biome, SlotState } from './model.ts';

const BASE = 'http://127.0.0.1:8650/scenery.json';
const sky = { id: 'sky', kind: 'image', src: 'forest/sky.webp' };
const vine = (id: string, anchor = 'bottom-left', extra: Record<string, unknown> = {}) => ({ id, anchor, src: `forest/${id}.webp`, ...extra });

const pack = (stages: unknown[], biome = 'forest') => ({ schema: 1, spec: '1.3', biomes: { [biome]: { stages } } });
const slot = (biome: Biome, index: number, weight: number, stage: number): SlotState => ({ biome, index, weight, stage, peak: stage });

describe('spec 1.3 overlay: validation', () => {
  it('reads every field, with defaults by kind of anchor', () => {
    const r = validateManifest(
      pack([
        {
          layers: [sky],
          overlay: [
            vine('vine-bl', 'bottom-left', { src2x: 'forest/vine-bl@2x.webp', size: 0.2, maxPx: 300, opacity: 0.8, blend: 'screen', motion: 'sway', periodMs: 12000, mirror: false, bytes: 400000 }),
            { id: 'leaves', anchor: 'bottom-edge', src: 'forest/leaves.avif', tile: 'stretch' },
          ],
        },
      ]),
      BASE,
    );
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    const [a, b] = r.pack!.overlays!.forest!.stages[0]!;
    expect(a).toMatchObject({ id: 'vine-bl', anchor: 'bottom-left', src: 'http://127.0.0.1:8650/forest/vine-bl.webp', src2x: 'http://127.0.0.1:8650/forest/vine-bl@2x.webp', size: 0.2, maxPx: 300, opacity: 0.8, blend: 'screen', motion: 'sway', periodMs: 12000, mirror: false, bytes: 400000, builtin: null });
    expect(b).toMatchObject({ anchor: 'bottom-edge', tile: 'stretch', size: 0.05, maxPx: 72, opacity: 1, blend: 'normal', motion: 'none', mirror: true });
    // The strip's own art is untouched.
    expect(r.pack!.biomes.forest!.stages[0]!.layers).toHaveLength(1);
  });

  it('warns on unknown anchors, bad files and bad fields, with the path', () => {
    const r = validateManifest(
      pack([
        {
          layers: [sky],
          overlay: [
            vine('a', 'middle'),
            { id: 'b', anchor: 'top-left', src: 'forest/b.png' },
            { id: 'c', anchor: 'top-left', src: 'javascript:x.webp' },
            vine('d', 'top-right', { tile: 'repeat', size: 5, motion: 'spin', mirror: 'yes', src2x: 'x.gif' }),
            vine('e', 'left-edge', { tile: 'zigzag' }),
            vine('e', 'right-edge'),
            'nope',
          ],
        },
      ]),
      BASE,
    );
    const w = r.warnings.join('\n');
    expect(w).toContain('biomes.forest.stages[0].overlay[0].anchor: "middle" is not one of top-left, top-right, bottom-left, bottom-right, top-edge, bottom-edge, left-edge, right-edge, area; piece dropped');
    expect(w).toContain('overlay[1].src: expected .webp or .avif (a transparent still); piece dropped');
    expect(w).toContain('overlay[2].src: the javascript: scheme is not allowed');
    expect(w).toContain('overlay[3].tile: only for edges; ignored');
    expect(w).toContain('overlay[3].size: 5 is out of range 0.02–1; using 0.18');
    expect(w).toContain('overlay[3].motion: "spin" is not one of none, sway, drift, breathe; using none');
    expect(w).toContain('overlay[3].mirror: not true or false; using true');
    expect(w).toContain('overlay[3].src2x: expected .webp or .avif; ignored');
    expect(w).toContain('overlay[4].tile: "zigzag" is not one of repeat, stretch; using repeat');
    expect(w).toContain('overlay[5].id: "e" repeats in this stage; piece dropped');
    expect(w).toContain('overlay[6]: not an object; piece dropped');
    expect(r.pack!.overlays!.forest!.stages[0]!.map((p) => p.id)).toEqual(['d', 'e']);
  });

  it('a pack may have accents and no stage art (the built-in scene draws the strip)', () => {
    const r = validateManifest(pack([{ overlay: [vine('v')] }, { overlay: [vine('v', 'bottom-left', { size: 0.3 })] }]), BASE);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.pack!.biomes.forest).toBeUndefined();
    expect(hasOverlays(r.pack)).toBe(true);
    expect(overlayUrls(r.pack!).map((u) => u.url)).toEqual(['http://127.0.0.1:8650/forest/v.webp']);
  });

  it('a 1.2 pack reads as before: no overlays', () => {
    const r = validateManifest(pack([{ layers: [sky] }]), BASE);
    expect(r.warnings).toEqual([]);
    expect(r.pack!.overlays).toBeNull();
    expect(hasOverlays(r.pack)).toBe(false);
  });
});

describe('spec 1.3 overlay: stages replace and add', () => {
  it('replace (the default) lists the complete set; a missing overlay keeps the last; add adds and replaces by id', () => {
    const r = validateManifest(
      pack([
        { layers: [sky], overlay: [vine('a'), vine('b', 'bottom-right')] },
        { layers: [sky] },
        { layers: [sky], overlayMode: 'add', overlay: [vine('c', 'bottom-edge'), vine('a', 'bottom-left', { size: 0.3 })] },
        { layers: [sky], overlay: [vine('z', 'top-left')] },
      ]),
      BASE,
    );
    expect(r.warnings).toEqual([]);
    const st = r.pack!.overlays!.forest!.stages;
    expect(st.map((s) => s.map((p) => p.id))).toEqual([['a', 'b'], ['a', 'b'], ['a', 'b', 'c'], ['z']]);
    expect(st[2]![0]!.size).toBe(0.3);
    // Past the last stage, the last stage's pieces.
    expect(overlayAt(r.pack!.overlays!.forest, 6)!.map((p) => p.id)).toEqual(['z']);
    expect(overlayAt(r.pack!.overlays!.forest, 0)).toEqual([]);
    expect(overlayAt(undefined, 2)).toBeNull();
  });

  it('an empty replace clears; a bad overlayMode falls back to replace', () => {
    const r = validateManifest(pack([{ layers: [sky], overlay: [vine('a')] }, { layers: [sky], overlay: [] }, { layers: [sky], overlayMode: 'merge', overlay: [vine('b')] }]), BASE);
    expect(r.warnings).toEqual(['biomes.forest.stages[2].overlayMode: "merge" is not one of replace, add; using replace']);
    expect(r.pack!.overlays!.forest!.stages.map((s) => s.map((p) => p.id))).toEqual([['a'], [], ['b']]);
  });
});

describe('spec 1.3 overlay: budgets', () => {
  const p = (id: string, motion = 'none'): OverlayPiece => ({ id, anchor: 'bottom-left', src: `http://h/${id}.webp`, src2x: null, builtin: null, size: 0.1, maxPx: 100, tile: 'repeat', opacity: 1, blend: 'normal', motion: motion as OverlayPiece['motion'], periodMs: 9000, mirror: true, bytes: null });

  it(`keeps at most ${MAX_OVERLAY_PIECES} pieces per stage, the first ones, with a warning (add counts the kept ones)`, () => {
    const warn: string[] = [];
    const st = combineOverlayStages([{ mode: 'replace', pieces: ['a', 'b', 'c', 'd'].map((x) => p(x)) }, { mode: 'add', pieces: ['e', 'f', 'g'].map((x) => p(x)) }], 'biomes.forest', warn);
    expect(st[0]).toHaveLength(4);
    expect(st[1]!.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(warn).toEqual([`biomes.forest.stages[1].overlay: 7 pieces in this stage; at most ${MAX_OVERLAY_PIECES} show, the rest dropped`]);
  });

  it(`moves at most ${MAX_OVERLAY_ANIMATED} pieces per stage: the rest are drawn still`, () => {
    const warn: string[] = [];
    const st = combineOverlayStages([{ mode: 'replace', pieces: [p('a', 'sway'), p('b', 'drift'), p('c'), p('d', 'breathe'), p('e', 'sway')] }], 'biomes.island', warn);
    expect(st[0]!.map((x) => x.motion)).toEqual(['sway', 'drift', 'none', 'breathe', 'none']);
    expect(warn[0]).toContain('4 moving pieces; at most 3 per stage move');
  });

  it('warns past 2 MB of declared accent files per biome (each file counted once)', () => {
    const big = { bytes: 900000 };
    const r = validateManifest(pack([{ layers: [sky], overlay: [vine('a', 'bottom-left', big), vine('b', 'bottom-right', big)] }, { layers: [sky], overlayMode: 'add', overlay: [vine('c', 'top-edge', big)] }]), BASE);
    expect(r.warnings).toEqual(['biomes.forest: 2.6 MB of accents declared; the budget is 2 MB per biome (pieces kept)']);
    const ok = validateManifest(pack([{ layers: [sky], overlay: [vine('a', 'bottom-left', big)] }, { layers: [sky], overlay: [vine('a', 'bottom-left', big), vine('b', 'bottom-right', big)] }]), BASE);
    expect(ok.warnings).toEqual([]);
  });

  it('the renderer also caps a player area at 6 pieces and 3 moving, across biomes', () => {
    const r = validateManifest(
      {
        schema: 1,
        biomes: {
          forest: { stages: [{ overlay: [vine('a', 'bottom-left', { motion: 'sway' }), vine('b', 'top-left', { motion: 'sway' }), vine('c', 'left-edge', { motion: 'sway' }), vine('d', 'bottom-edge'), vine('e', 'top-edge')] }] },
          island: { stages: [{ overlay: [vine('f', 'bottom-right', { motion: 'drift' }), vine('g', 'top-right'), vine('h', 'right-edge')] }] },
        },
      },
      BASE,
    );
    const placed = overlayPieces([slot('forest', 0, 3, 2), slot('island', 1, 1, 1)], r.pack, { side: 'bottom', widthPx: 1000, reduced: false });
    expect(placed).toHaveLength(MAX_OVERLAY_PIECES);
    // Forest is dominant: its pieces first; the island's right edge is the one cut.
    expect(placed.map((p) => p.piece.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(placed.filter((p) => p.animate).map((p) => p.piece.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('spec 1.3 overlay: mirroring', () => {
  it('swaps top and bottom on the opponent side, and flips', () => {
    expect(mirrorAnchor('bottom-left', 'top', true)).toEqual({ anchor: 'top-left', flipY: true });
    expect(mirrorAnchor('top-right', 'top', true)).toEqual({ anchor: 'bottom-right', flipY: true });
    expect(mirrorAnchor('bottom-edge', 'top', true)).toEqual({ anchor: 'top-edge', flipY: true });
    expect(mirrorAnchor('left-edge', 'top', true)).toEqual({ anchor: 'left-edge', flipY: true });
    expect(mirrorAnchor('bottom-left', 'top', false)).toEqual({ anchor: 'bottom-left', flipY: false });
    expect(mirrorAnchor('bottom-left', 'bottom', true)).toEqual({ anchor: 'bottom-left', flipY: false });
  });

  it('places a pack piece on the opponent side mirrored unless mirror is false', () => {
    const r = validateManifest(pack([{ overlay: [vine('a'), vine('b', 'bottom-right', { mirror: false })] }]), BASE);
    const top = overlayPieces([slot('forest', 0, 1, 1)], r.pack, { side: 'top', widthPx: 900, reduced: false });
    expect(top.map((p) => [p.piece.id, p.anchor, p.flipY])).toEqual([
      ['a', 'top-left', true],
      ['b', 'bottom-right', false],
    ]);
  });
});

describe('spec 1.3 overlay: several biomes, split by slot', () => {
  const r = validateManifest(
    {
      schema: 1,
      biomes: {
        forest: { stages: [{ overlay: [vine('fl', 'bottom-left'), vine('fr', 'bottom-right'), vine('fe', 'bottom-edge')] }] },
        island: { stages: [{ overlay: [vine('il', 'bottom-left'), vine('ir', 'bottom-right'), vine('ie', 'bottom-edge')] }] },
      },
    },
    BASE,
  );
  it('left anchors from the leftmost slot, right from the rightmost, the long edges from the dominant biome', () => {
    expect(anchorGroup('top-left')).toBe('left');
    expect(anchorGroup('right-edge')).toBe('right');
    expect(anchorGroup('bottom-edge')).toBe('span');
    const placed = overlayPieces([slot('island', 0, 1, 1), slot('forest', 1, 3, 2)], r.pack, { side: 'bottom', widthPx: 900, reduced: false });
    expect(placed.map((p) => p.piece.id).sort()).toEqual(['fe', 'fr', 'il']);
    // A lone biome owns every anchor.
    expect(overlayPieces([slot('island', 0, 2, 2)], r.pack, { side: 'bottom', widthPx: 900, reduced: false }).map((p) => p.piece.id)).toEqual(['il', 'ir', 'ie']);
  });
  it('withered slots and an empty side give none', () => {
    expect(overlayPieces([slot('island', 0, 0, 0)], r.pack, { side: 'bottom', widthPx: 900, reduced: false })).toEqual([]);
    expect(overlayPieces([], r.pack, { side: 'bottom', widthPx: 900, reduced: false })).toEqual([]);
  });
});

describe('spec 1.3 overlay: built-in placeholders', () => {
  it('every biome has them, growing with the stage, within the budgets', () => {
    for (const [b, stages] of Object.entries(BUILTIN_OVERLAY)) {
      expect(stages.length, b).toBeGreaterThanOrEqual(4);
      expect(stages[0]!.length).toBeLessThan(stages[3]!.length);
      for (const st of stages) {
        expect(st.length).toBeLessThanOrEqual(MAX_OVERLAY_PIECES);
        expect(st.filter((p) => p.motion !== 'none').length).toBeLessThanOrEqual(MAX_OVERLAY_ANIMATED);
        for (const p of st) expect(p.src === null && p.builtin !== null).toBe(true);
      }
    }
    expect(BUILTIN_OVERLAY.forest[0]![0]!.builtin).toBe('vine');
    expect(BUILTIN_OVERLAY.island[0]![0]!.builtin).toBe('frost');
    expect(BUILTIN_OVERLAY.mountain[0]![0]!.builtin).toBe('ash');
  });
  it('draws every built-in kind as an SVG data URL, in each shape', () => {
    for (const st of Object.values(BUILTIN_OVERLAY))
      for (const p of st.flat()) for (const shape of ['corner', 'h', 'v'] as const) expect(builtinOverlaySrc(p.builtin!, shape)).toMatch(/^data:image\/svg\+xml,%3Csvg/);
    expect(decodeURIComponent(builtinOverlaySrc('spray', 'v'))).toContain('viewBox="0 0 40 160"');
  });
  it('a pack biome with its own art and no accents gets none; one without art gets the built-in', () => {
    const r = validateManifest(pack([{ layers: [sky] }]), BASE);
    expect(biomeOverlay(r.pack, 'forest', 2)).toEqual([]);
    expect(biomeOverlay(r.pack, 'island', 2).map((p) => p.builtin)).toEqual(['frost', 'frost']);
    expect(biomeOverlay(null, 'mountain', 4).map((p) => [p.anchor, p.builtin])).toEqual([
      ['bottom-left', 'ash'],
      ['bottom-right', 'ash'],
      ['bottom-edge', 'embers'],
      ['left-edge', 'embers'],
      ['right-edge', 'embers'],
    ]);
  });
});

describe('spec 1.3 overlay: width and motion', () => {
  it('full from 600 px, corners only (smaller, still) below, none below 300 px', () => {
    expect(overlayFit(1200)).toEqual({ mode: 'full', maxPx: null });
    expect(overlayFit(OVERLAY_CORNERS_ONLY_PX)).toEqual({ mode: 'full', maxPx: null });
    expect(overlayFit(OVERLAY_CORNERS_ONLY_PX - 1)).toEqual({ mode: 'corners', maxPx: 88 });
    expect(overlayFit(OVERLAY_HIDDEN_PX)).toMatchObject({ mode: 'corners' });
    expect(overlayFit(OVERLAY_HIDDEN_PX - 1)).toEqual({ mode: 'hidden', maxPx: null });
    expect(overlayFit(NaN).mode).toBe('hidden');
  });
  it('a phone-width area shows corners only, capped and still; a tiny one nothing', () => {
    const slots = [slot('forest', 0, 6, 4)];
    const wide = overlayPieces(slots, null, { side: 'bottom', widthPx: 1100, reduced: false });
    expect(wide.map((p) => p.anchor)).toEqual(['bottom-left', 'bottom-right', 'bottom-edge', 'left-edge', 'right-edge']);
    expect(wide.filter((p) => p.animate)).toHaveLength(2);
    const phone = overlayPieces(slots, null, { side: 'bottom', widthPx: 370, reduced: false });
    expect(phone.map((p) => p.anchor)).toEqual(['bottom-left', 'bottom-right']);
    expect(phone.every((p) => p.maxPx <= 88 && !p.animate)).toBe(true);
    expect(overlayPieces(slots, null, { side: 'bottom', widthPx: 240, reduced: false })).toEqual([]);
  });
  it('reduced motion draws every piece still', () => {
    expect(overlayPieces([slot('forest', 0, 6, 4)], null, { side: 'bottom', widthPx: 1100, reduced: true }).some((p) => p.animate)).toBe(false);
  });
});

describe('spec 1.3 overlay: loading and prefs', () => {
  it('preloads accent files in the background and reports the failures', async () => {
    const r = validateManifest(pack([{ overlay: [vine('a'), vine('b', 'bottom-right')] }]), BASE);
    const failed = await preloadOverlays(r.pack!, async (u) => {
      if (u.endsWith('b.webp')) throw new Error('404');
    });
    expect(failed).toEqual(['http://127.0.0.1:8650/forest/b.webp']);
  });
  it('accents: on by default with the scenery, off with it, and ?accents= overrides', () => {
    expect(DEFAULT_PREFS.accents).toBe(true);
    expect(accentsOn(DEFAULT_PREFS)).toBe(true); // the scenery is on by default (ForgeCoach art)
    expect(accentsOn({ ...DEFAULT_PREFS, mode: 'off' })).toBe(false);
    expect(accentsOn({ ...DEFAULT_PREFS, mode: 'procedural' })).toBe(true);
    expect(accentsOn({ ...DEFAULT_PREFS, mode: 'procedural', accents: false })).toBe(false);
    expect(effectivePrefs({ ...DEFAULT_PREFS, mode: 'procedural' }, '?accents=off', '').accents).toBe(false);
    expect(effectivePrefs({ ...DEFAULT_PREFS, accents: false }, '', '#sample=x?scenery=procedural&accents=on')).toMatchObject({ mode: 'procedural', accents: true });
  });
});

describe('the spec’s accents example', () => {
  it('validates with no errors or warnings', () => {
    const md = readFileSync(new URL('../../docs/scenery-pack-spec.md', import.meta.url), 'utf8');
    const block = /<!-- example-overlay -->\s*```json\n([\s\S]*?)```/.exec(md);
    expect(block).not.toBeNull();
    const r = validateManifest(JSON.parse(block![1]!), BASE);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.pack!.overlays!.forest!.stages.map((s) => s.length)).toEqual([1, 2, 4, 5]);
  });
});
