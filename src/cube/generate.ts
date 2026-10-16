/*
 * ForgeCoach — cube/generate.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The cube builder's quick start: a balanced cube drawn from the library,
 * a pure function of its options and seed (draft/rng.ts; never Math.random).
 *
 * The skeleton is the Omega Cube's 180, scaled to the size asked: two thirds
 * mono-coloured nonland cards split evenly over the five colours, 11 % gold
 * (even over the ten pairs), 10 % colourless nonland cards and 12 % lands —
 * for each pair the lands that make exactly that pair (2 a pair at 180), then
 * the best other lands. Inside every colour and the colourless cards the
 * nonland curve follows Omega's (3 / 24 / 32 / 34 / 30 / 17 / 11 / 7 at mana
 * value 0 to 6 and 7+), and at least 55 % of a colour's slots at each mana
 * value go to creatures when there are enough.
 *
 * Which card fills a slot: with `rating: 'lab'`, the lab's win rate shrunk
 * toward 50 % by its games (80 games weigh as much as the prior) plus a small
 * seeded nudge (±1.5 points), so seeds vary the edges and lab favourites stay;
 * with `rating: 'none'`, the seed alone. Forge-less and unvouched cards and
 * cards Forge's AI plays badly are left out unless asked for. Basic lands
 * never enter. Short buckets are filled from the best cards left.
 */
import { COLOURS, colourPairs } from './colors.ts';
import { bucketOf, isBasic, kindOf, mvBin, type Bucket, type Library, type LibraryCard } from './library.ts';
import { rng } from '../draft/rng.ts';

export interface GenerateOptions {
  size: number;
  seed: number;
  rating: 'lab' | 'none';
  /** Leave out the cards Forge lacks or that nobody vouched for (default true). */
  forgeOnly?: boolean;
  /** Leave out the cards Forge rates AI:RemoveDeck:All (default true). */
  avoidAiBad?: boolean;
  /** Draw only from these sources (cube or list ids); all when absent or empty. */
  sources?: string[];
}

export interface Generated {
  cards: string[];
  /** Buckets the library could not fill, and how many were filled from elsewhere. */
  notes: string[];
}

export const OMEGA_CURVE = [3, 24, 32, 34, 30, 17, 11, 7];
const SHARE = { mono: 120 / 180, gold: 20 / 180, colorless: 18 / 180, lands: 22 / 180 };
export const LAB_PRIOR_GAMES = 80;
const CREATURE_SHARE = 0.55;

/** Splits `n` by weights, largest remainders first (ties to the earlier slot), summing exactly to `n`. */
export function apportion(n: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || n <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (n * w) / total);
  const out = raw.map(Math.floor);
  let left = n - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i]!++;
    left--;
  }
  return out;
}

/** The skeleton's bucket counts for a size. */
export function skeleton(size: number): { mono: number[]; gold: number; colorless: number; lands: number; pairLands: number } {
  const [monoAll = 0, gold = 0, colorless = 0, lands = 0] = apportion(size, [SHARE.mono, SHARE.gold, SHARE.colorless, SHARE.lands]);
  return { mono: apportion(monoAll, [1, 1, 1, 1, 1]), gold, colorless, lands, pairLands: Math.floor((lands * (20 / 22)) / 10) };
}

export function generateCube(lib: Library, o: GenerateOptions): Generated {
  const size = Math.max(0, Math.min(1000, Math.floor(o.size)));
  const r = rng(o.seed, 'cube-builder');
  const forgeOnly = o.forgeOnly ?? true;
  const avoid = o.avoidAiBad ?? true;
  const from = o.sources?.length ? new Set(o.sources) : null;
  const score = new Map<string, number>();
  // One draw per card in the library's order, so a card's nudge never depends on the filters.
  for (const c of lib.cards) {
    const x = r.next();
    if (o.rating === 'lab') {
      const g = c.lab?.games ?? 0;
      const wr = c.lab?.winRate ?? 0.5;
      score.set(c.name, (g * wr + LAB_PRIOR_GAMES * 0.5) / (g + LAB_PRIOR_GAMES) + 0.03 * (x - 0.5));
    } else score.set(c.name, x);
  }
  const pool = lib.cards.filter((c) => !isBasic(c) && !(forgeOnly && c.forge !== undefined) && !(avoid && c.ai === 'All') && (!from || c.sources.some((s) => from.has(s))));
  const byScore = (a: LibraryCard, b: LibraryCard) => (score.get(b.name) ?? 0) - (score.get(a.name) ?? 0) || a.name.localeCompare(b.name);
  pool.sort(byScore);

  const taken = new Set<string>();
  const out: string[] = [];
  const notes: string[] = [];
  const take = (c: LibraryCard) => {
    if (taken.has(c.name)) return false;
    taken.add(c.name);
    out.push(c.name);
    return true;
  };
  const inBucket = (b: Bucket) => pool.filter((c) => bucketOf(c) === b);

  /** n cards from `cands` on Omega's curve (creatures first up to their share when `creatures`), then the best left. */
  const fillCurve = (cands: LibraryCard[], n: number, creatures: boolean): number => {
    const bins = apportion(n, OMEGA_CURVE);
    let got = 0;
    for (let bin = 0; bin < 8; bin++) {
      const want = bins[bin] ?? 0;
      const here = cands.filter((c) => !taken.has(c.name) && mvBin(c.mv) === bin);
      let k = 0;
      if (creatures) {
        const q = Math.round(want * CREATURE_SHARE);
        for (const c of here) if (k < q && kindOf(c) === 'creature' && take(c)) k++;
      }
      for (const c of here) if (k < want && take(c)) k++;
      got += k;
    }
    for (const c of cands) if (got < n && take(c)) got++;
    return got;
  };
  const fillTop = (cands: LibraryCard[], n: number): number => {
    let got = 0;
    for (const c of cands) if (got < n && take(c)) got++;
    return got;
  };

  const sk = skeleton(size);
  const short: string[] = [];
  COLOURS.forEach((col, i) => {
    const n = sk.mono[i] ?? 0;
    const got = fillCurve(inBucket(col), n, true);
    if (got < n) short.push(`${col} ${got}/${n}`);
  });
  const gold = inBucket('gold');
  const pairs = colourPairs();
  const perPair = apportion(sk.gold, pairs.map(() => 1));
  let goldGot = 0;
  pairs.forEach((p, i) => {
    goldGot += fillTop(
      gold.filter((c) => c.colors === p),
      perPair[i] ?? 0,
    );
  });
  // A pair with too few gold cards: the best gold cards left, three colours and more included.
  goldGot += fillTop(gold, sk.gold - goldGot);
  if (goldGot < sk.gold) short.push(`gold ${goldGot}/${sk.gold}`);
  const cl = fillCurve(inBucket('colorless'), sk.colorless, false);
  if (cl < sk.colorless) short.push(`colorless ${cl}/${sk.colorless}`);
  const lands = inBucket('land');
  let landGot = 0;
  for (const p of pairs) landGot += fillTop(lands.filter((c) => (c.produces ?? '') === p), sk.pairLands);
  landGot += fillTop(lands, sk.lands - landGot);
  if (landGot < sk.lands) short.push(`lands ${landGot}/${sk.lands}`);

  if (out.length < size) {
    const before = out.length;
    fillTop(pool, size - out.length);
    if (short.length) notes.push(`The library ran short (${short.join(', ')}): ${out.length - before} filled from the best cards left.`);
  }
  if (out.length < size) notes.push(`Only ${out.length} cards fit the options.`);
  return { cards: out, notes };
}
