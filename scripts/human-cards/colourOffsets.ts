/*
 * ForgeCoach — scripts/human-cards/colourOffsets.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * docs/human-blend.md part 3's per-colour correction of the lab's card numbers,
 * as pre-registered. It failed its test, so it lives here with the test
 * tooling and the app does not use it.
 */
import type { CubeMeta } from '../../src/cube/meta.ts';
import { cardPrior, labValue, metaValue, VALUE_PER_RATE, type CubeContext } from '../../src/cube/score.ts';

const COLOURS = ['W', 'U', 'B', 'R', 'G'] as const;

/**
 * δ_c = p_c − m: p_c the deck win rate of decks whose colours include c (the meta's `colorBaselines`
 * when present, else summed over its archetypes, as draft/labStats.ts `colourBaselines`), m the pooled
 * win rate over all archetypes. Forge data only. Null without usable archetypes.
 */
export function colourOffsetsOf(meta: CubeMeta): Map<string, number> | null {
  let G = 0;
  let W = 0;
  const per = new Map<string, { g: number; w: number }>();
  for (const a of meta.archetypes) {
    const g = typeof a.games === 'number' && Number.isFinite(a.games) && a.games > 0 ? a.games : 0;
    const r = typeof a.winRate === 'number' && a.winRate >= 0 && a.winRate <= 1 ? a.winRate : null;
    if (!g || r === null) continue;
    G += g;
    W += g * r;
    for (const c of COLOURS) {
      if (!a.colors.includes(c)) continue;
      const s = per.get(c) ?? { g: 0, w: 0 };
      s.g += g;
      s.w += g * r;
      per.set(c, s);
    }
  }
  const lab = new Map<string, { g: number; w: number }>();
  for (const c of COLOURS) {
    const v = meta.colorBaselines?.[c];
    if (v && typeof v.games === 'number' && v.games > 0 && typeof v.wins === 'number' && v.wins >= 0 && v.wins <= v.games) lab.set(c, { g: v.games, w: v.wins });
  }
  const use = lab.size ? lab : per;
  return G > 0 && use.size ? new Map([...use].map(([c, s]) => [c, s.w / s.g - W / G])) : null;
}

/** The mean of `offsets` over a card's colours (`CardFacts.colors`); 0 for a colourless card. */
export function offsetFor(colors: string, offsets: Map<string, number> | null): number {
  const cs = colors.split('').filter((c) => offsets?.has(c));
  return offsets && cs.length ? cs.reduce((s, c) => s + offsets.get(c)!, 0) / cs.length : 0;
}

export function colourOffset(name: string, ctx: CubeContext): number {
  return ctx.meta ? offsetFor(ctx.facts.get(name)?.colors ?? '', colourOffsetsOf(ctx.meta.meta)) : 0;
}

/** `labValue` with the lab rate corrected by the card's colour offset; `labValue` itself without lab games. */
export function adjustedLabValue(name: string, ctx: CubeContext): number {
  const m = metaValue(name, ctx);
  const off = m ? colourOffset(name, ctx) : 0;
  if (!m || !off) return labValue(name, ctx);
  const v = m.weight * (m.value - VALUE_PER_RATE * off) + (1 - m.weight) * cardPrior(name, ctx);
  return Math.round(Math.max(5, Math.min(98, v)) * 10) / 10;
}
