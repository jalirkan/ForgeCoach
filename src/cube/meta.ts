/*
 * ForgeCoach — cube/meta.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The cube lab's per-cube meta (mtg-table's tools/cubelab, `meta.json`,
 * schema 1): what simulated two-player drafts and games say about each card,
 * archetype, card pair, land count and splash. Optional everywhere: the
 * builder and the pick helper work without it and lean on it when present.
 *
 *   {"schema":1,
 *    "cube":{"name","file","cards":[{"name","colors","mv","types","themes"}]},
 *    "sample":{"drafts","games","seedRange","aiProfile"},
 *    "cards":{"<name>":{"picked","seen","pickRate","avgPickIndex","inDecks","inclusionRate",
 *                       "games","wins","winRate","winRateShrunk","ci":[lo,hi]}},
 *    "archetypes":[{"id":"BR-SAC","colors":"BR","primaryTheme":"SAC","decks","games","winRate","ci",
 *                   "keyCards":[…],"avgLands","avgCurve":{"1":n,…,"6+":n},"sampleDecks":[[…]]}],
 *    "pairs":[{"a","b","games","winRateTogether","lift"}],
 *    "lands":{"overall":{"16":{"games","winRate"},…},"byArchetype":{"BR-SAC":{…}}},
 *    "splash":{"games","winRate","vsNoSplash"},
 *    "noise":{"sdEmpirical","archetypeSdEmpirical","minGames","archetypeMinGames","permutations","method"}}
 *
 * `colorBaselines` ({"R":{"games","wins"},…}) and a card's `early`
 * ({"picks","of","window"}) are optional schema-1 additions the pick screen's
 * lab panel reads when present (draft/labStats.ts); not yet written by the lab.
 *
 * `noise` is optional (added under schema 1, no version bump) and not yet
 * written by the lab: the spread of shrunk win rates that chance alone gives,
 * measured by a permutation null — re-randomise every game's winner by a fair
 * coin, keeping decks, pairings and match lengths, and take the mean SD of the
 * included units' shrunk rates over a few hundred runs. `sdEmpirical` is for
 * cards with `minGames`+ games (10 if absent), `archetypeSdEmpirical` for
 * archetypes with `archetypeMinGames`+ (5). cube/flatness.ts uses it in place
 * of its clumped-binomial noise formula when present.
 *
 * Rates are fractions (0.55 = 55 %). winRateShrunk is (wins + 20·mean) /
 * (games + 20), so a card seen in few games sits near the mean. A pair's lift
 * is a ratio: the pair's shrunk win rate together over the mean of the two
 * cards' shrunk win rates (1.06 = six per cent better together); parseMeta
 * adds `gain` = lift − 1 (an additive lift, |lift| < 0.5, is taken as the gain
 * itself). Samples are small: everything that reads the meta weights it by
 * its number of games.
 */
import { wubrg } from './colors.ts';

export interface MetaCubeCard {
  name: string;
  colors?: string | string[];
  mv?: number;
  types?: string | string[];
  themes?: string[];
}

export interface MetaCardStats {
  picked?: number;
  seen?: number;
  pickRate?: number;
  avgPickIndex?: number;
  inDecks?: number;
  inclusionRate?: number;
  games?: number;
  wins?: number;
  winRate?: number;
  winRateShrunk?: number;
  ci?: [number, number];
}

export interface MetaArchetype {
  id: string;
  colors: string;
  primaryTheme?: string;
  decks?: number;
  games?: number;
  winRate?: number;
  ci?: [number, number];
  keyCards?: string[];
  avgLands?: number;
  avgCurve?: Record<string, number>;
  sampleDecks?: string[][];
}

export interface MetaPair {
  a: string;
  b: string;
  games?: number;
  winRateTogether?: number;
  lift: number;
  /** Relative gain together: lift − 1 (added by parseMeta). */
  gain: number;
}

export interface LandStat {
  games: number;
  winRate: number;
}

/** The lab's permutation-null noise level (optional; see the header). */
export interface MetaNoise {
  sdEmpirical?: number;
  archetypeSdEmpirical?: number;
  minGames?: number;
  archetypeMinGames?: number;
  permutations?: number;
  method?: string;
}

