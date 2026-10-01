/*
 * ForgeCoach — review.ts  (CONTRACT STUB — the coach agent replaces the bodies)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { GameLog } from './log.ts';
import type { CardInfo } from './cards.ts';
import type { Prompt } from './prompt.ts';

export function reviewCardNames(_log: GameLog): string[] {
  return [];
}
/** Compact turn-by-turn summary of the whole game. */
export function summarizeGame(_log: GameLog): string {
  return '';
}
export function buildReviewPrompt(_log: GameLog, _cards: Map<string, CardInfo>, _opts?: { guide?: string }): Prompt {
  throw new Error('not implemented');
}
