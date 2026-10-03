/*
 * ForgeCoach — lab/ladder.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The AI leaderboard's data (#lab/ladder): mtg-table's AI ladder `ladder.json`
 * (schema "mtg-table/ai-ladder", version 1; mtg-table docs/guides/ai-ladder.md
 * and tools/ai-ladder/report.ts, D318–D321), published numbers-only by the PC
 * runner next to status.json on this repo's `lab-status` branch. Unknown JSON
 * in, a typed, validated view model out, plus what the page needs to stay
 * honest about the intervals: rank ranges and which players overlap. DOM-free;
 * `fetch` is injected.
 *
 * Every string is untrusted: cleaned with `cleanText` and only ever rendered
 * as React text, never put into a URL or markup. Every number is range-checked.
 * Unknown fields are ignored; the page reads only the fields in LADDER_FIELDS.
 */
import { cleanText, fetchLabJson, hashSource, int, num, parseTime, type FetchLike, type LabSource, LabFetchError } from './status.ts';

export const DEFAULT_LADDER_SRC = 'https://raw.githubusercontent.com/jalirkan/ForgeCoach/lab-status/ladder.json';
export const LADDER_SCHEMA = 'mtg-table/ai-ladder';
export const LADDER_VERSION = 1;
/** Ladder runs are hours long and the report follows a run: amber after a day, red after three. */
export const LADDER_AMBER_AFTER_S = 24 * 3600;
export const LADDER_RED_AFTER_S = 72 * 3600;
export const LADDER_REFRESH_MS = 5 * 60_000;
/** Far larger than a numbers-only ladder.json with history and logs stripped. */
export const LADDER_MAX_BYTES = 1024 * 1024;
const MAX_PLAYERS = 100;
const MAX_LOG = 30;
const NAME = 80;
/** Ratings outside this are not ratings (the prior's sd is 350 around 1500). */
const R_MIN = -2000;
const R_MAX = 6000;

/**
 * The ladder.json fields this page reads: the runner's sanitised copy may
 * publish exactly these and nothing else. `[]` marks an array of objects.
 */
export const LADDER_FIELDS: readonly string[] = [
  'schema',
  'version',
  'generatedAt',
  'anchor.name',
  'anchor.rating',
  'scale',
  'ci',
  'set',
  'totals.games',
  'totals.decisive',
  'totals.draws',
  'totals.first',
  'totals.last',
  'players[].name',
  'players[].kind',
  'players[].anchor',
  'players[].registered',
  'players[].available',
  'players[].rating',
  'players[].lo',
  'players[].hi',
  'players[].rated',
  'players[].games',
  'players[].wins',
  'players[].losses',
  'players[].draws',
  'players[].vsAnchor.wins',
  'players[].vsAnchor.losses',
  'players[].vsAnchor.rate',
  'players[].vsAnchor.lo',
  'players[].vsAnchor.hi',
  'sprt[].at',
  'sprt[].a',
  'sprt[].b',
  'sprt[].elo0',
  'sprt[].elo1',
  'sprt[].alpha',
  'sprt[].beta',
  'sprt[].result',
  'sprt[].llr',
  'sprt[].lower',
  'sprt[].upper',
  'sprt[].games',
  'sprt[].pairs',
  'sprt[].score',
  'sprt[].purpose',
  'tune[].at',
  'tune[].base',
  'tune[].vary (keys and values)',
  'tune[].pool',
  'tune[].eta',
  'tune[].games',
  'tune[].winner.label',
  'tune[].winner.registeredAs',
  'tune[].rounds[].round',
  'tune[].rounds[].standings[].label',
  'tune[].rounds[].standings[].wins',
  'tune[].rounds[].standings[].losses',
  'tune[].rounds[].standings[].score',
  'league.best',
  'league.pool',
  'league.promoted[].name',
  'league.promoted[].at',
  'league.promoted[].reason',
];

// ---------------------------------------------------------------------------
// View model

export interface VsAnchor {
  wins: number;
  losses: number;
  /** wins / (wins + losses), 0..1. */
  rate: number;
  /** Wilson 95%, 0..1; null when absent or inconsistent. */
  lo: number | null;
  hi: number | null;
}

