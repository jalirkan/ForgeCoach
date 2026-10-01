/*
 * ForgeCoach — play/session.ts  (CONTRACT STUB — the session agent replaces the bodies)
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Playing a game: ForgeCoach is the player's seat on a running mtg-table
 * bridge (ws://127.0.0.1:8642/ws, protocol §2). This module owns the socket,
 * the growing GameLog, the current input/ask, and sending acts and answers.
 */
import type { ActBody, AnswerValue, AskBody, GameStateBody, InputBody, OverBody } from '../protocol.ts';
import type { GameLog } from '../log.ts';

export const DEFAULT_SEAT_URL = 'ws://127.0.0.1:8642/ws';

export type SeatStatus =
  | 'idle'
  | 'connecting'
  | 'open'
  /** Another client holds the seat (close 4001) — e.g. the mtg-table board tab. */
  | 'refused'
  | 'closed'
  | 'error';

export interface PlaySnapshot {
  status: SeatStatus;
  /** Human-readable detail for the status (why it failed, what to do). */
  detail: string | null;
  /** Everything received this game, as a GameLog (same shape parseLog returns). */
  log: GameLog | null;
  state: GameStateBody | null;
  /** The engine's current prompt (buttons, selectable cards…); null when none. */
  input: InputBody | null;
  /** The open blocking question, if any. Exactly one answer per ask. */
  ask: AskBody | null;
  over: OverBody | null;
  /** The viewing seat's player id. */
  seat: number | null;
}

export interface PlaySession {
  snapshot(): PlaySnapshot;
  /** Called on every change (throttled to animation frames by the implementation). */
  subscribe(cb: (s: PlaySnapshot) => void): () => void;
  act(body: ActBody): void;
  answer(askId: string, value: AnswerValue): void;
  resync(): void;
  close(): void;
}

export function connectSeat(_url: string = DEFAULT_SEAT_URL): PlaySession {
  throw new Error('not implemented');
}
