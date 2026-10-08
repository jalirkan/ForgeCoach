/*
 * ForgeCoach — scripts/human-cards/blendTest.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import { bootstrapRho, pairedBootstrap, ranks, spearman } from './blendTest.ts';

describe('ranks and spearman', () => {
  it('gives ties their average rank', () => {
    expect(ranks([10, 20, 20, 5])).toEqual([2, 3.5, 3.5, 1]);
  });
  it('is 1 for any increasing map, −1 for a decreasing one', () => {
    expect(spearman([1, 2, 3, 4], [1, 4, 9, 100])).toBeCloseTo(1, 12);
    expect(spearman([1, 2, 3, 4], [9, 7, 2, 0])).toBeCloseTo(-1, 12);
    expect(spearman([1, 2, 3], [5, 5, 5])).toBe(0);
  });
});

describe('pairedBootstrap', () => {
  const target = Array.from({ length: 60 }, (_, i) => i + ((i * 7) % 5));
  const good = target.map((t, i) => t + ((i * 13) % 7));
  const poor = target.map((_, i) => (i * 37) % 60);

  it('is reproducible with a seed and brackets the point difference', () => {
    const a = pairedBootstrap(target, good, poor, { resamples: 2000, seed: 1 });
    const b = pairedBootstrap(target, good, poor, { resamples: 2000, seed: 1 });
    expect(a).toEqual(b);
    expect(a.n).toBe(60);
    expect(a.diff).toBeCloseTo(a.rhoScore - a.rhoBase, 12);
    expect(a.lo).toBeLessThanOrEqual(a.diff);
    expect(a.hi).toBeGreaterThanOrEqual(a.diff);
    expect(a.lo).toBeGreaterThan(0);
  });

  it('a score against itself differs by exactly 0', () => {
    const r = pairedBootstrap(target, good, good, { resamples: 500 });
    expect([r.diff, r.lo, r.hi]).toEqual([0, 0, 0]);
  });
});

describe('bootstrapRho', () => {
  it('brackets the sample rho and is reproducible by seed', () => {
    const a = Array.from({ length: 50 }, (_, i) => i);
    const b = a.map((i) => i + ((i * 13) % 17));
    const r = bootstrapRho(a, b, { resamples: 500 });
    expect(r.n).toBe(50);
    expect(r.lo).toBeLessThanOrEqual(r.rho);
    expect(r.hi).toBeGreaterThanOrEqual(r.rho);
    expect(bootstrapRho(a, b, { resamples: 500 })).toEqual(r);
  });
});
