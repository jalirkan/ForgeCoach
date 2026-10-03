import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type GuideModule = typeof import('./guide.ts');

async function fresh(): Promise<GuideModule> {
  vi.resetModules();
  return import('./guide.ts');
}

class MemoryStorage {
  map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

function behaves(label: string, setup: () => void) {
  describe(label, () => {
    beforeEach(setup);
    afterEach(() => {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    });

    it('seeds the built-in Rakdos guide', async () => {
      const g = await fresh();
      const list = g.listGuides();
      expect(list[0]!.name).toBe('Rakdos sacrifice (cube)');
      expect(list[0]!.text).toContain('Lead with fodder');
      expect(list[0]!.text).toContain('Gravecrawler + Goblin Bombardment + a Zombie');
      expect(g.isBuiltinGuide(list[0]!.id)).toBe(true);
    });

    it('edits a built-in, and deleting it restores the default', async () => {
      const g = await fresh();
      const id = g.RAKDOS_GUIDE_ID;
      g.saveGuide({ id, name: 'Rakdos (mine)', text: 'edited' });
      expect(g.getGuide(id)).toEqual({ id, name: 'Rakdos (mine)', text: 'edited' });
      expect(g.listGuides().filter((x) => x.id === id)).toHaveLength(1);
      g.deleteGuide(id);
      expect(g.getGuide(id)).toEqual(g.defaultGuide(id));
      expect(g.getGuide(id)!.text).toBe(g.RAKDOS_GUIDE_TEXT);
    });

    it('adds, updates and deletes user guides; tracks the active one', async () => {
      const g = await fresh();
      const id = g.newGuideId();
      g.saveGuide({ id, name: 'Boros', text: 'attack' });
      g.saveGuide({ id, name: 'Boros', text: 'attack more' });
      expect(g.listGuides().map((x) => x.name)).toContain('Boros');
      expect(g.listGuides().filter((x) => !g.isBuiltinGuide(x.id)).map((x) => x.name)).toEqual(['Boros']);
      expect(g.getGuide(id)!.text).toBe('attack more');
      expect(g.activeGuideId()).toBeNull();
      g.setActiveGuideId(id);
      expect(g.activeGuideId()).toBe(id);
      expect(g.activeGuideText()).toBe('attack more');
      g.deleteGuide(id);
      expect(g.getGuide(id)).toBeNull();
      expect(g.activeGuideId()).toBeNull();
      g.setActiveGuideId(g.RAKDOS_GUIDE_ID);
      g.deleteGuide(g.RAKDOS_GUIDE_ID);
      expect(g.activeGuideId()).toBe(g.RAKDOS_GUIDE_ID);
      g.setActiveGuideId(null);
    });

    it('ships every built-in with text and a unique id; edit then reset restores each', async () => {
      const g = await fresh();
      const builtins = g.listGuides().filter((x) => g.isBuiltinGuide(x.id));
      expect(builtins.length).toBeGreaterThanOrEqual(9);
      expect(new Set(builtins.map((x) => x.id)).size).toBe(builtins.length);
      expect(new Set(builtins.map((x) => x.name)).size).toBe(builtins.length);
      for (const b of builtins) {
        expect(b.id.startsWith('builtin:')).toBe(true);
        expect(b.name.trim()).not.toBe('');
        expect(b.text.trim().length).toBeGreaterThan(200);
        expect(g.defaultGuide(b.id)).toEqual(b);
        g.saveGuide({ id: b.id, name: b.name, text: 'mine' });
        expect(g.getGuide(b.id)!.text).toBe('mine');
        g.deleteGuide(b.id);
        expect(g.getGuide(b.id)).toEqual(b);
      }
    });

    it('seeds the S.H.I.E.L.D. guide', async () => {
      const g = await fresh();
      const sg = g.getGuide(g.SHIELD_GUIDE_ID)!;
      expect(sg.text).toContain('attacks alone');
      expect(sg.text).toContain('Nick Fury');
    });

    it('rejects a guide without an id', async () => {
      const g = await fresh();
      expect(() => g.saveGuide({ id: '', name: 'x', text: 'y' })).toThrow();
    });
  });
}

behaves('without localStorage (in-memory fallback)', () => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

behaves('with localStorage', () => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
});

describe('persistence', () => {
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });
  it('survives a reload through localStorage and ignores corrupt data', async () => {
    const ls = new MemoryStorage();
    (globalThis as { localStorage?: unknown }).localStorage = ls;
    let g = await fresh();
    g.saveGuide({ id: 'user:1', name: 'Kept', text: 't' });
    g.setActiveGuideId('user:1');
    g = await fresh();
    expect(g.getGuide('user:1')?.name).toBe('Kept');
    expect(g.activeGuideId()).toBe('user:1');
    ls.setItem('forgecoach.guides.v1', '{not json');
    expect(g.listGuides().filter((x) => !g.isBuiltinGuide(x.id))).toHaveLength(0);
    expect(g.activeGuideId()).toBeNull();
  });
  it('falls back to memory when localStorage throws', async () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('denied');
      },
      removeItem() {
        throw new Error('denied');
      },
    };
    const g = await fresh();
    g.saveGuide({ id: 'user:2', name: 'Mem', text: 'm' });
    expect(g.getGuide('user:2')?.name).toBe('Mem');
  });
});
