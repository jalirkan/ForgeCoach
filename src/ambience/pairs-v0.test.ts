/*
 * ForgeCoach — ambience/pairs-v0.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * pairs-v0, the DRAFT pair-band pack (spec 1.9) that FORGECOACH_PAIRS_URL
 * points at until pairs-v1's art lands: a snapshot of its pairs.json, byte
 * for byte what jsDelivr serves at
 * https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v0/pairs.json
 * (sha256 e32af865a6c7092e98e954d92233828de82ca1f4c84cbe1b04b49bc7f111cd50,
 * compared with `cmp` against the CDN's copy on 2026-10-16, when the tag was
 * pushed and warmed: 20 files, 0 failed). One picture per pair, the approved
 * stage-3 concept, reused for all three stages; no transitions.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { halfLayout } from './layout.ts';
import { pairKey, type Biome, type SlotState } from './model.ts';
import { pairBands, pairsBytes, validatePairs } from './pairs.ts';
import { FORGECOACH_PAIRS_URL } from './prefs.ts';

const FIVE: Biome[] = ['plains', 'island', 'swamp', 'mountain', 'forest'];
const slot = (b: Biome, index: number): SlotState => ({ biome: b, index, weight: 2, stage: 2, peak: 2 });

describe('pairs-v0', () => {
  const bytes = readFileSync(new URL('./testdata/pairs-v0.pairs.json', import.meta.url));
  const raw = JSON.parse(bytes.toString('utf8'));
  const r = validatePairs(raw, `${FORGECOACH_PAIRS_URL}pairs.json`);
  const pairs = r.pairs!;
  it('is the pairs URL for now, and the snapshot is the file jsDelivr serves', () => {
    expect(FORGECOACH_PAIRS_URL).toBe('https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v0/');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('e32af865a6c7092e98e954d92233828de82ca1f4c84cbe1b04b49bc7f111cd50');
  });
  it('validates with no errors and no warnings, written for spec 1.9, and says it is a draft', () => {
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(pairs.spec).toBe('1.9');
    expect(pairs.note).toMatch(/^DRAFT/);
    expect(pairs.note).toMatch(/reused for all three stages/);
  });
  it('has the ten pairs, each the same picture at its three stages, a desktop and a phone picture, no frames, the default band and map', () => {
    const keys = Object.keys(pairs.pairs).sort();
    expect(keys).toEqual(FIVE.flatMap((a, i) => FIVE.slice(i + 1).map((b) => pairKey(a, b))).sort());
    for (const p of Object.values(pairs.pairs)) {
      expect(p!.left < p!.right).toBe(true);
      expect(p!.stages).toHaveLength(3);
      expect(new Set(p!.stages.map((s) => s.half!.src)).size).toBe(1);
      const h = p!.stages[0]!.half!;
      expect(h.src).toBe(`${FORGECOACH_PAIRS_URL}pairs/${p!.left}-${p!.right}/s2-half.webp`);
      expect(h.phone!.src).toBe(`${FORGECOACH_PAIRS_URL}pairs/${p!.left}-${p!.right}/s2-phone.webp`);
      expect([h.src2x, h.phone!.src2x]).toEqual([null, null]);
      // The phone picture is a slice of the desktop one, not outpainted: its subject band is the desktop's.
      expect(h.phone!.subjectBand).toEqual([0.35, 0.6]);
      expect(p!.transitions).toBeNull();
      expect(p!.band).toEqual({ min: 0.1, perDual: 0.04, max: 0.34 });
      expect(p!.stageMap).toEqual([
        [1, 2],
        [3, 4],
        [5, 6],
      ]);
      expect(p!.dual && p!.shock).toBeTruthy();
    }
    // About 1.2 MB of pictures in all, counted once each.
    expect(pairsBytes(pairs)).toBeGreaterThan(1_000_000);
    expect(pairsBytes(pairs)).toBeLessThan(3_000_000);
  });
  it('draws a band between any two colours on one side, in either order', () => {
    for (const a of FIVE)
      for (const b of FIVE) {
        if (a === b) continue;
        const [band] = pairBands(halfLayout([slot(a, 0), slot(b, 1)], null), pairs);
        expect(band, `${a} | ${b}`).toMatchObject({ key: pairKey(a, b), mirror: a > b, width: 0.1, stage: 1 });
      }
  });
});
