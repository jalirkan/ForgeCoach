/*
 * ForgeCoach — ui/play/blockPlan.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Declaring blocks as the engine's own clicks (Forge's InputBlock): which
 * `clickCard` acts each gesture sends, in order — assign, take off, move to
 * another attacker, the × — and the words for a block or an attack the
 * engine refused.
 */
import { describe, expect, it } from 'vitest';
import type { Card, GameStateBody } from '../../protocol.ts';
import { attackRefusal, blockRefusal, clickAttacker, clickBlocker, refusalLine, takeOff } from './blockPlan.ts';

const m = (pairs: [number, number | null][]) => new Map(pairs);

describe('the clicks a block gesture sends', () => {
  it('an attacker: one click, it becomes the one blocks go to', () => {
    expect(clickAttacker(9, m([[1, 8]]))).toEqual({ clicks: [9], next: m([[1, 8]]), tries: null });
  });

  it('a free creature: one click, it blocks the named attacker', () => {
    expect(clickBlocker(1, 9, m([]))).toEqual({ clicks: [1], next: m([[1, 9]]), tries: { blocker: 1, attacker: 9 } });
  });

  it('a creature blocking the named attacker: one click, the engine takes the block off', () => {
    expect(clickBlocker(1, 9, m([[1, 9], [2, 9]]))).toEqual({ clicks: [1], next: m([[2, 9]]), tries: null });
    // The wire did not say which attacker: the click is the engine's to judge, as before.
    expect(clickBlocker(1, 9, m([[1, null]])).clicks).toEqual([1]);
  });

  it('a creature blocking another attacker: move it — off that one, onto the named one', () => {
    expect(clickBlocker(1, 9, m([[1, 8]]))).toEqual({ clicks: [8, 1, 9, 1], next: m([[1, 9]]), tries: { blocker: 1, attacker: 9 } });
  });

  it('no attacker named: the click goes to the engine and nothing is assumed', () => {
    expect(clickBlocker(1, null, m([]))).toEqual({ clicks: [1], next: m([]), tries: null });
  });

  it('the ×: off its attacker, and the named attacker named again', () => {
    expect(takeOff(1, 9, m([[1, 9]]))).toEqual({ clicks: [1], next: m([]), tries: null });
    expect(takeOff(1, 9, m([[1, 8], [2, 9]]))).toEqual({ clicks: [8, 1, 9], next: m([[2, 9]]), tries: null });
    expect(takeOff(1, null, m([[1, 8]])).clicks).toEqual([8, 1]);
    expect(takeOff(3, 9, m([[1, 9]])).clicks).toEqual([]);
  });
});

function card(id: number, name: string, controller: number, extra: Partial<Card> = {}): Card {
  return {
    id, name, setCode: null, manaCost: '{1}', types: 'Creature - Bird', power: '1', toughness: '1', loyalty: null, damage: 0, counters: {},
    tapped: false, sick: false, attacking: false, blocking: false, faceDown: false, token: false, alt: null, attachedToId: null, attachmentIds: [],
    controller, owner: controller, zone: 'battlefield', abilities: [], keywords: [], ...extra,
  } as unknown as Card;
}
function state(mine: Card[], theirs: Card[]): GameStateBody {
  const z = (bf: Card[]) => ({ battlefield: { count: bf.length, cards: bf } });
  return { players: [{ id: 0, name: 'You', zones: z(mine) }, { id: 1, name: 'Forge AI', zones: z(theirs) }] } as unknown as GameStateBody;
}

describe('a refused block, in the game’s terms', () => {
  const bird = card(9, 'Bird Token', 1, { keywords: ['FLYING'], attacking: true, token: true });
  const inspector = card(3, 'Thraben Inspector', 0, { sick: true });
  const spider = card(4, 'Giant Spider', 0, { keywords: ['REACH'] });
  const s = state([inspector, spider], [bird, card(8, 'Grizzly Bears', 1, { attacking: true })]);

  it('a flyer: "can’t block a flyer", never "cannot be selected now"', () => {
    const line = blockRefusal('Not selectable', 'card 3 cannot be selected now', s, { blocker: 3, attacker: 9 }, 9, 0);
    expect(line).toBe("Thraben Inspector can't block Bird Token: it can't block a flyer.");
    expect(line).not.toMatch(/selected now|summoning|sick/i);
  });

  it('reach or flying blocks a flyer, so the engine had another reason: say so and point at the attackers', () => {
    expect(blockRefusal('Not selectable', 'card 4 cannot be selected now', s, null, 9, 0)).toBe(
      "Giant Spider can't block Bird Token: not a legal block for this attacker. Click another attacker first.",
    );
    expect(blockRefusal('Not selectable', 'card 3 cannot be selected now', s, null, 8, 0)).toMatch(/^Thraben Inspector can't block Grizzly Bears: not a legal block/);
  });

  it('only rewords the seat’s own creature on the battlefield; other notices keep their words', () => {
    expect(blockRefusal('Not selectable', 'card 9 cannot be selected now', s, null, 9, 0)).toBe(null);
    expect(blockRefusal('Not now', 'card 3', s, null, 9, 0)).toBe(null);
    expect(blockRefusal('Not selectable', 'card 77 cannot be selected now', s, null, 9, 0)).toBe(null);
    expect(refusalLine({ blocker: { name: 'Bear', keywords: [] }, attacker: { name: '', keywords: [] } })).toBe(
      "Bear can't block that attacker: not a legal block for this attacker. Click another attacker first.",
    );
  });
});

describe('a refused attacker', () => {
  const lark = card(5, 'Reveillark', 0, { sick: true, keywords: ['FLYING'] });
  const goblin = card(6, 'Raging Goblin', 0, { sick: true, keywords: ['HASTE'] });
  const s = state([lark, goblin], []);
  it('names the reason when the card’s own flag says it entered this turn', () => {
    expect(attackRefusal('Not selectable', 'card 5 cannot be selected now', s, 0)).toBe("Reveillark can't attack: it entered this turn.");
  });
  it('otherwise says it is not a legal attacker (haste: the flag is not the reason)', () => {
    expect(attackRefusal('Not selectable', 'card 6 cannot be selected now', s, 0)).toBe("Raging Goblin can't attack: not a legal attacker.");
    expect(attackRefusal('Not selectable', 'card 6 cannot be selected now', s, 1)).toBe(null);
  });
});