export interface LadderPlayer {
  name: string;
  kind: string | null;
  anchor: boolean;
  /** The scale's zero (the file's `anchor.name`, forge-default). */
  isZero: boolean;
  registered: boolean;
  available: boolean;
  /** Has a decisive game; false = its rating is the prior and means nothing. */
  rated: boolean;
  rating: number | null;
  /** 95% interval; null when absent or not around the rating. */
  lo: number | null;
  hi: number | null;
  games: number | null;
  wins: number | null;
  losses: number | null;
  draws: number | null;
  vsAnchor: VsAnchor | null;
}

export type SprtResult = 'H1' | 'H0' | 'inconclusive' | 'stopped' | 'unknown';

export interface SprtRow {
  at: Date | null;
  a: string;
  b: string;
  elo0: number | null;
  elo1: number | null;
  alpha: number | null;
  beta: number | null;
  result: SprtResult;
  llr: number | null;
  lower: number | null;
  upper: number | null;
  games: number | null;
  pairs: number | null;
  /** A's mean pair score, 0..1. */
  score: number | null;
  purpose: string | null;
}

export interface TuneStanding {
  label: string;
  wins: number | null;
  losses: number | null;
  score: number | null;
}

export interface TuneRow {
  at: Date | null;
  base: string;
  /** The parameters raced and their values, as text. */
  vary: Array<{ key: string; values: string[] }>;
  pool: string[];
  eta: number | null;
  games: number | null;
  winner: string | null;
  registeredAs: string | null;
  rounds: number;
  /** The last round's standings, best first. */
  final: TuneStanding[];
}

export interface League {
  best: string | null;
  pool: string[];
  promoted: Array<{ name: string; at: Date | null; reason: string | null }>;
}

export interface Ladder {
  schema: string | null;
  version: number | null;
  generatedAt: Date | null;
  anchorName: string;
  anchorRating: number;
  /** "hessian", "bootstrap:<n>", or other text. */
  ci: string | null;
  set: string | null;
  totals: { games: number | null; decisive: number | null; draws: number | null; first: Date | null; last: Date | null };
  /** Rated players best first, then the unrated. */
  players: LadderPlayer[];
  /** Newest first. */
  sprt: SprtRow[];
  /** Newest first. */
  tune: TuneRow[];
  league: League | null;
}

