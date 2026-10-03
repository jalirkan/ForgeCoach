/*
 * ForgeCoach — draft/weights.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The drafting AI's tunable numbers, ported from mtg-table's cube lab
 * (tools/cubelab/weights.ts, GPL-3.0-or-later, Copyright (C) 2026 mtg-table
 * contributors; see NOTICE). Only the picking weights: deckbuilding here is
 * src/cube/builder.ts. mtg-table's docs/guides/cube-lab.md explains each one.
 */

export interface Weights {
  /** The rating of a card nothing is known about. */
  unrated: number;
  /** A nonbasic land's rating is multiplied by this before it competes with spells. */
  landScale: number;
  /** Points per theme a card shares with the drafter's on-colour picks, times sqrt(how many share it). */
  synergy: number;
  /** At most this many earlier picks count toward one theme's synergy. */
  synergyCap: number;
  /** Before commitment: points times the share of the drafter's colour weight the card's colours carry. */
  lean: number;
  /** Commit to two colours once this fraction of the expected picks is made. */
  commitAt: number;
  /** After commitment: a card outside the two colours that cannot be splashed. */
  offColour: number;
  /** After commitment: a card that is one splashable colour off. */
  splash: number;
  /** A splash card must be rated at least this. */
  splashMinRating: number;
  /** ...and the drafter must already hold this many sources of the splash colour. */
  splashSources: number;
  /** A land or fixer that makes both committed colours (half for one committed colour plus another). */
  fixing: number;
  /** A card set taken at once (a grid line, a Winston pile) is worth its best card plus this times each other card. */
  setRest: number;
  /** Winston: take pile 1, 2, 3 when it is worth the blind card's expected value plus this. */
  winstonMargin1: number;
  winstonMargin2: number;
  winstonMargin3: number;
  /** A card the AI plays poorly: subtracted when picking. */
  remAIDeck: number;
}

export const DEFAULT_WEIGHTS: Weights = {
  unrated: 40,
  landScale: 0.45,
  synergy: 4,
  synergyCap: 6,
  lean: 10,
  commitAt: 1 / 3,
  offColour: 40,
  splash: 15,
  splashMinRating: 70,
  splashSources: 2,
  fixing: 12,
  setRest: 0.6,
  winstonMargin1: 10,
  winstonMargin2: 5,
  winstonMargin3: 0,
  remAIDeck: 0,
};
