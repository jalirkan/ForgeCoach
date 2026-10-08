// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CUBES } from './cubes.ts';
import { modelFacts, humanPickChances, humanPickLine, humanPickNote, humanPickRank, humanPickTier, loadHumanPicks, parseHumanPicks, pickFeatures, pickPool, PICK_FEATURES, type HumanPicks } from './humanPicks.ts';
import { context, loadCube, type CubeId } from './testdata/load.ts';

const shipped = (file: string): unknown => JSON.parse(readFileSync(new URL(`../../public/cubes/${file}.picks.json`, import.meta.url), 'utf8'));
const vintage = () => parseHumanPicks(shipped('vintage-cube-180'));

type GoldenFacts = { colors: string; mv: number; land: boolean; produces: string } | null;
const golden = JSON.parse(readFileSync(new URL('./testdata/human-picks-golden.json', import.meta.url), 'utf8')) as {
  facts: Record<string, GoldenFacts>;
  cases: Array<{ pool: string[]; pack: string[]; features: number[][]; p: number[] }>;
};

describe('shipped picks files', () => {
  const withPicks = CUBES.filter((c) => c.humanPicks);
  it('ship for the cubes that passed docs/human-picks.md, and only those', () => {
    expect(withPicks.map((c) => c.id).sort()).toEqual(['evybaby', 'fair-fight', 'modern-era', 'omega', 'peasant', 'synergy', 'vintage']);
  });
  for (const info of withPicks) {
    it(`${info.id}: parses, every card is a cube card, the test numbers favour the model`, () => {
      const d = parseHumanPicks(shipped(info.file));
      const names = new Set(loadCube(info.id as CubeId).cards.map((c) => c.name));
      const keys = Object.keys(d.cards);
      expect(keys.length).toBe(d.cube.matched);
      for (const k of keys) expect(names.has(k), k).toBe(true);
      expect(d.cube.file).toBe(`${info.file}.md`);
      expect(d.test.top1).toBeGreaterThan(d.test.top1PickValue);
      expect(d.test.top1).toBeGreaterThan(d.test.top1CardValue);
    });
  }
});

describe('parseHumanPicks', () => {
  const good = shipped('vintage-cube-180') as Record<string, unknown>;
  it('rejects another schema, a missing coefficient and a non-https source', () => {
    expect(() => parseHumanPicks({ ...good, schema: 2 })).toThrow(/schema/);
    const model = good.model as Record<string, unknown>;
    const beta = { ...(model.beta as Record<string, number>) };
    delete (beta as Record<string, number>).fit;
    expect(() => parseHumanPicks({ ...good, model: { ...model, beta } })).toThrow(/beta\.fit/);
    expect(() => parseHumanPicks({ ...good, source: { ...(good.source as object), page: 'http://x.example' } })).toThrow(/source/);
  });
  it('drops a malformed card and keeps the rest', () => {
    const cards = { ...(good.cards as object), Bad: { s: 'x', seen: 1, taken: 0 }, Worse: { s: 1, seen: 1, taken: 2 } };
    const d = parseHumanPicks({ ...good, cards });
    expect(d.cards.Bad).toBeUndefined();
    expect(d.cards.Worse).toBeUndefined();
    expect(Object.keys(d.cards).length).toBe(Object.keys(good.cards as object).length);
  });
  it('loads only for a cube that ships one', async () => {
    let asked = 0;
    const fetcher = async () => {
      asked++;
      return { ok: true, status: 200, json: async () => good };
    };
    expect(await loadHumanPicks({ file: 'x' }, '/', fetcher)).toBeNull();
    expect(asked).toBe(0);
    expect((await loadHumanPicks({ file: 'vintage-cube-180', humanPicks: true }, '/', fetcher))?.cube.matched).toBe(152);
    expect(await loadHumanPicks({ file: 'x', humanPicks: true }, '/', async () => ({ ok: false, status: 404, json: async () => null }))).toBeNull();
  });
});

