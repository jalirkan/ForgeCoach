/*
 * ForgeCoach — cube/flatness.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * How flat is a cube's power? From one cube lab meta.json, how spread out the
 * cards' (and archetypes') win rates are, with the part of that spread that
 * sampling noise alone would produce taken out. DOM-free.
 *
 * Definitions (rates are fractions; "points" are percentage points):
 *  - Included units: cards (or archetypes) with at least `minGames` games.
 *  - Observed SD / IQR: of the lab's shrunk win rates, (wins + k·m)/(games + k),
 *    unweighted across included units. `meanRate` is their mean.
 *  - Above-5 share: units whose shrunk rate is more than 5 points over that mean.
 *  - Noise SD: the SD the shrunk rates would show if every unit had the same
 *    true rate m (the prior mean), from the binomial at each unit's own game
 *    count: Var(shrunk_i) = g_i·m(1−m)/(g_i+k)². The same model gives the
 *    share above +5 that noise alone would produce (normal tail).
 *  - True SD: observed variance minus mean noise variance, floored at 0. A
 *    shrunk rate keeps only g/(g+k) of a unit's true deviation, so that signal
 *    variance is divided by the mean of (g_i/(g_i+k))² to get back to the
 *    scale of real win rates. Its 95 % interval
 *    comes from the chi-square interval on the observed variance (n − 1 degrees
 *    of freedom) less the noise variance, so it is wide when units are few.
 *  - Verdict from the true-SD interval [lo, hi]: `flat` if hi ≤ FLAT_SD,
 *    `uneven` if lo > FLAT_SD, `some` if lo > 0 (real but not shown to be
 *    large), else `unclear` (the data cannot tell the cube from a perfectly
 *    flat one, nor from a lumpy one).
 *  - Compare: cube A is flatter than B only when A's true-SD interval lies
 *    entirely below B's.
 *
 * Caveats the numbers cannot fix: a game's two decks each count one game for
 * every card in them, so a card's games are not independent trials (they come
 * in clusters of one deck), which makes the binomial noise a little too small
 * and the true SD a little too big. And the lab's AI is not you.
 */
import type { CubeMeta, MetaCardStats } from './meta.ts';
import { shrinkRate, shrinkage } from './metaView.ts';

/** A true SD at or under this many points counts as flat. */
export const FLAT_SD = 0.03;
export const ABOVE_MARGIN = 0.05;
export const CARD_MIN_GAMES = 10;
export const ARCHETYPE_MIN_GAMES = 5;
/** Fewer included units than this: no verdict. */
export const MIN_UNITS = 12;

export interface SpreadUnit {
  name: string;
  games: number;
  wins: number;
  /** The shrunk win rate. */
  shrunk: number;
  /** The lab's 95 % interval on the raw rate. */
  ci: [number, number] | null;
}

export type Verdict = 'flat' | 'some' | 'uneven' | 'unclear' | 'unreadable';

export interface Outlier extends SpreadUnit {
  /** shrunk − mean rate. */
  dev: number;
  /** The interval lies wholly on one side of the mean rate. */
  clear: boolean;
}

export interface SpreadStats {
  /** Units with data at all, and those with enough games. */
  total: number;
  n: number;
  minGames: number;
  /** Mean of the included shrunk rates. */
  meanRate: number;
  sd: number;
  q1: number;
  q3: number;
  iqr: number;
  aboveShare: number;
  aboveCount: number;
  /** The share above +5 points that noise alone would give (flat cube, same game counts). */
  noiseAboveShare: number;
  noiseSd: number;
  /** Observed variance − noise variance on the shrunk scale, floored at 0. */
  excessVar: number;
  trueSd: number;
  trueSdCi: [number, number];
  verdict: Verdict;
  /** Included units sorted by shrunk rate, for plots. */
  units: SpreadUnit[];
  /** The largest deviations either way. */
  outliers: Outlier[];
  /** Included units whose interval excludes the mean, and how many 95 % intervals would by chance. */
  clearCount: number;
  clearByChance: number;
}

export interface CubeSpread {
  cards: SpreadStats | null;
  archetypes: SpreadStats | null;
}

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** Inverse standard normal CDF at the two quantiles used here. */
const Z: Record<number, number> = { 0.025: -1.959964, 0.975: 1.959964 };

