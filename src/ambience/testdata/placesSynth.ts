/*
 * ForgeCoach — ambience/testdata/placesSynth.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.22 test data: a places manifest in places-v1's shape for all 31 colour
 * sets, with relative URLs (places/<slug>/<d|p>/base.webp, <land>-<k>.webp) and
 * the homelands' stage 1 null, for the shape tests (places.test.ts, the DOM
 * tests). The real tagged file is places-v1.places.json beside it.
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

/** A places manifest in places-v1's shape for all 31 colour sets (relative URLs; the homelands' stage 1 null). */
export function synthPlaces(): any {
  const places: Record<string, unknown> = {};
  for (const set of colourSets()) {
    const slug = slugOf(set);
    places[set.join('+')] = {
      slug,
      name: slug === 'cartagena' ? 'Cartagena de Indias' : `Place ${set.join(' ')}`,
      ref: 'places-v1-p0',
      lands: [...set],
      half: {
        src: `places/${slug}/d/base.webp`, width: 2560, height: 800, bytes: 180000, subjectBand: [0.05, 0.65], horizon: 0.55, focal: { x: 0.5, y: 0.5 }, safe: { x: 0, y: 0, w: 1, h: 1 },
        phone: { src: `places/${slug}/p/base.webp`, width: 1152, height: 1440, bytes: 140000, subjectBand: [0.05, 0.64], horizon: 0.54, focal: { x: 0.5, y: 0.47 }, safe: { x: 0, y: 0.03, w: 1, h: 0.89 } },
      },
      layers: Object.fromEntries(set.map((land) => [land, [1, 2, 3, 4, 5, 6].map((k) => (set.length === 1 && k === 1 ? { half: null, phone: null } : { half: pieceRaw(slug, 'd', land, k), phone: pieceRaw(slug, 'p', land, k) }))])),
    };
  }
  return { schema: 1, spec: '1.22', name: 'places-synth', author: 'test', license: 'CC BY 4.0', note: 'synthetic', places };
}

