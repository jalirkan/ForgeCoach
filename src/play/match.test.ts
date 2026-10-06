/*
 * ForgeCoach — play/match.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest';
import type { HelloOkBody, OverBody } from '../protocol.ts';
import { matchBox, tableMatchLine } from './match.ts';

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

  it('at a table of two (M60): the score before this game from the handshake, plus this game', () => {
    const h = { ...hello(2, 3), match: { yourDeck: { name: 'a', path: 'p', cards: 40 }, opponentDeck: { name: 'b', cards: 40 }, opponent: 'human', games: 3, score: { you: 0, opponent: 1 } } } as unknown as HelloOkBody;
    expect(matchBox(h, null, [], 1)).toEqual({ game: 2, of: 3, score: { me: 0, opp: 1 } });
    expect(matchBox(h, { winner: 1, reason: 'AllOpponentsLost', matchOver: true } as OverBody, [], 1)).toEqual({ game: 2, of: 3, score: { me: 1, opp: 1 } });
    expect(matchBox(h, { winner: 0, reason: 'Conceded', matchOver: true } as OverBody, [], 1)).toEqual({ game: 2, of: 3, score: { me: 0, opp: 2 } });
  });

  it('tableMatchLine (mtg-table D406): where the best of three stands, and who chooses next', () => {
    const box = (game: number, me: number, opp: number) => ({ game, of: 3, score: { me, opp } });
    const over = (winner: number | null) => ({ winner, reason: 'x', matchOver: true }) as OverBody;
    expect(tableMatchLine(box(1, 0, 1), over(1), 0, 'Sam')).toMatch(/^Game 1 of 3 · you 0 – 1 Sam\. Next, game 2: .*you choose to play or draw\.$/);
    expect(tableMatchLine(box(1, 1, 0), over(0), 0, 'Sam')).toMatch(/Sam chooses to play or draw/);
    expect(tableMatchLine(box(2, 1, 0), over(null), 0, 'Sam')).toMatch(/game 2: .*a coin toss decides/);
    expect(tableMatchLine(box(3, 2, 1), over(0), 0, 'Sam')).toBe('You win the match 2 – 1.');
    expect(tableMatchLine(box(2, 0, 2), over(1), 0, 'Sam')).toBe('Sam wins the match 2 – 0.');
    expect(tableMatchLine(null, over(1), 0, 'Sam')).toBeNull();
    expect(tableMatchLine({ game: 1, of: 3, score: null }, over(1), 0, 'Sam')).toBeNull();
  });
});
