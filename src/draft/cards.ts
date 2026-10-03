/*
 * ForgeCoach — draft/cards.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The drafting AI's view of a card, after mtg-table's cube lab
 * (tools/cubelab/cards.ts, GPL-3.0-or-later, Copyright (C) 2026 mtg-table
 * contributors; see NOTICE). The lab builds it from Forge's card database;
 * here it is built from what src/cube already knows (cube/facts.ts: Scryfall,
 * else the meta's card list, else the document) plus a rating:
 *
 *   - a card the cube's meta.json has games for: src/cube's card value, the
 *     lab's win rate blended with the no-meta estimate by games (score.ts);
 *   - otherwise src/cube's no-meta estimate (card text, themes, body), which
 *     sits on the same 0–100 scale as the lab's ratings;
 *   - `unrated` (40, the lab's default) when nothing is known about the card.
 */
import type { CubeContext } from '../cube/score.ts';
import { cardPrior, cardValue, metaValue } from '../cube/score.ts';
import type { Colour } from '../cube/colors.ts';
import { DEFAULT_WEIGHTS, type Weights } from './weights.ts';

export interface LabCard {
  name: string;
  themes: string[];
  /** The card's colours, WUBRG order; '' is colourless (and every land). */
  colors: string;
  cmc: number;
  pips: Partial<Record<Colour, number>>;
  land: boolean;
  creature: boolean;
  /** Colours this card can make or fetch, WUBRG order. */
  produces: string;
  /** A nonland card that makes or fetches more than one colour. */
  fixer: boolean;
  rating: number;
  remAIDeck: boolean;
}

/** Where a card's rating came from. */
export function ratingOf(name: string, ctx: CubeContext, w: Weights = DEFAULT_WEIGHTS): number {
  if (metaValue(name, ctx)) return cardValue(name, ctx);
  if (!ctx.byName.has(name) || !ctx.facts.has(name)) return w.unrated;
  return cardPrior(name, ctx);
}

export function labCard(name: string, ctx: CubeContext, w: Weights = DEFAULT_WEIGHTS): LabCard {
  const f = ctx.facts.get(name);
  const c = ctx.byName.get(name);
  return {
    name,
    themes: c?.themes ?? [],
    colors: f?.colors ?? c?.colorHint ?? '',
    cmc: f?.mv ?? 0,
    pips: f?.pips ?? {},
    land: f?.land ?? c?.land ?? false,
    creature: f?.creature ?? false,
    produces: f?.produces ?? '',
    fixer: f?.fixer ?? false,
    rating: ratingOf(name, ctx, w),
    remAIDeck: false,
  };
}

/** Every cube card as the AI sees it, by name. */
export function labCards(ctx: CubeContext, w: Weights = DEFAULT_WEIGHTS): Map<string, LabCard> {
  return new Map(ctx.cube.cards.map((c) => [c.name, labCard(c.name, ctx, w)]));
}
