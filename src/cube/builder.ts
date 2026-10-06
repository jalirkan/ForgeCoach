/*
 * ForgeCoach — cube/builder.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The best 40 a drafted pool makes. Every colour pair is tried, alone and with
 * each splash colour the pool has fixing for. For each, the spells (22–24) are
 * chosen to maximise one deck score, greedily and then by swapping cards in and
 * out until no single swap helps:
 *
 *   quality      mean card value (meta win rate blended with the prior)
 *   synergy      mean synergy: theme overlap with the deck's top themes + meta pair lift
 *   curve        −0.8 per card away from the target curve (meta archetype avgCurve, else 3/6/5/4/3/2)
 *   playables    −2 per spell under value 42
 *   creatures    −1.2 per creature short of 12 (8 for a spells/control deck)
 *   interaction  +1.2 per removal or counterspell, up to 6
 *   splash       −2.5 per splash card (more when the meta says splashes lose)
 *   archetype    the meta archetype's win rate, ±6 at most
 *
 * Lands: the meta's best land count for the archetype (16 or 17; else 17, or
 * 16 with a low curve); on-colour duals and fetches from the pool; basics
 * split by colour pips, early drops weighted double.
 *
 * Thin pools (Justin's rule): when no colour pair reaches 23 castable spells
 * (a splash included), two more kinds of build compete with the short ones —
 * 22 spells and 18 lands in two colours, or three full colours (17 or 18
 * lands; the third colour needs at least one dual or fixer in the pool, and
 * each card of it costs 1 point). Such builds carry `thin`.
 * Deterministic: ties break by name.
 */
import { BASIC_OF, BASIC_NAMES, COLOURS, colourLabel, colourPairs, type Colour } from './colors.ts';
import { castableIn, splashColourOf } from './facts.ts';
import { findArchetype, type LandStat, type MetaArchetype } from './meta.ts';
import { cardValue, humanValueNote, isInteraction, metaValue, pairsAmong, pct, synergyOf, themeCountsOf, topThemes, type CubeContext } from './score.ts';

export const DECK_SIZE = 40;
export const DEFAULT_CURVE = [3, 6, 5, 4, 3, 2];
export const CURVE_LABELS = ['1', '2', '3', '4', '5', '6+'];
export const PLAYABLE = 42;
/** A card is worth splashing only at this value or more. */
export const SPLASH_MIN = 62;
export const bucketOf = (mv: number): number => Math.min(5, Math.max(0, mv - 1));

export type SpellCount = 'auto' | 22 | 23 | 24;

export interface BuildOptions {
  spells?: SpellCount;
  maxSplash?: number;
}

export interface ScoreParts {
  quality: number;
  synergy: number;
  curve: number;
  playables: number;
  creatures: number;
  interaction: number;
  splash: number;
  archetype: number;
  missing: number;
}

export const PART_LABEL: Record<keyof ScoreParts, string> = {
  quality: 'Card quality',
  synergy: 'Synergy',
  curve: 'Curve',
  playables: 'Weak cards',
  creatures: 'Creature count',
  interaction: 'Interaction',
  splash: 'Splash',
  archetype: 'Archetype',
  missing: 'Missing spells',
};

export type ThinKind = 'eighteen' | 'three';

export interface DeckBuild {
  /** colors + ('+' splash) + ('/18' for 18 lands): identifies the build. */
  key: string;
  colors: string;
  splash: string | null;
  name: string;
  /** The meta archetype it matches, if any. */
  metaArchetype: string | null;
  /** Spells, by mana value then name. */
  spells: string[];
  nonbasics: string[];
  basics: Partial<Record<Colour, number>>;
  landCount: number;
  /** Spells short of the target (an early pool): the deck is not a legal 40. */
  missing: number;
  score: number;
  parts: ScoreParts;
  themes: Array<[string, number]>;
  curve: number[];
  curveTarget: number[];
  creatures: number;
  interaction: number;
  avgMv: number;
  splashCards: string[];
  pairs: Array<{ a: string; b: string; lift: number; games: number }>;
  reasons: string[];
  cuts: Array<{ name: string; reason: string }>;
  landNote: string;
  /** A thin-pool build: 22 spells with 18 lands, or three full colours. */
  thin: ThinKind | null;
}

