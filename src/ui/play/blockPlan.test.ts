/*
 * ForgeCoach — ui/play/blockPlan.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Declaring blocks blocker first, as the engine's own attacker-first clicks
 * (Forge's InputBlock): which `clickCard` acts each pair of clicks sends, in
 * order — assign, double block, remove by re-clicking, move to another
 * attacker, No blocks — Skip combat's acts, and the words for a block or an
 * attack the engine refused.
 */
import { describe, expect, it } from 'vitest';
import type { Card, GameStateBody } from '../../protocol.ts';
import { assignBlock, attackRefusal, blockGesture, blockRefusal, noBlocksClicks, refusalLine, refusedCard, skipCombatActs, skipMustWait } from './blockPlan.ts';

const m = (pairs: [number, number | null][]) => new Map(pairs);

describe('a pair of clicks, as the engine’s clicks', () => {
  it('assign: the attacker is named first (unless the prompt already names it), then the creature', () => {
    expect(assignBlock(1, 9, 8, m([]))).toEqual({ clicks: [9, 1], next: m([[1, 9]]), tries: { blocker: 1, attacker: 9 } });
    expect(assignBlock(1, 9, 9, m([]))).toEqual({ clicks: [1], next: m([[1, 9]]), tries: { blocker: 1, attacker: 9 } });
    expect(assignBlock(1, 9, null, m([])).clicks).toEqual([9, 1]);
  });

  it('a double block: a second creature onto the same attacker', () => {
    expect(assignBlock(2, 9, 9, m([[1, 9]]))).toEqual({ clicks: [2], next: m([[1, 9], [2, 9]]), tries: { blocker: 2, attacker: 9 } });
  });

  it('remove: a creature, then the attacker it already blocks — the same clicks, and the engine takes it off', () => {
    expect(assignBlock(1, 9, 8, m([[1, 9], [2, 9]]))).toEqual({ clicks: [9, 1], next: m([[2, 9]]), tries: null });
    expect(assignBlock(1, 9, 9, m([[1, 9]])).clicks).toEqual([1]);
  });

  it('move: a creature blocking another attacker — off that one, onto this one', () => {
    expect(assignBlock(1, 9, 9, m([[1, 8]]))).toEqual({ clicks: [8, 1, 9, 1], next: m([[1, 9]]), tries: { blocker: 1, attacker: 9 } });
    // Its own attacker is the named one: no click to name it.
    expect(assignBlock(1, 9, 8, m([[1, 8]])).clicks).toEqual([1, 9, 1]);
  });
});

describe('blockGesture: blocker first (the other order works too)', () => {
  it('your creature is picked, then the attacker completes the pair', () => {
    const one = blockGesture(null, { kind: 'blocker', id: 1 }, 9, m([]));
    expect(one).toEqual({ pick: { kind: 'blocker', id: 1 }, plan: null });
    const two = blockGesture(one.pick, { kind: 'attacker', id: 8 }, 9, m([]));
    expect(two.pick).toBe(null);
    expect(two.plan!.clicks).toEqual([8, 1]);
  });

  it('an attacker first, then your creature: the same pair', () => {
    const one = blockGesture(null, { kind: 'attacker', id: 8 }, 9, m([]));
    expect(one.pick).toEqual({ kind: 'attacker', id: 8 });
    expect(blockGesture(one.pick, { kind: 'blocker', id: 1 }, 9, m([])).plan!.clicks).toEqual([8, 1]);
  });

  it('a second click on the picked card puts it down; another of its kind is picked instead; nothing is sent', () => {
    expect(blockGesture({ kind: 'blocker', id: 1 }, { kind: 'blocker', id: 1 }, 9, m([]))).toEqual({ pick: null, plan: null });
    expect(blockGesture({ kind: 'blocker', id: 1 }, { kind: 'blocker', id: 2 }, 9, m([]))).toEqual({ pick: { kind: 'blocker', id: 2 }, plan: null });
  });
});

