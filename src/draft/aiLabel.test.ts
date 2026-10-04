// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { archetypeNamedIn } from '../cube/coachContext.ts';
import { context, loadRealMeta } from '../cube/testdata/load.ts';
import { aiDeckLabel, aiDeckName, aiLabelFrom, colourWords } from './aiLabel.ts';
import { labCards } from './cards.ts';
import { aiStep, knownAiCards, newDraft, selfPlay, type BoosterDraft, type Draft, type WinstonDraft } from './draft.ts';
import { checkRequest, type MatchDeck } from './launch.ts';
import { buildPickPrompt } from './pickPrompt.ts';

const meta = loadRealMeta('synergy');
const ctx = context('synergy', meta);
const names = ctx.cube.cards.map((c) => c.name);
const cards = labCards(ctx);
const mono = (c: string) => names.filter((n) => {
  const f = ctx.facts.get(n);
  return f && !f.land && f.colors === c;
});
const lands = names.filter((n) => ctx.facts.get(n)?.land);
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const hiddenOf = (d: Draft) => {
  const known = new Set(knownAiCards(d));
  return d.picks.ai.filter((n) => !known.has(n));
};

/** Steps the draft (both seats by the AI's own rules) until the AI holds `minHidden` unseen cards and `ok` holds. */
function until(d: Draft, minHidden: number, ok: (d: Draft) => boolean): Draft {
  for (let i = 0; i < 2000 && !d.done; i++) {
    if (hiddenOf(d).length >= minHidden && ok(d)) return d;
    d = aiStep(d, cards, undefined, 1);
  }
  throw new Error('no such state');
}

describe('the AI deck label', () => {
  it('says "Unknown so far" when nothing (or too little) is known', () => {
    expect(aiLabelFrom([], ctx).text).toBe('Unknown so far');
    expect(aiLabelFrom(mono('R').slice(0, 2), ctx).text).toBe('Unknown so far (2 known)');
    expect(aiLabelFrom(lands.slice(0, 5), ctx)).toMatchObject({ text: 'Unknown so far (5 known)', colours: '' });
  });

  it('hedges a thin read and states a firm one, colours in WUBRG order', () => {
    const six = [...mono('R').slice(0, 4), ...mono('B').slice(0, 2)];
    expect(aiLabelFrom(six, ctx)).toMatchObject({ colours: 'BR', text: 'Black-Red, mostly (6 known)' });
    const many = [...mono('R').slice(0, 8), lands[0]!];
    expect(aiLabelFrom(many, ctx)).toMatchObject({ colours: 'R', text: 'Red (from 9 known cards)' });
    expect(colourWords('GW')).toBe('White-Green');
  });

  it('names at most two colours, and none when nothing stands out', () => {
    const three = [...mono('W').slice(0, 4), ...mono('U').slice(0, 3), ...mono('G').slice(0, 2)];
    expect(aiLabelFrom(three, ctx).colours).toBe('WU');
    const flat = ['W', 'U', 'B', 'R', 'G'].map((c) => mono(c)[0]!);
    expect(aiLabelFrom(flat, ctx).text).toBe('No clear colours (5 known)');
  });

  it('is a name the launcher takes and never states an archetype id the coach would quote', () => {
    for (const seed of [1, 2, 3]) {
      const d = selfPlay(newDraft({ cubeId: 'synergy', format: 'winston', cube: names, seed, youFirst: false, now: 1 }), cards);
      const name = aiDeckName(d, ctx);
      expect(name).toMatch(/^AI Drafter - /);
      const deck: MatchDeck = { name, main: [[40, 'Mountain']] };
      expect(checkRequest({ deck: { ...deck, name: 'Mine' }, aiDeck: deck })).toBeNull();
      expect(archetypeNamedIn(meta, name)).toBeNull();
    }
  });
});

describe('the label comes from known cards only', () => {
  it('Winston: the AI’s unseen piles do not change it', () => {
    let tried = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const d = selfPlay(newDraft({ cubeId: 'synergy', format: 'winston', cube: names, seed, youFirst: false, now: 1 }), cards);
      const hidden = hiddenOf(d);
      if (!hidden.length) continue;
      tried++;
      expect(aiDeckLabel(d, ctx)).toEqual(aiLabelFrom(knownAiCards(d), ctx));
      // Fill the hidden picks with a colour the known cards don't show: same label, same name.
      const label = aiDeckLabel(d, ctx);
      const other = ['W', 'U', 'B', 'R', 'G'].find((c) => !label.colours.includes(c))!;
      const known = new Set(knownAiCards(d));
      const swap = clone(d);
      const fill = mono(other).filter((n) => !known.has(n));
      swap.picks.ai = [...known].concat(hidden.map((_, i) => fill[i % fill.length]!), fill.slice(0, 20));
      expect(aiDeckLabel(swap, ctx)).toEqual(label);
      expect(aiDeckName(swap, ctx)).toBe(aiDeckName(d, ctx));
      // …and the full list would have read differently: the test is not vacuous.
      expect(aiLabelFrom(swap.picks.ai, ctx).text).not.toBe(label.text);
    }
    expect(tried).toBeGreaterThan(0);
  });

  it('Grid: every pick is public, so the label is the whole list’s', () => {
    const d = selfPlay(newDraft({ cubeId: 'synergy', format: 'grid', cube: names, seed: 4, youFirst: true, now: 1 }), cards);
    expect(aiDeckLabel(d, ctx)).toEqual(aiLabelFrom(d.picks.ai, ctx));
  });

  it('Booster: only the AI picks the code marks known count', () => {
    const d = selfPlay(newDraft({ cubeId: 'synergy', format: 'booster', cube: names, seed: 7, youFirst: true, seats: 6, now: 1 }), cards) as BoosterDraft;
    const swap = clone(d);
    const known = new Set(knownAiCards(d));
    swap.picks.ai = d.picks.ai.map((n, i) => (known.has(n) ? n : (d.bots[0]![i % d.bots[0]!.length] ?? n)));
    expect(aiDeckLabel(swap, ctx)).toEqual(aiDeckLabel(d, ctx));
  });
});

