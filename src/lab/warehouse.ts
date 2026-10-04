/*
 * ForgeCoach — lab/warehouse.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The lab warehouse at a glance (#lab/data): the PC runner's `warehouse.json`
 * (schema 1), published numbers-only next to status.json and ladder.json on
 * this repo's `lab-status` branch. Nightly volume, table sizes, the archive and
 * the disk, and per cube the colour pairs' and cards' win rates with their
 * intervals. Unknown JSON in, a typed, validated view model out. DOM-free;
 * `fetch` is injected.
 *
 * Strict: the file must say `schema: 1`. Every string is untrusted, cleaned
 * with `cleanText`, capped, and only ever rendered as React text. Every number
 * is range-checked (JSON numbers only, no numeric strings); rates are in
 * [0, 1] with lo ≤ winRate ≤ hi. A row that fails is dropped and counted in
 * `dropped`, never repaired. Unknown fields are ignored.
 *
 * `series` is an optional schema-1 addition (no version bump; null when
 * absent) for the trend charts: per-night rows per cube and per colour pair.
 *
 *   "series": {
 *     "cubes": [{"cube","night","games","avgTurns": n|null,"onPlayWinRate": r|null,
 *                "onPlayLo"?: r,"onPlayHi"?: r}],
 *     "pairs": [{"cube","pair","night","games","winRate","lo","hi"}]
 *   }
 *
 * Same rules as the rest: `night` as in `nights`, rates in [0, 1] with
 * lo ≤ rate ≤ hi (onPlayLo/onPlayHi both or neither), one row per
 * (cube, night) and (cube, pair, night); a bad row is dropped and counted.
 */
import { cleanText, fetchLabJson, hashSource, parseTime, type FetchLike, type LabSource, LabFetchError } from './status.ts';

export const DEFAULT_WAREHOUSE_SRC = 'https://raw.githubusercontent.com/jalirkan/ForgeCoach/lab-status/warehouse.json';
export const WAREHOUSE_SCHEMA = 1;
/** The warehouse is rebuilt nightly: amber after a day and a half, red after three days. */
export const WAREHOUSE_AMBER_AFTER_S = 36 * 3600;
export const WAREHOUSE_RED_AFTER_S = 72 * 3600;
export const WAREHOUSE_REFRESH_MS = 5 * 60_000;
export const WAREHOUSE_MAX_BYTES = 2 * 1024 * 1024;

const MAX_TABLES = 100;
// At least the exporter's own caps (mtg-table tools/runner/warehouse.ts, D363).
const MAX_NIGHTS = 500;
const MAX_CUBES = 60;
const MAX_PAIRS = 60 * 32;
const MAX_CARDS = 6000;
const MAX_SERIES_CUBES = 60 * 120;
const MAX_SERIES_PAIRS = 12000;
const BIG = 1e12;
/** Rounding slack for lo ≤ winRate ≤ hi (the runner writes four decimals). */
const EPS = 1e-6;

const LEN = { name: 60, ver: 60, night: 32, cube: 60, pair: 24, card: 120 } as const;

// ---------------------------------------------------------------------------
// View model

export interface WhTable {
  name: string;
  rows: number;
  bytes: number;
}

export interface WhNight {
  /** A night number or a date-like label, as text. */
  night: string;
  drafts: number;
  games: number;
  recorded: number;
  quarantined: number;
  engineErrors: number;
}

export interface WhArchive {
  gzipBytes: number;
  zstdBytes: number;
}

export interface WhDisk {
  freeGB: number;
  /** Percent, 0..100. */
  usedPct: number;
}

export interface WhCube {
  cube: string;
  drafts: number;
  games: number;
  /** Null when the exporter has no games to average. */
  avgTurns: number | null;
  /** The player on the play's win rate, 0..1; null when the exporter has none. */
  onPlayWinRate: number | null;
}

/** A win rate with its interval: lo ≤ winRate ≤ hi, all in [0, 1]. */
export interface WhRate {
  games: number;
  winRate: number;
  lo: number;
  hi: number;
}

export interface WhPair extends WhRate {
  cube: string;
  pair: string;
}

export interface WhCard extends WhRate {
  cube: string;
  card: string;
}

/** One cube on one night (series.cubes). */
export interface WhCubeNight {
  cube: string;
  night: string;
  games: number;
  avgTurns: number | null;
  onPlayWinRate: number | null;
  /** The on-the-play rate's interval, when the exporter writes one. */
  onPlayLo: number | null;
  onPlayHi: number | null;
}

