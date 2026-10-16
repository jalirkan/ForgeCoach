// SPDX-License-Identifier: GPL-3.0-or-later
// ForgeCoach — scripts/watch-fixture/make.ts
//
// Writes src/watch/testdata/watch-draft.json: a draft.json (mtg-table D440,
// docs/watch-bots.md, kind "watch-draft" v1) for the tests and the e2e fake
// helper. Both seats are draft/draft.ts's copy of the lab drafter (selfPlay),
// the decks the deck assistant's builder on the lab's numbers alone — the
// same pieces mtg-table's watch uses, in ForgeCoach's copies. Deterministic.
//
//   node --experimental-transform-types --no-warnings scripts/watch-fixture/make.ts
import { writeFileSync } from 'node:fs';
import { context, loadRealMeta } from '../../src/cube/testdata/load.ts';
import { buildDecks } from '../../src/cube/builder.ts';
import { labOnly } from '../../src/cube/score.ts';
import { labCards } from '../../src/draft/cards.ts';
import { LINES, newDraft, selfPlay, type GridDraft } from '../../src/draft/draft.ts';
import { matchDeck } from '../../src/draft/deck.ts';
import { setValue } from '../../src/draft/pick.ts';
import { DEFAULT_WEIGHTS } from '../../src/draft/weights.ts';

const SEED = 440;
const ctx = context('fair-fight', loadRealMeta('fair-fight'));
const cards = labCards(ctx);
const names = ctx.cube.cards.map((c) => c.name);
const d0 = newDraft({ cubeId: 'fair-fight', format: 'grid', cube: names, seed: SEED, youFirst: true, now: Date.UTC(2026, 9, 16, 3, 25) }) as GridDraft;
const d = selfPlay(d0, cards) as GridDraft;
const seatOf = { you: 'A', ai: 'B' } as const;
const NAMES = ['row 1', 'row 2', 'row 3', 'col 1', 'col 2', 'col 3'];
interface P { n: number; grid: number; seat: 'A' | 'B'; order: 1 | 2; slots: Array<string | null>; line: number; lineName: string; took: string[]; value: number }
const picks: P[] = [];
const so = { you: [] as string[], ai: [] as string[] };
for (const e of d.log) {
  if (e.kind !== 'line' || e.line === undefined) continue;
  const g = e.at;
  const full = d.dealt.slice((g - 1) * 9, g * 9);
  const prev: P | undefined = picks[picks.length - 1];
  const order: 1 | 2 = prev && prev.grid === g ? 2 : 1;
  const slots: Array<string | null> = order === 1 ? full : prev!.slots.map((c, i) => (LINES[prev!.line]!.includes(i) ? null : c));
  const took = LINES[e.line]!.map((i) => slots[i]).filter((c): c is string => !!c);
  const state = { picks: so[e.who].map((n) => cards.get(n)!).filter(Boolean), expected: d.grids * 3 * 0.83 };
  const value = Math.round(setValue(took.map((n) => cards.get(n)!).filter(Boolean), state, DEFAULT_WEIGHTS) * 10) / 10;
  so[e.who].push(...took);
  picks.push({ n: picks.length + 1, grid: g, seat: seatOf[e.who], order, slots: [...slots], line: e.line, lineName: NAMES[e.line]!, took, value });
}
const lab = labOnly(ctx);
const deckOf = (side: 'A' | 'B', pool: string[]) => {
  const b = buildDecks(lab, pool)[0]!;
  const m = matchDeck(`Drafter ${side} (${b.colors}${b.splash ? `+${b.splash.toLowerCase()}` : ''})`, b, pool);
  return {
    name: m.name, file: `deck-${side}.dck`, builder: 'lab', colors: b.colors, splash: b.splash,
    cards: m.main.reduce((s, [n]) => s + n, 0), main: m.main, sideboard: m.sideboard ?? [],
    why: { spells: b.spells.length, lands: b.landCount, creatures: b.creatures, curve: b.curve, avgCmc: Math.round(b.avgMv * 100) / 100,
      themes: b.themes, score: Math.round(b.score * 10) / 10, parts: b.parts, alternatives: buildDecks(lab, pool).slice(1).map((x) => ({ colors: x.colors, splash: x.splash, score: Math.round(x.score * 10) / 10 })), stretched: !!b.thin },
    labErrors: [],
  };
};
const id = `watch-fair-fight-cube-180-${SEED}`;
const out = {
  v: 1, kind: 'watch-draft', id, faceUp: true,
  cube: { title: ctx.cube.title, file: 'cubes/fair-fight-cube-180.md', sha256: '0'.repeat(64) },
  format: 'grid', seed: SEED, startedAt: '2026-10-16T03:25:01.912Z', draftedMs: 9311,
  drafters: { A: { drafter: 'lab' }, B: { drafter: 'lab' } }, firstSeat: 'A', grids: d.grids,
  picks, pools: { A: d.picks.you, B: d.picks.ai }, decks: { A: deckOf('A', d.picks.you), B: deckOf('B', d.picks.ai) },
};
writeFileSync(new URL('../../src/watch/testdata/watch-draft.json', import.meta.url), `${JSON.stringify(out)}\n`);
console.log(`${id}: ${picks.length} picks, decks ${out.decks.A.name} / ${out.decks.B.name}`);