describe('Booster with three or more seats: the AI’s picks are never attributable', () => {
  for (const seats of [3, 8]) {
    it(`${seats} seats: swapping every AI pick, seen or not, with another bot’s leaves the label and the prompt unchanged`, () => {
      let d = newDraft({ cubeId: 'synergy', format: 'booster', cube: names, seed: 13, youFirst: true, seats, now: 1 }) as BoosterDraft;
      // Into pack 2, so the AI has taken plenty you saw.
      while (!d.done && d.round < 1) d = aiStep(d, cards, undefined, 1) as BoosterDraft;
      d = aiStep(d, cards, undefined, 1) as BoosterDraft;
      const seen = new Set(d.seen.you);
      expect(d.picks.ai.filter((n) => seen.has(n)).length).toBeGreaterThan(2);
      expect(knownAiCards(d)).toEqual([]);
      const swap = clone(d);
      const bot = swap.bots[swap.bots.length - 1]!;
      expect(bot).toHaveLength(swap.picks.ai.length);
      [swap.picks.ai, swap.bots[swap.bots.length - 1]] = [[...bot], [...swap.picks.ai]];
      for (const e of swap.log) if (e.who === 'ai') e.cards = [swap.picks.ai[e.at - 1]!];
      expect(swap.picks.ai).not.toEqual(d.picks.ai);
      // …and the full lists would read differently: the test is not vacuous.
      expect(aiLabelFrom(swap.picks.ai, ctx).text).not.toBe(aiLabelFrom(d.picks.ai, ctx).text);
      expect(aiDeckLabel(swap, ctx)).toEqual(aiDeckLabel(d, ctx));
      expect(aiDeckLabel(d, ctx).text).toBe('Unknown so far');
      const p = buildPickPrompt({ ctx, draft: d, infos: new Map() }).user;
      expect(buildPickPrompt({ ctx, draft: swap, infos: new Map() }).user).toBe(p);
      expect(p).toContain(`## What you know the AI has (0 of ${d.picks.ai.length})`);
    });
  }
});

describe('the pick coach prompt', () => {
  /** The prompt without its cube-guide section (static advice that names fixed cube cards). */
  const withoutGuide = (text: string) => text.replace(/\n## Cube guide[^]*?(?=\n## (?!#)|$)/, '');
  /** Swaps the AI's unseen picks with cards elsewhere out of sight (the Winston stack / a far bot's picks). */
  function swapHidden(d: Draft): Draft {
    const x = clone(d);
    const known = new Set(knownAiCards(d));
    if (x.format === 'winston') {
      const w = x as WinstonDraft;
      w.picks.ai = w.picks.ai.map((n, i) => {
        if (known.has(n) || i >= w.stack.length) return n;
        const s = w.stack[i]!;
        w.stack[i] = n;
        return s;
      });
    } else if (x.format === 'booster') {
      const b = x as BoosterDraft;
      const bot = b.bots[b.bots.length - 1]!;
      b.picks.ai = b.picks.ai.map((n, i) => {
        if (known.has(n) || i >= bot.length) return n;
        const s = bot[i]!;
        bot[i] = n;
        return s;
      });
    }
    return x;
  }

  it('Winston: names no unseen AI card, and the AI’s hidden piles leave it unchanged', () => {
    for (const seed of [1, 2, 3, 4]) {
      const d = until(newDraft({ cubeId: 'synergy', format: 'winston', cube: names, seed, youFirst: false, now: 1 }), 3, (s) => s.format === 'winston' && s.turn === 'you');
      const p = buildPickPrompt({ ctx, draft: d, infos: new Map() }).user;
      expect(p).toContain(`Its colours from these cards: ${aiDeckLabel(d, ctx).text}.`);
      const seen = new Set((d as WinstonDraft).seen.you);
      for (const n of hiddenOf(d).filter((n) => !seen.has(n) && !d.picks.you.includes(n))) expect(withoutGuide(p), `seed ${seed}: ${n}`).not.toContain(n);
      const q = buildPickPrompt({ ctx, draft: swapHidden(d), infos: new Map() }).user;
      expect(q).toBe(p);
    }
  });

  it('Booster: the AI’s unseen picks leave it unchanged', () => {
    const d = until(newDraft({ cubeId: 'synergy', format: 'booster', cube: names, seed: 5, youFirst: true, seats: 6, now: 1 }), 2, () => true);
    const p = buildPickPrompt({ ctx, draft: d, infos: new Map() }).user;
    expect(hiddenOf(d).length).toBeGreaterThan(0);
    for (const n of hiddenOf(d)) expect(withoutGuide(p), n).not.toContain(n);
    expect(buildPickPrompt({ ctx, draft: swapHidden(d), infos: new Map() }).user).toBe(p);
  });
});
