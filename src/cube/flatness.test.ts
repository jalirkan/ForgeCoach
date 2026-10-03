// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { compareCubes, cubeSpread, FLAT_SD, normalTail, readSpread, spreadOf, type SpreadUnit } from './flatness.ts';
import { rng, loadRealMeta } from './testdata/load.ts';
import { parseMeta, type CubeMeta } from './meta.ts';
import { shrinkRate } from './metaView.ts';

const K = 20;

/** A synthetic meta: `n` cards of `games` games each, true rates θ_i + binomial noise (or exactly `wins` when given). */
function synthMeta(opts: { n: number; games: number; truth: (i: number) => number; seed: number; noisy?: boolean; name?: string }): CubeMeta {
  const r = rng(opts.seed);
  const cards: Record<string, unknown> = {};
  let tw = 0;
  let tg = 0;
  const raw: Array<{ name: string; games: number; wins: number }> = [];
  for (let i = 0; i < opts.n; i++) {
    const th = opts.truth(i);
    let wins = 0;
    if (opts.noisy === false) wins = Math.round(th * opts.games);
    else for (let g = 0; g < opts.games; g++) if (r() < th) wins++;
    raw.push({ name: `C${i}`, games: opts.games, wins });
    tw += wins;
    tg += opts.games;
  }
  const mean = tw / tg;
  for (const c of raw) {
    const wr = c.wins / c.games;
    const p = (wr * 1 + 0) || 0;
    void p;
    cards[c.name] = {
      games: c.games,
      wins: c.wins,
      winRate: wr,
      winRateShrunk: shrinkRate(wr, c.games, K, mean),
      ci: [Math.max(0, wr - 1.96 * Math.sqrt((wr * (1 - wr)) / c.games)), Math.min(1, wr + 1.96 * Math.sqrt((wr * (1 - wr)) / c.games))],
    };
  }
  return parseMeta({
    schema: 1,
    cube: { name: opts.name ?? 'Synth' },
    sample: { games: 100, shrinkage: { prior: 'beta', mean, strength: K } },
    cards,
    archetypes: [],
    pairs: [],
  });
}

describe('normalTail', () => {
  it('matches the normal distribution', () => {
    expect(normalTail(0)).toBeCloseTo(0.5, 6);
    expect(normalTail(1.96)).toBeCloseTo(0.025, 3);
    expect(normalTail(-1)).toBeCloseTo(0.8413, 3);
  });
});

describe('spread of a flat cube measured with noise', () => {
  const meta = synthMeta({ n: 180, games: 30, truth: () => 0.5, seed: 7 });
  const s = cubeSpread(meta).cards!;
  it('sees spread that noise explains, and estimates a true spread near zero', () => {
    expect(s.n).toBe(180);
    expect(s.sd).toBeGreaterThan(0.02); // visible spread...
    expect(s.sd).toBeCloseTo(s.noiseSd, 1); // ...equal to what noise alone gives
    expect(s.sd / s.noiseSd).toBeGreaterThan(0.8);
    expect(s.sd / s.noiseSd).toBeLessThan(1.2);
    expect(s.trueSd).toBeLessThan(0.025);
    expect(s.trueSdCi[0]).toBe(0);
    expect(s.aboveShare).toBeCloseTo(s.noiseAboveShare, 1);
  });
  it('does not call the cube uneven, and says so plainly', () => {
    expect(['flat', 'unclear']).toContain(s.verdict);
    expect(s.clearCount).toBeLessThanOrEqual(Math.ceil(s.clearByChance * 3));
  });
});

describe('spread of an uneven cube', () => {
  // True rates spread uniformly over 0.35–0.65: SD 0.0866.
  const meta = synthMeta({ n: 180, games: 60, truth: (i) => 0.35 + (0.3 * i) / 179, seed: 11 });
  const s = cubeSpread(meta).cards!;
  it('recovers the true spread through the noise correction', () => {
    expect(s.sd).toBeLessThan(0.0866); // shrinkage compresses the observed spread
    expect(s.trueSd).toBeGreaterThan(0.07);
    expect(s.trueSd).toBeLessThan(0.1);
    expect(s.trueSdCi[0]).toBeGreaterThan(FLAT_SD);
    expect(s.verdict).toBe('uneven');
    expect(s.aboveShare).toBeGreaterThan(s.noiseAboveShare + 0.1);
  });
  it('lists the outliers at both ends with intervals, marking those clear of the mean', () => {
    const top = s.outliers[0]!;
    expect(Math.abs(top.dev)).toBeGreaterThan(0.08);
    expect(top.ci).not.toBeNull();
    expect(top.clear).toBe(true);
    expect(new Set(s.outliers.map((o) => Math.sign(o.dev))).size).toBeGreaterThanOrEqual(1);
  });
});

