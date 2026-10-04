/*
 * ForgeCoach — lab/trends.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The #lab/data trend charts' data, from a parsed warehouse (warehouse.ts):
 * nightly drafts / games / quarantined from `nights` (schema 1), and, from the
 * optional `series` block, per-cube on-the-play win rate and average turns
 * across nights and per-colour-pair win rates with their intervals. Pure: it
 * only lines values up on a shared night axis; a night with no value is a gap
 * (null), never a zero or an interpolation. Geometry helpers for the SVG
 * charts are here too, so they are tested without a DOM.
 */
import { nightLabelOrder, type Warehouse, type WhNight } from './warehouse.ts';

export interface TrendPoint {
  /** Index on the chart's night axis. */
  i: number;
  y: number;
  lo?: number;
  hi?: number;
  /** Games behind the value (tooltips). */
  n?: number;
}

export interface TrendSeries {
  id: string;
  label: string;
  points: TrendPoint[];
}

export interface TrendChart {
  nights: string[];
  series: TrendSeries[];
}

/** The nights' axis, oldest first. */
export function nightAxis(labels: Iterable<string>): string[] {
  return [...new Set(labels)].sort(nightLabelOrder);
}

/** The last `max` nights of an axis (the charts show at most this many). */
export const MAX_TREND_NIGHTS = 60;

function clip(nights: string[], max = MAX_TREND_NIGHTS): string[] {
  return nights.length > max ? nights.slice(nights.length - max) : nights;
}

/** Nightly volume: one single-series chart each for drafts, games and quarantined (different scales: never one axis). */
export function volumeTrends(nights: readonly WhNight[]): { drafts: TrendChart; games: TrendChart; quarantined: TrendChart } | null {
  if (nights.length < 2) return null;
  const axis = clip(nightAxis(nights.map((n) => n.night)));
  const at = new Map(nights.map((n) => [n.night, n]));
  const one = (id: keyof Omit<WhNight, 'night'>, label: string): TrendChart => ({
    nights: axis,
    series: [{ id, label, points: axis.map((night, i) => ({ i, y: at.get(night)![id] })) }],
  });
  return { drafts: one('drafts', 'Drafts'), games: one('games', 'Games'), quarantined: one('quarantined', 'Quarantined') };
}

/** At most this many cubes are drawn as lines on one chart (the categorical palette's first slots); the rest are listed. */
export const MAX_CUBE_LINES = 6;

export interface CubeTrends {
  onPlay: TrendChart;
  turns: TrendChart;
  /** Cubes left off the charts (more than MAX_CUBE_LINES), fewest games first dropped. */
  omitted: string[];
}

/** Per-cube on-the-play win rate and average turns across nights (series.cubes); null without at least two nights. */
export function cubeTrends(w: Pick<Warehouse, 'series' | 'cubes'>, label: (cube: string) => string = (c) => c): CubeTrends | null {
  const rows = w.series?.cubes ?? [];
  const axis = clip(nightAxis(rows.map((r) => r.night)));
  if (axis.length < 2) return null;
  const idx = new Map(axis.map((n, i) => [n, i]));
  const games = new Map<string, number>();
  for (const r of rows) if (idx.has(r.night)) games.set(r.cube, (games.get(r.cube) ?? 0) + r.games);
  // The file's cube order first, then any cube seen only in the series.
  const order = [...w.cubes.map((c) => c.cube).filter((c) => games.has(c)), ...[...games.keys()].filter((c) => !w.cubes.some((x) => x.cube === c))];
  const kept = [...order].sort((a, b) => (games.get(b) ?? 0) - (games.get(a) ?? 0)).slice(0, MAX_CUBE_LINES);
  const cubes = order.filter((c) => kept.includes(c));
  const mk = (pick: 'onPlay' | 'turns'): TrendChart => ({
    nights: axis,
    series: cubes.map((cube) => ({
      id: cube,
      label: label(cube),
      points: rows
        .filter((r) => r.cube === cube && idx.has(r.night))
        .flatMap((r): TrendPoint[] => {
          const i = idx.get(r.night)!;
          if (pick === 'turns') return r.avgTurns === null ? [] : [{ i, y: r.avgTurns, n: r.games }];
          if (r.onPlayWinRate === null) return [];
          return [{ i, y: r.onPlayWinRate, n: r.games, ...(r.onPlayLo !== null && r.onPlayHi !== null ? { lo: r.onPlayLo, hi: r.onPlayHi } : {}) }];
        })
        .sort((a, b) => a.i - b.i),
    })),
  });
  return { onPlay: mk('onPlay'), turns: mk('turns'), omitted: order.filter((c) => !kept.includes(c)) };
}