interface Env {
  colors: string;
  splash: string | null;
  n: number;
  target: number[];
  splashPenalty: number;
  arch: MetaArchetype | null;
  /** Three-colour builds: the third colour (each of its cards costs a point). */
  third?: string | null;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function curveOf(spells: string[], ctx: CubeContext): number[] {
  const c = [0, 0, 0, 0, 0, 0];
  for (const s of spells) {
    const b = bucketOf(ctx.facts.get(s)?.mv ?? 3);
    c[b] = (c[b] ?? 0) + 1;
  }
  return c;
}

/** The target curve for `n` spells: the meta archetype's average curve, else the default. */
export function curveTarget(n: number, arch: MetaArchetype | null): number[] {
  let base = DEFAULT_CURVE;
  if (arch?.avgCurve) {
    const c = arch.avgCurve;
    const v = [(c['0'] ?? 0) + (c['1'] ?? 0), c['2'] ?? 0, c['3'] ?? 0, c['4'] ?? 0, c['5'] ?? 0, (c['6+'] ?? 0) + (c['6'] ?? 0) + (c['7'] ?? 0)];
    if (v.reduce((s, x) => s + x, 0) > 0) base = v;
  }
  const sum = base.reduce((s, x) => s + x, 0);
  return base.map((x) => (x * n) / sum);
}

/** Per splash card: 2.5, plus the meta's splash deficit weighted by its games. */
export function splashPenaltyOf(ctx: CubeContext): number {
  const sp = ctx.meta?.meta.splash;
  if (!sp || typeof sp.vsNoSplash !== 'number') return 2.5;
  const g = sp.games ?? 0;
  return 2.5 + Math.max(0, -sp.vsNoSplash * 100 * 0.3 * (g / (g + 40)));
}

function minCreatures(top: Array<[string, number]>): number {
  const t = top[0]?.[0];
  return t === 'SPL' || t === 'CTRL' ? 8 : 12;
}

/** The deck score of a spell list (the objective the builder maximises). */
export function scoreSpells(spells: string[], env: Env, ctx: CubeContext): { score: number; parts: ScoreParts; themes: Array<[string, number]> } {
  const n = spells.length;
  const parts: ScoreParts = { quality: 0, synergy: 0, curve: 0, playables: 0, creatures: 0, interaction: 0, splash: 0, archetype: 0, missing: 0 };
  if (n === 0) return { score: -100, parts, themes: [] };
  const themes = topThemes(spells, ctx, 3);
  const top = new Set(themes.map(([t]) => t));
  const counts = themeCountsOf(spells, ctx);
  const deck = new Set(spells);
  let quality = 0;
  let syn = 0;
  let weak = 0;
  let creatures = 0;
  let inter = 0;
  let splashN = 0;
  for (const s of spells) {
    const v = cardValue(s, ctx);
    quality += v;
    syn += synergyOf(s, deck, top, counts, ctx).total;
    if (v < PLAYABLE) weak++;
    const f = ctx.facts.get(s);
    if (f?.creature) creatures++;
    if (isInteraction(ctx.byName.get(s), f)) inter++;
    if (f && !castableIn(f, env.colors)) splashN++;
  }
  parts.quality = quality / n;
  parts.synergy = syn / n;
  const curve = curveOf(spells, ctx);
  const full = env.target.map((t) => (t * n) / env.n);
  parts.curve = -0.8 * curve.reduce((s, c, i) => s + Math.abs(c - (full[i] ?? 0)), 0);
  parts.playables = -2 * weak;
  parts.creatures = -1.2 * Math.max(0, minCreatures(themes) - creatures);
  parts.interaction = 1.2 * Math.min(6, inter);
  parts.splash = -env.splashPenalty * splashN;
  if (env.third) parts.splash -= spells.filter((x) => (ctx.facts.get(x)?.colors ?? '').includes(env.third as string)).length;
  const at = env.arch?.primaryTheme;
  if (env.arch && typeof env.arch.winRate === 'number' && (!at || at === 'none' || top.has(at))) {
    // Weighted by the evidence: 20 games count for a third.
    const g = env.arch.games ?? 0;
    parts.archetype = Math.max(-6, Math.min(6, (env.arch.winRate - 0.5) * 40 * (g / (g + 40))));
  }
  parts.missing = -4 * Math.max(0, env.n - n);
  const score = Object.values(parts).reduce((s, x) => s + x, 0);
  return { score, parts, themes };
}

/** Pick `n` of the candidates: greedy on value + synergy with the candidates, then improving swaps. */
function choose(cands: string[], n: number, env: Env, ctx: CubeContext, maxSplash: number): string[] {
  const isSplash = (s: string) => !castableIn(ctx.facts.get(s) ?? { colors: '' }, env.colors);
  const sorted = [...cands].sort(byName);
  if (sorted.length <= n) {
    // Everything castable goes in, except splash cards over the limit.
    const out: string[] = [];
    let sp = 0;
    for (const s of [...sorted].sort((a, b) => cardValue(b, ctx) - cardValue(a, ctx) || byName(a, b))) {
      if (isSplash(s)) {
        if (sp >= maxSplash) continue;
        sp++;
      }
      out.push(s);
    }
    return out;
  }
  const top = new Set(topThemes(sorted, ctx, 3).map(([t]) => t));
  const counts = themeCountsOf(sorted, ctx);
  const all = new Set(sorted);
  const base = new Map(sorted.map((s) => [s, cardValue(s, ctx) + 0.5 * synergyOf(s, all, top, counts, ctx).total]));
  const chosen: string[] = [];
  const curve = [0, 0, 0, 0, 0, 0];
  const left = new Set(sorted);
  let sp = 0;
  while (chosen.length < n && left.size) {
    let best: string | null = null;
    let bv = -Infinity;
    for (const s of left) {
      if (isSplash(s) && sp >= maxSplash) continue;
      const b = bucketOf(ctx.facts.get(s)?.mv ?? 3);
      const over = Math.max(0, (curve[b] ?? 0) + 1 - (env.target[b] ?? 0));
      const v = (base.get(s) ?? 0) - 4 * over;
      if (v > bv) {
        bv = v;
        best = s;
      }
    }
    if (!best) break;
    left.delete(best);
    chosen.push(best);
    const b = bucketOf(ctx.facts.get(best)?.mv ?? 3);
    curve[b] = (curve[b] ?? 0) + 1;
    if (isSplash(best)) sp++;
  }
  // Improving swaps on the real objective.
  let cur = scoreSpells(chosen, env, ctx).score;
  for (let iter = 0; iter < 30; iter++) {
    let bestGain = 1e-6;
    let bestSwap: [number, string] | null = null;
    const outside = [...left].sort(byName);
    const splashNow = chosen.filter(isSplash).length;
    for (let i = 0; i < chosen.length; i++) {
      const was = chosen[i] as string;
      for (const s of outside) {
        if (isSplash(s) && !isSplash(was) && splashNow >= maxSplash) continue;
        chosen[i] = s;
        const g = scoreSpells(chosen, env, ctx).score - cur;
        if (g > bestGain) {
          bestGain = g;
          bestSwap = [i, s];
        }
      }
      chosen[i] = was;
    }
    if (!bestSwap) break;
    const [i, s] = bestSwap;
    left.add(chosen[i] as string);
    left.delete(s);
    chosen[i] = s;
    cur += bestGain;
  }
  return chosen;
}

/** The meta's best land count for this archetype (or overall), with the evidence; null without meta. */
export function metaLandCount(ctx: CubeContext, arch: MetaArchetype | null): { lands: number; note: string } | null {
  const lands = ctx.meta?.meta.lands;
  if (!lands) return null;
  // Each count's win rate shrunk toward 50 % by 20 games, so a count tried twice cannot win on luck.
  const shrunk = (s: LandStat) => (s.winRate * s.games + 0.5 * 20) / (s.games + 20);
  const pick = (table: Record<string, LandStat> | undefined, minGames: number) => {
    if (!table) return null;
    const rows = Object.entries(table)
      .map(([k, s]) => [Number(k), s] as const)
      .filter(([k, s]) => k >= 16 && k <= 17 && s && s.games >= minGames && typeof s.winRate === 'number')
      .sort((a, b) => shrunk(b[1]) - shrunk(a[1]) || a[0] - b[0]);
    return rows.length ? rows : null;
  };
  const scoped = arch ? pick(lands.byArchetype?.[arch.id], 20) : null;
  const rows = scoped ?? pick(lands.overall, 20);
  if (!rows || !rows[0]) return null;
  const [best, s] = rows[0];
  const next = rows[1];
  // Only a real difference moves the count off the sensible default.
  if (!next || shrunk(s) - shrunk(next[1]) < 0.02) return null;
  const where = scoped ? `the lab’s ${arch?.id} decks` : 'the lab’s decks';
  return {
    lands: best,
    note: `${best} lands: ${where} won ${pct(s.winRate)} of ${s.games} games with ${best} (vs ${pct(next[1].winRate)} of ${next[1].games} with ${next[0]}).`,
  };
}

/** Lands (nonbasic) from the pool that belong in a deck of these colours. */
function chooseNonbasics(pool: string[], colors: string, splash: string | null, landCount: number, ctx: CubeContext): string[] {
  const allowed = colors + (splash ?? '');
  const makes = (n: string, c: string) => (ctx.facts.get(n)?.produces ?? '').includes(c);
  const lands = [...new Set(pool)].filter((n) => {
    const f = ctx.facts.get(n);
    if (!f?.land) return false;
    const main = [...colors].filter((c) => makes(n, c)).length;
    const all = [...allowed].filter((c) => makes(n, c)).length;
    return all >= 2 || (splash !== null && makes(n, splash) && main >= 1);
  });
  lands.sort((a, b) => {
    const ma = [...colors].filter((c) => makes(a, c)).length;
    const mb = [...colors].filter((c) => makes(b, c)).length;
    return mb - ma || cardValue(b, ctx) - cardValue(a, ctx) || byName(a, b);
  });
  return lands.slice(0, Math.max(0, landCount - 6));
}

/** Basics: the splash gets enough to reach three sources (at most two basics); the rest split by early-weighted pips. */
function chooseBasics(spells: string[], nonbasics: string[], colors: string, splash: string | null, landCount: number, ctx: CubeContext): Partial<Record<Colour, number>> {
  const basics: Partial<Record<Colour, number>> = {};
  let slots = landCount - nonbasics.length;
  if (splash) {
    const have = nonbasics.filter((l) => ctx.facts.get(l)?.produces.includes(splash)).length + spells.filter((s) => ctx.facts.get(s)?.fixer && ctx.facts.get(s)?.produces.includes(splash)).length;
    const need = Math.min(2, Math.max(0, 3 - have));
    if (need > 0) {
      basics[splash as Colour] = need;
      slots -= need;
    }
  }
  const weight: Record<string, number> = {};
  for (const s of spells) {
    const f = ctx.facts.get(s);
    if (!f) continue;
    const w = f.mv <= 2 ? 2 : f.mv === 3 ? 1.5 : 1;
    for (const c of colors) weight[c] = (weight[c] ?? 0) + (f.pips[c as Colour] ?? 0) * w;
  }
  // Sources the nonbasics already give each colour count against its share.
  const fromLands: Record<string, number> = {};
  for (const l of nonbasics) for (const c of colors) if (ctx.facts.get(l)?.produces.includes(c)) fromLands[c] = (fromLands[c] ?? 0) + 1;
  const cols = [...colors];
  const total = cols.reduce((s, c) => s + Math.max(1, weight[c] ?? 0), 0);
  const totalSources = slots + nonbasics.length;
  const want = cols.map((c) => Math.max(0, (Math.max(1, weight[c] ?? 0) / total) * totalSources - (fromLands[c] ?? 0) * 0.5));
  const wantSum = want.reduce((s, x) => s + x, 0) || 1;
  let given = 0;
  cols.forEach((c, i) => {
    const k = i === cols.length - 1 ? slots - given : Math.round(((want[i] ?? 0) / wantSum) * slots);
    const min = (weight[c] ?? 0) > 0 && slots >= 6 ? 3 : 0;
    const v = Math.max(min, Math.min(slots - given, k));
    basics[c as Colour] = (basics[c as Colour] ?? 0) + v;
    given += v;
  });
  // Rounding against the minimum can leave the last colour short or over: settle on the heaviest colour.
  const sum = Object.values(basics).reduce((s, x) => s + (x ?? 0), 0);
  const fix = landCount - nonbasics.length - sum;
  if (fix !== 0) {
    const heavy = cols.reduce((a, c) => ((weight[c] ?? 0) > (weight[a] ?? 0) ? c : a), cols[0] ?? 'W') as Colour;
    basics[heavy] = Math.max(0, (basics[heavy] ?? 0) + fix);
  }
  for (const c of COLOURS) if (!basics[c]) delete basics[c];
  return basics;
}

function archetypeName(colors: string, splash: string | null, spells: string[], themes: Array<[string, number]>, arch: MetaArchetype | null, ctx: CubeContext): string {
  const label = colourLabel(colors);
  const plus = splash ? ` +${splash}` : '';
  const set = new Set(spells);
  const overlap = (sp: string[]) => sp.filter((s) => set.has(s)).length;
  const docs = ctx.cube.archetypes.filter((a) => a.colors === colors).sort((a, b) => overlap(b.signposts) - overlap(a.signposts));
  const doc = docs[0];
  if (doc && (docs.length === 1 || overlap(doc.signposts) > 0)) {
    return doc.name.startsWith(label) ? `${doc.name}${plus}` : `${label}${plus} · ${doc.name}`;
  }
  const t = arch?.primaryTheme ?? themes[0]?.[0];
  const tn = t ? (ctx.themeName.get(t) ?? t) : '';
  return tn ? `${label}${plus} · ${tn}` : `${label}${plus}`;
}

/** Evaluate a given spell list as a full deck: lands, basics, score, reasons. Used by the builder and for user edits. */
export function evaluateBuild(
  ctx: CubeContext,
  pool: string[],
  colors: string,
  splash: string | null,
  spells: string[],
  opts: { landCount?: number; n?: number; thin?: ThinKind | null; third?: string | null } = {},
): DeckBuild {
  const arch = findArchetype(ctx.meta?.meta ?? null, colors, topThemes(spells, ctx, 1)[0]?.[0]);
  const ml = metaLandCount(ctx, arch);
  const avgMv = spells.length ? spells.reduce((s, x) => s + (ctx.facts.get(x)?.mv ?? 3), 0) / spells.length : 0;
  const landCount = opts.landCount ?? ml?.lands ?? (avgMv <= 2.4 ? 16 : 17);
  const n = opts.n ?? DECK_SIZE - landCount;
  const target = curveTarget(n, arch);
  const splashPenalty = splashPenaltyOf(ctx);
  const thin = opts.thin ?? null;
  const third = thin === 'three' ? (opts.third ?? thirdColour(colors, spells, ctx)) : null;
  const env: Env = { colors, splash, n, target, splashPenalty, arch, third };
  const sorted = [...spells].sort((a, b) => (ctx.facts.get(a)?.mv ?? 0) - (ctx.facts.get(b)?.mv ?? 0) || byName(a, b));
  const { score, parts, themes } = scoreSpells(sorted, env, ctx);
  const nonbasics = chooseNonbasics(pool, colors, splash, landCount, ctx);
  const basics = chooseBasics(sorted, nonbasics, colors, splash, landCount, ctx);
  const curve = curveOf(sorted, ctx);
  const splashCards = sorted.filter((s) => !castableIn(ctx.facts.get(s) ?? { colors: '' }, colors));
  const build: DeckBuild = {
    key: colors + (splash ? `+${splash}` : '') + (landCount === 18 ? '/18' : ''),
    colors,
    splash,
    name: archetypeName(colors, splash, sorted, themes, arch, ctx),
    metaArchetype: arch?.id ?? null,
    spells: sorted,
    nonbasics,
    basics,
    landCount,
    missing: Math.max(0, n - sorted.length),
    score: round1(score),
    parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, round1(v)])) as unknown as ScoreParts,
    themes,
    curve,
    curveTarget: target.map(round1),
    creatures: sorted.filter((s) => ctx.facts.get(s)?.creature).length,
    interaction: sorted.filter((s) => isInteraction(ctx.byName.get(s), ctx.facts.get(s))).length,
    avgMv: round1(avgMv),
    splashCards,
    pairs: pairsAmong(sorted, ctx).slice(0, 6).map((p) => ({ a: p.a, b: p.b, lift: p.gain, games: p.games ?? 0 })),
    reasons: [],
    cuts: [],
    thin,
    landNote: thin === 'eighteen' ? '18 lands: a thin pool, so 22 spells.' : thin === 'three' ? `${landCount} lands for three colours.` : ml && ml.lands === landCount ? ml.note : landCount === 16 && !ml ? `16 lands: the curve is low (average mana value ${round1(avgMv)}).` : `${landCount} lands.`,
  };
  build.reasons = reasonsFor(build, env, ctx, arch);
  build.cuts = cutsFor(build, pool, env, ctx);
  return build;
}

