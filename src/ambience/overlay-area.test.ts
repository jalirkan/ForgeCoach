/*
 * ForgeCoach — ambience/overlay-area.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.4 full-area accents: the `anchor: "area"` piece's fields and their
 * validation, the one-per-stage cap and its own budget, placement (dominant
 * biome, mirroring, minimum width, motion), the cover / contain crop with a
 * safe rect, the #ambience placeholder, the spec's example, and that a 1.3
 * pack (pack-v2) and the built-in accents come out exactly as before.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { areaBytes, AREA_MIN_WIDTH_PX, hasAreaPieces, MAX_AREA_BYTES, overlayBytes, overlayUrls, validateManifest, type OverlayArea } from './manifest.ts';
import { areaPlacement, builtinAreaPiece, DEFAULT_AREA, overlayPieces } from './overlay.ts';
import { builtinAreaSrc } from '../ui/ambience/overlayArt.ts';
import { accentGolden, compactGolden } from './testdata/accentGolden.ts';
import type { Biome, SlotState } from './model.ts';

const BASE = 'http://127.0.0.1:8650/scenery.json';
const area = (id = 'scatter', extra: Record<string, unknown> = {}) => ({ id, anchor: 'area', src: `forest/${id}.webp`, ...extra });
const vine = (id: string, anchor = 'bottom-left', extra: Record<string, unknown> = {}) => ({ id, anchor, src: `forest/${id}.webp`, ...extra });
const pack = (stages: unknown[], biome = 'forest') => ({ schema: 1, spec: '1.4', biomes: { [biome]: { stages } } });
const slot = (biome: Biome, index: number, weight: number, stage: number): SlotState => ({ biome, index, weight, stage, peak: stage });
const digest = (s: string) => createHash('sha256').update(s).digest('hex');

describe('spec 1.4: a 1.3 pack and the built-in accents are unchanged', () => {
  const golden = JSON.parse(readFileSync(new URL('./testdata/pack-v2.golden.json', import.meta.url), 'utf8'));
  it('pack-v2’s manifest validates and places exactly as the 1.3 engine did', () => {
    const manifest = JSON.parse(readFileSync(new URL('./testdata/pack-v2.scenery.json', import.meta.url), 'utf8'));
    const now = compactGolden(accentGolden(manifest), digest) as { warnings: string[] };
    expect(now.warnings).toEqual([]);
    expect(now).toEqual(golden.packV2);
    expect(hasAreaPieces(validateManifest(manifest, BASE).pack)).toBe(false);
  });
  it('the built-in accents (no pack) are as before', () => {
    expect(compactGolden(accentGolden(null), digest)).toEqual(golden.builtin);
  });
});

describe('spec 1.4: validation', () => {
  it('reads every field, with defaults', () => {
    const r = validateManifest(
      pack([
        {
          overlay: [
            area('a', { src2x: 'forest/a@2x.webp', fit: 'cover', safe: { x: 0.1, y: 0.2, w: 0.8, h: 0.6 }, position: 'bottom', opacity: 0.8, blend: 'multiply', motion: 'drift', periodMs: 15000, mirror: false, minWidthPx: 720, bytes: 500000 }),
          ],
        },
        { overlay: [area('b', { fit: 'contain' })] },
      ]),
      BASE,
    );
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    const [a] = r.pack!.overlays!.forest!.stages[0]!;
    expect(a).toMatchObject({ id: 'a', anchor: 'area', src: 'http://127.0.0.1:8650/forest/a.webp', src2x: 'http://127.0.0.1:8650/forest/a@2x.webp', opacity: 0.8, blend: 'multiply', motion: 'drift', periodMs: 15000, mirror: false, bytes: 500000, builtin: null });
    expect(a!.area).toEqual({ fit: 'cover', safe: { x: 0.1, y: 0.2, w: 0.8, h: 0.6 }, position: 'bottom', minWidthPx: 720 });
    const [b] = r.pack!.overlays!.forest!.stages[1]!;
    expect(b!.area).toEqual({ fit: 'contain', safe: null, position: 'center', minWidthPx: AREA_MIN_WIDTH_PX });
    expect(b).toMatchObject({ opacity: 1, blend: 'normal', motion: 'none', mirror: true, bytes: null });
    expect(hasAreaPieces(r.pack)).toBe(true);
    expect(overlayUrls(r.pack!).map((u) => u.url)).toEqual(['http://127.0.0.1:8650/forest/a.webp', 'http://127.0.0.1:8650/forest/b.webp']);
  });

  it('a safe rect with missing keys takes the picture’s edges', () => {
    const r = validateManifest(pack([{ overlay: [area('a', { safe: { x: 0.25, w: 0.5 } })] }]), BASE);
    expect(r.warnings).toEqual([]);
    expect(r.pack!.overlays!.forest!.stages[0]![0]!.area!.safe).toEqual({ x: 0.25, y: 0, w: 0.5, h: 1 });
  });

  it('warns on bad fields, with the path, and keeps the piece', () => {
    const r = validateManifest(
      pack([
        {
          overlay: [
            area('a', { fit: 'fill', size: 0.5, maxPx: 300, tile: 'repeat', position: 'middle', minWidthPx: 120, safe: { x: 0.5, y: 0, w: 0.8, h: 1 } }),
            area('b', { fit: 'contain', safe: { x: 0, y: 0, w: 1, h: 1 }, motion: 'spin', mirror: 'no' }),
            area('c', { safe: 'centre', src2x: 'x.png' }),
            area('d', { safe: { x: 0, y: 0, w: 0.01, h: 1 } }),
          ],
        },
      ]),
      BASE,
    );
    const w = r.warnings.join('\n');
    const at = (i: number) => `biomes.forest.stages[0].overlay[${i}]`;
    expect(w).toContain(`${at(0)}.fit: "fill" is not one of cover, contain; using cover`);
    expect(w).toContain(`${at(0)}.size: only for corners and edges; ignored`);
    expect(w).toContain(`${at(0)}.maxPx: only for corners and edges; ignored`);
    expect(w).toContain(`${at(0)}.tile: only for corners and edges; ignored`);
    expect(w).toContain(`${at(0)}.position: "middle" is not one of center, top, bottom`);
    expect(w).toContain(`${at(0)}.minWidthPx: 120 is out of range 300–4096; using 600`);
    expect(w).toContain(`${at(0)}.safe: the rect runs past the picture (x + w and y + h at most 1); ignored`);
    expect(w).toContain(`${at(1)}.safe: with fit "contain" the whole picture shows; ignored`);
    expect(w).toContain(`${at(1)}.motion: "spin" is not one of none, sway, drift, breathe; using none`);
    expect(w).toContain(`${at(1)}.mirror: not true or false; using true`);
    expect(w).toContain(`${at(2)}.safe: not an object { x, y, w, h }; ignored`);
    expect(w).toContain(`${at(2)}.src2x: expected .webp or .avif; ignored`);
    expect(w).toContain(`${at(3)}.safe: x and y are 0–1, w and h 0.05–1 (fractions of the picture); ignored`);
    // Only one area piece per stage: the first is kept, the rest named and dropped.
    expect(w).toContain('biomes.forest.stages[0].overlay: 4 full-area pieces in this stage; at most 1 shows ("b", "c", "d" dropped)');
    const kept = r.pack!.overlays!.forest!.stages[0]!;
    expect(kept.map((p) => p.id)).toEqual(['a']);
    expect(kept[0]!.area).toEqual({ fit: 'cover', safe: null, position: 'center', minWidthPx: 600 });
  });

  it('drops an area piece with a bad src, as other pieces', () => {
    const r = validateManifest(pack([{ overlay: [{ id: 'a', anchor: 'area', src: 'forest/a.png' }, vine('v')] }]), BASE);
    expect(r.warnings).toEqual(['biomes.forest.stages[0].overlay[0].src: expected .webp or .avif (a transparent still); piece dropped']);
    expect(r.pack!.overlays!.forest!.stages[0]!.map((p) => p.id)).toEqual(['v']);
  });

  it('add swaps the area picture by id; a second area id in a later stage is cut', () => {
    const r = validateManifest(
      pack([
        { overlay: [] },
        { overlay: [area('scatter', { src: 'forest/s2.webp' })] },
        { overlayMode: 'add', overlay: [area('scatter', { src: 'forest/s3.webp' }), vine('v')] },
        { overlayMode: 'add', overlay: [area('other')] },
      ]),
      BASE,
    );
    expect(r.warnings).toEqual(['biomes.forest.stages[3].overlay: 2 full-area pieces in this stage; at most 1 shows ("other" dropped)']);
    const st = r.pack!.overlays!.forest!.stages;
    expect(st.map((s) => s.map((p) => `${p.id}:${p.src?.split('/').pop()}`))).toEqual([[], ['scatter:s2.webp'], ['scatter:s3.webp', 'v:v.webp'], ['scatter:s3.webp', 'v:v.webp']]);
  });

  it('counts as one piece and as a moving piece in the stage caps', () => {
    const r = validateManifest(
      pack([{ overlay: [area('a', { motion: 'breathe' }), vine('b', 'bottom-left', { motion: 'sway' }), vine('c', 'bottom-right', { motion: 'sway' }), vine('d', 'top-left', { motion: 'sway' }), vine('e', 'top-right'), vine('f', 'bottom-edge'), vine('g', 'top-edge')] }]),
      BASE,
    );
    expect(r.warnings).toEqual([
      'biomes.forest.stages[0].overlay: 7 pieces in this stage; at most 6 show, the rest dropped',
      'biomes.forest.stages[0].overlay: 4 moving pieces; at most 3 per stage move, the rest are drawn still',
    ]);
    expect(r.pack!.overlays!.forest!.stages[0]!.map((p) => `${p.id}:${p.motion}`)).toEqual(['a:breathe', 'b:sway', 'c:sway', 'd:none', 'e:none', 'f:none']);
  });
});

describe('spec 1.4: budget', () => {
  it('full-area files have their own 3 MB per biome, apart from the corners’ and edges’ 2 MB', () => {
    const r = validateManifest(pack([{ overlay: [area('a', { bytes: 1_500_000 }), vine('b', 'bottom-left', { bytes: 1_900_000 })] }, { overlayMode: 'add', overlay: [area('a', { src: 'forest/a3.webp', bytes: 1_500_000 })] }]), BASE);
    expect(r.warnings).toEqual([]);
    const o = r.pack!.overlays!.forest!;
    expect(overlayBytes(o)).toBe(1_900_000);
    expect(areaBytes(o)).toBe(3_000_000);
    const over = validateManifest(pack([{ overlay: [area('a', { bytes: 2_000_000 })] }, { overlay: [area('a', { src: 'forest/a3.webp', bytes: 1_400_000 })] }]), BASE);
    expect(MAX_AREA_BYTES).toBe(3 * 1024 * 1024);
    expect(over.warnings).toEqual(['biomes.forest: 3.2 MB of full-area accents declared; their budget is 3 MB per biome (pieces kept)']);
  });
});

describe('spec 1.4: placement', () => {
  const two = validateManifest(
    {
      schema: 1,
      biomes: {
        forest: { stages: [{ overlay: [area('fa', { motion: 'breathe' }), vine('fl'), vine('fr', 'bottom-right')] }] },
        island: { stages: [{ overlay: [area('ia'), vine('il'), vine('ir', 'bottom-right')] }] },
      },
    },
    BASE,
  ).pack;

  it('belongs to the dominant biome; one per player area', () => {
    const placed = overlayPieces([slot('island', 0, 1, 1), slot('forest', 1, 3, 2)], two, { side: 'bottom', widthPx: 1000, reduced: false });
    expect(placed.filter((p) => p.anchor === 'area').map((p) => p.key)).toEqual(['forest:fa:area']);
    expect(placed.map((p) => p.piece.id).sort()).toEqual(['fa', 'fr', 'il']);
    const islandLeads = overlayPieces([slot('island', 0, 4, 3), slot('forest', 1, 1, 1)], two, { side: 'bottom', widthPx: 1000, reduced: false });
    expect(islandLeads.filter((p) => p.anchor === 'area').map((p) => p.key)).toEqual(['island:ia:area']);
  });

  it('mirrors on the opponent side unless mirror is false', () => {
    const r = validateManifest(pack([{ overlay: [area('a')] }]), BASE).pack;
    expect(overlayPieces([slot('forest', 0, 1, 1)], r, { side: 'top', widthPx: 900, reduced: false }).map((p) => [p.anchor, p.flipY])).toEqual([['area', true]]);
    expect(overlayPieces([slot('forest', 0, 1, 1)], r, { side: 'bottom', widthPx: 900, reduced: false }).map((p) => [p.anchor, p.flipY])).toEqual([['area', false]]);
    const still = validateManifest(pack([{ overlay: [area('a', { mirror: false })] }]), BASE).pack;
    expect(overlayPieces([slot('forest', 0, 1, 1)], still, { side: 'top', widthPx: 900, reduced: false }).map((p) => [p.anchor, p.flipY])).toEqual([['area', false]]);
  });

  it('shows from its minWidthPx; still in the corners-only fit; never under 300 px', () => {
    const r = validateManifest(pack([{ overlay: [area('a', { motion: 'drift' }), vine('v')] }, { overlay: [area('a', { motion: 'drift', minWidthPx: 400 }), vine('v')] }]), BASE).pack;
    const at = (stage: number, widthPx: number | null, reduced = false) => overlayPieces([slot('forest', 0, stage, stage)], r, { side: 'bottom', widthPx, reduced }).filter((p) => p.anchor === 'area');
    expect(at(1, 599)).toEqual([]);
    expect(at(1, 600).map((p) => p.animate)).toEqual([true]);
    expect(at(1, null).map((p) => p.animate)).toEqual([true]);
    expect(at(2, 399)).toEqual([]);
    expect(at(2, 450).map((p) => p.animate)).toEqual([false]);
    expect(at(2, 299)).toEqual([]);
    expect(at(1, 1200, true).map((p) => p.animate)).toEqual([false]);
  });

  it('counts toward the area’s 6 pieces and 3 moving', () => {
    const placed = overlayPieces([slot('forest', 0, 3, 2), slot('island', 1, 1, 1)], validateManifest(
      {
        schema: 1,
        biomes: {
          forest: { stages: [{ overlay: [area('a', { motion: 'breathe' }), vine('b', 'bottom-left', { motion: 'sway' }), vine('c', 'left-edge', { motion: 'sway' }), vine('d', 'bottom-edge', { motion: 'sway' }), vine('e', 'top-edge')] }] },
          island: { stages: [{ overlay: [vine('f', 'bottom-right'), vine('g', 'top-right')] }] },
        },
      },
      BASE,
    ).pack, { side: 'bottom', widthPx: 1000, reduced: false });
    expect(placed.map((p) => p.piece.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(placed.filter((p) => p.animate).map((p) => p.piece.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('spec 1.4: the crop', () => {
  const cover = (safe: OverlayArea['safe'], position: OverlayArea['position'] = 'center'): OverlayArea => ({ fit: 'cover', safe, position, minWidthPx: 600 });
  const img = { w: 2048, h: 745 };

  it('contain shows everything, placed by position', () => {
    expect(areaPlacement(img, { w: 500, h: 400 }, { ...DEFAULT_AREA, fit: 'contain', position: 'bottom' })).toEqual({ fit: 'contain', position: '50% 100%', safeVisible: true });
  });
  it('cover with no safe rect crops by position', () => {
    expect(areaPlacement(img, { w: 600, h: 400 }, cover(null, 'bottom-left'))).toEqual({ fit: 'cover', position: '0% 100%', safeVisible: false });
  });
  it('cover keeps the safe rect, centred when it can, slid inside when it cannot', () => {
    // A squarer box crops the sides: the centred safe rect stays centred.
    expect(areaPlacement(img, { w: 800, h: 600 }, cover({ x: 0.3, y: 0, w: 0.4, h: 1 }))).toEqual({ fit: 'cover', position: '50% 50%', safeVisible: true });
    // A rect at the left is slid to the box's left edge, as near the middle as it goes.
    const left = areaPlacement(img, { w: 800, h: 600 }, cover({ x: 0, y: 0, w: 0.2, h: 1 }));
    expect(left).toEqual({ fit: 'cover', position: '0% 50%', safeVisible: true });
    // A wider box crops top and bottom: a rect at the bottom keeps the bottom.
    const wide = areaPlacement(img, { w: 2000, h: 400 }, cover({ x: 0, y: 0.7, w: 1, h: 0.3 }));
    expect(wide.fit).toBe('cover');
    expect(wide.position).toBe('50% 100%');
    // The same shape as the picture: nothing is cropped.
    expect(areaPlacement(img, { w: 1024, h: 372.5 }, cover({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }))).toEqual({ fit: 'cover', position: '50% 50%', safeVisible: true });
  });
  it('falls back to contain when the area’s shape would cut into the safe rect', () => {
    expect(areaPlacement(img, { w: 400, h: 600 }, cover({ x: 0.05, y: 0.1, w: 0.9, h: 0.8 }, 'bottom'))).toEqual({ fit: 'contain', position: '50% 100%', safeVisible: true });
  });
  it('unknown sizes (not loaded yet) crop by name', () => {
    expect(areaPlacement({ w: 0, h: 0 }, { w: 800, h: 300 }, cover({ x: 0, y: 0, w: 1, h: 1 }))).toEqual({ fit: 'cover', position: '50% 50%', safeVisible: false });
  });
});

describe('spec 1.4: the #ambience placeholder', () => {
  it('is drawn from stage 2, thicker each stage, as SVG data URLs', () => {
    expect(builtinAreaPiece('forest', 1)).toBeNull();
    const p2 = builtinAreaPiece('forest', 2)!;
    expect(p2).toMatchObject({ anchor: 'area', src: null, builtin: 'vine', builtinLevel: 2, motion: 'none' });
    expect(builtinAreaPiece('island', 4)).toMatchObject({ builtin: 'frost', builtinLevel: 4, motion: 'breathe' });
    expect(builtinAreaPiece('mountain', 6)!.builtinLevel).toBe(4);
    for (const kind of ['vine', 'frost', 'ash', 'moss', 'petals', 'dust'] as const) {
      const sizes = [2, 3, 4].map((lv) => builtinAreaSrc(kind, lv));
      for (const u of sizes) expect(u).toMatch(/^data:image\/svg\+xml,%3Csvg/);
      expect(decodeURIComponent(sizes[0]!)).toContain('viewBox="0 0 2048 745"');
      expect(sizes[2]!.length).toBeGreaterThan(sizes[0]!.length);
    }
  });
  it('shows only when asked, for the dominant biome, where the pack has no area piece', () => {
    const slots = [slot('island', 0, 1, 1), slot('forest', 1, 4, 3)];
    expect(overlayPieces(slots, null, { side: 'bottom', widthPx: 1000, reduced: false }).some((p) => p.anchor === 'area')).toBe(false);
    const asked = overlayPieces(slots, null, { side: 'bottom', widthPx: 1000, reduced: false, builtinArea: true });
    expect(asked.filter((p) => p.anchor === 'area').map((p) => p.key)).toEqual(['forest:area:area']);
    const own = validateManifest(pack([{ overlay: [area('mine')] }]), BASE).pack;
    expect(overlayPieces(slots, own, { side: 'bottom', widthPx: 1000, reduced: false, builtinArea: true }).filter((p) => p.anchor === 'area').map((p) => p.piece.id)).toEqual(['mine']);
    // Stage 1: no placeholder.
    expect(overlayPieces([slot('forest', 0, 1, 1)], null, { side: 'bottom', widthPx: 1000, reduced: false, builtinArea: true }).some((p) => p.anchor === 'area')).toBe(false);
  });
});

describe('the spec’s full-area example', () => {
  it('validates with no errors or warnings', () => {
    const md = readFileSync(new URL('../../docs/scenery-pack-spec.md', import.meta.url), 'utf8');
    const block = /<!-- example-area -->\s*```json\n([\s\S]*?)```/.exec(md);
    expect(block).not.toBeNull();
    const r = validateManifest(JSON.parse(block![1]!), BASE);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    const f = r.pack!.overlays!.forest!;
    expect(f.stages.map((s) => s.map((p) => p.anchor))).toEqual([[], ['area'], ['area', 'bottom-left'], ['area', 'bottom-left']]);
    expect(areaBytes(f)).toBe(2_380_000);
    expect(overlayBytes(f)).toBe(380_000);
    expect(f.stages[3]![0]!.area).toEqual({ fit: 'cover', safe: { x: 0.08, y: 0.1, w: 0.84, h: 0.8 }, position: 'center', minWidthPx: 720 });
  });
});
