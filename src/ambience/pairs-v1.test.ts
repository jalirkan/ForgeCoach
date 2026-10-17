/*
 * ForgeCoach — ambience/pairs-v1.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * pairs-v1, the pair-band pack (spec 1.9) FORGECOACH_PAIRS_URL pointed at
 * until pairs-v2 (pairs-v2.test.ts): a snapshot of its pairs.json, byte for
 * byte what jsDelivr serves at
 * https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v1/pairs.json
 * (sha256 38e6efadf2054991b9bafc9a6504942519ed06ccef9d142e82b0dd327b14a0c9,
 * compared with `cmp` against two fetches of the CDN's copy on 2026-10-17;
 * every one of the 272 pictures it names answered 200 from the same ref, and
 * their sizes add up to the manifest's declared 32,669,372 bytes). Three
 * stages per pair, desktop and phone at 1x and 2x, two to four frames per
 * step. The tag stays up and this test keeps its snapshot, against the tag's
 * own URL rather than the constant; the draft pairs-v0's went with it.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { halfLayout } from './layout.ts';
import { MAX_TRANSITION_FRAMES } from './manifest.ts';
import { pairKey, type Biome, type SlotState } from './model.ts';
import { DEFAULT_PAIR_BAND, DEFAULT_STAGE_MAP, MAX_PAIRS_PACK_BYTES, pairBands, pairsBytes, validatePairs } from './pairs.ts';

/** The tag this snapshot is from (FORGECOACH_PAIRS_URL now names pairs-v2). */
const PAIRS_V1_URL = 'https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v1/';

const FIVE: Biome[] = ['plains', 'island', 'swamp', 'mountain', 'forest'];
const slot = (b: Biome, index: number): SlotState => ({ biome: b, index, weight: 2, stage: 2, peak: 2 });

describe('pairs-v1', () => {
  const bytes = readFileSync(new URL('./testdata/pairs-v1.pairs.json', import.meta.url));
  const raw = JSON.parse(bytes.toString('utf8'));
  const r = validatePairs(raw, `${PAIRS_V1_URL}pairs.json`);
  const pairs = r.pairs!;

  it('is the file jsDelivr serves at pairs-v1', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('38e6efadf2054991b9bafc9a6504942519ed06ccef9d142e82b0dd327b14a0c9');
  });

  it('validates with no errors and no warnings, written for spec 1.9', () => {
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(pairs.spec).toBe('1.9');
    expect(pairs.name).toBe('ForgeCoach pair scenery, pairs-v1');
  });

  it('has the ten pairs, each with three stages of its own pictures, desktop and phone at 1x and 2x, a subject band on every phone', () => {
    const keys = Object.keys(pairs.pairs).sort();
    expect(keys).toEqual(FIVE.flatMap((a, i) => FIVE.slice(i + 1).map((b) => pairKey(a, b))).sort());
    for (const p of Object.values(pairs.pairs)) {
      const dir = `${PAIRS_V1_URL}pairs/${p!.left}-${p!.right}/`;
      expect(p!.left < p!.right).toBe(true);
      expect(p!.dual && p!.shock).toBeTruthy();
      expect(p!.stages).toHaveLength(3);
      p!.stages.forEach((s, i) => {
        const h = s.half!;
        expect([h.src, h.src2x, h.phone!.src, h.phone!.src2x]).toEqual([`${dir}s${i + 1}-half.webp`, `${dir}s${i + 1}-half@2x.webp`, `${dir}s${i + 1}-phone.webp`, `${dir}s${i + 1}-phone@2x.webp`]);
        expect(h.bytes).toBeGreaterThan(0);
      });
      // The phone pictures declare their own subject band, in the raw manifest and after the reader.
      for (const s of raw.pairs[p!.key].stages) expect(s.half.phone.subjectBand).toEqual([0.416, 0.514]);
      for (const s of p!.stages) expect(s.half!.phone!.subjectBand).toEqual([0.416, 0.514]);
    }
  });

  it('plays two to four frames on each of its two stage steps, inside the reader’s cap of four', () => {
    expect(MAX_TRANSITION_FRAMES).toBe(4);
    const counts: Record<string, number[]> = {};
    for (const p of Object.values(pairs.pairs)) {
      const t = p!.transitions!;
      expect(t.steps.map((s) => s.from)).toEqual([1, 2]);
      // Nothing was cut: the reader kept every frame the manifest gives.
      expect(t.steps.map((s) => s.frames.length)).toEqual(raw.pairs[p!.key].transitions.steps.map((s: { frames: unknown[] }) => s.frames.length));
      for (const s of t.steps) {
        expect(s.frames.length).toBeGreaterThanOrEqual(2);
        expect(s.frames.length).toBeLessThanOrEqual(4);
        expect(s.frames.every((f) => f.src.startsWith(`${PAIRS_V1_URL}pairs/${p!.left}-${p!.right}/`) && !!f.phone)).toBe(true);
      }
      counts[p!.key] = t.steps.map((s) => s.frames.length);
    }
    expect(counts).toEqual({
      'forest+island': [4, 4],
      'forest+mountain': [3, 4],
      'forest+plains': [4, 4],
      'forest+swamp': [4, 4],
      'island+mountain': [4, 4],
      'island+plains': [4, 4],
      'island+swamp': [3, 2],
      'mountain+plains': [4, 4],
      'mountain+swamp': [4, 4],
      'plains+swamp': [4, 4],
    });
  });

  it('keeps the default band and stage map', () => {
    for (const p of Object.values(pairs.pairs)) {
      expect(p!.band).toEqual(DEFAULT_PAIR_BAND);
      expect(p!.stageMap).toEqual(DEFAULT_STAGE_MAP);
    }
  });

  it('declares about 33 MB of pictures, inside the pairs pack budget', () => {
    expect(pairsBytes(pairs)).toBe(32_669_372);
    expect(pairsBytes(pairs)).toBeLessThan(MAX_PAIRS_PACK_BYTES);
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
