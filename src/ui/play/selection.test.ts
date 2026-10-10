/*
 * ForgeCoach — ui/play/selection.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import type { InputBody } from '../../protocol.ts';
import { describeInput } from './inputView.ts';
import { selectionSummary, wireChoice } from './selection.ts';

function input(prompt: string, ok = true, cancel = false): InputBody {
  return {
    prompt,
    focusCardId: null,
    focusCard: null,
    buttons: { ok: { label: 'OK', enabled: ok }, cancel: { label: 'Cancel', enabled: cancel }, focus: ok ? 'ok' : null },
    selectable: { cardIds: [], min: 0, max: 0, mode: 'none' },
    highlighted: [],
    weak: [],
    openZones: [],
  };
}

const none = { attackers: 0, blockers: 0 };

describe('selectionSummary', () => {
  it('is off at priority', () => {
    const v = describeInput(input('Priority: Human'), null, 0);
    expect(selectionSummary(v, none)).toEqual({ active: false, count: null, line: null, confirm: null });
  });

  it('words a block: No blocks until one is assigned, then a live count', () => {
    const v = describeInput(input('Select creatures to block Soldier Token (91) or select another attacker to declare blockers for.'), null, 0);
    expect(v.mode).toBe('block');
    const zero = selectionSummary(v, none);
    expect(zero).toMatchObject({ active: true, count: 0, confirm: 'No blocks' });
    const two = selectionSummary(v, { attackers: 0, blockers: 2 });
    expect(two).toMatchObject({ count: 2, confirm: 'Confirm blocks', line: '2 blockers assigned — same number = who blocks whom' });
    expect(selectionSummary(v, { attackers: 0, blockers: 1 }).line).toBe('1 blocker assigned — same number = who blocks whom');
  });

  it('counts attackers', () => {
    const v = describeInput(input('Select creatures to attack Forge AI or select player/card you wish to attack.', false, true), null, 0);
    expect(selectionSummary(v, none)).toMatchObject({ active: true, count: 0, confirm: null });
    expect(selectionSummary(v, { attackers: 3, blockers: 0 })).toMatchObject({ count: 3, confirm: 'Attack with 3' });
  });

  it('dims during a target choice without claiming a count', () => {
    const i = input('Pym Particles (6) - Target creature\n\nSelect target creature', false, true);
    i.selectable = { cardIds: [44], min: 1, max: 1, mode: 'cards' };
    const v = describeInput(i, null, 0);
    expect(v.mode).toBe('target');
    expect(selectionSummary(v, none)).toEqual({ active: true, count: null, line: 'Click to select', confirm: null });
  });
});

describe('wireChoice (M65 selectable.chosen)', () => {
  const chosen = { cardIds: [3, 4], playerIds: [1], blocks: [{ blockerId: 3, attackerId: 9 }], attacks: [{ attackerId: 5, defender: { kind: 'player' as const, id: 1 } }] };
  it('null is "this frame does not say", never "nothing chosen"', () => {
    expect(wireChoice(null, 'attack')).toBeNull();
  });
  it('a block declaration: blocker → attacker, a blocker with no pair row → null', () => {
    const w = wireChoice(chosen, 'block')!;
    expect([...w.blockers]).toEqual([
      [3, 9],
      [4, null],
    ]);
    expect(w.attackers.size).toBe(0);
    expect(w.cards.size).toBe(0);
  });
  it('an attack declaration: the attackers and what each attacks', () => {
    const w = wireChoice(chosen, 'attack')!;
    expect([...w.attackers].sort()).toEqual([3, 4, 5]);
    expect(w.attacks).toEqual(chosen.attacks);
    expect(w.blockers.size).toBe(0);
  });
  it('a target or a list: the cards and players picked', () => {
    const w = wireChoice({ ...chosen, blocks: [], attacks: [] }, 'target')!;
    expect([...w.cards]).toEqual([3, 4]);
    expect([...w.players]).toEqual([1]);
  });
});
