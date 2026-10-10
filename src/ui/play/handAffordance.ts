/*
 * ForgeCoach — ui/play/handAffordance.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Which cards in the seat's hand are a legal answer RIGHT NOW, read only from
 * what the engine says (endstep's dimmed hand). Pure (no React, no DOM) so it
 * is tested in node.
 *
 * Nothing here computes legality. The sources, in order:
 *   1. an open ask: the cards its options carry (`ask.options[].card`);
 *   2. an explicit choice: `input.selectable` (targets, a discard, blockers…);
 *      a choice of players only (M66 `selectable.playerIds` listing someone,
 *      no card) has no hand card for an answer;
 *   3. priority: M61 `state.playable` (and M63 `activatable`, if it ever lists
 *      a hand card) — the cards Forge says a click would play.
 * When the engine says nothing — an older engine with no `playable`, no input,
 * waiting on the opponent, an ask with no card in it — the answer is `null`,
 * which means "dim NOTHING", never "nothing is legal". An EMPTY set means the
 * engine did say, and no hand card is an answer. A hidden card is never one.
 */
import type { AnyCard, AskBody, Card, GameStateBody, InputBody } from '../../protocol.ts';
import { activatableOf, isHidden, playableOf, selectablePlayersOf } from '../../protocol.ts';
import type { InputView } from './inputView.ts';

export interface HandAnswersIn {
  view: Pick<InputView, 'mode'> | null;
  input: InputBody | null;
  state: GameStateBody | null;
  ask: AskBody | null;
  seat: number | null;
}

/** The modes in which `state.playable` speaks (the same ones `inputView.ts` `cardRole` reads it in). */
const AT_PRIORITY = new Set(['main', 'priority', 'stack']);

/** The seat's own visible hand cards. */
function handOf(state: GameStateBody | null, seat: number | null): Card[] {
  if (!state || seat === null) return [];
  const me = state.players.find((p) => p.id === seat);
  return (me?.zones.hand.cards ?? []).filter((c: AnyCard): c is Card => !isHidden(c));
}

function onlyHand(ids: Iterable<number>, hand: Card[]): Set<number> {
  const want = new Set(ids);
  return new Set(hand.filter((c) => want.has(c.id)).map((c) => c.id));
}

/** The ids of cards an ask's options carry. A hidden card carries none. */
function askCardIds(ask: AskBody): number[] | null {
  const options = (ask as { options?: unknown }).options;
  if (!Array.isArray(options)) return null;
  const out: number[] = [];
  for (const o of options as { card?: AnyCard; cardId?: number }[]) {
    if (o?.card) {
      if (!isHidden(o.card)) out.push(o.card.id);
    } else if (typeof o?.cardId === 'number') out.push(o.cardId);
  }
  return out.length > 0 ? out : null;
}

/** The hand cards that are a legal answer now, or `null` when the engine does not say (dim nothing). */
export function handAnswers({ view, input, state, ask, seat }: HandAnswersIn): Set<number> | null {
  if (seat === null || !state) return null;
  const hand = handOf(state, seat);
  if (ask) {
    const ids = askCardIds(ask);
    return ids ? onlyHand(ids, hand) : null;
  }
  if (!input || !view) return null;
  const mode = view.mode;
  if (mode === 'waiting' || mode === 'over' || mode === 'yield' || mode === 'ask') return null;
  const sel = input.selectable;
  if (sel && sel.mode === 'cards' && sel.cardIds.length > 0) return onlyHand(sel.cardIds, hand);
  // "Select target player": the engine says the answer is a portrait, not a card —
  // `mode: "players"`, or (M66) players listed and no card (a player-only choice reads mode "none").
  if (sel && sel.mode === 'players') return new Set();
  // (An attack declaration lists its defenders the same way; it is not a player-only choice.)
  if (sel && mode !== 'attack' && sel.cardIds.length === 0 && (selectablePlayersOf(input)?.length ?? 0) > 0) return new Set();
  if (!AT_PRIORITY.has(mode)) return null;
  const playable = playableOf(state);
  if (!playable) return null;
  const ids = playable.filter((e) => e.zone === 'hand').map((e) => e.cardId);
  for (const e of activatableOf(state) ?? []) if ((e.zone as string) === 'hand') ids.push(e.cardId);
  return onlyHand(ids, hand);
}

/**
 * The cards the `is-hint` glow follows: what `state.playable` lists, at the
 * seat's own priority. `null` is no glow at all (an older engine, or off the
 * seat's priority) — the board never works out for itself what can be paid.
 */
export function playableHints(state: GameStateBody | null, mode: InputView['mode'] | null): ReadonlySet<number> | null {
  if (!state || !mode || !AT_PRIORITY.has(mode)) return null;
  const playable = playableOf(state);
  return playable ? new Set(playable.map((e) => e.cardId)) : null;
}
