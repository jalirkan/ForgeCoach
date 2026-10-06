/*
 * ForgeCoach — ambience/testdata/accentGolden.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * What the board-accent engine makes of a pack, across a spread of boards
 * (one to three biomes, every stage, both sides, phone to desktop widths,
 * reduced motion, the preview's stage slider). `pack-v2.golden.json` holds
 * this for pack-v2's manifest (`pack-v2.scenery.json`, the live pack's
 * scenery.json as published at the `pack-v2` tag of forgecoach-scenery; no
 * art) and for the built-in placeholders, as computed by the spec 1.3
 * engine, so later spec versions can prove they leave a 1.3 pack unchanged.
 */
import { validateManifest } from '../manifest.ts';
import { overlayPieces } from '../overlay.ts';
import type { Biome, SlotState } from '../model.ts';

export const GOLDEN_BASE = 'https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pack-v2/pack/scenery.json';

const slot = (biome: Biome, index: number, weight: number, stage: number): SlotState => ({ biome, index, weight, stage, peak: stage });

const BOARDS: { name: string; slots: SlotState[] }[] = [
  { name: 'empty', slots: [] },
  ...(['island', 'forest', 'mountain', 'plains', 'swamp', 'wastes'] as Biome[]).flatMap((b) => [1, 2, 3, 4].map((st) => ({ name: `${b}-${st}`, slots: [slot(b, 0, [1, 2, 4, 6][st - 1]!, st)] }))),
  { name: 'island+forest', slots: [slot('island', 0, 2, 2), slot('forest', 1, 4, 3)] },
  { name: 'forest+island', slots: [slot('forest', 0, 6, 4), slot('island', 1, 1, 1)] },
  { name: 'swamp+mountain+plains', slots: [slot('swamp', 0, 2, 2), slot('mountain', 1, 4, 3), slot('plains', 2, 1, 1)] },
  { name: 'withered', slots: [slot('forest', 0, 0, 0), slot('island', 1, 2, 2)] },
];
const WIDTHS = [null, 240, 370, 599, 600, 1100, 2400];

/** The validator's view of the manifest and the placed accents for every board, side, width and motion setting. */
export function accentGolden(manifest: unknown | null): unknown {
  const r = manifest === null ? null : validateManifest(manifest, GOLDEN_BASE);
  const pack = r?.pack ?? null;
  const placed: Record<string, unknown> = {};
  for (const b of BOARDS)
    for (const side of ['bottom', 'top'] as const)
      for (const widthPx of WIDTHS)
        for (const reduced of [false, true]) placed[`${b.name}|${side}|${widthPx}|${reduced}`] = overlayPieces(b.slots, pack, { side, widthPx, reduced });
  for (const stageOverride of [1, 2, 3, 4, 6]) placed[`override-${stageOverride}`] = overlayPieces(BOARDS[BOARDS.length - 2]!.slots, pack, { side: 'bottom', widthPx: 1100, reduced: false, stageOverride });
  return JSON.parse(JSON.stringify({ errors: r?.errors ?? null, warnings: r?.warnings ?? null, overlays: pack?.overlays ?? null, placed }));
}

/**
 * The golden file's form: the validator's output in full, and each board's
 * placement as compact rows (key, anchor, flipY, maxPx, animate; a few
 * widths, motion on) plus a digest of the full placed pieces (their every field), to keep the file small.
 */
export function compactGolden(full: unknown, digest: (s: string) => string): unknown {
  const g = full as { errors: unknown; warnings: unknown; overlays: unknown; placed: Record<string, { key: string; anchor: string; flipY: boolean; maxPx: number; animate: boolean }[]> };
  const rows: Record<string, unknown> = {};
  for (const [k, list] of Object.entries(g.placed)) if (!/\|true$/.test(k) && !/\|(240|599|2400|null)\|/.test(k)) rows[k] = list.map((p) => [p.key, p.anchor, p.flipY, p.maxPx, p.animate]);
  return { errors: g.errors, warnings: g.warnings, overlays: g.overlays, placed: rows, placedDigest: digest(JSON.stringify(g.placed)) };
}
