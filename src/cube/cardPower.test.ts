// ForgeCoach — cube/cardPower.test.ts
// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { fromPowerTsv, loadCardPower, nightsLabel, parseCardPower, pointsLine, resetCardPowerCache, signed } from './cardPower.ts';
import { buildDecks } from './builder.ts';
import { buildDeckPrompt } from './deckPrompt.ts';
import { cardPrior, cardValue, metaValue, POWER_VALUE_PER_LOGIT, powerValue, VALUE_PER_RATE } from './score.ts';
import { context, loadCube, loadPower, loadRealMeta, samplePool, type CubeId } from './testdata/load.ts';
import { powerNote, powerRow, powerVerdict, POWER_VERDICT_WORDS, UNRATED_WORDS } from '../draft/labStats.ts';
import { LabNumbers } from '../ui/draft/LabNumbers.tsx';

const TSV = readFileSync(new URL('./testdata/J062-power.tsv', import.meta.url), 'utf8');
const SHIPPED = JSON.parse(readFileSync(new URL('../../public/cubes/card-power.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const CUBES: CubeId[] = ['synergy', 'modern-era', 'vintage', 'pauper', 'omega', 'fair-fight', 'peasant'];

/** A minimal valid file around some card rows. */
const file = (cards: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
  schema: 1, model: 'M0', source: { job: 'J062', nights: '1-2', games: 48202, tau: 0.06 }, pointsPerLogit: 25, cards, ...over,
});

describe('card-power.json: the shipped file', () => {
  it('is what scripts/card-power.ts makes from J062’s power.tsv (committed beside it)', () => {
    expect(SHIPPED).toEqual(fromPowerTsv(TSV, { job: 'J062', nights: '1-2' }));
  });

  it('validates whole, and has a row for every card of the seven cubes', () => {
    const d = loadPower();
    expect(d.dropped).toBe(0);
    expect(d.cards.size).toBe(727);
    expect(d.source).toEqual({ job: 'J062', nights: '1-2', games: 48202, tau: 0.06 });
    expect(nightsLabel(d)).toBe('nights 1–2');
    for (const id of CUBES) for (const c of loadCube(id).cards) expect(d.cards.has(c.name), `${id}: ${c.name}`).toBe(true);
  });

  it('never carries a number for a card Forge’s AI does not build (AI:RemoveDeck:All)', () => {
    const limited = TSV.split('\n').filter((l) => l.split('\t')[8] === 'limited').map((l) => l.split('\t')[0] as string);
    expect(limited.length).toBe(22);
    const cards = SHIPPED.cards as Record<string, Record<string, unknown>>;
    for (const n of limited) {
      expect(cards[n]).toMatchObject({ unrated: 'limited' });
      expect(cards[n]).not.toHaveProperty('power');
      expect(cards[n]).not.toHaveProperty('sd');
    }
    const d = loadPower();
    for (const n of limited) expect(d.cards.get(n)).toMatchObject({ unrated: true, power: null, sd: null, ai: 'limited' });
  });
});

describe('parseCardPower: strict', () => {
  it('throws on a bad envelope', () => {
    expect(() => parseCardPower(null)).toThrow(/not a JSON object/);
    expect(() => parseCardPower(file({ A: { power: 0.1, sd: 0.02, games: 10, cubes: [] } }, { schema: 2 }))).toThrow(/schema 2/);
    expect(() => parseCardPower(file({ A: { power: 0.1, sd: 0.02, games: 10, cubes: [] } }, { model: 'M1' }))).toThrow(/not M0/);
    expect(() => parseCardPower(file({ A: { power: 0.1, sd: 0.02, games: 10, cubes: [] } }, { source: { job: 'x', nights: '1-2', games: 1, tau: 0.06 } }))).toThrow(/source/);
    expect(() => parseCardPower(file({ A: { power: 0.1, sd: 0.02, games: 10, cubes: [] } }, { pointsPerLogit: -1 }))).toThrow(/pointsPerLogit/);
    expect(() => parseCardPower(file({ A: { power: 'x' } }))).toThrow(/no valid card/);
  });

  it('drops and counts a bad row; a limited row keeps no power, whatever it says', () => {
    const d = parseCardPower(file({
      Good: { power: 0.1, sd: 0.02, games: 10, cubes: ['vintage'] },
      NoSd: { power: 0.1, games: 10, cubes: [] },
      Huge: { power: 9, sd: 0.02, games: 10, cubes: [] },
      BadCube: { power: 0.1, sd: 0.02, games: 10, cubes: ['../x'] },
      BadAi: { power: 0.1, sd: 0.02, games: 10, cubes: [], ai: 'never' },
      Sneaky: { unrated: 'limited', power: 0.3, sd: 0.01, games: 10, cubes: [] },
      Rnd: { power: -0.02, sd: 0.03, games: 10, cubes: [], ai: 'random' },
    }));
    expect([...d.cards.keys()].sort()).toEqual(['Good', 'Rnd', 'Sneaky']);
    expect(d.dropped).toBe(4);
    expect(d.cards.get('Sneaky')).toMatchObject({ unrated: true, power: null, sd: null });
    expect(d.cards.get('Rnd')).toMatchObject({ ai: 'random', unrated: false });
  });

  it('fromPowerTsv refuses a table that is not J062’s', () => {
    expect(() => fromPowerTsv('name\tpower\n', { job: 'J062', nights: '1-2' })).toThrow(/header comments/);
    expect(() => fromPowerTsv(TSV.replace('\tsdPost\t', '\tsdX\t'), { job: 'J062', nights: '1-2' })).toThrow(/sdPost/);
  });

  it('loads once through an injected fetch; a missing file is null', async () => {
    resetCardPowerCache();
    let calls = 0;
    const ok = await loadCardPower('/b/', async (u) => { calls++; expect(u).toBe('/b/cubes/card-power.json'); return { ok: true, status: 200, json: async () => SHIPPED }; });
    expect(ok?.cards.size).toBe(727);
    await loadCardPower('/b/', async () => { calls++; return { ok: false, status: 404, json: async () => null }; });
    expect(calls).toBe(1);
    resetCardPowerCache();
    expect(await loadCardPower('/b/', async () => ({ ok: false, status: 404, json: async () => null }))).toBeNull();
    resetCardPowerCache();
  });
});

describe('score: the matchup model in card value', () => {
  const power = loadPower();

  it('one logit counts as one unit of win rate did; the weight is 1 − (sd / tau)²', () => {
    expect(POWER_VALUE_PER_LOGIT).toBe(VALUE_PER_RATE);
    const ctx = context('vintage', loadRealMeta('vintage'), true, power);
    const p = powerValue('Wurmcoil Engine', ctx)!;
    expect(p.power).toBe(0.1243);
    expect(p.weight).toBeCloseTo(1 - (0.0171 / 0.06) ** 2, 10);
    expect(p.value).toBeCloseTo(50 + 250 * 0.1243, 10);
    expect(p.points).toBeCloseTo(3.1075, 10);
    expect(p.lo).toBeCloseTo(25 * (0.1243 - 1.96 * 0.0171), 10);
    // the value blends the model with this page's prior, never the meta's rate
    const m = metaValue('Wurmcoil Engine', ctx)!;
    expect(m.games).toBeGreaterThan(0);
    const noPower = context('vintage', loadRealMeta('vintage'), true, null);
    expect(cardValue('Wurmcoil Engine', ctx)).not.toBe(cardValue('Wurmcoil Engine', noPower));
  });

  it('a card the model barely saw (sd ≥ tau) falls back to the prior', () => {
    const ctx = context('peasant', null, true, power);
    const p = powerValue('Primordial Pachyderm', ctx);
    expect(p?.weight).toBe(0);
    expect(cardValue('Primordial Pachyderm', ctx)).toBe(cardPrior('Primordial Pachyderm', ctx));
  });

  it('an unrated card and a land have no power value: they take the meta route', () => {
    const ctx = context('vintage', loadRealMeta('vintage'), true, power);
    const without = context('vintage', loadRealMeta('vintage'), true, null);
    const limited = [...power.cards.entries()].filter(([, c]) => c.unrated && c.cubes.includes('vintage')).map(([n]) => n);
    expect(limited.length).toBeGreaterThan(0);
    for (const n of limited) {
      expect(powerValue(n, ctx)).toBeNull();
      expect(cardValue(n, ctx)).toBe(cardValue(n, without));
    }
    const land = loadCube('vintage').cards.find((c) => c.land)!.name;
    expect(powerValue(land, ctx)).toBeNull();
    expect(cardValue(land, ctx)).toBe(cardValue(land, without));
  });

  it('the cubes without a meta get lab values too, and every cube still builds 40-card decks', () => {
    for (const id of CUBES) {
      const meta = ['synergy', 'modern-era', 'vintage', 'pauper'].includes(id) ? loadRealMeta(id) : null;
      const ctx = context(id, meta, true, power);
      const cube = loadCube(id);
      const rated = cube.cards.filter((c) => powerValue(c.name, ctx)).length;
      expect(rated, id).toBeGreaterThan(120);
      for (const seed of [1, 2]) {
        const b = buildDecks(ctx, samplePool(cube, 'WU', 45, seed))[0];
        expect(b, `${id} ${seed}`).toBeTruthy();
        expect(b!.missing, `${id} ${seed}`).toBe(0);
        expect(b!.spells.length + b!.landCount, `${id} ${seed}`).toBe(40);
      }
    }
  });

  it('the deck prompt says the lab strength with its interval', () => {
    const ctx = context('vintage', loadRealMeta('vintage'), true, power);
    const pool = samplePool(loadCube('vintage'), 'UR', 45, 3);
    const b = buildDecks(ctx, pool)[0]!;
    const text = buildDeckPrompt({ ctx, pool, build: b, infos: new Map() }).user;
    expect(text).toMatch(/lab strength [+−]?\d+\.\d pts \(95% [+−]?\d+\.\d to [+−]?\d+\.\d\) per copy/);
  });
});

describe('labStats: the pick screen’s lab strength', () => {
  const power = loadPower();

  it('strong or weak only when the 95% interval of the points excludes 0', () => {
    expect(powerVerdict(0.1, 2)).toBe('strong');
    expect(powerVerdict(-2, -0.1)).toBe('weak');
    expect(powerVerdict(-0.1, 2)).toBe('unclear');
    const s = powerRow(power, 'Sheoldred, the Apocalypse', false);
    expect(s).toMatchObject({ kind: 'rated', view: { verdict: 'strong', games: 7304 } });
    if (s?.kind === 'rated') expect(pointsLine(s.view)).toBe('+5.7 pts (95% +4.1 to +7.2)');
    // every rated card's verdict agrees with its interval
    for (const [n, c] of power.cards) {
      const r = powerRow(power, n, false);
      if (c.land) { expect(r).toBeNull(); continue; }
      if (c.unrated) { expect(r).toEqual({ kind: 'unrated' }); continue; }
      if (r?.kind !== 'rated') throw new Error(n);
      const v = r.view;
      expect(v.verdict, n).toBe(v.lo > 0 ? 'strong' : v.hi < 0 ? 'weak' : 'unclear');
    }
  });

  it('formats signs with a true minus', () => {
    expect(signed(1.23)).toBe('+1.2');
    expect(signed(-0.84)).toBe('−0.8');
    expect(signed(0.01)).toBe('0.0');
    expect(pointsLine({ points: -0.8, lo: -2.1, hi: 0.5 })).toBe('−0.8 pts (95% −2.1 to +0.5)');
  });

  it('the panel shows the line, the unrated words and the note — and for a cube with no meta', () => {
    const limited = [...power.cards.entries()].find(([, c]) => c.unrated)?.[0];
    const ctx = context('omega', null, true, power);
    const names = ['Sower of Temptation', ...(limited ? [limited] : [])];
    const html = renderToStaticMarkup(createElement(LabNumbers, { names, ctx }));
    expect(html).toContain('Lab strength');
    expect(html).toContain('+4.6 pts (95% +3.0 to +6.3)');
    expect(html).toContain(POWER_VERDICT_WORDS.strong);
    expect(html).toContain('matchup model, nights 1–2');
    expect(html).toContain(powerNote(power));
    expect(limited).toBeTruthy();
    expect(html).toContain(UNRATED_WORDS);
    // nothing at all without a meta or the power file
    expect(renderToStaticMarkup(createElement(LabNumbers, { names, ctx: context('omega', null, true, null) }))).toBe('');
  });
});
