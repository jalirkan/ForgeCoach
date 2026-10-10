/*
 * ForgeCoach — ui/play/combatLines.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import type { AnyCard, CombatBand, GameStateBody } from '../../protocol.ts';
import { combatLinks, combatMarks, curveBetween, lanes } from './combatLines.ts';

function creature(id: number, controller: number): AnyCard {
  return {
    id,
    name: `C${id}`,
    setCode: null,
    manaCost: '{1}',
    types: 'Creature - Bear',
    power: '2',
    toughness: '2',
    loyalty: null,
    damage: 0,
    counters: {},
    tapped: false,
    sick: false,
    attacking: false,
    blocking: false,
    faceDown: false,
    token: false,
    alt: null,
    attachedToId: null,
    attachmentIds: [],
    controller,
    owner: controller,
    zone: 'battlefield',
    abilities: [],
  };
}
const hidden = (id: number, controller: number): AnyCard => ({ id, zone: 'battlefield', controller, owner: controller, hidden: true });

function state(bf0: AnyCard[], bf1: AnyCard[], bands: CombatBand[] | null): GameStateBody {
  const zones = (bf: AnyCard[]) => ({
    hand: { count: 0, cards: [] },
    battlefield: { count: bf.length, cards: bf },
    graveyard: { count: 0, cards: [] },
    exile: { count: 0, cards: [] },
    command: { count: 0, cards: [] },
    library: { count: 30, cards: [] },
  });
  return {
    turn: 3,
    round: 2,
    phase: 'COMBAT_DECLARE_BLOCKERS',
    activePlayer: 1,
    priority: 0,
    players: [
      { id: 0, name: 'You', life: 20, zones: zones(bf0) },
      { id: 1, name: 'Forge AI', life: 20, zones: zones(bf1) },
    ],
    stack: [],
    stackCards: [],
    combat: bands ? { bands } : null,
    events: [],
  } as unknown as GameStateBody;
}

const band = (attackerIds: number[], blockerIds: number[], defender: CombatBand['defender'] = { kind: 'player', id: 0 }): CombatBand => ({
  attackerIds,
  defender,
  blockerIds,
  damageOrder: blockerIds,
});

describe('combatLinks', () => {
  it('draws nothing outside combat', () => {
    expect(combatLinks(state([creature(1, 0)], [creature(9, 1)], null))).toEqual([]);
    expect(combatLinks(null)).toEqual([]);
  });

  it('draws an unblocked attacker at the player it attacks', () => {
    const links = combatLinks(state([creature(1, 0)], [creature(9, 1)], [band([9], [])]));
    expect(links).toEqual([{ kind: 'attack', from: { card: 9 }, to: { player: 0 }, n: 0, pending: false }]);
  });

  it('numbers confirmed blocks per attacker, both blockers sharing the number', () => {
    const links = combatLinks(
      state([creature(1, 0), creature(2, 0), creature(3, 0)], [creature(9, 1), creature(8, 1)], [band([9], [1, 2]), band([8], [3])]),
    );
    expect(links.map((l) => [l.from, l.to, l.n])).toEqual([
      [{ card: 1 }, { card: 9 }, 1],
      [{ card: 2 }, { card: 9 }, 1],
      [{ card: 3 }, { card: 8 }, 2],
    ]);
    // A blocked attacker gets no line to the player.
    expect(links.some((l) => l.kind === 'attack')).toBe(false);
  });

  it('adds this browser’s unconfirmed blocks, and the engine wins over them', () => {
    const s = state([creature(1, 0), creature(2, 0)], [creature(9, 1)], [band([9], [2])]);
    const links = combatLinks(
      s,
      new Map([
        [1, 9],
        [2, 9],
      ]),
    );
    expect(links).toEqual([
      { kind: 'block', from: { card: 2 }, to: { card: 9 }, n: 1, pending: false },
      { kind: 'block', from: { card: 1 }, to: { card: 9 }, n: 1, pending: true },
    ]);
  });

  it('skips a pick with no attacker named, and ids the viewer cannot see', () => {
    const s = state([creature(1, 0)], [hidden(9, 1), creature(8, 1)], [band([9], []), band([8], [], null)]);
    expect(combatLinks(s, new Map([[1, null]]))).toEqual([]);
    expect(combatLinks(s, new Map([[1, 9]]))).toEqual([]);
  });

  it('draws an attack on a planeswalker to that card', () => {
    const pw = { ...(creature(5, 0) as object), types: 'Legendary Planeswalker - Jace' } as AnyCard;
    const links = combatLinks(state([pw], [creature(9, 1)], [band([9], [], { kind: 'card', id: 5 })]));
    expect(links).toEqual([{ kind: 'attack', from: { card: 9 }, to: { card: 5 }, n: 0, pending: false }]);
  });
});

describe('curveBetween', () => {
  it('leaves the facing edges of stacked boxes', () => {
    const c = curveBetween({ x: 100, y: 400, w: 80, h: 110 }, { x: 300, y: 50, w: 80, h: 110 });
    // From the top of the lower box to the bottom of the upper one (badges 10px inside).
    expect(c.start).toEqual({ x: 150, y: 410 });
    expect(c.end).toEqual({ x: 350, y: 150 });
    expect(c.d.startsWith('M 150 410 C')).toBe(true);
  });

  it('fans lanes apart', () => {
    const a = { x: 0, y: 300, w: 90, h: 120 };
    const b = { x: 0, y: 0, w: 90, h: 120 };
    expect(curveBetween(a, b, 1).start.x).not.toBe(curveBetween(a, b, 2).start.x);
    expect(curveBetween(a, b, 0).start.x).toBe(56.3);
  });

  it('stops a line to a player short of the life total', () => {
    // An attacker above, the defending player's life box below: the end sits 5px above the box.
    const c = curveBetween({ x: 100, y: 50, w: 80, h: 110 }, { x: 300, y: 400, w: 60, h: 30 }, 0, -5);
    expect(c.end.y).toBe(395);
  });

  it('runs sideways between boxes side by side', () => {
    const c = curveBetween({ x: 0, y: 0, w: 100, h: 100 }, { x: 400, y: 20, w: 100, h: 100 });
    expect(c.start).toEqual({ x: 90, y: 50 });
    expect(c.end).toEqual({ x: 410, y: 70 });
  });
});

describe('lanes', () => {
  it('counts lines per target', () => {
    expect(
      lanes([
        { kind: 'block', from: { card: 1 }, to: { card: 9 }, n: 1, pending: false },
        { kind: 'block', from: { card: 2 }, to: { card: 9 }, n: 1, pending: false },
        { kind: 'attack', from: { card: 8 }, to: { player: 0 }, n: 0, pending: false },
      ]),
    ).toEqual([0, 1, 0]);
  });
});

describe('combatMarks: an attacker and its blockers share a numbered badge', () => {
  it('numbers every attacker in band order, blocked or not, and gives each blocker its attacker’s number', () => {
    const m = combatMarks(state([creature(1, 0), creature(2, 0), creature(3, 0)], [creature(9, 1), creature(8, 1), creature(7, 1)], [band([9], [1, 2]), band([7], []), band([8], [3])]));
    expect([...m].map(([id, k]) => [id, k.n, k.role])).toEqual([
      [9, 1, 'attacker'],
      [7, 2, 'attacker'],
      [8, 3, 'attacker'],
      [1, 1, 'blocker'],
      [2, 1, 'blocker'],
      [3, 3, 'blocker'],
    ]);
    expect(m.get(9)!.defender).toEqual({ kind: 'player', id: 0 });
  });

  it('the badges agree with the block lines’ numbers', () => {
    const s = state([creature(1, 0), creature(3, 0)], [creature(9, 1), creature(8, 1)], [band([9], [1]), band([8], [3])]);
    const m = combatMarks(s);
    for (const l of combatLinks(s)) if (l.kind === 'block' && 'card' in l.to) expect(m.get(l.from.card)!.n).toBe(m.get(l.to.card)!.n);
  });

  it('a planeswalker defender is kept, so the defending player can read what attacks what', () => {
    const pw = { ...creature(5, 0), types: 'Legendary Planeswalker - Elspeth' } as AnyCard;
    const m = combatMarks(state([pw], [creature(9, 1)], [band([9], [], { kind: 'card', id: 5 })]));
    expect(m.get(9)!.defender).toEqual({ kind: 'card', id: 5 });
  });

  it('folds in this browser’s unconfirmed blocks and attackers, marked pending, and the current attacker', () => {
    const s = state([creature(1, 0), creature(2, 0)], [creature(9, 1), creature(8, 1)], [band([9], []), band([8], [])]);
    const m = combatMarks(s, new Map([[1, 8]]), new Set(), 8);
    expect(m.get(1)).toMatchObject({ n: 2, role: 'blocker', pending: true });
    expect(m.get(8)).toMatchObject({ n: 2, role: 'attacker', pending: false, current: true });
    expect(m.get(9)).toMatchObject({ n: 1, current: false });
    expect(m.has(2)).toBe(false);
    const atk = combatMarks(state([creature(1, 0), creature(2, 0)], [], null), new Map(), new Set([2, 1]));
    expect([...atk].map(([id, k]) => [id, k.n, k.pending])).toEqual([
      [2, 1, true],
      [1, 2, true],
    ]);
  });

  it('never marks a concealed card', () => {
    const m = combatMarks(state([hidden(1, 0)], [creature(9, 1)], [band([9], [1])]));
    expect(m.has(1)).toBe(false);
    expect(m.get(9)!.n).toBe(1);
  });
});

describe('declarations still under way (M65 chosen.attacks)', () => {
  it('draws a pending line from an attacker to what it attacks before state.combat names it', () => {
    const st = state([creature(1, 0)], [creature(9, 1), { ...(creature(7, 1) as object), types: 'Legendary Planeswalker - Jace' } as AnyCard], null);
    const links = combatLinks(st, new Map(), [
      { attackerId: 1, defender: { kind: 'player', id: 1 } },
      { attackerId: 1, defender: { kind: 'card', id: 7 } },
      { attackerId: 42, defender: { kind: 'player', id: 1 } },
    ]);
    expect(links).toEqual([
      { kind: 'attack', from: { card: 1 }, to: { player: 1 }, n: 0, pending: true },
      { kind: 'attack', from: { card: 1 }, to: { card: 7 }, n: 0, pending: true },
    ]);
  });
  it('the engine’s band wins over a pending row; the badge carries the pending defender', () => {
    const st = state([creature(1, 0)], [creature(9, 1)], [band([1], [], { kind: 'player', id: 1 })]);
    expect(combatLinks(st, new Map(), [{ attackerId: 1, defender: { kind: 'player', id: 1 } }]).filter((l) => l.pending)).toEqual([]);
    const marks = combatMarks(state([creature(1, 0)], [creature(9, 1)], null), new Map(), new Set([1]), null, [{ attackerId: 1, defender: { kind: 'player', id: 1 } }]);
    expect(marks.get(1)).toMatchObject({ role: 'attacker', pending: true, defender: { kind: 'player', id: 1 } });
  });
});
