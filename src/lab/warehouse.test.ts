// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WAREHOUSE_SRC,
  WarehouseError,
  archiveSaving,
  cubeViews,
  droppedTotal,
  fetchWarehouse,
  fmtRange,
  fmtRate,
  nightTotals,
  parseWarehouse,
  ratePct,
  rateDomain,
  rebaseWarehouse,
  verdict,
  warehouseSource,
  warehouseStaleness,
} from './warehouse.ts';
import { LabFetchError } from './status.ts';

type Doc = Record<string, unknown> & { tables: unknown[]; nights: unknown[]; cubes: unknown[]; pairs: unknown[]; cards: unknown[] };
const raw = JSON.parse(readFileSync(new URL('../../public/warehouse-sample.json', import.meta.url), 'utf8')) as Doc;
const clone = (): Doc => JSON.parse(JSON.stringify(raw)) as Doc;

const CUBE_IDS = ['vintage', 'modern-era', 'pauper', 'synergy'];

/** Every non-land card name in a cube's lab meta (the cube document's list). */
function cubeCards(id: string): Set<string> {
  const m = JSON.parse(readFileSync(new URL(`../../public/cubes/${id}-cube-180.meta.json`, import.meta.url), 'utf8')) as { cube: { cards: Array<{ name: string }> } };
  return new Set(m.cube.cards.map((c) => c.name));
}

describe('parseWarehouse: the bundled sample', () => {
  const w = parseWarehouse(raw);

  it('reads every block with nothing dropped', () => {
    expect(w.schema).toBe(1);
    expect(w.generatedAt?.toISOString()).toBe('2026-10-04T06:12:00.000Z');
    expect(w.warehouseVer).toBe('wh-3 (sample)');
    expect(w.tables.length).toBe(6);
    expect(w.nights.length).toBe(7);
    expect(w.cubes.map((c) => c.cube)).toEqual(CUBE_IDS);
    expect(w.pairs.length).toBe(40);
    expect(w.cards.length).toBeGreaterThan(40);
    expect(w.archive).toEqual({ gzipBytes: 2_310_000_000, zstdBytes: 1_480_000_000 });
    expect(w.disk).toEqual({ freeGB: 412.6, usedPct: 58.4 });
    expect(droppedTotal(w)).toBe(0);
  });

  it('says its numbers are made up, and names only real cards of its cube', () => {
    expect(String(raw.note)).toMatch(/made up/);
    for (const c of w.cards) expect(cubeCards(c.cube).has(c.card), `${c.card} in ${c.cube}`).toBe(true);
  });

  it('sorts tables largest first and nights oldest first', () => {
    expect(w.tables[0]!.name).toBe('game_cards');
    expect(w.nights.map((n) => n.night)).toEqual([...w.nights.map((n) => n.night)].sort());
  });

  it('keeps every interval around its rate', () => {
    for (const r of [...w.pairs, ...w.cards]) {
      expect(r.lo).toBeLessThanOrEqual(r.winRate);
      expect(r.winRate).toBeLessThanOrEqual(r.hi);
    }
  });

  it('builds one block per cube with top and bottom cards apart', () => {
    const v = cubeViews(w, 5);
    expect(v.map((c) => c.cube)).toEqual(CUBE_IDS);
    for (const c of v) {
      expect(c.stats).not.toBeNull();
      expect(c.pairs.length).toBe(10);
      expect(c.top.length).toBe(5);
      expect(c.bottom.length).toBeGreaterThan(0);
      for (const b of c.bottom) expect(c.top).not.toContain(b);
      // Top: highest lower bound first. Bottom: lowest upper bound first.
      expect(c.top.map((x) => x.lo)).toEqual([...c.top.map((x) => x.lo)].sort((a, b) => b - a));
      expect(c.bottom.map((x) => x.hi)).toEqual([...c.bottom.map((x) => x.hi)].sort((a, b) => a - b));
    }
  });
});

