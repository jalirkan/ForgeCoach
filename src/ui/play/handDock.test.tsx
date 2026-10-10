/*
 * ForgeCoach — ui/play/handDock.test.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The hand dock in a server render: data-answers on the dock and the per-tile
 * dim for cards that are not an answer; nothing dimmed when the engine says
 * nothing or there is no play board (replay).
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Card, GameStateBody, InputBody, PlayerState } from '../../protocol.ts';
import { HandDock } from './HandDock.tsx';
import { describeInput } from './inputView.ts';
import { PlayBoardContext, type PlayBoard } from './playBoard.ts';

function card(id: number, extra: Partial<Card> = {}): Card {
  return {
    id, name: `Card ${id}`, setCode: null, manaCost: '{1}', types: 'Instant', power: null, toughness: null, loyalty: null, damage: 0, counters: {},
    tapped: false, sick: false, attacking: false, blocking: false, faceDown: false, token: false, alt: null, attachedToId: null, attachmentIds: [],
    controller: 0, owner: 0, zone: 'hand', abilities: [], keywords: [], ...extra,
  } as unknown as Card;
}
const me = (hand: unknown[]) => ({ id: 0, name: 'Me', life: 20, zones: { hand: { count: hand.length, cards: hand } } }) as unknown as PlayerState;

const INPUT = {
  prompt: 'Priority: Me\nTurn: 3 (Me)\nPhase: Main1\nStack: Empty', focusCardId: null, focusCard: null,
  buttons: { ok: { label: 'OK', enabled: true }, cancel: { label: 'End Turn', enabled: true }, focus: 'ok' },
  selectable: { cardIds: [], min: 0, max: 0, mode: 'none' }, highlighted: [], weak: [], openZones: [],
} as InputBody;

function boardOf(hand: unknown[], extra: Record<string, unknown>): PlayBoard {
  const player = me(hand);
  const state = {
    turn: 3, round: 2, phase: 'MAIN1', activePlayer: 0, priority: 0, players: [player], stack: [], stackCards: [], combat: null, events: [], ...extra,
  } as unknown as GameStateBody;
  return { state, input: INPUT, ask: null, seat: 0, log: null, view: describeInput(INPUT, state, 0, { ask: null }), connected: true, over: false, act: () => undefined, canAct: true };
}

function dock(hand: unknown[], board: PlayBoard | null, collapsed = false): string {
  return renderToStaticMarkup(
    <PlayBoardContext.Provider value={board}>
      <HandDock player={me(hand)} landOpen={null} collapsed={collapsed} onToggle={() => undefined} />
    </PlayBoardContext.Provider>,
  );
}
const tiles = (html: string) => html.split('<div class="tile ').slice(1);
const play = (cardId: number) => ({ cardId, zone: 'hand', abilities: [{ abilityId: 1, label: 'Cast', isSpell: true }] });

describe('HandDock affordance', () => {
  const hand = [card(1), card(2), card(3)];

  it('sets data-answers and dims the cards that are not listed as playable', () => {
    const html = dock(hand, boardOf(hand, { playable: [play(1), play(3)] }));
    expect(html).toContain('data-answers="2"');
    const t = tiles(html);
    expect(t).toHaveLength(3);
    expect(t[0]).not.toMatch(/^[^"]*\bis-dim\b/);
    expect(t[1]).toMatch(/^[^"]*\bis-dim\b/);
    expect(t[2]).not.toMatch(/^[^"]*\bis-dim\b/);
  });

  it('an engine that lists nothing playable dims the whole hand (data-answers="0")', () => {
    const html = dock(hand, boardOf(hand, { playable: [] }));
    expect(html).toContain('data-answers="0"');
    expect(html.match(/is-dim/g)).toHaveLength(3);
  });

  it('dims nothing, and sets no data-answers, on an older engine', () => {
    const html = dock(hand, boardOf(hand, {}));
    expect(html).not.toContain('data-answers');
    expect(html).not.toContain('is-dim');
  });

  it('dims nothing without a play board (replay)', () => {
    const html = dock(hand, null);
    expect(html).not.toContain('data-answers');
    expect(html).not.toContain('is-dim');
  });

  it('a hidden card is a plain back, never a dimmed tile', () => {
    const mixed = [card(1), { id: 2, zone: 'hand', owner: 0, controller: 0, hidden: true }];
    const html = dock(mixed, boardOf(mixed, { playable: [play(1), play(2)] }));
    expect(html).toContain('data-answers="1"');
    expect(html).not.toContain('is-dim');
    expect(html).toContain('card-back');
  });

  it('the folded strip dims its peek cards the same way', () => {
    const html = dock(hand, boardOf(hand, { playable: [play(1)] }), true);
    expect(html.match(/peek-card is-dim/g)).toHaveLength(2);
  });

  it('keeps the dock’s own selectors and the tiles’ is-hint / data-mark hooks', () => {
    const html = dock(hand, boardOf(hand, { playable: [play(1)] }));
    expect(html).toContain('class="hand-dock');
    expect(html).toContain('hand-dock-row');
    expect(html).toContain('data-card-id="1"');
  });
});
