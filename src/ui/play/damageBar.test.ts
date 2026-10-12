/*
 * ForgeCoach — ui/play/damageBar.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The divide-damage bar's arithmetic (damageBar.ts), in node: the split is
 * legal only when it assigns exactly `total`, puts nothing on the defender
 * unless the engine allows it (absent is no) and every blocker has the
 * engine's `lethal`; steppers never go above the total or below 0; the
 * defender's row locks — and gives its damage back — while a blocker is
 * short; Reset is the engine's own split; a re-ask's reason is carried.
 */
import { describe, expect, test } from 'vitest';
import type { AssignDamageAsk } from '../../protocol.ts';
import {
  answerOf,
  autoSplit,
  barRows,
  barWords,
  canStep,
  checkSplit,
  damageBarOf,
  defenderAllowedOf,
  defenderLocked,
  leftOf,
  pipsOf,
  step,
  type Amounts,
} from './damageBar.ts';

/** An attacker of `total` power blocked by blockers with these lethal amounts; the defender at index 0. */
function ask(total: number, lethal: (number | null)[], extra: Partial<AssignDamageAsk> = {}): AssignDamageAsk {
  return {
    askId: 'a1',
    kind: 'assign_damage',
    timeoutMs: 0,
    attackerId: 7,
    total,
    overrideOrder: true,
    maySkip: false,
    defenderAllowed: false,
    reason: null,
    targets: [
      { id: 0, label: 'Forge AI', kind: 'player', playerId: 1, defender: true, lethal: null },
      ...lethal.map((l, i) => ({ id: i + 1, label: `Blocker ${i + 1}`, kind: 'card' as const, cardId: 100 + i, defender: false, lethal: l })),
    ],
    ...extra,
  } as AssignDamageAsk;
}
const trample = (total: number, lethal: (number | null)[]) => ask(total, lethal, { defenderAllowed: true });

describe('the model', () => {
  test('blockers in the engine’s order; the defender’s row only when the engine allows it', () => {
    const m = damageBarOf(ask(4, [2, 3]));
    expect(m.blockers.map((b) => [b.index, b.lethal])).toEqual([
      [1, 2],
      [2, 3],
    ]);
    expect(m.defender).toBeNull();
    expect(barRows(m).map((r) => r.index)).toEqual([1, 2]);
    const t = damageBarOf(trample(5, [3]));
    expect(t.defender?.index).toBe(0);
    expect(barRows(t).map((r) => r.index)).toEqual([1, 0]);
  });
  test('an absent defenderAllowed (a bridge before M67) is not allowed — never true', () => {
    const old = ask(5, [3]);
    delete old.defenderAllowed;
    expect(defenderAllowedOf(old)).toBe(false);
    expect(damageBarOf(old).defender).toBeNull();
    expect(defenderAllowedOf({ ...old, defenderAllowed: true })).toBe(true);
  });
  test('a re-ask carries the engine’s reason; a first asking none', () => {
    expect(damageBarOf(ask(4, [2, 3])).reason).toBeNull();
    expect(damageBarOf(ask(4, [2, 3], { reason: 'Assign exactly 4 damage (this answer assigns 3).' })).reason).toBe('Assign exactly 4 damage (this answer assigns 3).');
    expect(damageBarOf(ask(4, [2, 3], { reason: '' })).reason).toBeNull();
  });
});

describe('the default split (Forge’s Auto) and Reset', () => {
  test('lethal to each blocker in order, the rest on the last blocker without a defender’s row', () => {
    const m = damageBarOf(ask(4, [2, 3]));
    expect(autoSplit(m)).toEqual({ '1': 2, '2': 2 });
    expect(checkSplit(m, autoSplit(m)).ok).toBe(true);
    expect(autoSplit(damageBarOf(ask(6, [1, 1])))).toEqual({ '1': 1, '2': 5 });
  });
  test('with trample the excess goes to the defender, and the split is legal', () => {
    const m = damageBarOf(trample(5, [3]));
    expect(autoSplit(m)).toEqual({ '1': 3, '0': 2 });
    expect(checkSplit(m, autoSplit(m)).ok).toBe(true);
    expect(defenderLocked(m, autoSplit(m))).toBe(false);
  });
  test('too little to kill them all: nothing reaches the defender', () => {
    const m = damageBarOf(trample(3, [2, 2]));
    expect(autoSplit(m)).toEqual({ '1': 2, '2': 1 });
    expect(defenderLocked(m, autoSplit(m))).toBe(true);
    expect(checkSplit(m, autoSplit(m)).ok).toBe(true);
  });
  test('Reset returns to the engine’s split from anywhere', () => {
    const m = damageBarOf(ask(4, [2, 2]));
    let a = autoSplit(m);
    a = step(m, a, 1, -1);
    a = step(m, a, 2, 1);
    expect(a).toEqual({ '1': 1, '2': 3 });
    expect(autoSplit(m)).toEqual({ '1': 2, '2': 2 });
  });
});

