// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  compareCubes,
  cubeSpread,
  DEFAULT_DESIGN_EFFECT,
  designEffectOf,
  FLAT_SD,
  MATCH_ICC,
  normalTail,
  readSpread,
  spreadOf,
  type SpreadUnit,
} from './flatness.ts';
import { rng, loadRealMeta } from './testdata/load.ts';
import { parseMeta, type CubeMeta } from './meta.ts';
import { shrinkRate } from './metaView.ts';

const K = 20;

/**
 * A synthetic meta: `n` cards of `games` games each, true rates θ_i + binomial noise (or exactly `wins` when given).
 * Every game here is independent, so each is its own clump (inDecks = games, design effect 1).
 */
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
      inDecks: c.games,
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
  it('computes noise from the binomial at each card’s game count, times its design effect', () => {
    const unit = (name: string, clumps: number | null): SpreadUnit => ({ name, games: 20, wins: 10, shrunk: 0.5, ci: null, clumps });
    // Independent games (one game per clump): sqrt(g·m(1−m)) / (g+k) = sqrt(5)/40.
    const indep = spreadOf(Array.from({ length: 20 }, (_, i) => unit(`A${i}`, 20)), { minGames: 1, priorMean: 0.5, priorStrength: K })!;
    expect(indep.noiseSd).toBeCloseTo(Math.sqrt(5) / 40, 10);
    expect(indep.binomialNoiseSd).toBeCloseTo(Math.sqrt(5) / 40, 10);
    expect(indep.designEffect).toBeCloseTo(1, 10);
    // 20 games in 8 matches: DE = 1 + (2.5 − 1)·ρ.
    const clumped = spreadOf(Array.from({ length: 20 }, (_, i) => unit(`B${i}`, 8)), { minGames: 1, priorMean: 0.5, priorStrength: K })!;
    expect(clumped.designEffect).toBeCloseTo(1 + 1.5 * MATCH_ICC, 10);
    expect(clumped.noiseSd).toBeCloseTo((Math.sqrt(5) / 40) * Math.sqrt(1 + 1.5 * MATCH_ICC), 10);
    expect(clumped.noiseSource).toBe('clumps');
    // No clump counts: the documented default.
    const unknown = spreadOf(Array.from({ length: 20 }, (_, i) => unit(`C${i}`, null)), { minGames: 1, priorMean: 0.5, priorStrength: K })!;
    expect(unknown.designEffect).toBeCloseTo(DEFAULT_DESIGN_EFFECT, 10);
    expect(unknown.noiseSource).toBe('default');
    expect(readSpread(unknown).join(' ')).toMatch(/design effect 1\.50×/);
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

describe('design effect', () => {
  it('is 1 + (games per match − 1)·ρ, and the default without a match count', () => {
    expect(designEffectOf(24, 10)).toBeCloseTo(1 + 1.4 * MATCH_ICC, 12);
    expect(designEffectOf(30, 30)).toBe(1);
    expect(designEffectOf(30, null)).toBe(DEFAULT_DESIGN_EFFECT);
    expect(designEffectOf(30, 0)).toBe(DEFAULT_DESIGN_EFFECT);
    // ~2.4 games per match, as in the lab: about 1.5.
    expect(designEffectOf(24, 10)).toBeGreaterThan(1.45);
    expect(designEffectOf(24, 10)).toBeLessThan(1.55);
  });

  /** A flat cube whose games come in matches of 2–3 sharing one matchup p ∈ {0.5 ± a} (within-match correlation a²/0.25). */
  function clumpedFlat(seed: number, a: number) {
    const r = rng(seed);
    const cards: Record<string, unknown> = {};
    for (let i = 0; i < 180; i++) {
      let games = 0;
      let wins = 0;
      const matches = 12;
      for (let j = 0; j < matches; j++) {
        const p = r() < 0.5 ? 0.5 - a : 0.5 + a;
        const len = r() < 0.4 ? 3 : 2;
        for (let g = 0; g < len; g++) if (r() < p) wins++;
        games += len;
      }
      cards[`C${i}`] = { games, wins, inDecks: matches, winRate: wins / games, winRateShrunk: shrinkRate(wins / games, games, K, 0.5) };
    }
    return parseMeta({ schema: 1, cube: {}, sample: { shrinkage: { prior: 'beta', mean: 0.5, strength: K } }, cards, archetypes: [], pairs: [] });
  }

  it('a flat cube with clumped games looks uneven if games are taken as independent, and not with the clumps counted', () => {
    // a = 0.296: correlation 0.35 = MATCH_ICC, so the clump model is right here.
    const meta = clumpedFlat(31, 0.296);
    const naive = cubeSpread(meta, { designEffect: 1 }).cards!;
    const clumped = cubeSpread(meta).cards!;
    expect(naive.verdict).toBe('uneven');
    expect(clumped.noiseSource).toBe('clumps');
    expect(clumped.designEffect).toBeGreaterThan(1.4);
    expect(clumped.verdict).not.toBe('uneven');
    expect(clumped.trueSdCi[0]).toBeLessThanOrEqual(FLAT_SD);
    expect(clumped.sd / clumped.noiseSd).toBeGreaterThan(0.85);
    expect(clumped.sd / clumped.noiseSd).toBeLessThan(1.15);
  });

  it('an assumed design effect widens the interval but cannot make a cube flat', () => {
    // Observed spread a little above the independent-games noise but below the clumped noise.
    const meta = synthMeta({ n: 120, games: 30, truth: (i) => 0.47 + (0.06 * i) / 119, seed: 13 });
    for (const c of Object.values(meta.cards)) (c as { inDecks?: number }).inDecks = 12;
    const s = cubeSpread(meta).cards!;
    const indep = cubeSpread(meta, { designEffect: 1 }).cards!;
    expect(s.trueSdCi[1]).toBeCloseTo(indep.trueSdCi[1], 12);
    expect(s.trueSdCi[0]).toBeLessThanOrEqual(indep.trueSdCi[0]);
    expect(s.verdict).not.toBe('flat');
  });

  it('uses the lab’s empirical noise SD when meta.json has one', () => {
    const meta = synthMeta({ n: 120, games: 40, truth: () => 0.5, seed: 17 });
    const plain = cubeSpread(meta).cards!;
    const withNoise = parseMeta({ ...meta, noise: { sdEmpirical: plain.binomialNoiseSd * 1.3, permutations: 400 } });
    const s = cubeSpread(withNoise).cards!;
    expect(s.noiseSource).toBe('empirical');
    expect(s.noiseSd).toBeCloseTo(plain.binomialNoiseSd * 1.3, 12);
    expect(s.designEffect).toBeCloseTo(1.69, 6);
    expect(readSpread(s).join(' ')).toMatch(/permutation null/);
    // Measured, so it sets both ends of the interval.
    expect(s.trueSd).toBeCloseTo(Math.sqrt(Math.max(0, s.sd ** 2 - s.noiseSd ** 2)) / (40 / 60), 9);
    // Computed over a different inclusion rule: not used.
    const other = cubeSpread(parseMeta({ ...meta, noise: { sdEmpirical: 0.2, minGames: 25 } })).cards!;
    expect(other.noiseSource).not.toBe('empirical');
    // A forced design effect overrides it.
    expect(cubeSpread(withNoise, { designEffect: 1 }).cards!.noiseSource).toBe('default');
  });

  it('says “can’t tell” when the interval excludes zero but still holds flat values', () => {
    const units: SpreadUnit[] = Array.from({ length: 200 }, (_, i) => ({ name: `C${i}`, games: 2000, wins: 1000, shrunk: 0.5 + 0.03 * ((i % 2) * 2 - 1), ci: null, clumps: 2000 }));
    const s = spreadOf(units, { minGames: 10, priorMean: 0.5, priorStrength: K })!;
    expect(s.trueSdCi[0]).toBeGreaterThan(0);
    expect(s.trueSdCi[0]).toBeLessThanOrEqual(FLAT_SD);
    expect(s.verdict).toBe('unclear');
    expect(readSpread(s).join(' ')).toMatch(/Can’t tell: noise does not explain all/);
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
  it('tells all four shipped cubes from flat (J075: thousands of drafts, one game per deck)', () => {
    // The metas before J075 (20–40 drafts, ~2.4 games per deck in Bo3 clumps)
    // could not tell any cube from flat: design effect ~1.5, true-SD interval
    // starting at 0. J075 (mtg-table D380) plays 5,000–8,000 drafts per cube,
    // one game per deck, so a card's games equal its decks: no clumping
    // (design effect 1.00) and an interval wholly above FLAT_SD for every cube.
    for (const id of ['synergy', 'modern-era', 'vintage', 'pauper'] as const) {
      const s = cubeSpread(loadRealMeta(id)).cards!;
      expect(s.noiseSource).toBe('clumps');
      expect(s.designEffect).toBeGreaterThanOrEqual(1);
      expect(s.designEffect).toBeLessThan(1.01);
      expect(s.verdict).toBe('uneven');
      expect(s.trueSdCi[0]).toBeGreaterThan(FLAT_SD);
      expect(readSpread(s).join(' ')).toMatch(/design effect 1\.00×/);
      // With one game per clump, forcing independent games changes nothing.
      expect(cubeSpread(loadRealMeta(id), { designEffect: 1 }).cards!.verdict).toBe('uneven');
    }
  });
  it('separates the cubes: synergy is the most uneven, and the readings say only what the intervals allow', () => {
    // Card true SD (95% interval), J075: synergy 8.9 [8.0, 10.0], modern-era
    // 5.4 [4.8, 6.2], pauper 4.0 [3.4, 4.6], vintage 3.7 [3.1, 4.3]. Pauper
    // and vintage overlap, so no reading ranks them against each other.
    const c = compareCubes(['synergy', 'modern-era', 'vintage', 'pauper'].map((id) => ({ id, title: id, meta: loadRealMeta(id as 'synergy'), source: 'shipped' as const })));
    for (const r of c.rows) {
      expect(r.spread).not.toBeNull();
      expect(r.spread!.trueSdCi[1]).toBeGreaterThan(r.spread!.trueSdCi[0]);
    }
    expect([...c.readings].sort()).toEqual(
      [
        'modern-era is flatter than synergy.',
        'pauper is flatter than modern-era.',
        'pauper is flatter than synergy.',
        'vintage is flatter than modern-era.',
        'vintage is flatter than synergy.',
      ].sort(),
    );
    expect(c.readings.join(' ')).not.toMatch(/(pauper is flatter than vintage|vintage is flatter than pauper)/);
  });
});
