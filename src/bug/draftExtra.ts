/*
 * ForgeCoach — bug/draftExtra.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A draft against the AI, as a bug report may carry it (mtg-table D411): only
 * what the player's screen shows. The AI's own picks are hidden information
 * (CLAUDE.md: the player only ever sees `knownAiCards`), so the report has the
 * cards the player saw the AI take, its count, the player's own picks, and the
 * cards in front of the player now — never the AI's list, the dealt order, the
 * Winston stack or the seed (which would re-deal all of it).
 */
import { aiCount, knownAiCards, progress, type Draft } from '../draft/draft.ts';

export function draftExtra(d: Draft | null | undefined): Record<string, unknown> | null {
  if (!d) return null;
  const base = {
    format: d.format,
    cubeId: d.cubeId,
    done: d.done,
    progress: progress(d),
    yourPicks: [...d.picks.you],
    aiKnown: knownAiCards(d),
    aiCount: aiCount(d),
    yourEvents: d.log.filter((e) => e.who === 'you').slice(-12).map((e) => ({ n: e.n, kind: e.kind, at: e.at, line: e.line ?? null, cards: [...e.cards] })),
  };
  if (d.format === 'grid') return { ...base, grid: { g: d.g, grids: d.grids, slots: [...d.slots], firstLine: d.firstLine } };
  if (d.format === 'booster') return { ...base, booster: { seats: d.seats, round: d.round, pick: d.pick, pack: [...(d.table[0] ?? [])] } };
  // Winston: the pile sizes; the cards of the pile being looked at only on the player's own turn.
  return { ...base, winston: { turn: d.turn, look: d.look, stackLeft: d.stack.length, piles: d.piles.map((p) => p.length), looking: d.turn === 'you' ? [...(d.piles[d.look] ?? [])] : null } };
}