/** One colour pair of one cube on one night (series.pairs). */
export interface WhPairNight extends WhRate {
  cube: string;
  pair: string;
  night: string;
}

export interface WhSeries {
  cubes: WhCubeNight[];
  pairs: WhPairNight[];
}

export interface WhDropped {
  tables: number;
  nights: number;
  cubes: number;
  pairs: number;
  cards: number;
  /** archive or disk present but unreadable. */
  blocks: number;
  /** series rows (and an unreadable series block). */
  series: number;
}

export interface Warehouse {
  schema: 1;
  generatedAt: Date | null;
  warehouseVer: string | null;
  /** Largest first. */
  tables: WhTable[];
  /** Oldest first. */
  nights: WhNight[];
  archive: WhArchive | null;
  disk: WhDisk | null;
  cubes: WhCube[];
  pairs: WhPair[];
  cards: WhCard[];
  /** Per-night trends (optional; null when the file has none). */
  series: WhSeries | null;
  dropped: WhDropped;
}

// ---------------------------------------------------------------------------
// Parsing

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const own = (o: Obj, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

/** A finite JSON number in [min, max]; numeric strings are refused. */
function real(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;
}

/** A whole JSON number in [min, max]. */
function whole(v: unknown, min = 0, max = BIG): number | null {
  const n = real(v, min, max);
  return n !== null && Number.isInteger(n) ? n : null;
}

/** Untrusted text that must be a JSON string: cleaned and capped. */
function text(v: unknown, max: number): string | null {
  return typeof v === 'string' ? cleanText(v, max) : null;
}

/** Thrown when the body is not a schema-1 warehouse file. */
export class WarehouseError extends Error {}

/** Parse each row; count the ones that fail. At most `max` rows are read; the rest count as dropped. */
function rows<T>(v: unknown, max: number, parse: (o: Obj) => T | null): { out: T[]; bad: number } {
  if (!Array.isArray(v)) return { out: [], bad: v === undefined || v === null ? 0 : 1 };
  const out: T[] = [];
  let bad = Math.max(0, v.length - max);
  for (const raw of v.slice(0, max)) {
    const r = isObj(raw) ? parse(raw) : null;
    if (r === null) bad++;
    else out.push(r);
  }
  return { out, bad };
}

function parseTable(o: Obj): WhTable | null {
  const name = text(own(o, 'name'), LEN.name);
  const rows = whole(own(o, 'rows'));
  const bytes = whole(own(o, 'bytes'));
  return name && rows !== null && bytes !== null ? { name, rows, bytes } : null;
}

/** A night label: a whole number (as text) or a short string. */
function nightOf(n: unknown): string | null {
  return typeof n === 'number' ? (whole(n, 0, 1e9) === null ? null : String(n)) : text(n, LEN.night);
}

function parseNight(o: Obj): WhNight | null {
  const night = nightOf(own(o, 'night'));
  const drafts = whole(own(o, 'drafts'));
  const games = whole(own(o, 'games'));
  const recorded = whole(own(o, 'recorded'));
  const quarantined = whole(own(o, 'quarantined'));
  const engineErrors = whole(own(o, 'engineErrors'));
  if (night === null || drafts === null || games === null || recorded === null || quarantined === null || engineErrors === null) return null;
  return { night, drafts, games, recorded, quarantined, engineErrors };
}

function parseCube(o: Obj): WhCube | null {
  const cube = text(own(o, 'cube'), LEN.cube);
  const drafts = whole(own(o, 'drafts'));
  const games = whole(own(o, 'games'));
  // null is the exporter's "none"; anything else must be in range.
  const at = own(o, 'avgTurns');
  const op = own(o, 'onPlayWinRate');
  const avgTurns = at === null ? null : real(at, 0, 1000);
  const onPlayWinRate = op === null ? null : real(op, 0, 1);
  if (!cube || drafts === null || games === null || (at !== null && avgTurns === null) || (op !== null && onPlayWinRate === null)) return null;
  return { cube, drafts, games, avgTurns, onPlayWinRate };
}

function parseRate(o: Obj): WhRate | null {
  const games = whole(own(o, 'games'));
  const winRate = real(own(o, 'winRate'), 0, 1);
  const lo = real(own(o, 'lo'), 0, 1);
  const hi = real(own(o, 'hi'), 0, 1);
  if (games === null || winRate === null || lo === null || hi === null) return null;
  if (lo > winRate + EPS || winRate > hi + EPS) return null;
  return { games, winRate, lo, hi };
}

function parsePair(o: Obj): WhPair | null {
  const cube = text(own(o, 'cube'), LEN.cube);
  const pair = text(own(o, 'pair'), LEN.pair);
  const r = parseRate(o);
  return cube && pair && r ? { cube, pair, ...r } : null;
}

function parseCard(o: Obj): WhCard | null {
  const cube = text(own(o, 'cube'), LEN.cube);
  const card = text(own(o, 'card'), LEN.card);
  const r = parseRate(o);
  return cube && card && r ? { cube, card, ...r } : null;
}

function parseCubeNight(o: Obj): WhCubeNight | null {
  const cube = text(own(o, 'cube'), LEN.cube);
  const night = nightOf(own(o, 'night'));
  const games = whole(own(o, 'games'));
  const at = own(o, 'avgTurns');
  const op = own(o, 'onPlayWinRate');
  const avgTurns = at === null || at === undefined ? null : real(at, 0, 1000);
  const onPlayWinRate = op === null || op === undefined ? null : real(op, 0, 1);
  if (!cube || night === null || games === null) return null;
  if (at !== null && at !== undefined && avgTurns === null) return null;
  if (op !== null && op !== undefined && onPlayWinRate === null) return null;
  const rawLo = own(o, 'onPlayLo');
  const rawHi = own(o, 'onPlayHi');
  let onPlayLo: number | null = null;
  let onPlayHi: number | null = null;
  if (rawLo !== undefined || rawHi !== undefined) {
    onPlayLo = real(rawLo, 0, 1);
    onPlayHi = real(rawHi, 0, 1);
    if (onPlayLo === null || onPlayHi === null || onPlayWinRate === null) return null;
    if (onPlayLo > onPlayWinRate + EPS || onPlayWinRate > onPlayHi + EPS) return null;
  }
  return { cube, night, games, avgTurns, onPlayWinRate, onPlayLo, onPlayHi };
}

function parsePairNight(o: Obj): WhPairNight | null {
  const cube = text(own(o, 'cube'), LEN.cube);
  const pair = text(own(o, 'pair'), LEN.pair);
  const night = nightOf(own(o, 'night'));
  const r = parseRate(o);
  return cube && pair && night !== null && r ? { cube, pair, night, ...r } : null;
}

/** The optional series block: absent or null → null; present but not an object → null and one counted. */
function parseSeries(v: unknown): { value: WhSeries | null; bad: number } {
  if (v === undefined || v === null) return { value: null, bad: 0 };
  if (!isObj(v)) return { value: null, bad: 1 };
  const cubes = dedupe(rows(own(v, 'cubes'), MAX_SERIES_CUBES, parseCubeNight), (c) => `${c.cube}\u0000${c.night}`);
  const pairs = dedupe(rows(own(v, 'pairs'), MAX_SERIES_PAIRS, parsePairNight), (p) => `${p.cube}\u0000${p.pair}\u0000${p.night}`);
  return { value: { cubes: cubes.out, pairs: pairs.out }, bad: cubes.bad + pairs.bad };
}

/** An optional block: absent or null → null; present but bad → null and counted. */
function block<T>(v: unknown, parse: (o: Obj) => T | null): { value: T | null; bad: number } {
  if (v === undefined || v === null) return { value: null, bad: 0 };
  const value = isObj(v) ? parse(v) : null;
  return { value, bad: value === null ? 1 : 0 };
}

function parseArchive(o: Obj): WhArchive | null {
  const gzipBytes = whole(own(o, 'gzipBytes'));
  const zstdBytes = whole(own(o, 'zstdBytes'));
  return gzipBytes !== null && zstdBytes !== null ? { gzipBytes, zstdBytes } : null;
}

function parseDisk(o: Obj): WhDisk | null {
  const freeGB = real(own(o, 'freeGB'), 0, 1e7);
  const usedPct = real(own(o, 'usedPct'), 0, 100);
  return freeGB !== null && usedPct !== null ? { freeGB, usedPct } : null;
}

/** Keep the first row per key; later duplicates count as dropped. */
function dedupe<T>(r: { out: T[]; bad: number }, key: (x: T) => string): { out: T[]; bad: number } {
  const seen = new Set<string>();
  const out = r.out.filter((x) => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { out, bad: r.bad + r.out.length - out.length };
}

/** Numbered nights by number, then dates and words (such as the exporter's "other") as text. */
export function nightLabelOrder(a: string, b: string): number {
  const na = /^\d+$/.test(a) ? Number(a) : NaN;
  const nb = /^\d+$/.test(b) ? Number(b) : NaN;
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  if (Number.isFinite(na) !== Number.isFinite(nb)) return Number.isFinite(na) ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function nightOrder(a: WhNight, b: WhNight): number {
  return nightLabelOrder(a.night, b.night);
}

/** Unknown JSON → Warehouse. Throws WarehouseError when it is not an object or not schema 1. */
export function parseWarehouse(json: unknown): Warehouse {
  if (!isObj(json)) throw new WarehouseError('The warehouse file is not a JSON object.');
  const schema = own(json, 'schema');
  if (schema !== WAREHOUSE_SCHEMA) {
    const shown = typeof schema === 'number' && Number.isFinite(schema) ? ` (it says schema ${schema})` : '';
    throw new WarehouseError(`This is not a schema-1 warehouse file${shown}.`);
  }
  const tables = dedupe(rows(own(json, 'tables'), MAX_TABLES, parseTable), (t) => t.name);
  const nights = dedupe(rows(own(json, 'nights'), MAX_NIGHTS, parseNight), (n) => n.night);
  const cubes = dedupe(rows(own(json, 'cubes'), MAX_CUBES, parseCube), (c) => c.cube);
  const pairs = dedupe(rows(own(json, 'pairs'), MAX_PAIRS, parsePair), (p) => `${p.cube}\u0000${p.pair}`);
  const cards = dedupe(rows(own(json, 'cards'), MAX_CARDS, parseCard), (c) => `${c.cube}\u0000${c.card}`);
  const archive = block(own(json, 'archive'), parseArchive);
  const disk = block(own(json, 'disk'), parseDisk);
  const series = parseSeries(own(json, 'series'));
  return {
    schema: WAREHOUSE_SCHEMA,
    generatedAt: parseTime(own(json, 'generatedAt')),
    warehouseVer: text(own(json, 'warehouseVer'), LEN.ver),
    tables: tables.out.sort((a, b) => b.bytes - a.bytes || a.rows - b.rows),
    nights: nights.out.sort(nightOrder),
    archive: archive.value,
    disk: disk.value,
    cubes: cubes.out,
    pairs: pairs.out,
    cards: cards.out,
    series: series.value,
    dropped: { tables: tables.bad, nights: nights.bad, cubes: cubes.bad, pairs: pairs.bad, cards: cards.bad, blocks: archive.bad + disk.bad, series: series.bad },
  };
}

/** Rows dropped in all. */
export function droppedTotal(w: Warehouse): number {
  const d = w.dropped;
  return d.tables + d.nights + d.cubes + d.pairs + d.cards + d.blocks + d.series;
}

// ---------------------------------------------------------------------------
// Interval honesty

export type Verdict = 'strong' | 'weak' | 'even';

/**
 * What the interval supports against a coin flip: `strong` only when the whole
 * interval is above 0.5, `weak` only when it is wholly below; an interval that
 * includes 0.5 says nothing either way (`even`).
 */
export function verdict(r: WhRate): Verdict {
  if (r.lo > 0.5) return 'strong';
  if (r.hi < 0.5) return 'weak';
  return 'even';
}

export interface CubeView {
  cube: string;
  /** Null when the file has pairs or cards for the cube but no summary row. */
  stats: WhCube | null;
  /** Best point estimate first. */
  pairs: WhPair[];
  /** Highest lower bound first: the cards most surely above. */
  top: WhCard[];
  /** Lowest upper bound first: the cards most surely below; none of `top`. */
  bottom: WhCard[];
  cardCount: number;
}

/** One block per cube: the file's cube order, then any cube seen only in pairs or cards. */
export function cubeViews(w: Warehouse, n = 5): CubeView[] {
  const ids: string[] = w.cubes.map((c) => c.cube);
  for (const r of [...w.pairs, ...w.cards]) if (!ids.includes(r.cube)) ids.push(r.cube);
  return ids.map((cube) => {
    const cards = w.cards.filter((c) => c.cube === cube);
    const top = [...cards].sort((a, b) => b.lo - a.lo || b.winRate - a.winRate).slice(0, n);
    const bottom = [...cards]
      .filter((c) => !top.includes(c))
      .sort((a, b) => a.hi - b.hi || a.winRate - b.winRate)
      .slice(0, n);
    return {
      cube,
      stats: w.cubes.find((c) => c.cube === cube) ?? null,
      pairs: w.pairs.filter((p) => p.cube === cube).sort((a, b) => b.winRate - a.winRate || b.games - a.games),
      top,
      bottom,
      cardCount: cards.length,
    };
  });
}

/** A rate axis around the rows' intervals, always holding 0.5, on 0.05 steps, at least 0.2 wide. */
export function rateDomain(rs: WhRate[]): { min: number; max: number; ticks: number[] } {
  let min = Math.min(0.5, ...rs.map((r) => r.lo));
  let max = Math.max(0.5, ...rs.map((r) => r.hi));
  min = Math.max(0, Math.floor((min - 0.01) * 20) / 20);
  max = Math.min(1, Math.ceil((max + 0.01) * 20) / 20);
  if (max - min < 0.2) {
    const mid = (min + max) / 2;
    min = Math.max(0, Math.round((mid - 0.1) * 20) / 20);
    max = Math.min(1, min + 0.2);
    if (max - min < 0.2) min = Math.max(0, max - 0.2);
  }
  const step = max - min <= 0.3 ? 0.05 : 0.1;
  const ticks: number[] = [];
  for (let x = Math.ceil(min / step - 1e-9) * step; x <= max + 1e-9; x += step) ticks.push(Math.round(x * 100) / 100);
  return { min, max, ticks };
}

/** x in [min, max] → 0..100 (%), clamped. */
export function ratePct(x: number, d: { min: number; max: number }): number {
  return Math.min(100, Math.max(0, ((x - d.min) / (d.max - d.min)) * 100));
}

// ---------------------------------------------------------------------------
// Formatting

/** A 0..1 rate as "54.2%". */
export const fmtRate = (x: number): string => `${(Math.round(x * 1000) / 10).toFixed(1)}%`;

/** "48.1–60.2%". */
export const fmtRange = (r: WhRate): string => `${(Math.round(r.lo * 1000) / 10).toFixed(1)}–${fmtRate(r.hi)}`;

/** How much smaller zstd is than gzip, 0..1 (negative when it is larger); null without a gzip size. */
export function archiveSaving(a: WhArchive): number | null {
  return a.gzipBytes > 0 ? 1 - a.zstdBytes / a.gzipBytes : null;
}

/** Quarantined plus engine errors, as a share of games. */
export function lossShare(n: WhNight): number | null {
  return n.games > 0 ? (n.quarantined + n.engineErrors) / n.games : null;
}

/** The nights' sums. */
export function nightTotals(ns: WhNight[]): Omit<WhNight, 'night'> {
  const t = { drafts: 0, games: 0, recorded: 0, quarantined: 0, engineErrors: 0 };
  for (const n of ns) {
    t.drafts += n.drafts;
    t.games += n.games;
    t.recorded += n.recorded;
    t.quarantined += n.quarantined;
    t.engineErrors += n.engineErrors;
  }
  return t;
}

// ---------------------------------------------------------------------------
// Staleness, sample, source, fetch

export type WarehouseStaleness = 'fresh' | 'amber' | 'red' | 'unknown';

/** How old the file is: fresh, amber after WAREHOUSE_AMBER_AFTER_S, red after WAREHOUSE_RED_AFTER_S; unknown without a time. */
export function warehouseStaleness(at: Date | null, now: Date): { level: WarehouseStaleness; ageS: number | null } {
  if (!at) return { level: 'unknown', ageS: null };
  const ageS = Math.max(0, (now.getTime() - at.getTime()) / 1000);
  return { level: ageS >= WAREHOUSE_RED_AFTER_S ? 'red' : ageS >= WAREHOUSE_AMBER_AFTER_S ? 'amber' : 'fresh', ageS };
}

/** Move `generatedAt` to `ageS` before `now` (the bundled sample keeps looking current). */
export function rebaseWarehouse(w: Warehouse, now: Date, ageS = 6 * 3600): Warehouse {
  return w.generatedAt ? { ...w, generatedAt: new Date(now.getTime() - ageS * 1000) } : w;
}

/** `#lab/data`, `#lab/data?src=sample`, `#lab/data?src=<http(s) URL>`. */
export function warehouseSource(hash: string, baseUrl: string): LabSource {
  return hashSource(/^#lab\/data\/?\?(?:.*&)?src=(.*)$/.exec(hash)?.[1], DEFAULT_WAREHOUSE_SRC, 'warehouse-sample.json', baseUrl);
}

/** Fetch and parse warehouse.json. Errors are LabFetchError, sorted by kind. */
export async function fetchWarehouse(url: string, opts: { fetch: FetchLike; now?: number; signal?: AbortSignal }): Promise<Warehouse> {
  const json = await fetchLabJson(url, opts, 'warehouse file', WAREHOUSE_MAX_BYTES);
  try {
    return parseWarehouse(json);
  } catch (e) {
    throw new LabFetchError('parse', e instanceof Error ? e.message : 'The warehouse file is not a warehouse file.');
  }
}
