/*
 * ForgeCoach — cube/humanBlend.test.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The 17Lands blend in score.ts (docs/human-blend.md): the formula, cards and
 * cubes without data unchanged, Synergy's anchored blend (part 2), and the
 * Draft vs AI drafter untouched.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CUBES } from './cubes.ts';
import { parseHumanCards, type HumanCards } from './human.ts';
import { buildDecks } from './builder.ts';
import { recommendWinston } from './pick.ts';
import {
  cardPrior,
  cardValue,
  HUMAN_DISCOUNT,
  humanValue,
  humanValueLine,
  humanValueNote,
  labOnly,
  labValue,
  makeContext,
  META_STRENGTH,
  metaValue,
  usesHumanData,
  type CubeContext,
} from './score.ts';
import { loadCube, loadInfos, loadRealMeta, type CubeId } from './testdata/load.ts';
import { labCards } from '../draft/cards.ts';
import { newDraft, selfPlay } from '../draft/draft.ts';

const human: HumanCards = parseHumanCards(JSON.parse(readFileSync(new URL('../../public/cubes/vintage-cube-180.human.json', import.meta.url), 'utf8')));

function vintage(h: HumanCards | null): CubeContext {
  const cube = loadCube('vintage');
  return makeContext(cube, loadInfos('vintage', cube), loadRealMeta('vintage'), h);
}

const isLand = (n: string, ctx: CubeContext) => !!(ctx.facts.get(n)?.land || ctx.byName.get(n)?.land);

describe('the human blend (score.ts)', () => {
  const today = vintage(null);
  const blended = vintage(human);
  const names = today.cube.cards.map((c) => c.name);

  it('without human data, cardValue is labValue (today’s formula)', () => {
    for (const n of names) expect(cardValue(n, today)).toBe(labValue(n, today));
  });

  it('applies the pre-registered formula to a nonland card with a human row', () => {
    const n = names.find((x) => human.cards[x] && !isLand(x, blended) && metaValue(x, blended))!;
    expect(n).toBeTruthy();
    const c = human.cards[n]!;
    const p = c.gihW / c.gih;
    const avg = human.gih.wins / human.gih.games;
    const D = 0.8;
    expect(HUMAN_DISCOUNT).toBe(D);
    const h = 50 + 250 * D * (p - avg);
    const H = (0.375 * c.gih) / (D * D * p * (1 - p));
    const m = metaValue(n, blended)!;
    const want = (META_STRENGTH * cardPrior(n, blended) + m.games * m.value + H * h) / (META_STRENGTH + m.games + H);
    expect(cardValue(n, blended)).toBeCloseTo(Math.round(Math.min(98, Math.max(5, want)) * 10) / 10, 6);
    // Human data leads where it exists (66–100% of the weight over the shipped file).
    expect(H / (META_STRENGTH + m.games + H)).toBeGreaterThan(0.6);
  });

  it('cards without a human row, and lands, keep today’s value exactly', () => {
    let without = 0;
    let lands = 0;
    for (const n of names) {
      if (human.cards[n] && !isLand(n, blended)) {
        expect(usesHumanData(n, blended)).toBe(true);
        continue;
      }
      if (human.cards[n]) lands++;
      else without++;
      expect(usesHumanData(n, blended)).toBe(false);
      expect(cardValue(n, blended)).toBe(cardValue(n, today));
    }
    expect(without).toBe(28); // 180 − 152
    expect(lands).toBeGreaterThan(0);
  });

  it('moves values toward the human order', () => {
    const rows = names.filter((n) => usesHumanData(n, blended));
    expect(rows.length).toBeGreaterThan(100);
    const best = [...rows].sort((a, b) => humanValue(b, blended)!.rate - humanValue(a, blended)!.rate)[0]!;
    const worst = [...rows].sort((a, b) => humanValue(a, blended)!.rate - humanValue(b, blended)!.rate)[0]!;
    expect(cardValue(best, blended)).toBeGreaterThan(cardValue(worst, blended));
  });

  it('only Vintage and Synergy ship human data; other cubes are unchanged', () => {
    expect(CUBES.filter((c) => c.humanData).map((c) => c.id)).toEqual(['synergy', 'vintage']);
    for (const id of ['modern-era', 'pauper'] as CubeId[]) {
      const cube = loadCube(id);
      const ctx = makeContext(cube, loadInfos(id, cube), loadRealMeta(id));
      expect(ctx.human).toBeNull();
      for (const c of cube.cards) expect(cardValue(c.name, ctx)).toBe(labValue(c.name, ctx));
      expect(humanValueNote(cube.cards.map((c) => c.name), ctx)).toBeNull();
    }
  });

  it('says where a value came from', () => {
    const n = names.find((x) => usesHumanData(x, blended))!;
    expect(humanValueLine(n, blended)).toMatch(/^value uses human data \(17Lands\): \d+\.\d% win when drawn against the format’s \d+\.\d%, [\d,]+ games, \d+% of the weight/);
    expect(humanValueLine(n, today)).toBeNull();
    const without = names.find((x) => !usesHumanData(x, blended))!;
    expect(humanValueNote([n], blended)).toBe('The card’s value uses human data (17Lands, Arena cube).');
    expect(humanValueNote([n, without], blended)).toBe('1 of these 2 cards’ values use human data (17Lands, Arena cube).');
    expect(humanValueNote([without], blended)).toBeNull();
    const pile = names.filter((x) => usesHumanData(x, blended)).slice(0, 3);
    const adv = recommendWinston({ pile, pileIndex: 1, sizes: [3, 1, 1], pool: [] }, blended);
    expect(adv.reasons).toContain('All 3 cards’ values use human data (17Lands, Arena cube).');
  });
});

describe('the Draft vs AI drafter ignores human data (parity with the cube lab)', () => {
  const today = vintage(null);
  const blended = vintage(human);

  it('rates every card the same with and without the human file', () => {
    const a = labCards(today);
    const b = labCards(blended);
    expect([...b.entries()]).toEqual([...a.entries()]);
    // …while the deck assistant's value does move.
    expect(today.cube.cards.some((c) => cardValue(c.name, blended) !== cardValue(c.name, today))).toBe(true);
  });

  it('drafts the same picks, every format, with and without the human file', () => {
    const names = today.cube.cards.map((c) => c.name);
    for (const format of ['grid', 'winston', 'booster'] as const) {
      const mk = () => newDraft({ cubeId: 'vintage', format, cube: names, seed: 20261006, youFirst: false, seats: 2, now: 1 });
      const a = selfPlay(mk(), labCards(today));
      const b = selfPlay(mk(), labCards(blended));
      expect(b.picks).toEqual(a.picks);
    }
  });

  it('builds the AI’s deck from lab values (labOnly)', () => {
    const lo = labOnly(blended);
    expect(lo.human).toBeNull();
    for (const c of today.cube.cards) expect(cardValue(c.name, lo)).toBe(cardValue(c.name, today));
    const pool = today.cube.cards.slice(0, 45).map((c) => c.name);
    expect(buildDecks(lo, pool)[0]?.spells).toEqual(buildDecks(today, pool)[0]?.spells);
  });
});

describe('Synergy: the anchored blend for a cube of another environment (docs/human-blend.md part 2)', () => {
  const syn: HumanCards = parseHumanCards(JSON.parse(readFileSync(new URL('../../public/cubes/synergy-cube-180.human.json', import.meta.url), 'utf8')));
  const cube = loadCube('synergy');
  const today = makeContext(cube, loadInfos('synergy', cube), loadRealMeta('synergy'));
  const blended = makeContext(cube, loadInfos('synergy', cube), loadRealMeta('synergy'), syn);
  const names = cube.cards.map((c) => c.name);
  const covered = names.filter((n) => syn.cards[n] && !isLand(n, blended));

  it('the file is marked as from another cube', () => {
    expect(syn.anchor).toBe('cube');
    expect(syn.cube.matched).toBe(79);
    expect(human.anchor).toBeUndefined();
  });

  it('anchors the human part on the covered cards’ own rate and lab level', () => {
    let k = 0;
    let g = 0;
    let lv = 0;
    for (const n of covered) {
      k += syn.cards[n]!.gihW;
      g += syn.cards[n]!.gih;
      lv += labValue(n, today);
    }
    const pbar = k / g;
    const level = lv / covered.length;
    const n = covered.find((x) => metaValue(x, blended))!;
    const c = syn.cards[n]!;
    const p = c.gihW / c.gih;
    const h = humanValue(n, blended)!;
    expect(h.anchored).toBe(true);
    expect(h.avg).toBeCloseTo(pbar, 12);
    expect(h.value).toBeCloseTo(level + 250 * HUMAN_DISCOUNT * (p - pbar), 9);
    const H = (0.375 * c.gih) / (HUMAN_DISCOUNT * HUMAN_DISCOUNT * p * (1 - p));
    const m = metaValue(n, blended)!;
    const want = (META_STRENGTH * cardPrior(n, blended) + m.games * m.value + H * h.value) / (META_STRENGTH + m.games + H);
    expect(cardValue(n, blended)).toBeCloseTo(Math.round(Math.min(98, Math.max(5, want)) * 10) / 10, 6);
    // The unanchored variant (part 1's formula) is still there for the test's information line.
    expect(humanValue(n, blended, HUMAN_DISCOUNT, false)!.anchored).toBe(false);
  });

  it('only the covered nonland cards move, and they keep their level as a group', () => {
    let shift = 0;
    for (const n of names) {
      if (covered.includes(n)) shift += cardValue(n, blended) - cardValue(n, today);
      else expect(cardValue(n, blended)).toBe(cardValue(n, today));
    }
    expect(Math.abs(shift / covered.length)).toBeLessThan(3);
  });

  it('the Forge drafter rates and drafts Synergy the same with and without the file', () => {
    expect([...labCards(blended).entries()]).toEqual([...labCards(today).entries()]);
    const mk = () => newDraft({ cubeId: 'synergy', format: 'grid', cube: names, seed: 20261006, youFirst: false, seats: 2, now: 1 });
    expect(selfPlay(mk(), labCards(blended)).picks).toEqual(selfPlay(mk(), labCards(today)).picks);
  });

  it('says the numbers come from another cube', () => {
    expect(humanValueLine(covered[0]!, blended)).toMatch(/Arena’s Powered Cube.*the shared cards’ \d+\.\d%.*this cube’s own scale/);
  });
});
