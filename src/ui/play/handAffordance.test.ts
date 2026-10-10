/*
 * ForgeCoach — ui/play/handAffordance.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Which hand cards are a legal answer now, from the engine's word alone.
 */
import { describe, expect, it } from 'vitest';
import type { AskBody, Card, GameStateBody, InputBody, PlayableCard } from '../../protocol.ts';
import { handAnswers, playableHints, type HandAnswersIn } from './handAffordance.ts';
import { describeInput } from './inputView.ts';

const SEAT = 0;

function card(id: number, extra: Partial<Card> = {}): Card {
  return {
    id, name: `Card ${id}`, setCode: null, manaCost: '{1}', types: 'Instant', power: null, toughness: null, loyalty: null, damage: 0, counters: {},
    tapped: false, sick: false, attacking: false, blocking: false, faceDown: false, token: false, alt: null, attachedToId: null, attachmentIds: [],
    controller: SEAT, owner: SEAT, zone: 'hand', abilities: [], keywords: [], ...extra,
  } as unknown as Card;
}
const hiddenCard = (id: number) => ({ id, zone: 'hand', owner: SEAT, controller: SEAT, hidden: true });

const play = (cardId: number, zone: PlayableCard['zone'] = 'hand'): PlayableCard => ({ cardId, zone, abilities: [{ abilityId: 1, label: 'Cast', isSpell: true }] });

function stateOf(extra: Record<string, unknown> = {}, hand: unknown[] = [card(1), card(2), card(3)]): GameStateBody {
  return {
    turn: 3, round: 2, phase: 'MAIN1', activePlayer: SEAT, priority: SEAT,
    players: [
      { id: SEAT, name: 'Me', life: 20, zones: { hand: { count: hand.length, cards: hand } } },
      { id: 1, name: 'AI', life: 20, zones: { hand: { count: 5, cards: [hiddenCard(90)] } } },
    ],
    stack: [], stackCards: [], combat: null, events: [], ...extra,
  } as unknown as GameStateBody;
}

function inputOf(selectable: InputBody['selectable'] = { cardIds: [], min: 0, max: 0, mode: 'none' }): InputBody {
  return {
    prompt: 'Priority: Me\nTurn: 3 (Me)\nPhase: Main1\nStack: Empty', focusCardId: null, focusCard: null,
    buttons: { ok: { label: 'OK', enabled: true }, cancel: { label: 'End Turn', enabled: true }, focus: 'ok' },
    selectable, highlighted: [], weak: [], openZones: [],
  } as InputBody;
}

function run(over: { state?: GameStateBody | null; input?: InputBody | null; ask?: AskBody | null; mode?: string }): Set<number> | null {
  const state = over.state === undefined ? stateOf({ playable: [play(1)] }) : over.state;
  const input = over.input === undefined ? inputOf() : over.input;
  const ask = over.ask ?? null;
  const view = over.mode ? ({ mode: over.mode } as HandAnswersIn['view']) : describeInput(input, state, SEAT, { ask });
  return handAnswers({ view, input, state, ask, seat: SEAT });
}

describe('handAnswers: priority (state.playable)', () => {
  it('is the seat’s hand cards the engine lists as playable', () => {
    expect(run({ state: stateOf({ playable: [play(1), play(3)] }) })).toEqual(new Set([1, 3]));
  });
  it('ignores entries that are not in the hand (a graveyard card, a card not in this hand)', () => {
    expect(run({ state: stateOf({ playable: [play(2, 'graveyard'), play(77)] }) })).toEqual(new Set());
  });
  it('lists activatable entries only if one names a hand card', () => {
    const st = stateOf({ playable: [play(1)], activatable: [{ cardId: 50, zone: 'battlefield', abilities: [{ abilityId: 2, label: 'Equip', isSpell: false }] }] });
    expect(run({ state: st })).toEqual(new Set([1]));
  });
  it('an empty list is an answer of its own: nothing in the hand is playable', () => {
    expect(run({ state: stateOf({ playable: [] }) })).toEqual(new Set());
  });
  it('works at instant speed in the opponent’s turn (priority and stack modes)', () => {
    expect(run({ state: stateOf({ playable: [play(2)], activePlayer: 1 }), mode: 'priority' })).toEqual(new Set([2]));
    expect(run({ state: stateOf({ playable: [play(2)] }), mode: 'stack' })).toEqual(new Set([2]));
  });
});