function themeLabel(t: string, ctx: CubeContext): string {
  const n = ctx.themeName.get(t);
  return n ? `${n} (${t})` : t;
}

function reasonsFor(b: DeckBuild, env: Env, ctx: CubeContext, arch: MetaArchetype | null): string[] {
  const r: string[] = [];
  if (b.themes.length && (b.themes[0]?.[1] ?? 0) >= 4) {
    r.push(`Built around ${b.themes.slice(0, 2).map(([t, k]) => `${themeLabel(t, ctx)} — ${k} cards`).join(', ')}.`);
  }
  const best = [...b.spells].sort((x, y) => cardValue(y, ctx) - cardValue(x, ctx) || byName(x, y)).slice(0, 3);
  const bestText = best.map((s) => {
    const m = metaValue(s, ctx);
    return m && m.games >= 15 && m.winRate >= 0.52 ? `${s} (${pct(m.winRate)} in the lab)` : s;
  });
  if (bestText.length) r.push(`Best cards: ${bestText.join(', ')}.`);
  const human = humanValueNote(b.spells, ctx);
  if (human) r.push(human);
  for (const p of b.pairs.slice(0, 3)) if (p.lift > 0.02) r.push(`${p.a} + ${p.b}: ${pct(p.lift, true)} together (${p.games} games).`);
  if (arch && typeof arch.winRate === 'number' && (arch.games ?? 0) >= 10) r.push(`The lab’s ${arch.id} decks won ${pct(arch.winRate)} of ${arch.games} games${arch.ci ? ` (likely ${pct(arch.ci[0])}–${pct(arch.ci[1])})` : ''}.`);
  const diffs = b.curve.map((c, i) => c - (b.curveTarget[i] ?? 0));
  const heavy = diffs.findIndex((d, i) => i >= 3 && d >= 1.5);
  const light = diffs.findIndex((d, i) => i <= 1 && d <= -1.5);
  r.push(
    `Curve ${b.curve.join('/')} (1/2/3/4/5/6+), average ${b.avgMv}` +
      (heavy >= 0 ? ` — heavy at ${CURVE_LABELS[heavy]} mana.` : light >= 0 ? ` — few ${CURVE_LABELS[light]}-drops.` : ' — on target.'),
  );
  r.push(`${b.creatures} creatures, ${b.interaction} removal or counter spells.`);
  if (b.splash) {
    const src = [...b.nonbasics.filter((l) => ctx.facts.get(l)?.produces.includes(b.splash as string)), ...b.spells.filter((s) => ctx.facts.get(s)?.fixer && ctx.facts.get(s)?.produces.includes(b.splash as string))];
    const basics = b.basics[b.splash as Colour] ?? 0;
    r.push(`Splashes ${b.splash} for ${b.splashCards.join(', ')} off ${[...src, ...(basics ? [`${basics} ${BASIC_OF[b.splash as Colour]}`] : [])].join(', ')}.`);
  }
  if (b.thin === 'eighteen') r.push('Thin pool: no colour pair has 23 playable spells, so this plays 22 spells and 18 lands.');
  if (b.thin === 'three') r.push(`Thin pool: no colour pair has 23 playable spells, so this plays three full colours (${b.colors}) on ${b.landCount} lands.`);
  if (b.missing > 0) r.push(`${b.missing} playable${b.missing === 1 ? '' : 's'} short of a full deck in these colours.`);
  r.push(b.landNote);
  void env;
  return r;
}

