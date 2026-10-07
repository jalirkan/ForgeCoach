/*
 * ForgeCoach — ambience/pack-v4.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The default art pack (pack-v4, spec 1.5: half-board pictures and the front
 * layer) validates on this client: a snapshot of its scenery.json, taken when
 * FORGECOACH_PACK_URL moved to it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hasAreaPieces, validateManifest } from './manifest.ts';
import { FORGECOACH_PACK_URL } from './prefs.ts';

describe('pack-v4, the default pack', () => {
  const manifest = JSON.parse(readFileSync(new URL('./testdata/pack-v4.scenery.json', import.meta.url), 'utf8'));
  const r = validateManifest(manifest, `${FORGECOACH_PACK_URL}scenery.json`);
  it('is the default pack URL', () => expect(FORGECOACH_PACK_URL).toContain('@pack-v4/pack/'));
  it('validates with no errors', () => {
    expect(r.errors).toEqual([]);
    expect(r.pack).toBeTruthy();
  });
  it('carries the front layer (full-area pieces)', () => expect(hasAreaPieces(r.pack!)).toBe(true));
});
