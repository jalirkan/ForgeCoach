// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { GameLog } from '../log.ts';
import type { SavedDraft } from './store.ts';
import { draftReviewFields, isDraftMatch } from './reviewInput.ts';

const cube = Array.from({ length: 90 }, (_, i) => `Card ${i}`);

function logWith(aiDeckName: string | null): GameLog {
  return {
    seat: 0,
    header: { gameId: 'match-1' },
    hello: {
      you: 0,
      players: [
        { id: 0, name: 'You' },
        { id: 1, name: 'Forge AI' },
      ],
      match: { yourDeck: { name: 'Cube draft' }, aiDeck: aiDeckName ? { name: aiDeckName } : null },
    },
    frames: [],
  } as unknown as GameLog;
}

function saved(over: Partial<SavedDraft['draft']> = {}, aiName = 'Izzet Spells'): SavedDraft {
  return {
    hints: true,
    draft: { v: 1, format: 'grid', done: true, cubeId: 'c', dealt: [], picks: { you: ['Card 1'], ai: ['Card 2', 'Card 3', 'Card 2'] }, seen: { you: [], ai: [] }, log: [], ...over },
    after: { aiDeck: { name: aiName, main: [[40, 'SECRET AI CARD']] } },
  } as unknown as SavedDraft;
}

describe('draftReviewFields', () => {
  it('sends the cube list and the AI picks you saw, for the match the draft launched', () => {
    const f = draftReviewFields(logWith('Izzet Spells'), saved(), cube);
    expect(f.oppPool).toHaveLength(90);
    expect(f.oppPool![0]).toEqual([1, 'Card 0']);
    expect(f.oppKnown).toEqual(['Card 2', 'Card 3']);
    // Never the AI's deck.
    expect(JSON.stringify(f)).not.toContain('SECRET AI CARD');
  });

  it('sends nothing for any other game', () => {
    expect(draftReviewFields(logWith('Mono-Red'), saved(), cube)).toEqual({});
    expect(draftReviewFields(logWith(null), saved(), cube)).toEqual({});
    expect(draftReviewFields(logWith('Izzet Spells'), null, cube)).toEqual({});
    expect(draftReviewFields(logWith('Izzet Spells'), saved({ done: false }), cube)).toEqual({});
    expect(isDraftMatch(logWith('Izzet Spells'), saved())).toBe(true);
  });

  it('keeps to the endpoint limits: a pool of at least 80, at most 60 known picks', () => {
    expect(draftReviewFields(logWith('Izzet Spells'), saved(), cube.slice(0, 79))).toEqual({});
    const many = Array.from({ length: 70 }, (_, i) => `Card ${i}`);
    const f = draftReviewFields(logWith('Izzet Spells'), saved({ picks: { you: [], ai: many } } as never), cube);
    expect(f.oppKnown).toHaveLength(60);
  });
});