describe('the model, against fit.py (testdata/human-picks-golden.json)', () => {
  const d = vintage();
  const factsOf = (n: string) => golden.facts[n] ?? undefined;
  it('features and probabilities match fit.py on 30 held-out picks', () => {
    expect(golden.cases.length).toBe(30);
    for (const c of golden.cases) {
      const pp = pickPool(c.pool, factsOf, d.model.tScale);
      c.pack.forEach((n, i) => {
        const x = pickFeatures(factsOf(n), pp, d.model);
        x.forEach((v, j) => expect(v, `${n} ${PICK_FEATURES[j]}`).toBeCloseTo(c.features[i]![j]!, 6));
      });
      const ch = humanPickChances(d, c.pack, c.pool, factsOf);
      c.pack.forEach((n, i) => expect(ch.find((x) => x.name === n)!.p, n).toBeCloseTo(c.p[i]!, 6));
    }
  });
  it('the app’s card facts for the Vintage cube, with the file’s colours, agree with what fit.py read', () => {
    const ctx = context('vintage');
    const factsOf = modelFacts(d, (x) => ctx.facts.get(x));
    let n = 0;
    for (const [name, g] of Object.entries(golden.facts)) {
      const f = factsOf(name);
      if (!f || !g) continue;
      n++;
      expect({ colors: f.colors, land: f.land, mv: f.mv, produces: f.produces }, name).toEqual({ colors: g.colors, land: g.land, mv: g.mv, produces: g.produces });
    }
    expect(n).toBeGreaterThan(50);
  });
});

describe('words', () => {
  const d: HumanPicks = vintage();
  it('ranks, tiers and lines', () => {
    expect(humanPickRank(d, 'Black Lotus')).toEqual({ rank: 1, of: 152 });
    expect(humanPickTier(d, 'Black Lotus')).toBe('early');
    expect(humanPickLine(d, 'Black Lotus')).toBe('Humans take this early · #1 of 152 by human picks');
    expect(humanPickLine(d, 'Not A Card')).toBeNull();
    const tiers = Object.keys(d.cards).map((n) => humanPickTier(d, n));
    expect(tiers.filter((t) => t === 'early').length).toBeGreaterThan(25);
    expect(tiers.filter((t) => t === 'late').length).toBeGreaterThan(40);
  });
  it('a choice: chances sum to 1, uncovered cards are left out and named, fewer than two covered says nothing', () => {
    const ctx = context('vintage');
    const factsOf = (n: string) => ctx.facts.get(n);
    const ch = humanPickChances(d, ['Black Lotus', 'Thraben Inspector', 'Not A Card'], [], factsOf);
    expect(ch.map((c) => c.name)).toEqual(['Black Lotus', 'Thraben Inspector']);
    expect(ch.reduce((s, c) => s + c.p, 0)).toBeCloseTo(1, 9);
    expect(humanPickNote(d, ['Black Lotus', 'Thraben Inspector', 'Not A Card'], [], factsOf)).toMatch(/^Of these, humans with your pool would most often take Black Lotus \(\d+%\), then Thraben Inspector \(\d+%\); 1 card is not in their data\.$/);
    expect(humanPickNote(d, ['Black Lotus', 'Not A Card'], [], factsOf)).toBeNull();
  });
  it('the pool moves the chances toward its colours', () => {
    const ctx = context('vintage');
    const factsOf = (n: string) => ctx.facts.get(n);
    const red = Object.keys(d.cards).filter((n) => ctx.facts.get(n)?.colors === 'R' && !ctx.facts.get(n)?.land).slice(0, 12);
    const pair = ['Lightning Bolt', 'Counterspell'].filter((n) => d.cards[n]);
    expect(pair.length).toBe(2);
    const empty = humanPickChances(d, pair, [], factsOf).find((c) => c.name === 'Lightning Bolt')!.p;
    const redPool = humanPickChances(d, pair, red, factsOf).find((c) => c.name === 'Lightning Bolt')!.p;
    expect(redPool).toBeGreaterThan(empty);
  });
});