describe("parseWarehouse: the exporter's own sample (mtg-table tools/lab/warehouse-sample.json)", () => {
  // A verbatim copy of the file mtg-table's `warehouse.py export` writes (synthetic numbers).
  const exp = JSON.parse(readFileSync(new URL('./testdata/warehouse-exporter-sample.json', import.meta.url), 'utf8')) as Doc;
  const w = parseWarehouse(exp);

  it('reads it as is, with nothing dropped', () => {
    expect(droppedTotal(w)).toBe(0);
    expect(w.tables.length).toBe(exp.tables.length);
    expect(w.nights.length).toBe(exp.nights.length);
    expect(w.cubes.length).toBe(exp.cubes.length);
    expect(w.pairs.length).toBe(exp.pairs.length);
    expect(w.cards.length).toBe(exp.cards.length);
    expect(w.archive).toBeNull();
    expect(w.disk).not.toBeNull();
    expect(w.generatedAt).not.toBeNull();
  });

  it('keeps bridge cube ids whole and builds a block for every cube', () => {
    expect(w.cubes.map((c) => c.cube)).toContain('bridge:pauper+modern-era');
    expect(cubeViews(w).length).toBe(exp.cubes.length);
  });
});

describe('parseWarehouse: schema and shape', () => {
  it("accepts the exporter's null avgTurns / onPlayWinRate, but not a bad value", () => {
    const w = parseWarehouse({
      schema: 1,
      cubes: [
        { cube: 'omega', drafts: 0, games: 0, avgTurns: null, onPlayWinRate: null },
        { cube: 'pauper', drafts: 1, games: 2, avgTurns: 'many', onPlayWinRate: null },
      ],
    });
    expect(w.cubes).toEqual([{ cube: 'omega', drafts: 0, games: 0, avgTurns: null, onPlayWinRate: null }]);
    expect(w.dropped.cubes).toBe(1);
  });

  it('sorts numbered nights before a word night such as "other"', () => {
    const n = (night: unknown) => ({ night, drafts: 1, games: 1, recorded: 1, quarantined: 0, engineErrors: 0 });
    expect(parseWarehouse({ schema: 1, nights: [n('other'), n(2), n(1)] }).nights.map((x) => x.night)).toEqual(['1', '2', 'other']);
  });

  it('refuses the wrong schema number, a missing one, and a string one', () => {
    expect(() => parseWarehouse({ ...clone(), schema: 2 })).toThrow(WarehouseError);
    expect(() => parseWarehouse({ ...clone(), schema: 2 })).toThrow(/schema 2/);
    const d = clone();
    delete d.schema;
    expect(() => parseWarehouse(d)).toThrow(WarehouseError);
    expect(() => parseWarehouse({ ...clone(), schema: '1' })).toThrow(WarehouseError);
  });

  it('refuses what is not an object', () => {
    for (const v of [null, [], 'x', 1]) expect(() => parseWarehouse(v)).toThrow(WarehouseError);
  });

  it('reads a minimal file: empty lists, no blocks, no time', () => {
    const w = parseWarehouse({ schema: 1 });
    expect(w).toMatchObject({ generatedAt: null, warehouseVer: null, tables: [], nights: [], cubes: [], pairs: [], cards: [], archive: null, disk: null });
    expect(droppedTotal(w)).toBe(0);
    expect(cubeViews(w)).toEqual([]);
  });

  it('treats a missing or null optional block as absent, not as an error', () => {
    const d = clone();
    delete d.archive;
    d.disk = null;
    const w = parseWarehouse(d);
    expect(w.archive).toBeNull();
    expect(w.disk).toBeNull();
    expect(w.dropped.blocks).toBe(0);
  });

  it('counts a present but broken block', () => {
    const w = parseWarehouse({ ...clone(), archive: { gzipBytes: -1, zstdBytes: 5 }, disk: 'full' });
    expect(w.archive).toBeNull();
    expect(w.disk).toBeNull();
    expect(w.dropped.blocks).toBe(2);
  });

  it('ignores unknown fields', () => {
    const d = clone();
    d.extra = { anything: [1, 2, 3] };
    (d.cards[0] as Record<string, unknown>).secret = 'x';
    const w = parseWarehouse(d);
    expect(droppedTotal(w)).toBe(0);
    expect(Object.keys(w.cards[0]!).sort()).toEqual(['card', 'cube', 'games', 'hi', 'lo', 'winRate']);
  });

  it('reads a numeric night and sorts numeric nights by number', () => {
    const w = parseWarehouse({ schema: 1, nights: [10, 9, 100].map((night) => ({ night, drafts: 1, games: 6, recorded: 6, quarantined: 0, engineErrors: 0 })) });
    expect(w.nights.map((n) => n.night)).toEqual(['9', '10', '100']);
  });
});