// ---------------------------------------------------------------------------
// Parsing

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const own = (o: Obj, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const list = (v: unknown, max = MAX_LOG): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
const bool = (v: unknown): boolean => v === true;
/** A finite JSON number in [min, max] (no numeric strings). */
const real = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' ? num(v, min, max) : null);
/** Untrusted text that must be a JSON string (a name is never a number). */
const str = (v: unknown, max: number): string | null => (typeof v === 'string' ? cleanText(v, max) : null);
const names = (v: unknown, max = 20): string[] => list(v, max).map((x) => cleanText(x, NAME)).filter((x): x is string => x !== null);

/** Thrown when the body is not a ladder file at all. */
export class LadderError extends Error {}

function parseVs(v: unknown): VsAnchor | null {
  if (!isObj(v)) return null;
  const wins = int(own(v, 'wins'), 0, 1e9);
  const losses = int(own(v, 'losses'), 0, 1e9);
  if (wins === null || losses === null || wins + losses === 0) return null;
  const rate = wins / (wins + losses);
  let lo = real(own(v, 'lo'), 0, 1);
  let hi = real(own(v, 'hi'), 0, 1);
  // The interval must hold the observed rate (with rounding slack).
  if (lo === null || hi === null || lo > rate + 0.002 || hi < rate - 0.002) lo = hi = null;
  return { wins, losses, rate, lo, hi };
}

function parsePlayer(v: unknown, anchorName: string): LadderPlayer | null {
  if (!isObj(v)) return null;
  const name = str(own(v, 'name'), NAME);
  if (!name) return null;
  const rating = real(own(v, 'rating'), R_MIN, R_MAX);
  let lo = real(own(v, 'lo'), R_MIN, R_MAX);
  let hi = real(own(v, 'hi'), R_MIN, R_MAX);
  if (rating === null || lo === null || hi === null || lo > rating || hi < rating) lo = hi = null;
  const games = int(own(v, 'games'), 0, 1e9);
  // `rated` false, or no decisive game: the rating is only the prior.
  const rated = own(v, 'rated') !== false && rating !== null && games !== 0;
  const isZero = name === anchorName;
  return {
    name,
    kind: str(own(v, 'kind'), 30),
    anchor: bool(own(v, 'anchor')) || isZero,
    isZero,
    registered: own(v, 'registered') !== false,
    available: own(v, 'available') !== false,
    rated,
    rating,
    lo,
    hi,
    games,
    wins: int(own(v, 'wins'), 0, 1e9),
    losses: int(own(v, 'losses'), 0, 1e9),
    draws: int(own(v, 'draws'), 0, 1e9),
    vsAnchor: isZero ? null : parseVs(own(v, 'vsAnchor')),
  };
}

const SPRT_RESULTS = new Set(['H1', 'H0', 'inconclusive', 'stopped']);

function parseSprt(v: unknown): SprtRow | null {
  if (!isObj(v)) return null;
  const a = str(own(v, 'a'), NAME);
  const b = str(own(v, 'b'), NAME);
  if (!a || !b) return null;
  const r = own(v, 'result');
  return {
    at: parseTime(own(v, 'at')),
    a,
    b,
    elo0: real(own(v, 'elo0'), -1000, 1000),
    elo1: real(own(v, 'elo1'), -1000, 1000),
    alpha: real(own(v, 'alpha'), 0, 1),
    beta: real(own(v, 'beta'), 0, 1),
    result: typeof r === 'string' && SPRT_RESULTS.has(r) ? (r as SprtResult) : 'unknown',
    llr: real(own(v, 'llr'), -1e6, 1e6),
    lower: real(own(v, 'lower'), -1e6, 1e6),
    upper: real(own(v, 'upper'), -1e6, 1e6),
    games: int(own(v, 'games'), 0, 1e9),
    pairs: int(own(v, 'pairs'), 0, 1e9),
    score: real(own(v, 'score'), 0, 1),
    purpose: cleanText(own(v, 'purpose'), 20),
  };
}

function parseStanding(v: unknown): TuneStanding | null {
  if (!isObj(v)) return null;
  const label = cleanText(own(v, 'label'), 120);
  if (!label) return null;
  return { label, wins: int(own(v, 'wins'), 0, 1e9), losses: int(own(v, 'losses'), 0, 1e9), score: real(own(v, 'score'), 0, 1) };
}

function parseTune(v: unknown): TuneRow | null {
  if (!isObj(v)) return null;
  const base = str(own(v, 'base'), NAME);
  if (!base) return null;
  const varyRaw = own(v, 'vary');
  const vary = isObj(varyRaw)
    ? Object.keys(varyRaw)
        .slice(0, 12)
        .map((k) => ({ key: cleanText(k, 30), values: names(own(varyRaw, k), 12) }))
        .filter((x): x is { key: string; values: string[] } => x.key !== null)
    : [];
  const rounds = list(own(v, 'rounds'), 20).filter(isObj);
  const last = rounds[rounds.length - 1];
  const final = last
    ? list(own(last, 'standings'), 40)
        .map(parseStanding)
        .filter((s): s is TuneStanding => s !== null)
        .sort((x, y) => (y.score ?? -1) - (x.score ?? -1))
    : [];
  const w = own(v, 'winner');
  return {
    at: parseTime(own(v, 'at')),
    base,
    vary,
    pool: names(own(v, 'pool')),
    eta: int(own(v, 'eta'), 1, 100),
    games: int(own(v, 'games'), 0, 1e9),
    winner: isObj(w) ? cleanText(own(w, 'label'), 120) : null,
    registeredAs: isObj(w) ? cleanText(own(w, 'registeredAs'), NAME) : null,
    rounds: rounds.length,
    final,
  };
}

function parseLeague(v: unknown): League | null {
  if (!isObj(v)) return null;
  const promoted = list(own(v, 'promoted'))
    .filter(isObj)
    .map((p) => ({ name: str(own(p, 'name'), NAME), at: parseTime(own(p, 'at')), reason: cleanText(own(p, 'reason'), 200) }))
    .filter((p): p is League['promoted'][number] & { name: string } => p.name !== null);
  return { best: str(own(v, 'best'), NAME), pool: names(own(v, 'pool')), promoted };
}

function byTimeDesc<T extends { at: Date | null }>(rows: T[]): T[] {
  // The file is newest first already; dated rows are re-sorted in case it is not, undated keep file order after them.
  const dated = rows.filter((r) => r.at).sort((x, y) => y.at!.getTime() - x.at!.getTime());
  return [...dated, ...rows.filter((r) => !r.at)];
}

/** Unknown JSON → Ladder. Throws LadderError when it is not an object or names another schema. */
export function parseLadder(json: unknown): Ladder {
  if (!isObj(json)) throw new LadderError('The ladder file is not a JSON object.');
  const schema = cleanText(own(json, 'schema'), 60);
  if (schema !== null && schema !== LADDER_SCHEMA) throw new LadderError('This is not an AI ladder file.');
  const anchorRaw = own(json, 'anchor');
  const anchorName = (isObj(anchorRaw) ? str(own(anchorRaw, 'name'), NAME) : null) ?? 'forge-default';
  const anchorRating = (isObj(anchorRaw) ? real(own(anchorRaw, 'rating'), R_MIN, R_MAX) : null) ?? 1500;

  const seen = new Set<string>();
  const players: LadderPlayer[] = [];
  for (const raw of list(own(json, 'players'), MAX_PLAYERS)) {
    const p = parsePlayer(raw, anchorName);
    if (!p || seen.has(p.name)) continue;
    seen.add(p.name);
    // The zero is fixed: it has no interval of its own.
    if (p.isZero) Object.assign(p, { rating: anchorRating, lo: anchorRating, hi: anchorRating, rated: true });
    players.push(p);
  }
  players.sort((x, y) => Number(y.rated) - Number(x.rated) || (y.rating ?? -Infinity) - (x.rating ?? -Infinity) || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));

  const t = own(json, 'totals');
  const totals = isObj(t)
    ? {
        games: int(own(t, 'games'), 0, 1e10),
        decisive: int(own(t, 'decisive'), 0, 1e10),
        draws: int(own(t, 'draws'), 0, 1e10),
        first: parseTime(own(t, 'first')),
        last: parseTime(own(t, 'last')),
      }
    : { games: null, decisive: null, draws: null, first: null, last: null };

  return {
    schema,
    version: int(own(json, 'version'), 0, 1e6),
    generatedAt: parseTime(own(json, 'generatedAt')),
    anchorName,
    anchorRating,
    ci: cleanText(own(json, 'ci'), 40),
    set: cleanText(own(json, 'set'), 120),
    totals,
    players,
    sprt: byTimeDesc(list(own(json, 'sprt')).map(parseSprt).filter((r): r is SprtRow => r !== null)),
    tune: byTimeDesc(list(own(json, 'tune')).map(parseTune).filter((r): r is TuneRow => r !== null)),
    league: parseLeague(own(json, 'league')),
  };
}

