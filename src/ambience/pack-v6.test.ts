/*
 * ForgeCoach — ambience/pack-v6.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * pack-v6.1 (spec 1.6: the six-picture ladder, forest's stages 3 and 5
 * re-painted) validates on this client: a snapshot of its scenery.json, taken
 * when FORGECOACH_PACK_URL moved to it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hasAreaPieces, validateManifest } from './manifest.ts';
import { FORGECOACH_PACK_URL } from './prefs.ts';

describe('pack-v6.1', () => {
  const manifest = JSON.parse(readFileSync(new URL('./testdata/pack-v6.1.scenery.json', import.meta.url), 'utf8'));
  const r = validateManifest(manifest, `${FORGECOACH_PACK_URL}scenery.json`);
  it('is the default pack URL', () => expect(FORGECOACH_PACK_URL).toContain('@pack-v6.1/pack/'));
  it('validates with no errors', () => {
    expect(r.errors).toEqual([]);
    expect(r.pack).toBeTruthy();
  });
  it('has six stages, one per land', () => expect(r.pack!.stageThresholds).toEqual([1, 2, 3, 4, 5, 6]));
  it('carries the front layer (full-area pieces)', () => expect(hasAreaPieces(r.pack!)).toBe(true));
});
