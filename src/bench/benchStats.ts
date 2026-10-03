/*
 * ForgeCoach — bench/benchStats.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The small statistics the coach bench needs: a Wilson interval for a
 * proportion, a seeded bootstrap interval for a mean over cases, and an exact
 * sign test. Pure and deterministic (the bootstrap uses a fixed seed), so the
 * same results file always gives the same report.
 */

export interface Interval {
  mean: number;
  lo: number;
  hi: number;
}

/** Normal quantile for a 95% interval. */
const Z95 = 1.959964;

/** Wilson score interval for `k` successes in `n` trials (95%). Null when n is 0. */
export function wilson(k: number, n: number, z = Z95): Interval | null {
  if (n <= 0) return null;
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { mean: p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

/** A small seeded generator (mulberry32), so bootstrap intervals are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * 95% percentile-bootstrap interval for the mean of `xs`, resampling the items
 * (the bench resamples cases, so repeats of one case are never treated as
 * independent evidence). Null for no items; a single item gives a zero-width interval.
 */
export function bootstrapMean(xs: number[], opts: { resamples?: number; seed?: number } = {}): Interval | null {
  const n = xs.length;
  if (!n) return null;
  const m = mean(xs);
  if (n === 1) return { mean: m, lo: m, hi: m };
  const B = opts.resamples ?? 2000;
  const rand = rng(opts.seed ?? 12345);
  const means: number[] = new Array(B);
  for (let b = 0; b < B; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += xs[Math.floor(rand() * n)]!;
    means[b] = s / n;
  }
  means.sort((a, b) => a - b);
  return { mean: m, lo: means[Math.floor(0.025 * B)]!, hi: means[Math.min(B - 1, Math.floor(0.975 * B))]! };
}

/** Exact two-sided sign test: p-value for `up` positive and `down` negative differences (ties dropped before). */
export function signTest(up: number, down: number): number {
  const n = up + down;
  if (n === 0) return 1;
  const k = Math.min(up, down);
  // P(X <= k) for X ~ Binomial(n, 1/2), summed with a running coefficient.
  let coef = 1;
  let sum = 0;
  for (let i = 0; i <= k; i++) {
    sum += coef;
    coef = (coef * (n - i)) / (i + 1);
  }
  return Math.min(1, (2 * sum) / 2 ** n);
}
