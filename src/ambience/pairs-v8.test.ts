/*
 * ForgeCoach — ambience/pairs-v8.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * pairs-v8 (spec 1.18, tagged 2026-11-06): the pairs FORGECOACH_PAIRS_FULL_URL
 * points at under `?pairfull=1`. The seam grid painted in oil (oil-v2's 160
 * cells, one sky a cell), every cell's desktop and phone picture in this ref,
 * named relatively; each pair keeps its band, stage map, `dual`, `shock`,
 * `place` and its stage halves at `@pairs-v2` (a pair needs a half to be
 * planned). Dropped against pairs-v7.1: the 1.15 panoramas, the 1.16
 * painted-in pictures (a third colour now draws its 1.19 a cut-out) and the
 * band frames (1.7 transitions).
 *
 * `testdata/pairs-v8.tag.pairs.json` is the tagged manifest byte for byte,
 * https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v8/pairs.json.
 * pairs-v7.1 stays at its tag (pairs-v7.1.test.ts).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_PAIRS_PACK_BYTES, pairsRefBytes, validatePairs } from './pairs.ts';
import { DEFAULT_PREFS, effectivePrefs, FORGECOACH_PAIRS_FULL_URL, FORGECOACH_PAIRS_URL, pairsUrlOf } from './prefs.ts';

const CDN = 'https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery';
const V8 = `${CDN}@pairs-v8/`;
const V2 = `${CDN}@pairs-v2/`;
const PAIRS = ['forest+island', 'forest+mountain', 'forest+plains', 'forest+swamp', 'island+mountain', 'island+plains', 'island+swamp', 'mountain+plains', 'mountain+swamp', 'plains+swamp'];

const bytes = readFileSync(new URL('./testdata/pairs-v8.tag.pairs.json', import.meta.url));
const raw = JSON.parse(bytes.toString('utf8'));
const relative = (s: unknown) => typeof s === 'string' && !/^[a-z]+:|^\//.test(s);

describe('pairs-v8: the flag’s default', () => {
  it('?pairfull=1 with no ?pairs= is pairs-v8; the board without the flag stays on FORGECOACH_PAIRS_URL', () => {
    expect(FORGECOACH_PAIRS_FULL_URL).toBe(V8);
    expect(pairsUrlOf(effectivePrefs(DEFAULT_PREFS, '?pairfull=1', ''))).toBe(V8);
    expect(pairsUrlOf(effectivePrefs(DEFAULT_PREFS, '', '#ambience?pairfull=on'))).toBe(V8);
    expect(pairsUrlOf(effectivePrefs(DEFAULT_PREFS, '', ''))).toBe(FORGECOACH_PAIRS_URL);
  });
});

describe('pairs-v8: the published manifest', () => {
  const r = validatePairs(raw, `${V8}pairs.json`);
  const pairs = r.pairs!;

  it('is the file jsDelivr serves byte for byte (the pairs-v8 tag, 2026-11-06)', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('bcbca31336311765c3dc9cc1e6c965a2ebaefbe2ec7f5d3a817e9d45ec53ac72');
    expect(bytes.length).toBe(195_774);
  });

  it('validates with no errors, written for 1.18; a budget warning on every pair but mountain+plains; its ref under the limit', () => {
    expect(r.errors).toEqual([]);
    expect(raw.schema).toBe(1);
    expect(pairs.spec).toBe('1.18');
    expect(raw.name).toMatch(/pairs-v8/);
    expect(raw.note).toMatch(/^pairs-v8 /);
    expect(r.warnings).toHaveLength(9);
    expect(r.warnings.map((w) => w.split(':')[0]).sort()).toEqual(PAIRS.filter((k) => k !== 'mountain+plains').map((k) => `pairs.${k}`));
    for (const w of r.warnings) expect(w).toMatch(/of them the seam grid \(1\.17\); the budget is 4 MB per pair/);
    expect(pairsRefBytes(pairs)).toBeLessThan(MAX_PAIRS_PACK_BYTES);
  });

  it('has ten pairs and 160 cells, each with a relative desktop and phone picture and nothing painted in', () => {
    expect(Object.keys(raw.pairs).sort()).toEqual(PAIRS);
    let cells = 0;
    for (const [key, p] of Object.entries<Record<string, any>>(raw.pairs)) {
      expect(Object.keys(p.grid), key).toHaveLength(16);
      for (const [k, c] of Object.entries<Record<string, any>>(p.grid)) {
        expect(relative(c.src), `${key}.${k}: ${c.src}`).toBe(true);
        expect(relative(c.phone?.src), `${key}.${k}: ${c.phone?.src}`).toBe(true);
        expect(c.elements, `${key}.${k}`).toBeUndefined();
        cells++;
      }
      // The reader sees the same: in this ref, and no painted-in colour.
      for (const [k, c] of Object.entries(pairs.pairs[key]!.grid!.cells)) {
        expect(c!.src.startsWith(V8), `${key}.${k}`).toBe(true);
        expect(c!.phone!.src.startsWith(V8), `${key}.${k}`).toBe(true);
        expect(Object.keys(c!.elements ?? {}), `${key}.${k}`).toEqual([]);
      }
    }
    expect(cells).toBe(160);
  });

  it('keeps only each stage’s half, at @pairs-v2: no panorama, no transitions', () => {
    for (const [key, p] of Object.entries<Record<string, any>>(raw.pairs)) {
      expect(p.transitions, key).toBeUndefined();
      expect(p.stages.length, key).toBeGreaterThan(0);
      for (const [i, st] of p.stages.entries()) {
        expect(Object.keys(st), `${key} s${i + 1}`).toEqual(['half']);
        const h = st.half;
        for (const s of [h.src, h.src2x, h.phone.src, h.phone.src2x]) expect(s.startsWith(`${V2}pairs/`), `${key} s${i + 1}: ${s}`).toBe(true);
      }
    }
  });
});