// ---------------------------------------------------------------------------
// Interval honesty

/** A player the chart can draw: rated, with an interval. */
export function hasInterval(p: LadderPlayer): p is LadderPlayer & { rating: number; lo: number; hi: number } {
  return p.rated && p.rating !== null && p.lo !== null && p.hi !== null;
}

/** Two 95% intervals overlap: the data does not separate the two players. */
export function overlaps(a: LadderPlayer, b: LadderPlayer): boolean {
  if (!hasInterval(a) || !hasInterval(b)) return true;
  return a.lo <= b.hi && b.lo <= a.hi;
}

/**
 * The ranks a player could hold given the intervals: 1 + the players clearly
 * above it, to N − the players clearly below it (N = players with intervals).
 * Null for a player without an interval.
 */
export function rankRange(p: LadderPlayer, all: LadderPlayer[]): [number, number] | null {
  if (!hasInterval(p)) return null;
  const rated = all.filter(hasInterval);
  const above = rated.filter((q) => q !== p && q.lo > p.hi).length;
  const below = rated.filter((q) => q !== p && q.hi < p.lo).length;
  return [above + 1, rated.length - below];
}

export type Relation = 'self' | 'above' | 'below' | 'overlap' | 'none';

/** Where `p` stands against the reference player `ref`: clearly above, clearly below, or not separated. */
export function relation(p: LadderPlayer, ref: LadderPlayer): Relation {
  if (p === ref) return 'self';
  if (!hasInterval(p) || !hasInterval(ref)) return 'none';
  if (p.lo > ref.hi) return 'above';
  if (p.hi < ref.lo) return 'below';
  return 'overlap';
}

