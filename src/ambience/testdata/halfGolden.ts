/*
 * ForgeCoach — ambience/testdata/halfGolden.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * What the half-board layout (spec 1.5) makes of a pack across a spread of
 * boards (one to three biomes, every stage, a withered slot) and half sizes
 * (a desktop half, a wide desktop half, a phone's portrait half and a short
 * one): each slot's share, span, stage, which art it shows and where that
 * art's frame sits. `half.golden.json` holds this for pack-v2 (strip art,
 * cover-cropped), the built-in scenery (no pack) and the spec's 1.5 example
 * pack, so a later change to the layout shows up as a diff.
 */
import { validateManifest } from '../manifest.ts';
import { halfArt, halfFrame, halfLayout, halfSpans } from '../layout.ts';
import type { Biome, SlotState } from '../model.ts';

const slot = (biome: Biome, index: number, weight: number, stage: number): SlotState => ({ biome, index, weight, stage, peak: stage });

export const HALF_BOARDS: { name: string; slots: SlotState[] }[] = [
  { name: 'empty', slots: [] },
  ...(['island', 'forest', 'mountain', 'plains', 'swamp', 'wastes'] as Biome[]).flatMap((b) => [1, 2, 3, 4].map((st) => ({ name: `${b}-${st}`, slots: [slot(b, 0, [1, 2, 4, 6][st - 1]!, st)] }))),
  // §5's own examples: 3 Islands : 2 Mountains; 5 Islands : 1 Mountain (a stage-3 island beside a stage-1 mountain).
  { name: 'island3+mountain2', slots: [slot('island', 0, 3, 2), slot('mountain', 1, 2, 2)] },
  { name: 'island5+mountain1', slots: [slot('island', 0, 5, 3), slot('mountain', 1, 1, 1)] },
  { name: 'forest8+island1', slots: [slot('forest', 0, 8, 4), slot('island', 1, 1, 1)] },
  { name: 'swamp3+mountain2+plains2', slots: [slot('swamp', 0, 3, 2), slot('mountain', 1, 2, 2), slot('plains', 2, 2, 2)] },
  { name: 'dual-halves', slots: [slot('island', 0, 1.5, 1), slot('plains', 1, 0.5, 1)] },
  { name: 'withered', slots: [slot('forest', 0, 0, 0), slot('island', 1, 2, 2)] },
];

/** Half sizes in CSS px: a desktop half, a wide desktop half (the coach panel shut), a phone's portrait half, a short one. */
export const HALF_BOXES: { name: string; w: number; h: number }[] = [
  { name: 'desktop', w: 810, h: 285 },
  { name: 'wide', w: 1660, h: 320 },
  { name: 'phone', w: 374, h: 330 },
  { name: 'phone-short', w: 374, h: 170 },
];

/** The validator's view of the half fields, and every board's half at every size. */
export function halfGolden(manifest: unknown | null, base = 'https://example.test/pack/scenery.json'): unknown {
  const r = manifest === null ? null : validateManifest(manifest, base);
  const pack = r?.pack ?? null;
  const boards: Record<string, unknown> = {};
  for (const b of HALF_BOARDS) {
    const layout = halfLayout(b.slots, pack);
    for (const box of HALF_BOXES) {
      const spans = halfSpans(layout, box.w, pack?.half?.seamRatio);
      boards[`${b.name}|${box.name}`] = layout.map((l, i) => {
        const art = halfArt(pack, l.slot.biome, l.stage);
        const span = spans[i]!;
        const f = halfFrame({ w: span.width, h: box.h }, art);
        // One compact row per slot: biome, stage, share, span (left, width px), art, frame (left, top, width, height as fractions of the slot).
        return [l.slot.biome, l.stage, l.share, span.left, span.width, art.source, f.left, f.top, f.width, f.height];
      });
    }
  }
  const halves = Object.fromEntries(Object.entries(pack?.biomes ?? {}).map(([b, v]) => [b, v!.stages.map((s) => s.half ?? null)]));
  return JSON.parse(JSON.stringify({ errors: r?.errors ?? null, warnings: r?.warnings ?? null, half: pack?.half ?? null, halves, boards }));
}
