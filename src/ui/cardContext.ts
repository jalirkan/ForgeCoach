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
   * What is chosen so far in the open input: an attacker or blocker being
   * declared, or (`pick`) a target or list entry. The engine's own M65
   * `selectable.chosen` when the frame carries it; on an engine before it
   * (combat stays null until you confirm) what this browser sent, drawn as
   * chosen — attackers and blockers only.
   */
  chosen(card: AnyCard): 'attack' | 'block' | 'pick' | null;
  /** Blockers chosen so far for one attacker (same caveat as `chosen`). */
  blockersFor(attackerId: number): number[];
  /** Whether this player's portrait takes a click now (M66 `selectable.playerIds` when the frame says). */
  playerMark(playerId: number): boolean;
  /** Whether this player is already chosen in the open input (M65); absent: never. */
  playerChosen?(playerId: number): boolean;
  clickPlayer(playerId: number): void;
  /**
   * Take a declared blocker off (the × on a blocker in the block lane), through
   * the engine's own clicks; absent outside a block declaration.
   */
  unblock?(blockerId: number): void;
}
export const PlayContext = createContext<PlayInteraction | null>(null);
export const usePlay = () => useContext(PlayContext);

/**
 * Numbered badges on board cards, the same numbers the stack panel and the
 * combat lines use (endstep-style): a card that is the source of stack item
 * 2 wears a "2"; a card an item targets wears a ringed "2". Absent: no badges.
 */
export interface CardStackMarks {
  sources: number[];
  targets: number[];
}
/** Combat: an attacker and its blockers share a number (ui/play/combatLines.ts `combatMarks`). */
export interface CardCombatMark {
  n: number;
  role: 'attacker' | 'blocker';
  pending: boolean;
  current: boolean;
  /** A blocker's attacker (the combat lane places it in front of that card). */
  attackerId?: number | null;
  /** What an attacker attacks, when the wire says. */
  defender?: { kind: 'player' | 'card'; id: number } | null;
}
export interface BoardMarks {
  stack: ReadonlyMap<number, CardStackMarks>;
  combat?: ReadonlyMap<number, CardCombatMark>;
}
export const BoardMarksContext = createContext<BoardMarks | null>(null);
export const useBoardMarks = () => useContext(BoardMarksContext);
