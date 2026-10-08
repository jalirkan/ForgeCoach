/*
 * ForgeCoach — cube/j110Metas.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The cube lab's metas from job J110 (Omega, Fair Fight, Peasant, Evan's cube), shipped in
 * public/cubes/: each parses, maps to its own cube, names only that cube's cards, and meets
 * J110's pre-registered bar (100+ drafts; 80+ games on at least 81% of the playable nonland
 * cards). Evan's 13 cards Forge lacks were never in a pack: no lab numbers, not zeros.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { labCardView } from '../draft/labStats.ts';
import { cubeForMeta, cubeInfo } from './cubes.ts';
import { parseMeta } from './meta.ts';
import { metaValue, labValue, cardPrior } from './score.ts';
import { context, cubeFile, loadCube, loadRealMeta, type CubeId } from './testdata/load.ts';

const J110: CubeId[] = ['omega', 'fair-fight', 'peasant', 'evybaby'];

describe.each(J110)('the J110 meta for %s', (id) => {
  const cube = loadCube(id);
  const meta = loadRealMeta(id);
  const missing = new Set(cube.forgeMissing ?? []);
  const names = new Set(cube.cards.map((c) => c.name));

  it('parses, maps to its own cube, and the registry asks for it', () => {
    expect(meta.schema).toBe(1);
    expect(meta.cube.file).toBe(`cubes/${cubeFile(id)}.md`);
    expect(cubeForMeta(meta)?.id).toBe(id);
    expect(cubeInfo(id)?.labData).toBeUndefined();
  });

  it("names only the cube's cards, and every card Forge can play", () => {
    for (const n of Object.keys(meta.cards)) expect(names.has(n), n).toBe(true);
    for (const c of meta.cube.cards ?? []) expect(names.has(c.name), c.name).toBe(true);
    for (const n of names) expect(n in meta.cards || missing.has(n), n).toBe(true);
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
