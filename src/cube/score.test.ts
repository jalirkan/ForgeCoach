// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { cardPrior, cardValue, META_STRENGTH, metaValue, VALUE_PER_RATE } from './score.ts';
import { parseMeta } from './meta.ts';
import { context, loadRealMeta } from './testdata/load.ts';

const CARD = 'Lightning Bolt';

/** The synergy cube with a meta that has one row for CARD. */
function withRow(row: Record<string, unknown> | null, strength = 20) {
  return context(
    'synergy',
    parseMeta({ schema: 1, cube: {}, sample: { games: 100, shrinkage: { prior: 'beta', mean: 0.5, strength } }, cards: row ? { [CARD]: row } : {}, archetypes: [], pairs: [] }),
  );
}

/** One beta shrinkage toward the prior read as a win rate, back on the value scale. */
function expected(wins: number, games: number, prior: number): number {
  const p = 0.5 + (prior - 50) / VALUE_PER_RATE;
  const rate = (wins + META_STRENGTH * p) / (games + META_STRENGTH);
  return Math.round(Math.max(5, Math.min(98, 50 + VALUE_PER_RATE * (rate - 0.5))) * 10) / 10;
}

describe('card value: the lab blended with the prior by games', () => {
  const prior = cardPrior(CARD, context('synergy'));

  it('zero games: the prior exactly, whatever the row says', () => {
    for (const row of [null, { games: 0, wins: 0, winRateShrunk: 0.5 }, { games: 0, winRate: 0, winRateShrunk: 0.3 }]) {
      const ctx = withRow(row);
      expect(metaValue(CARD, ctx)).toBeNull();
      expect(cardValue(CARD, ctx)).toBe(prior);
    }
  });

  it('few games: barely moves off the prior', () => {
    const ctx = withRow({ games: 4, wins: 0, winRate: 0, winRateShrunk: 0.4167 });
    const m = metaValue(CARD, ctx)!;
    expect(m.weight).toBeCloseTo(4 / (4 + META_STRENGTH), 12);
    expect(m.rawRate).toBe(0);
    expect(cardValue(CARD, ctx)).toBe(expected(0, 4, prior));
    // 0 of 4 is the worst record there is; it still moves the value by under 5 % of the gap.
    expect(prior - cardValue(CARD, ctx)).toBeLessThan(0.05 * (prior - m.value));
    expect(cardValue(CARD, ctx)).toBeLessThan(prior);
  });

  it('many games: close to the lab’s rate', () => {
    const ctx = withRow({ games: 2000, wins: 1100, winRate: 0.55, winRateShrunk: 0.5495 });
    const m = metaValue(CARD, ctx)!;
    expect(m.weight).toBeGreaterThan(0.95);
    expect(m.value).toBeCloseTo(50 + VALUE_PER_RATE * 0.05, 9);
    expect(cardValue(CARD, ctx)).toBe(expected(1100, 2000, prior));
    expect(Math.abs(cardValue(CARD, ctx) - m.value)).toBeLessThan(0.05 * Math.abs(prior - m.value) + 0.1);
  });

  it('weights grow with games, and the lab’s shrinkage is not applied twice', () => {
    const v = (g: number) => cardValue(CARD, withRow({ games: g, wins: g * 0.3, winRate: 0.3 }));
    expect(v(10)).toBeLessThan(prior);
    expect(v(40)).toBeLessThan(v(10));
    expect(v(160)).toBeLessThan(v(40));
    // The lab's shrunk rate (toward the cube mean) is display only; the raw rate is the evidence.
    const a = withRow({ games: 40, wins: 12, winRate: 0.3, winRateShrunk: 0.3667 });
    const b = withRow({ games: 40, wins: 12, winRate: 0.3, winRateShrunk: 0.49 });
    expect(cardValue(CARD, a)).toBe(cardValue(CARD, b));
    expect(metaValue(CARD, a)!.winRate).toBe(0.3667);
  });

  it('recovers the raw rate from the lab’s shrunk rate when the row has nothing else', () => {
    // (wins + 20·0.5) / (40 + 20) = 0.3667 ⇒ wins = 12, raw 0.3.
    const ctx = withRow({ games: 40, winRateShrunk: 22 / 60 });
    expect(metaValue(CARD, ctx)!.rawRate).toBeCloseTo(0.3, 9);
    expect(cardValue(CARD, ctx)).toBe(expected(12, 40, prior));
  });

  it('shipped metas: every card with no lab games sits on its prior (Soul-Scar Mage in synergy)', () => {
    // J075's metas leave only three cube cards with no games (synergy's
    // Soul-Scar Mage and Grumgully, vintage's Ancient Tomb): the old ~40-draft
    // metas had 40+ per cube. Each still sits exactly on its prior.
    let zero = 0;
    for (const id of ['synergy', 'modern-era', 'vintage', 'pauper'] as const) {
      const ctx = context(id, loadRealMeta(id));
      const plain = context(id);
      for (const [name, s] of Object.entries(ctx.meta!.meta.cards)) {
        if ((s.games ?? 0) > 0 || !ctx.byName.has(name)) continue;
        zero++;
        expect(cardValue(name, ctx)).toBe(cardPrior(name, plain));
      }
    }
    expect(zero).toBeGreaterThan(0);
    const syn = context('synergy', loadRealMeta('synergy'));
    expect(syn.meta!.meta.cards['Soul-Scar Mage']?.games ?? 0).toBe(0);
    expect(cardValue('Soul-Scar Mage', syn)).toBe(cardPrior('Soul-Scar Mage', context('synergy')));
  });

  it('a shipped meta with many unplayed rows: each sits on its prior whatever its rates say', () => {
    // Synthetic: the 50 least-played vintage rows set to 0 games, keeping the
    // lab's winRate / winRateShrunk (which must be ignored at 0 games).
    const m = structuredClone(loadRealMeta('vintage'));
    const rows = Object.entries(m.cards).sort((x, y) => (x[1].games ?? 0) - (y[1].games ?? 0)).slice(0, 50);
    for (const [, r] of rows) {
      r.games = 0;
      r.wins = 0;
    }
    const ctx = context('vintage', m);
    const plain = context('vintage');
    let checked = 0;
    for (const [name] of rows) {
      if (!ctx.byName.has(name)) continue;
      checked++;
      expect(cardValue(name, ctx)).toBe(cardPrior(name, plain));
    }
    expect(checked).toBeGreaterThan(40);
  });
});