/** Why each strong on-colour card is not in the deck. */
function cutsFor(b: DeckBuild, pool: string[], env: Env, ctx: CubeContext): Array<{ name: string; reason: string }> {
  const inDeck = new Set(b.spells);
  const top = new Set(b.themes.map(([t]) => t));
  const weakest = [...b.spells].sort((x, y) => cardValue(x, ctx) - cardValue(y, ctx) || byName(x, y))[0];
  const outs = [...new Set(pool)]
    .filter((s) => !inDeck.has(s) && !BASIC_NAMES.has(s))
    .filter((s) => {
      const f = ctx.facts.get(s);
      return f && !f.land && (castableIn(f, env.colors) || (env.splash && splashColourOf(f, env.colors) === env.splash));
    })
    .sort((x, y) => cardValue(y, ctx) - cardValue(x, ctx) || byName(x, y))
    .slice(0, 8);
  return outs.map((s) => {
    const f = ctx.facts.get(s);
    const card = ctx.byName.get(s);
    const mv = f?.mv ?? 0;
    const bk = bucketOf(mv);
    const onTheme = (card?.themes ?? []).some((t) => top.has(t));
    const drop = `${CURVE_LABELS[bk]}-drop`;
    let reason: string;
    if (!onTheme && top.size && mv >= 5) reason = `off-theme ${drop}`;
    else if ((b.curve[bk] ?? 0) >= (b.curveTarget[bk] ?? 0) + 0.5) reason = `curve: already ${b.curve[bk]} at ${CURVE_LABELS[bk]} mana`;
    else if (!onTheme && top.size) reason = `off-theme (${[...top].join('/')} deck)`;
    else if (f && !castableIn(f, env.colors)) reason = 'splash limit reached';
    else if (weakest && cardValue(s, ctx) < cardValue(weakest, ctx)) reason = `weaker than ${weakest}`;
    else reason = 'squeezed out by synergy';
    return { name: s, reason };
  });
}

