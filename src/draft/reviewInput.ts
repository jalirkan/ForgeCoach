/*
 * ForgeCoach — draft/reviewInput.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * What an engine review (gameReviewClient.ts, mtg-table docs/game-review.md)
 * may know about the opponent after a Draft vs AI match: the cube's full card
 * list (`oppPool`, the engine draws the opponent's hidden cards from it minus
 * every card it can rule out) and the AI picks the player knows of
 * (`oppKnown`, `knownAiCards`: none in a Booster of three or more seats). Only for the match the saved draft launched — recognised by
 * the AI deck's public NAME in the log; the AI deck's contents are never read
 * here and never sent. Any other game: nothing (the engine then treats the
 * opponent's hidden cards as basic lands, and its report says so).
 * DOM-free.
 */
import type { GameLog } from '../log.ts';
import { opponentDeckName } from '../cube/coachContext.ts';
import { knownAiCards } from './draft.ts';
import { safeDeckName } from './launch.ts';
import type { SavedDraft } from './store.ts';

export const MIN_REVIEW_POOL = 80;
export const MAX_REVIEW_KNOWN = 60;

export interface DraftReviewFields {
  oppPool?: [number, string][];
  oppKnown?: string[];
}

/** Was this log the match the saved draft started? (Its finished draft, and the AI deck's public name.) */
export function isDraftMatch(log: GameLog, saved: SavedDraft | null): boolean {
  const ai = saved?.after?.aiDeck;
  if (!saved?.draft.done || !ai) return false;
  const name = opponentDeckName(log);
  return !!name && name === safeDeckName(ai.name, 'AI Drafter');
}

/** The request fields for a draft match: the cube list (as [1, name], at least 80 cards) and the known AI picks (at most 60). */
export function draftReviewFields(log: GameLog, saved: SavedDraft | null, cubeNames: string[]): DraftReviewFields {
  if (!saved || !isDraftMatch(log, saved)) return {};
  const out: DraftReviewFields = {};
  const pool = [...new Set(cubeNames.map((n) => n.trim()).filter(Boolean))];
  if (pool.length >= MIN_REVIEW_POOL) out.oppPool = pool.map((n) => [1, n]);
  const known = [...new Set(knownAiCards(saved.draft).map((n) => n.trim()).filter(Boolean))].slice(0, MAX_REVIEW_KNOWN);
  if (out.oppPool && known.length) out.oppKnown = known;
  return out;
}