describe('handAnswers: an explicit choice (input.selectable)', () => {
  it('is the selectable ids that are in the hand (a discard)', () => {
    const input = inputOf({ cardIds: [1, 3], min: 1, max: 1, mode: 'cards' });
    expect(run({ input, mode: 'discard' })).toEqual(new Set([1, 3]));
  });
  it('battlefield targets leave the hand with no answer at all', () => {
    const input = inputOf({ cardIds: [40, 41], min: 1, max: 1, mode: 'cards' });
    expect(run({ input, mode: 'target' })).toEqual(new Set());
  });
  it('wins over state.playable', () => {
    const input = inputOf({ cardIds: [2], min: 1, max: 1, mode: 'cards' });
    expect(run({ input, state: stateOf({ playable: [play(1)] }), mode: 'target' })).toEqual(new Set([2]));
  });
  it('a player-only choice says the answer is a portrait', () => {
    expect(run({ input: inputOf({ cardIds: [], min: 1, max: 1, mode: 'players' }), mode: 'target' })).toEqual(new Set());
  });
  it('M66: players listed and no card (mode "none") is a player-only choice: no hand card is an answer', () => {
    const only = { ...inputOf({ cardIds: [], min: 1, max: 1, mode: 'none', playerIds: [1] }), prompt: 'Lava Spike - Select target player', buttons: { ok: { label: 'OK', enabled: false }, cancel: { label: 'Cancel', enabled: true } } } as InputBody;
    expect(run({ input: only, state: stateOf({ playable: [play(1)] }) })).toEqual(new Set());
  });
  it('M66: [] and null say nothing new — priority still reads state.playable', () => {
    expect(run({ input: inputOf({ cardIds: [], min: 0, max: 0, mode: 'none', playerIds: [] }) })).toEqual(new Set([1]));
    expect(run({ input: inputOf({ cardIds: [], min: 0, max: 0, mode: 'none', playerIds: null }) })).toEqual(new Set([1]));
  });
  it('M66: an attack declaration’s defenders are not a player-only choice', () => {
    expect(run({ input: inputOf({ cardIds: [], min: 0, max: 0, mode: 'none', playerIds: [1] }), mode: 'attack' })).toBeNull();
  });
  it('mode cards with no ids says nothing', () => {
    expect(run({ input: inputOf({ cardIds: [], min: 0, max: 0, mode: 'cards' }), state: stateOf(), mode: 'target' })).toBeNull();
  });
});

describe('handAnswers: an open ask', () => {
  const ask = (options: unknown[]): AskBody => ({ askId: 'a1', kind: 'choose_list', timeoutMs: 1000, prompt: 'Choose', options, min: 1, max: 1, reveal: false, preselected: [] }) as unknown as AskBody;
  it('is the cards its options carry', () => {
    const a = ask([
      { id: 0, label: 'Card 2', kind: 'card', cardId: 2, card: card(2) },
      { id: 1, label: 'Card 40', kind: 'card', cardId: 40, card: card(40, { zone: 'graveyard' }) },
    ]);
    expect(run({ ask: a })).toEqual(new Set([2]));
  });
  it('wins over selectable and playable', () => {
    const a = ask([{ id: 0, label: 'Card 3', kind: 'card', card: card(3) }]);
    expect(run({ ask: a, input: inputOf({ cardIds: [1], min: 1, max: 1, mode: 'cards' }) })).toEqual(new Set([3]));
  });
  it('an ask with no card in it says nothing about the hand', () => {
    expect(run({ ask: ask([{ id: 0, label: 'Yes', kind: 'other' }]) })).toBeNull();
  });
  it('a hidden card in an option is never an answer', () => {
    const a = ask([
      { id: 0, label: '???', kind: 'card', cardId: 2, card: hiddenCard(2) },
      { id: 1, label: 'Card 3', kind: 'card', card: card(3) },
    ]);
    expect(run({ ask: a })).toEqual(new Set([3]));
  });
});

describe('handAnswers: when the engine says nothing, nothing is dimmed (null)', () => {
  it('an older engine: no playable key', () => {
    expect(run({ state: stateOf() })).toBeNull();
  });
  it('playable null (off the seat’s priority)', () => {
    expect(run({ state: stateOf({ playable: null }) })).toBeNull();
  });
  it('no input yet, no state, no seat', () => {
    expect(run({ input: null })).toBeNull();
    expect(run({ state: null })).toBeNull();
    expect(handAnswers({ view: { mode: 'main' }, input: inputOf(), state: stateOf({ playable: [play(1)] }), ask: null, seat: null })).toBeNull();
  });
  it('waiting on the opponent, a yield, the end of the game', () => {
    for (const mode of ['waiting', 'yield', 'over']) expect(run({ mode, state: stateOf({ playable: [play(1)] }) })).toBeNull();
  });
  it('modes that are not priority and carry no choice (pay, mulligan, attack with no ids)', () => {
    for (const mode of ['pay', 'mulligan', 'attack', 'block']) expect(run({ mode, state: stateOf({ playable: [play(1)] }) })).toBeNull();
  });
});

describe('handAnswers: hidden cards', () => {
  it('a hidden card in the hand is never an answer, even if its id is listed', () => {
    const st = stateOf({ playable: [play(1), play(2)] }, [card(1), hiddenCard(2)]);
    expect(run({ state: st })).toEqual(new Set([1]));
    const sel = inputOf({ cardIds: [2], min: 1, max: 1, mode: 'cards' });
    expect(run({ state: st, input: sel, mode: 'discard' })).toEqual(new Set());
  });
});

describe('playableHints (the is-hint glow)', () => {
  it('follows state.playable at priority', () => {
    expect(playableHints(stateOf({ playable: [play(1), play(3)] }), 'main')).toEqual(new Set([1, 3]));
  });
  it('is null (no glow) on an older engine, off priority, or in a mode the engine does not list for', () => {
    expect(playableHints(stateOf(), 'main')).toBeNull();
    expect(playableHints(stateOf({ playable: null }), 'main')).toBeNull();
    expect(playableHints(stateOf({ playable: [play(1)] }), 'pay')).toBeNull();
    expect(playableHints(null, 'main')).toBeNull();
  });
});