/** The colour of a three-colour deck its spells need least (the one that must be fixed for). */
export function thirdColour(colors: string, spells: string[], ctx: CubeContext): string {
  const w: Record<string, number> = {};
  for (const c of colors) w[c] = 0;
  for (const s of spells) for (const c of ctx.facts.get(s)?.colors ?? '') if (c in w) w[c] = (w[c] ?? 0) + 1;
  return [...colors].sort((a, b) => (w[a] ?? 0) - (w[b] ?? 0) || 'WUBRG'.indexOf(b) - 'WUBRG'.indexOf(a))[0] ?? '';
}

/** Castable nonland spells for a pair: on-colour ones, plus up to `maxSplash` splashable ones of one colour. */
export function pairReaches(ctx: CubeContext, pool: string[], pair: string, need = 23, maxSplash = 3): boolean {
  let on = 0;
  const splash: Record<string, number> = {};
  for (const s of pool) {
    const f = ctx.facts.get(s);
    if (!f || f.land || BASIC_NAMES.has(s)) continue;
    if (castableIn(f, pair)) on++;
    else {
      const c = splashColourOf(f, pair);
      if (c && cardValue(s, ctx) >= SPLASH_MIN) splash[c] = (splash[c] ?? 0) + 1;
    }
  }
  const sources = (c: string) => pool.some((s) => {
    const f = ctx.facts.get(s);
    return f && f.produces.includes(c) && (f.fixer || [...pair].some((k) => f.produces.includes(k)));
  });
  const bestSplash = Math.max(0, ...Object.entries(splash).filter(([c]) => sources(c)).map(([, n]) => Math.min(maxSplash, n)));
  return on + bestSplash >= need;
}

