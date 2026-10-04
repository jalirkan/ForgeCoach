// ForgeCoach — lab/trends.test.ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { droppedTotal, parseWarehouse } from './warehouse.ts';
import { bandPath, cubeTrends, linePath, MAX_CUBE_LINES, niceDomain, nightAxis, pairTrendCubes, pairTrends, runs, volumeTrends } from './trends.ts';

const read = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as Record<string, unknown>;
const sample = () => read('../../public/warehouse-sample.json');
const exporter = () => read('./testdata/warehouse-exporter-sample.json');

describe('the optional series block', () => {
  it('the bundled sample carries it, and every row passes', () => {
    const w = parseWarehouse(sample());
    expect(w.series).not.toBeNull();
    expect(w.series!.cubes.length).toBe(28);
    expect(w.series!.pairs.length).toBe(280);
    expect(w.dropped.series).toBe(0);
    expect(droppedTotal(w)).toBe(0);
  });

  it('absent (the exporter’s own sample): null, nothing dropped, everything else as before', () => {
    const w = parseWarehouse(exporter());
    expect(w.series).toBeNull();
    expect(w.dropped.series).toBe(0);
    const s = sample();
    delete s.series;
    expect(parseWarehouse(s).series).toBeNull();
    expect(parseWarehouse({ ...s, series: null }).series).toBeNull();
  });

  it('bad rows are dropped and counted, never repaired', () => {
    const w = parseWarehouse({
      schema: 1,
      series: {
        cubes: [
          { cube: 'a', night: '2026-10-01', games: 10, avgTurns: 9, onPlayWinRate: 0.5 },
          { cube: 'a', night: '2026-10-01', games: 10, avgTurns: 9, onPlayWinRate: 0.5 }, // duplicate
          { cube: 'a', night: '2026-10-02', games: 10, avgTurns: null, onPlayWinRate: 0.6, onPlayLo: 0.4 }, // half an interval
          { cube: 'a', night: '2026-10-03', games: 10, avgTurns: 9, onPlayWinRate: 0.6, onPlayLo: 0.61, onPlayHi: 0.7 }, // lo above the rate
          { cube: 'a', night: '2026-10-04', games: '10', avgTurns: 9, onPlayWinRate: 0.5 }, // numeric string
          { cube: 'a', night: '2026-10-05', games: 10, onPlayWinRate: 0.55, onPlayLo: 0.5, onPlayHi: 0.6 },
        ],
        pairs: [
          { cube: 'a', pair: 'WU', night: 1, games: 30, winRate: 0.5, lo: 0.32, hi: 0.68 },
          { cube: 'a', pair: 'WU', night: 2, games: 30, winRate: 0.5, lo: 0.52, hi: 0.68 }, // lo above
          { cube: 'a', pair: 'WU', night: 3, games: 30, winRate: 1.5, lo: 0.3, hi: 0.7 },
        ],
      },
    });
    expect(w.series!.cubes.map((c) => c.night)).toEqual(['2026-10-01', '2026-10-05']);
    expect(w.series!.cubes[1]).toMatchObject({ avgTurns: null, onPlayLo: 0.5, onPlayHi: 0.6 });
    expect(w.series!.pairs.map((p) => p.night)).toEqual(['1']);
    expect(w.dropped.series).toBe(6);
    expect(parseWarehouse({ schema: 1, series: [1] }).dropped.series).toBe(1);
  });
});

describe('the charts’ data', () => {
  it('nightly volume: three single-series charts on the nights axis', () => {
    const w = parseWarehouse(sample());
    const v = volumeTrends(w.nights)!;
    expect(v.games.nights).toEqual(w.nights.map((n) => n.night));
    expect(v.quarantined.series[0]!.points.map((p) => p.y)).toEqual(w.nights.map((n) => n.quarantined));
    expect(volumeTrends(w.nights.slice(0, 1))).toBeNull();
  });

  it('cubes: on-the-play and turns per cube in the file’s order, gaps stay gaps', () => {
    const w = parseWarehouse(sample());
    const c = cubeTrends(w)!;
    expect(c.onPlay.series.map((s) => s.id)).toEqual(w.cubes.map((x) => x.cube));
    expect(c.onPlay.series[0]!.points.every((p) => p.lo! <= p.y && p.y <= p.hi!)).toBe(true);
    const holes = parseWarehouse({
      schema: 1,
      series: {
        cubes: [
          { cube: 'a', night: 1, games: 5, avgTurns: 9, onPlayWinRate: 0.5 },
          { cube: 'a', night: 3, games: 5, avgTurns: 9, onPlayWinRate: 0.6 },
          { cube: 'b', night: 2, games: 5, avgTurns: null, onPlayWinRate: null },
        ],
      },
    });
    const h = cubeTrends(holes)!;
    expect(h.onPlay.nights).toEqual(['1', '2', '3']);
    expect(h.onPlay.series[0]!.points.map((p) => p.i)).toEqual([0, 2]);
    expect(runs(h.onPlay.series[0]!.points)).toHaveLength(2);
    expect(h.turns.series[1]!.points).toEqual([]);
  });

  it('more cubes than lines: the ones with the fewest games are listed, not drawn', () => {
    const rows = Array.from({ length: MAX_CUBE_LINES + 2 }, (_, k) => [1, 2].map((night) => ({ cube: `c${k}`, night, games: 100 + k, avgTurns: 9, onPlayWinRate: 0.5 }))).flat();
    const c = cubeTrends(parseWarehouse({ schema: 1, series: { cubes: rows } }))!;
    expect(c.onPlay.series).toHaveLength(MAX_CUBE_LINES);
    expect(c.omitted).toEqual(['c0', 'c1']);
  });

  it('pairs: one band per pair per cube, most games first; none without two nights', () => {
    const w = parseWarehouse(sample());
    expect(pairTrendCubes(w)).toEqual(w.cubes.map((c) => c.cube));
    const p = pairTrends(w, 'vintage')!;
    expect(p.series.length).toBe(10);
    for (const s of p.series) for (const q of s.points) expect(q.lo! <= q.y && q.y <= q.hi!).toBe(true);
    expect(pairTrends(w, 'nope')).toBeNull();
  });

  it('nights sort as the warehouse sorts them', () => {
    expect(nightAxis(['10', '9', '2026-10-01', 'other', '9'])).toEqual(['9', '10', '2026-10-01', 'other']);
  });
});

describe('geometry', () => {
  it('a nice axis holds the values, the floor and 0.5', () => {
    const d = niceDomain([0.44, 0.58], { include: 0.5, floor: 0, ceil: 1 });
    expect(d.min).toBeLessThanOrEqual(0.44);
    expect(d.max).toBeGreaterThanOrEqual(0.58);
    expect(d.ticks[0]).toBe(d.min);
    expect(d.ticks.at(-1)).toBe(d.max);
    const c = niceDomain([3174, 4020], { floor: 0 });
    expect(c.min).toBe(0);
    expect(c.max).toBeGreaterThanOrEqual(4020);
    expect(niceDomain([5, 5]).max).toBeGreaterThan(5);
  });

  it('paths', () => {
    expect(linePath([{ x: 0, y: 1 }, { x: 2, y: 3 }])).toBe('M0.0,1.0L2.0,3.0');
    expect(bandPath([{ x: 0, lo: 5, hi: 1 }, { x: 2, lo: 6, hi: 2 }])).toBe('M0.0,1.0L2.0,2.0L2.0,6.0L0.0,5.0Z');
    expect(bandPath([])).toBe('');
  });
});
