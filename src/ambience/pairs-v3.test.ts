/*
 * ForgeCoach — ambience/pairs-v3.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * pairs-v3, the pair pack (spec 1.12) FORGECOACH_PAIRS_URL pointed at until
 * pairs-v3.1 (pairs-v3.1.test.ts): a snapshot of its pairs.json, byte for byte what jsDelivr serves at
 * https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v3/pairs.json
 * (sha256 f19d3bde92160b1e98717d35dc40307844514d883fa2067d93d69b3c9b011318, compared with `cmp` against the CDN's copy on 2026-10-21;
 * every one of the 200 pictures it names answered 200 from the same ref,
 * and their sizes add up to the manifest's declared 7,792,812 bytes). Every
 * pair is a MOTIF pair: the road, river or causeway both lands share, a
 * transparent picture drawn over the plain seam from the foreground up to the
 * horizon (the meeting road, Justin's pick of 2026-10-19). Three stages (a
 * faint track, a worn road, the full road), desktop and phone at 1x and 2x,
 * two frames per stage step. pairs-v2 (pairs-v2.test.ts) stays at its tag.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { halfSeams } from './bridges.ts';
import { halfLayout } from './layout.ts';
import { MAX_TRANSITION_FRAMES } from './manifest.ts';
import { pairKey, type Biome, type SlotState } from './model.ts';
import { DEFAULT_STAGE_MAP, MAX_PAIR_HALF_BYTES, MAX_PAIRS_PACK_BYTES, halfRow, motifBands, motifWidth, pairBands, pairHalfAt, pairMotifAt, pairsBytes, panelBands, validatePairs } from './pairs.ts';

/** The tag this snapshot is from (FORGECOACH_PAIRS_URL now names pairs-v3.1); the tag stays up. */
const FORGECOACH_PAIRS_URL = 'https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pairs-v3/';

const FIVE: Biome[] = ['plains', 'island', 'swamp', 'mountain', 'forest'];
const slot = (b: Biome, index: number, weight = 2): SlotState => ({ biome: b, index, weight, stage: Math.min(6, weight), peak: Math.min(6, weight) });

describe('pairs-v3', () => {
  const bytes = readFileSync(new URL('./testdata/pairs-v3.pairs.json', import.meta.url));
  const raw = JSON.parse(bytes.toString('utf8'));
  const r = validatePairs(raw, `${FORGECOACH_PAIRS_URL}pairs.json`);
  const pairs = r.pairs!;

  it('is the file jsDelivr serves at pairs-v3', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('f19d3bde92160b1e98717d35dc40307844514d883fa2067d93d69b3c9b011318');
  });

  it('validates with no errors and no warnings, written for spec 1.12', () => {
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(pairs.spec).toBe('1.12');
    expect(pairs.name).toBe('ForgeCoach pair scenery, pairs-v3');
    expect(pairs.note).toBe(raw.note);
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

  it('has the ten pairs, every one a motif pair: three stages of motifs, desktop and phone at 1x and 2x at the band’s own size, no half pictures', () => {
    const keys = Object.keys(pairs.pairs).sort();
    expect(keys).toEqual(FIVE.flatMap((a, i) => FIVE.slice(i + 1).map((b) => pairKey(a, b))).sort());
    for (const p of Object.values(pairs.pairs)) {
      const dir = `${FORGECOACH_PAIRS_URL}pairs/${p!.left}-${p!.right}/`;
      expect(p!.kind).toBe('motif');
      expect(p!.band).toEqual({ min: 0.2, perDual: 0.03, max: 0.32 });
      expect(p!.stageMap).toEqual(DEFAULT_STAGE_MAP);
      expect(p!.stages).toHaveLength(3);
      p!.stages.forEach((s, i) => {
        expect(s.half).toBeUndefined();
        expect(pairHalfAt(p, i + 1)).toBeNull();
        const m = s.motif!;
        expect([m.src, m.src2x, m.phone!.src, m.phone!.src2x]).toEqual([`${dir}s${i + 1}-motif.webp`, `${dir}s${i + 1}-motif@2x.webp`, `${dir}s${i + 1}-motif-phone.webp`, `${dir}s${i + 1}-motif-phone@2x.webp`]);
        expect([m.width, m.height, m.phone!.width, m.phone!.height]).toEqual([532, 640, 266, 1024]);
        expect(m.bytes).toBeGreaterThan(0);
      });
      expect(p!.bytes).toBeLessThan(MAX_PAIR_HALF_BYTES);
    }
  });

  it('plays two frames on each of its two stage steps, desktop and phone, inside the reader’s cap of four', () => {
    expect(MAX_TRANSITION_FRAMES).toBe(4);
    for (const p of Object.values(pairs.pairs)) {
      const t = p!.transitions!;
      expect([t.holdMs, t.fadeMs]).toEqual([200, 180]);
      expect(t.steps.map((s) => [s.from, s.frames.length])).toEqual([
        [1, 2],
        [2, 2],
      ]);
      for (const s of t.steps) expect(s.frames.every((f) => f.src.startsWith(`${FORGECOACH_PAIRS_URL}pairs/${p!.left}-${p!.right}/`) && f.src.endsWith('-motif.webp') && !!f.phone?.endsWith('-motif-phone.webp'))).toBe(true);
    }
  });

  it('leaves every seam plain: no band in the row, the motif the band’s width over it', () => {
    const layout = halfLayout([slot('island', 0), slot('mountain', 1)], null);
    const bands = pairBands(layout, pairs, { 'island+mountain': 2 });
    expect(bands.map((b) => [b.key, b.mirror, b.width, b.stage])).toEqual([['island+mountain', false, 0.26, 1]]);
    expect(motifBands(bands)).toHaveLength(1);
    expect(halfRow(layout, halfSeams(layout, null), panelBands(bands)).map((x) => x.kind)).toEqual(['slot', 'slot']);
    expect(motifWidth(bands[0]!.width, layout[0]!.share, layout[1]!.share)).toBe(0.26);
    expect(pairMotifAt(bands[0]!.pair, bands[0]!.stage)!.src).toBe(`${FORGECOACH_PAIRS_URL}pairs/island-mountain/s1-motif.webp`);
  });

  it('declares 7,792,812 bytes, inside the pairs budget and jsDelivr’s 50 MB a ref', () => {
    expect(pairsBytes(pairs)).toBe(7792812);
    expect(pairsBytes(pairs)).toBeLessThan(MAX_PAIRS_PACK_BYTES);
  });
});