/** A three-colour build of `n` spells, or null when the pool has no dual or fixer for its third colour. */
function buildThree(ctx: CubeContext, pool: string[], colors: string, n: number): DeckBuild | null {
  const cands = pool.filter((s) => {
    const f = ctx.facts.get(s);
    return f && !f.land && !BASIC_NAMES.has(s) && castableIn(f, colors);
  });
  const third = thirdColour(colors, cands, ctx);
  const others = [...colors].filter((c) => c !== third);
  // Every colour must matter: the third colour needs real cards and a real source.
  if (!cands.some((s) => (ctx.facts.get(s)?.colors ?? '').includes(third))) return null;
  const fixed = pool.some((s) => {
    const f = ctx.facts.get(s);
    return f && f.produces.includes(third) && (f.fixer || others.some((k) => f.produces.includes(k)));
  });
  if (!fixed) return null;
  const arch = findArchetype(ctx.meta?.meta ?? null, colors, topThemes(cands, ctx, 1)[0]?.[0]);
  const env: Env = { colors, splash: null, n, target: curveTarget(n, arch), splashPenalty: splashPenaltyOf(ctx), arch, third };
  const spells = choose(cands, n, env, ctx, 0);
  return evaluateBuild(ctx, pool, colors, null, spells, { landCount: DECK_SIZE - n, n, thin: 'three', third });
}

