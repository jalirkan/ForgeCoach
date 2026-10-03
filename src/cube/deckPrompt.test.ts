// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { buildDecks } from './builder.ts';
import { buildDeckPrompt, DECK_SYSTEM } from './deckPrompt.ts';
import { context, loadCube, loadInfos, loadMeta, samplePool } from './testdata/load.ts';
import { CUBES, cubeInfo, loadCubeDoc, loadShippedMeta } from './cubes.ts';
import { deletePool, listPools, newPool, parsePaste, savePool } from './pools.ts';
import { readFileSync } from 'node:fs';

describe('buildDeckPrompt', () => {
  const ctx = context('synergy', loadMeta());
  const infos = loadInfos('synergy', ctx.cube);
  const pool = samplePool(ctx.cube, 'BR', 45, 3);
  const builds = buildDecks(ctx, pool);

  it('is deterministic and carries the build, the pool’s card text and the lab highlights', () => {
    const make = () => buildDeckPrompt({ ctx, pool, build: builds[0]!, alternatives: builds, infos, format: 'grid' });
    const a = make();
    expect(a).toEqual(make());
    expect(a.system).toBe(DECK_SYSTEM);
    expect(a.user).toMatch(/^# Cube: The Synergy Cube/);
    expect(a.user).toMatch(/Two-player Grid draft, 40-card decks/);
    expect(a.user).toMatch(/## Proposed build: .* — Rakdos/);
    expect(a.user).toMatch(/## Other builds the page offered/);
    expect(a.user).toMatch(/## Cube lab highlights/);
    expect(a.user).toMatch(/Archetype BR-SAC/);
    for (const s of builds[0]!.spells) expect(a.user).toContain(`- ${s} (`);
    // Oracle text for a pool card.
    const someCreature = pool.find((p) => infos.get(p)?.typeLine.includes('Creature'))!;
    expect(a.user).toContain(infos.get(someCreature)!.oracleText.split('\n')[0]!);
    expect(a.user.trim().endsWith('how should it be played?')).toBe(true);
  });

  it('flags missing card text and takes the player’s question', () => {
    const p = buildDeckPrompt({ ctx, pool, build: builds[0]!, infos: new Map(), question: 'Should I play Archon?' });
    expect(p.user).toMatch(/\(card text unavailable\)/);
    expect(p.user.trim().endsWith('Should I play Archon?')).toBe(true);
    expect(p.user).not.toMatch(/Grid draft/);
  });

  it('works without meta', () => {
    const plain = context('synergy');
    const [b] = buildDecks(plain, pool);
    const p = buildDeckPrompt({ ctx: plain, pool, build: b!, infos });
    expect(p.user).not.toMatch(/Cube lab/);
  });
});

describe('pools', () => {
  class Mem {
    m = new Map<string, string>();
    getItem(k: string) {
      return this.m.get(k) ?? null;
    }
    setItem(k: string, v: string) {
      this.m.set(k, v);
    }
  }
  it('saves several pools, newest first, and deletes', () => {
    const s = new Mem();
    const a = savePool({ ...newPool('synergy', 'Friday', 1), cards: ['Opt'], updatedAt: 1 }, s);
    savePool({ ...newPool('pauper', 'Saturday', 2), updatedAt: 2 }, s);
    expect(listPools(s).map((p) => p.name)).toEqual(['Saturday', 'Friday']);
    savePool({ ...a, cards: ['Opt', 'Ponder'], updatedAt: 3 }, s);
    expect(listPools(s)[0]?.cards).toEqual(['Opt', 'Ponder']);
    deletePool(a.id, s);
    expect(listPools(s).map((p) => p.name)).toEqual(['Saturday']);
  });
  it('survives junk in storage', () => {
    const s = new Mem();
    s.setItem('forgecoach.pools.v1', '{nope');
    expect(listPools(s)).toEqual([]);
  });
  it('parses pasted lists in the usual shapes', () => {
    const names = loadCube('modern-era').cards.map((c) => c.name);
    const r = parsePaste('Deck\n1 Opt\n2x lightning bolt\nThoughtseize (THS) 107\nFable of the Mirror-Breaker|NEO\n7 Swamp\nNot A Card\n- Fatal Push', names);
    expect(r.cards).toEqual(['Opt', 'Lightning Bolt', 'Lightning Bolt', 'Thoughtseize', 'Fable of the Mirror-Breaker', 'Fatal Push']);
    expect(r.basics).toBe(7);
    expect(r.unknown).toEqual(['Not A Card']);
  });
});

describe('cubes', () => {
  const fake = (url: string) => {
    const path = new URL(`../../public/${url.replace(/^\//, '')}`, import.meta.url);
    try {
      const body = readFileSync(path, 'utf8');
      return Promise.resolve({ ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) as unknown });
    } catch {
      return Promise.resolve({ ok: false, status: 404, text: async () => '', json: async () => null });
    }
  };
  it('every listed cube loads with 180 cards and its shipped lab meta', async () => {
    for (const c of CUBES) {
      const cube = await loadCubeDoc(c, '/', fake);
      expect(cube.cards).toHaveLength(180);
      const meta = await loadShippedMeta(c, '/', fake);
      expect(meta?.schema).toBe(1);
      expect(Object.keys(meta?.cards ?? {})).toHaveLength(180);
      expect(meta?.pairs[0]?.gain).toBeCloseTo((meta?.pairs[0]?.lift ?? 0) - 1);
    }
  });
  it('a cube without meta loads as null', async () => {
    expect(await loadShippedMeta({ ...cubeInfo('synergy')!, file: 'nope' }, '/', fake)).toBeNull();
  });
});
