/*
 * ForgeCoach — ui/play/combatBadges.test.tsx
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The pair badges on the board ("you can't tell who you're blocking"): the
 * attacker and its blocker carry the same number (the blocker also sits in
 * front of it, combatLayout.ts), and the attacker a block click goes to is
 * marked.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import type { Card } from '../../protocol.ts';
import { BoardMarksContext } from '../cardContext.ts';
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

  test('the attacker a block click goes to now is marked "current"', () => {
    const html = renderToStaticMarkup(
      <BoardMarksContext.Provider value={{ stack: new Map(), combat: combatMarks(st, new Map(), new Set(), 9) }}>
        <CardTile card={atk} side="opp" />
      </BoardMarksContext.Provider>,
    );
    expect(html).toContain('is-pair-current');
    expect(html).toMatch(/tile-pair pair-attacker is-current/);
  });

  test('no combat: no badges', () => {
    const html = renderToStaticMarkup(<CardTile card={atk} side="opp" />);
    expect(html).not.toContain('tile-pair');
  });
});