function buildOne(ctx: CubeContext, pool: string[], colors: string, splash: string | null, opts: BuildOptions, thinN?: number): DeckBuild | null {
  const maxSplash = opts.maxSplash ?? 3;
  const cands: string[] = [];
  for (const s of pool) {
    const f = ctx.facts.get(s);
    if (!f || f.land || BASIC_NAMES.has(s)) continue;
    if (castableIn(f, colors)) cands.push(s);
    else if (splash && splashColourOf(f, colors) === splash && cardValue(s, ctx) >= SPLASH_MIN) cands.push(s);
  }
  const splashCands = splash ? cands.filter((s) => !castableIn(ctx.facts.get(s) ?? { colors: '' }, colors)) : [];
  if (splash && splashCands.length === 0) return null;
  // The splash needs a real source: a dual making it and a main colour, or a fixer.
  if (splash) {
    const sources = [...new Set(pool)].filter((s) => {
      const f = ctx.facts.get(s);
      return f && f.produces.includes(splash) && (f.fixer || [...colors].some((c) => f.produces.includes(c)));
    });
    if (sources.length === 0) return null;
  }
  const arch0 = findArchetype(ctx.meta?.meta ?? null, colors, topThemes(cands, ctx, 1)[0]?.[0]);
  const ml = metaLandCount(ctx, arch0);
  const spellsOpt = opts.spells ?? 'auto';
  const splashPenalty = splashPenaltyOf(ctx);
  const run = (n: number) => {
    const env: Env = { colors, splash, n, target: curveTarget(n, arch0), splashPenalty, arch: arch0 };
    return choose(cands, n, env, ctx, maxSplash);
  };
  let n = thinN ?? (spellsOpt === 'auto' ? (ml ? DECK_SIZE - ml.lands : 23) : spellsOpt);
  let spells = run(n);
  if (thinN === undefined && spellsOpt === 'auto' && !ml && spells.length === 23) {
    const avg = spells.reduce((s, x) => s + (ctx.facts.get(x)?.mv ?? 3), 0) / spells.length;
    if (avg <= 2.4) {
      const more = run(24);
      if (more.length === 24) {
        spells = more;
        n = 24;
      }
    }
  }
  if (splash && !spells.some((s) => !castableIn(ctx.facts.get(s) ?? { colors: '' }, colors))) return null;
  return evaluateBuild(ctx, pool, colors, splash, spells, { landCount: DECK_SIZE - n, n, thin: thinN !== undefined ? 'eighteen' : null });
}

const TRIPLES = ['WUB', 'WUR', 'WUG', 'WBR', 'WBG', 'WRG', 'UBR', 'UBG', 'URG', 'BRG'];

/** Every build worth showing, best first. */
export function allBuilds(ctx: CubeContext, pool: string[], opts: BuildOptions = {}): DeckBuild[] {
  const builds: DeckBuild[] = [];
  for (const pair of colourPairs()) {
    const splashes: Array<string | null> = [null];
    for (const s of COLOURS) if (!pair.includes(s)) splashes.push(s);
    for (const s of splashes) {
      const b = buildOne(ctx, pool, pair, s, opts);
      if (b) builds.push(b);
    }
  }
  // Thin pool: no pair reaches 23 castable spells — 18 lands, or three full colours, compete too.
  if (!colourPairs().some((p) => pairReaches(ctx, pool, p, 23, opts.maxSplash ?? 3))) {
    for (const pair of colourPairs()) {
      for (const s of [null, ...COLOURS.filter((c) => !pair.includes(c))]) {
        const b = buildOne(ctx, pool, pair, s, opts, 22);
        if (b) builds.push(b);
      }
    }
    for (const t of TRIPLES) {
      for (const n of [23, 22]) {
        const b = buildThree(ctx, pool, t, n);
        if (b) builds.push(b);
      }
    }
  }
  // A splash that does not beat its own unsplashed build is noise.
  const plain = new Map(builds.filter((b) => !b.splash).map((b) => [`${b.colors}/${b.landCount}`, b.score]));
  // A legal 40 ranks above any build short of spells: a short build only leads
  // when no colours make a full deck yet (an early pool).
  return builds
    .filter((b) => !b.splash || b.score > (plain.get(`${b.colors}/${b.landCount}`) ?? -Infinity))
    .sort((a, b) => Number(a.missing > 0) - Number(b.missing > 0) || b.score - a.score || (a.key < b.key ? -1 : 1));
}