describe('parseWarehouse: out-of-range values', () => {
  const card = { cube: 'vintage', card: 'Black Lotus', games: 100, winRate: 0.55, lo: 0.45, hi: 0.65 };

  it('drops rates outside [0, 1] and intervals that do not hold the rate', () => {
    const bad = [
      { ...card, winRate: 1.2 },
      { ...card, lo: -0.1 },
      { ...card, hi: 1.01 },
      { ...card, lo: 0.6 }, // lo above winRate
      { ...card, hi: 0.5 }, // hi below winRate
      { ...card, games: -1 },
      { ...card, games: 2.5 },
      { ...card, games: '100' }, // numeric string
      { ...card, winRate: Number.NaN },
      { ...card, winRate: null },
      { ...card, card: 7 },
      'not a row',
    ];
    const w = parseWarehouse({ schema: 1, cards: [card, ...bad] });
    expect(w.cards.length).toBe(1);
    expect(w.dropped.cards).toBe(bad.length);
  });

  it('drops a duplicate card of the same cube but keeps the same name in another cube', () => {
    const w = parseWarehouse({ schema: 1, cards: [card, { ...card, winRate: 0.6 }, { ...card, cube: 'synergy' }] });
    expect(w.cards.map((c) => `${c.cube}:${c.winRate}`)).toEqual(['vintage:0.55', 'synergy:0.55']);
    expect(w.dropped.cards).toBe(1);
  });

  it('drops negative, fractional or huge counts in tables, nights and cubes', () => {
    const w = parseWarehouse({
      schema: 1,
      tables: [{ name: 'games', rows: 10, bytes: 100 }, { name: 'x', rows: -1, bytes: 1 }, { name: 'y', rows: 1, bytes: 1e13 }],
      nights: [{ night: 1, drafts: 1, games: 1.5, recorded: 1, quarantined: 0, engineErrors: 0 }, { night: -3, drafts: 1, games: 1, recorded: 1, quarantined: 0, engineErrors: 0 }],
      cubes: [{ cube: 'pauper', drafts: 1, games: 6, avgTurns: 9.1, onPlayWinRate: 1.5 }, { cube: 'vintage', drafts: 1, games: 6, avgTurns: -1, onPlayWinRate: 0.5 }],
    });
    expect(w.tables.map((t) => t.name)).toEqual(['games']);
    expect(w.dropped).toMatchObject({ tables: 2, nights: 2, cubes: 2 });
  });

  it('drops disk numbers out of range', () => {
    expect(parseWarehouse({ schema: 1, disk: { freeGB: 10, usedPct: 140 } }).disk).toBeNull();
    expect(parseWarehouse({ schema: 1, disk: { freeGB: -1, usedPct: 40 } }).disk).toBeNull();
  });

  it('counts rows past the cap as dropped and a non-list as one bad block', () => {
    const many = Array.from({ length: 510 }, (_, i) => ({ night: i, drafts: 1, games: 1, recorded: 1, quarantined: 0, engineErrors: 0 }));
    const w = parseWarehouse({ schema: 1, nights: many, pairs: { not: 'a list' } });
    expect(w.nights.length).toBe(500);
    expect(w.dropped.nights).toBe(10);
    expect(w.dropped.pairs).toBe(1);
  });
});

