/*
 * ForgeCoach — draft/pick.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * How the drafting AI values a card it could take. Ported from mtg-table's
 * cube lab (tools/cubelab/pick.ts, GPL-3.0-or-later, Copyright (C) 2026
 * mtg-table contributors; see NOTICE):
 *
 *   score(card) = rating
 *               + synergy  * sum over the card's themes of sqrt(min(cap, on-colour picks sharing it))
 *               + colour term                         (lean before commitment, penalties after)
 *               + fixing   for a land or fixer that makes the committed colours
 *               - remAIDeck for a card the AI plays poorly
 *
 * The drafter COMMITS to its best two colours once `commitAt` of its expected
 * picks are made (a third by default) and re-derives the pair at every pick
 * after. A card one colour off is a SPLASH candidate when it is strong enough,
 * needs at most one pip of that colour, and the drafter already holds
 * `splashSources` ways to make it. (The player's pick helper is a different
 * model: src/cube/pick.ts.)
 */
import { COLOURS } from '../cube/colors.ts';
import { castableIn } from '../cube/facts.ts';
import type { LabCard } from './cards.ts';
import type { Weights } from './weights.ts';

export interface DrafterState {
  picks: LabCard[];
  /** How many cards this drafter expects to end with (grid ~45, Winston ~45). */
  expected: number;
}

/** Each colour's weight among the picks: rating mass, split over a gold card's colours. */
export function colourMass(picks: LabCard[]): Record<string, number> {
  const m: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const p of picks) {
    if (p.land || !p.colors) continue;
    for (const c of p.colors) m[c] = (m[c] ?? 0) + Math.max(0, p.rating) / p.colors.length;
  }
  return m;
}

/** The two heaviest colours, WUBRG-ordered (ties broken by WUBRG order). */
export function topPair(picks: LabCard[]): string {
  const m = colourMass(picks);
  const order = [...COLOURS].sort((a, b) => (m[b] ?? 0) - (m[a] ?? 0) || COLOURS.indexOf(a) - COLOURS.indexOf(b));
  const two = new Set(order.slice(0, 2));
  return COLOURS.filter((c) => two.has(c)).join('');
}

export function committed(s: DrafterState, w: Weights): boolean {
  return s.picks.length >= w.commitAt * s.expected;
}

/** Sources of colour `c` among the picks: lands and nonland fixers that make it. */
export function sourcesOf(picks: LabCard[], c: string): number {
  let n = 0;
  for (const p of picks) if ((p.land || p.fixer) && p.produces.includes(c)) n++;
  return n;
}

/** The splash colour of `card` for `pair`: exactly one colour off, at most one pip of it. */
export function splashColourOf(card: LabCard, pair: string): string | null {
  const off = [...card.colors].filter((c) => !pair.includes(c));
  if (off.length !== 1) return null;
  const s = off[0] as (typeof COLOURS)[number];
  return (card.pips[s] ?? 0) <= 1 ? s : null;
}

/** sum over themes of sqrt(min(cap, n_t)), where n_t counts `among` cards sharing theme t. */
export function synergyCount(card: LabCard, among: LabCard[], cap: number): number {
  if (card.themes.length === 0) return 0;
  let total = 0;
  for (const t of card.themes) {
    let n = 0;
    for (const p of among) if (p !== card && p.themes.includes(t)) n++;
    total += Math.sqrt(Math.min(cap, n));
  }
  return total;
}

export interface ScoreParts {
  rating: number;
  synergy: number;
  colour: number;
  fixing: number;
  ai: number;
  total: number;
}

export function scoreCard(card: LabCard, s: DrafterState, w: Weights): ScoreParts {
  const isCommitted = committed(s, w);
  const pair = topPair(s.picks);
  const rating = card.land ? card.rating * w.landScale : card.rating;
  // Synergy counts the picks that can end up in the same deck: after commitment
  // the on-colour (and colourless) ones, before it every pick.
  const among = isCommitted ? s.picks.filter((p) => castableIn(p, pair)) : s.picks;
  const synergy = w.synergy * synergyCount(card, among, w.synergyCap);
  let colour = 0;
  let fixing = 0;
  if (!card.land && card.colors) {
    if (!isCommitted) {
      const m = colourMass(s.picks);
      const total = Object.values(m).reduce((a, b) => a + b, 0);
      if (total > 0) {
        let share = 0;
        for (const c of card.colors) share += (m[c] ?? 0) / total;
        colour = w.lean * (share / card.colors.length) * 2;
      }
    } else if (!castableIn(card, pair)) {
      const sc = splashColourOf(card, pair);
      const ok = sc !== null && card.rating >= w.splashMinRating && sourcesOf(s.picks, sc) >= w.splashSources;
      colour = ok ? -w.splash : -w.offColour;
    }
  }
  if (card.land || card.fixer) {
    const makes = [...pair].filter((c) => card.produces.includes(c)).length;
    if (isCommitted) {
      if (makes === 2) fixing = w.fixing;
      else if (makes === 1 && card.produces.length >= 2) fixing = w.fixing / 2;
      else if (card.land) fixing = -w.fixing; // a dual in two colours we are not playing
    }
  }
  const ai = card.remAIDeck ? -w.remAIDeck : 0;
  return { rating, synergy, colour, fixing, ai, total: rating + synergy + colour + fixing + ai };
}

/** A set taken at once: its best card, plus `setRest` times each other card (negatives count as nothing). */
export function setValue(cards: LabCard[], s: DrafterState, w: Weights): number {
  const v = cards.map((c) => Math.max(0, scoreCard(c, s, w).total)).sort((a, b) => b - a);
  let sum = 0;
  v.forEach((x, i) => {
    sum += i === 0 ? x : x * w.setRest;
  });
  return sum;
}
