/*
 * ForgeCoach — cube/human.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CUBES, cubeInfo } from './cubes.ts';
import { parseCube } from './parseCube.ts';
import { ARENA_NOTE, humanAverage, humanCardView, humanLine, humanSourceLine, humanVerdict, humanVerdictLine, iwdLine, loadHumanCards, normName, parseHumanCards, type HumanCards } from './human.ts';

const pub = (p: string) => new URL(`../../public/cubes/${p}`, import.meta.url);
const shippedRaw = () => JSON.parse(readFileSync(pub('vintage-cube-180.human.json'), 'utf8'));

function file(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 1,
    source: {
      name: '17Lands',
      page: 'https://www.17lands.com/public_datasets',
      licence: 'CC BY 4.0',
      licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
      dataset: 'Powered Cube',
      files: ['game_data_public.Cube_-_Powered.PremierDraft.csv.gz'],
      updated: '2025-11-23',
    },
    generated: '2026-10-06',
    cube: { file: 'vintage-cube-180.md', title: 'T', cards: 180, matched: 3 },
    minGih: 500,
    games: 10000,
    wins: 5500,
    gih: { games: 100000, wins: 55000 },
    cards: {
      Bomb: { gih: 10000, gihW: 6200, oh: 4000, ohW: 2500, gns: 9000, gnsW: 4700 },
      Filler: { gih: 10000, gihW: 5480 },
      Dud: { gih: 10000, gihW: 5100, gns: 9000, gnsW: 5000 },
    },
    ...over,
  };
}

describe('parseHumanCards', () => {
  it('reads the shipped Vintage cube file: 17Lands, CC BY 4.0, the cube’s own names', () => {
    const d = parseHumanCards(shippedRaw());
    expect(d.source.name).toBe('17Lands');
    expect(d.source.licence).toBe('CC BY 4.0');
    expect(d.source.dataset).toBe('Powered Cube');
    expect(d.cube.file).toBe('vintage-cube-180.md');
    expect(Object.keys(d.cards).length).toBe(d.cube.matched);
    expect(d.cube.matched / d.cube.cards).toBeGreaterThanOrEqual(0.75);
    const cube = parseCube(readFileSync(pub('vintage-cube-180.md'), 'utf8'));
    const names = new Set(cube.cards.map((c) => c.name));
    expect(cube.title).toBe(d.cube.title);
    for (const n of Object.keys(d.cards)) expect(names.has(n), n).toBe(true);
    for (const c of Object.values(d.cards)) expect(c.gih).toBeGreaterThanOrEqual(d.minGih);
    // Nothing but counts per card.
    for (const c of Object.values(shippedRaw().cards as Record<string, object>)) expect(Object.keys(c).sort()).toEqual(['gih', 'gihW', 'gns', 'gnsW', 'oh', 'ohW']);
  });

  it('refuses another schema, a missing source or licence, and bad totals', () => {
    expect(() => parseHumanCards(null)).toThrow(/not a JSON object/);
    expect(() => parseHumanCards(file({ schema: 2 }))).toThrow(/schema 2/);
    expect(() => parseHumanCards(file({ source: undefined }))).toThrow(/source/);
    expect(() => parseHumanCards(file({ source: { ...(file().source as object), licence: '' } }))).toThrow(/licence/);
    expect(() => parseHumanCards(file({ source: { ...(file().source as object), page: 'javascript:alert(1)' } }))).toThrow(/page/);
    expect(() => parseHumanCards(file({ source: { ...(file().source as object), updated: 'last week' } }))).toThrow(/updated/);
    expect(() => parseHumanCards(file({ wins: 20000 }))).toThrow(/wins/);
    expect(() => parseHumanCards(file({ gih: { games: 0, wins: 0 } }))).toThrow(/gih/);
    expect(() => parseHumanCards(file({ cards: [] }))).toThrow(/cards/);
  });

  it('drops a malformed card, or one under the threshold, and keeps the rest', () => {
    const d = parseHumanCards(
      file({
        cards: {
          Good: { gih: 600, gihW: 300, oh: 'x', ohW: 1 },
          Few: { gih: 499, gihW: 200 },
          Impossible: { gih: 600, gihW: 601 },
          Fractional: { gih: 600.5, gihW: 1 },
          Negative: { gih: -600, gihW: 1 },
          NotAnObject: 3,
        },
      }),
    );
    expect(Object.keys(d.cards)).toEqual(['Good']);
    expect(d.cards.Good).toEqual({ gih: 600, gihW: 300 });
  });
});

describe('humanCardView', () => {
  const d = parseHumanCards(file()) as HumanCards;

  it('measures against the format’s average, not 50%', () => {
    expect(humanAverage(d)).toBeCloseTo(0.55);
    const bomb = humanCardView(d, 'Bomb')!;
    expect(bomb.verdict).toBe('strong');
    expect(bomb.gih.p).toBeCloseTo(0.62);
    expect(bomb.gih.lo).toBeLessThan(0.62);
    expect(bomb.gih.hi).toBeGreaterThan(0.62);
    // 54.8% on 10,000 games: the interval includes 55%.
    expect(humanCardView(d, 'Filler')!.verdict).toBe('unclear');
    // 51% is above 50% yet clearly below this format's 55%.
    expect(humanCardView(d, 'Dud')!.verdict).toBe('weak');
    expect(humanVerdict({ lo: 0.5, hi: 0.6 }, 0.55)).toBe('unclear');
    expect(humanVerdict({ lo: 0.551, hi: 0.6 }, 0.55)).toBe('strong');
  });

  it('gives the opening-hand rate and IWD only when the file has them', () => {
    const bomb = humanCardView(d, 'Bomb')!;
    expect(bomb.oh!.p).toBeCloseTo(0.625);
    expect(bomb.iwd!.d).toBeCloseTo(0.62 - 4700 / 9000);
    expect(bomb.iwd!.lo).toBeLessThan(bomb.iwd!.d);
    expect(humanCardView(d, 'Filler')!.oh).toBeNull();
    expect(humanCardView(d, 'Filler')!.iwd).toBeNull();
  });

  it('says nothing about a card the file lacks', () => {
    expect(humanCardView(d, 'Black Lotus')).toBeNull();
    expect(humanCardView(null, 'Bomb')).toBeNull();
  });

  it('words it with one decimal, the interval and the games', () => {
    const v = humanCardView(d, 'Bomb')!;
    expect(humanLine(v)).toMatch(/^62\.0% win when drawn \[61\.\d, 62\.\d\], 10,000 games$/);
    expect(humanVerdictLine(v)).toBe('strong for humans: the interval is above the format’s 55.0% average');
    expect(humanVerdictLine(humanCardView(d, 'Filler')!)).toMatch(/^neither strong nor weak/);
    expect(iwdLine(v.iwd!)).toMatch(/^improvement when drawn \+9\.8 points \[\+\d\.\d, \+\d+\.\d\]$/);
    expect(humanSourceLine(d)).toBe('Powered Cube game data, updated 2025-11-23, 10,000 games');
    expect(ARENA_NOTE).toMatch(/Arena version/);
  });
});

describe('loadHumanCards', () => {
  it('asks only for a cube that ships human data, under the base', async () => {
    const asked: string[] = [];
    const fetcher = async (u: string) => {
      asked.push(u);
      return new Response(JSON.stringify(file()), { status: 200 });
    };
    expect(await loadHumanCards(cubeInfo('pauper')!, '/ForgeCoach/', fetcher)).toBeNull();
    expect(asked).toEqual([]);
    const d = await loadHumanCards(cubeInfo('vintage')!, '/ForgeCoach/', fetcher);
    expect(asked).toEqual(['/ForgeCoach/cubes/vintage-cube-180.human.json']);
    expect(d?.cards.Bomb?.gih).toBe(10000);
  });

  it('returns null on a 404 or an invalid file', async () => {
    expect(await loadHumanCards(cubeInfo('vintage')!, '/', async () => new Response('', { status: 404 }))).toBeNull();
    expect(await loadHumanCards(cubeInfo('vintage')!, '/', async () => new Response('{"schema":9}', { status: 200 }))).toBeNull();
  });

  it('ships a file exactly for the cubes flagged humanData', () => {
    for (const c of CUBES) expect(existsSync(pub(`${c.file}.human.json`)), c.id).toBe(c.humanData === true);
    expect(CUBES.filter((c) => c.humanData).map((c) => c.id)).toEqual(['vintage']);
  });
});

describe('normName', () => {
  it('joins on the front face, case-folded, accents and curly quotes flattened', () => {
    expect(normName('Fire // Ice')).toBe('fire');
    expect(normName('Jace, the Mind  Sculptor')).toBe('jace, the mind sculptor');
    expect(normName('Lim-Dûl’s Vault')).toBe("lim-dul's vault");
    expect(normName('Séance')).toBe(normName('seance'));
  });
});
