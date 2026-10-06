/*
 * ForgeCoach — cube/score.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * How good a cube card is, on one 0–100 scale (about 50 = a filler playable,
 * 70 = a card you are happy to take early, 85+ = a bomb).
 *
 *   value = w · metaValue + (1 − w) · prior,  w = games / (games + K),  K = 80
 *
 * metaValue is the card's raw lab win rate (wins / games) on the value scale
 * (50 % → 50, each point of win rate is 2.5 points of value). This is one
 * beta shrinkage, toward the card's own prior p read as a win rate:
 * (wins + K·p) / (games + K). A card with no lab games has w = 0: its value
 * is the prior exactly. (Until 2026-10 this blended the lab's shrunk rate
 * with w = g/(g+40), shrinking twice — toward the cube mean, then toward the
 * prior — and gave a card with zero games w = 0.3, pulling it toward 50.)
 *
 * Why K = 80 and not the lab's k = 20: K is the noise variance over the true
 * spread of card strength around the prior, K = DE·m(1−m)/τ². The lab's games
 * come in clumps of ~2.4 against one opponent (design effect DE ≈ 1.5, as in
 * flatness.ts), and the shipped metas put the card-level SD τ at about 0.065
 * or less (0 in vintage), an upper bound since a card's rate is mostly its
 * deck's. 1.5·0.25/0.068² ≈ 80. With k = 20 a 28-game card would be 58 % lab
 * data, and ~50-game samples would move values by 20–30 points (Lightning
 * Bolt below Opt, Demonic Tutor at 30). The lab's k is still used to undo
 * its shrinkage when a card row has no wins or raw rate. Replace this with
 * the lab's deckmate-adjusted value once meta.json carries one.
 *
 * The prior needs no meta: the card's
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
import { shrinkage, shrinkRate } from './metaView.ts';

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

/** How many games of prior the blend gives a card's no-meta estimate (see the header). */
export const META_STRENGTH = 80;

/** Value-scale points per unit of win rate (one point of win rate = 2.5 points of value). */
export const VALUE_PER_RATE = 250;

/**
 * The meta's opinion of a card on the value scale, and how much to trust it.
 * Null when the lab has no games for the card. `value` is the raw win rate on
 * the value scale (unclamped: the blend in cardValue does the shrinking);
 * `weight` = games / (games + META_STRENGTH); `winRate` is the lab's shrunk rate, for
 * display, and `rawRate` wins / games.
 */
export function metaValue(name: string, ctx: CubeContext): { value: number; weight: number; winRate: number; rawRate: number; games: number } | null {
  const s = ctx.meta?.meta.cards[name];
  if (!s) return null;
  const games = typeof s.games === 'number' && Number.isFinite(s.games) ? s.games : 0;
  if (games <= 0) return null;
  const sh = shrinkage(ctx.meta!.meta);
  const k = sh.strength;
  let raw: number | null = null;
  if (typeof s.wins === 'number') raw = s.wins / games;
  else if (typeof s.winRate === 'number') raw = s.winRate;
  else if (typeof s.winRateShrunk === 'number') raw = (s.winRateShrunk * (games + k) - k * (sh.mean ?? 0.5)) / games;
  if (raw === null || !Number.isFinite(raw)) return null;
  raw = clamp(raw, 0, 1);
  const shown = typeof s.winRateShrunk === 'number' ? s.winRateShrunk : shrinkRate(raw, games, k, sh.mean ?? 0.5);
  return { value: 50 + VALUE_PER_RATE * (raw - 0.5), weight: games / (games + META_STRENGTH), winRate: shown, rawRate: raw, games };
}

/** A card's value (0–100): the lab's games blended with the prior, weight games / (games + META_STRENGTH). */
export function cardValue(name: string, ctx: CubeContext): number {
  const hit = ctx.values.get(name);
  if (hit !== undefined) return hit;
  const prior = cardPrior(name, ctx);
  const m = metaValue(name, ctx);
  const v = m ? Math.round(clamp(m.weight * m.value + (1 - m.weight) * prior, 5, 98) * 10) / 10 : prior;
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
