// ForgeCoach — draft/labStats.test.ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMeta, type CubeMeta } from '../cube/meta.ts';
import { baselineLine, colourBaselines, colourNote, colourSkew, fmt, FORGE_CAVEAT, LAND_HIDDEN, labCardView, rateOf, SMALL_SAMPLE_GAMES, smallSampleNote, VERDICT_WORDS, verdictOf, winLine, ZERO_HIDDEN } from './labStats.ts';

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

  it('the words say Forge-vs-Forge; counts carry thousands separators', () => {
    expect(FORGE_CAVEAT).toMatch(/Forge-vs-Forge/);
    expect(FORGE_CAVEAT).toMatch(/Forge’s hands/);
    expect(VERDICT_WORDS.unclear).toMatch(/neither strong nor weak: the interval includes 50%/);
    expect(winLine(rateOf(6, 12)!)).toMatch(/^50% \(95% \d+–\d+%\) over 12 games$/);
    expect(winLine(rateOf(2579, 4090)!)).toMatch(/ over 4,090 games$/);
    expect(baselineLine({ colour: 'W', games: 6719, wins: 4374, p: 0.651, from: 'archetypes' })).toBe('W decks 65% over 6,719 games');
    expect(fmt(5167)).toBe('5,167');
    expect(fmt(999)).toBe('999');
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

describe('suspicious zeros are hidden', () => {
  it('lands in a meta from before D380 (no land counted): no inclusion and no win rate', () => {
    const m = meta({ cards: { 'Arid Mesa': { picked: 23, seen: 25, avgPickIndex: 9, inDecks: 0, games: 0, wins: 0 } } } as never);
    const v = labCardView(m, 'Arid Mesa', '', undefined, { land: true })!;
    expect(v.inDeck).toBeNull();
    expect(v.win).toBeNull();
    expect(v.hidden).toBe(LAND_HIDDEN);
    expect(v.taken).not.toBeNull();
  });

  it('a nonland card picked more than 10 times and never in a deck: hidden with its reason', () => {
    const m = meta({ cards: { Amalgam: { picked: 23, seen: 30, inDecks: 0, games: 0, wins: 0 }, Rare: { picked: 4, seen: 30, inDecks: 0, games: 0, wins: 0 } } } as never);
    const v = labCardView(m, 'Amalgam', 'B')!;
    expect(v.inDeck).toBeNull();
    expect(v.hidden).toBe(ZERO_HIDDEN);
    // Picked a few times and never played: a real 0 of 4, shown.
    expect(labCardView(m, 'Rare', 'B')!.inDeck).toEqual({ inDecks: 0, picked: 4, p: 0 });
    expect(labCardView(m, 'Rare', 'B')!.hidden).toBeNull();
  });

  it('lands counted in the meta (D380) show their numbers', () => {
    const m = meta({ cards: { 'Arid Mesa': { picked: 23, seen: 25, avgPickIndex: 9, inDecks: 18, games: 40, wins: 21 } } } as never);
    const v = labCardView(m, 'Arid Mesa', '', undefined, { land: true })!;
    expect(v.hidden).toBeNull();
    expect(v.inDeck).toEqual({ inDecks: 18, picked: 23, p: 18 / 23 });
    expect(v.win).not.toBeNull();
  });

  it('a land never built, in a meta that counts lands: the zero rule and its reason, not the old land gap', () => {
    const land = (name: string) => ({ name, types: ['Land'] });
    const m = meta({
      cube: { name: 'T', cards: [land('Arid Mesa'), land('Ancient Tomb'), land('Wasteland')] },
      cards: {
        'Arid Mesa': { picked: 23, seen: 25, inDecks: 18, games: 40, wins: 21 },
        'Ancient Tomb': { picked: 30, seen: 40, inDecks: 0, games: 0, wins: 0 },
        Wasteland: { picked: 3, seen: 40, inDecks: 0, games: 0, wins: 0 },
      },
    } as never);
    expect(labCardView(m, 'Ancient Tomb', '', undefined, { land: true })!.hidden).toBe(ZERO_HIDDEN);
    // Rarely picked and never built: a real 0 of 3, shown like a nonland card's.
    expect(labCardView(m, 'Wasteland', '', undefined, { land: true })!.hidden).toBeNull();
    expect(labCardView(m, 'Wasteland', '', undefined, { land: true })!.inDeck).toEqual({ inDecks: 0, picked: 3, p: 0 });
  });

  it('the shipped metas (J075, D380) show deck numbers for every land but one never built', () => {
    // 81 lands across the four cubes; only vintage's Ancient Tomb (picked
    // 2,386 times, never in a deck) is hidden, by the zero rule. Nonland zeros:
    // synergy's Soul-Scar Mage and Grumgully, the Generous.
    const landHidden: string[] = [];
    const zero: string[] = [];
    let lands = 0;
    for (const id of ['modern-era-cube-180', 'pauper-cube-180', 'synergy-cube-180', 'vintage-cube-180']) {
      const m = shipped(id);
      for (const c of m.cube.cards ?? []) {
        const types = Array.isArray(c.types) ? c.types.join(' ') : (c.types ?? '');
        const isLand = /\bLand\b/.test(types);
        const v = labCardView(m, c.name, '', undefined, { land: isLand });
        if (!v) continue;
        expect(v.hidden).not.toBe(LAND_HIDDEN);
        if (isLand) {
          lands++;
          if (v.hidden !== null) landHidden.push(c.name);
          else expect(v.inDeck).not.toBeNull();
        } else if (v.hidden === ZERO_HIDDEN) zero.push(c.name);
      }
    }
    expect(lands).toBe(81);
    expect(landHidden).toEqual(['Ancient Tomb']);
    expect(zero.sort()).toEqual(['Grumgully, the Generous', 'Soul-Scar Mage']);
  });
});

describe('the colour note: computed from the meta, never a fixed colour', () => {
  const base = (rows: Record<string, [number, number]>) => new Map(Object.entries(rows).map(([c, [wins, games]]) => [c, { colour: c, games, wins, p: wins / games, from: 'lab' as const }]));

  it('names the colour furthest from 50%, with its rate and interval', () => {
    const s = colourSkew(base({ W: [650, 1000], U: [440, 1000], R: [430, 1000] }))!;
    expect(s.colour).toBe('W');
    expect(s.rate.p).toBeCloseTo(0.65, 9);
    const note = colourNote(s);
    expect(note).toMatch(/^In this cube’s lab, White decks won 65% \(95% \d+–\d+%\) over 1,000 games, clearly above 50%/);
    expect(note).toMatch(/compare a card with its colour baseline beside it, not with 50%/);
    // A colour below 50% can be the furthest, and the note says "below".
    const low = colourSkew(base({ W: [520, 1000], G: [400, 1000] }))!;
    expect(low.colour).toBe('G');
    expect(colourNote(low)).toMatch(/Green decks won 40% .* clearly below 50%/);
  });

  it('says nothing when the furthest colour’s interval includes 50%', () => {
    expect(colourSkew(base({ W: [11, 20], U: [9, 20] }))).toBeNull();
    expect(colourSkew(new Map())).toBeNull();
  });

  it('on the shipped metas (J075) it follows the data: white in synergy, the furthest colour, whichever it is', () => {
    const pick = (id: string) => colourSkew(colourBaselines(shipped(id)));
    expect(pick('synergy-cube-180')!.colour).toBe('W');
    for (const id of ['modern-era-cube-180', 'pauper-cube-180', 'synergy-cube-180', 'vintage-cube-180']) {
      const s = pick(id);
      if (!s) continue;
      expect(s.rate.lo > 0.5 || s.rate.hi < 0.5).toBe(true);
      const all = [...colourBaselines(shipped(id)).values()];
      for (const b of all) expect(Math.abs(b.wins / b.games - 0.5)).toBeLessThanOrEqual(Math.abs(s.rate.p - 0.5) + 1e-12);
    }
  });
});

describe('the small-sample sentence', () => {
  it('names only the cards under the threshold, and is absent otherwise', () => {
    const m = meta({
      cards: {
        Thin: { picked: 30, seen: 40, inDecks: 12, games: 12, wins: 6 },
        Thick: { picked: 3000, seen: 4000, inDecks: 1500, games: 1500, wins: 800 },
        Edge: { picked: 300, seen: 400, inDecks: SMALL_SAMPLE_GAMES, games: SMALL_SAMPLE_GAMES, wins: 50 },
      },
    } as never);
    const v = (n: string) => labCardView(m, n, '');
    expect(smallSampleNote([v('Thin'), v('Thick'), v('Edge'), null])).toBe(`Small sample: Thin has fewer than ${SMALL_SAMPLE_GAMES} games, so read its interval, not the rate.`);
    expect(smallSampleNote([v('Thick'), v('Edge')])).toBeNull();
    expect(smallSampleNote([v('Thin'), v('Thin')])).toMatch(/^Small samples: Thin, Thin have/);
  });
});

describe('average pick in a Grid meta', () => {
  it('is hidden: a Grid card is taken about when it shows up, so the average says little', () => {
    const grid = meta({ sample: { drafts: 10, games: 100, format: 'grid' } });
    expect(labCardView(grid, 'Bolt', 'R')!.avgPick).toBeNull();
    expect(labCardView(grid, 'Bolt', 'R')!.taken).toEqual({ picked: 9, seen: 10, p: 0.9 });
    expect(labCardView(meta({ sample: { drafts: 10, games: 100, format: 'winston' } }), 'Bolt', 'R')!.avgPick).toBe(2.4);
    expect(labCardView(meta(), 'Bolt', 'R')!.avgPick).toBe(2.4);
  });
});