export interface CubeMeta {
  schema: 1;
  cube: { name?: string; file?: string; cards?: MetaCubeCard[] };
  sample?: { drafts?: number; games?: number; seedRange?: unknown; aiProfile?: string };
  cards: Record<string, MetaCardStats>;
  archetypes: MetaArchetype[];
  pairs: MetaPair[];
  lands?: { overall?: Record<string, LandStat>; byArchetype?: Record<string, Record<string, LandStat>> };
  splash?: { games?: number; winRate?: number; vsNoSplash?: number };
  noise?: MetaNoise;
  /** Optional (schema-1 addition, not yet written by the lab): decisive games and wins of decks whose main colours include each colour (draft/labStats.ts). */
  colorBaselines?: Record<string, { games?: number; wins?: number }>;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Validates and normalises a parsed meta.json; throws an Error saying what is wrong. */
export function parseMeta(raw: unknown): CubeMeta {
  if (!isObj(raw)) throw new Error('meta.json is not a JSON object.');
  if (raw.schema !== 1) throw new Error(`meta.json schema ${String(raw.schema)} is not supported (this page reads schema 1).`);
  const cube = isObj(raw.cube) ? raw.cube : {};
  const cards: Record<string, MetaCardStats> = {};
  if (isObj(raw.cards)) for (const [k, v] of Object.entries(raw.cards)) if (isObj(v)) cards[k] = v as MetaCardStats;
  const archetypes: MetaArchetype[] = Array.isArray(raw.archetypes)
    ? raw.archetypes.filter(isObj).map((a) => ({ ...(a as unknown as MetaArchetype), colors: wubrg(String(a.colors ?? '')), id: String(a.id ?? a.colors ?? '') }))
    : [];
  const pairs: MetaPair[] = Array.isArray(raw.pairs)
    ? raw.pairs.filter((p): p is Record<string, unknown> => isObj(p) && typeof p.a === 'string' && typeof p.b === 'string' && typeof p.lift === 'number').map((p) => {
          const lift = p.lift as number;
          return { ...(p as unknown as MetaPair), gain: Math.abs(lift) < 0.5 ? lift : lift - 1 };
        })
    : [];
  const out: CubeMeta = {
    schema: 1,
    cube: { ...(cube as CubeMeta['cube']), cards: Array.isArray(cube.cards) ? (cube.cards.filter((c) => isObj(c) && typeof c.name === 'string') as MetaCubeCard[]) : [] },
    cards,
    archetypes,
    pairs,
  };
  if (isObj(raw.sample)) out.sample = raw.sample as CubeMeta['sample'];
  if (isObj(raw.lands)) out.lands = raw.lands as CubeMeta['lands'];
  if (isObj(raw.splash)) out.splash = raw.splash as CubeMeta['splash'];
  if (isObj(raw.noise)) out.noise = raw.noise as MetaNoise;
  if (isObj(raw.colorBaselines)) out.colorBaselines = raw.colorBaselines as CubeMeta['colorBaselines'];
  return out;
}

/** Does this meta describe the cube with this file / title? (Loose: a meta without a name matches anything.) */
export function metaMatchesCube(meta: CubeMeta, file: string, title: string): boolean {
  const f = meta.cube.file?.split('/').pop();
  if (f && f === file) return true;
  if (meta.cube.name && title && meta.cube.name.trim() === title.trim()) return true;
  return !f && !meta.cube.name;
}

/** Fast lookups over a meta. */
export interface MetaIndex {
  meta: CubeMeta;
  /** "A\u0000B" (sorted names) → pair. */
  pairs: Map<string, MetaPair>;
  /** Name → its pairs. */
  pairsOf: Map<string, MetaPair[]>;
}

export const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

export function indexMeta(meta: CubeMeta): MetaIndex {
  const pairs = new Map<string, MetaPair>();
  const pairsOf = new Map<string, MetaPair[]>();
  for (const p of meta.pairs) {
    pairs.set(pairKey(p.a, p.b), p);
    for (const n of [p.a, p.b]) {
      const l = pairsOf.get(n) ?? [];
      l.push(p);
      pairsOf.set(n, l);
    }
  }
  return { meta, pairs, pairsOf };
}

/** The meta archetype best matching a build: same colours, and the theme when given. */
export function findArchetype(meta: CubeMeta | null, colors: string, theme?: string | null): MetaArchetype | null {
  if (!meta) return null;
  const same = meta.archetypes.filter((a) => a.colors === wubrg(colors));
  if (same.length === 0) return null;
  const byTheme = theme ? same.find((a) => a.primaryTheme === theme) : undefined;
  if (byTheme) return byTheme;
  // Without a theme match, only a colours-only archetype ("UG", theme "none") speaks for the deck.
  const plain = same.filter((a) => !a.primaryTheme || a.primaryTheme === 'none');
  if (theme && !plain.length) return null;
  return [...(plain.length ? plain : same)].sort((a, b) => (b.games ?? 0) - (a.games ?? 0))[0] ?? null;
}
