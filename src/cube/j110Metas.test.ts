/*
 * ForgeCoach — cube/j110Metas.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The cube lab's metas from job J110 (Omega, Fair Fight, Peasant, Evan's cube), shipped in
 * public/cubes/: each parses, maps to its own cube, names only that cube's cards, and meets
 * J110's pre-registered bar (100+ drafts; 80+ games on at least 81% of the playable nonland
 * cards). Evan's 13 cards Forge lacks were never in a pack: no lab numbers, not zeros.
 * Peasant's meta was measured on its v1 list; v2 (2026-10-10) restored the designer's 11 rare
 * lands, which have no lab numbers until the lab runs again, and the 11 lands they replaced keep
 * their entries in the shipped file but are no longer the cube's.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { labCardView } from '../draft/labStats.ts';
import { cubeForMeta, cubeInfo } from './cubes.ts';
import { parseMeta } from './meta.ts';
import { metaValue, labValue, cardPrior } from './score.ts';
import { context, cubeFile, loadCube, loadRealMeta, type CubeId } from './testdata/load.ts';

const J110: CubeId[] = ['omega', 'fair-fight', 'peasant', 'evybaby'];

/** Peasant v2's rare lands, new since the lab's run. */
const PEASANT_UNMEASURED = ['Meticulous Archive', 'Undercity Sewers', 'Blood Crypt', 'Stomping Ground', 'Horizon Canopy', 'Godless Shrine', 'Steam Vents', 'Underground Mortuary', 'Sacred Foundry', 'Breeding Pool', 'Prismatic Vista'];
/** Peasant v1's lands those replaced: the lab drafted them, the cube no longer has them. */
const PEASANT_RETIRED = ['Abandoned Campground', 'Murky Sewer', 'Razortrap Gorge', 'Bleeding Woods', 'Etched Cornfield', 'Neglected Manor', 'Peculiar Lighthouse', 'Strangled Cemetery', 'Raucous Carnival', 'Lakeside Shack', 'Ash Barrens'];

describe.each(J110)('the J110 meta for %s', (id) => {
  const cube = loadCube(id);
  const meta = loadRealMeta(id);
  const missing = new Set(cube.forgeMissing ?? []);
  const unmeasured = new Set(id === 'peasant' ? PEASANT_UNMEASURED : []);
  const retired = new Set(id === 'peasant' ? PEASANT_RETIRED : []);
  const names = new Set(cube.cards.map((c) => c.name));

  it('parses, maps to its own cube, and the registry asks for it', () => {
    expect(meta.schema).toBe(1);
    expect(meta.cube.file).toBe(`cubes/${cubeFile(id)}.md`);
    expect(cubeForMeta(meta)?.id).toBe(id);
    expect(cubeInfo(id)?.labData).toBeUndefined();
  });

  it("names only the cube's cards, and every card Forge can play", () => {
    for (const n of Object.keys(meta.cards)) expect(names.has(n) || retired.has(n), n).toBe(true);
    for (const c of meta.cube.cards ?? []) expect(names.has(c.name) || retired.has(c.name), c.name).toBe(true);
    for (const n of names) expect(n in meta.cards || missing.has(n) || unmeasured.has(n), n).toBe(true);
  });

  it('rests on 100+ drafts, with 80+ games on at least 81% of the playable nonland cards', () => {
    expect(meta.sample?.drafts ?? 0).toBeGreaterThanOrEqual(100);
    const playable = cube.cards.filter((c) => !c.land && !missing.has(c.name));
    const covered = playable.filter((c) => (meta.cards[c.name]?.games ?? 0) >= 80);
    expect(covered.length / playable.length).toBeGreaterThanOrEqual(0.81);
  });
});

describe("Evan's cards Forge lacks", () => {
  const cube = loadCube('evybaby');
  const missing = cube.forgeMissing!;
  const raw = JSON.parse(readFileSync(new URL(`../../public/cubes/${cubeFile('evybaby')}.meta.json`, import.meta.url), 'utf8')) as { cards: Record<string, { seen: number; games: number }> };
  const meta = parseMeta(raw);
  const ctx = context('evybaby', meta);

  it('the file lists them all zeros; the parser drops them, so they have no lab numbers', () => {
    expect(missing).toHaveLength(13);
    for (const n of missing) {
      expect(raw.cards[n], n).toMatchObject({ seen: 0, games: 0 });
      expect(meta.cards[n], n).toBeUndefined();
      expect(labCardView(meta, n, ''), n).toBeNull();
    }
  });

  it('their value is the no-meta prior, not a 0% win rate', () => {
    expect(ctx.meta?.meta).toBe(meta);
    for (const n of missing) {
      expect(metaValue(n, ctx), n).toBeNull();
      expect(labValue(n, ctx), n).toBe(cardPrior(n, ctx));
    }
    // A card the lab did play keeps its numbers.
    expect(metaValue('Descendant of Storms', ctx)?.games).toBeGreaterThan(80);
  });
});

describe("Peasant's rare lands, new since the lab's run", () => {
  const cube = loadCube('peasant');
  const meta = loadRealMeta('peasant');
  const ctx = context('peasant', meta);
  const names = new Set(cube.cards.map((c) => c.name));

  it('are in the cube and have no lab numbers, not zeros', () => {
    for (const n of PEASANT_UNMEASURED) {
      expect(names.has(n), n).toBe(true);
      expect(meta.cards[n], n).toBeUndefined();
      expect(labCardView(meta, n, ''), n).toBeNull();
    }
  });

  it('are valued by the no-meta prior as fixing lands, and the lands they replaced are gone from the cube', () => {
    for (const n of PEASANT_UNMEASURED) {
      expect(metaValue(n, ctx), n).toBeNull();
      expect(labValue(n, ctx), n).toBe(cardPrior(n, ctx));
      expect(ctx.facts.get(n)?.produces.length ?? 0, n).toBeGreaterThanOrEqual(2);
    }
    for (const n of PEASANT_RETIRED) expect(names.has(n), n).toBe(false);
    expect(metaValue('Mayhem Devil', ctx)?.games).toBeGreaterThan(0);
  });
});