describe('steppers', () => {
  test('+ only while something is left; − never below 0', () => {
    const m = damageBarOf(ask(4, [2, 2]));
    const full = autoSplit(m);
    expect(leftOf(m, full)).toBe(0);
    expect(canStep(m, full, 1, 1)).toBe(false);
    expect(step(m, full, 1, 1)).toBe(full);
    const zero: Amounts = { '1': 0, '2': 4 };
    expect(canStep(m, zero, 1, -1)).toBe(false);
    expect(step(m, zero, 1, -1)).toBe(zero);
  });
  test('to move a point: − one blocker, then + the other (the study’s 3/1)', () => {
    const m = damageBarOf(ask(4, [2, 3]));
    let a = autoSplit(m);
    a = step(m, a, 2, -1);
    expect(leftOf(m, a)).toBe(1);
    expect(checkSplit(m, a)).toEqual({ ok: false, why: '1 left to assign' });
    a = step(m, a, 1, 1);
    expect(a).toEqual({ '1': 3, '2': 1 });
    expect(checkSplit(m, a).ok).toBe(true);
    expect(pipsOf(m.blockers[0]!, a)).toEqual({ lethal: 2, filled: 2, state: 'met', over: 1 });
    expect(pipsOf(m.blockers[1]!, a)).toEqual({ lethal: 3, filled: 1, state: 'short', over: 0 });
  });
  test('a row that is not drawn takes no step', () => {
    const m = damageBarOf(ask(4, [2, 2]));
    const a: Amounts = { '1': 2, '2': 1 };
    expect(canStep(m, a, 0, 1)).toBe(false); // the defender, not allowed
    expect(canStep(m, a, 9, 1)).toBe(false);
  });
});

describe('the defender’s row locks until every blocker has lethal', () => {
  test('lowering a blocker below lethal locks the row, zeroes it and shows the damage as left (07b)', () => {
    const m = damageBarOf(trample(5, [3]));
    let a = autoSplit(m); // 3 / 2
    a = step(m, a, 1, -1);
    expect(defenderLocked(m, a)).toBe(true);
    expect(a['0']).toBe(0);
    expect(leftOf(m, a)).toBe(3);
    expect(canStep(m, a, 0, 1)).toBe(false);
    expect(canStep(m, a, 0, -1)).toBe(false);
    expect(checkSplit(m, a).ok).toBe(false);
    // + on the blocker unlocks it again, the defender at 0 until stepped up
    a = step(m, a, 1, 1);
    expect(defenderLocked(m, a)).toBe(false);
    expect(canStep(m, a, 0, 1)).toBe(true);
    a = step(m, step(m, a, 0, 1), 0, 1);
    expect(a).toEqual({ '0': 2, '1': 3 });
    expect(answerOf(m, a)).toEqual({ '0': 2, '1': 3 });
  });
  test('every blocker, not just one', () => {
    const m = damageBarOf(trample(6, [2, 2]));
    expect(defenderLocked(m, { '1': 2, '2': 1 })).toBe(true);
    expect(defenderLocked(m, { '1': 2, '2': 2 })).toBe(false);
    expect(checkSplit(m, { '0': 3, '1': 2, '2': 1 })).toEqual({ ok: false, why: 'Blocker 2 needs 2 before Forge AI takes any' });
  });
  test('deathtouch: the engine’s lethal (1) is the bar’s, whatever the toughness', () => {
    const m = damageBarOf(trample(4, [1, 1]));
    expect(autoSplit(m)).toEqual({ '1': 1, '2': 1, '0': 2 });
    expect(checkSplit(m, { '0': 2, '1': 1, '2': 1 }).ok).toBe(true);
  });
  test('no blockers left: the defender is open', () => {
    const m = damageBarOf(trample(3, []));
    expect(defenderLocked(m, {})).toBe(false);
    expect(autoSplit(m)).toEqual({ '0': 3 });
  });
  test('a blocker the engine sent no lethal for constrains nothing', () => {
    const m = damageBarOf(trample(3, [null]));
    expect(pipsOf(m.blockers[0]!, {})).toBeNull();
    expect(defenderLocked(m, {})).toBe(false);
    expect(checkSplit(m, { '0': 3 }).ok).toBe(true);
  });
});

describe('checkSplit: legal and illegal maps', () => {
  const m = damageBarOf(ask(4, [2, 3]));
  test.each([
    [{ '1': 2, '2': 2 }, true],
    [{ '1': 4 }, true],
    [{ '1': 0, '2': 4 }, true],
    [{ '1': 2, '2': 1 }, false], // short
    [{ '1': 3, '2': 2 }, false], // over
    [{ '0': 1, '1': 2, '2': 1 }, false], // the defender, not allowed
    [{ '1': 2.5, '2': 1.5 }, false],
    [{ '1': -1, '2': 5 }, false],
    [{ '9': 4 }, false],
  ] as [Amounts, boolean][])('%j → %s', (a, ok) => {
    expect(checkSplit(m, a).ok).toBe(ok);
    expect(answerOf(m, a) !== null).toBe(ok);
  });
  test('the answer drops zero rows', () => {
    expect(answerOf(m, { '1': 0, '2': 4 })).toEqual({ '2': 4 });
  });
});

describe('the words', () => {
  test('no defender: the sentence only', () => {
    expect(barWords(damageBarOf(ask(4, [2, 3])), 'Leatherback Baloth', false)).toEqual({
      sentence: 'Leatherback Baloth deals 4 damage — divide it among the blockers.',
      rule: null,
    });
    expect(barWords(damageBarOf(ask(3, [2])), null, false).sentence).toBe('Your attacker deals 3 damage — assign it to Blocker 1.');
  });
  test('trample: "assign lethal to each before it tramples over" and the rule line', () => {
    expect(barWords(damageBarOf(trample(5, [3, 2])), 'Avatar of the Resolute', true)).toEqual({
      sentence: 'Avatar of the Resolute deals 5 damage — divide it among the blockers; assign lethal to each before it tramples over.',
      rule: 'Trample · every blocker must be lethal to spill over',
    });
  });
  test('a defender’s row the engine allowed for another reason: the same rule, in plain words', () => {
    const w = barWords(damageBarOf(trample(5, [3, 2])), 'X', false);
    expect(w.sentence).toContain('before Forge AI takes any');
    expect(w.rule).toBe('Every blocker must be lethal before Forge AI takes any');
  });
});
