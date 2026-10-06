/*
 * ForgeCoach — scripts/human-cards/stats.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A made-up miniature of 17Lands' game-data layout (not real data).
 */
import { describe, expect, it } from 'vitest';
import { parseHumanCards } from '../../src/cube/human.ts';
import { coverage, GameCounter, humanFile, splitCsvLine } from './stats.ts';

const HEADER =
  'expansion,event_type,draft_id,won,' +
  ['Bolt', 'Jace, the Mind Sculptor', 'Fire // Ice'].flatMap((n) => ['opening_hand_', 'drawn_', 'tutored_', 'deck_', 'sideboard_'].map((p) => (n.includes(',') ? `"${p}${n}"` : `${p}${n}`))).join(',');

// per card: opening_hand, drawn, tutored, deck, sideboard
const row = (event: string, won: string, ...cards: number[][]) => ['Cube_-_Powered', event, 'abc', won, ...cards.flatMap((c) => c.map(String))].join(',');

const CSV = [
  HEADER,
  // Bolt in hand (opening), Jace drawn, Fire // Ice in the deck unseen; won.
  row('PremierDraft', 'True', [1, 0, 0, 1, 0], [0, 1, 0, 1, 0], [0, 0, 0, 1, 0]),
  // Bolt unseen, Jace tutored only (not GIH, not GNS), Fire // Ice not in the deck; lost.
  row('PremierDraft', 'False', [0, 0, 0, 1, 0], [0, 0, 1, 1, 0], [0, 0, 0, 0, 1]),
  // Bolt drawn; won (TradDraft).
  row('TradDraft', 'True', [0, 1, 0, 1, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]),
  // A row with no result is skipped.
  row('PremierDraft', '', [1, 0, 0, 1, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]),
];

function count(lines = CSV) {
  const g = new GameCounter();
  g.header(splitCsvLine(lines[0]!));
  for (const l of lines.slice(1)) g.row(splitCsvLine(l));
  return g.stats;
}

describe('splitCsvLine', () => {
  it('splits on commas outside quotes and unescapes doubled quotes', () => {
    expect(splitCsvLine('a,"b, c",d')).toEqual(['a', 'b, c', 'd']);
    expect(splitCsvLine('"say ""hi""",,x')).toEqual(['say "hi"', '', 'x']);
  });
});

describe('GameCounter', () => {
  it('counts GP, GIH, OH and GNS as 17Lands (and cards17l.py) define them', () => {
    const s = count();
    expect(s.games).toBe(3);
    expect(s.wins).toBe(2);
    expect(s.badRows).toBe(1);
    expect(s.events).toEqual({ PremierDraft: 2, TradDraft: 1 });
    expect(s.cards.get('Bolt')).toEqual({ gp: 3, gpW: 2, gih: 2, gihW: 2, oh: 1, ohW: 1, gns: 1, gnsW: 0 });
    // Tutored alone is neither in hand nor "never seen".
    expect(s.cards.get('Jace, the Mind Sculptor')).toEqual({ gp: 2, gpW: 1, gih: 1, gihW: 1, oh: 0, ohW: 0, gns: 0, gnsW: 0 });
    expect(s.cards.get('Fire // Ice')).toEqual({ gp: 1, gpW: 1, gih: 0, gihW: 0, oh: 0, ohW: 0, gns: 1, gnsW: 1 });
  });

  it('refuses a file without a result column', () => {
    expect(() => new GameCounter().header(['a', 'deck_Bolt'])).toThrow(/won/);
  });
});

describe('coverage and humanFile', () => {
  const source = {
    name: '17Lands',
    page: 'https://www.17lands.com/public_datasets',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
    dataset: 'Powered Cube',
    files: ['x.csv.gz'],
    updated: '2025-11-23',
  };
  const cube = { file: 'test.md', title: 'Test', names: ['Lightning Bolt', 'bolt', 'Fire', 'Jace, the Mind Sculptor'] };

  it('matches by normalised front face, keyed by the cube’s own names, above the threshold', () => {
    const { cov, cards } = coverage(count(), cube, 1);
    expect(cov).toEqual({ file: 'test.md', title: 'Test', cards: 4, inData: 3, matched: 2 });
    expect(Object.keys(cards).sort()).toEqual(['Jace, the Mind Sculptor', 'bolt']);
    expect(coverage(count(), cube, 2).cov.matched).toBe(1);
  });

  it('writes a file the app’s validator accepts, with the pooled average', () => {
    const f = humanFile(count(), cube, source, '2026-10-06', 1);
    const d = parseHumanCards(JSON.parse(JSON.stringify(f)));
    expect(d.games).toBe(3);
    expect(d.gih).toEqual({ games: 3, wins: 3 });
    expect(d.cards.bolt).toEqual({ gih: 2, gihW: 2, oh: 1, ohW: 1, gns: 1, gnsW: 0 });
    expect(JSON.stringify(f)).not.toMatch(/abc|draft_id/);
  });
});