describe('parseWarehouse: hostile strings', () => {
  it('cleans control and bidi characters and caps the length', () => {
    const w = parseWarehouse({
      schema: 1,
      warehouseVer: 'v1\u0000‮<script>alert(1)</script>' + 'x'.repeat(500),
      tables: [{ name: 'ga\nmes\u0007', rows: 1, bytes: 1 }],
      cards: [{ cube: 'vin⁦tage', card: 'A'.repeat(1000), games: 10, winRate: 0.5, lo: 0.2, hi: 0.8 }],
      pairs: [{ cube: 'pauper', pair: '\u0000\u0000', games: 10, winRate: 0.5, lo: 0.2, hi: 0.8 }],
    });
    expect(w.warehouseVer!.length).toBeLessThanOrEqual(60);
    expect(w.warehouseVer).not.toMatch(/[\u0000-\u001f‮]/);
    expect(w.tables[0]!.name).toBe('ga mes');
    expect(w.cards[0]!.cube).toBe('vin tage');
    expect(w.cards[0]!.card.length).toBe(120);
    expect(w.cards[0]!.card.endsWith('…')).toBe(true);
    // A pair that is nothing but control characters is no pair.
    expect(w.pairs).toEqual([]);
    expect(w.dropped.pairs).toBe(1);
  });

  it('is not fooled by prototype keys', () => {
    const w = parseWarehouse(JSON.parse('{"schema":1,"__proto__":{"tables":[{"name":"evil","rows":1,"bytes":1}]}}'));
    expect(w.tables).toEqual([]);
  });

  it('refuses a non-string card name and a bad time', () => {
    const w = parseWarehouse({ schema: 1, generatedAt: 'yesterday', cards: [{ cube: 'x', card: { toString: 'Lotus' }, games: 1, winRate: 0.5, lo: 0, hi: 1 }] });
    expect(w.generatedAt).toBeNull();
    expect(w.cards).toEqual([]);
  });
});

describe('interval honesty', () => {
  const r = (lo: number, winRate: number, hi: number) => ({ games: 100, lo, winRate, hi });

  it('calls a card strong or weak only when the interval excludes 0.5', () => {
    expect(verdict(r(0.51, 0.56, 0.61))).toBe('strong');
    expect(verdict(r(0.39, 0.44, 0.49))).toBe('weak');
    expect(verdict(r(0.5, 0.56, 0.62))).toBe('even');
    expect(verdict(r(0.38, 0.44, 0.5))).toBe('even');
    expect(verdict(r(0.3, 0.7, 0.9))).toBe('even');
  });

  it('the rate axis always holds 0.5 and every interval', () => {
    const d = rateDomain([r(0.52, 0.55, 0.58)]);
    expect(d.min).toBeLessThanOrEqual(0.5);
    expect(d.max).toBeGreaterThanOrEqual(0.58);
    expect(d.max - d.min).toBeGreaterThanOrEqual(0.2 - 1e-9);
    expect(d.ticks).toContain(0.5);
    const wide = rateDomain([r(0.05, 0.3, 0.6), r(0.6, 0.9, 0.99)]);
    expect(wide.min).toBe(0);
    expect(wide.max).toBe(1);
    expect(ratePct(0.5, { min: 0.4, max: 0.6 })).toBeCloseTo(50);
    expect(ratePct(2, { min: 0.4, max: 0.6 })).toBe(100);
  });

  it('an empty axis is still a sane axis', () => {
    const d = rateDomain([]);
    expect(d.min).toBeLessThan(0.5);
    expect(d.max).toBeGreaterThan(0.5);
  });

  it('lists a cube seen only in pairs or cards, without stats', () => {
    const v = cubeViews(parseWarehouse({ schema: 1, pairs: [{ cube: 'omega', pair: 'WU', games: 5, winRate: 0.6, lo: 0.2, hi: 0.9 }] }));
    expect(v).toEqual([expect.objectContaining({ cube: 'omega', stats: null, cardCount: 0 })]);
  });
});

