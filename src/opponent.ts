/*
 * ForgeCoach — opponent.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Who the player is up against, for the coach's words. Against the Forge AI
 * (every game but one): the system prompts as they always were, byte for
 * byte. At a table of two (mtg-table M59: `hello_ok.match.opponent: "human"`,
 * read by the protocol file's `opponentIsHuman`), the other seat is a friend,
 * and a prompt that told the coach "the Forge AI" would have it reason about
 * an AI's habits that are not there.
 */
import { opponentIsHuman } from './protocol.ts';
import type { GameLog } from './log.ts';

export const AI_OPPONENT_PHRASE = 'against the Forge AI';
export const HUMAN_OPPONENT_PHRASE = 'against a friend — another person, not the AI — through the Forge engine';

/** The log's opponent is a person (a table of two). */
export function vsHuman(log: Pick<GameLog, 'hello'> | null | undefined): boolean {
  return opponentIsHuman(log?.hello ?? null);
}

/** `system` as it should read for `log`'s game: unchanged against the AI. */
export function systemFor(system: string, log: Pick<GameLog, 'hello'> | null | undefined): string {
  return vsHuman(log) ? system.split(AI_OPPONENT_PHRASE).join(HUMAN_OPPONENT_PHRASE) : system;
}
