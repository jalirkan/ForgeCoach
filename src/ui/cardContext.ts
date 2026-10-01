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
