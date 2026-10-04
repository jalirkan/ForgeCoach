// ForgeCoach — draft/labStats.test.ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMeta, type CubeMeta } from '../cube/meta.ts';
import { colourBaselines, FORGE_CAVEAT, labCardView, rateOf, RED_NOTE, VERDICT_WORDS, verdictOf, winLine } from './labStats.ts';

const shipped = (id: string) => parseMeta(JSON.parse(readFileSync(new URL(`../../public/cubes/${id}.meta.json`, import.meta.url), 'utf8')));

function meta(over: Partial<CubeMeta> & Record<string, unknown> = {}): CubeMeta {
  return parseMeta({
    schema: 1,
    cube: { name: 'T' },
    sample: { drafts: 10, games: 100 },
    cards: {
      Bolt: { picked: 9, seen: 10, avgPickIndex: 2.4, inDecks: 8, games: 40, wins: 30 },
      Bear: { picked: 5, seen: 10, avgPickIndex: 11, inDecks: 2, games: 12, wins: 6 },
      Dud: { picked: 4, seen: 10, inDecks: 4, games: 60, wins: 18 },
      Blank: {},
    },
    archetypes: [
      { id: 'RG', colors: 'RG', games: 40, winRate: 0.55 },
      { id: 'UW', colors: 'UW', games: 60, winRate: 0.45 },
      { id: 'BR', colors: 'BR', games: 20, winRate: 0.5 },
    ],
    pairs: [],
    ...over,
  });
}

describe('rates and verdicts', () => {
  it('Wilson 95%: a strong / weak verdict only when the interval is clear of 0.5', () => {
    const strong = rateOf(30, 40)!;
    expect(strong.lo).toBeGreaterThan(0.5);
    expect(verdictOf(strong)).toBe('strong');
    expect(verdictOf(rateOf(18, 60))).toBe('weak');
    // 6 of 12 and even 9 of 12: the interval includes 0.5, so nothing either way.
    expect(verdictOf(rateOf(6, 12))).toBe('unclear');
    expect(verdictOf(rateOf(9, 12))).toBe('unclear');
    expect(verdictOf(null)).toBe('unclear');
    expect(rateOf(0, 0)).toBeNull();
    expect(rateOf(5, 3)).toBeNull();
  });

  it('every card of the shipped metas: never strong or weak with 0.5 inside its interval', () => {
    for (const id of ['modern-era-cube-180', 'pauper-cube-180', 'synergy-cube-180', 'vintage-cube-180']) {
      const m = shipped(id);
      for (const name of Object.keys(m.cards)) {
        const v = labCardView(m, name, '');
        if (!v?.win) continue;
        if (v.win.lo <= 0.5 && v.win.hi >= 0.5) expect(v.verdict).toBe('unclear');
        else expect(v.verdict).not.toBe('unclear');
      }
    }
  });

  it('the words say Forge-vs-Forge, and the red over-flag', () => {
    expect(FORGE_CAVEAT).toMatch(/Forge-vs-Forge/);
    expect(FORGE_CAVEAT).toMatch(/Forge’s hands/);
    expect(RED_NOTE).toMatch(/53–55%/);
    expect(VERDICT_WORDS.unclear).toMatch(/neither strong nor weak: the interval includes 50%/);
    expect(winLine(rateOf(6, 12)!)).toMatch(/^50% \(95% \d+–\d+%\) over 12 games$/);
  });
});

describe('the card view', () => {
  it('reads what the meta has; nothing invented', () => {
    const m = meta();
    const v = labCardView(m, 'Bolt', 'R')!;
    expect(v.early).toBeNull();
    expect(v.avgPick).toBe(2.4);
    expect(v.taken).toEqual({ picked: 9, seen: 10, p: 0.9 });
    expect(v.inDeck).toEqual({ inDecks: 8, picked: 9, p: 8 / 9 });
    expect(v.win!.n).toBe(40);
    expect(v.red).toBe(true);
    expect(v.baselines.map((b) => b.colour)).toEqual(['R']);
    expect(labCardView(m, 'Blank', '')).toBeNull();
    expect(labCardView(m, 'Missing', '')).toBeNull();
    expect(labCardView(null, 'Bolt', 'R')).toBeNull();
  });

  it('uses the lab’s early field when it writes one', () => {
    const m = meta();
    (m.cards.Bear as Record<string, unknown>).early = { picks: 3, of: 8, window: 'first 3 picks of a pack' };
    const v = labCardView(m, 'Bear', 'G')!;
    expect(v.early).toMatchObject({ k: 3, n: 8, window: 'first 3 picks of a pack' });
    (m.cards.Bear as Record<string, unknown>).early = { picks: 9, of: 8 };
    expect(labCardView(m, 'Bear', 'G')!.early).toBeNull();
  });

  it('inconsistent counts are dropped, not shown', () => {
    const m = meta({ cards: { X: { picked: 12, seen: 10, inDecks: 20, games: 5, wins: 9 } } } as never);
    const v = labCardView(m, 'X', '');
    expect(v).toBeNull();
  });
});

describe('colour baselines', () => {
  it('summed from the archetypes, weighted by games', () => {
    const b = colourBaselines(meta());
    expect(b.get('R')!.games).toBe(60);
    expect(b.get('R')!.p).toBeCloseTo((0.55 * 40 + 0.5 * 20) / 60, 6);
    expect(b.get('U')!.p).toBeCloseTo(0.45, 6);
    expect(b.get('R')!.from).toBe('archetypes');
  });

  it('the lab’s own per-colour figures win when present', () => {
    const b = colourBaselines(meta({ colorBaselines: { R: { games: 200, wins: 108 }, Z: { games: 1, wins: 1 }, G: { games: 10, wins: 11 } } }));
    expect(b.get('R')).toEqual({ colour: 'R', games: 200, wins: 108, p: 0.54, from: 'lab' });
    expect(b.has('Z')).toBe(false);
    expect(b.has('G')).toBe(false);
  });

  it('the shipped metas give a baseline for every colour', () => {
    const b = colourBaselines(shipped('vintage-cube-180'));
    expect([...b.keys()].sort()).toEqual(['B', 'G', 'R', 'U', 'W']);
  });
});
