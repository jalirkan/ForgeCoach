/*
 * ForgeCoach — play/match.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The match box (endstep-style "MATCH · Game 1 / 3 · 0 – 0"): which game of
 * the match this is and the score so far, from what the protocol gives —
 * `hello_ok.gameNumber` / `gameCount` (M41), `hello_ok.match.games` (M44) and
 * each finished game's `over` result.
 *
 * The score is only claimed when this session saw every earlier game of the
 * match (a page reload mid-match loses them): otherwise it is null and the
 * box says only which game it is.
 */
import type { HelloOkBody, OverBody } from '../protocol.ts';

export interface MatchBox {
  /** 1-based; null when the stream predates M41 and does not say. */
  game: number | null;
  of: number;
  /** Games won so far by the viewing seat and by the opponent; null when unknown. */
  score: { me: number; opp: number } | null;
}

interface GameRecord {
  hello: HelloOkBody | null;
  over: OverBody | null;
  seat: number | null;
}

/** Null for a one-game session (nothing to show) or before the handshake. */
export function matchBox(hello: HelloOkBody | null, over: OverBody | null, previous: readonly GameRecord[], seat: number | null): MatchBox | null {
  if (!hello) return null;
  const of = hello.gameCount ?? hello.match?.games ?? null;
  if (!of || of < 2) return null;
  const game = hello.gameNumber ?? null;
  if (game === null) return { game: null, of, score: null };
  // The finished games this session saw, in order, ending just before this one.
  const earlier: GameRecord[] = [];
  for (let want = game - 1, i = previous.length - 1; want >= 1 && i >= 0; i--) {
    const g = previous[i]!;
    if (g.hello?.gameNumber !== want) break;
    earlier.unshift(g);
    want--;
  }
  let score: MatchBox['score'] = null;
  if (earlier.length === game - 1) {
    score = { me: 0, opp: 0 };
    for (const g of [...earlier, { hello, over, seat }]) {
      const w = g.over?.winner;
      if (w === undefined || w === null) continue;
      if (w === (g.seat ?? seat)) score.me++;
      else score.opp++;
    }
  }
  return { game, of, score };
}
