/*
 * ForgeCoach — prompt.ts  (CONTRACT STUB — the coach agent replaces the bodies)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { GameLog } from './log.ts';
import type { Decision } from './decisions.ts';
import type { CardInfo } from './cards.ts';

export interface Prompt {
  system: string;
  user: string;
}
/** Every card name whose oracle text the coach prompt for this decision will include. */
export function coachCardNames(_log: GameLog, _d: Decision): string[] {
  return [];
}
export function buildCoachPrompt(_log: GameLog, _d: Decision, _cards: Map<string, CardInfo>, _opts?: { guide?: string }): Prompt {
  throw new Error('not implemented');
}
/** One paste-able block for the Claude app (system + user, clearly separated). */
export function promptAsText(p: Prompt): string {
  return `${p.system}\n\n---\n\n${p.user}`;
}
