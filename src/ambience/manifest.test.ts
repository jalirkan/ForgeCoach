/*
 * ForgeCoach — ambience/manifest.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assetUrl, layersAt, packBase, packUrls, validateManifest } from './manifest.ts';

const BASE = 'http://127.0.0.1:8650/scenery.json';

const good = () => ({
  schema: 1,
  name: 'Test pack',
  strip: { heightRatio: 0.3, seamPx: 80 },
  biomes: {
    island: {
      slot: { prefer: 'left', weight: 1.2 },
      bloom: { kind: 'rise', durationMs: 1600 },
      idle: { kind: 'sway', periodMs: 8000, amplitude: 0.4 },
      stages: [
        { layers: [{ id: 'sky', kind: 'image', src: 'island/sky.webp', src2x: 'island/sky@2x.webp', depth: 0, z: 0 }] },
        {
          layers: [
            { id: 'sky', kind: 'image', src: 'island/sky.webp', depth: 0, z: 0 },
            { id: 'waves', kind: 'sprite', src: 'island/waves.webp', frames: 12, cols: 4, rows: 3, fps: 12, blend: 'screen', z: 2 },
            { id: 'surf', kind: 'video', src: 'island/surf.webm', fallback: 'island/surf.mp4', poster: 'island/surf.webp', z: 3 },
          ],
        },
      ],
    },
  },
});

describe('validateManifest', () => {
  it('accepts a good pack and resolves URLs against the base', () => {
    const r = validateManifest(good(), BASE);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    const isl = r.pack!.biomes.island!;
    expect(r.pack!.base).toBe('http://127.0.0.1:8650/');
    expect(isl.stages).toHaveLength(2);
    expect(isl.stages[0]!.layers[0]).toMatchObject({ src: 'http://127.0.0.1:8650/island/sky.webp', src2x: 'http://127.0.0.1:8650/island/sky@2x.webp', blend: 'normal', opacity: 1 });
    expect(isl.stages[1]!.layers[1]).toMatchObject({ kind: 'sprite', frames: 12, cols: 4, rows: 3, fps: 12, blend: 'screen' });
    expect(isl.stages[1]!.layers[2]).toMatchObject({ kind: 'video', fallback: 'http://127.0.0.1:8650/island/surf.mp4' });
    expect(isl.slot).toEqual({ prefer: 'left', weight: 1.2 });
    expect(r.pack!.strip.heightRatio).toBe(0.3);
    expect(layersAt(isl, 9).map((l) => l.id)).toEqual(['sky', 'waves', 'surf']);
    expect(layersAt(isl, 0)).toEqual([]);
    expect(packUrls(r.pack!).map((u) => u.stage)).toEqual([1, 2, 2]);
  });

  it('drops layers with bad URLs, with a reason for each', () => {
    const m = good();
    const layers = m.biomes.island.stages[0]!.layers as Record<string, unknown>[];
    layers.push(
      { id: 'a', kind: 'image', src: 'javascript:void.webp' },
      { id: 'b', kind: 'image', src: 'data:image/png;base64,AAAA' },
      { id: 'c', kind: 'image', src: '//evil.example/x.webp' },
      { id: 'd', kind: 'image', src: 'https://u:p@evil.example/x.webp' },
      { id: 'e', kind: 'image', src: 'x.webp") , url(evil' },
      { id: 'f', kind: 'video', src: 'clip.gif' },
    );
    const r = validateManifest(m, BASE);
    expect(r.pack!.biomes.island!.stages[0]!.layers.map((l) => l.id)).toEqual(['sky']);
    expect(r.warnings.join('\n')).toMatch(/javascript: scheme/);
    expect(r.warnings.join('\n')).toMatch(/data: scheme/);
    expect(r.warnings.join('\n')).toMatch(/protocol-relative/);
    expect(r.warnings.join('\n')).toMatch(/credentials/);
    expect(r.warnings.join('\n')).toMatch(/quotes, brackets/);
    expect(r.warnings.join('\n')).toMatch(/expected \.webm or \.mp4/);
    expect(r.warnings).toHaveLength(6);
  });

  it('clamps out-of-range numbers to defaults and drops impossible sprites', () => {
    const m = good() as unknown as { strip: Record<string, unknown>; biomes: { island: { idle: Record<string, unknown>; stages: { layers: Record<string, unknown>[] }[] } }; stageThresholds?: unknown };
    m.strip.heightRatio = 5;
    m.strip.seamPx = -1;
    m.biomes.island.idle.periodMs = 10;
    m.biomes.island.stages[0]!.layers[0]!.opacity = 2;
    m.biomes.island.stages[0]!.layers[0]!.depth = Number.NaN;
    m.biomes.island.stages[1]!.layers[1]!.frames = 11;
    m.stageThresholds = [3, 2];
    const r = validateManifest(m, BASE);
    expect(r.pack!.strip.heightRatio).toBe(0.46);
    expect(r.pack!.strip.seamPx).toBe(120);
    expect(r.pack!.biomes.island!.idle.periodMs).toBe(9000);
    expect(r.pack!.biomes.island!.stages[0]!.layers[0]!.opacity).toBe(1);
    expect(r.pack!.biomes.island!.stages[0]!.layers[0]!.depth).toBe(0.5);
    expect(r.pack!.biomes.island!.stages[1]!.layers.map((l) => l.id)).toEqual(['sky', 'surf']);
    expect(r.pack!.stageThresholds).toBeNull();
    expect(r.warnings.some((w) => /frames \(11\) must fill the grid/.test(w))).toBe(true);
    expect(r.warnings.some((w) => /heightRatio/.test(w))).toBe(true);
  });

  it('ignores unknown fields and unknown biomes', () => {
    const m = { ...good(), extra: { deep: true }, biomes: { ...good().biomes, volcano: {} } } as Record<string, unknown>;
    (m.biomes as Record<string, Record<string, unknown>>).island!.sparkle = 'yes';
    const r = validateManifest(m, BASE);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual(['biomes.volcano: not a biome; ignored']);
    expect(Object.keys(r.pack!.biomes)).toEqual(['island']);
    expect(JSON.stringify(r.pack)).not.toMatch(/sparkle|deep/);
  });

  it('cleans strings', () => {
    const r = validateManifest({ ...good(), name: 'A\u0000pack‮   ' + 'x'.repeat(200) }, BASE);
    expect(r.pack!.name).not.toMatch(/[\u0000‮]/);
    expect(r.pack!.name.length).toBeLessThanOrEqual(80);
  });

  it('errors on what is not a pack', () => {
    expect(validateManifest(null, BASE).errors[0]).toMatch(/not a JSON object/);
    expect(validateManifest({ schema: 2, biomes: {} }, BASE).errors[0]).toMatch(/schema: expected 1/);
    expect(validateManifest({ schema: 1 }, BASE).errors[0]).toMatch(/biomes: missing/);
    expect(validateManifest({ schema: 1, biomes: { island: { stages: [] } } }, BASE).errors[0]).toMatch(/No biome/);
    expect(validateManifest(good(), 'file:///pack/').errors[0]).toMatch(/http/);
  });

  it('caps layers per stage', () => {
    const m = good();
    m.biomes.island.stages[0]!.layers = Array.from({ length: 12 }, (_, i) => ({ id: `l${i}`, kind: 'image', src: `l${i}.webp`, depth: 0, z: i }) as never);
    const r = validateManifest(m, BASE);
    expect(r.pack!.biomes.island!.stages[0]!.layers).toHaveLength(8);
    expect(r.warnings[0]).toMatch(/more than 8/);
  });
});

describe('URLs', () => {
  it('assetUrl allows http(s) and relative only', () => {
    expect(assetUrl('a/b.webp', 'https://x.test/pack/')).toEqual({ url: 'https://x.test/pack/a/b.webp' });
    expect(assetUrl('../b.webp', 'https://x.test/pack/')).toEqual({ url: 'https://x.test/b.webp' });
    expect(assetUrl('http://127.0.0.1:8650/a.webp', 'https://x.test/')).toEqual({ url: 'http://127.0.0.1:8650/a.webp' });
    for (const bad of ['', 'ftp://x/a.webp', 'file:///a.webp', 'blob:x', 'a b.webp', 'a\\b.webp', 'x'.repeat(600)]) expect('error' in assetUrl(bad, 'https://x.test/')).toBe(true);
  });
  it('packBase', () => {
    expect(packBase('http://127.0.0.1:8650/scenery.json?x=1#y')).toBe('http://127.0.0.1:8650/');
    expect(packBase('https://x.test/packs/a/')).toBe('https://x.test/packs/a/');
    expect(packBase('javascript:alert(1)')).toBeNull();
  });
});

describe('the spec’s worked example', () => {
  it('validates with no errors or warnings', () => {
    const md = readFileSync(new URL('../../docs/scenery-pack-spec.md', import.meta.url), 'utf8');
    const block = /<!-- example-manifest -->\s*```json\n([\s\S]*?)```/.exec(md);
    expect(block).not.toBeNull();
    const r = validateManifest(JSON.parse(block![1]!), BASE);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.pack!.biomes.island!.stages).toHaveLength(4);
  });
});
