/*
 * ForgeCoach — ambience/manifest-effects.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Spec 1.2: the `effects` fields, their validation and budgets, and the
 * effect files' check on the preview page (pack.ts checkEffectFiles).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { effectUrls, MAX_EFFECT_MS, packEffect, validateManifest } from './manifest.ts';
import { checkEffectFiles, preloadEffects, resolveScenery } from './pack.ts';
import { DEFAULT_PREFS } from './prefs.ts';

const BASE = 'http://127.0.0.1:8650/scenery.json';
const sky = { stages: [{ layers: [{ id: 'sky', kind: 'image', src: 'island/sky.webp' }] }] };

const withEffects = () => ({
  schema: 1,
  spec: '1.2',
  effects: {
    maxConcurrent: 2,
    damagePlayer: { kind: 'particles', preset: 'flash', color: '#FF8040' },
    attack: { kind: 'video', src: 'fx/attack.webm', fallback: 'fx/attack.mp4', poster: 'fx/attack.webp', durationMs: 1200, bytes: 900000 },
  },
  biomes: {
    island: {
      ...sky,
      effects: {
        creatureEnter: { kind: 'sprite', src: 'island/fx-enter.webp', src2x: 'island/fx-enter@2x.webp', frames: 16, cols: 4, rows: 4, fps: 24, blend: 'screen', scale: 1.2, aspect: 0.75, y: 0.05, reduced: 'poster', poster: 'island/fx-enter.webp', bytes: 600000 },
        landfall: { kind: 'particles', preset: 'ripple' },
      },
    },
  },
});

describe('spec 1.2 effects: good packs', () => {
  it('reads global and per-biome effects with their defaults', () => {
    const r = validateManifest(withEffects(), BASE);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    const fx = r.pack!.effects!;
    expect(r.pack!.spec).toBe('1.2');
    expect(fx.maxConcurrent).toBe(2);
    expect(fx.global.damagePlayer).toMatchObject({ kind: 'particles', preset: 'flash', color: '#ff8040', durationMs: 480, at: 'strip', blend: 'screen', reduced: 'glow', mirror: false });
    expect(fx.global.attack).toMatchObject({ kind: 'video', src: 'http://127.0.0.1:8650/fx/attack.webm', fallback: 'http://127.0.0.1:8650/fx/attack.mp4', durationMs: 1200, at: 'slot', mirror: true, bytes: 900000 });
    const enter = fx.biomes.island!.creatureEnter!;
    expect(enter).toMatchObject({ kind: 'sprite', frames: 16, cols: 4, rows: 4, fps: 24, durationMs: 667, at: 'card', scale: 1.2, aspect: 0.75, y: 0.05, reduced: 'poster', src2x: 'http://127.0.0.1:8650/island/fx-enter@2x.webp' });
    expect(packEffect(r.pack, 'creatureEnter', 'island')).toBe(enter);
    expect(packEffect(r.pack, 'creatureEnter', 'swamp')).toBeNull();
    expect(packEffect(r.pack, 'attack', 'island')).toBe(fx.global.attack);
    expect(effectUrls(r.pack!).map((u) => [u.biome, u.event, u.url.replace('http://127.0.0.1:8650/', ''), u.kind])).toEqual([
      [null, 'attack', 'fx/attack.webm', 'video'],
      [null, 'attack', 'fx/attack.webp', 'image'],
      ['island', 'creatureEnter', 'island/fx-enter.webp', 'image'],
    ]);
  });

  it('a 1.1 pack (no effects) reads exactly as before', () => {
    const r = validateManifest({ schema: 1, biomes: { island: sky } }, BASE);
    expect(r.warnings).toEqual([]);
    expect(r.pack!.effects).toBeNull();
    expect(r.pack!.spec).toBeNull();
  });

  it('an effects-only pack is valid: the built-in scenery with the pack’s effects', () => {
    const r = validateManifest({ schema: 1, effects: { attack: { kind: 'particles', preset: 'sweep' } }, biomes: { forest: { effects: { creatureEnter: { kind: 'particles', preset: 'motes' } } } } }, BASE);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(Object.keys(r.pack!.biomes)).toEqual([]);
    expect(packEffect(r.pack, 'creatureEnter', 'forest')!.preset).toBe('motes');
  });
});

describe('spec 1.2 effects: bad fields', () => {
  it('drops effects with a bad kind, URL, preset or sprite grid, with the path', () => {
    const m = withEffects() as unknown as { effects: Record<string, unknown>; biomes: { island: { effects: Record<string, unknown> } } };
    m.effects.creatureEnter = { kind: 'gif', src: 'x.gif' };
    m.effects.damageCreature = { kind: 'particles', preset: 'fireworks' };
    m.effects.stageUp = { kind: 'video', src: 'javascript:void.webm' };
    m.biomes.island.effects.attack = { kind: 'sprite', src: 'a.webp', frames: 10, cols: 4, rows: 4, fps: 12 };
    const r = validateManifest(m, BASE);
    expect(r.errors).toEqual([]);
    const w = r.warnings.join('\n');
    expect(w).toMatch(/effects\.creatureEnter\.kind: must be sprite, video or particles; effect dropped/);
    expect(w).toMatch(/effects\.damageCreature\.preset: must be one of shimmer, sweep, flash, crack, motes, ripple; effect dropped/);
    expect(w).toMatch(/effects\.stageUp\.src: the javascript: scheme is not allowed.*effect dropped/);
    expect(w).toMatch(/biomes\.island\.effects\.attack: frames \(10\) must fill the grid/);
    expect(r.pack!.effects!.global.creatureEnter).toBeUndefined();
    expect(r.pack!.effects!.biomes.island!.attack).toBeUndefined();
  });

  it('warns on unknown event names and misplaced maxConcurrent, like unknown biomes', () => {
    const m = withEffects() as unknown as { effects: Record<string, unknown>; biomes: { island: { effects: Record<string, unknown> } } };
    m.effects.creatureEnters = { kind: 'particles', preset: 'motes' };
    m.biomes.island.effects.maxConcurrent = 4;
    m.effects.sparkle = 'yes';
    const r = validateManifest(m, BASE);
    expect(r.warnings).toEqual([
      'effects.creatureEnters: not an effect event (creatureEnter, attack, damagePlayer, damageCreature, landfall, stageUp); ignored',
      'effects.sparkle: not an effect event (creatureEnter, attack, damagePlayer, damageCreature, landfall, stageUp); ignored',
      'biomes.island.effects.maxConcurrent: only at the top level (effects.maxConcurrent); ignored',
    ]);
  });

  it('ignores unknown fields inside an effect, as inside a layer', () => {
    const m = withEffects() as unknown as { effects: { damagePlayer: Record<string, unknown> } };
    m.effects.damagePlayer.notes = 'for my tools';
    const r = validateManifest(m, BASE);
    expect(r.warnings).toEqual([]);
    expect(JSON.stringify(r.pack)).not.toMatch(/for my tools/);
  });

  it('caps the length at 2.5 s, refuses loops, and range-checks the numbers', () => {
    const m = withEffects() as unknown as { effects: Record<string, Record<string, unknown>>; biomes: { island: { effects: Record<string, Record<string, unknown>> } } };
    m.biomes.island.effects.creatureEnter!.fps = 4; // 16 frames at 4 fps = 4 s
    m.biomes.island.effects.creatureEnter!.loop = true;
    m.effects.attack!.durationMs = 9000;
    m.effects.damagePlayer!.scale = 9;
    m.effects.damagePlayer!.blend = 'xor';
    m.effects.damagePlayer!.at = 'sky';
    m.effects.damagePlayer!.color = 'red';
    m.effects.maxConcurrent = 12 as never;
    const r = validateManifest(m, BASE);
    const fx = r.pack!.effects!;
    expect(fx.biomes.island!.creatureEnter!.durationMs).toBe(MAX_EFFECT_MS);
    expect(fx.global.attack!.durationMs).toBe(2000);
    expect(fx.global.damagePlayer).toMatchObject({ scale: 1, blend: 'screen', at: 'strip', color: null });
    expect(fx.maxConcurrent).toBe(3);
    const w = r.warnings.join('\n');
    expect(w).toMatch(/creatureEnter: the sheet runs 4000 ms \(16 frames at 4 fps\); cut at 2500/);
    expect(w).toMatch(/creatureEnter\.loop: effects play once; loop ignored/);
    expect(w).toMatch(/attack\.durationMs: 9000 is out of range 100–2500; using 2000/);
    expect(w).toMatch(/damagePlayer\.scale: 9 is out of range/);
    expect(w).toMatch(/damagePlayer\.blend: "xor" is not one of/);
    expect(w).toMatch(/damagePlayer\.at: "sky" is not one of slot, card, strip; using strip/);
    expect(w).toMatch(/damagePlayer\.color: not #rgb or #rrggbb/);
    expect(w).toMatch(/effects\.maxConcurrent: 12 is out of range 1–6; using 3/);
  });

  it('a poster for reduced motion needs a poster', () => {
    const m = withEffects() as unknown as { effects: Record<string, Record<string, unknown>> };
    m.effects.damagePlayer!.reduced = 'poster';
    const r = validateManifest(m, BASE);
    expect(r.pack!.effects!.global.damagePlayer!.reduced).toBe('glow');
    expect(r.warnings).toEqual(['effects.damagePlayer.reduced: "poster" needs a poster; using glow']);
  });

  it('warns on a spec newer than this engine, and on a malformed one', () => {
    expect(validateManifest({ ...withEffects(), spec: '1.6' }, BASE).warnings).toEqual(['spec: the pack is written for 1.6; this ForgeCoach reads 1.5, so newer fields are ignored']);
    expect(validateManifest({ ...withEffects(), spec: '1.4' }, BASE).warnings).toEqual([]);
    expect(validateManifest({ ...withEffects(), spec: 'two' }, BASE).warnings[0]).toMatch(/spec: "two" is not a 1.x version/);
  });
});

describe('spec 1.2 effects: budgets', () => {
  it('warns (and keeps the effects) when a biome declares more than 4 MB', () => {
    const m = withEffects() as unknown as { biomes: { island: { effects: Record<string, Record<string, unknown>> } } };
    m.biomes.island.effects.creatureEnter!.bytes = 3_000_000;
    m.biomes.island.effects.attack = { kind: 'video', src: 'island/attack.webm', bytes: 2_000_000 };
    const r = validateManifest(m, BASE);
    expect(r.warnings).toEqual(['biomes.island.effects: 4.8 MB of effects declared; the budget is 4 MB (effects kept)']);
    expect(Object.keys(r.pack!.effects!.biomes.island!)).toEqual(['creatureEnter', 'landfall', 'attack']);
  });

  it('counts the global effects as their own group', () => {
    const m = withEffects() as unknown as { effects: Record<string, Record<string, unknown>> };
    m.effects.attack!.bytes = 4_200_000;
    expect(validateManifest(m, BASE).warnings).toEqual(['effects: 4.0 MB of effects declared; the budget is 4 MB (effects kept)']);
  });

  it('checkEffectFiles measures the real files and flags a biome over budget', async () => {
    const pack = validateManifest(withEffects(), BASE).pack!;
    const sizes: Record<string, number> = { 'fx/attack.webm': 1_000_000, 'island/fx-enter.webp': 4_500_000 };
    const fetch = async (url: string) => {
      const path = url.replace('http://127.0.0.1:8650/', '');
      if (path === 'fx/attack.webp') return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(sizes[path] ?? 0) };
    };
    const r = await checkEffectFiles(pack, { fetch });
    expect(r.files.map((f) => [f.url.replace('http://127.0.0.1:8650/', ''), f.ok, f.bytes, f.error])).toEqual([
      ['fx/attack.webm', true, 1_000_000, null],
      ['fx/attack.webp', false, null, 'HTTP 404'],
      ['island/fx-enter.webp', true, 4_500_000, null],
    ]);
    expect(r.budgets).toEqual([
      { biome: null, bytes: 1_000_000, over: false },
      { biome: 'island', bytes: 4_500_000, over: true },
    ]);
  });

  it('preloadEffects reports files that did not load; the board’s pack still resolves', async () => {
    const pack = validateManifest(withEffects(), BASE).pack!;
    const failed = await preloadEffects(pack, async (url) => {
      if (url.endsWith('.webm')) throw new Error('error');
    });
    expect(failed).toEqual(['http://127.0.0.1:8650/fx/attack.webm']);
    const serve = async () => ({ ok: true, status: 200, text: async () => JSON.stringify(withEffects()) });
    const r = (await resolveScenery({ ...DEFAULT_PREFS, mode: 'pack', packUrl: 'http://127.0.0.1:8650/' }, { fetch: serve, load: async () => {} }))!;
    expect(r.source).toBe('pack');
    expect(r.pack!.effects!.maxConcurrent).toBe(2);
  });
});

describe('the spec’s 1.2 worked example', () => {
  it('validates with no errors or warnings', () => {
    const md = readFileSync(new URL('../../docs/scenery-pack-spec.md', import.meta.url), 'utf8');
    const block = /<!-- example-effects -->\s*```json\n([\s\S]*?)```/.exec(md);
    expect(block).not.toBeNull();
    const r = validateManifest(JSON.parse(block![1]!), BASE);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(Object.keys(r.pack!.effects!.biomes.island!).sort()).toEqual(['attack', 'creatureEnter', 'damagePlayer', 'stageUp']);
  });
});
