/*
 * ForgeCoach — ambience/testdata/placesSynth.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.22 test data: a places manifest in places-v1's shape for all 31 colour
 * sets, with relative URLs (places/<slug>/<d|p>/base.webp, <land>-<k>.webp) and
 * the homelands' stage 1 null, for the shape tests (places.test.ts, the DOM
 * tests). The real tagged file is places-v6.places.json beside it.
 */
import type { Biome } from '../model.ts';
import { GEOGRAPHY } from '../pairs.ts';

/** Every non-empty subset of the five, in the geography's order: the 31 colour sets. */
export function colourSets(): Biome[][] {
  const out: Biome[][] = [];
  for (let m = 1; m < 32; m++) out.push(GEOGRAPHY.filter((_, i) => m & (1 << i)));
  return out;
}

const SLUGS: Record<string, string> = { 'island+swamp+plains+mountain': 'cartagena' };
const slugOf = (set: readonly Biome[]) => SLUGS[set.join('+')] ?? set.join('-');
const pieceRaw = (slug: string, shape: 'd' | 'p', land: Biome, k: number) => ({ src: `places/${slug}/${shape}/${land}-${k}.webp`, x: 0.1 * GEOGRAPHY.indexOf(land), y: 0.4 - 0.05 * k, w: 0.1, h: 0.05 * k + 0.1, width: 100 + k, height: 80 + k, bytes: 1000 * k });

/**
 * A places manifest for all 31 colour sets (relative URLs; the homelands' stage 1 null). `v1` (the default): places-v1's
 * shape -- a 4:5 phone base (1152 × 1440) and a phone piece file of its own in `p/`. `v2`: places-v2's -- a 2.22:1
 * phone base (2560 × 1152, the desktop panorama with sky above and ground below) whose pieces are the DESKTOP piece
 * files at another box (shifted down by the extra sky), except stage 6, which touches the old bottom edge and has a
 * file of its own (`p6/`). `v3` (or `v4`, `v5` or `v6`, the current pack, whose shape is v3's): places-v3's -- the same, the phone base 1.82:1 (2560 × 1408), the
 * desktop base 320 px down it (sky above, 288 px of near ground below).
 */
export function synthPlaces(shape: 'v1' | 'v2' | 'v3' | 'v4' | 'v5' | 'v6' = 'v1'): any {
  const places: Record<string, unknown> = {};
  const v2 = shape !== 'v1';
  // The desktop base (800 px high) sits `top` px down a phone base `high` px high: v2 176 of 1152, v3 320 of 1408.
  const [top, high] = shape === 'v3' || shape === 'v4' || shape === 'v5' || shape === 'v6' ? [320, 1408] : [176, 1152];
  const phonePiece = (slug: string, land: Biome, k: number) => {
    if (!v2) return pieceRaw(slug, 'p', land, k);
    const d = pieceRaw(slug, 'd', land, k);
    const s = 800 / high;
    return { ...d, ...(k === 6 ? { src: `places/${slug}/p6/${land}-6.webp`, bytes: 777 } : {}), y: +((top + d.y * 800) / high).toFixed(4), h: +(d.h * s).toFixed(4) };
  };
  for (const set of colourSets()) {
    const slug = slugOf(set);
    places[set.join('+')] = {
      slug,
      name: slug === 'cartagena' ? 'Cartagena de Indias' : `Place ${set.join(' ')}`,
      ref: 'places-v1-p0',
      lands: [...set],
      half: {
        src: `places/${slug}/d/base.webp`, width: 2560, height: 800, bytes: 180000, subjectBand: [0.05, 0.65], horizon: 0.55, focal: { x: 0.5, y: 0.5 }, safe: { x: 0, y: 0, w: 1, h: 1 },
        phone: v2
          ? { src: `places/${slug}/p/base.webp`, width: 2560, height: high, bytes: 200000, subjectBand: [0.25, 0.63], horizon: 0.57, focal: { x: 0.5, y: 0.49 }, safe: { x: 0, y: 0.25, w: 1, h: 0.46 } }
          : { src: `places/${slug}/p/base.webp`, width: 1152, height: 1440, bytes: 140000, subjectBand: [0.05, 0.64], horizon: 0.54, focal: { x: 0.5, y: 0.47 }, safe: { x: 0, y: 0.03, w: 1, h: 0.89 } },
      },
      layers: Object.fromEntries(set.map((land) => [land, [1, 2, 3, 4, 5, 6].map((k) => (set.length === 1 && k === 1 ? { half: null, phone: null } : { half: pieceRaw(slug, 'd', land, k), phone: phonePiece(slug, land, k) }))])),
    };
  }
  return { schema: 1, spec: '1.22', name: `places-synth-${shape}`, author: 'test', license: 'CC BY 4.0', note: 'synthetic', places };
}