/** Cubes with per-night pair rows, in the file's cube order. */
export function pairTrendCubes(w: Pick<Warehouse, 'series' | 'cubes'>): string[] {
  const have = new Set((w.series?.pairs ?? []).map((p) => p.cube));
  return [...w.cubes.map((c) => c.cube).filter((c) => have.has(c)), ...[...have].filter((c) => !w.cubes.some((x) => x.cube === c))];
}

/** One cube's colour pairs across nights, each a single series with its interval band; most games first. */
export function pairTrends(w: Pick<Warehouse, 'series'>, cube: string, label: (pair: string) => string = (p) => p): TrendChart | null {
  const rows = (w.series?.pairs ?? []).filter((p) => p.cube === cube);
  const axis = clip(nightAxis(rows.map((r) => r.night)));
  if (axis.length < 2) return null;
  const idx = new Map(axis.map((n, i) => [n, i]));
  const games = new Map<string, number>();
  for (const r of rows) if (idx.has(r.night)) games.set(r.pair, (games.get(r.pair) ?? 0) + r.games);
  const pairs = [...games.keys()].sort((a, b) => (games.get(b) ?? 0) - (games.get(a) ?? 0) || a.localeCompare(b));
  return {
    nights: axis,
    series: pairs.map((pair) => ({
      id: pair,
      label: label(pair),
      points: rows
        .filter((r) => r.pair === pair && idx.has(r.night))
        .map((r) => ({ i: idx.get(r.night)!, y: r.winRate, lo: r.lo, hi: r.hi, n: r.games }))
        .sort((a, b) => a.i - b.i),
    })),
  };
}

// ---------------------------------------------------------------------------
// Geometry

export interface Domain {
  min: number;
  max: number;
  ticks: number[];
}

/** A "nice" axis over values (and bands), from `floor` (e.g. 0 for counts) when given, holding `include` (e.g. 0.5 for rates). */
export function niceDomain(values: number[], opts: { floor?: number; include?: number; ceil?: number; tickCount?: number } = {}): Domain {
  let min = Math.min(...values, ...(opts.include !== undefined ? [opts.include] : []));
  let max = Math.max(...values, ...(opts.include !== undefined ? [opts.include] : []));
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = opts.floor ?? 0;
    max = min + 1;
  }
  if (opts.floor !== undefined) min = Math.min(min, opts.floor);
  if (max - min < 1e-9) max = min + (Math.abs(min) || 1) * 0.1;
  const target = opts.tickCount ?? 4;
  const raw = (max - min) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  let lo = Math.floor(min / step + 1e-9) * step;
  let hi = Math.ceil(max / step - 1e-9) * step;
  if (opts.floor !== undefined) lo = Math.max(lo, opts.floor);
  if (opts.ceil !== undefined) hi = Math.min(hi, opts.ceil);
  const ticks: number[] = [];
  for (let x = lo; x <= hi + step * 1e-6; x += step) ticks.push(Math.round(x / step) * step);
  const tidy = (v: number) => Number(v.toPrecision(12));
  return { min: tidy(lo), max: tidy(hi), ticks: ticks.map(tidy) };
}

/** A series' points split into runs of consecutive nights: a gap breaks the line. */
export function runs(points: readonly TrendPoint[]): TrendPoint[][] {
  const out: TrendPoint[][] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && p.i === last[last.length - 1]!.i + 1) last.push(p);
    else out.push([p]);
  }
  return out;
}

/** SVG path for a line through points (x, y in pixels). */
export function linePath(pts: Array<{ x: number; y: number }>): string {
  return pts.map((p, k) => `${k ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('');
}

/** SVG path for an interval band: along the highs, back along the lows. */
export function bandPath(pts: Array<{ x: number; lo: number; hi: number }>): string {
  if (!pts.length) return '';
  const top = pts.map((p, k) => `${k ? 'L' : 'M'}${p.x.toFixed(1)},${p.hi.toFixed(1)}`).join('');
  const bottom = [...pts].reverse().map((p) => `L${p.x.toFixed(1)},${p.lo.toFixed(1)}`).join('');
  return `${top}${bottom}Z`;
}
