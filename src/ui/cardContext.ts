/*
 * ForgeCoach — ui/cardContext.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { createContext, useContext } from 'react';
import type { AnyCard, GameStateBody } from '../protocol.ts';

export interface CardActions {
  /** Open the detail sheet for a card as it is in `state`. */
  open(card: AnyCard, state: GameStateBody | null): void;
  /** Desktop hover preview: a name and the anchor rect, or null to hide. */
  hover(name: string | null, rect?: DOMRect): void;
}

export const CardActionsContext = createContext<CardActions>({
  open: () => undefined,
  hover: () => undefined,
});

export const useCardActions = () => useContext(CardActionsContext);

/**
 * The state the board is currently showing, as a stable ref, so memoised
 * tiles can open their detail against it without re-rendering on every scrub.
 */
export const BoardStateRef = createContext<{ current: GameStateBody | null }>({ current: null });
export const useBoardStateRef = () => useContext(BoardStateRef);

/**
 * Play mode: how tiles react to a click. Absent (null) in replay, where a
 * click opens the card's details. In play a card the engine is asking about
 * (or that a click plausibly drives) sends `act: clickCard`; everything else
 * still opens details, and long-press / right-click always does.
 */
export type PlayMark = 'select' | 'act' | null;
export interface PlayInteraction {
  mark(card: AnyCard): PlayMark;
  /** A gentle "you can afford this" glow for hand cards (a hint, never a gate). */
  hint(card: AnyCard): boolean;
  click(card: AnyCard): void;
  /**
   * Attackers / blockers you have clicked while declaring. The wire has no
   * "chosen so far" field (combat stays null until you confirm), so this is
   * what this browser sent, drawn as chosen.
   */
  chosen(card: AnyCard): 'attack' | 'block' | null;
  /** Blockers chosen so far for one attacker (same caveat as `chosen`). */
  blockersFor(attackerId: number): number[];
  playerMark(playerId: number): boolean;
  clickPlayer(playerId: number): void;
}
export const PlayContext = createContext<PlayInteraction | null>(null);
export const usePlay = () => useContext(PlayContext);