/** The top `k` distinct builds: different colours (or splash), and not the same spells. */
export function buildDecks(ctx: CubeContext, pool: string[], opts: BuildOptions = {}, k = 3): DeckBuild[] {
  const out: DeckBuild[] = [];
  for (const b of allBuilds(ctx, pool, opts)) {
    if (out.some((o) => o.key === b.key)) continue;
    // Same colours with a different splash must differ by 3+ spells.
    if (out.some((o) => o.colors === b.colors && b.spells.filter((s) => !o.spells.includes(s)).length < 3)) continue;
    out.push(b);
    if (out.length >= k) break;
  }
  return out;
}

/** What swapping `out` for each sideboard candidate does to the score, best first. */
export function swapOptions(ctx: CubeContext, pool: string[], build: DeckBuild, out: string): Array<{ name: string; delta: number; score: number }> {
  const inDeck = new Set(build.spells);
  const res: Array<{ name: string; delta: number; score: number }> = [];
  for (const s of [...new Set(pool)].sort(byName)) {
    const f = ctx.facts.get(s);
    if (!f || f.land || inDeck.has(s) || BASIC_NAMES.has(s)) continue;
    if (!castableIn(f, build.colors + (build.splash ?? ''))) continue;
    const spells = build.spells.map((x) => (x === out ? s : x));
    const nb = evaluateBuild(ctx, pool, build.colors, build.splash, spells, { landCount: build.landCount, n: DECK_SIZE - build.landCount, thin: build.thin });
    res.push({ name: s, delta: round1(nb.score - build.score), score: nb.score });
  }
  return res.sort((a, b) => b.delta - a.delta || byName(a.name, b.name));
}

/** The 40 as [count, name] lines: spells, nonbasic lands, basics. */
export function mainDeck(b: DeckBuild): Array<[number, string]> {
  const m = new Map<string, number>();
  for (const s of [...b.spells, ...b.nonbasics]) m.set(s, (m.get(s) ?? 0) + 1);
  const lines: Array<[number, string]> = [...m.entries()].map(([n, c]) => [c, n]);
  for (const c of COLOURS) if ((b.basics[c] ?? 0) > 0) lines.push([b.basics[c] ?? 0, BASIC_OF[c]]);
  return lines;
}

/** The rest of the pool (nonbasic), for the sideboard. */
export function sideboard(b: DeckBuild, pool: string[]): string[] {
  const left = [...pool].filter((n) => !BASIC_NAMES.has(n));
  for (const n of [...b.spells, ...b.nonbasics]) {
    const i = left.indexOf(n);
    if (i >= 0) left.splice(i, 1);
  }
  return left.sort(byName);
}

/** Legality of a build against its pool, as a list of problems (empty = a legal 40). */
export function checkBuild(b: DeckBuild, pool: string[], ctx: CubeContext): string[] {
  const errs: string[] = [];
  const total = mainDeck(b).reduce((s, [n]) => s + n, 0);
  if (total !== DECK_SIZE) errs.push(`${total} cards, not ${DECK_SIZE}`);
  const have = new Map<string, number>();
  for (const p of pool) have.set(p, (have.get(p) ?? 0) + 1);
  for (const [n, name] of mainDeck(b)) {
    if (BASIC_NAMES.has(name)) continue;
    if (n > (have.get(name) ?? 0)) errs.push(`${n} ${name}, but the pool has ${have.get(name) ?? 0}`);
  }
  for (const s of b.spells) {
    const f = ctx.facts.get(s);
    if (f && !castableIn(f, b.colors + (b.splash ?? ''))) errs.push(`${s} is off-colour`);
  }
  return errs;
}

/** Plain text list (paste into MTGA-style tools or a chat). */
export function deckText(b: DeckBuild, pool: string[]): string {
  const lines = ['Deck', ...mainDeck(b).map(([n, c]) => `${n} ${c}`)];
  const sb = sideboard(b, pool);
  if (sb.length) lines.push('', 'Sideboard', ...sb.map((c) => `1 ${c}`));
  return `${lines.join('\n')}\n`;
}

/** Forge's .dck (names only: Forge picks the printing). */
export function dckText(b: DeckBuild, pool: string[], name: string): string {
  const lines = ['[metadata]', `Name=${name}`, '[Main]', ...mainDeck(b).map(([n, c]) => `${n} ${c}`), '[Sideboard]'];
  const counts = new Map<string, number>();
  for (const s of sideboard(b, pool)) counts.set(s, (counts.get(s) ?? 0) + 1);
  for (const [s, n] of counts) lines.push(`${n} ${s}`);
  return `${lines.join('\n')}\n`;
}

/** A file-name-safe slug for a deck name. */
export function deckSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'deck'
  );
}
