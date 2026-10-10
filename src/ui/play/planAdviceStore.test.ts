// SPDX-License-Identifier: GPL-3.0-or-later
// Plan mode's advice across a reload (adviceStore.ts): the moments asked, and per
// entry its moment (with an engine question's answers) and its attempt.
import { describe, expect, it } from 'vitest';
import { ADVICE_STORE_KEY, loadStoredAdvice, saveStoredAdvice, type StoredGame } from './adviceStore.ts';

function mem() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}

const game: StoredGame = {
  game: 'g|1|t#0',
  at: 1,
  plans: [],
  moments: ['turn:4', 'q:a7'],
  entries: [
    {
      key: 'g|1|t#0:live:m:q:a7~c1',
      kind: 'plan',
      label: 'Question, turn 4: Select any target',
      forTurn: 4,
      frameIndex: 120,
      turn: 4,
      seq: 3,
      answer: { status: 'done', text: 'PLAN: x\nSTEPS:\n1. target opponent\nEND', model: 'sonnet', source: 'helper', refused: false, stopReasonNote: null, error: null },
      moment: { kind: 'question', id: 'q:a7', question: 'The engine asks you: …', label: 'Question', ask: { prompt: 'Select any target', choices: [{ label: 'me', playerId: 0 }, { label: 'opponent', playerId: 1 }, { label: 'Swiftspear', cardId: 14 }], min: 1, max: 1 } },
      attempt: 1,
    },
  ],
};

describe('plan mode in the advice store', () => {
  it('keeps the moments, each entry’s moment and attempt', () => {
    const s = mem();
    expect(saveStoredAdvice(s, game)).toBe(true);
    const back = loadStoredAdvice(s, game.game)!;
    expect(back.moments).toEqual(['turn:4', 'q:a7']);
    expect(back.entries[0]).toEqual(game.entries[0]);
  });

  it('drops a moment that does not read as one, keeping the entry', () => {
    const s = mem();
    saveStoredAdvice(s, game);
    const raw = JSON.parse(s.data.get(ADVICE_STORE_KEY)!);
    raw.games[0].entries[0].moment.kind = 'nonsense';
    s.setItem(ADVICE_STORE_KEY, JSON.stringify(raw));
    const e = loadStoredAdvice(s, game.game)!.entries[0]!;
    expect(e.moment).toBeUndefined();
    expect(e.attempt).toBe(1);
  });
});
