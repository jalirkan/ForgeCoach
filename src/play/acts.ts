/*
 * ForgeCoach — play/acts.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Typed builders for every `act` mtg-table's protocol defines (docs/protocol.md
 * §2.2, amendments M26/M30/M33/M37/M48), and the client-side guard that decides
 * whether an act or an answer may go on the wire right now.
 *
 * The act list and the per-act notes are adapted from mtg-table
 * web/src/main.tsx (the board's `actions` object) and web/src/transport/ws.ts,
 * Copyright (C) 2026 the mtg-table authors, GPL-3.0-or-later.
 *
 * The guard is the client's half of what the bridge enforces anyway (its
 * `applyAct` pre-input guard, ActGuard / D136, ReplyPool's one-answer rule):
 * refusing locally means the user gets an immediate reason instead of a
 * `Not yet` / `Not now` / `Late answer` notice, and nothing the player did not
 * mean reaches the engine. Forge stays the judge of everything else — a click
 * on a card is never pre-judged here (protocol §4.1, amendment M8).
 */
import type {
  ActBody,
  AlphaStrikeAct,
  ButtonCancelAct,
  ButtonOkAct,
  ClickAbilityAct,
  ClickCardAct,
  ClickPlayerAct,
  ClaimWinAct,
  ConcedeAct,
  ManaColor,
  NewGameAct,
  NextGameAct,
  OverBody,
  PassPriorityAct,
  SetPhaseStopAct,
  SetYieldAct,
  SetYieldMode,
  UndoAct,
  UseManaAct,
  YieldKind,
  YieldToAct,
} from '../protocol.ts';

// ---------------------------------------------------------------------------
// Builders. One per `action`, the body exactly as §2.2 spells it.

/** Click a card. Also how a land is tapped for mana and how a hand card is played (§4.1, M8). */
export const clickCard = (cardId: number): ClickCardAct => ({ action: 'clickCard', cardId });
/** Click a player (targeting, attacking a player). */
export const clickPlayer = (playerId: number): ClickPlayerAct => ({ action: 'clickPlayer', playerId });
/** Activate one ability of a card. Both ids are sent (§2.2, M26). */
export const clickAbility = (cardId: number, abilityId: number): ClickAbilityAct => ({
  action: 'clickAbility',
  cardId,
  abilityId,
});
/** The engine's OK button, whatever its label (`OK`, `Auto`, …). */
export const ok = (): ButtonOkAct => ({ action: 'buttonOk' });
/** The engine's Cancel button, whatever its label (`Cancel`, `End Turn`, `Undo (2)`); also cancels a yield. */
export const cancel = (): ButtonCancelAct => ({ action: 'buttonCancel' });
/** `IGameController.passPriority()` — the safe keyboard pass; a no-op unless the engine is on a priority input. */
export const pass = (): PassPriorityAct => ({ action: 'passPriority' });
/** Spend one floating mana of a colour during a payment (single letter, M30). Ignored outside a payment. */
export const useMana = (color: ManaColor): UseManaAct => ({ action: 'useMana', color });
/** Undo the last mana ability. Read `state.undo.can` first (M35); refused with `Not now` while the engine runs (M48). */
export const undo = (): UndoAct => ({ action: 'undo' });
/** Attack with everything — only meaningful while declaring attackers. */
export const alphaStrike = (): AlphaStrikeAct => ({ action: 'alphaStrike' });
/** Concede the game. Always allowed (§5.4: concede is reachable from every UI state). */
export const concede = (): ConcedeAct => ({ action: 'concede' });
/** M59 — at a table of two, once the other player has been away past the grace: claim the win. Allowed whenever concede is. */
export const claimWin = (): ClaimWinAct => ({ action: 'claimWin' });
/** M3's spelling of `newGame {mode:"continue"}`. Prefer {@link newGame}. */
export const nextGame = (): NextGameAct => ({ action: 'nextGame' });
/** After `over`: the next game of the match (`continue`) or a fresh match (`restart`). */
export const newGame = (mode: 'continue' | 'restart'): NewGameAct => ({ action: 'newGame', mode });
/** The `newGame` an `over` invites: `continue` mid-match, `restart` once the match is over (§7). */
export const newGameAfter = (over: OverBody): NewGameAct => newGame(over.matchOver ? 'restart' : 'continue');
/** One phase-stop bit; `turn` is relative to the viewing seat (M33). */
export const setPhaseStop = (phase: string, turn: 'own' | 'opp', stop: boolean): SetPhaseStopAct => ({
  action: 'setPhaseStop',
  phase,
  turn,
  stop,
});
/**
 * Pass until something: `endOfTurn`, `stack` (let it resolve) or a `marker`
 * on a phase. For a marker, `turn` names whose phase cell — "just before my
 * turn" is `yieldTo('marker', 'END_OF_TURN', 'opp')`. Cancelled by {@link cancel}.
 */
