/*
 * ForgeCoach — ambience/events.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import type { GameStateBody } from '../protocol.ts';
import { battleEvents, landEvents, sceneryEvents } from './events.ts';
import { sceneryFromLog } from './model.ts';
import { simCard, simLog, simState } from './sim.ts';

describe('land events', () => {
  it('reports the land, its slot and the stage it grew to', () => {
    const log = simLog([
      { kind: 'land', player: 1, name: 'Island' },
      { kind: 'land', player: 1, name: 'Island' },
      { kind: 'land', player: 1, name: 'Swamp' },
    ]);
    const at = (i: number) => sceneryFromLog(log, i);
    expect(landEvents(at(0), at(1))).toEqual([{ kind: 'land', player: 1, biome: 'island', slot: 0, newSlot: true, prevStage: 0, stage: 1, weight: 1 }]);
    expect(landEvents(at(1), at(2))).toEqual([{ kind: 'land', player: 1, biome: 'island', slot: 0, newSlot: false, prevStage: 1, stage: 2, weight: 2 }]);
    expect(landEvents(at(2), at(3))).toMatchObject([{ biome: 'swamp', slot: 1, newSlot: true, stage: 1 }]);
    expect(landEvents(at(3), at(3))).toEqual([]);
    expect(landEvents(at(3), at(2))).toEqual([]); // going back is not an arrival
  });
});

describe('battle events', () => {
  it('creature entered, attack and damage, from the state batch', () => {
    const log = simLog([
      { kind: 'creature', player: 2 },
      { kind: 'attack', player: 2 },
    ]);
    const s1 = log.frames[1]!.body as GameStateBody;
    const s2 = log.frames[2]!.body as GameStateBody;
    const [c] = battleEvents(s1);
    expect(c).toMatchObject({ kind: 'creature', player: 2, token: false });
    expect((c as { colors: string[] }).colors).toHaveLength(1);
    expect(battleEvents(s2)).toEqual([
      { kind: 'attack', player: 2, attackerIds: [100], defender: 1 },
      { kind: 'damage', player: 1, targetKind: 'player', targetId: 1, amount: 2, combat: true, sourceCardId: 100 },
    ]);
  });

  it('ignores lands entering, moves within the battlefield, hidden cards and zero damage', () => {
    const land = simCard(5, 1, 'Forest', 'Basic Land - Forest');
    const st = simState(new Map([[1, [land]]]), [
      { kind: 'zone', cardId: 5, from: { zone: 'hand', player: 1 }, to: { zone: 'battlefield', player: 1 } },
      { kind: 'zone', cardId: 77, from: { zone: 'hand', player: 2 }, to: { zone: 'battlefield', player: 2 } },
      { kind: 'damage', target: { kind: 'card', id: 5 }, sourceCardId: 1, amount: 0, combat: false, damageType: null },
      { kind: 'tap', cardId: 5, tapped: true },
    ], 3);
    expect(battleEvents(st)).toEqual([]);
  });

  it('damage to a card names its controller', () => {
    const bear = simCard(6, 2, 'Bear', 'Creature - Bear');
    const st = simState(new Map([[2, [bear]]]), [{ kind: 'damage', target: { kind: 'card', id: 6 }, sourceCardId: 1, amount: 3, combat: false, damageType: 'NORMAL' }], 3);
    expect(battleEvents(st)).toEqual([{ kind: 'damage', player: 2, targetKind: 'card', targetId: 6, amount: 3, combat: false, sourceCardId: 1 }]);
  });

  it('sceneryEvents puts lands first', () => {
    const log = simLog([{ kind: 'land', player: 1, name: 'Forest' }]);
    const ev = sceneryEvents(sceneryFromLog(log, 0), sceneryFromLog(log, 1), log.frames[1]!.body as GameStateBody);
    expect(ev.map((e) => e.kind)).toEqual(['land']);
  });
});