describe('formatting and totals', () => {
  it('formats rates and ranges', () => {
    expect(fmtRate(0.5)).toBe('50.0%');
    expect(fmtRate(0.5767)).toBe('57.7%');
    expect(fmtRange({ games: 1, lo: 0.4812, winRate: 0.5, hi: 0.6019 })).toBe('48.1–60.2%');
  });

  it('works out the archive saving and the nights’ sums', () => {
    expect(archiveSaving({ gzipBytes: 200, zstdBytes: 150 })).toBeCloseTo(0.25);
    expect(archiveSaving({ gzipBytes: 0, zstdBytes: 150 })).toBeNull();
    const w = parseWarehouse(raw);
    const t = nightTotals(w.nights);
    expect(t.games).toBe(w.nights.reduce((s, n) => s + n.games, 0));
  });
});

describe('staleness, source, fetch', () => {
  const at = new Date('2026-10-04T06:00:00Z');
  const h = (n: number) => new Date(at.getTime() + n * 3600_000);

  it('fresh for a nightly file, amber after 36 h, red after 72 h, unknown without a time', () => {
    expect(warehouseStaleness(at, h(20)).level).toBe('fresh');
    expect(warehouseStaleness(at, h(40)).level).toBe('amber');
    expect(warehouseStaleness(at, h(80)).level).toBe('red');
    expect(warehouseStaleness(null, h(1))).toEqual({ level: 'unknown', ageS: null });
    expect(warehouseStaleness(at, h(-1)).ageS).toBe(0);
  });

  it('rebases the sample to look current', () => {
    const now = new Date('2027-01-01T12:00:00Z');
    const w = rebaseWarehouse(parseWarehouse(raw), now);
    expect(warehouseStaleness(w.generatedAt, now).level).toBe('fresh');
  });

  it('reads the source from the hash like the other lab pages', () => {
    expect(warehouseSource('#lab/data', '/')).toEqual({ kind: 'default', url: DEFAULT_WAREHOUSE_SRC });
    expect(DEFAULT_WAREHOUSE_SRC).toBe('https://raw.githubusercontent.com/jalirkan/ForgeCoach/lab-status/warehouse.json');
    expect(warehouseSource('#lab/data?src=sample', '/ForgeCoach/')).toEqual({ kind: 'sample', url: '/ForgeCoach/warehouse-sample.json' });
    expect(warehouseSource('#lab/data?src=https://example.org/w.json', '/')).toEqual({ kind: 'custom', url: 'https://example.org/w.json' });
    expect(warehouseSource('#lab/data?src=javascript:alert(1)', '/').kind).toBe('invalid');
    expect(warehouseSource('#lab/data?src=file:///etc/passwd', '/').kind).toBe('invalid');
    expect(warehouseSource('#lab?src=sample', '/').kind).toBe('default');
  });

  it('fetches and parses, and sorts errors by kind', async () => {
    const ok = async () => ({ ok: true, status: 200, text: async () => JSON.stringify(raw) });
    expect((await fetchWarehouse('https://x/w.json', { fetch: ok })).cubes.length).toBe(4);
    const wrong = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ schema: 7 }) });
    await expect(fetchWarehouse('https://x/w.json', { fetch: wrong })).rejects.toMatchObject({ kind: 'parse' });
    const missing = async () => ({ ok: false, status: 404, text: async () => '' });
    await expect(fetchWarehouse('https://x/w.json', { fetch: missing })).rejects.toBeInstanceOf(LabFetchError);
    await expect(fetchWarehouse('https://x/w.json', { fetch: missing })).rejects.toMatchObject({ kind: 'notFound' });
  });
});