export function yieldTo(kind: YieldKind, phase?: string, turn?: 'own' | 'opp'): YieldToAct {
  const body: YieldToAct = { action: 'yieldTo', kind };
  if (phase !== undefined) body.phase = phase;
  if (turn !== undefined) body.turn = turn;
  return body;
}
/** Always-yes / always-no / clear for a stack item's bridge-minted `yieldKey` (M36). */
export const setYield = (yieldKey: string, mode: SetYieldMode): SetYieldAct => ({ action: 'setYield', yieldKey, mode });

// ---------------------------------------------------------------------------
// The guard.

/** What the guard needs to know about the session. A `PlaySnapshot` satisfies it. */
export interface GuardView {
  status: string;
  ask: { askId: string } | null;
  over: OverBody | null;
  /** The engine has pushed an `input` this game (M42: before that every act but concede is dropped). */
  inputSeen?: boolean;
}

/** Acts that only mean something between games. */
const BETWEEN_GAMES = new Set<ActBody['action']>(['newGame', 'nextGame']);

/**
 * Why `body` must not be sent now, or `null` when it may. Mirrors mtg-table:
 *
 *  - nothing is sent while the socket is not open, and nothing is queued
 *    (ws.ts: "a click describes the board you were looking at");
 *  - `newGame` / `nextGame` only after `over` (§2.2: one sent mid-game is
 *    dropped), and nothing else after `over` (the game is gone; §8.4);
 *  - while an `ask` is open the board is modal: only `concede` (§5.4) — the
 *    engine's game thread is parked on the question, and an act behind it is
 *    a click on a board that is about to change (the board's `askOpen`);
 *  - before the engine's first `input` of the game only `concede` (M42's
 *    pre-input guard, which the bridge answers with `Not yet`);
 *  - `claimWin` (M59, a table of two) goes wherever `concede` goes: it is
 *    the absent player's concede, and the bridge itself refuses it ("Not
 *    yet") before the grace has run out.
 */
export function whyNotAct(view: GuardView, body: ActBody): string | null {
  if (view.status !== 'open') return `not connected to the engine (${view.status}) — ${body.action} was not sent`;
  if (view.over !== null) {
    return BETWEEN_GAMES.has(body.action) ? null : 'the game is over';
  }
  if (BETWEEN_GAMES.has(body.action)) return 'a new game can only be started after this one is over';
  if (body.action === 'concede' || body.action === 'claimWin') return null;
  if (view.ask !== null) return 'answer the open question first';
  if (view.inputSeen === false) return 'the engine has not asked you anything yet';
  return null;
}

/** Why an answer to `askId` must not be sent now, or `null`. Exactly one answer per ask (§2.3). */
export function whyNotAnswer(view: GuardView, askId: string, answered: ReadonlySet<string>): string | null {
  if (view.status !== 'open') return `not connected to the engine (${view.status}) — the answer was not sent`;
  if (answered.has(askId)) return `question ${askId} was already answered`;
  if (view.ask === null) return 'there is no open question';
  if (view.ask.askId !== askId) return `question ${askId} is not the open one (${view.ask.askId})`;
  return null;
}
