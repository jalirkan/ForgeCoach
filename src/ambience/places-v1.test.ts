/*
 * ForgeCoach — ambience/places-v1.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.22: `testdata/places-v1.places.json` is the places-v1 tag's
 * `places.json` byte for byte (2026-11-22: 31 places, pictures at the refs
 * places-v1-p1 and places-v1-p2, absolute URLs), hash-pinned as the scenes and
 * pairs files are. A full parse: every colour set has its place, every land six
 * stages with a piece at both shapes, and the only null pieces are the five
 * homelands' stage 1 (their base is stage 1). Nothing here touches the network.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Biome } from './model.ts';
import { GEOGRAPHY } from './pairs.ts';
import { FORGECOACH_PLACES_URL } from './prefs.ts';
import { fetchPlaces, MAX_PLACES_MANIFEST_BYTES, placeFor, placesBytesByRef, validatePlaces } from './places.ts';

const bytes = readFileSync(new URL('./testdata/places-v1.places.json', import.meta.url));
const MANIFEST = `${FORGECOACH_PLACES_URL}places.json`;
const r = validatePlaces(JSON.parse(bytes.toString('utf8')), MANIFEST);
const PLACES = r.places!;

describe('places-v1, the tagged file', () => {
  it('is the tag’s file byte for byte (hash-pinned)', () => {
    expect(bytes.length).toBe(213566);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('cbf1b397e06a6e4bcd34c224ffe6adb257497111c523a8d98703ab0c810f3974');
    expect(bytes.length).toBeLessThan(MAX_PLACES_MANIFEST_BYTES);
  });

  it('validates clean: 31 places, one for every set of colours, spec 1.22', () => {
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(PLACES).toMatchObject({ spec: '1.22', name: 'places-v1' });
    const keys = Object.keys(PLACES.places);
    expect(keys).toHaveLength(31);
    for (let m = 1; m < 32; m++) expect(keys).toContain(GEOGRAPHY.filter((_, i) => m & (1 << i)).join('+'));
    expect(PLACES.places['island+swamp+plains+mountain']).toMatchObject({ slug: 'cartagena', name: 'Cartagena de Indias' });
    expect(PLACES.places['island+swamp+plains+forest+mountain']).toMatchObject({ slug: 'istanbul', name: 'Istanbul' });
    expect(new Set(Object.values(PLACES.places).map((p) => p!.slug)).size).toBe(31);
  });

  it('every land has six stages with a piece at both shapes; the only nulls are the homelands’ stage 1, at both shapes', () => {
    const nulls: string[] = [];
    for (const p of Object.values(PLACES.places)) {
      expect(Object.keys(p!.layers).sort()).toEqual([...p!.lands].sort());
      // Shape-agnostic (places-v2 changes the phone base to 2.22:1 and reuses the desktop piece files for its phone
      // pieces): each base declares its own pixel size, and every file lies in the place's own folder.
      for (const b of [p!.half, p!.half.phone]) {
        expect(b.width).toBeGreaterThanOrEqual(64);
        expect(b.height).toBeGreaterThanOrEqual(64);
        expect(b.src).toContain(`/places/${p!.slug}/`);
      }
      expect(p!.half.phone.src).not.toBe(p!.half.src);
      for (const land of p!.lands) {
        const stages = p!.layers[land as Biome]!;
        expect(stages).toHaveLength(6);
        stages.forEach((st, i) => {
          for (const shape of ['half', 'phone'] as const) {
            const pc = st[shape];
            if (!pc) {
              nulls.push(`${p!.key}/${land}${i + 1}/${shape}`);
              continue;
            }
            expect(pc.src).toContain(`/places/${p!.slug}/`);
            if (shape === 'half') expect(pc.src).toMatch(new RegExp(`/${land}-${i + 1}\\.webp$`));
            expect(pc.x + pc.w).toBeLessThanOrEqual(1.001);
            expect(pc.y + pc.h).toBeLessThanOrEqual(1.001);
          }
        });
      }
    }
    expect(nulls.sort()).toEqual(GEOGRAPHY.flatMap((b) => [`${b}/${b}1/half`, `${b}/${b}1/phone`]).sort());
  });

  it('every state of every colour set has its place composed (16,806 states)', () => {
    let n = 0;
    for (let m = 1; m < 32; m++) {
      const set = GEOGRAPHY.filter((_, i) => m & (1 << i));
      for (let code = 0; code < 6 ** set.length; code++) {
        const st = set.map((biome, i) => ({ biome, stage: (Math.floor(code / 6 ** i) % 6) + 1 }));
        const c = placeFor(PLACES, st)!;
        expect(c.place.key).toBe(set.join('+'));
        expect(c.lands.every((l) => l.piece === c.place.layers[l.biome]![l.stage - 1])).toBe(true);
        n++;
      }
    }
    expect(n).toBe(16806);
  });

  it('declares its files in two refs, each under jsDelivr’s 50 MB', () => {
    const refs = placesBytesByRef(PLACES);
    expect([...refs.keys()].sort()).toEqual(['places-v1-p1', 'places-v1-p2']);
    for (const b of refs.values()) expect(b).toBeLessThan(45 * 1024 * 1024);
  });

  it('fetchPlaces reads it', async () => {
    const got = await fetchPlaces(FORGECOACH_PLACES_URL, { fetch: async () => ({ ok: true, status: 200, text: async () => bytes.toString('utf8') }) });
    expect(got.errors).toEqual([]);
    expect(Object.keys(got.places!.places)).toHaveLength(31);
  });
});
