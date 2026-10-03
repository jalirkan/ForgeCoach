/*
 * ForgeCoach — play/aiName.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import type { HelloOkBody } from '../protocol.ts';
import { aiPolicyName, seatDisplayName } from './aiName.ts';

function hello(aiPolicy?: unknown, withMatch = true): HelloOkBody {
  return {
    gameId: 'g1',
    you: 0,
    seed: 1,
    forgeVersion: '2.0.14',
    forgeJarSha256: 'x',
    unsupportedCards: [],
    players: [
      { id: 0, name: 'You', isAi: false },
      { id: 1, name: 'Forge AI', isAi: true },
    ],
    ...(withMatch
      ? {
          match: {
            yourDeck: { name: 'Mine', path: 'var/match/1/you.dck', cards: 40 },
            aiDeck: { name: 'Theirs', cards: 40 },
            aiProfile: 'Default',
            games: 3,
            ...(aiPolicy === undefined ? {} : { aiPolicy }),
          },
        }
      : {}),
  } as HelloOkBody;
}

const ai = { id: 1, name: 'Forge AI', isAi: true };
const me = { id: 0, name: 'You', isAi: false };

describe('aiPolicyName', () => {
  it('is the opponent-AI picker’s name, without its aside', () => {
    expect(aiPolicyName('plain')).toBe('Forge');
    expect(aiPolicyName('outlets')).toBe('Forge + sacrifice play');
    expect(aiPolicyName('search')).toBe('Search AI');
  });
});

describe('seatDisplayName', () => {
  it('names the AI the match was started with (hello_ok.match.aiPolicy, M56)', () => {
    expect(seatDisplayName(hello('search'), ai)).toBe('Search AI');
    expect(seatDisplayName(hello('outlets'), ai)).toBe('Forge + sacrifice play');
    expect(seatDisplayName(hello('plain'), ai)).toBe('Forge');
  });
  it('falls back to the engine’s name when the engine predates the field', () => {
    expect(seatDisplayName(hello(), ai)).toBe('Forge AI');
    expect(seatDisplayName(hello(undefined, false), ai)).toBe('Forge AI');
    expect(seatDisplayName(null, ai)).toBe('Forge AI');
    expect(seatDisplayName(hello('search'), undefined)).toBe('Forge AI');
    expect(seatDisplayName(hello('search'), { id: 1, name: '' }, 'Forge AI')).toBe('Search AI');
  });
  it('ignores a value that is not one of the three policies', () => {
    expect(seatDisplayName(hello('search ms=3000'), ai)).toBe('Forge AI');
    expect(seatDisplayName(hello(42), ai)).toBe('Forge AI');
  });
  it('never renames the viewer or a human seat', () => {
    expect(seatDisplayName(hello('search'), me)).toBe('You');
    expect(seatDisplayName(hello('search'), { id: 1, name: 'Bob', isAi: false })).toBe('Bob');
  });
  it('reads isAi from the handshake when the caller’s player lacks it', () => {
    expect(seatDisplayName(hello('search'), { id: 1, name: 'Forge AI' })).toBe('Search AI');
  });
});
