/*
 * ForgeCoach — ambience/pack-v9-2.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * pack-v9.2 (spec 1.14): pack-v9.1 with the batch-3 pieces (pc-results
 * scenery/SYSTEM.md B5, B7–B9) in its `pieces` block -- five elements, four
 * colour fronts (red's is held for a later batch), the won / lost veils and
 * the empty table -- every file at its own tag, `@pieces-v1`, named by
 * absolute URL so pack-v9.2's tag stays under jsDelivr's 50 MB. A snapshot of
 * its scenery.json, byte for byte what jsDelivr serves at the tag, taken when
 * FORGECOACH_PACK_URL moved to it. pack-v9.1 stays at its tag (pack-v9-1.test.ts).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_PIECES_BYTES, piecesBytes, pieceUrls, validateManifest } from './manifest.ts';
import { FORGECOACH_PACK_URL } from './prefs.ts';

const json = (f: string) => JSON.parse(readFileSync(new URL(`./testdata/${f}`, import.meta.url), 'utf8'));

describe('pack-v9.2', () => {
  const bytes = readFileSync(new URL('./testdata/pack-v9.2.scenery.json', import.meta.url));
  const manifest = JSON.parse(bytes.toString('utf8'));
  const v91 = json('pack-v9.1.scenery.json');
  const r = validateManifest(manifest, `${FORGECOACH_PACK_URL}scenery.json`);
  const pack = r.pack!;

  it('is the default pack URL, and the snapshot is the file jsDelivr serves', () => {
    expect(FORGECOACH_PACK_URL).toBe('https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pack-v9.2/pack/');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('0128aadb1300e7fe7667f9718850f916ccd1ac98a07e199c332805cfa7a52ce2');
  });

  it('validates with no errors and exactly pack-v9.1’s warnings, written for spec 1.14', () => {
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual(validateManifest(v91, `${FORGECOACH_PACK_URL}scenery.json`).warnings);
    expect(pack.spec).toBe('1.14');
  });

  it('is pack-v9.1 plus the pieces block, nothing else', () => {
    const { pieces: _p, spec: _s, name: _n, ...rest } = manifest;
    const { spec: _s1, name: _n1, ...rest91 } = v91;
    expect(rest).toEqual(rest91);
  });

  it('carries five elements, four fronts (no red yet), both veils and the empty table, all at @pieces-v1, under the budget', () => {
    const p = pack.pieces!;
    expect(Object.keys(p.elements).sort()).toEqual(['B', 'G', 'R', 'U', 'W']);
    expect(Object.keys(p.fronts).sort()).toEqual(['B', 'G', 'U', 'W']);
    expect(Object.keys(p.veils).sort()).toEqual(['lost', 'won']);
    expect(p.empty).toBeTruthy();
    const urls = [...pieceUrls(p, { phone: false }), ...pieceUrls(p, { phone: true })];
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u.startsWith('https://cdn.jsdelivr.net/gh/jalirkan/forgecoach-scenery@pieces-v1/'), u).toBe(true);
    expect(piecesBytes(p)).toBeGreaterThan(2_000_000);
    expect(piecesBytes(p)).toBeLessThanOrEqual(MAX_PIECES_BYTES);
  });
});
