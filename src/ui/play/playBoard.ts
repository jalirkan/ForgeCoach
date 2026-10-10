/*
 * ForgeCoach — ui/play/playBoard.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The play screen's board seam: what PlayView already holds about the live
 * game (the current state, the engine's input and ask, the viewing seat, the
 * log, the described input, the connection and game-over flags and the act
 * sender), offered through one context so the board's parts (decision slot,
 * phase strip, stack panel, hand, log) read it without PlayView passing
 * props through every layer.
 *
 * `usePlayBoard()` is `null` outside the play screen — GameView (replay) and
 * the review screens have no provider, so a part that reads it keeps its
 * replay behaviour when it is null.
 *
 * Nothing here is new wire data and nothing here judges a move: `canAct` is
 * the same gate `play/acts.ts` `whyNotAct` applies to an act the engine did
 * not ask for (a control may be offered only when the engine could take it).
 * Forge stays the judge of legality.
 */
import { createContext, useContext, useMemo } from 'react';
import type { ActBody, AskBody, GameStateBody, InputBody } from '../../protocol.ts';
import type { GameLog } from '../../log.ts';
import type { InputView } from './inputView.ts';

/**
 * May the board send an act now? Connected, no engine question open (the
 * board is modal while an ask is), the game not over, and an `input` has
 * arrived this game (M42: before that the bridge drops every act but concede).
 * `concede` / `claimWin` are the guard's exceptions and are not decided here.
 */
export function canActOf(s: { connected: boolean; ask: unknown; over: boolean; inputSeen: boolean }): boolean {
  return s.connected && !s.ask && !s.over && s.inputSeen;
}

export interface PlayBoard {
  state: GameStateBody | null;
  input: InputBody | null;
  ask: AskBody | null;
  /** The viewing seat's player id. */
  seat: number | null;
  log: GameLog | null;
  /** `describeInput(...)` for the current input: the mode, the plain title and the engine's buttons. */
  view: InputView;
  /** The seat socket is open. */
  connected: boolean;
  /** The game has ended (an `over` has arrived). */
  over: boolean;
  /** Send an act; the session's guard may still refuse it (and records a notice). */
  act: (body: ActBody) => void;
  /** `canActOf(...)`: connected, no ask open, not over, and an input has arrived. */
  canAct: boolean;
}

export const PlayBoardContext = createContext<PlayBoard | null>(null);

/** The play screen's board, or `null` when no PlayView is above (replay, review). */
export function usePlayBoard(): PlayBoard | null {
  return useContext(PlayBoardContext);
}

/** PlayView's provider value, memoised on its parts so consumers re-render only when one changes. */
export function usePlayBoardValue(p: Omit<PlayBoard, 'canAct'> & { inputSeen: boolean }): PlayBoard {
  const { state, input, ask, seat, log, view, connected, over, act, inputSeen } = p;
  return useMemo(
    () => ({ state, input, ask, seat, log, view, connected, over, act, canAct: canActOf({ connected, ask, over, inputSeen }) }),
    [state, input, ask, seat, log, view, connected, over, act, inputSeen],
  );
}
