/*
 * ForgeCoach — play/acts.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The yieldTo builder for every kind the protocol has (M64's
 * `endStepOrOpponent` among them), and the guard's word on it.
 */
import { describe, expect, it } from 'vitest';
import { YIELD_KINDS } from '../protocol.ts';
import { whyNotAct, yieldTo } from './acts.ts';

const open = { status: 'open', ask: null, over: null, inputSeen: true };

describe('yieldTo', () => {
  it('builds M64’s endStepOrOpponent with no phase or turn', () => {
    expect(yieldTo('endStepOrOpponent')).toEqual({ action: 'yieldTo', kind: 'endStepOrOpponent' });
    expect(YIELD_KINDS).toContain('endStepOrOpponent');
  });
  it('the guard treats every kind alike: sent at the board, held behind a question, before the first input or after the end', () => {
    for (const kind of YIELD_KINDS) {
      const body = yieldTo(kind);
      expect(whyNotAct(open, body)).toBeNull();
      expect(whyNotAct({ ...open, ask: { askId: 'a1' } }, body)).toMatch(/answer/);
      expect(whyNotAct({ ...open, inputSeen: false }, body)).not.toBeNull();
      expect(whyNotAct({ ...open, over: { winner: 0, reason: 'Conceded', matchOver: true } }, body)).toBe('the game is over');
    }
  });
});
