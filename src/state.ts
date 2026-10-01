/*
 * ForgeCoach — state.ts  (CONTRACT STUB — the coach agent replaces the bodies)
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Derived facts about one state frame that neither the UI nor the prompt
 * should recompute: mana available, land drop, what was cast this turn.
 */
import type { GameStateBody } from './protocol.ts';
import type { GameLog } from './log.ts';
import type { CardInfo } from './cards.ts';

export interface ManaSource {
  cardId: number;
  name: string;
  /** Colour letters it can produce: W U B R G C. Empty if unknown. */
  colors: string[];
}
/** Untapped, usable (not summoning-sick if it needs {T} on a creature) mana sources of a player. */
export function untappedManaSources(_state: GameStateBody, _playerId: number, _cards?: Map<string, CardInfo>): ManaSource[] {
  return [];
}

export interface TurnFacts {
  /** Did this player already play a land this turn? null when unknowable. */
  landPlayed: boolean | null;
  /** Spells cast this turn, by anyone, in order. */
  cast: { playerId: number; name: string }[];
  /** Names of permanents the player controlled that left the battlefield this turn (revolt). */
  leftBattlefield: string[];
}
/** Facts accumulated from the events of all frames of the current turn up to `frameIndex`. */
export function turnFacts(_log: GameLog, _frameIndex: number, _playerId: number): TurnFacts {
  return { landPlayed: null, cast: [], leftBattlefield: [] };
}
