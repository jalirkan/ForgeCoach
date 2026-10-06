/*
 * ForgeCoach — scripts/human-cards/blendTest.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The pure half of docs/human-blend.md's pre-registered split-half test:
 * Spearman rank correlation with average ranks, and a paired bootstrap over
 * cards of rho(score) − rho(baseline) against one target.
 */
import { rng } from '../../src/bench/benchStats.ts';

/** Ranks 1..n, ties sharing their average rank. */
export function ranks(xs: number[]): number[] {
  const idx = xs.map((_, i) => i).sort((a, b) => xs[a]! - xs[b]!);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && xs[idx[j + 1]!] === xs[idx[i]!]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k]!] = r;
    i = j + 1;
  }
  return out;
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i]!;
    mb += b[i]!;
  }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - ma;
    const db = b[i]! - mb;
    sab += da * db;
    saa += da * da;
    sbb += db * db;
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
}

/** Spearman's rho: the Pearson correlation of average ranks. */
export const spearman = (a: number[], b: number[]): number => pearson(ranks(a), ranks(b));

export interface PairedResult {
  n: number;
  rhoScore: number;
  rhoBase: number;
  diff: number;
  lo: number;
  hi: number;
}

/** rho(score, target) − rho(base, target), with a 95% percentile interval from a paired bootstrap over items. */
export function pairedBootstrap(target: number[], score: number[], base: number[], opts: { resamples?: number; seed?: number } = {}): PairedResult {
  const n = target.length;
  const R = opts.resamples ?? 10000;
  const r = rng(opts.seed ?? 20261006);
  const rhoScore = spearman(score, target);
  const rhoBase = spearman(base, target);
  const diffs: number[] = [];
  const t = new Array<number>(n);
  const s = new Array<number>(n);
  const b = new Array<number>(n);
  for (let k = 0; k < R; k++) {
    for (let i = 0; i < n; i++) {
      const j = Math.floor(r() * n);
      t[i] = target[j]!;
      s[i] = score[j]!;
      b[i] = base[j]!;
    }
    diffs.push(spearman(s, t) - spearman(b, t));
  }
  diffs.sort((x, y) => x - y);
  const q = (p: number) => diffs[Math.min(R - 1, Math.max(0, Math.floor(p * R)))]!;
  return { n, rhoScore, rhoBase, diff: rhoScore - rhoBase, lo: q(0.025), hi: q(0.975) };
}
