/*
 * ForgeCoach — ambience/pack.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { fetchManifest, manifestUrlFor, resolveScenery, type FetchLike } from './pack.ts';
import { DEFAULT_PREFS, effectivePrefs, loadSceneryPrefs, reducedMotion, saveSceneryPrefs, sceneryParam } from './prefs.ts';

const manifest = {
  schema: 1,
  biomes: {
    island: { stages: [{ layers: [{ id: 'sky', kind: 'image', src: 'island/sky.webp' }] }] },
    swamp: { stages: [{ layers: [{ id: 'mire', kind: 'image', src: 'swamp/mire.webp' }] }] },
  },
};
const serve = (body: unknown, status = 200): FetchLike => async () => ({ ok: status < 400, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const okLoad = async () => {};
const pack = (url: string) => ({ ...DEFAULT_PREFS, mode: 'pack' as const, packUrl: url });

describe('manifestUrlFor', () => {
  it('adds scenery.json to a folder URL', () => {
    expect(manifestUrlFor('http://127.0.0.1:8650')).toBe('http://127.0.0.1:8650/scenery.json');
    expect(manifestUrlFor('http://127.0.0.1:8650/packs/a/')).toBe('http://127.0.0.1:8650/packs/a/scenery.json');
    expect(manifestUrlFor('https://x.test/my.json')).toBe('https://x.test/my.json');
    expect(manifestUrlFor('javascript:alert(1)')).toBeNull();
    expect(manifestUrlFor('')).toBeNull();
  });
});

describe('resolveScenery', () => {
  it('is off by default and procedural when chosen', async () => {
    expect(await resolveScenery(DEFAULT_PREFS, { fetch: serve(manifest), load: okLoad })).toBeNull();
    expect((await resolveScenery({ ...DEFAULT_PREFS, mode: 'procedural' }, { fetch: serve(manifest), load: okLoad }))!.source).toBe('procedural');
  });

  it('loads a good pack', async () => {
    const r = (await resolveScenery(pack('http://127.0.0.1:8650/'), { fetch: serve(manifest), load: okLoad }))!;
    expect(r.source).toBe('pack');
    expect(r.note).toBeNull();
    expect(Object.keys(r.pack!.biomes)).toEqual(['island', 'swamp']);
  });

  it('falls back with a note on HTTP errors, bad JSON, invalid packs and network failure', async () => {
    const cases: FetchLike[] = [
      serve('', 404),
      serve('{nope'),
      serve({ schema: 7 }),
      async () => {
        throw new TypeError('Failed to fetch');
      },
    ];
    const notes = [];
    for (const f of cases) {
      const r = (await resolveScenery(pack('http://127.0.0.1:8650/'), { fetch: f, load: okLoad }))!;
      expect(r.source).toBe('procedural');
      expect(r.note).toMatch(/Showing the built-in scenery/);
      notes.push(r.note);
    }
    expect(notes[0]).toMatch(/HTTP 404/);
    expect(notes[1]).toMatch(/not valid JSON/);
    expect(notes[2]).toMatch(/schema/);
    expect(notes[3]).toMatch(/CORS/);
  });

  it('drops only the biomes whose assets fail to load', async () => {
    const load = async (url: string) => {
      if (url.includes('swamp')) throw new Error('error');
    };
    const r = (await resolveScenery(pack('http://127.0.0.1:8650/'), { fetch: serve(manifest), load }))!;
    expect(r.source).toBe('pack');
    expect(Object.keys(r.pack!.biomes)).toEqual(['island']);
    expect(r.failed).toEqual(['swamp']);
    expect(r.note).toMatch(/swamp/);
    const all = (await resolveScenery(pack('http://127.0.0.1:8650/'), { fetch: serve(manifest), load: async () => Promise.reject(new Error('x')) }))!;
    expect(all.source).toBe('procedural');
  });

  it('refuses huge manifests', async () => {
    const r = await fetchManifest('http://x.test/', { fetch: serve('x'.repeat(300 * 1024)) });
    expect(r.errors[0]).toMatch(/over 256 KB/);
  });
});

describe('prefs', () => {
  it('round-trips through storage and tolerates junk', () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(loadSceneryPrefs(s)).toEqual(DEFAULT_PREFS);
    saveSceneryPrefs({ mode: 'pack', packUrl: 'http://127.0.0.1:8650/', motion: 'reduce' }, s);
    expect(loadSceneryPrefs(s)).toEqual({ mode: 'pack', packUrl: 'http://127.0.0.1:8650/', motion: 'reduce' });
    m.set('forgecoach.scenery', '{"mode":"loud","motion":7}');
    expect(loadSceneryPrefs(s)).toEqual(DEFAULT_PREFS);
  });

  it('?scenery= overrides, in the query or the hash', () => {
    expect(sceneryParam('?scenery=http%3A%2F%2F127.0.0.1%3A8650%2F', '')).toBe('http://127.0.0.1:8650/');
    expect(sceneryParam('', '#ambience?scenery=procedural')).toBe('procedural');
    expect(effectivePrefs(DEFAULT_PREFS, '?scenery=procedural', '').mode).toBe('procedural');
    expect(effectivePrefs({ ...DEFAULT_PREFS, mode: 'procedural' }, '?scenery=off', '').mode).toBe('off');
    expect(effectivePrefs(DEFAULT_PREFS, '?scenery=http://h/p/', '')).toMatchObject({ mode: 'pack', packUrl: 'http://h/p/' });
    expect(effectivePrefs(DEFAULT_PREFS, '', '')).toBe(DEFAULT_PREFS);
  });

  it('reduced motion follows the system unless overridden', () => {
    expect(reducedMotion('system', true)).toBe(true);
    expect(reducedMotion('system', false)).toBe(false);
    expect(reducedMotion('full', true)).toBe(false);
    expect(reducedMotion('reduce', false)).toBe(true);
  });
});