/** The chart's axis: the rated players' intervals with a margin, on round 50s, at least 300 wide. */
export function axisDomain(players: LadderPlayer[], anchorRating = 1500): { min: number; max: number; ticks: number[] } {
  const r = players.filter(hasInterval);
  let min = Math.min(anchorRating, ...r.map((p) => p.lo));
  let max = Math.max(anchorRating, ...r.map((p) => p.hi));
  const pad = Math.max(20, (max - min) * 0.04);
  min = Math.floor((min - pad) / 50) * 50;
  max = Math.ceil((max + pad) / 50) * 50;
  if (max - min < 300) {
    const mid = (min + max) / 2;
    min = Math.floor((mid - 150) / 50) * 50;
    max = min + 300;
  }
  const span = max - min;
  const step = span <= 400 ? 100 : span <= 1000 ? 200 : span <= 2500 ? 500 : 1000;
  const ticks: number[] = [];
  for (let x = Math.ceil(min / step) * step; x <= max; x += step) ticks.push(x);
  return { min, max, ticks };
}

/** x in [min, max] → 0..100 (%), clamped. */
export function axisPct(x: number, d: { min: number; max: number }): number {
  return Math.min(100, Math.max(0, ((x - d.min) / (d.max - d.min)) * 100));
}

/** One honest sentence about the ladder against the anchor. */
export function anchorSummary(l: Ladder): string {
  const zero = l.players.find((p) => p.isZero);
  const rated = l.players.filter((p) => hasInterval(p) && !p.isZero);
  if (!zero || !rated.length) return 'No player has a rating yet.';
  const above = rated.filter((p) => relation(p, zero) === 'above').map((p) => p.name);
  const below = rated.filter((p) => relation(p, zero) === 'below').map((p) => p.name);
  const parts: string[] = [];
  if (above.length) parts.push(`stronger than ${zero.name}: ${above.join(', ')}`);
  if (below.length) parts.push(`weaker: ${below.join(', ')}`);
  const rest = rated.length - above.length - below.length;
  if (!parts.length) return `No player is separated from ${zero.name} yet: every interval includes ${fmtRating(l.anchorRating)}.`;
  const s = `Clearly ${parts.join('; ')}.`;
  return rest ? `${s} ${rest === 1 ? 'One other is' : `${rest} others are`} not separated from it.` : s;
}

// ---------------------------------------------------------------------------
// Formatting

export const fmtRating = (x: number | null): string => (x === null ? '—' : String(Math.round(x)));

/** "+63" / "−12" / "±0" against the anchor. */
export function fmtDelta(x: number | null, anchor: number): string {
  if (x === null) return '—';
  const d = Math.round(x - anchor);
  return d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '±0';
}

/** "1480–1646". */
export function fmtInterval(p: LadderPlayer): string {
  return p.lo === null || p.hi === null ? 'no interval' : `${fmtRating(p.lo)}–${fmtRating(p.hi)}`;
}

/** A 0..1 rate as "56%". */
export const fmtPct = (x: number | null): string => (x === null ? '—' : `${Math.round(x * 100)}%`);

