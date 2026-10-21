/*
 * ForgeCoach — ambience/pairs-v2.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * pairs-v2, the pair-band pack (spec 1.9) FORGECOACH_PAIRS_URL pointed at
 * until pairs-v3 (pairs-v3.test.ts): a snapshot of its pairs.json, byte for byte what jsDelivr serves at
 * https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v2/pairs.json
 * (sha256 55c13cda03faa97d4949f102d9cc3c8fb1c3ab67089d592fd69c2ac7c6567800,
 * compared with `cmp` against two fetches of the CDN's copy on 2026-10-17;
 * every one of the 272 pictures it names answered 200 from the same ref, and
 * their sizes add up to the manifest's declared 32,563,824 bytes). It is
 * pairs-v1 (pairs-v1.test.ts) with two places repainted as their shock land's
 * look, Justin's pick: plains+swamp is Godless Shrine (one broken pale shrine
 * among the bleached stones) and forest+island Breeding Pool (jungle mounds in
 * a turquoise lagoon). `dual` still names the dual land, so the caption reads
 * "Scrubland (Godless Shrine)"; each pair also carries a `place`, which the
 * reader does not read and does not warn about.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { halfLayout } from './layout.ts';
import { MAX_TRANSITION_FRAMES } from './manifest.ts';
import { pairKey, type Biome, type SlotState } from './model.ts';
import { DEFAULT_PAIR_BAND, DEFAULT_STAGE_MAP, MAX_PAIRS_PACK_BYTES, pairBands, pairsBytes, validatePairs } from './pairs.ts';

/** The tag this snapshot is from (FORGECOACH_PAIRS_URL now names pairs-v3); the tag stays up. */
const FORGECOACH_PAIRS_URL = 'https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v2/';

const FIVE: Biome[] = ['plains', 'island', 'swamp', 'mountain', 'forest'];
const slot = (b: Biome, index: number): SlotState => ({ biome: b, index, weight: 2, stage: 2, peak: 2 });
const SHOCK_LOOKS = ['forest+island', 'plains+swamp'];

describe('pairs-v2', () => {
  const bytes = readFileSync(new URL('./testdata/pairs-v2.pairs.json', import.meta.url));
  const raw = JSON.parse(bytes.toString('utf8'));
  const r = validatePairs(raw, `${FORGECOACH_PAIRS_URL}pairs.json`);
  const pairs = r.pairs!;

  it('is the file jsDelivr serves at pairs-v2', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('55c13cda03faa97d4949f102d9cc3c8fb1c3ab67089d592fd69c2ac7c6567800');
  });

  it('validates with no errors and no warnings, written for spec 1.9, its extra `place` field ignored', () => {
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(pairs.spec).toBe('1.9');
    expect(pairs.name).toBe('ForgeCoach pair scenery, pairs-v2');
    expect(pairs.note).toBe(raw.note);
    expect(pairs.note).toContain('Godless Shrine');
    expect(pairs.note).toContain('Breeding Pool');
    for (const key of Object.keys(raw.pairs)) {
      expect(typeof raw.pairs[key].place).toBe('string');
      expect(pairs.pairs[key]).not.toHaveProperty('place');
    }
  });

  it('keeps each dual’s name as `dual`, the shock land as `shock`', () => {
    const names = Object.fromEntries(Object.values(pairs.pairs).map((p) => [p!.key, `${p!.dual} / ${p!.shock}`]));
    expect(names).toEqual({
      'forest+island': 'Tropical Island / Breeding Pool',
      'forest+mountain': 'Taiga / Stomping Ground',
      'forest+plains': 'Savannah / Temple Garden',
      'forest+swamp': 'Bayou / Overgrown Tomb',
      'island+mountain': 'Volcanic Island / Steam Vents',
      'island+plains': 'Tundra / Hallowed Fountain',
      'island+swamp': 'Underground Sea / Watery Grave',
      'mountain+plains': 'Plateau / Sacred Foundry',
      'mountain+swamp': 'Badlands / Blood Crypt',
      'plains+swamp': 'Scrubland / Godless Shrine',
    });
  });

  it('has the ten pairs, each with three stages of its own pictures, desktop and phone at 1x and 2x, a subject band on every phone', () => {
    const keys = Object.keys(pairs.pairs).sort();
    expect(keys).toEqual(FIVE.flatMap((a, i) => FIVE.slice(i + 1).map((b) => pairKey(a, b))).sort());
    for (const p of Object.values(pairs.pairs)) {
      const dir = `${FORGECOACH_PAIRS_URL}pairs/${p!.left}-${p!.right}/`;
      expect(p!.left < p!.right).toBe(true);
      expect(p!.stages).toHaveLength(3);
      p!.stages.forEach((s, i) => {
        const h = s.half!;
        expect([h.src, h.src2x, h.phone!.src, h.phone!.src2x]).toEqual([`${dir}s${i + 1}-half.webp`, `${dir}s${i + 1}-half@2x.webp`, `${dir}s${i + 1}-phone.webp`, `${dir}s${i + 1}-phone@2x.webp`]);
        expect(h.bytes).toBeGreaterThan(0);
      });
      for (const s of raw.pairs[p!.key].stages) expect(s.half.phone.subjectBand).toEqual([0.416, 0.514]);
      for (const s of p!.stages) expect(s.half!.phone!.subjectBand).toEqual([0.416, 0.514]);
    }
  });

  it('changes only the two shock looks: the other eight pairs are pairs-v1’s, file for file and byte for byte', () => {
    const v1 = JSON.parse(readFileSync(new URL('./testdata/pairs-v1.pairs.json', import.meta.url), 'utf8'));
    for (const key of Object.keys(raw.pairs)) {
      const { place: _place, ...entry } = raw.pairs[key];
      if (SHOCK_LOOKS.includes(key)) {
        expect(entry.stages.map((s: { half: { bytes: number } }) => s.half.bytes)).not.toEqual(v1.pairs[key].stages.map((s: { half: { bytes: number } }) => s.half.bytes));
        expect(entry.dual).toBe(v1.pairs[key].dual);
        expect(entry.shock).toBe(v1.pairs[key].shock);
      } else expect(entry).toEqual(v1.pairs[key]);
    }
  });

  it('plays two to four frames on each of its two stage steps, inside the reader’s cap of four', () => {
    expect(MAX_TRANSITION_FRAMES).toBe(4);
    const counts: Record<string, number[]> = {};
    for (const p of Object.values(pairs.pairs)) {
      const t = p!.transitions!;
      expect(t.steps.map((s) => s.from)).toEqual([1, 2]);
      expect(t.steps.map((s) => s.frames.length)).toEqual(raw.pairs[p!.key].transitions.steps.map((s: { frames: unknown[] }) => s.frames.length));
      for (const s of t.steps) {
        expect(s.frames.length).toBeGreaterThanOrEqual(2);
        expect(s.frames.length).toBeLessThanOrEqual(4);
        expect(s.frames.every((f) => f.src.startsWith(`${FORGECOACH_PAIRS_URL}pairs/${p!.left}-${p!.right}/`) && !!f.phone)).toBe(true);
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
    expect(pairsBytes(pairs)).toBe(32_563_824);
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
