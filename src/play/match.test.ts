/*
 * ForgeCoach — play/match.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import type { HelloOkBody, OverBody } from '../protocol.ts';
import { matchBox } from './match.ts';

const hello = (gameNumber?: number, gameCount?: number, games?: number): HelloOkBody =>
  ({
    gameId: `g${gameNumber ?? 0}`,
    you: 0,
    seed: null,
    forgeVersion: 'x',
    forgeJarSha256: 'x',
    unsupportedCards: [],
    players: [],
    ...(gameNumber !== undefined ? { gameNumber, gameCount } : {}),
    ...(games !== undefined ? { match: { yourDeck: { name: 'A', cards: 40, path: 'a.dck' }, aiDeck: { name: 'B', cards: 40 }, aiProfile: 'Default', games } } : {}),
  }) as HelloOkBody;
const won = (winner: number | null): OverBody => ({ winner, reason: 'x', matchOver: false });

describe('matchBox', () => {
  it('shows nothing for a one-game session or before the handshake', () => {
    expect(matchBox(null, null, [], 0)).toBeNull();
    expect(matchBox(hello(), null, [], 0)).toBeNull();
    expect(matchBox(hello(undefined, undefined, 1), null, [], 0)).toBeNull();
  });

  it('game 1 of 3 starts at 0–0', () => {
    expect(matchBox(hello(1, 3), null, [], 0)).toEqual({ game: 1, of: 3, score: { me: 0, opp: 0 } });
  });

  it('counts the earlier games this session saw', () => {
    const prev = [
      { hello: hello(1, 3), over: won(0), seat: 0 },
      { hello: hello(2, 3), over: won(1), seat: 0 },
    ];
    expect(matchBox(hello(3, 3), null, prev, 0)).toEqual({ game: 3, of: 3, score: { me: 1, opp: 1 } });
    // The current game's result counts once it is over; a draw counts for nobody.
    expect(matchBox(hello(3, 3), won(0), prev, 0)?.score).toEqual({ me: 2, opp: 1 });
    expect(matchBox(hello(2, 3), won(null), prev.slice(0, 1), 0)?.score).toEqual({ me: 1, opp: 0 });
  });

  it('claims no score when an earlier game was missed (a reload mid-match)', () => {
    expect(matchBox(hello(2, 3), null, [], 0)).toEqual({ game: 2, of: 3, score: null });
    // Games of an earlier match do not count.
    expect(matchBox(hello(2, 3), null, [{ hello: hello(3, 3), over: won(0), seat: 0 }], 0)?.score).toBeNull();
  });

  it('knows the match length from M44 when M41 is absent, but not which game', () => {
    expect(matchBox(hello(undefined, undefined, 3), null, [], 0)).toEqual({ game: null, of: 3, score: null });
  });
});