/** "confirm set", "dev set", "every set", or the file name. */
export function setLabel(set: string | null): string | null {
  if (!set) return null;
  if (set === 'all') return 'every deck set';
  if (/pairs-confirm\.txt$/.test(set)) return 'the confirm deck set';
  if (/pairs-dev\.txt$/.test(set)) return 'the dev deck set';
  return set.split('/').pop() ?? set;
}

/** "Hessian" / "bootstrap (1000 resamples)". */
export function ciLabel(ci: string | null): string {
  if (!ci) return '95% intervals';
  const m = /^bootstrap:(\d+)$/.exec(ci);
  if (m) return `95% bootstrap intervals (${m[1]} resamples)`;
  if (ci === 'hessian') return '95% intervals (Hessian)';
  return `95% intervals (${ci})`;
}

/** The SPRT's verdict in words, without claiming more than the test decided. */
export function sprtVerdict(r: SprtRow): string {
  const e1 = r.elo1 === null ? 'the margin' : `${fmtSigned(r.elo1)} Elo`;
  const e0 = r.elo0 === null ? 'the null' : `${fmtSigned(r.elo0)} Elo`;
  switch (r.result) {
    case 'H1':
      return `${r.a} is stronger than ${r.b} by at least ${e1}`;
    case 'H0':
      return `${r.a} is not stronger than ${r.b} by ${e1} (at most ${e0})`;
    case 'inconclusive':
      return 'Inconclusive: the game limit came first';
    case 'stopped':
      return 'Stopped before a decision';
    default:
      return 'Unknown result';
  }
}

function fmtSigned(x: number): string {
  const r = Math.round(x * 10) / 10;
  return r > 0 ? `+${r}` : r < 0 ? `−${-r}` : '0';
}

// ---------------------------------------------------------------------------
// Staleness, sample, fetch

export type LadderStaleness = 'fresh' | 'amber' | 'red' | 'unknown';

export function ladderStaleness(at: Date | null, now: Date): { level: LadderStaleness; ageS: number | null } {
  if (!at) return { level: 'unknown', ageS: null };
  const ageS = Math.max(0, (now.getTime() - at.getTime()) / 1000);
  return { level: ageS >= LADDER_RED_AFTER_S ? 'red' : ageS >= LADDER_AMBER_AFTER_S ? 'amber' : 'fresh', ageS };
}

/** Shift every time so `generatedAt` is `ageS` before `now` (the bundled sample keeps looking current). */
export function rebaseLadder(l: Ladder, now: Date, ageS = 2 * 3600): Ladder {
  if (!l.generatedAt) return l;
  const shift = now.getTime() - ageS * 1000 - l.generatedAt.getTime();
  const mv = (d: Date | null) => (d ? new Date(d.getTime() + shift) : null);
  return {
    ...l,
    generatedAt: mv(l.generatedAt),
    totals: { ...l.totals, first: mv(l.totals.first), last: mv(l.totals.last) },
    sprt: l.sprt.map((r) => ({ ...r, at: mv(r.at) })),
    tune: l.tune.map((r) => ({ ...r, at: mv(r.at) })),
    league: l.league ? { ...l.league, promoted: l.league.promoted.map((p) => ({ ...p, at: mv(p.at) })) } : null,
  };
}

/** `#lab/ladder`, `#lab/ladder?src=sample`, `#lab/ladder?src=<http(s) URL>`. */
export function ladderSource(hash: string, baseUrl: string): LabSource {
  return hashSource(/^#lab\/ladder\/?\?(?:.*&)?src=(.*)$/.exec(hash)?.[1], DEFAULT_LADDER_SRC, 'ladder-sample.json', baseUrl);
}

/** Fetch and parse ladder.json. Errors are LabFetchError, sorted by kind. */
export async function fetchLadder(url: string, opts: { fetch: FetchLike; now?: number; signal?: AbortSignal }): Promise<Ladder> {
  const json = await fetchLabJson(url, opts, 'ladder file', LADDER_MAX_BYTES);
  try {
    return parseLadder(json);
  } catch (e) {
    throw new LabFetchError('parse', e instanceof Error ? e.message : 'The ladder file is not a ladder file.');
  }
}
