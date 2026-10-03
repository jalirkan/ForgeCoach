/*
 * ForgeCoach — cube/score.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * How good a cube card is, on one 0–100 scale (about 50 = a filler playable,
 * 70 = a card you are happy to take early, 85+ = a bomb).
 *
 *   value = w · metaValue + (1 − w) · prior,  w = games / (games + 40)
 *
 * metaValue comes from the cube lab's shrunk win rate (50 % → 50, each point
 * of win rate is 2.5 points of value). The prior needs no meta: the card's
 * tags (removal, counter…), how many of the cube's themes it sits in and how
 * deep those themes are, its type, mana value and body, and what its oracle
 * text does (removal, card draw, tokens) when the document has no tag.
 *
 * Synergy, with the cards it would be played beside:
 *   themes — for each of the card's themes among the deck's top themes,
 *            2 · √min(8, other cards sharing it);
 *   pairs  — the meta's pair gain with each partner present (+6 % → up to +3,
 *            times games / (games + 20)), capped.
 */
import type { Cube, CubeCard } from './parseCube.ts';
import type { CardFacts } from './facts.ts';
import { cardFacts } from './facts.ts';
import type { CardInfo } from '../cards.ts';
import { indexMeta, type CubeMeta, type MetaIndex, type MetaPair } from './meta.ts';

export interface CubeContext {
  cube: Cube;
  /** Cube cards by name. */
  byName: Map<string, CubeCard>;
  facts: Map<string, CardFacts>;
  meta: MetaIndex | null;
  /** How many cube cards carry each theme. */
  themeSupport: Map<string, number>;
  /** Theme code → its name ("SAC" → "Sacrifice"). */
  themeName: Map<string, string>;
  /** Cached values. */
  values: Map<string, number>;
  priors: Map<string, number>;
}

/** Builds the scoring context. `infos` is Scryfall data by name (missing entries fall back to meta or the document). */
export function makeContext(cube: Cube, infos: Map<string, CardInfo> | null, meta: CubeMeta | null): CubeContext {
  const byName = new Map(cube.cards.map((c) => [c.name, c]));
  const metaCards = new Map((meta?.cube.cards ?? []).map((c) => [c.name, c]));
  const facts = new Map<string, CardFacts>();
  for (const c of cube.cards) facts.set(c.name, cardFacts(c, infos?.get(c.name) ?? null, metaCards.get(c.name) ?? null));
  const themeSupport = new Map<string, number>();
  for (const c of cube.cards) for (const t of c.themes) themeSupport.set(t, (themeSupport.get(t) ?? 0) + 1);
  const themeName = new Map(cube.themes.map((t) => [t.code, t.name]));
  return { cube, byName, facts, meta: meta ? indexMeta(meta) : null, themeSupport, themeName, values: new Map(), priors: new Map() };
}