/** Chi-square quantile by the Wilson–Hilferty approximation (p = 0.025 or 0.975). */
function chi2Quantile(p: 0.025 | 0.975, nu: number): number {
  const c = 2 / (9 * nu);
  return nu * Math.pow(1 - c + Z[p]! * Math.sqrt(c), 3);
}

/** Standard normal upper tail P(Z > z) (Abramowitz–Stegun 7.1.26). */
export function normalTail(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  const upper = 0.5 * (1 - erf);
  return z >= 0 ? upper : 1 - upper;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** Observed variance, mean noise variance, and the true-SD point estimate for a set of units. */
function moments(units: SpreadUnit[], m: number, k: number): { obsVar: number; noiseVar: number; excess: number; trueSd: number } {
  const n = units.length;
  const mean = units.reduce((s, u) => s + u.shrunk, 0) / n;
  const obsVar = n > 1 ? units.reduce((s, u) => s + (u.shrunk - mean) ** 2, 0) / (n - 1) : 0;
  const noiseVar = units.reduce((s, u) => s + (u.games * m * (1 - m)) / (u.games + k) ** 2, 0) / n;
  const lam2 = units.reduce((s, u) => s + (u.games / (u.games + k)) ** 2, 0) / n;
  const excess = Math.max(0, obsVar - noiseVar);
  return { obsVar, noiseVar, excess, trueSd: lam2 > 0 ? Math.sqrt(excess / lam2) : 0 };
}

/** The spread statistics for a list of units. Null when there are no units with games. */
export function spreadOf(all: SpreadUnit[], opts: { minGames: number; priorMean: number; priorStrength: number; }): SpreadStats | null {
  const { minGames, priorMean: m, priorStrength: k } = opts;
  const withGames = all.filter((u) => u.games > 0);
  const units = withGames.filter((u) => u.games >= minGames).sort((a, b) => a.shrunk - b.shrunk || a.name.localeCompare(b.name));
  const n = units.length;
  if (n === 0) return null;
  const rates = units.map((u) => u.shrunk);
  const meanRate = rates.reduce((s, x) => s + x, 0) / n;
  const mo = moments(units, m, k);
  const q1 = quantile(rates, 0.25);
  const q3 = quantile(rates, 0.75);
  const aboveCount = units.filter((u) => u.shrunk > meanRate + ABOVE_MARGIN).length;
  const noiseAboveShare =
    units.reduce((s, u) => s + normalTail(ABOVE_MARGIN / (Math.sqrt(u.games * m * (1 - m)) / (u.games + k))), 0) / n;

  // Interval: the observed variance's chi-square interval (n − 1 degrees of
  // freedom), less the noise variance, floored at 0, on the true-rate scale.
  // Unlike a bootstrap this stays honest when the estimate is floored at 0.
  const lam2 = units.reduce((s, u) => s + (u.games / (u.games + k)) ** 2, 0) / n;
  const nu = n - 1;
  const trueSdCi: [number, number] =
    nu >= 1 && lam2 > 0
      ? [
          Math.sqrt(Math.max(0, (mo.obsVar * nu) / chi2Quantile(0.975, nu) - mo.noiseVar) / lam2),
          Math.sqrt(Math.max(0, (mo.obsVar * nu) / chi2Quantile(0.025, nu) - mo.noiseVar) / lam2),
        ]
      : [0, 1];
  trueSdCi[0] = Math.min(trueSdCi[0], mo.trueSd);
  trueSdCi[1] = Math.max(trueSdCi[1], mo.trueSd);

  let verdict: Verdict;
  if (n < MIN_UNITS) verdict = 'unreadable';
  else if (trueSdCi[1] <= FLAT_SD) verdict = 'flat';
  else if (trueSdCi[0] > FLAT_SD) verdict = 'uneven';
  else if (trueSdCi[0] > 0) verdict = 'some';
  else verdict = 'unclear';

  const side = (u: SpreadUnit) => (u.ci ? (u.ci[0] > meanRate ? 1 : u.ci[1] < meanRate ? -1 : 0) : 0);
  const clearCount = units.filter((u) => side(u) !== 0).length;
  const outliers: Outlier[] = [...units]
    .sort((a, b) => Math.abs(b.shrunk - meanRate) - Math.abs(a.shrunk - meanRate) || a.name.localeCompare(b.name))
    .slice(0, 5)
    .map((u) => ({ ...u, dev: u.shrunk - meanRate, clear: side(u) !== 0 }));

  return {
    total: withGames.length,
    n,
    minGames,
    meanRate,
    sd: Math.sqrt(mo.obsVar),
    q1,
    q3,
    iqr: q3 - q1,
    aboveShare: aboveCount / n,
    aboveCount,
    noiseAboveShare,
    noiseSd: Math.sqrt(mo.noiseVar),
    excessVar: mo.excess,
    trueSd: mo.trueSd,
    trueSdCi,
    verdict,
    units,
    outliers,
    clearCount,
    clearByChance: 0.05 * n,
  };
}

/** The prior the lab used: sample.shrinkage, else 20 games on the games-weighted mean raw rate. */
function priorOf(meta: CubeMeta): { mean: number; strength: number } {
  const p = shrinkage(meta);
  if (p.mean !== null) return { mean: p.mean, strength: p.strength };
  let g = 0;
  let w = 0;
  for (const c of Object.values(meta.cards)) {
    const games = num(c.games) ?? 0;
    g += games;
    w += num(c.wins) ?? (num(c.winRate) ?? 0) * games;
  }
  return { mean: g > 0 ? w / g : 0.5, strength: p.strength };
}

function cardUnit(name: string, c: MetaCardStats, prior: { mean: number; strength: number }): SpreadUnit | null {
  const games = num(c.games) ?? 0;
  if (games <= 0) return null;
  const raw = num(c.winRate);
  const wins = num(c.wins) ?? (raw !== null ? raw * games : null);
  const shrunk = num(c.winRateShrunk) ?? (raw !== null ? shrinkRate(raw, games, prior.strength, prior.mean) : null);
  if (shrunk === null || wins === null) return null;
  return { name, games, wins, shrunk, ci: Array.isArray(c.ci) && c.ci.length === 2 ? [c.ci[0], c.ci[1]] : null };
}

export interface SpreadOptions {
  cardMinGames?: number;
  archetypeMinGames?: number;
}

/** Card-level and archetype-level spread for one cube's meta. */
export function cubeSpread(meta: CubeMeta, opts: SpreadOptions = {}): CubeSpread {
  const prior = priorOf(meta);
  const cardUnits = Object.entries(meta.cards)
    .map(([name, c]) => cardUnit(name, c, prior))
    .filter((u): u is SpreadUnit => u !== null);
  const archUnits: SpreadUnit[] = [];
  for (const a of meta.archetypes) {
    const games = num(a.games) ?? 0;
    const raw = num(a.winRate);
    if (games <= 0 || raw === null) continue;
    const shrunk = num((a as { winRateShrunk?: number }).winRateShrunk) ?? shrinkRate(raw, games, prior.strength, prior.mean);
    archUnits.push({ name: a.id, games, wins: raw * games, shrunk, ci: Array.isArray(a.ci) && a.ci.length === 2 ? [a.ci[0], a.ci[1]] : null });
  }
  const base = { priorMean: prior.mean, priorStrength: prior.strength };
  return {
    cards: spreadOf(cardUnits, { ...base, minGames: opts.cardMinGames ?? CARD_MIN_GAMES }),
    archetypes: spreadOf(archUnits, { ...base, minGames: opts.archetypeMinGames ?? ARCHETYPE_MIN_GAMES }),
  };
}

// ---------------------------------------------------------------------------
// Plain language

const p1 = (x: number) => (x * 100).toFixed(1);

/** One to three sentences saying what a spread does and does not show. */
export function readSpread(s: SpreadStats | null, what = 'card'): string[] {
  if (!s) return [`No ${what} has any games yet.`];
  if (s.verdict === 'unreadable')
    return [`Only ${s.n} ${what}${s.n === 1 ? '' : 's'} ${s.n === 1 ? 'has' : 'have'} ${s.minGames}+ games: too few to measure a spread. More lab games are needed.`];
  const out: string[] = [];
  out.push(
    `Win rates spread with an SD of ${p1(s.sd)} points; sampling noise alone would give ${p1(s.noiseSd)}. ` +
      `That leaves an estimated true spread of ${p1(s.trueSd)} points (95% interval ${p1(s.trueSdCi[0])}–${p1(s.trueSdCi[1])}).`,
  );
  const t = FLAT_SD * 100;
  if (s.verdict === 'flat') out.push(`Flat: the true spread is very unlikely to exceed ${t} points.`);
  else if (s.verdict === 'uneven') out.push(`Uneven: the interval sits wholly above ${t} points, so some ${what}s really are stronger than others.`);
  else if (s.verdict === 'some') out.push(`Some real spread, but the data do not show it above ${t} points.`);
  else out.push(`The data cannot tell this cube from a perfectly flat one (the interval starts at 0), nor from one with a ${t}-point spread. This is the sample talking, not a finding of flatness.`);
  return out;
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  flat: 'Flat',
  some: 'Some real spread',
  uneven: 'Uneven',
  unclear: 'Can’t tell',
  unreadable: 'Too few games',
};

// ---------------------------------------------------------------------------
// Comparing cubes

export interface CompareInput {
  id: string;
  title: string;
  meta: CubeMeta | null;
  source: 'imported' | 'shipped' | null;
}

export interface CompareRow {
  id: string;
  title: string;
  source: CompareInput['source'];
  games: number | null;
  spread: SpreadStats | null;
}

export interface Comparison {
  rows: CompareRow[];
  /** Plain statements, each backed by non-overlapping intervals. */
  readings: string[];
  /** Why there is nothing to say, when there is not. */
  caveat: string | null;
}

const shortTitle = (t: string) => t.replace(/ Cube$/, '');

export function compareCubes(inputs: CompareInput[], opts: SpreadOptions = {}): Comparison {
  const rows: CompareRow[] = inputs.map((i) => ({
    id: i.id,
    title: i.title,
    source: i.meta ? i.source : null,
    games: i.meta ? (num(i.meta.sample?.games) ?? null) : null,
    spread: i.meta ? cubeSpread(i.meta, opts).cards : null,
  }));
  const ok = rows.filter((r) => r.spread && r.spread.verdict !== 'unreadable');
  const pairs: Array<{ flat: CompareRow; lumpy: CompareRow; gap: number }> = [];
  for (const a of ok)
    for (const b of ok) {
      if (a === b) continue;
      const gap = b.spread!.trueSdCi[0] - a.spread!.trueSdCi[1];
      if (gap > 0) pairs.push({ flat: a, lumpy: b, gap });
    }
  pairs.sort((x, y) => y.gap - x.gap);
  const readings = pairs.map((p) => `${shortTitle(p.flat.title)} is flatter than ${shortTitle(p.lumpy.title)}.`);
  let caveat: string | null = null;
  if (ok.length < 2) caveat = 'Fewer than two cubes have enough lab data to compare.';
  else if (readings.length === 0)
    caveat =
      'The data can’t rank these cubes yet: every pair’s intervals overlap. That is the sample size talking; it does not show the cubes are equally flat.';
  return { rows, readings, caveat };
}

// ---------------------------------------------------------------------------
// Histogram for the page

export interface Histogram {
  lo: number;
  binWidth: number;
  /** Included units per bin. */
  bins: number[];
  /** What sampling noise alone would put in each bin if every unit were exactly average. */
  expected: number[];
  max: number;
}

/** Units per `binWidth` bin of shrunk rate, with the noise-only expectation (normal about the mean). */
export function histogram(s: SpreadStats, binWidth = 0.02): Histogram {
  const first = s.units[0]!.shrunk;
  const last = s.units[s.units.length - 1]!.shrunk;
  const lo = Math.floor(Math.min(first, s.meanRate - 3 * s.noiseSd) / binWidth) * binWidth;
  const hi = Math.ceil(Math.max(last, s.meanRate + 3 * s.noiseSd) / binWidth) * binWidth;
  const count = Math.max(1, Math.round((hi - lo) / binWidth));
  const bins = new Array<number>(count).fill(0);
  for (const u of s.units) bins[Math.min(count - 1, Math.max(0, Math.floor((u.shrunk - lo) / binWidth + 1e-9)))]!++;
  const cdf = (x: number) => 1 - normalTail((x - s.meanRate) / (s.noiseSd || 1e-9));
  const expected = bins.map((_, i) => s.n * (cdf(lo + (i + 1) * binWidth) - cdf(lo + i * binWidth)));
  return { lo, binWidth, bins, expected, max: Math.max(1, ...bins, ...expected) };
}
