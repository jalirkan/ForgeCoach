/*
 * ForgeCoach — ui/play/combatBadges.test.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The pair badges on the board ("you can't tell who you're blocking"): the
 * attacker and its blocker carry the same number (a line joins them,
 * combatLayout.ts), an attacker nothing blocks carries none, and the card
 * picked first in a block gesture is drawn lifted (`is-armed`).
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import type { Card } from '../../protocol.ts';
import { BoardMarksContext, PlayContext, type PlayInteraction } from '../cardContext.ts';
import { CardTile } from '../CardTile.tsx';
import { combatMarks } from './combatLines.ts';

function creature(id: number, controller: number, extra: Partial<Card> = {}): Card {
  return {
    id, name: `C${id}`, setCode: null, manaCost: '{1}', types: 'Creature - Bear', power: '2', toughness: '2', loyalty: null, damage: 0, counters: {},
    tapped: false, sick: false, attacking: false, blocking: false, faceDown: false, token: false, alt: null, attachedToId: null, attachmentIds: [],
    controller, owner: controller, zone: 'battlefield', abilities: [], ...extra,
  } as unknown as Card;
}

describe('combat badges on tiles', () => {
  const atk = creature(9, 1, { attacking: true });
  const blk = creature(1, 0, { blocking: true });
  const st = {
    turn: 4, round: 2, phase: 'COMBAT_DECLARE_BLOCKERS', activePlayer: 1, priority: 0,
    players: [
      { id: 0, name: 'Human', life: 20, zones: { battlefield: { count: 1, cards: [blk] } } },
      { id: 1, name: 'Forge AI', life: 20, zones: { battlefield: { count: 1, cards: [atk] } } },
    ],
    stack: [], stackCards: [], events: [],
    combat: { bands: [{ attackerIds: [9], defender: { kind: 'player', id: 0 }, blockerIds: [1], damageOrder: [1] }] },
  } as never;

  test('the attacker and its blocker wear the same number', () => {
    const html = renderToStaticMarkup(
      <BoardMarksContext.Provider value={{ stack: new Map(), combat: combatMarks(st) }}>
        <CardTile card={atk} side="opp" />
        <CardTile card={blk} side="me" />
      </BoardMarksContext.Provider>,
    );
    expect(html).toMatch(/is-pair-attacker[\s\S]*tile-pair pair-attacker[^>]*>1</);
    expect(html).toMatch(/is-pair-blocker[\s\S]*tile-pair pair-blocker[^>]*>1</);
    expect(html).toContain('aria-label="Blocks attacker 1"');
  });

  test('an attacker nothing blocks wears no badge', () => {
    const lone = { ...(st as object), combat: { bands: [{ attackerIds: [9], defender: { kind: 'player', id: 0 }, blockerIds: [], damageOrder: [] }] } } as never;
    const html = renderToStaticMarkup(
      <BoardMarksContext.Provider value={{ stack: new Map(), combat: combatMarks(lone) }}>
        <CardTile card={atk} side="opp" />
      </BoardMarksContext.Provider>,
    );
    expect(html).not.toContain('tile-pair');
    expect(html).not.toContain('is-pair-attacker');
  });

  test('the card picked first in a block is drawn armed', () => {
    const play: PlayInteraction = {
      mark: () => 'act', hint: () => false, click: () => undefined, chosen: () => null, blockersFor: () => [],
      playerMark: () => false, clickPlayer: () => undefined, armed: (c) => c.id === 1,
    };
    const html = renderToStaticMarkup(
      <PlayContext.Provider value={play}>
        <CardTile card={blk} side="me" />
        <CardTile card={atk} side="opp" />
      </PlayContext.Provider>,
    );
    expect(html.match(/is-armed/g)?.length).toBe(1);
    expect(html).toMatch(/is-armed[^"]*" role="button" tabindex="0" aria-label="C1/);
  });

  test('no combat: no badges', () => {
    const html = renderToStaticMarkup(<CardTile card={atk} side="opp" />);
    expect(html).not.toContain('tile-pair');
  });
});