const REMOVAL_TEXT =
  /(destroy target|exile target (?:creature|nonland|permanent|artifact|enchantment|planeswalker)(?! you control)|deals? (?:\d+|x|that much) damage to (?:any target|target creature|each creature|target (?:creature or )?planeswalker)|(?:target|all|each) creatures?(?: you don't control)? gets? -\d+\/-\d+|fights? (?:target|up to one target|another target)|destroy all creatures|exile all creatures)/i;
const BOUNCE_TEXT = /return target (?:creature|nonland permanent|permanent)(?! you control)[^.]* to its owner's hand/i;
const DRAW_TEXT = /\bdraws? (?:a|two|three|\w+) cards?\b|\binvestigate\b|\bclue token\b/i;
const TOKEN_TEXT = /\bcreate[s]? (?:a|an|one|two|three|four|x|\w+) [^.]*?token/i;
const EVASION_TEXT = /\b(flying|menace|trample|can't be blocked|haste|lifelink|deathtouch)\b/i;

export function isRemoval(card: CubeCard | undefined, f: CardFacts | undefined): boolean {
  if (card?.tags.includes('removal')) return true;
  return !!f && !f.land && REMOVAL_TEXT.test(f.oracle);
}

export function isInteraction(card: CubeCard | undefined, f: CardFacts | undefined): boolean {
  if (!card) return false;
  return isRemoval(card, f) || card.tags.includes('counter') || card.tags.includes('discard') || (!!f && /counter target spell/i.test(f.oracle));
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** The no-meta prior for one card. */
export function cardPrior(name: string, ctx: CubeContext): number {
  const hit = ctx.priors.get(name);
  if (hit !== undefined) return hit;
  const card = ctx.byName.get(name);
  const f = ctx.facts.get(name);
  let v: number;
  if (!card || !f) v = 40;
  else if (f.land || card.land) {
    v = 30 + 12 * Math.min(2, f.produces.length) + (card.themes.length ? 4 : 0);
  } else {
    v = 46;
    // Hub cards: in several of the cube's themes, and in deep ones.
    v += 3.5 * Math.min(3, card.themes.length);
    if (card.themes.length) {
      const depth = card.themes.reduce((s, t) => s + Math.min(1, (ctx.themeSupport.get(t) ?? 0) / 30), 0) / card.themes.length;
      v += 4 * depth;
    }
    const tags = card.tags;
    const removal = isRemoval(card, f);
    if (removal) v += tags.includes('removal') ? 13 : 10;
    else if (BOUNCE_TEXT.test(f.oracle)) v += 4;
    if (tags.includes('counter') || /counter target spell/i.test(f.oracle)) v += 6;
    if (tags.includes('discard')) v += 4;
    if (tags.includes('ramp') || (f.produces && !f.land)) v += 3;
    if (tags.includes('hoser')) v -= 5;
    if (DRAW_TEXT.test(f.oracle)) v += 3;
    if (TOKEN_TEXT.test(f.oracle)) v += 3;
    if (f.planeswalker) v += 10;
    if (f.creature && f.power !== null && f.toughness !== null) {
      const eff = (f.power + f.toughness) / 2 - f.mv;
      v += clamp(eff * 3, -6, 8);
      if (EVASION_TEXT.test(f.oracle)) v += 3;
    }
    if (f.mv >= 6) v -= 4 * (f.mv - 5);
    if (removal && f.mv <= 2) v += 3;
    if (f.colors.length >= 2) v += 2;
    v = clamp(v, 15, 92);
  }
  v = Math.round(v * 10) / 10;
  ctx.priors.set(name, v);
  return v;
}

/** The meta's opinion of a card on the value scale, and how much to trust it. */
export function metaValue(name: string, ctx: CubeContext): { value: number; weight: number; winRate: number; games: number } | null {
  const s = ctx.meta?.meta.cards[name];
  if (!s) return null;
  const wr = s.winRateShrunk ?? s.winRate;
  if (typeof wr !== 'number') return null;
  const games = s.games ?? 0;
  return { value: clamp(50 + 250 * (wr - 0.5), 5, 98), weight: games > 0 ? games / (games + 40) : 0.3, winRate: wr, games };
}

/** A card's value (0–100): meta blended with the prior. */
export function cardValue(name: string, ctx: CubeContext): number {
  const hit = ctx.values.get(name);
  if (hit !== undefined) return hit;
  const prior = cardPrior(name, ctx);
  const m = metaValue(name, ctx);
  const v = m ? Math.round((m.weight * m.value + (1 - m.weight) * prior) * 10) / 10 : prior;
  ctx.values.set(name, v);
  return v;
}

/** The deck's top themes: by how many of the cards carry each (value breaks ties), at most `n`. */
export function topThemes(names: string[], ctx: CubeContext, n = 3): Array<[string, number]> {
  const count = new Map<string, number>();
  const mass = new Map<string, number>();
  for (const name of names) {
    for (const t of ctx.byName.get(name)?.themes ?? []) {
      count.set(t, (count.get(t) ?? 0) + 1);
      mass.set(t, (mass.get(t) ?? 0) + cardValue(name, ctx));
    }
  }
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1] || (mass.get(b[0]) ?? 0) - (mass.get(a[0]) ?? 0) || (a[0] < b[0] ? -1 : 1))
    .slice(0, n);
}

export const THEME_W = 2;
export const THEME_CAP = 8;
export const PAIR_W = 50; // points per unit of gain (+0.06 → +3 at full weight)
export const PAIR_CAP = 10;
export const PAIR_MIN_GAMES = 5;
/** How much a pair's evidence counts: games / (games + 20). */
export const pairWeight = (p: MetaPair) => { const g = p.games ?? 20; return g / (g + 20); };

export interface Synergy {
  themes: number;
  pairs: number;
  total: number;
  /** The meta pairs that counted, best first. */
  partners: Array<{ name: string; lift: number }>;
}

/**
 * Synergy of `name` with the other cards of `deck` (a name may appear in `deck`; it is not counted with itself).
 * `themeCounts` is how many deck cards carry each theme (the card itself included when it is in the deck).
 */
export function synergyOf(name: string, deck: Set<string>, top: Set<string>, themeCounts: Map<string, number>, ctx: CubeContext): Synergy {
  const card = ctx.byName.get(name);
  let themes = 0;
  for (const t of card?.themes ?? []) {
    if (!top.has(t)) continue;
    const others = (themeCounts.get(t) ?? 0) - (deck.has(name) ? 1 : 0);
    themes += THEME_W * Math.sqrt(Math.min(THEME_CAP, Math.max(0, others)));
  }
  let pairs = 0;
  const partners: Array<{ name: string; lift: number }> = [];
  for (const p of ctx.meta?.pairsOf.get(name) ?? []) {
    const other = p.a === name ? p.b : p.a;
    if (other === name || !deck.has(other)) continue;
    if ((p.games ?? PAIR_MIN_GAMES) < PAIR_MIN_GAMES) continue;
    pairs += PAIR_W * p.gain * pairWeight(p);
    partners.push({ name: other, lift: p.gain });
  }
  pairs = clamp(pairs, -PAIR_CAP, PAIR_CAP);
  partners.sort((a, b) => b.lift - a.lift || (a.name < b.name ? -1 : 1));
  return { themes, pairs, total: themes + pairs, partners };
}

/** Theme counts over a list of names. */
export function themeCountsOf(names: Iterable<string>, ctx: CubeContext): Map<string, number> {
  const m = new Map<string, number>();
  for (const n of names) for (const t of ctx.byName.get(n)?.themes ?? []) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

/** The meta pairs among a set of names, best lift first. */
export function pairsAmong(names: Iterable<string>, ctx: CubeContext, minGames = PAIR_MIN_GAMES): MetaPair[] {
  const set = new Set(names);
  const out: MetaPair[] = [];
  for (const p of ctx.meta?.meta.pairs ?? []) if (set.has(p.a) && set.has(p.b) && (p.games ?? minGames) >= minGames) out.push(p);
  return out.sort((a, b) => b.gain * pairWeight(b) - a.gain * pairWeight(a) || (a.a + a.b < b.a + b.b ? -1 : 1));
}

/** "+6%" / "−3%" for a fraction. */
export function pct(x: number, signed = false): string {
  const v = Math.round(x * 100);
  return `${signed && v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}%`;
}