describe('No blocks and Skip combat', () => {
  it('No blocks takes every block off, attacker by attacker, naming each only when it is not named', () => {
    expect(noBlocksClicks(9, m([[1, 9], [2, 8], [3, 9]]))).toEqual([1, 3, 8, 2]);
    expect(noBlocksClicks(7, m([[1, 9]]))).toEqual([9, 1]);
    expect(noBlocksClicks(9, m([]))).toEqual([]);
    // A blocker the wire did not pair is left alone: a click could be taken as a new block.
    expect(noBlocksClicks(9, m([[1, null]]))).toEqual([]);
  });

  it('waits for the engine’s answer to the last click before reading its label or its chosen', () => {
    expect(skipMustWait(null, 7)).toBe(false);
    expect(skipMustWait(7, 7)).toBe(true);
    expect(skipMustWait(7, 8)).toBe(false);
  });

  it('Skip combat: OK alone, or the engine’s Call Back first while it reads so', () => {
    expect(skipCombatActs({ label: 'Alpha Strike', enabled: true })).toEqual([{ action: 'buttonOk' }]);
    expect(skipCombatActs({ label: 'Call Back', enabled: true })).toEqual([{ action: 'buttonCancel' }, { action: 'buttonOk' }]);
    expect(skipCombatActs({ label: 'Call Back', enabled: false })).toEqual([{ action: 'buttonOk' }]);
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

  it('reach or flying blocks a flyer, so the engine had another reason: say so', () => {
    expect(blockRefusal('Not selectable', 'card 4 cannot be selected now', s, null, 9, 0)).toBe(
      "Giant Spider can't block Bird Token: not a legal block for this attacker.",
    );
    expect(blockRefusal('Not selectable', 'card 3 cannot be selected now', s, null, 8, 0)).toMatch(/^Thraben Inspector can't block Grizzly Bears: not a legal block/);
  });

  it('only rewords the seat’s own creature on the battlefield; other notices keep their words', () => {
    expect(blockRefusal('Not selectable', 'card 9 cannot be selected now', s, null, 9, 0)).toBe(null);
    expect(blockRefusal('Not now', 'card 3', s, null, 9, 0)).toBe(null);
    expect(blockRefusal('Not selectable', 'card 77 cannot be selected now', s, null, 9, 0)).toBe(null);
    expect(refusalLine({ blocker: { name: 'Bear', keywords: [] }, attacker: { name: '', keywords: [] } })).toBe(
      "Bear can't block that attacker: not a legal block for this attacker.",
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

describe('refusals when the bridge names the card by its label (real Forge: "Flayer Husk cannot be selected now")', () => {
  const husk = card(63, 'Flayer Husk', 0, { types: 'Artifact - Equipment', power: null, toughness: null } as Partial<Card>);
  const germ = card(64, 'Phyrexian Germ Token', 0, { token: true });
  const goblin = card(9, 'Goblin Guide', 1, { attacking: true });
  const s = state([husk, germ], [goblin]);

  it('the card by "Name (id)", by its name alone, or by "card id"', () => {
    expect(refusedCard('Flayer Husk (63) cannot be selected now', s, 0)?.id).toBe(63);
    expect(refusedCard('Flayer Husk cannot be selected now', s, 0)?.id).toBe(63);
    expect(refusedCard('card 64 cannot be selected now', s, 0)?.id).toBe(64);
    expect(refusedCard('Nobody cannot be selected now', s, 0)).toBeNull();
  });

  it('a non-creature: only creatures block, only creatures attack', () => {
    expect(blockRefusal('Not selectable', 'Flayer Husk cannot be selected now', s, null, 9, 0)).toBe("Flayer Husk can't block: only creatures block.");
    expect(attackRefusal('Not selectable', 'Flayer Husk (63) cannot be selected now', s, 0)).toBe("Flayer Husk can't attack: only creatures attack.");
  });

  it('a creature named by its label gets the usual line', () => {
    expect(blockRefusal('Not selectable', 'Phyrexian Germ Token cannot be selected now', s, { blocker: 64, attacker: 9 }, 9, 0)).toMatch(/^Phyrexian Germ Token can't block Goblin Guide/);
  });
});