describe('the noise correction', () => {
  it('turns more games into the same true spread with a narrower interval', () => {
    const truth = (i: number) => 0.4 + (0.2 * i) / 119;
    const thin = cubeSpread(synthMeta({ n: 120, games: 12, truth, seed: 3 })).cards!;
    const thick = cubeSpread(synthMeta({ n: 120, games: 120, truth, seed: 3 })).cards!;
    expect(thick.trueSd).toBeGreaterThan(0.04);
    expect(thick.trueSd).toBeLessThan(0.075);
    expect(thick.noiseSd).toBeLessThan(thin.noiseSd);
    const w = (s: typeof thin) => s.trueSdCi[1] - s.trueSdCi[0];
    expect(w(thick)).toBeLessThan(w(thin));
  });
  it('floors the excess variance at zero when the observed spread is below noise', () => {
    // Every card lands on exactly 50 %: observed SD 0, noise SD > 0.
    const units: SpreadUnit[] = Array.from({ length: 40 }, (_, i) => ({ name: `C${i}`, games: 20, wins: 10, shrunk: 0.5, ci: [0.3, 0.7] }));
    const s = spreadOf(units, { minGames: 10, priorMean: 0.5, priorStrength: K })!;
    expect(s.sd).toBe(0);
    expect(s.noiseSd).toBeGreaterThan(0.03);
    expect(s.excessVar).toBe(0);
    expect(s.trueSd).toBe(0);
    expect(s.verdict).toBe('flat');
  });
  it('computes noise from the binomial at each card’s game count', () => {
    const units: SpreadUnit[] = [{ name: 'A', games: 20, wins: 10, shrunk: 0.5, ci: null }, ...Array.from({ length: 19 }, (_, i) => ({ name: `B${i}`, games: 20, wins: 10, shrunk: 0.5, ci: null }))];
    const s = spreadOf(units, { minGames: 1, priorMean: 0.5, priorStrength: K })!;
    // sqrt(g·m(1−m)) / (g+k) = sqrt(5)/40
    expect(s.noiseSd).toBeCloseTo(Math.sqrt(5) / 40, 10);
  });
});

describe('inclusion and thin data', () => {
  it('uses only cards with enough games', () => {
    const meta = synthMeta({ n: 30, games: 30, truth: () => 0.5, seed: 1 });
    (meta.cards['C0'] as { games: number }).games = 3;
    (meta.cards['C1'] as { games: number }).games = 0;
    const s = cubeSpread(meta).cards!;
    expect(s.total).toBe(29);
    expect(s.n).toBe(28);
    expect(s.units.find((u) => u.name === 'C0')).toBeUndefined();
  });
  it('gives no verdict on a handful of cards and no stats on none', () => {
    const few = cubeSpread(synthMeta({ n: 5, games: 40, truth: () => 0.5, seed: 2 })).cards!;
    expect(few.verdict).toBe('unreadable');
    expect(readSpread(few)[0]).toMatch(/too few/);
    expect(cubeSpread(synthMeta({ n: 0, games: 40, truth: () => 0.5, seed: 2 })).cards).toBeNull();
    expect(readSpread(null)[0]).toMatch(/No card/);
  });
  it('is deterministic', () => {
    const meta = synthMeta({ n: 60, games: 20, truth: () => 0.5, seed: 9 });
    expect(cubeSpread(meta).cards!.trueSdCi).toEqual(cubeSpread(meta).cards!.trueSdCi);
  });
  it('says plainly when the data cannot tell', () => {
    const s = cubeSpread(synthMeta({ n: 60, games: 12, truth: (i) => 0.45 + (0.1 * i) / 59, seed: 5 })).cards!;
    expect(s.verdict).toBe('unclear');
    expect(readSpread(s).join(' ')).toMatch(/cannot tell this cube from a perfectly flat one/);
  });
});

describe('archetype spread', () => {
  it('measures archetypes with enough games', () => {
    const meta = synthMeta({ n: 20, games: 30, truth: () => 0.5, seed: 4 });
    meta.archetypes = Array.from({ length: 14 }, (_, i) => ({ id: `A${i}`, colors: 'WU', games: i < 12 ? 30 : 2, winRate: 0.4 + 0.2 * (i / 13), ci: [0.2, 0.8] as [number, number] }));
    const a = cubeSpread(meta).archetypes!;
    expect(a.n).toBe(12);
    expect(a.sd).toBeGreaterThan(0);
  });
});

describe('comparing cubes', () => {
  const flat = synthMeta({ n: 180, games: 80, truth: () => 0.5, seed: 21, name: 'Fair Fight Cube' });
  const lumpy = synthMeta({ n: 180, games: 80, truth: (i) => 0.3 + (0.4 * i) / 179, seed: 22, name: 'Vintage Cube' });
  const alsoFlat = synthMeta({ n: 180, games: 80, truth: () => 0.5, seed: 23 });
  const inputs = (m: Array<CubeMeta | null>) =>
    ['Fair Fight Cube', 'Vintage Cube', 'Pauper Cube'].map((title, i) => ({ id: title, title, meta: m[i] ?? null, source: m[i] ? ('shipped' as const) : null }));
  it('says one cube is flatter only when the intervals are apart', () => {
    const c = compareCubes(inputs([flat, lumpy, null]));
    expect(c.readings).toEqual(['Fair Fight is flatter than Vintage.']);
    expect(c.rows[2]!.spread).toBeNull();
  });
  it('makes no ranking between two flat cubes', () => {
    const c = compareCubes(inputs([flat, alsoFlat, null]));
    expect(c.readings).toEqual([]);
    expect(c.caveat).toMatch(/can’t rank/);
  });
  it('needs two cubes with data', () => {
    expect(compareCubes(inputs([flat, null, null])).caveat).toMatch(/Fewer than two/);
  });
});

describe('the shipped data', () => {
  it('is too thin to separate the cubes', () => {
    const rows = compareCubes(['synergy', 'modern-era', 'vintage', 'pauper'].map((id) => ({ id, title: id, meta: loadRealMeta(id as 'synergy'), source: 'shipped' as const })));
    for (const r of rows.rows) {
      expect(r.spread).not.toBeNull();
      expect(r.spread!.trueSdCi[1]).toBeGreaterThan(r.spread!.trueSdCi[0]);
    }
  });
});
